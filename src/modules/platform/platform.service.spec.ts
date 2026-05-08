import { DeploymentMode, ModuleKey, UserRole } from '../../prisma/client';
import { Test } from '@nestjs/testing';
import { BillingCycle } from '../../common/enums/domain.enums';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from './platform.service';

type CreatedInstitution = {
  id: string;
  name: string;
  slug: string;
};

type CreateInstitutionTransaction = {
  institution: {
    create: () => Promise<CreatedInstitution>;
  };
  permissionTemplate: {
    update: jest.Mock;
    delete: jest.Mock;
  };
  auditLog: {
    create: () => Promise<Record<string, never>>;
  };
};

describe('PlatformService', () => {
  let service: PlatformService;

  const currentUser: CurrentUser = {
    sub: 'user-1',
    email: 'owner@nexus.test',
    role: UserRole.SUPERADMIN,
  };

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

  const permissionTemplate = {
    id: 'template-1',
    institutionId: 'institution-1',
    name: 'Default Admin',
    description: 'Admin permissions',
    permissions: { users: ['read', 'write'] },
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
    },
    permissionTemplate: {
      findMany: jest.fn().mockResolvedValue([permissionTemplate]),
      findFirst: jest.fn().mockResolvedValue(permissionTemplate),
    },
    $transaction: async <T>(
      callback: (tx: CreateInstitutionTransaction) => Promise<T>,
    ): Promise<T> =>
      callback({
        institution: {
          create: () =>
            Promise.resolve({
              id: 'institution-1',
              name: 'Nexus Academy',
              slug: 'nexus-academy',
            }),
        },
        permissionTemplate: {
          update: jest.fn().mockResolvedValue({
            ...permissionTemplate,
            name: 'Updated Template',
          }),
          delete: jest.fn().mockResolvedValue(permissionTemplate),
        },
        auditLog: {
          create: () => Promise.resolve({}),
        },
      }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

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
      service.createInstitution(
        {
          name: 'Nexus Academy',
          slug: 'nexus-academy',
        },
        currentUser,
      ),
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

    await service.createInstitution(
      {
        name: 'Nexus Academy',
        slug: 'Nexus Academy',
      },
      currentUser,
    );

    expect(prismaMock.institution.findFirst).toHaveBeenNthCalledWith(1, {
      where: { slug: 'nexus-academy' },
      select: { id: true },
    });
    expect(prismaMock.institution.findFirst).toHaveBeenNthCalledWith(2, {
      where: { slug: 'nexus-academy-1' },
      select: { id: true },
    });
  });

  it('lists permission templates for an institution', async () => {
    await expect(
      service.listPermissionTemplates('institution-1'),
    ).resolves.toMatchObject({
      message: 'Permission templates retrieved successfully',
      data: [permissionTemplate],
    });
  });

  it('updates a permission template within the institution scope', async () => {
    await expect(
      service.updatePermissionTemplate(
        'institution-1',
        'template-1',
        {
          name: 'Updated Template',
        },
        currentUser,
      ),
    ).resolves.toMatchObject({
      message: 'Permission template updated successfully',
      data: {
        id: 'template-1',
        name: 'Updated Template',
      },
    });
  });

  it('deletes a permission template within the institution scope', async () => {
    await expect(
      service.deletePermissionTemplate(
        'institution-1',
        'template-1',
        currentUser,
      ),
    ).resolves.toEqual({
      message: 'Permission template moved to recycle bin successfully',
      data: { id: 'template-1' },
    });
  });
});
