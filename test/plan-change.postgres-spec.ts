import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { PlanLimitsService } from '../src/common/services/plan-limits.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { TimezoneResolverService } from '../src/common/services/timezone-resolver.service';
import { PlanChangeService } from '../src/modules/platform/plan-change.service';
import { PlatformService } from '../src/modules/platform/platform.service';
import { ModuleKey } from '../src/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-database proof of moving a school between plans: the modules switch on
 * and off in the database, a school that does not fit the smaller plan is
 * refused with nothing changed, and the plan guard on the plain subscription
 * edit holds. Run via `npm run test:postgres`.
 */
describe('PostgreSQL plan change', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let platform: PlatformService;
  let planChange: PlanChangeService;
  let starterId: string;
  let growthId: string;

  const newSchool = async (planId: string, campuses: number) => {
    const created = await platform.createInstitution({
      name: 'Plan change test',
      slug: `plans-${randomUUID().slice(0, 8)}`,
      planId,
    });
    for (let index = 0; index < campuses; index += 1) {
      await prisma.campus.create({
        data: {
          institutionId: created.data.id,
          name: `Campus ${index + 1}`,
          location: 'Test',
          studentStartTime: '08:00',
          studentEndTime: '14:00',
          staffStartTime: '08:00',
          staffEndTime: '14:00',
          lateThreshold: 10,
          earlyLeaveThreshold: 10,
        },
      });
    }
    return created.data.id;
  };

  const enabledModules = async (institutionId: string) =>
    (
      await prisma.institutionEntitlement.findMany({
        where: { institutionId, isEnabled: true },
        select: { moduleKey: true },
      })
    )
      .map((row) => row.moduleKey)
      .sort();

  beforeAll(async () => {
    const connection = process.env.TEST_DATABASE_URL;
    if (!connection) throw new Error('TEST_DATABASE_URL is required');
    const url = new URL(connection);
    if (
      url.hostname !== '127.0.0.1' ||
      !/^\/nexus_audit_test(?:_[a-z0-9]+)?$/.test(url.pathname)
    )
      throw new Error('Use an isolated loopback nexus_audit_test database');
    process.env.DATABASE_URL = connection;
    prisma = new PrismaService(context);
    platform = new PlatformService(
      prisma,
      {} as ModuleAccessService,
      context,
      { get: () => undefined } as unknown as ConfigService,
      new TimezoneResolverService(prisma),
    );
    planChange = new PlanChangeService(
      prisma,
      new PlanLimitsService(prisma),
      context,
    );
    const plans = (await platform.listPlans()).data;
    starterId = plans.find((plan) => plan.key === 'starter')!.id;
    growthId = plans.find((plan) => plan.key === 'growth')!.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('upgrades a school, switching on the modules the bigger plan adds', async () => {
    const institutionId = await newSchool(starterId, 1);
    expect(await enabledModules(institutionId)).not.toContain(
      ModuleKey.REPORTING,
    );

    const preview = await planChange.preview(institutionId, growthId);
    expect(preview.direction).toBe('UPGRADE');
    expect(preview.modules.enable).toEqual([ModuleKey.REPORTING]);
    expect(preview.canApply).toBe(true);

    await planChange.apply(institutionId, { planId: growthId });

    expect(await enabledModules(institutionId)).toContain(ModuleKey.REPORTING);
    const subscription = await prisma.institutionSubscription.findFirstOrThrow({
      where: { institutionId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    expect(subscription.plan?.key).toBe('growth');
    expect(Number(subscription.agreedPrice)).toBe(35000);
    expect(subscription.metadata).toMatchObject({
      planKey: 'growth',
      previousPlanKey: 'starter',
    });
  });

  it('downgrades a school that fits, switching off the modules the smaller plan lacks', async () => {
    const institutionId = await newSchool(growthId, 1);
    expect(await enabledModules(institutionId)).toContain(ModuleKey.REPORTING);

    await planChange.apply(institutionId, { planId: starterId });

    expect(await enabledModules(institutionId)).not.toContain(
      ModuleKey.REPORTING,
    );
    // The row is kept, only switched off.
    const row = await prisma.institutionEntitlement.findFirstOrThrow({
      where: { institutionId, moduleKey: ModuleKey.REPORTING },
    });
    expect(row.isEnabled).toBe(false);
  });

  it('refuses a downgrade when the school has more campuses than the smaller plan allows, and changes nothing', async () => {
    const institutionId = await newSchool(growthId, 2);
    const before = await enabledModules(institutionId);

    const preview = await planChange.preview(institutionId, starterId);
    expect(preview.canApply).toBe(false);
    expect(preview.blockers[0]).toContain('2 campuses');
    expect(preview.blockers[0]).toContain('Starter plan allows 1');

    await expect(
      planChange.apply(institutionId, { planId: starterId }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await enabledModules(institutionId)).toEqual(before);
    const subscription = await prisma.institutionSubscription.findFirstOrThrow({
      where: { institutionId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    expect(subscription.plan?.key).toBe('growth');
  });

  it('lets a school’s own limit setting stand in for the plan limit', async () => {
    const institutionId = await newSchool(growthId, 2);
    await prisma.institutionSetting.create({
      data: { institutionId, key: 'limits', value: { maxCampuses: 2 } },
    });

    const preview = await planChange.preview(institutionId, starterId);

    expect(
      preview.limits.find((row) => row.key === 'maxCampuses'),
    ).toMatchObject({ current: 2, allowed: 2, ok: true });
    expect(preview.canApply).toBe(true);
  });

  it('refuses to change the plan through the plain subscription edit, and still allows other edits', async () => {
    const institutionId = await newSchool(starterId, 1);

    await expect(
      platform.updateSubscription(institutionId, { planId: growthId }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      platform.updateSubscription(institutionId, {
        planId: starterId,
        autoRenew: true,
      }),
    ).resolves.toMatchObject({ data: { autoRenew: true } });
  });
});
