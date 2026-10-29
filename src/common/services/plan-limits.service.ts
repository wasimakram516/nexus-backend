import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DEFAULT_PLAN_KEY,
  getPlanBlueprint,
  PlanLimits,
} from '../constants/plan.constants';

export type PlanLimitKey = keyof PlanLimits;

/** What each limit counts, for the message when it is reached. */
const NOUNS: Record<PlanLimitKey, string> = {
  maxCampuses: 'Campus',
  maxStudents: 'Student',
  maxStaff: 'Staff',
};

/**
 * What a limit says in one place: a number, `null` for no limit, or nothing at
 * all when the place does not mention it. A value may sit directly or under a
 * `limits` object, which is how subscription notes and settings are written.
 */
function readLimit(
  value: Prisma.JsonValue | null | undefined,
  key: PlanLimitKey,
): number | null | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, Prisma.JsonValue>;
  const direct = record[key];
  if (direct === null) return null;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;

  const nested = record.limits;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return undefined;
  }
  const inner = (nested as Record<string, Prisma.JsonValue>)[key];
  if (inner === null) return null;
  if (typeof inner === 'number' && Number.isFinite(inner)) return inner;
  return undefined;
}

/**
 * How many campuses, students and staff an institution may have. The first
 * place that names a limit wins: the institution's own override, then its
 * subscription notes, then its plan, then the plan's built-in default. No
 * limit anywhere means unlimited.
 */
@Injectable()
export class PlanLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param {string} institutionId - The institution.
   * @param {PlanLimitKey} key - Which limit.
   * @returns {Promise<number | null>} The limit, or null for unlimited.
   */
  async limitFor(
    institutionId: string,
    key: PlanLimitKey,
  ): Promise<number | null> {
    const subscription = await this.liveSubscription(institutionId);
    return this.pick(
      await this.overrideValue(institutionId),
      subscription?.metadata,
      subscription?.plan ?? null,
      key,
    );
  }

  /**
   * What the limit would be if the institution were on another plan. The
   * institution's own override and its subscription notes still win, exactly as
   * they do today, so only the plan's part of the answer changes.
   *
   * @param {string} institutionId - The institution.
   * @param {{key: string, limits: Prisma.JsonValue}} plan - The plan being considered.
   * @param {PlanLimitKey} key - Which limit.
   * @returns {Promise<number | null>} The limit under that plan, or null for unlimited.
   */
  async limitUnderPlan(
    institutionId: string,
    plan: { key: string; limits: Prisma.JsonValue },
    key: PlanLimitKey,
  ): Promise<number | null> {
    const subscription = await this.liveSubscription(institutionId);
    return this.pick(
      await this.overrideValue(institutionId),
      subscription?.metadata,
      plan,
      key,
    );
  }

  /**
   * How many the institution has now, counted the same way the limit is enforced.
   *
   * @param {string} institutionId - The institution.
   * @param {PlanLimitKey} key - Which limit.
   * @returns {Promise<number>} The number in use.
   */
  async currentCount(
    institutionId: string,
    key: PlanLimitKey,
  ): Promise<number> {
    switch (key) {
      case 'maxCampuses':
        return this.prisma.campus.count({
          where: { institutionId, deletedAt: null },
        });
      case 'maxStudents':
        return this.prisma.student.count({
          where: { institutionId, deletedAt: null },
        });
      case 'maxStaff':
        return this.prisma.staffProfile.count({
          where: { deletedAt: null, campus: { institutionId } },
        });
    }
  }

  private liveSubscription(institutionId: string) {
    return this.prisma.institutionSubscription.findFirst({
      where: {
        institutionId,
        status: {
          in: [
            SubscriptionStatus.TRIAL,
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PAST_DUE,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      include: { plan: { select: { key: true, limits: true } } },
    });
  }

  private async overrideValue(institutionId: string) {
    const setting = await this.prisma.institutionSetting.findUnique({
      where: {
        institutionId_key_activeScopeKey: {
          institutionId,
          key: 'limits',
          activeScopeKey: 'ACTIVE',
        },
      },
      select: { value: true },
    });
    return setting?.value;
  }

  /**
   * The first place that names a number wins; a place that says null (or
   * nothing) defers to the next, and no number anywhere means unlimited.
   */
  private pick(
    override: Prisma.JsonValue | null | undefined,
    metadata: Prisma.JsonValue | null | undefined,
    plan: { key: string; limits: Prisma.JsonValue } | null,
    key: PlanLimitKey,
  ): number | null {
    return (
      readLimit(override, key) ??
      readLimit(metadata, key) ??
      readLimit(plan?.limits, key) ??
      getPlanBlueprint(plan?.key ?? DEFAULT_PLAN_KEY)?.limits[key] ??
      null
    );
  }

  /**
   * Refuses when one more would go over the limit.
   *
   * @param {string} institutionId - The institution.
   * @param {PlanLimitKey} key - Which limit.
   * @param {() => Promise<number>} [countNow] - How many there are now, asked only when a limit applies; defaults to the standard count.
   * @throws {ForbiddenException} If the institution is already at its limit.
   */
  async assertRoomForOne(
    institutionId: string,
    key: PlanLimitKey,
    countNow: () => Promise<number> = () =>
      this.currentCount(institutionId, key),
  ): Promise<void> {
    const limit = await this.limitFor(institutionId, key);
    if (limit === null) return;
    if ((await countNow()) >= limit) {
      throw new ForbiddenException(
        `${NOUNS[key]} limit reached for this institution. Current limit: ${limit}. Ask Nexus support to raise it.`,
      );
    }
  }
}
