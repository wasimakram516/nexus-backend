import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  ModuleKey,
  Prisma,
  SubscriptionStatus,
  UserRole,
} from '../../prisma/client';
import { CurrentUser } from '../interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';

type RuntimeConfigRecord = {
  institutionId: string;
  branding: Record<string, unknown> | null;
  settings: Record<string, unknown>;
  modules: Record<
    string,
    { enabled: boolean; configuration: Record<string, unknown> }
  >;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    planId: string | null;
    planKey: string | null;
    planName: string | null;
    autoRenew: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
  } | null;
  /** Active trials get every module unlocked so prospects see the full product. */
  trialFullAccess: boolean;
};

@Injectable()
export class ModuleAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertModuleEnabledForUser(
    currentUser: CurrentUser,
    moduleKey: ModuleKey,
  ) {
    if (currentUser.role === UserRole.SUPERADMIN) {
      return;
    }

    if (!currentUser.institutionId) {
      throw new ForbiddenException(
        'Your account is not linked to an institution.',
      );
    }

    const runtimeConfig = await this.getInstitutionRuntimeConfig(
      currentUser.institutionId,
    );

    if (
      runtimeConfig.subscription &&
      (runtimeConfig.subscription.status === SubscriptionStatus.SUSPENDED ||
        runtimeConfig.subscription.status === SubscriptionStatus.CANCELLED)
    ) {
      throw new ForbiddenException(
        'This institution subscription is not active for module access.',
      );
    }

    // Legacy TRIAL rows without endsAt never expire.
    if (
      runtimeConfig.subscription &&
      runtimeConfig.subscription.status === SubscriptionStatus.TRIAL &&
      runtimeConfig.subscription.endsAt &&
      runtimeConfig.subscription.endsAt.getTime() < Date.now()
    ) {
      throw new ForbiddenException(
        'This institution trial has expired. Contact Nexus support to activate your subscription.',
      );
    }

    const moduleState = runtimeConfig.modules[moduleKey];
    if (!moduleState?.enabled) {
      throw new ForbiddenException(
        `${moduleKey.toLowerCase()} is not enabled for this institution.`,
      );
    }
  }

  async getInstitutionRuntimeConfig(
    institutionId: string,
  ): Promise<RuntimeConfigRecord> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      include: {
        branding: true,
        settings: true,
        entitlements: true,
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            plan: true,
          },
        },
      },
    });

    if (!institution) {
      throw new ForbiddenException('Institution not found.');
    }

    const subscription = institution.subscriptions[0] ?? null;
    const defaultModules = this.readModuleKeys(
      subscription?.plan?.defaultModules ?? [],
    );
    const modules: RuntimeConfigRecord['modules'] = {};

    for (const moduleKey of Object.values(ModuleKey)) {
      modules[moduleKey] = {
        enabled: defaultModules.includes(moduleKey),
        configuration: {},
      };
    }

    for (const entitlement of institution.entitlements) {
      modules[entitlement.moduleKey] = {
        enabled: entitlement.isEnabled,
        configuration: this.readObject(entitlement.configuration),
      };
    }

    // Active (non-expired) trials unlock every module so prospects experience
    // the full product. Converting to a paid status automatically reverts
    // access to the stored entitlements — no cleanup needed.
    const trialFullAccess =
      subscription?.status === SubscriptionStatus.TRIAL &&
      (!subscription.endsAt || subscription.endsAt.getTime() > Date.now());

    if (trialFullAccess) {
      for (const moduleKey of Object.values(ModuleKey)) {
        modules[moduleKey] = {
          enabled: true,
          configuration: modules[moduleKey]?.configuration ?? {},
        };
      }
    }

    const settings = institution.settings.reduce<Record<string, unknown>>(
      (acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
      },
      {},
    );

    return {
      institutionId: institution.id,
      branding: institution.branding
        ? {
            displayName: institution.branding.displayName,
            logoUrl: institution.branding.logoUrl,
            primaryColor: institution.branding.primaryColor,
            secondaryColor: institution.branding.secondaryColor,
            accentColor: institution.branding.accentColor,
            theme: institution.branding.theme,
          }
        : null,
      settings,
      modules,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            planId: subscription.planId,
            planKey: subscription.plan?.key ?? null,
            planName: subscription.plan?.name ?? null,
            autoRenew: subscription.autoRenew,
            startsAt: subscription.startsAt ?? null,
            endsAt: subscription.endsAt ?? null,
          }
        : null,
      trialFullAccess,
    };
  }

  private readModuleKeys(value: Prisma.JsonValue): ModuleKey[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (item): item is ModuleKey =>
        typeof item === 'string' &&
        Object.values(ModuleKey).some((moduleKey) => moduleKey === item),
    );
  }

  private readObject(
    value: Prisma.JsonValue | null | undefined,
  ): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return { ...value };
  }
}
