import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, SubscriptionStatus, UserRole } from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
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
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    userCampus: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation(
      (arg: unknown[] | ((tx: unknown) => Promise<unknown>)) => {
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        return arg(prismaMock);
      },
    );

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
            saveRecord: jest.fn(
              (
                _params: unknown,
                mutation: (
                  transaction: Prisma.TransactionClient,
                ) => Promise<unknown>,
              ) => mutation(prismaMock as unknown as Prisma.TransactionClient),
            ),
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
        {
          provide: TimezoneResolverService,
          useValue: {
            assertValidTimezone: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<CampusesService>(CampusesService);
  });

  it('rejects moving a campus across institutions before any write', async () => {
    await expect(
      service.updateCampus(currentUser, 'campus-1', {
        institutionId: 'institution-2',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.campus.update).not.toHaveBeenCalled();
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

  it('lets SUPERADMIN create a campus for any institution', async () => {
    const superadmin: CurrentUser = {
      sub: 'super-1',
      email: 'super@nexus.test',
      role: UserRole.SUPERADMIN,
      institutionId: null,
    };
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-9',
    });
    prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
    prismaMock.institutionSubscription.findFirst.mockResolvedValue(null);
    prismaMock.campus.count.mockResolvedValue(0);
    prismaMock.campus.create.mockResolvedValue({
      id: 'campus-9',
      institutionId: 'institution-9',
      name: 'Free Plan Campus',
    });

    await expect(
      service.createCampus(superadmin, {
        institutionId: 'institution-9',
        name: 'Free Plan Campus',
        location: 'Lahore',
        studentStartTime: '08:00',
        studentEndTime: '14:00',
        staffStartTime: '08:00',
        staffEndTime: '16:00',
        lateThreshold: 15,
        earlyLeaveThreshold: 15,
      }),
    ).resolves.toMatchObject({ message: 'Campus created successfully' });
  });

  it('rejects a non-superadmin whose account has no institution', async () => {
    const unlinkedAdmin: CurrentUser = {
      sub: 'admin-9',
      email: 'unlinked@nexus.test',
      role: UserRole.ADMIN,
      institutionId: null,
    };

    await expect(
      service.createCampus(unlinkedAdmin, {
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
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an ADMIN attempting to create a campus for another institution', async () => {
    await expect(
      service.createCampus(currentUser, {
        institutionId: 'institution-2',
        name: 'City Campus',
        location: 'Lahore',
        studentStartTime: '08:00',
        studentEndTime: '14:00',
        staffStartTime: '08:00',
        staffEndTime: '16:00',
        lateThreshold: 15,
        earlyLeaveThreshold: 15,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects campus creation when the institution does not exist', async () => {
    prismaMock.institution.findUnique.mockResolvedValue(null);

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
    ).rejects.toBeInstanceOf(Error);
  });

  it('falls back to the default (starter) plan limit when there is no active subscription', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
    prismaMock.institutionSubscription.findFirst.mockResolvedValue(null);
    prismaMock.campus.count.mockResolvedValue(0);
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
    ).resolves.toMatchObject({ message: 'Campus created successfully' });
    expect(prismaMock.campus.count).toHaveBeenCalled();
  });

  it('allows unlimited campuses once every source resolves to the enterprise plan (null limit)', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
    prismaMock.institutionSubscription.findFirst.mockResolvedValue({
      metadata: null,
      plan: { key: 'enterprise', limits: { maxCampuses: null } },
      status: SubscriptionStatus.ACTIVE,
    });
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
    ).resolves.toMatchObject({ message: 'Campus created successfully' });
    expect(prismaMock.campus.count).not.toHaveBeenCalled();
  });

  it('prefers the institution-setting override over the subscription metadata and plan limit', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    prismaMock.institutionSetting.findUnique.mockResolvedValue({
      value: { maxCampuses: 5 },
    });
    prismaMock.institutionSubscription.findFirst.mockResolvedValue({
      metadata: { maxCampuses: 1 },
      plan: { key: 'starter', limits: { maxCampuses: 1 } },
      status: SubscriptionStatus.ACTIVE,
    });
    prismaMock.campus.count.mockResolvedValue(4);
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
    ).resolves.toMatchObject({ message: 'Campus created successfully' });
  });

  it('falls back to the plan blueprint default limit when nothing overrides it', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
    prismaMock.institutionSubscription.findFirst.mockResolvedValue(null);
    prismaMock.campus.count.mockResolvedValue(0);
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
    ).resolves.toMatchObject({ message: 'Campus created successfully' });
  });

  it('ignores a malformed (non-object) institution-setting override and nested limits value', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    prismaMock.institutionSetting.findUnique.mockResolvedValue({
      value: 'not-an-object',
    });
    prismaMock.institutionSubscription.findFirst.mockResolvedValue({
      metadata: { limits: 'also-not-an-object' },
      plan: { key: 'starter', limits: null },
      status: SubscriptionStatus.ACTIVE,
    });
    prismaMock.campus.count.mockResolvedValue(0);
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
    ).resolves.toMatchObject({ message: 'Campus created successfully' });
  });

  it('reads a nested limits.maxCampuses override when no direct maxCampuses is set', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
    prismaMock.institutionSubscription.findFirst.mockResolvedValue({
      metadata: { limits: { maxCampuses: 1 } },
      plan: { key: 'starter', limits: { maxCampuses: 1 } },
      status: SubscriptionStatus.ACTIVE,
    });
    prismaMock.campus.count.mockResolvedValue(1);

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
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('falls through to the next source when the institution-setting override is explicitly null', async () => {
    // readMaxCampusesOverride returning null (not undefined) still falls
    // through the ?? chain to the next source — only the fully-resolved
    // value being null/undefined skips enforcement, per assertCampusLimit.
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    prismaMock.institutionSetting.findUnique.mockResolvedValue({
      value: { maxCampuses: null },
    });
    prismaMock.institutionSubscription.findFirst.mockResolvedValue({
      metadata: null,
      plan: { key: 'growth', limits: { maxCampuses: 3 } },
      status: SubscriptionStatus.ACTIVE,
    });
    prismaMock.campus.count.mockResolvedValue(3);

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
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('validates the campus timezone when one is provided on create', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
    prismaMock.institutionSubscription.findFirst.mockResolvedValue(null);
    prismaMock.campus.count.mockResolvedValue(0);
    prismaMock.campus.create.mockResolvedValue({
      id: 'campus-1',
      institutionId: 'institution-1',
      name: 'City Campus',
    });

    await service.createCampus(currentUser, {
      institutionId: 'institution-1',
      name: 'City Campus',
      location: 'Lahore',
      timezone: 'Asia/Karachi',
      studentStartTime: '08:00',
      studentEndTime: '14:00',
      staffStartTime: '08:00',
      staffEndTime: '16:00',
      lateThreshold: 15,
      earlyLeaveThreshold: 15,
    });

    expect(
      (
        service as unknown as {
          timezoneResolver: { assertValidTimezone: jest.Mock };
        }
      ).timezoneResolver.assertValidTimezone,
    ).toHaveBeenCalledWith('Asia/Karachi');
  });

  describe('listCampuses', () => {
    const pagination = { page: 1, limit: 10 };

    it('lets SUPERADMIN see every non-deleted campus', async () => {
      prismaMock.campus.findMany.mockResolvedValue([{ id: 'campus-1' }]);
      prismaMock.campus.count.mockResolvedValue(1);

      const superadmin: CurrentUser = {
        sub: 'super-1',
        email: 'super@nexus.test',
        role: UserRole.SUPERADMIN,
        institutionId: null,
      };

      await service.listCampuses(superadmin, pagination);

      expect(prismaMock.campus.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null } }),
      );
    });

    it('scopes ADMIN to their own institution', async () => {
      prismaMock.campus.findMany.mockResolvedValue([]);
      prismaMock.campus.count.mockResolvedValue(0);

      await service.listCampuses(currentUser, pagination);

      expect(prismaMock.campus.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, institutionId: 'institution-1' },
        }),
      );
    });

    it('scopes STAFF/STUDENT/GUARDIAN to their resolved campus ids', async () => {
      const staff: CurrentUser = {
        sub: 'staff-1',
        email: 'staff@nexus.test',
        role: UserRole.STAFF,
        institutionId: 'institution-1',
      };
      prismaMock.campus.findMany.mockResolvedValue([]);
      prismaMock.campus.count.mockResolvedValue(0);

      await service.listCampuses(staff, pagination);

      expect(prismaMock.campus.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, id: { in: [] } },
        }),
      );
    });
  });

  describe('updateCampus', () => {
    it('validates the campus timezone when one is provided on update', async () => {
      prismaMock.campus.update.mockResolvedValue({
        id: 'campus-1',
        institutionId: 'institution-1',
        name: 'City Campus',
      });

      await service.updateCampus(currentUser, 'campus-1', {
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

    it('allows an update that keeps the same institutionId', async () => {
      prismaMock.campus.update.mockResolvedValue({
        id: 'campus-1',
        institutionId: 'institution-1',
        name: 'Renamed Campus',
      });

      await expect(
        service.updateCampus(currentUser, 'campus-1', {
          institutionId: 'institution-1',
          name: 'Renamed Campus',
        }),
      ).resolves.toMatchObject({ message: 'Campus updated successfully' });
    });
  });

  describe('deleteCampus', () => {
    it('throws when the campus does not exist', async () => {
      prismaMock.campus.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteCampus(currentUser, 'missing-campus'),
      ).rejects.toBeInstanceOf(Error);
    });

    it('throws when the campus is already soft-deleted', async () => {
      prismaMock.campus.findUnique.mockResolvedValue({
        id: 'campus-1',
        name: 'City Campus',
        institutionId: 'institution-1',
        deletedAt: new Date(),
      });

      await expect(
        service.deleteCampus(currentUser, 'campus-1'),
      ).rejects.toBeInstanceOf(Error);
    });

    it('soft-deletes the campus with the provided reason', async () => {
      prismaMock.campus.findUnique.mockResolvedValue({
        id: 'campus-1',
        name: 'City Campus',
        institutionId: 'institution-1',
        deletedAt: null,
      });
      prismaMock.campus.update.mockResolvedValue({});

      const result = await service.deleteCampus(
        currentUser,
        'campus-1',
        'Closed permanently',
      );

      expect(prismaMock.campus.update).toHaveBeenCalledWith({
        where: { id: 'campus-1' },
        data: expect.objectContaining({
          deleteReason: 'Closed permanently',
          deletedBy: currentUser.sub,
        }) as never,
      });
      expect(result.message).toBe('Campus moved to recycle bin successfully');
    });
  });

  describe('assignUser', () => {
    it('throws when the user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.campus.findUnique.mockResolvedValue({
        id: 'campus-1',
        institutionId: 'institution-1',
        deletedAt: null,
      });

      await expect(
        service.assignUser(currentUser, {
          userId: 'missing-user',
          campusId: 'campus-1',
        }),
      ).rejects.toBeInstanceOf(Error);
    });

    it('throws when the campus does not exist or is deleted', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        deletedAt: null,
        institutionId: 'institution-1',
      });
      prismaMock.campus.findUnique.mockResolvedValue(null);

      await expect(
        service.assignUser(currentUser, {
          userId: 'user-1',
          campusId: 'missing-campus',
        }),
      ).rejects.toBeInstanceOf(Error);
    });

    it('rejects when the caller is outside the campus institution', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        deletedAt: null,
        institutionId: 'institution-2',
      });
      prismaMock.campus.findUnique.mockResolvedValue({
        id: 'campus-1',
        institutionId: 'institution-2',
        deletedAt: null,
      });

      await expect(
        service.assignUser(currentUser, {
          userId: 'user-1',
          campusId: 'campus-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when the user already belongs to a different institution than the campus', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        deletedAt: null,
        institutionId: 'institution-2',
      });
      prismaMock.campus.findUnique.mockResolvedValue({
        id: 'campus-1',
        institutionId: 'institution-1',
        deletedAt: null,
      });

      await expect(
        service.assignUser(currentUser, {
          userId: 'user-1',
          campusId: 'campus-1',
        }),
      ).rejects.toBeInstanceOf(Error);
    });

    it('links an unlinked user to the campus institution and creates the assignment', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        deletedAt: null,
        institutionId: null,
      });
      prismaMock.campus.findUnique.mockResolvedValue({
        id: 'campus-1',
        institutionId: 'institution-1',
        deletedAt: null,
      });
      prismaMock.userCampus.findFirst.mockResolvedValue(null);
      prismaMock.userCampus.create.mockResolvedValue({ id: 'uc-1' });

      const result = await service.assignUser(currentUser, {
        userId: 'user-1',
        campusId: 'campus-1',
      });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { institutionId: 'institution-1' },
      });
      expect(prismaMock.userCampus.create).toHaveBeenCalled();
      expect(result.message).toBe('User assigned to campus successfully');
    });

    it('revives a soft-deleted assignment instead of creating a duplicate', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        deletedAt: null,
        institutionId: 'institution-1',
      });
      prismaMock.campus.findUnique.mockResolvedValue({
        id: 'campus-1',
        institutionId: 'institution-1',
        deletedAt: null,
      });
      prismaMock.userCampus.findFirst.mockResolvedValueOnce({
        id: 'uc-deleted-1',
      });
      prismaMock.userCampus.update.mockResolvedValue({ id: 'uc-deleted-1' });

      await service.assignUser(currentUser, {
        userId: 'user-1',
        campusId: 'campus-1',
      });

      expect(prismaMock.userCampus.update).toHaveBeenCalledWith({
        where: { id: 'uc-deleted-1' },
        data: { deletedAt: null, deletedBy: null, deleteReason: null },
      });
      expect(prismaMock.userCampus.create).not.toHaveBeenCalled();
    });

    it('returns the existing active assignment instead of creating a duplicate', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        deletedAt: null,
        institutionId: 'institution-1',
      });
      prismaMock.campus.findUnique.mockResolvedValue({
        id: 'campus-1',
        institutionId: 'institution-1',
        deletedAt: null,
      });
      prismaMock.userCampus.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'uc-existing-1' });

      const result = await service.assignUser(currentUser, {
        userId: 'user-1',
        campusId: 'campus-1',
      });

      expect(prismaMock.userCampus.create).not.toHaveBeenCalled();
      expect(result.data).toEqual({ id: 'uc-existing-1' });
    });
  });

  describe('getCampusUsers', () => {
    it('returns the users assigned to a campus', async () => {
      prismaMock.userCampus.findMany.mockResolvedValue([
        { user: { id: 'user-1', name: 'A' } },
      ]);

      const result = await service.getCampusUsers(currentUser, 'campus-1');

      expect(result.message).toBe('Campus users retrieved successfully');
      expect(result.data).toHaveLength(1);
    });
  });

  describe('removeUser', () => {
    it('throws when the assignment does not exist', async () => {
      prismaMock.userCampus.findFirst.mockResolvedValue(null);

      await expect(
        service.removeUser(currentUser, {
          userId: 'user-1',
          campusId: 'campus-1',
        }),
      ).rejects.toBeInstanceOf(Error);
    });

    it('deletes the assignment', async () => {
      prismaMock.userCampus.findFirst.mockResolvedValue({ id: 'uc-1' });
      prismaMock.userCampus.delete.mockResolvedValue({ id: 'uc-1' });

      const result = await service.removeUser(currentUser, {
        userId: 'user-1',
        campusId: 'campus-1',
      });

      expect(prismaMock.userCampus.delete).toHaveBeenCalledWith({
        where: { id: 'uc-1' },
      });
      expect(result.message).toBe('User removed from campus successfully');
    });
  });
});
