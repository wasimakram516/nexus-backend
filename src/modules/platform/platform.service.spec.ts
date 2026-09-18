import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  DeploymentMode,
  ModuleKey,
  Prisma,
  SubscriptionStatus,
} from '../../prisma/client';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BillingCycle } from '../../common/enums/domain.enums';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from './platform.service';

describe('PlatformService', () => {
  let service: PlatformService;

  const starterPlan = {
    id: 'plan-starter',
    key: 'starter',
    name: 'Starter',
    description: 'Default plan',
    basePrice: 15000,
    currency: 'PKR',
    billingCycle: BillingCycle.MONTHLY,
    setupFee: null,
    deploymentModes: [DeploymentMode.SHARED_HOSTED],
    defaultModules: [ModuleKey.ACADEMICS, ModuleKey.ATTENDANCE],
    limits: { maxCampuses: 1 },
    metadata: { source: 'bootstrap' },
    isActive: true,
  };

  const txMock = {
    institution: {
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    planDefinition: {
      create: jest.fn(),
      update: jest.fn(),
    },
    institutionBranding: {
      findFirst: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    institutionSetting: {
      upsert: jest.fn(),
    },
    institutionEntitlement: {
      upsert: jest.fn(),
    },
    institutionSubscription: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };

  const prismaMock = {
    planDefinition: {
      upsert: jest.fn().mockImplementation(
        ({
          where,
        }: {
          where: {
            key_activeScopeKey: { key: string; activeScopeKey: string };
          };
        }) =>
          Promise.resolve({
            ...starterPlan,
            key: where.key_activeScopeKey.key,
            name:
              where.key_activeScopeKey.key === 'starter'
                ? 'Starter'
                : where.key_activeScopeKey.key,
          }),
      ),
      findUnique: jest.fn().mockResolvedValue(starterPlan),
      findMany: jest.fn().mockResolvedValue([starterPlan]),
    },
    institution: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ id: 'institution-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((callback: (tx: typeof txMock) => Promise<unknown>) =>
      callback(txMock),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    txMock.institution.create.mockResolvedValue({
      id: 'institution-1',
      name: 'Nexus Academy',
      slug: 'nexus-academy',
    });
    txMock.institution.update.mockResolvedValue({
      id: 'institution-1',
      name: 'Nexus Academy Updated',
      slug: 'nexus-academy',
    });
    txMock.auditLog.create.mockResolvedValue({});
    txMock.planDefinition.create.mockResolvedValue({
      id: 'plan-new',
      key: 'custom',
    });
    txMock.planDefinition.update.mockResolvedValue({
      id: 'plan-1',
      key: 'starter',
    });
    txMock.institutionBranding.findFirst.mockResolvedValue(null);
    txMock.institutionBranding.upsert.mockResolvedValue({
      id: 'branding-1',
    });
    txMock.institutionBranding.update.mockResolvedValue({ id: 'branding-1' });
    txMock.institutionSetting.upsert.mockResolvedValue({ id: 'setting-1' });
    txMock.institutionEntitlement.upsert.mockResolvedValue({
      id: 'entitlement-1',
    });
    txMock.institutionSubscription.findFirst.mockResolvedValue(null);
    txMock.institutionSubscription.create.mockResolvedValue({
      id: 'subscription-1',
      status: SubscriptionStatus.TRIAL,
      autoRenew: false,
    });
    txMock.institutionSubscription.update.mockResolvedValue({
      id: 'subscription-1',
      status: SubscriptionStatus.ACTIVE,
      autoRenew: true,
    });
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: ModuleAccessService,
          useValue: {
            getInstitutionRuntimeConfig: jest.fn(),
          },
        },
        {
          provide: RequestContextService,
          useValue: {
            runWith: jest
              .fn()
              .mockImplementation(
                (
                  _state: Record<string, unknown>,
                  callback: () => Promise<unknown>,
                ) => callback(),
              ),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(14),
            getOrThrow: jest.fn().mockReturnValue(14),
          },
        },
        {
          provide: TimezoneResolverService,
          useValue: {
            assertValidTimezone: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<PlatformService>(PlatformService);
  });

  it('returns bootstrap-backed plan definitions', async () => {
    const result = await service.listPlans();
    const plan = result.data.find(
      (item: { key: string }) => item.key === 'starter',
    );

    expect(result.message).toBe('Platform plans retrieved successfully');
    expect(plan?.deploymentModes).toEqual([DeploymentMode.SHARED_HOSTED]);
    expect(plan?.limits).toMatchObject({ maxCampuses: 1 });
    expect(plan?.basePrice).toBe(15000);
    expect(plan?.currency).toBe('PKR');
  });

  it('creates an institution with the resolved plan definition', async () => {
    await expect(
      service.createInstitution({
        name: 'Nexus Academy',
        slug: 'nexus-academy',
      }),
    ).resolves.toMatchObject({
      message: 'Institution created successfully',
      data: {
        id: 'institution-1',
        slug: 'nexus-academy',
      },
    });
  });

  it('creates an institution with a suffixed slug when the base slug is already taken', async () => {
    prismaMock.institution.findFirst
      .mockResolvedValueOnce({ id: 'institution-existing-1' })
      .mockResolvedValueOnce(null);

    await service.createInstitution({
      name: 'Nexus Academy',
      slug: 'Nexus Academy',
    });

    expect(prismaMock.institution.findFirst).toHaveBeenNthCalledWith(1, {
      where: { slug: 'nexus-academy' },
      select: { id: true },
    });
    expect(prismaMock.institution.findFirst).toHaveBeenNthCalledWith(2, {
      where: { slug: 'nexus-academy-1' },
      select: { id: true },
    });
  });

  it('rejects an unsupported deployment mode for the resolved plan', async () => {
    await expect(
      service.createInstitution({
        name: 'Nexus Academy',
        slug: 'nexus-academy',
        deploymentMode: DeploymentMode.SELF_HOSTED,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('validates the institution timezone when one is provided on create', async () => {
    await service.createInstitution({
      name: 'Nexus Academy',
      slug: 'nexus-academy',
      timezone: 'Asia/Karachi',
    });

    expect(
      (
        service as unknown as {
          timezoneResolver: { assertValidTimezone: jest.Mock };
        }
      ).timezoneResolver.assertValidTimezone,
    ).toHaveBeenCalledWith('Asia/Karachi');
  });

  it('translates a unique-constraint violation on institution creation into ConflictException', async () => {
    prismaMock.$transaction.mockImplementationOnce(() => {
      throw new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.8.0',
      });
    });

    await expect(
      service.createInstitution({
        name: 'Nexus Academy',
        slug: 'nexus-academy',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rethrows a non-uniqueness error from institution creation', async () => {
    prismaMock.$transaction.mockImplementationOnce(() => {
      throw new Error('unexpected failure');
    });

    await expect(
      service.createInstitution({
        name: 'Nexus Academy',
        slug: 'nexus-academy',
      }),
    ).rejects.toThrow('unexpected failure');
  });

  it('resolves a specific plan by id when planId is provided', async () => {
    prismaMock.planDefinition.findUnique.mockResolvedValueOnce(starterPlan);

    await service.createInstitution({
      name: 'Nexus Academy',
      slug: 'nexus-academy',
      planId: 'plan-starter',
    });

    expect(prismaMock.planDefinition.findUnique).toHaveBeenCalledWith({
      where: { id: 'plan-starter' },
    });
  });

  it('throws NotFoundException when the requested planId does not exist', async () => {
    prismaMock.planDefinition.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.createInstitution({
        name: 'Nexus Academy',
        slug: 'nexus-academy',
        planId: 'missing-plan',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when no default (starter) plan is bootstrapped', async () => {
    prismaMock.planDefinition.upsert.mockResolvedValue({
      ...starterPlan,
      key: 'growth',
    });

    await expect(service.getSignupPlanContext()).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('createPlan', () => {
    const createPlanDto = {
      key: 'CUSTOM',
      name: 'Custom Plan',
      basePrice: 1000,
      deploymentModes: [DeploymentMode.SHARED_HOSTED],
      defaultModules: [ModuleKey.ACADEMICS],
      limits: { maxCampuses: 2 },
    };

    it('creates a plan and lowercases the key', async () => {
      await service.createPlan(createPlanDto);

      expect(txMock.planDefinition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ key: 'custom' }) as never,
        }),
      );
    });

    it('translates a duplicate plan key into ConflictException', async () => {
      prismaMock.$transaction.mockImplementationOnce(() => {
        throw new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '7.8.0',
        });
      });

      await expect(service.createPlan(createPlanDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rethrows a non-uniqueness error from plan creation', async () => {
      prismaMock.$transaction.mockImplementationOnce(() => {
        throw new Error('db down');
      });

      await expect(service.createPlan(createPlanDto)).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('updatePlan', () => {
    it('updates an existing plan', async () => {
      await expect(
        service.updatePlan('plan-1', { name: 'Renamed' }),
      ).resolves.toMatchObject({ message: 'Plan updated successfully' });
    });

    it('throws NotFoundException when the plan does not exist', async () => {
      prismaMock.planDefinition.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updatePlan('missing-plan', { name: 'Renamed' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('translates a duplicate plan key into ConflictException', async () => {
      prismaMock.$transaction.mockImplementationOnce(() => {
        throw new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '7.8.0',
        });
      });

      await expect(
        service.updatePlan('plan-1', { key: 'starter' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('listInstitutions', () => {
    it('filters by status and plan when provided', async () => {
      prismaMock.institution.findMany.mockResolvedValueOnce([]);

      await service.listInstitutions({
        status: 'ACTIVE',
        planId: 'plan-starter',
      });

      expect(prismaMock.institution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ACTIVE',
            subscriptions: { some: { planId: 'plan-starter' } },
          }) as never,
        }),
      );
    });
  });

  describe('getInstitution', () => {
    it('looks up by id when the identifier is a UUID', async () => {
      prismaMock.institution.findFirst.mockResolvedValueOnce({
        id: 'institution-1',
      });

      await service.getInstitution('11111111-1111-1111-1111-111111111111');

      expect(prismaMock.institution.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: '11111111-1111-1111-1111-111111111111' },
        }),
      );
    });

    it('looks up by slug when the identifier is not a UUID', async () => {
      prismaMock.institution.findFirst.mockResolvedValueOnce({
        id: 'institution-1',
      });

      await service.getInstitution('nexus-academy');

      expect(prismaMock.institution.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: 'nexus-academy' } }),
      );
    });

    it('throws NotFoundException when no institution matches', async () => {
      prismaMock.institution.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.getInstitution('missing-institution'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getInstitutionRuntimeConfig', () => {
    it('resolves the institution id from a slug before delegating', async () => {
      prismaMock.institution.findFirst.mockResolvedValueOnce({
        id: 'institution-1',
      });
      const runtimeConfig = { plan: 'starter' };
      const moduleAccessMock = service['moduleAccessService'] as unknown as {
        getInstitutionRuntimeConfig: jest.Mock;
      };
      moduleAccessMock.getInstitutionRuntimeConfig.mockResolvedValue(
        runtimeConfig,
      );

      await expect(
        service.getInstitutionRuntimeConfig('nexus-academy'),
      ).resolves.toMatchObject({ data: runtimeConfig });
    });

    it('throws NotFoundException when the slug does not resolve', async () => {
      prismaMock.institution.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.getInstitutionRuntimeConfig('missing-slug'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('uses the identifier directly as the institution id when it is a UUID', async () => {
      const moduleAccessMock = service['moduleAccessService'] as unknown as {
        getInstitutionRuntimeConfig: jest.Mock;
      };
      moduleAccessMock.getInstitutionRuntimeConfig.mockResolvedValue({});

      await service.getInstitutionRuntimeConfig(
        '11111111-1111-1111-1111-111111111111',
      );

      expect(moduleAccessMock.getInstitutionRuntimeConfig).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
      );
    });
  });

  describe('updateInstitution', () => {
    it('throws NotFoundException when the institution does not exist', async () => {
      prismaMock.institution.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updateInstitution('missing-institution', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('slugifies the new slug and validates the timezone when provided', async () => {
      await service.updateInstitution('institution-1', {
        slug: 'New Slug!',
        timezone: 'Asia/Karachi',
      });

      expect(txMock.institution.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'new-slug' }) as never,
        }),
      );
      expect(
        (
          service as unknown as {
            timezoneResolver: { assertValidTimezone: jest.Mock };
          }
        ).timezoneResolver.assertValidTimezone,
      ).toHaveBeenCalledWith('Asia/Karachi');
    });
  });

  describe('updateBranding', () => {
    it('throws NotFoundException when the institution does not exist', async () => {
      prismaMock.institution.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updateBranding('missing-institution', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('upserts branding when no soft-deleted row exists', async () => {
      await service.updateBranding('institution-1', {
        displayName: 'Nexus Academy',
      });

      expect(txMock.institutionBranding.upsert).toHaveBeenCalled();
      expect(txMock.institutionBranding.update).not.toHaveBeenCalled();
    });

    it('revives a soft-deleted branding row instead of upserting a new one', async () => {
      txMock.institutionBranding.findFirst.mockResolvedValueOnce({
        id: 'branding-deleted-1',
      });

      await service.updateBranding('institution-1', {
        displayName: 'Nexus Academy',
      });

      expect(txMock.institutionBranding.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'branding-deleted-1' },
          data: expect.objectContaining({ deletedAt: null }) as never,
        }),
      );
      expect(txMock.institutionBranding.upsert).not.toHaveBeenCalled();
    });
  });

  describe('upsertSettings', () => {
    it('throws NotFoundException when the institution does not exist', async () => {
      prismaMock.institution.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.upsertSettings('missing-institution', { settings: [] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('normalizes setting keys to snake_case before upserting', async () => {
      await service.upsertSettings('institution-1', {
        settings: [{ key: 'Max Campuses!', value: 5 }],
      });

      expect(txMock.institutionSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            institutionId_key_activeScopeKey: expect.objectContaining({
              key: 'max_campuses',
            }) as never,
          }) as never,
        }),
      );
    });
  });

  describe('upsertEntitlements', () => {
    it('throws NotFoundException when the institution does not exist', async () => {
      prismaMock.institution.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.upsertEntitlements('missing-institution', { entitlements: [] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('upserts each entitlement', async () => {
      await expect(
        service.upsertEntitlements('institution-1', {
          entitlements: [{ moduleKey: ModuleKey.FINANCE, isEnabled: true }],
        }),
      ).resolves.toMatchObject({
        message: 'Institution entitlements updated successfully',
      });
      expect(txMock.institutionEntitlement.upsert).toHaveBeenCalled();
    });
  });

  describe('updateSubscription', () => {
    it('throws NotFoundException when the institution does not exist', async () => {
      prismaMock.institution.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updateSubscription('missing-institution', {
          planId: 'plan-starter',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates a subscription when none exists yet', async () => {
      txMock.institutionSubscription.findFirst.mockResolvedValueOnce(null);

      await service.updateSubscription('institution-1', {
        planId: 'plan-starter',
      });

      expect(txMock.institutionSubscription.create).toHaveBeenCalled();
      expect(txMock.institutionSubscription.update).not.toHaveBeenCalled();
    });

    it('updates the existing subscription when one is already active', async () => {
      txMock.institutionSubscription.findFirst.mockResolvedValueOnce({
        id: 'subscription-existing-1',
      });

      await service.updateSubscription('institution-1', {
        planId: 'plan-starter',
        status: SubscriptionStatus.ACTIVE,
        autoRenew: true,
      });

      expect(txMock.institutionSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'subscription-existing-1' },
        }),
      );
      expect(txMock.institutionSubscription.create).not.toHaveBeenCalled();
    });
  });
});
