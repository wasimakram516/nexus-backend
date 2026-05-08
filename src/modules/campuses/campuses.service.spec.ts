import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SubscriptionStatus, UserRole } from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { CampusesService } from './campuses.service';

describe('CampusesService', () => {
  let service: CampusesService;

  const currentUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'institution-1',
  };

  const prismaMock = {
    institution: {
      findUnique: jest.fn(),
    },
    institutionSetting: {
      findUnique: jest.fn(),
    },
    institutionSubscription: {
      findFirst: jest.fn(),
    },
    campus: {
      count: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        CampusesService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: AuditLogService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CampusAccessService,
          useValue: {
            assertCampusAccess: jest.fn(),
            getCampusIdsForUser: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: EntityCustomFieldsService,
          useValue: {
            saveValues: jest.fn().mockResolvedValue({}),
            attachToItem: jest
              .fn()
              .mockImplementation((item) =>
                Promise.resolve({ ...item, customFields: {} }),
              ),
            attachToItems: jest
              .fn()
              .mockImplementation((items: Array<{ id: string }>) =>
                Promise.resolve(
                  items.map((item) => ({ ...item, customFields: {} })),
                ),
              ),
            resolveInstitutionIdByCampus: jest
              .fn()
              .mockResolvedValue('institution-1'),
          },
        },
        {
          provide: ModuleAccessService,
          useValue: {
            assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
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

    service = moduleRef.get<CampusesService>(CampusesService);
  });

  it('creates a campus within the plan limit', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
    prismaMock.institutionSubscription.findFirst.mockResolvedValue({
      metadata: null,
      plan: {
        key: 'growth',
        limits: { maxCampuses: 3 },
      },
      status: SubscriptionStatus.ACTIVE,
    });
    prismaMock.campus.count.mockResolvedValue(2);
    prismaMock.campus.create.mockResolvedValue({
      id: 'campus-1',
      institutionId: 'institution-1',
      name: 'City Campus',
    });

    await expect(
      service.createCampus(currentUser, {
        institutionId: 'institution-1',
        name: 'City Campus',
        location: 'Lahore',
        studentStartTime: '08:00',
        studentEndTime: '14:00',
        staffStartTime: '08:00',
        staffEndTime: '16:00',
        lateThreshold: 15,
        earlyLeaveThreshold: 15,
      }),
    ).resolves.toMatchObject({
      message: 'Campus created successfully',
      data: {
        institutionId: 'institution-1',
        name: 'City Campus',
      },
    });
  });

  it('blocks campus creation when the plan limit is reached', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
    prismaMock.institutionSubscription.findFirst.mockResolvedValue({
      metadata: null,
      plan: {
        key: 'starter',
        limits: { maxCampuses: 1 },
      },
      status: SubscriptionStatus.ACTIVE,
    });
    prismaMock.campus.count.mockResolvedValue(1);

    await expect(
      service.createCampus(currentUser, {
        institutionId: 'institution-1',
        name: 'Second Campus',
        location: 'Karachi',
        studentStartTime: '08:00',
        studentEndTime: '14:00',
        staffStartTime: '08:00',
        staffEndTime: '16:00',
        lateThreshold: 15,
        earlyLeaveThreshold: 15,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
