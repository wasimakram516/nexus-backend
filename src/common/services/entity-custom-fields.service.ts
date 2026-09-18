import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ContactPersonType } from '../enums/domain.enums';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomFieldEntityType } from '../constants/custom-field-entities.constants';
import { normalizeContactPersonType } from '../utils/contact-owner.util';
import { normalizeCustomFieldValues } from '../utils/custom-field-values.util';
import { validateCustomFieldValue } from '../utils/custom-field-validation.util';
import { isCustomFieldDefinitionPlanAllowed } from '../utils/custom-field-plan.util';
import { isCustomFieldDefinitionVisibleToRole } from '../utils/custom-field-visibility.util';
import { RequestContextService } from './request-context.service';
import { ModuleAccessService } from './module-access.service';
import { runAuditedTransaction } from '../utils/transaction.util';

type EntityRecord = {
  id: string;
};

@Injectable()
export class EntityCustomFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    @Optional() private readonly moduleAccessService?: ModuleAccessService,
  ) {}

  /** Resolves the institution's plan key for gating purposes. Ungated
   *  definitions (no planKeys set — every definition before this gate
   *  existed) are unaffected either way. Callers/tests that construct this
   *  service without ModuleAccessService (e.g. isolated unit specs) get
   *  null back, which fails only explicitly plan-gated definitions closed
   *  rather than silently ignoring the gate — every real DI path provides
   *  ModuleAccessService via PrismaModule. */
  private async resolvePlanKey(institutionId: string): Promise<string | null> {
    if (!this.moduleAccessService) return null;
    return this.moduleAccessService.resolvePlanKeyForInstitution(institutionId);
  }

  /** Resolves the acting user's role from request-scoped context for
   *  visibility gating purposes. Read from `RequestContextService` instead
   *  of a new parameter on every `saveValues`/`saveRecord`/`attachToItems`
   *  call — those call sites span 8 modules, and `currentUser` is already
   *  populated on every real HTTP request by `CurrentUserContextInterceptor`
   *  (the same mechanism audit logging already relies on), so this avoids a
   *  wide, unrelated signature change across the whole custom-fields write
   *  surface. Ungated definitions (no visibilityRules set) are unaffected
   *  either way; a caller/test with no request context in flight fails
   *  closed only for explicitly role-gated definitions, never silently
   *  ignoring the gate. */
  private resolveActorRole(): UserRole | null {
    return this.requestContext.get('currentUser')?.role ?? null;
  }

  /** Commits a record and its custom values together, rolling both back on validation failure. */
  async saveRecord<T extends EntityRecord>(
    params: {
      institutionId: string;
      moduleKey: ModuleKey;
      entityType: CustomFieldEntityType;
      values?: Record<string, unknown>;
      create: boolean;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    },
    mutation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return runAuditedTransaction(
      this.prisma,
      this.requestContext,
      async (transaction) => {
        const record = await mutation(transaction);
        await this.saveValues(
          {
            ...params,
            entityId: record.id,
            requireRequiredFields: params.create,
          },
          transaction,
        );
        return record;
      },
      params.isolationLevel,
    );
  }

  async saveValues(
    params: {
      institutionId: string;
      moduleKey: ModuleKey;
      entityType: CustomFieldEntityType;
      entityId: string;
      values?: Record<string, unknown>;
      requireRequiredFields?: boolean;
    },
    transaction?: Prisma.TransactionClient,
  ) {
    const client = transaction ?? this.prisma;
    const values = normalizeCustomFieldValues(params.values);
    let entries = Object.entries(values);

    if (!entries.length && !params.requireRequiredFields) {
      return {};
    }

    const definitions = await client.customFieldDefinition.findMany({
      where: {
        institutionId: params.institutionId,
        moduleKey: params.moduleKey,
        entityType: { equals: params.entityType, mode: 'insensitive' },
        isActive: true,
      },
      select: {
        id: true,
        fieldKey: true,
        label: true,
        inputType: true,
        isRequired: true,
        isActive: true,
        sortOrder: true,
        moduleKey: true,
        entityType: true,
        options: true,
        validation: true,
        defaultValue: true,
        planKeys: true,
        visibilityRules: true,
      },
    });

    if (
      new Set(definitions.map((d) => d.fieldKey)).size !== definitions.length
    ) {
      throw new BadRequestException(
        'Conflicting custom field definitions must be resolved before saving values.',
      );
    }

    // Plan-gated-out and role-invisible definitions are both treated as
    // though they don't exist for this write: a submitted value for one is
    // an unknown key, and neither is ever force-required on create (§ M4.5
    // shared blocker "plan and visibility rules are enforced consistently
    // on read and write" — visibilityRules was previously stored but never
    // read anywhere).
    const planKey = await this.resolvePlanKey(params.institutionId);
    const actorRole = this.resolveActorRole();
    const allowedDefinitions = definitions.filter(
      (definition) =>
        isCustomFieldDefinitionPlanAllowed(definition.planKeys, planKey) &&
        isCustomFieldDefinitionVisibleToRole(
          definition.visibilityRules,
          actorRole,
        ),
    );
    const definitionsByKey = new Map(
      allowedDefinitions.map((definition) => [definition.fieldKey, definition]),
    );
    if (params.requireRequiredFields) {
      for (const definition of allowedDefinitions) {
        if (
          !Object.hasOwn(values, definition.fieldKey) &&
          definition.defaultValue !== null &&
          definition.defaultValue !== undefined
        ) {
          values[definition.fieldKey] = definition.defaultValue;
        }
        validateCustomFieldValue(definition, values[definition.fieldKey]);
      }
      entries = Object.entries(values);
    }
    const unknownKeys = entries
      .map(([fieldKey]) => fieldKey)
      .filter((fieldKey) => !definitionsByKey.has(fieldKey));

    if (unknownKeys.length) {
      throw new BadRequestException(
        `Unknown custom field keys for ${params.entityType}: ${unknownKeys.join(', ')}`,
      );
    }

    for (const [fieldKey, value] of entries) {
      const definition = definitionsByKey.get(fieldKey);
      if (definition) validateCustomFieldValue(definition, value);
    }

    const writes = entries.map(([fieldKey, value]) => {
      const definition = definitionsByKey.get(fieldKey);

      if (!definition) {
        throw new BadRequestException(
          `Missing custom field definition for ${fieldKey}.`,
        );
      }

      return client.customFieldValue.upsert({
        where: {
          definitionId_entityId_activeScopeKey: {
            definitionId: definition.id,
            entityId: params.entityId,
            activeScopeKey: 'ACTIVE',
          },
        },
        create: {
          institutionId: params.institutionId,
          definitionId: definition.id,
          entityId: params.entityId,
          value: this.toJson(value),
          definitionSnapshot: this.toJson({
            id: definition.id,
            moduleKey: definition.moduleKey,
            entityType: definition.entityType,
            fieldKey: definition.fieldKey,
            label: definition.label,
            inputType: definition.inputType,
            isRequired: definition.isRequired,
            isActive: definition.isActive,
            sortOrder: definition.sortOrder,
          }),
        },
        update: {
          value: this.toJson(value),
          definitionSnapshot: this.toJson({
            id: definition.id,
            moduleKey: definition.moduleKey,
            entityType: definition.entityType,
            fieldKey: definition.fieldKey,
            label: definition.label,
            inputType: definition.inputType,
            isRequired: definition.isRequired,
            isActive: definition.isActive,
            sortOrder: definition.sortOrder,
          }),
        },
      });
    });
    if (transaction) await Promise.all(writes);
    else await this.prisma.$transaction(writes);

    return values;
  }

  async attachToItem<T extends EntityRecord>(
    item: T | null,
    entityType: CustomFieldEntityType,
  ): Promise<(T & { customFields: Record<string, unknown> }) | null> {
    if (!item) {
      return null;
    }

    const [attached] = await this.attachToItems([item], entityType);
    return attached ?? null;
  }

  async attachToItems<T extends EntityRecord>(
    items: T[],
    entityType: CustomFieldEntityType,
  ): Promise<Array<T & { customFields: Record<string, unknown> }>> {
    if (!items.length) {
      return [];
    }

    const ids = items.map((item) => item.id);
    const values = await this.prisma.customFieldValue.findMany({
      where: {
        entityId: { in: ids },
        definition: {
          entityType: { equals: entityType, mode: 'insensitive' },
        },
      },
      include: {
        definition: {
          select: {
            fieldKey: true,
            planKeys: true,
            visibilityRules: true,
          },
        },
      },
    });

    // A field plan-gated out after a value was saved (e.g. the institution
    // downgraded, or the definition was retroactively gated) must not be
    // readable either — same rule as the write side, applied per value's
    // own institutionId since attachToItems can span multiple institutions
    // in one call (e.g. a superadmin platform-console list). A field
    // invisible to the caller's role is dropped the same way.
    const institutionIds = [
      ...new Set(values.map((item) => item.institutionId)),
    ];
    const planKeyByInstitution = new Map(
      await Promise.all(
        institutionIds.map(
          async (id) => [id, await this.resolvePlanKey(id)] as const,
        ),
      ),
    );
    const actorRole = this.resolveActorRole();

    const valuesByEntityId = new Map<string, Record<string, unknown>>();

    for (const item of values) {
      if (
        !isCustomFieldDefinitionPlanAllowed(
          item.definition.planKeys,
          planKeyByInstitution.get(item.institutionId) ?? null,
        ) ||
        !isCustomFieldDefinitionVisibleToRole(
          item.definition.visibilityRules,
          actorRole,
        )
      ) {
        continue;
      }
      const current = valuesByEntityId.get(item.entityId) ?? {};
      current[item.definition.fieldKey] = item.value;
      valuesByEntityId.set(item.entityId, current);
    }

    return items.map((item) => ({
      ...item,
      customFields: valuesByEntityId.get(item.id) ?? {},
    }));
  }

  async resolveInstitutionIdByCampus(campusId: string) {
    const campus = await this.prisma.campus.findUnique({
      where: { id: campusId },
      select: { institutionId: true },
    });

    if (!campus?.institutionId) {
      throw new NotFoundException('Institution not found for campus.');
    }

    return campus.institutionId;
  }

  async resolveInstitutionIdByLevel(levelId: string) {
    const level = await this.prisma.level.findUnique({
      where: { id: levelId },
      select: {
        campus: {
          select: {
            institutionId: true,
          },
        },
      },
    });

    if (!level?.campus.institutionId) {
      throw new NotFoundException('Institution not found for level.');
    }

    return level.campus.institutionId;
  }

  async resolveInstitutionIdByClass(classId: string) {
    const academicClass = await this.prisma.academicClass.findUnique({
      where: { id: classId },
      select: {
        level: {
          select: {
            campus: {
              select: {
                institutionId: true,
              },
            },
          },
        },
      },
    });

    const institutionId = academicClass?.level.campus.institutionId;
    if (!institutionId) {
      throw new NotFoundException('Institution not found for class.');
    }

    return institutionId;
  }

  async resolveInstitutionIdBySection(sectionId: string) {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      select: {
        class: {
          select: {
            level: {
              select: {
                campus: {
                  select: {
                    institutionId: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const institutionId = section?.class.level.campus.institutionId;
    if (!institutionId) {
      throw new NotFoundException('Institution not found for section.');
    }

    return institutionId;
  }

  async resolveInstitutionIdBySubject(subjectId: string) {
    const subject = await this.prisma.subject.findUnique({
      where: { id: subjectId },
      select: {
        class: {
          select: {
            level: {
              select: {
                campus: {
                  select: {
                    institutionId: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const institutionId = subject?.class.level.campus.institutionId;
    if (!institutionId) {
      throw new NotFoundException('Institution not found for subject.');
    }

    return institutionId;
  }

  async resolveInstitutionIdByStudent(studentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: {
        campus: {
          select: {
            institutionId: true,
          },
        },
      },
    });

    const institutionId = student?.campus.institutionId;
    if (!institutionId) {
      throw new NotFoundException('Institution not found for student.');
    }

    return institutionId;
  }

  async resolveInstitutionIdByGuardian(guardianId: string) {
    const guardian = await this.prisma.guardian.findUnique({
      where: { id: guardianId },
      select: {
        campus: {
          select: {
            institutionId: true,
          },
        },
      },
    });

    const institutionId = guardian?.campus.institutionId;
    if (!institutionId) {
      throw new NotFoundException('Institution not found for guardian.');
    }

    return institutionId;
  }

  async resolveInstitutionIdByStaffProfile(staffProfileId: string) {
    const staffProfile = await this.prisma.staffProfile.findUnique({
      where: { id: staffProfileId },
      select: {
        campus: {
          select: {
            institutionId: true,
          },
        },
      },
    });

    const institutionId = staffProfile?.campus.institutionId;
    if (!institutionId) {
      throw new NotFoundException('Institution not found for staff profile.');
    }

    return institutionId;
  }

  async resolveInstitutionIdBySalary(salaryId: string) {
    const salary = await this.prisma.staffSalary.findUnique({
      where: { id: salaryId },
      select: {
        campus: {
          select: {
            institutionId: true,
          },
        },
      },
    });

    const institutionId = salary?.campus.institutionId;
    if (!institutionId) {
      throw new NotFoundException('Institution not found for salary record.');
    }

    return institutionId;
  }

  async resolveInstitutionIdByFeeStructure(feeStructureId: string) {
    const feeStructure = await this.prisma.feeStructure.findUnique({
      where: { id: feeStructureId },
      select: {
        campus: {
          select: {
            institutionId: true,
          },
        },
      },
    });

    const institutionId = feeStructure?.campus.institutionId;
    if (!institutionId) {
      throw new NotFoundException('Institution not found for fee structure.');
    }

    return institutionId;
  }

  async resolveInstitutionIdByContact(
    personType: string,
    personId: string,
  ): Promise<string> {
    const normalized = normalizeContactPersonType(personType);

    if (normalized === ContactPersonType.STUDENT) {
      return this.resolveInstitutionIdByStudent(personId);
    }
    if (normalized === ContactPersonType.GUARDIAN) {
      return this.resolveInstitutionIdByGuardian(personId);
    }
    if (normalized === ContactPersonType.STAFF) {
      return this.resolveInstitutionIdByStaffProfile(personId);
    }

    throw new BadRequestException(
      `Contacts custom fields are not supported for person type "${personType}" yet.`,
    );
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }
}
