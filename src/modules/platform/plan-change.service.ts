import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PLAN_BLUEPRINTS } from '../../common/constants/plan.constants';
import { RequestContextService } from '../../common/services/request-context.service';
import {
  PlanLimitKey,
  PlanLimitsService,
} from '../../common/services/plan-limits.service';
import {
  readDeploymentModes,
  readModuleKeys,
  readPrice,
} from '../../common/utils/plan-definition.util';
import { runAuditedTransaction } from '../../common/utils/transaction.util';
import { ModuleKey, Prisma, SubscriptionStatus } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChangePlanDto } from './dto/platform.dto';

export type PlanChangeDirection = 'UPGRADE' | 'DOWNGRADE' | 'SAME' | 'CHANGE';

export interface PlanChangeLimitRow {
  key: PlanLimitKey;
  label: string;
  /** How many the school has now. */
  current: number;
  /** What the new plan allows; null means no limit. */
  allowed: number | null;
  ok: boolean;
}

export interface PlanChangePreview {
  currentPlan: { id: string; key: string; name: string } | null;
  targetPlan: { id: string; key: string; name: string };
  direction: PlanChangeDirection;
  modules: {
    enable: ModuleKey[];
    disable: ModuleKey[];
    unchanged: ModuleKey[];
  };
  limits: PlanChangeLimitRow[];
  price: { currency: string; current: number | null; next: number | null };
  /** Reasons the change cannot be made; empty when it can. */
  blockers: string[];
  canApply: boolean;
}

const LIMITS: { key: PlanLimitKey; label: string }[] = [
  { key: 'maxCampuses', label: 'campuses' },
  { key: 'maxStudents', label: 'students' },
  { key: 'maxStaff', label: 'staff members' },
];

/**
 * Moving a school from one plan to another. It first works out what would
 * change (modules switched on and off, limits against what the school already
 * has, the price) and refuses when the school would not fit the new plan; only
 * then does it change the subscription and the modules together.
 */
