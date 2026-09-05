import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContactPersonType } from '../enums/domain.enums';
import { ModuleKey, Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomFieldEntityType } from '../constants/custom-field-entities.constants';
import { normalizeContactPersonType } from '../utils/contact-owner.util';
import { normalizeCustomFieldValues } from '../utils/custom-field-values.util';

type EntityRecord = {
  id: string;
};

@Injectable()
export class EntityCustomFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  async saveValues(params: {
    institutionId: string;
    moduleKey: ModuleKey;
    entityType: CustomFieldEntityType;
    entityId: string;
    values?: Record<string, unknown>;
  }) {
    const values = normalizeCustomFieldValues(params.values);
    const entries = Object.entries(values);

    if (!entries.length) {
      return {};
    }

    const definitions = await this.prisma.customFieldDefinition.findMany({
      where: {
        institutionId: params.institutionId,
        moduleKey: params.moduleKey,
        entityType: params.entityType,
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
      },
    });

    const definitionsByKey = new Map(
      definitions.map((definition) => [definition.fieldKey, definition]),
    );
    const unknownKeys = entries
      .map(([fieldKey]) => fieldKey)
      .filter((fieldKey) => !definitionsByKey.has(fieldKey));

    if (unknownKeys.length) {
      throw new BadRequestException(
        `Unknown custom field keys for ${params.entityType}: ${unknownKeys.join(', ')}`,
      );
    }

    await this.prisma.$transaction(
      entries.map(([fieldKey, value]) => {
        const definition = definitionsByKey.get(fieldKey);

        if (!definition) {
          throw new BadRequestException(
            `Missing custom field definition for ${fieldKey}.`,
          );
        }

        return this.prisma.customFieldValue.upsert({
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
      }),
    );

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
          entityType,
        },
      },
      include: {
        definition: {
          select: {
            fieldKey: true,
          },
        },
      },
    });

    const valuesByEntityId = new Map<string, Record<string, unknown>>();

    for (const item of values) {
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
