import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeploymentMode,
  ModuleKey,
  Prisma,
  SubscriptionStatus,
} from '../../prisma/client';
import {
  DEFAULT_PLAN_KEY,
  PLAN_BLUEPRINTS,
} from '../../common/constants/plan.constants';
import { BillingCycle } from '../../common/enums/domain.enums';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { generateUniqueSlug } from '../../common/utils/slug.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateInstitutionDto,
  CreatePermissionTemplateDto,
  CreatePlanDto,
  ListInstitutionsQueryDto,
  UpdatePermissionTemplateDto,
  UpdateBrandingDto,
  UpdateInstitutionDto,
  UpdatePlanDto,
  UpdateSubscriptionDto,
  UpsertEntitlementsDto,
  UpsertInstitutionSettingsDto,
} from './dto/platform.dto';

type PlanRecord = {
  id: string;
  institutionId: string | null;
  key: string;
  name: string;
  description: string | null;
  basePrice: Prisma.Decimal | number | string | null;
  currency: string;
  billingCycle: BillingCycle;
  setupFee: Prisma.Decimal | number | string | null;
  deploymentModes: Prisma.JsonValue;
  defaultModules: Prisma.JsonValue;
  limits: Prisma.JsonValue;
  metadata: Prisma.JsonValue | null;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly requestContext: RequestContextService,
  ) {}

  async listPlans() {
    const plans = await this.syncBootstrapPlans();

    return {
      message: 'Platform plans retrieved successfully',
      data: plans,
    };
  }

  async createPlan(dto: CreatePlanDto, currentUser: CurrentUser) {
    try {
      const plan = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const data: Prisma.PlanDefinitionUncheckedCreateInput = {
            key: dto.key.toLowerCase(),
            name: dto.name,
            description: dto.description,
            basePrice: dto.basePrice ?? null,
            currency: dto.currency ?? 'PKR',
            billingCycle: dto.billingCycle ?? BillingCycle.MONTHLY,
            setupFee: dto.setupFee ?? null,
            deploymentModes: this.toJson(dto.deploymentModes),
            defaultModules: this.toJson(dto.defaultModules),
            limits: this.toJson(dto.limits),
            metadata: dto.metadata ? this.toJson(dto.metadata) : undefined,
            isActive: dto.isActive ?? true,
          };
          const created = await tx.planDefinition.create({
            data,
          });

          await tx.auditLog.create({
            data: {
              userId: currentUser.sub,
              action: 'PLAN_CREATED',
              entity: 'PlanDefinition',
              entityId: created.id,
              metadata: this.toJson({
                key: created.key,
                name: created.name,
              }),
            },
          });

          return created;
        },
      );

      return {
        message: 'Plan created successfully',
        data: plan,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('A plan with this key already exists.');
        }
      }
      throw error;
    }
  }

  async updatePlan(
    planId: string,
    dto: UpdatePlanDto,
    currentUser: CurrentUser,
  ) {
    await this.syncBootstrapPlans();
    await this.ensurePlanExists(planId);

    try {
      const plan = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const data: Prisma.PlanDefinitionUncheckedUpdateInput = {
            key: dto.key?.toLowerCase(),
            name: dto.name,
            description: dto.description,
            basePrice: dto.basePrice,
            currency: dto.currency,
            billingCycle: dto.billingCycle,
            setupFee: dto.setupFee,
            deploymentModes: dto.deploymentModes
              ? this.toJson(dto.deploymentModes)
              : undefined,
            defaultModules: dto.defaultModules
              ? this.toJson(dto.defaultModules)
              : undefined,
            limits: dto.limits ? this.toJson(dto.limits) : undefined,
            metadata: dto.metadata ? this.toJson(dto.metadata) : undefined,
            isActive: dto.isActive,
          };
          const updated = await tx.planDefinition.update({
            where: { id: planId },
            data,
          });

          await tx.auditLog.create({
            data: {
              userId: currentUser.sub,
              action: 'PLAN_UPDATED',
              entity: 'PlanDefinition',
              entityId: updated.id,
              metadata: this.toJson({
                key: updated.key,
                updatedFields: Object.keys(dto),
              }),
            },
          });

          return updated;
        },
      );

      return {
        message: 'Plan updated successfully',
        data: plan,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('A plan with this key already exists.');
        }
      }
      throw error;
    }
  }

  async createInstitution(dto: CreateInstitutionDto, currentUser: CurrentUser) {
    const plans = await this.syncBootstrapPlans();
    const plan = await this.resolvePlan(dto.planId, plans);
    const deploymentModes = this.readDeploymentModes(plan.deploymentModes);
    const defaultModules = this.readModuleKeys(plan.defaultModules);
    const deploymentMode = dto.deploymentMode ?? deploymentModes[0];
    const uniqueSlug = await generateUniqueSlug(
      dto.slug,
      async (candidate) => {
        const institution = await this.prisma.institution.findFirst({
          where: {
            slug: candidate,
          },
          select: { id: true },
        });

        return Boolean(institution);
      },
      'institution',
    );

    if (!deploymentModes.includes(deploymentMode)) {
      throw new ConflictException(
        `${deploymentMode} is not supported for the ${plan.name} plan.`,
      );
    }

    const subscriptionCreate: Prisma.InstitutionSubscriptionUncheckedCreateWithoutInstitutionInput =
      {
        planId: plan.id,
        agreedPrice: this.readPrice(plan.basePrice),
        currency: plan.currency,
        billingCycle: plan.billingCycle,
        setupFee: this.readPrice(plan.setupFee),
        status: SubscriptionStatus.TRIAL,
        autoRenew: false,
        metadata: this.toJson({
          source: 'platform-bootstrap',
          planKey: plan.key,
        }),
      };

    try {
      const institution = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const createdInstitution = await tx.institution.create({
            data: {
              name: dto.name,
              slug: uniqueSlug,
              status: dto.status,
              deploymentMode,
              primaryDomain: dto.primaryDomain,
              contactEmail: dto.contactEmail,
              contactPhone: dto.contactPhone,
              notes: dto.notes,
              branding: {
                create: {
                  displayName: dto.name,
                  theme: 'default',
                },
              },
              subscriptions: {
                create: subscriptionCreate,
              },
              entitlements: {
                create: defaultModules.map((moduleKey) => ({
                  moduleKey,
                  isEnabled: true,
                  configuration: this.toJson({}),
                })),
              },
            },
            include: this.institutionInclude,
          });

          await tx.auditLog.create({
            data: {
              userId: currentUser.sub,
              institutionId: createdInstitution.id,
              action: 'INSTITUTION_CREATED',
              entity: 'Institution',
              entityId: createdInstitution.id,
              metadata: this.toJson({
                slug: createdInstitution.slug,
                planId: plan.id,
                planKey: plan.key,
                deploymentMode,
              }),
            },
          });

          return createdInstitution;
        },
      );

      return {
        message: 'Institution created successfully',
        data: institution,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Institution slug already exists.');
        }
      }
      throw error;
    }
  }

  async listInstitutions(query: ListInstitutionsQueryDto) {
    const items = await this.prisma.institution.findMany({
      where: {
        status: query.status,
        subscriptions: query.planId
          ? {
              some: {
                planId: query.planId,
              },
            }
          : undefined,
      },
      include: this.institutionInclude,
      orderBy: { createdAt: 'desc' },
    });

    return {
      message: 'Institutions retrieved successfully',
      data: items,
    };
  }

  async getInstitution(institutionId: string) {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      include: this.institutionInclude,
    });

    if (!institution) {
      throw new NotFoundException('Institution not found.');
    }

    return {
      message: 'Institution retrieved successfully',
      data: institution,
    };
  }

  async getInstitutionRuntimeConfig(institutionId: string) {
    const data =
      await this.moduleAccessService.getInstitutionRuntimeConfig(institutionId);

    return {
      message: 'Institution runtime configuration retrieved successfully',
      data,
    };
  }

  async updateInstitution(
    institutionId: string,
    dto: UpdateInstitutionDto,
    currentUser: CurrentUser,
  ) {
    await this.ensureInstitutionExists(institutionId);

    const institution = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const updated = await tx.institution.update({
          where: { id: institutionId },
          data: dto,
          include: this.institutionInclude,
        });

        await tx.auditLog.create({
          data: {
            userId: currentUser.sub,
            institutionId,
            action: 'INSTITUTION_UPDATED',
            entity: 'Institution',
            entityId: institutionId,
            metadata: this.toJson({
              ...dto,
            }),
          },
        });

        return updated;
      },
    );

    return {
      message: 'Institution updated successfully',
      data: institution,
    };
  }

  async updateBranding(
    institutionId: string,
    dto: UpdateBrandingDto,
    currentUser: CurrentUser,
  ) {
    await this.ensureInstitutionExists(institutionId);

    const branding = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const deletedBranding = await tx.institutionBranding.findFirst({
          where: {
            institutionId,
            deletedAt: { not: null },
          },
          select: { id: true },
        });

        const updated = deletedBranding
          ? await tx.institutionBranding.update({
              where: { id: deletedBranding.id },
              data: {
                ...dto,
                deletedAt: null,
                deletedBy: null,
                deleteReason: null,
              },
            })
          : await tx.institutionBranding.upsert({
              where: { institutionId },
              update: dto,
              create: {
                institutionId,
                ...dto,
              },
            });

        await tx.auditLog.create({
          data: {
            userId: currentUser.sub,
            institutionId,
            action: 'INSTITUTION_BRANDING_UPDATED',
            entity: 'InstitutionBranding',
            entityId: updated.id,
            metadata: this.toJson({
              ...dto,
            }),
          },
        });

        return updated;
      },
    );

    return {
      message: 'Institution branding updated successfully',
      data: branding,
    };
  }

  async upsertSettings(
    institutionId: string,
    dto: UpsertInstitutionSettingsDto,
    currentUser: CurrentUser,
  ) {
    await this.ensureInstitutionExists(institutionId);

    const settings = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const upserts = await Promise.all(
          dto.settings.map((setting) =>
            tx.institutionSetting.upsert({
              where: {
                institutionId_key_activeScopeKey: {
                  institutionId,
                  key: setting.key,
                  activeScopeKey: 'ACTIVE',
                },
              },
              update: {
                value: this.toJson(setting.value),
                description: setting.description,
              },
              create: {
                institutionId,
                key: setting.key,
                value: this.toJson(setting.value),
                description: setting.description,
              },
            }),
          ),
        );

        await tx.auditLog.create({
          data: {
            userId: currentUser.sub,
            institutionId,
            action: 'INSTITUTION_SETTINGS_UPDATED',
            entity: 'InstitutionSetting',
            entityId: institutionId,
            metadata: this.toJson({
              keys: dto.settings.map((setting) => setting.key),
            }),
          },
        });

        return upserts;
      },
    );

    return {
      message: 'Institution settings updated successfully',
      data: settings,
    };
  }

  async upsertEntitlements(
    institutionId: string,
    dto: UpsertEntitlementsDto,
    currentUser: CurrentUser,
  ) {
    await this.ensureInstitutionExists(institutionId);

    const entitlements = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const upserts = await Promise.all(
          dto.entitlements.map((entitlement) =>
            tx.institutionEntitlement.upsert({
              where: {
                institutionId_moduleKey_activeScopeKey: {
                  institutionId,
                  moduleKey: entitlement.moduleKey,
                  activeScopeKey: 'ACTIVE',
                },
              },
              update: {
                isEnabled: entitlement.isEnabled,
                configuration: this.toJson(entitlement.configuration ?? {}),
              },
              create: {
                institutionId,
                moduleKey: entitlement.moduleKey,
                isEnabled: entitlement.isEnabled,
                configuration: this.toJson(entitlement.configuration ?? {}),
              },
            }),
          ),
        );

        await tx.auditLog.create({
          data: {
            userId: currentUser.sub,
            institutionId,
            action: 'INSTITUTION_ENTITLEMENTS_UPDATED',
            entity: 'InstitutionEntitlement',
            entityId: institutionId,
            metadata: this.toJson({
              modules: dto.entitlements.map((entitlement) => ({
                moduleKey: entitlement.moduleKey,
                isEnabled: entitlement.isEnabled,
              })),
            }),
          },
        });

        return upserts;
      },
    );

    return {
      message: 'Institution entitlements updated successfully',
      data: entitlements,
    };
  }

  async updateSubscription(
    institutionId: string,
    dto: UpdateSubscriptionDto,
    currentUser: CurrentUser,
  ) {
    await this.ensureInstitutionExists(institutionId);
    const plans = await this.syncBootstrapPlans();
    const plan = await this.resolvePlan(dto.planId, plans);
    const defaultModules = this.readModuleKeys(plan.defaultModules);

    const subscription = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const activeSubscription = await tx.institutionSubscription.findFirst({
          where: { institutionId },
          orderBy: { createdAt: 'desc' },
        });

        const updated = activeSubscription
          ? await tx.institutionSubscription.update({
              where: { id: activeSubscription.id },
              data: {
                planId: plan.id,
                agreedPrice: dto.agreedPrice,
                currency: dto.currency,
                billingCycle: dto.billingCycle as never,
                setupFee: dto.setupFee,
                discountAmount: dto.discountAmount,
                pricingNotes: dto.pricingNotes,
                status: dto.status,
                autoRenew: dto.autoRenew,
                metadata: dto.metadata
                  ? this.toJson({
                      ...dto.metadata,
                      planKey: plan.key,
                    })
                  : undefined,
              } satisfies Prisma.InstitutionSubscriptionUncheckedUpdateInput,
            })
          : await tx.institutionSubscription.create({
              data: {
                institutionId,
                planId: plan.id,
                agreedPrice: dto.agreedPrice ?? this.readPrice(plan.basePrice),
                currency: dto.currency ?? plan.currency,
                billingCycle: (dto.billingCycle ?? plan.billingCycle) as never,
                setupFee: dto.setupFee ?? this.readPrice(plan.setupFee),
                discountAmount: dto.discountAmount,
                pricingNotes: dto.pricingNotes,
                status: dto.status ?? SubscriptionStatus.TRIAL,
                autoRenew: dto.autoRenew ?? false,
                metadata: this.toJson({
                  ...(dto.metadata ?? {}),
                  planKey: plan.key,
                }),
              } satisfies Prisma.InstitutionSubscriptionUncheckedCreateInput,
            });

        await Promise.all(
          defaultModules.map((moduleKey) =>
            tx.institutionEntitlement.upsert({
              where: {
                institutionId_moduleKey_activeScopeKey: {
                  institutionId,
                  moduleKey,
                  activeScopeKey: 'ACTIVE',
                },
              },
              update: {},
              create: {
                institutionId,
                moduleKey,
                isEnabled: true,
                configuration: this.toJson({}),
              },
            }),
          ),
        );

        await tx.auditLog.create({
          data: {
            userId: currentUser.sub,
            institutionId,
            action: 'INSTITUTION_SUBSCRIPTION_UPDATED',
            entity: 'InstitutionSubscription',
            entityId: updated.id,
            metadata: this.toJson({
              planId: plan.id,
              planKey: plan.key,
              status: dto.status ?? updated.status,
              autoRenew: dto.autoRenew ?? updated.autoRenew,
            }),
          },
        });

        return updated;
      },
    );

    return {
      message: 'Institution subscription updated successfully',
      data: subscription,
    };
  }

  async createPermissionTemplate(
    institutionId: string,
    dto: CreatePermissionTemplateDto,
    currentUser: CurrentUser,
  ) {
    await this.ensureInstitutionExists(institutionId);

    try {
      const template = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const created = await tx.permissionTemplate.create({
            data: {
              institutionId,
              name: dto.name,
              description: dto.description,
              permissions: this.toJson(dto.permissions),
            },
          });

          await tx.auditLog.create({
            data: {
              userId: currentUser.sub,
              institutionId,
              action: 'PERMISSION_TEMPLATE_CREATED',
              entity: 'PermissionTemplate',
              entityId: created.id,
              metadata: this.toJson({
                name: dto.name,
              }),
            },
          });

          return created;
        },
      );

      return {
        message: 'Permission template created successfully',
        data: template,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            'A permission template with this name already exists.',
          );
        }
      }
      throw error;
    }
  }

  async listPermissionTemplates(institutionId: string) {
    await this.ensureInstitutionExists(institutionId);

    const items = await this.prisma.permissionTemplate.findMany({
      where: { institutionId },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      message: 'Permission templates retrieved successfully',
      data: items,
    };
  }

  async getPermissionTemplate(institutionId: string, templateId: string) {
    await this.ensureInstitutionExists(institutionId);
    const template = await this.getPermissionTemplateOrThrow(
      institutionId,
      templateId,
    );

    return {
      message: 'Permission template retrieved successfully',
      data: template,
    };
  }

  async updatePermissionTemplate(
    institutionId: string,
    templateId: string,
    dto: UpdatePermissionTemplateDto,
    currentUser: CurrentUser,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.getPermissionTemplateOrThrow(institutionId, templateId);

    try {
      const template = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const updated = await tx.permissionTemplate.update({
            where: { id: templateId },
            data: {
              name: dto.name,
              description: dto.description,
              permissions: dto.permissions
                ? this.toJson(dto.permissions)
                : undefined,
            },
          });

          await tx.auditLog.create({
            data: {
              userId: currentUser.sub,
              institutionId,
              action: 'PERMISSION_TEMPLATE_UPDATED',
              entity: 'PermissionTemplate',
              entityId: updated.id,
              metadata: this.toJson({
                updatedFields: Object.keys(dto),
              }),
            },
          });

          return updated;
        },
      );

      return {
        message: 'Permission template updated successfully',
        data: template,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            'A permission template with this name already exists.',
          );
        }
      }
      throw error;
    }
  }

  async deletePermissionTemplate(
    institutionId: string,
    templateId: string,
    currentUser: CurrentUser,
    reason?: string,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.getPermissionTemplateOrThrow(institutionId, templateId);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await this.requestContext.runWith({ deleteReason: reason ?? null }, () =>
        tx.permissionTemplate.delete({
          where: { id: templateId },
        }),
      );

      await tx.auditLog.create({
        data: {
          userId: currentUser.sub,
          institutionId,
          action: 'PERMISSION_TEMPLATE_DELETED',
          entity: 'PermissionTemplate',
          entityId: templateId,
          metadata: this.toJson({ templateId, reason: reason ?? null }),
        },
      });
    });

    return {
      message: 'Permission template moved to recycle bin successfully',
      data: { id: templateId },
    };
  }

  private async syncBootstrapPlans() {
    const plans = await Promise.all(
      PLAN_BLUEPRINTS.map((plan) =>
        this.prisma.planDefinition.upsert({
          where: {
            key_activeScopeKey: {
              key: plan.key,
              activeScopeKey: 'ACTIVE',
            },
          },
          update: {},
          create: {
            key: plan.key,
            name: plan.name,
            description: plan.description,
            basePrice: plan.basePrice,
            currency: plan.currency,
            billingCycle: plan.billingCycle as never,
            setupFee: plan.setupFee,
            deploymentModes: this.toJson(plan.deploymentModes),
            defaultModules: this.toJson(plan.defaultModules),
            limits: this.toJson(plan.limits),
            metadata: this.toJson({
              source: 'bootstrap',
            }),
            isActive: true,
          },
        }),
      ),
    );

    return plans as PlanRecord[];
  }

  private async ensureInstitutionExists(institutionId: string) {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true },
    });

    if (!institution) {
      throw new NotFoundException('Institution not found.');
    }
  }

  private async ensurePlanExists(planId: string) {
    const plan = await this.prisma.planDefinition.findUnique({
      where: { id: planId },
      select: { id: true },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found.');
    }
  }

  private async getPermissionTemplateOrThrow(
    institutionId: string,
    templateId: string,
  ) {
    const template = await this.prisma.permissionTemplate.findFirst({
      where: {
        id: templateId,
        institutionId,
      },
    });

    if (!template) {
      throw new NotFoundException('Permission template not found.');
    }

    return template;
  }
  private async resolvePlan(planId?: string, plans?: PlanRecord[]) {
    if (planId) {
      const plan = (await this.prisma.planDefinition.findUnique({
        where: { id: planId },
      })) as PlanRecord | null;
      if (!plan) {
        throw new NotFoundException('Plan not found.');
      }
      return plan;
    }

    const availablePlans =
      plans ??
      ((await this.prisma.planDefinition.findMany({
        where: { isActive: true },
      })) as PlanRecord[]);

    const defaultPlan = availablePlans.find(
      (plan: PlanRecord) => plan.key === DEFAULT_PLAN_KEY,
    );
    if (!defaultPlan) {
      throw new NotFoundException('Default plan not found.');
    }

    return defaultPlan;
  }

  private readDeploymentModes(value: Prisma.JsonValue): DeploymentMode[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is DeploymentMode =>
      Object.values(DeploymentMode).includes(item as DeploymentMode),
    );
  }

  private readModuleKeys(value: Prisma.JsonValue): ModuleKey[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is ModuleKey =>
      Object.values(ModuleKey).includes(item as ModuleKey),
    );
  }

  private readPrice(
    value: Prisma.Decimal | Prisma.JsonValue | number | null | undefined,
  ) {
    if (value === null || value === undefined) {
      return null;
    }
    if (value instanceof Prisma.Decimal) {
      return value.toNumber();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private readonly institutionInclude = {
    branding: true,
    settings: true,
    entitlements: true,
    subscriptions: {
      orderBy: { createdAt: 'desc' as const },
      include: {
        plan: true,
      },
    },
    permissionTemplates: true,
  } satisfies Prisma.InstitutionInclude;
}
