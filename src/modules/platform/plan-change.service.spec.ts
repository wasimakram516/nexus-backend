/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers are typed any */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PlanLimitsService } from '../../common/services/plan-limits.service';
import { RequestContextService } from '../../common/services/request-context.service';
import {
  DeploymentMode,
  ModuleKey,
  Prisma,
  SubscriptionStatus,
} from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanChangeService } from './plan-change.service';

describe('PlanChangeService', () => {
  const plan = (
    key: string,
    modules: ModuleKey[],
    extra: Record<string, unknown> = {},
  ) => ({
    id: `plan-${key}`,
    key,
    name: key[0].toUpperCase() + key.slice(1),
    basePrice: new Prisma.Decimal(key === 'starter' ? 15000 : 35000),
    currency: 'PKR',
    billingCycle: 'MONTHLY',
    deploymentModes: [DeploymentMode.SHARED_HOSTED],
    defaultModules: modules,
    limits: {},
    isActive: true,
    ...extra,
  });
  const starter = plan('starter', [ModuleKey.ACADEMICS, ModuleKey.FINANCE]);
  const growth = plan('growth', [
    ModuleKey.ACADEMICS,
    ModuleKey.FINANCE,
    ModuleKey.REPORTING,
  ]);

  const txMock = {
    institutionSubscription: {
      findFirstOrThrow: jest.fn(),
      update: jest.fn(),
    },
    institutionEntitlement: { upsert: jest.fn() },
  };
  const prismaMock = {
    institution: { findUnique: jest.fn() },
    planDefinition: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    institutionSubscription: { findFirst: jest.fn() },
    institutionEntitlement: { findMany: jest.fn() },
    $transaction: jest.fn((callback: (tx: typeof txMock) => Promise<unknown>) =>
      callback(txMock),
    ),
  };
  const limitsMock = { currentCount: jest.fn(), limitUnderPlan: jest.fn() };
  const contextMock = {
    runWith: jest.fn((_: unknown, run: () => Promise<unknown>) => run()),
  };
  const service = new PlanChangeService(
    prismaMock as unknown as PrismaService,
    limitsMock as unknown as PlanLimitsService,
    contextMock as unknown as RequestContextService,
  );

  const enabled = (...keys: ModuleKey[]) =>
    keys.map((moduleKey) => ({ moduleKey, isEnabled: true }));

  beforeEach(() => {
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock),
    );
    contextMock.runWith.mockImplementation(
      (_: unknown, run: () => Promise<unknown>) => run(),
    );
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'inst-1',
      deploymentMode: DeploymentMode.SHARED_HOSTED,
    });
    prismaMock.planDefinition.findUnique.mockResolvedValue(growth);
    prismaMock.planDefinition.findUniqueOrThrow.mockResolvedValue(growth);
    prismaMock.institutionSubscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      status: SubscriptionStatus.ACTIVE,
      planId: starter.id,
      plan: starter,
      agreedPrice: new Prisma.Decimal(12000),
    });
    prismaMock.institutionEntitlement.findMany.mockResolvedValue(
      enabled(ModuleKey.ACADEMICS, ModuleKey.FINANCE),
    );
    limitsMock.currentCount.mockResolvedValue(1);
    limitsMock.limitUnderPlan.mockResolvedValue(3);
    txMock.institutionSubscription.findFirstOrThrow.mockResolvedValue({
      id: 'sub-1',
      metadata: { planKey: 'starter', maxStudents: 900 },
    });
    txMock.institutionSubscription.update.mockResolvedValue({ id: 'sub-1' });
    txMock.institutionEntitlement.upsert.mockResolvedValue({});
  });

  describe('preview', () => {
    it('says which modules an upgrade switches on, the price, and that nothing stops it', async () => {
      const preview = await service.preview('inst-1', growth.id);

      expect(preview.direction).toBe('UPGRADE');
      expect(preview.currentPlan?.name).toBe('Starter');
      expect(preview.targetPlan.name).toBe('Growth');
      expect(preview.modules).toEqual({
        enable: [ModuleKey.REPORTING],
        disable: [],
        unchanged: [ModuleKey.ACADEMICS, ModuleKey.FINANCE],
      });
      expect(preview.price).toEqual({
        currency: 'PKR',
        current: 12000,
        next: 35000,
      });
      expect(preview.blockers).toEqual([]);
      expect(preview.canApply).toBe(true);
    });

    it('lists the modules a downgrade switches off', async () => {
      prismaMock.planDefinition.findUnique.mockResolvedValue(starter);
      prismaMock.institutionSubscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionStatus.ACTIVE,
        planId: growth.id,
        plan: growth,
        agreedPrice: new Prisma.Decimal(35000),
      });
      prismaMock.institutionEntitlement.findMany.mockResolvedValue(
        enabled(ModuleKey.ACADEMICS, ModuleKey.FINANCE, ModuleKey.REPORTING),
      );

      const preview = await service.preview('inst-1', starter.id);

      expect(preview.direction).toBe('DOWNGRADE');
      expect(preview.modules.disable).toEqual([ModuleKey.REPORTING]);
      expect(preview.modules.enable).toEqual([]);
    });

    it('switches on a module the plan includes that the school has turned off', async () => {
      prismaMock.institutionEntitlement.findMany.mockResolvedValue([
        { moduleKey: ModuleKey.ACADEMICS, isEnabled: true },
        { moduleKey: ModuleKey.FINANCE, isEnabled: true },
        { moduleKey: ModuleKey.REPORTING, isEnabled: false },
      ]);

      const preview = await service.preview('inst-1', growth.id);

      expect(preview.modules.enable).toEqual([ModuleKey.REPORTING]);
    });

    it('blocks a downgrade when the school has more than the new plan allows, naming what and how many', async () => {
      limitsMock.currentCount.mockImplementation((_: string, key: string) =>
        Promise.resolve(key === 'maxCampuses' ? 3 : 10),
      );
      limitsMock.limitUnderPlan.mockImplementation(
        (_i: string, _p: unknown, key: string) =>
          Promise.resolve(key === 'maxCampuses' ? 1 : null),
      );

      const preview = await service.preview('inst-1', growth.id);

      expect(preview.canApply).toBe(false);
      expect(preview.limits.find((row) => row.key === 'maxCampuses')).toEqual({
        key: 'maxCampuses',
        label: 'campuses',
        current: 3,
        allowed: 1,
        ok: false,
      });
      expect(preview.blockers).toHaveLength(1);
      expect(preview.blockers[0]).toContain('3 campuses');
      expect(preview.blockers[0]).toContain('Growth plan allows 1');
    });

    it('allows a school that exactly fills the new limit, and any size when there is no limit', async () => {
      limitsMock.currentCount.mockResolvedValue(3);
      limitsMock.limitUnderPlan.mockImplementation(
        (_i: string, _p: unknown, key: string) =>
          Promise.resolve(key === 'maxCampuses' ? 3 : null),
      );

      const preview = await service.preview('inst-1', growth.id);

      expect(preview.limits.every((row) => row.ok)).toBe(true);
      expect(preview.canApply).toBe(true);
    });

    it('asks for the limits under the plan being considered', async () => {
      await service.preview('inst-1', growth.id);

      expect(limitsMock.limitUnderPlan).toHaveBeenCalledWith(
        'inst-1',
        growth,
        'maxStudents',
      );
    });

    it.each([
      [
        'a plan the school is already on',
        () => prismaMock.planDefinition.findUnique.mockResolvedValue(starter),
        'already on the Starter plan',
      ],
      [
        'a plan that is no longer offered',
        () =>
          prismaMock.planDefinition.findUnique.mockResolvedValue({
            ...growth,
            isActive: false,
          }),
        'no longer offered',
      ],
      [
        'a plan that does not suit the way the school is hosted',
        () =>
          prismaMock.institution.findUnique.mockResolvedValue({
            id: 'inst-1',
            deploymentMode: DeploymentMode.DEDICATED_HOSTED,
          }),
        'not available for dedicated hosted institutions',
      ],
      [
        'a cancelled subscription',
        () =>
          prismaMock.institutionSubscription.findFirst.mockResolvedValue({
            id: 'sub-1',
            status: SubscriptionStatus.CANCELLED,
            planId: starter.id,
            plan: starter,
            agreedPrice: null,
          }),
        'Reactivate it',
      ],
    ])('refuses %s', async (_name, arrange, reason) => {
      arrange();

      const preview = await service.preview('inst-1', growth.id);

      expect(preview.canApply).toBe(false);
      expect(preview.blockers.join(' ')).toContain(reason);
    });

    it('treats a plan with no price as the top of the range when the plans are not the built-in ones', async () => {
      const custom = plan('custom', [ModuleKey.ACADEMICS], {
        basePrice: null,
      });
      prismaMock.planDefinition.findUnique.mockResolvedValue(custom);
      prismaMock.institutionSubscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionStatus.ACTIVE,
        planId: 'plan-other',
        plan: plan('other', [], {
          id: 'plan-other',
          basePrice: new Prisma.Decimal(100),
        }),
        agreedPrice: null,
      });

      const preview = await service.preview('inst-1', custom.id);

      expect(preview.direction).toBe('UPGRADE');
      expect(preview.price.next).toBeNull();
    });

    it('reports a missing institution, plan or subscription', async () => {
      prismaMock.institution.findUnique.mockResolvedValue(null);
      await expect(service.preview('x', growth.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prismaMock.institution.findUnique.mockResolvedValue({
        id: 'inst-1',
        deploymentMode: DeploymentMode.SHARED_HOSTED,
      });
      prismaMock.planDefinition.findUnique.mockResolvedValue(null);
      await expect(service.preview('inst-1', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prismaMock.planDefinition.findUnique.mockResolvedValue(growth);
      prismaMock.institutionSubscription.findFirst.mockResolvedValue(null);
      await expect(service.preview('inst-1', growth.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('apply', () => {
    it('changes the plan and billing terms, keeping the subscription notes, and switches modules on', async () => {
      await service.apply('inst-1', { planId: growth.id });

      expect(txMock.institutionSubscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({
          planId: growth.id,
          agreedPrice: 35000,
          currency: 'PKR',
          billingCycle: 'MONTHLY',
          metadata: expect.objectContaining({
            maxStudents: 900,
            planKey: 'growth',
            previousPlanKey: 'starter',
            planChangedAt: expect.any(String),
          }),
        }),
      });
      expect(txMock.institutionEntitlement.upsert).toHaveBeenCalledTimes(1);
      expect(txMock.institutionEntitlement.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { isEnabled: true },
          where: {
            institutionId_moduleKey_activeScopeKey: {
              institutionId: 'inst-1',
              moduleKey: ModuleKey.REPORTING,
              activeScopeKey: 'ACTIVE',
            },
          },
        }),
      );
    });

    it('uses the agreed price it is given instead of the plan price', async () => {
      await service.apply('inst-1', { planId: growth.id, agreedPrice: 30000 });

      expect(txMock.institutionSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ agreedPrice: 30000 }),
        }),
      );
    });

    it('switches off the modules a downgrade removes', async () => {
      prismaMock.planDefinition.findUnique.mockResolvedValue(starter);
      prismaMock.planDefinition.findUniqueOrThrow.mockResolvedValue(starter);
      prismaMock.institutionSubscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionStatus.ACTIVE,
        planId: growth.id,
        plan: growth,
        agreedPrice: null,
      });
      prismaMock.institutionEntitlement.findMany.mockResolvedValue(
        enabled(ModuleKey.ACADEMICS, ModuleKey.FINANCE, ModuleKey.REPORTING),
      );

      await service.apply('inst-1', { planId: starter.id });

      expect(txMock.institutionEntitlement.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { isEnabled: false },
          create: expect.objectContaining({
            moduleKey: ModuleKey.REPORTING,
            isEnabled: false,
          }),
        }),
      );
    });

    it('changes nothing when the school would not fit the plan', async () => {
      limitsMock.currentCount.mockResolvedValue(5);
      limitsMock.limitUnderPlan.mockResolvedValue(2);

      await expect(
        service.apply('inst-1', { planId: growth.id }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(txMock.institutionSubscription.update).not.toHaveBeenCalled();
      expect(txMock.institutionEntitlement.upsert).not.toHaveBeenCalled();
    });

    it('says why in the refusal', async () => {
      limitsMock.currentCount.mockResolvedValue(5);
      limitsMock.limitUnderPlan.mockResolvedValue(2);

      await expect(
        service.apply('inst-1', { planId: growth.id }),
      ).rejects.toThrow('has 5 campuses');
    });
  });
});
