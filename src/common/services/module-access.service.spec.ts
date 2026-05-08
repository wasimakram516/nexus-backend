import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ModuleKey, SubscriptionStatus, UserRole } from '../../prisma/client';
import { CurrentUser } from '../interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { ModuleAccessService } from './module-access.service';

describe('ModuleAccessService', () => {
  let service: ModuleAccessService;

  const adminUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'institution-1',
  };

  const prismaMock = {
    institution: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ModuleAccessService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = moduleRef.get<ModuleAccessService>(ModuleAccessService);
  });

  it('builds runtime config with plan defaults overridden by entitlements', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
      branding: {
        displayName: 'Nexus Academy',
        logoUrl: null,
        primaryColor: '#111111',
        secondaryColor: '#222222',
        accentColor: '#333333',
        theme: 'default',
      },
      settings: [
        { key: 'brandingMode', value: { compact: true } },
        { key: 'workflows', value: { admissions: true } },
      ],
      entitlements: [
        {
          moduleKey: ModuleKey.FINANCE,
          isEnabled: false,
          configuration: { locked: true },
        },
      ],
      subscriptions: [
        {
          id: 'subscription-1',
          status: SubscriptionStatus.ACTIVE,
          planId: 'plan-1',
          autoRenew: true,
          plan: {
            key: 'growth',
            name: 'Growth',
            defaultModules: [ModuleKey.FINANCE, ModuleKey.PEOPLE],
          },
        },
      ],
    });

    const config = await service.getInstitutionRuntimeConfig('institution-1');

    expect(config.modules[ModuleKey.PEOPLE]).toEqual({
      enabled: true,
      configuration: {},
    });
    expect(config.modules[ModuleKey.FINANCE]).toEqual({
      enabled: false,
      configuration: { locked: true },
    });
    expect(config.settings).toMatchObject({
      brandingMode: { compact: true },
      workflows: { admissions: true },
    });
  });

  it('blocks disabled modules for institution users', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
      branding: null,
      settings: [],
      entitlements: [
        {
          moduleKey: ModuleKey.ATTENDANCE,
          isEnabled: false,
          configuration: {},
        },
      ],
      subscriptions: [
        {
          id: 'subscription-1',
          status: SubscriptionStatus.ACTIVE,
          planId: 'plan-1',
          autoRenew: false,
          plan: {
            key: 'starter',
            name: 'Starter',
            defaultModules: [ModuleKey.ATTENDANCE],
          },
        },
      ],
    });

    await expect(
      service.assertModuleEnabledForUser(adminUser, ModuleKey.ATTENDANCE),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
