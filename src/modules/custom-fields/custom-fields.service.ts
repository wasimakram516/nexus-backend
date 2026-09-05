import {
  ConflictException,
  ForbiddenException,
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ContactPersonType } from '../../common/enums/domain.enums';
import { CustomFieldInputType, Prisma, UserRole } from '../../prisma/client';
import { CustomFieldEntity } from '../../common/constants/custom-field-entities.constants';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import {
  normalizeContactPersonType,
  resolveContactOwner,
} from '../../common/utils/contact-owner.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCustomFieldDefinitionDto,
  ListCustomFieldDefinitionsQueryDto,
  ListCustomFieldValuesQueryDto,
  UpdateCustomFieldDefinitionDto,
  UpsertCustomFieldValueDto,
} from './dto/custom-fields.dto';

@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campusAccessService: CampusAccessService,
    private readonly moduleAccessService: ModuleAccessService,
  ) {}

  async createDefinition(
    currentUser: CurrentUser,
    dto: CreateCustomFieldDefinitionDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      dto.moduleKey,
    );
    const institutionId = await this.resolveInstitutionId(
      currentUser,
      dto.institutionId,
    );
    this.assertDefinitionRules(dto.inputType, dto.options);

    try {
      const definition = await this.prisma.customFieldDefinition.create({
        data: {
          institutionId,
          moduleKey: dto.moduleKey,
          entityType: dto.entityType,
          fieldKey: dto.fieldKey,
          label: dto.label,
          inputType: dto.inputType,
          placeholder: dto.placeholder,
          helpText: dto.helpText,
          defaultValue: this.toJsonOrUndefined(dto.defaultValue),
          options: this.toJsonOrUndefined(dto.options),
          validation: this.toJsonOrUndefined(dto.validation),
          visibilityRules: this.toJsonOrUndefined(dto.visibilityRules),
          planKeys: this.toJsonOrUndefined(dto.planKeys),
          isRequired: dto.isRequired ?? false,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });

      return {
        message: 'Custom field definition created successfully',
        data: definition,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            'A custom field with this key already exists for the entity.',
          );
        }
      }

      throw error;
    }
  }

  async listDefinitions(
    currentUser: CurrentUser,
    query: ListCustomFieldDefinitionsQueryDto,
  ) {
    if (query.moduleKey) {
      await this.moduleAccessService.assertModuleEnabledForUser(
        currentUser,
        query.moduleKey,
      );
    }
    const institutionId = this.resolveOptionalInstitutionId(
      currentUser,
      query.institutionId,
    );

    const items = await this.prisma.customFieldDefinition.findMany({
      where: {
        institutionId,
        moduleKey: query.moduleKey,
        entityType: query.entityType,
        isActive: query.isActive,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      message: 'Custom field definitions retrieved successfully',
      data: items,
    };
  }

  async updateDefinition(
    currentUser: CurrentUser,
    definitionId: string,
    dto: UpdateCustomFieldDefinitionDto,
  ) {
    const definition = await this.prisma.customFieldDefinition.findUnique({
      where: { id: definitionId },
    });

    if (!definition) {
      throw new NotFoundException('Custom field definition not found.');
    }

    this.assertInstitutionAccess(currentUser, definition.institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      definition.moduleKey,
    );
    this.assertDefinitionRules(
      dto.inputType ?? definition.inputType,
      dto.options,
    );

    try {
      const updated = await this.prisma.customFieldDefinition.update({
        where: { id: definitionId },
        data: {
          moduleKey: dto.moduleKey,
          entityType: dto.entityType,
          fieldKey: dto.fieldKey,
          label: dto.label,
          inputType: dto.inputType,
          placeholder: dto.placeholder,
          helpText: dto.helpText,
          defaultValue: this.toJsonOrUndefined(dto.defaultValue),
          options: this.toJsonOrUndefined(dto.options),
          validation: this.toJsonOrUndefined(dto.validation),
          visibilityRules: this.toJsonOrUndefined(dto.visibilityRules),
          planKeys: this.toJsonOrUndefined(dto.planKeys),
          isRequired: dto.isRequired,
          isActive: dto.isActive,
          sortOrder: dto.sortOrder,
        },
      });

      return {
        message: 'Custom field definition updated successfully',
        data: updated,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            'A custom field with this key already exists for the entity.',
          );
        }
      }

      throw error;
    }
  }

  async upsertValue(currentUser: CurrentUser, dto: UpsertCustomFieldValueDto) {
    const definition = await this.prisma.customFieldDefinition.findUnique({
      where: { id: dto.definitionId },
    });

    if (!definition) {
      throw new NotFoundException('Custom field definition not found.');
    }

    this.assertInstitutionAccess(currentUser, definition.institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      definition.moduleKey,
    );
    await this.assertEntityAccess(
      currentUser,
      definition.institutionId,
      definition.entityType,
      dto.entityId,
    );

    if (dto.institutionId && dto.institutionId !== definition.institutionId) {
      throw new ForbiddenException(
        'Custom field values must be saved against the definition institution.',
      );
    }

    const value = await this.prisma.customFieldValue.upsert({
      where: {
        definitionId_entityId_activeScopeKey: {
          definitionId: definition.id,
          entityId: dto.entityId,
          activeScopeKey: 'ACTIVE',
        },
      },
      create: {
        institutionId: definition.institutionId,
        definitionId: definition.id,
        entityId: dto.entityId,
        value: this.toJson(dto.value),
        definitionSnapshot: this.toJson(this.toDefinitionSnapshot(definition)),
      },
      update: {
        value: this.toJson(dto.value),
        definitionSnapshot: this.toJson(this.toDefinitionSnapshot(definition)),
      },
      include: {
        definition: true,
      },
    });

    return {
      message: 'Custom field value saved successfully',
      data: value,
    };
  }

  async listValues(
    currentUser: CurrentUser,
    query: ListCustomFieldValuesQueryDto,
  ) {
    if (query.definitionId) {
      const definition = await this.prisma.customFieldDefinition.findUnique({
        where: { id: query.definitionId },
        select: {
          moduleKey: true,
          institutionId: true,
        },
      });

      if (!definition) {
        throw new NotFoundException('Custom field definition not found.');
      }

      this.assertInstitutionAccess(currentUser, definition.institutionId);
      await this.moduleAccessService.assertModuleEnabledForUser(
        currentUser,
        definition.moduleKey,
      );
    }

    const institutionId = this.resolveOptionalInstitutionId(
      currentUser,
      query.institutionId,
    );

    const items = await this.prisma.customFieldValue.findMany({
      where: {
        institutionId,
        definitionId: query.definitionId,
        entityId: query.entityId,
      },
      include: {
        definition: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      message: 'Custom field values retrieved successfully',
      data: items,
    };
  }

  private async resolveInstitutionId(
    currentUser: CurrentUser,
    requestedInstitutionId?: string,
  ) {
    const institutionId = this.resolveOptionalInstitutionId(
      currentUser,
      requestedInstitutionId,
    );

    if (!institutionId) {
      throw new ForbiddenException('Institution context is required.');
    }

    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true },
    });

    if (!institution) {
      throw new NotFoundException('Institution not found.');
    }

    return institution.id;
  }

  private resolveOptionalInstitutionId(
    currentUser: CurrentUser,
    requestedInstitutionId?: string,
  ) {
    if (currentUser.role === UserRole.SUPERADMIN) {
      return requestedInstitutionId;
    }

    if (!currentUser.institutionId) {
      throw new ForbiddenException(
        'Your account is not linked to an institution.',
      );
    }

    if (
      requestedInstitutionId &&
      requestedInstitutionId !== currentUser.institutionId
    ) {
      throw new ForbiddenException(
        'You can only manage custom fields for your own institution.',
      );
    }

    return currentUser.institutionId;
  }

  private assertInstitutionAccess(
    currentUser: CurrentUser,
    institutionId: string,
  ) {
    if (
      currentUser.role !== UserRole.SUPERADMIN &&
      currentUser.institutionId !== institutionId
    ) {
      throw new ForbiddenException(
        'You can only manage custom fields for your own institution.',
      );
    }
  }

  private async assertEntityAccess(
    currentUser: CurrentUser,
    institutionId: string,
    entityType: string,
    entityId: string,
  ) {
    switch (entityType) {
      case CustomFieldEntity.CAMPUS: {
        const campus = await this.prisma.campus.findUnique({
          where: { id: entityId },
          select: { institutionId: true },
        });
        if (!campus || campus.institutionId !== institutionId) {
          throw new ForbiddenException(
            'You can only manage custom field values for accessible entities.',
          );
        }
        await this.campusAccessService.assertCampusAccess(
          currentUser,
          entityId,
        );
        return;
      }
      case CustomFieldEntity.LEVEL:
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          await this.prisma.level.findUnique({
            where: { id: entityId },
            select: {
              campusId: true,
              campus: { select: { institutionId: true } },
            },
          }),
        );
        return;
      case CustomFieldEntity.CLASS:
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          await this.prisma.academicClass
            .findUnique({
              where: { id: entityId },
              select: {
                level: {
                  select: {
                    campusId: true,
                    campus: { select: { institutionId: true } },
                  },
                },
              },
            })
            .then((item) =>
              item
                ? {
                    campusId: item.level.campusId,
                    campus: item.level.campus,
                  }
                : null,
            ),
        );
        return;
      case CustomFieldEntity.SECTION:
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          await this.prisma.section
            .findUnique({
              where: { id: entityId },
              select: {
                class: {
                  select: {
                    level: {
                      select: {
                        campusId: true,
                        campus: { select: { institutionId: true } },
                      },
                    },
                  },
                },
              },
            })
            .then((item) =>
              item
                ? {
                    campusId: item.class.level.campusId,
                    campus: item.class.level.campus,
                  }
                : null,
            ),
        );
        return;
      case CustomFieldEntity.SUBJECT:
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          await this.prisma.subject
            .findUnique({
              where: { id: entityId },
              select: {
                class: {
                  select: {
                    level: {
                      select: {
                        campusId: true,
                        campus: { select: { institutionId: true } },
                      },
                    },
                  },
                },
              },
            })
            .then((item) =>
              item
                ? {
                    campusId: item.class.level.campusId,
                    campus: item.class.level.campus,
                  }
                : null,
            ),
        );
        return;
      case CustomFieldEntity.STUDENT: {
        const item = await this.prisma.student.findUnique({
          where: { id: entityId },
          select: {
            campusId: true,
            campus: { select: { institutionId: true } },
          },
        });
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          item,
        );
        return;
      }
      case CustomFieldEntity.GUARDIAN: {
        const item = await this.prisma.guardian.findUnique({
          where: { id: entityId },
          select: {
            campusId: true,
            campus: { select: { institutionId: true } },
          },
        });
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          item,
        );
        return;
      }
      case CustomFieldEntity.STAFF_PROFILE: {
        const item = await this.prisma.staffProfile.findUnique({
          where: { id: entityId },
          select: {
            campusId: true,
            campus: { select: { institutionId: true } },
          },
        });
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          item,
        );
        return;
      }
      case CustomFieldEntity.STAFF_SALARY:
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          await this.prisma.staffSalary.findUnique({
            where: { id: entityId },
            select: {
              campusId: true,
              campus: { select: { institutionId: true } },
            },
          }),
        );
        return;
      case CustomFieldEntity.SALARY_DEDUCTION_RULE:
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          await this.prisma.salaryDeductionRule.findUnique({
            where: { id: entityId },
            select: {
              campusId: true,
              campus: { select: { institutionId: true } },
            },
          }),
        );
        return;
      case CustomFieldEntity.SALARY_ADJUSTMENT:
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          await this.prisma.salaryAdjustment.findUnique({
            where: { id: entityId },
            select: {
              campusId: true,
              campus: { select: { institutionId: true } },
            },
          }),
        );
        return;
      case CustomFieldEntity.SALARY_PAYMENT:
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          await this.prisma.salaryPayment.findUnique({
            where: { id: entityId },
            select: {
              campusId: true,
              campus: { select: { institutionId: true } },
            },
          }),
        );
        return;
      case CustomFieldEntity.BANK_ACCOUNT:
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          await this.prisma.bankAccount.findUnique({
            where: { id: entityId },
            select: {
              campusId: true,
              campus: { select: { institutionId: true } },
            },
          }),
        );
        return;
      case CustomFieldEntity.FEE_STRUCTURE:
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          await this.prisma.feeStructure.findUnique({
            where: { id: entityId },
            select: {
              campusId: true,
              campus: { select: { institutionId: true } },
            },
          }),
        );
        return;
      case CustomFieldEntity.STUDENT_DISCOUNT: {
        const item = await this.prisma.studentDiscount.findUnique({
          where: { id: entityId },
          select: {
            studentId: true,
            student: {
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
        if (!item || item.student.campus.institutionId !== institutionId) {
          throw new ForbiddenException(
            'You can only manage custom field values for accessible entities.',
          );
        }
        await this.campusAccessService.assertStudentAccess(
          currentUser,
          item.studentId,
        );
        return;
      }
      case CustomFieldEntity.STUDENT_FINE_RULE:
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          await this.prisma.studentFineRule.findUnique({
            where: { id: entityId },
            select: {
              campusId: true,
              campus: { select: { institutionId: true } },
            },
          }),
        );
        return;
      case CustomFieldEntity.STUDENT_FINE: {
        const item = await this.prisma.studentFine.findUnique({
          where: { id: entityId },
          select: {
            campusId: true,
            studentId: true,
            campus: { select: { institutionId: true } },
          },
        });
        if (!item || item.campus.institutionId !== institutionId) {
          throw new ForbiddenException(
            'You can only manage custom field values for accessible entities.',
          );
        }
        await this.campusAccessService.assertCampusAccess(
          currentUser,
          item.campusId,
        );
        await this.campusAccessService.assertStudentAccess(
          currentUser,
          item.studentId,
        );
        return;
      }
      case CustomFieldEntity.FEE_VOUCHER: {
        const item = await this.prisma.feeVoucher.findUnique({
          where: { id: entityId },
          select: {
            studentId: true,
            student: {
              select: {
                campusId: true,
                campus: {
                  select: {
                    institutionId: true,
                  },
                },
              },
            },
          },
        });
        if (!item || item.student.campus.institutionId !== institutionId) {
          throw new ForbiddenException(
            'You can only manage custom field values for accessible entities.',
          );
        }
        await this.campusAccessService.assertCampusAccess(
          currentUser,
          item.student.campusId,
        );
        await this.campusAccessService.assertStudentAccess(
          currentUser,
          item.studentId,
        );
        return;
      }
      case CustomFieldEntity.FEE_PAYMENT: {
        const item = await this.prisma.feePayment.findUnique({
          where: { id: entityId },
          select: {
            voucher: {
              select: {
                studentId: true,
                student: {
                  select: {
                    campusId: true,
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
        if (
          !item ||
          item.voucher.student.campus.institutionId !== institutionId
        ) {
          throw new ForbiddenException(
            'You can only manage custom field values for accessible entities.',
          );
        }
        await this.campusAccessService.assertCampusAccess(
          currentUser,
          item.voucher.student.campusId,
        );
        await this.campusAccessService.assertStudentAccess(
          currentUser,
          item.voucher.studentId,
        );
        return;
      }
      case CustomFieldEntity.STUDENT_HISTORY: {
        const item = await this.prisma.studentHistory.findUnique({
          where: { id: entityId },
          select: {
            studentId: true,
            student: {
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
        if (!item || item.student.campus.institutionId !== institutionId) {
          throw new ForbiddenException(
            'You can only manage custom field values for accessible entities.',
          );
        }
        await this.campusAccessService.assertStudentAccess(
          currentUser,
          item.studentId,
        );
        return;
      }
      case CustomFieldEntity.TEACHER_SUBJECT:
        await this.assertCampusScopedEntityAccess(
          currentUser,
          institutionId,
          await this.prisma.teacherSubject.findUnique({
            where: { id: entityId },
            select: {
              campusId: true,
              campus: { select: { institutionId: true } },
            },
          }),
        );
        return;
      case CustomFieldEntity.CONTACT: {
        const item = await this.prisma.contact.findUnique({
          where: { id: entityId },
          select: {
            studentId: true,
            guardianId: true,
            staffProfileId: true,
          },
        });
        const owner = item ? resolveContactOwner(item) : null;
        if (!owner) {
          throw new ForbiddenException(
            'You can only manage custom field values for accessible entities.',
          );
        }
        await this.assertContactAccess(
          currentUser,
          institutionId,
          owner.personType,
          owner.personId,
        );
        return;
      }
      default:
        throw new BadRequestException(
          `Entity access validation is not configured for "${entityType}".`,
        );
    }
  }

  private async assertCampusScopedEntityAccess(
    currentUser: CurrentUser,
    institutionId: string,
    item: {
      campusId: string;
      campus: { institutionId: string | null };
    } | null,
  ) {
    if (!item || item.campus.institutionId !== institutionId) {
      throw new ForbiddenException(
        'You can only manage custom field values for accessible entities.',
      );
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      item.campusId,
    );
  }

  private async assertContactAccess(
    currentUser: CurrentUser,
    institutionId: string,
    personType: string,
    personId: string,
  ) {
    const normalized = normalizeContactPersonType(personType);

    if (normalized === ContactPersonType.STUDENT) {
      await this.assertEntityAccess(
        currentUser,
        institutionId,
        CustomFieldEntity.STUDENT,
        personId,
      );
      return;
    }

    if (normalized === ContactPersonType.GUARDIAN) {
      await this.assertEntityAccess(
        currentUser,
        institutionId,
        CustomFieldEntity.GUARDIAN,
        personId,
      );
      return;
    }

    if (normalized === ContactPersonType.STAFF) {
      await this.assertEntityAccess(
        currentUser,
        institutionId,
        CustomFieldEntity.STAFF_PROFILE,
        personId,
      );
      return;
    }

    throw new BadRequestException(
      `Contacts custom fields are not supported for person type "${personType}" yet.`,
    );
  }

  private toDefinitionSnapshot(definition: {
    id: string;
    moduleKey: string;
    entityType: string;
    fieldKey: string;
    label: string;
    inputType: string;
    isRequired: boolean;
    isActive: boolean;
    sortOrder: number;
  }) {
    return {
      id: definition.id,
      moduleKey: definition.moduleKey,
      entityType: definition.entityType,
      fieldKey: definition.fieldKey,
      label: definition.label,
      inputType: definition.inputType,
      isRequired: definition.isRequired,
      isActive: definition.isActive,
      sortOrder: definition.sortOrder,
    };
  }

  private assertDefinitionRules(
    inputType: CustomFieldInputType,
    options?: { label: string; value: string }[],
  ) {
    const optionBasedTypes = new Set<CustomFieldInputType>([
      CustomFieldInputType.SELECT,
      CustomFieldInputType.MULTI_SELECT,
      CustomFieldInputType.CHECKBOX,
      CustomFieldInputType.RADIO,
    ]);

    if (optionBasedTypes.has(inputType) && (!options || options.length === 0)) {
      throw new BadRequestException(
        `${inputType} fields require at least one option.`,
      );
    }
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private toJsonOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) {
      return undefined;
    }

    return value as Prisma.InputJsonValue;
  }
}