@Injectable()
export class PlanChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitsService,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * What moving the institution to a plan would do, without doing it.
   *
   * @param {string} institutionId - The institution.
   * @param {string} planId - The plan to consider.
   * @returns {Promise<PlanChangePreview>} The changes, and any reason it cannot be made.
   * @throws {NotFoundException} If the institution or plan does not exist.
   * @throws {BadRequestException} If the institution has no subscription yet.
   */
  async preview(
    institutionId: string,
    planId: string,
  ): Promise<PlanChangePreview> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true, deploymentMode: true },
    });
    if (!institution) throw new NotFoundException('Institution not found.');
    const target = await this.prisma.planDefinition.findUnique({
      where: { id: planId },
    });
    if (!target) throw new NotFoundException('Plan not found.');
    const subscription = await this.prisma.institutionSubscription.findFirst({
      where: { institutionId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    if (!subscription) {
      throw new BadRequestException(
        'This institution has no subscription yet. Assign a plan from the subscription editor first.',
      );
    }
    const current = subscription.plan;
    const blockers: string[] = [];

    if (subscription.status === SubscriptionStatus.CANCELLED) {
      blockers.push(
        'The subscription is cancelled. Reactivate it before changing the plan.',
      );
    }
    if (current && current.id === target.id) {
      blockers.push(`The institution is already on the ${target.name} plan.`);
    }
    if (!target.isActive) {
      blockers.push(`The ${target.name} plan is no longer offered.`);
    }
    if (
      !readDeploymentModes(target.deploymentModes).includes(
        institution.deploymentMode,
      )
    ) {
      blockers.push(
        `The ${target.name} plan is not available for ${institution.deploymentMode.replace(/_/g, ' ').toLowerCase()} institutions.`,
      );
    }

    const modules = await this.moduleChanges(
      institutionId,
      readModuleKeys(target.defaultModules),
    );
    const limits = await this.limitChecks(institutionId, target);
    for (const row of limits.filter((item) => !item.ok)) {
      blockers.push(
        `The institution has ${row.current} ${row.label}, and the ${target.name} plan allows ${row.allowed}. Remove some, or set a limit for this school under Settings, before moving to this plan.`,
      );
    }

    return {
      currentPlan: current
        ? { id: current.id, key: current.key, name: current.name }
        : null,
      targetPlan: { id: target.id, key: target.key, name: target.name },
      direction: directionOf(current, target),
      modules,
      limits,
      price: {
        currency: target.currency,
        current: readPrice(subscription.agreedPrice),
        next: readPrice(target.basePrice),
      },
      blockers,
      canApply: blockers.length === 0,
    };
  }

  /**
   * Moves the institution to the plan: the subscription takes the plan's
   * billing terms, modules the plan includes are switched on and modules it
   * does not include are switched off.
   *
   * @param {string} institutionId - The institution.
   * @param {ChangePlanDto} dto - The plan, and the agreed price from now on if it differs from the plan's.
   * @returns {Promise<{message: string, data: object}>} The updated subscription and what changed.
   * @throws {ConflictException} If the school would not fit the plan or the change is otherwise not allowed.
   */
  async apply(institutionId: string, dto: ChangePlanDto) {
    const preview = await this.preview(institutionId, dto.planId);
    if (!preview.canApply) {
      throw new ConflictException(
        `This plan change cannot be made. ${preview.blockers.join(' ')}`,
      );
    }
    const target = await this.prisma.planDefinition.findUniqueOrThrow({
      where: { id: dto.planId },
    });

    // Audited automatically by PrismaService, so the subscription and each
    // module that was switched have their own before and after record.
    const subscription = await runAuditedTransaction(
      this.prisma,
      this.requestContext,
      async (tx: Prisma.TransactionClient) => {
        const latest = await tx.institutionSubscription.findFirstOrThrow({
          where: { institutionId },
          orderBy: { createdAt: 'desc' },
        });
        const notes =
          latest.metadata &&
          typeof latest.metadata === 'object' &&
          !Array.isArray(latest.metadata)
            ? latest.metadata
            : {};
        const updated = await tx.institutionSubscription.update({
          where: { id: latest.id },
          data: {
            planId: target.id,
            agreedPrice: dto.agreedPrice ?? preview.price.next ?? undefined,
            currency: target.currency,
            billingCycle: target.billingCycle,
            metadata: {
              ...notes,
              planKey: target.key,
              previousPlanKey: preview.currentPlan?.key ?? null,
              planChangedAt: new Date().toISOString(),
            },
          },
        });
        for (const [moduleKeys, isEnabled] of [
          [preview.modules.enable, true],
          [preview.modules.disable, false],
        ] as const) {
          for (const moduleKey of moduleKeys) {
            await tx.institutionEntitlement.upsert({
              where: {
                institutionId_moduleKey_activeScopeKey: {
                  institutionId,
                  moduleKey,
                  activeScopeKey: 'ACTIVE',
                },
              },
              update: { isEnabled },
              create: {
                institutionId,
                moduleKey,
                isEnabled,
                configuration: {},
              },
            });
          }
        }
        return updated;
      },
    );

    return {
      message: `Plan changed to ${target.name}`,
      data: { subscription, changes: preview },
    };
  }

  /** Which modules the new plan switches on, switches off, and leaves as they are. */
  private async moduleChanges(
    institutionId: string,
    planModules: ModuleKey[],
  ): Promise<PlanChangePreview['modules']> {
    const rows = await this.prisma.institutionEntitlement.findMany({
      where: { institutionId, deletedAt: null },
      select: { moduleKey: true, isEnabled: true },
    });
    const on = new Set(
      rows.filter((row) => row.isEnabled).map((row) => row.moduleKey),
    );
    const wanted = new Set(planModules);
    return {
      enable: planModules.filter((moduleKey) => !on.has(moduleKey)),
      disable: [...on].filter((moduleKey) => !wanted.has(moduleKey)),
      unchanged: planModules.filter((moduleKey) => on.has(moduleKey)),
    };
  }

  /** What the school has now against what the new plan allows, for each limit. */
  private async limitChecks(
    institutionId: string,
    target: { key: string; limits: Prisma.JsonValue },
  ): Promise<PlanChangeLimitRow[]> {
    return Promise.all(
      LIMITS.map(async ({ key, label }) => {
        const [current, allowed] = await Promise.all([
          this.planLimits.currentCount(institutionId, key),
          this.planLimits.limitUnderPlan(institutionId, target, key),
        ]);
        return {
          key,
          label,
          current,
          allowed,
          ok: allowed === null || current <= allowed,
        };
      }),
    );
  }
}

/**
 * Whether the move goes up or down. The built-in plans have an order; any
 * other plan is compared by price, and plans with no price (arranged case by
 * case) rank highest.
 */
function directionOf(
  current: { id: string; key: string; basePrice: Prisma.Decimal | null } | null,
  target: { id: string; key: string; basePrice: Prisma.Decimal | null },
): PlanChangeDirection {
  if (!current) return 'CHANGE';
  if (current.id === target.id) return 'SAME';
  const order = (plan: { key: string }) =>
    PLAN_BLUEPRINTS.findIndex((blueprint) => blueprint.key === plan.key);
  const [from, to] = [order(current), order(target)];
  if (from >= 0 && to >= 0) return to > from ? 'UPGRADE' : 'DOWNGRADE';
  const price = (plan: { basePrice: Prisma.Decimal | null }) =>
    readPrice(plan.basePrice) ?? Number.POSITIVE_INFINITY;
  if (price(target) === price(current)) return 'CHANGE';
  return price(target) > price(current) ? 'UPGRADE' : 'DOWNGRADE';
}
