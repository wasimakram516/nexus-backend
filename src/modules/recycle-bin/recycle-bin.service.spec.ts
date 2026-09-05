import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogService } from '../../common/services/audit-log.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, UserRole, UserStatus } from '../../prisma/client';
import { RecycleBinEntity } from './dto/recycle-bin.dto';
import { RecycleBinService } from './recycle-bin.service';

describe('RecycleBinService', () => {
  let service: RecycleBinService;

  const adminUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'institution-1',
  };

  const prismaMock = {
    user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    campus: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    role: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    student: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    guardian: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    staffProfile: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    level: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    academicClass: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    section: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    subject: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    staffSalary: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    salaryDeductionRule: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    salaryAdjustment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    salaryPayment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    salaryDeductionSummary: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    bankAccount: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    feeStructure: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    studentDiscount: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    studentFineRule: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    studentFine: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    feeVoucher: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    feePayment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    institutionSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    academicYear: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
  };

  const auditLogServiceMock = {
    log: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RecycleBinService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: AuditLogService,
          useValue: auditLogServiceMock,
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

    service = moduleRef.get<RecycleBinService>(RecycleBinService);
  });

  it('lists soft-deleted users and campuses with deleted-by user details', async () => {
    prismaMock.user.findMany
      .mockResolvedValueOnce([
        {
          id: 'user-1',
          name: 'Deleted User',
          email: 'deleted@nexus.test',
          role: UserRole.STAFF,
          status: UserStatus.SUSPENDED,
          institutionId: 'institution-1',
          deletedAt: new Date('2026-05-06T10:00:00.000Z'),
          deletedBy: 'admin-1',
          deleteReason: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-05-06T09:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'admin-1',
          name: 'Admin User',
          email: 'admin@nexus.test',
          role: UserRole.ADMIN,
        },
      ]);
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.campus.findMany.mockResolvedValue([
      {
        id: 'campus-1',
        name: 'North Campus',
        location: 'Lahore',
        institutionId: 'institution-1',
        deletedAt: new Date('2026-05-05T10:00:00.000Z'),
        deletedBy: 'admin-1',
        deleteReason: null,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-05T09:00:00.000Z'),
      },
    ]);

    const result = await service.listDeletedItems(adminUser, {
      page: 1,
      limit: 10,
    });

    expect(result).toMatchObject({
      message: 'Recycle bin items retrieved successfully',
      data: {
        total: 2,
        items: [
          {
            entity: RecycleBinEntity.USER,
            id: 'user-1',
            deletedByUser: {
              id: 'admin-1',
              email: 'admin@nexus.test',
            },
          },
          {
            entity: RecycleBinEntity.CAMPUS,
            id: 'campus-1',
          },
        ],
      },
    });
  });

  it('restores a soft-deleted user and records an audit log', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Deleted User',
      email: 'deleted@nexus.test',
      role: UserRole.STAFF,
      status: UserStatus.ACTIVE,
      institutionId: 'institution-1',
      deletedAt: new Date('2026-05-06T10:00:00.000Z'),
    });
    prismaMock.user.update.mockResolvedValue({
      id: 'user-1',
      name: 'Deleted User',
      email: 'deleted@nexus.test',
      role: UserRole.STAFF,
      status: UserStatus.ACTIVE,
      institutionId: 'institution-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-07T09:00:00.000Z'),
    });

    const result = await service.restoreRecord(
      adminUser,
      RecycleBinEntity.USER,
      'user-1',
    );

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: {
        id: 'user-1',
        deletedAt: {
          not: null,
        },
      },
      data: {
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        institutionId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(auditLogServiceMock.log).toHaveBeenCalledWith(
      adminUser,
      expect.objectContaining({
        action: 'USER_RESTORED',
        entity: 'User',
        entityId: 'user-1',
      }),
    );
    expect(result).toMatchObject({
      message: 'User restored successfully',
      data: {
        id: 'user-1',
        email: 'deleted@nexus.test',
      },
    });
  });

  it('blocks admins from restoring soft-deleted superadmin accounts', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Super Admin',
      email: 'super@nexus.test',
      role: UserRole.SUPERADMIN,
      status: UserStatus.ACTIVE,
      institutionId: 'institution-1',
      deletedAt: new Date('2026-05-06T10:00:00.000Z'),
    });

    await expect(
      service.restoreRecord(adminUser, RecycleBinEntity.USER, 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lists soft-deleted fee payments under the finance recycle-bin entity', async () => {
    prismaMock.feePayment.findMany.mockResolvedValue([
      {
        id: 'payment-1',
        voucherId: 'voucher-1',
        month: 5,
        year: 2026,
        amountPaid: 15000,
        paymentDate: new Date('2026-05-05T00:00:00.000Z'),
        deletedAt: new Date('2026-05-07T10:00:00.000Z'),
        deletedBy: 'admin-1',
        deleteReason: 'duplicate payment',
        createdAt: new Date('2026-05-05T00:00:00.000Z'),
        updatedAt: new Date('2026-05-07T09:00:00.000Z'),
        voucher: {
          id: 'voucher-1',
          student: {
            name: 'Aisha Khan',
            campus: {
              institutionId: 'institution-1',
            },
          },
        },
      },
    ]);
    prismaMock.user.findMany.mockResolvedValueOnce([
      {
        id: 'admin-1',
        name: 'Admin User',
        email: 'admin@nexus.test',
        role: UserRole.ADMIN,
      },
    ]);

    const result = await service.listDeletedItems(adminUser, {
      page: 1,
      limit: 10,
      entity: RecycleBinEntity.FEE_PAYMENT,
    });

    expect(prismaMock.feePayment.findMany).toHaveBeenCalled();
    expect(result).toMatchObject({
      message: 'Recycle bin items retrieved successfully',
      data: {
        total: 1,
        items: [
          {
            entity: RecycleBinEntity.FEE_PAYMENT,
            id: 'payment-1',
            deleteReason: 'duplicate payment',
            deletedByUser: {
              id: 'admin-1',
              email: 'admin@nexus.test',
            },
          },
        ],
      },
    });
  });

  describe('permanentlyDeleteRecord — retention gate', () => {
    const baseCampus = {
      id: 'campus-1',
      name: 'North Campus',
      location: 'Lahore',
      institutionId: 'institution-1',
    };

    it('blocks a permanent delete before the retention period has elapsed', async () => {
      prismaMock.campus.findFirst.mockResolvedValue({
        ...baseCampus,
        deletedAt: new Date(), // deleted moments ago, default retention 30 days
      });

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.CAMPUS,
          'campus-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.campus.delete).not.toHaveBeenCalled();
    });

    it('allows a permanent delete once the retention period has elapsed with no active children', async () => {
      const longAgo = new Date();
      longAgo.setUTCDate(longAgo.getUTCDate() - 31);
      prismaMock.campus.findFirst.mockResolvedValue({
        ...baseCampus,
        deletedAt: longAgo,
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.CAMPUS,
        'campus-1',
      );

      expect(prismaMock.campus.delete).toHaveBeenCalled();
      expect(result).toMatchObject({
        message: 'Campus permanently deleted successfully',
      });
    });

    it('respects a custom institution retentionDays setting instead of the 30-day default', async () => {
      const eightDaysAgo = new Date();
      eightDaysAgo.setUTCDate(eightDaysAgo.getUTCDate() - 8);
      prismaMock.campus.findFirst.mockResolvedValue({
        ...baseCampus,
        deletedAt: eightDaysAgo,
      });
      prismaMock.institutionSetting.findUnique.mockResolvedValueOnce({
        value: { retentionDays: 7 },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.CAMPUS,
        'campus-1',
      );

      expect(prismaMock.campus.delete).toHaveBeenCalled();
      expect(result).toMatchObject({
        message: 'Campus permanently deleted successfully',
      });
    });
  });

  describe('permanentlyDeleteRecord — cascade guard', () => {
    const longAgo = new Date();
    longAgo.setUTCDate(longAgo.getUTCDate() - 31);
    const baseCampus = {
      id: 'campus-1',
      name: 'North Campus',
      location: 'Lahore',
      institutionId: 'institution-1',
      deletedAt: longAgo,
    };

    it('refuses to purge a campus that still has an active (non-deleted) level', async () => {
      prismaMock.campus.findFirst.mockResolvedValue(baseCampus);
      prismaMock.level.count.mockResolvedValueOnce(1);

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.CAMPUS,
          'campus-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.campus.delete).not.toHaveBeenCalled();
    });

    it('refuses to purge a campus whose only level is soft-deleted but still has an active class (recursive grandchild check)', async () => {
      prismaMock.campus.findFirst.mockResolvedValue(baseCampus);
      // No ACTIVE levels directly under the campus...
      prismaMock.level.count.mockResolvedValueOnce(0);
      // ...but the campus's one (soft-deleted) level still has an id...
      prismaMock.level.findMany.mockResolvedValueOnce([{ id: 'level-1' }]);
      // ...and that level has an ACTIVE class underneath it.
      prismaMock.academicClass.count.mockResolvedValueOnce(1);

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.CAMPUS,
          'campus-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.campus.delete).not.toHaveBeenCalled();
    });

    it('allows the purge once every descendant, at every depth, is clear', async () => {
      prismaMock.campus.findFirst.mockResolvedValue(baseCampus);
      prismaMock.level.count.mockResolvedValueOnce(0);
      prismaMock.level.findMany.mockResolvedValueOnce([{ id: 'level-1' }]);
      prismaMock.academicClass.count.mockResolvedValueOnce(0);
      prismaMock.academicClass.findMany.mockResolvedValueOnce([]);

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.CAMPUS,
        'campus-1',
      );

      expect(prismaMock.campus.delete).toHaveBeenCalled();
      expect(result).toMatchObject({
        message: 'Campus permanently deleted successfully',
      });
    });
  });

  describe('listDeletedItems — purge eligibility', () => {
    it('marks an item eligible once its retention window has elapsed', async () => {
      const longAgo = new Date();
      longAgo.setUTCDate(longAgo.getUTCDate() - 31);
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          name: 'North Campus',
          location: 'Lahore',
          institutionId: 'institution-1',
          deletedAt: longAgo,
          deletedBy: null,
          deleteReason: null,
          createdAt: longAgo,
          updatedAt: longAgo,
        },
      ]);

      const result = await service.listDeletedItems(adminUser, {
        page: 1,
        limit: 10,
        entity: RecycleBinEntity.CAMPUS,
      });

      expect(result.data.items[0]).toMatchObject({
        retentionDays: 30,
        daysLeft: 0,
        isPurgeEligible: true,
      });
    });

    it('marks a recently-deleted item as not yet eligible, with days remaining', async () => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      prismaMock.campus.findMany.mockResolvedValue([
        {
          id: 'campus-1',
          name: 'North Campus',
          location: 'Lahore',
          institutionId: 'institution-1',
          deletedAt: yesterday,
          deletedBy: null,
          deleteReason: null,
          createdAt: yesterday,
          updatedAt: yesterday,
        },
      ]);

      const result = await service.listDeletedItems(adminUser, {
        page: 1,
        limit: 10,
        entity: RecycleBinEntity.CAMPUS,
      });

      expect(result.data.items[0]).toMatchObject({
        retentionDays: 30,
        isPurgeEligible: false,
      });
      expect(result.data.items[0].daysLeft).toBeGreaterThan(0);
    });
  });

  describe('AcademicYear recycle bin wiring', () => {
    const baseAcademicYear = {
      id: 'year-1',
      name: '2025-26',
      institutionId: 'institution-1',
    };

    it('lists deleted academic years filtered by institution and search', async () => {
      prismaMock.academicYear.findMany.mockResolvedValue([
        {
          ...baseAcademicYear,
          deletedAt: new Date('2026-05-06T10:00:00.000Z'),
          deletedBy: 'admin-1',
          deleteReason: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-05-06T09:00:00.000Z'),
        },
      ]);
      prismaMock.user.findMany.mockResolvedValueOnce([
        {
          id: 'admin-1',
          name: 'Admin User',
          email: 'admin@nexus.test',
          role: UserRole.ADMIN,
        },
      ]);

      const result = await service.listDeletedItems(adminUser, {
        page: 1,
        limit: 10,
        entity: RecycleBinEntity.ACADEMIC_YEAR,
        search: '2025',
      });

      expect(prismaMock.academicYear.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: { not: null },
          institutionId: 'institution-1',
          name: { contains: '2025', mode: 'insensitive' },
        },
        select: {
          id: true,
          name: true,
          institutionId: true,
          deletedAt: true,
          deletedBy: true,
          deleteReason: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { deletedAt: 'desc' },
      });
      expect(result).toMatchObject({
        message: 'Recycle bin items retrieved successfully',
        data: {
          total: 1,
          items: [
            {
              entity: RecycleBinEntity.ACADEMIC_YEAR,
              id: 'year-1',
              label: '2025-26',
              subtitle: 'Academic Year',
            },
          ],
        },
      });
    });

    it('restores a soft-deleted academic year and records an audit log', async () => {
      prismaMock.academicYear.findFirst.mockResolvedValue({
        ...baseAcademicYear,
        deletedAt: new Date('2026-05-06T10:00:00.000Z'),
      });
      prismaMock.academicYear.update.mockResolvedValue({
        ...baseAcademicYear,
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.ACADEMIC_YEAR,
        'year-1',
      );

      expect(prismaMock.academicYear.update).toHaveBeenCalledWith({
        where: { id: 'year-1', deletedAt: { not: null } },
        data: { deletedAt: null, deletedBy: null, deleteReason: null },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'ACADEMIC_YEAR_RESTORED',
          entity: 'AcademicYear',
          entityId: 'year-1',
        }),
      );
      expect(result).toMatchObject({
        message: 'Academic year restored successfully',
        data: { id: 'year-1', name: '2025-26' },
      });
    });

    it('returns 404 restoring an academic year that is not in the recycle bin', async () => {
      prismaMock.academicYear.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.ACADEMIC_YEAR,
          'missing-year',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.academicYear.update).not.toHaveBeenCalled();
    });

    it('blocks an admin from restoring an academic year belonging to another institution', async () => {
      prismaMock.academicYear.findFirst.mockResolvedValue({
        ...baseAcademicYear,
        institutionId: 'institution-2',
        deletedAt: new Date('2026-05-06T10:00:00.000Z'),
      });

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.ACADEMIC_YEAR,
          'year-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.academicYear.update).not.toHaveBeenCalled();
    });

    it('surfaces a name collision on restore as a 409 conflict', async () => {
      prismaMock.academicYear.findFirst.mockResolvedValue({
        ...baseAcademicYear,
        deletedAt: new Date('2026-05-06T10:00:00.000Z'),
      });
      prismaMock.academicYear.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.ACADEMIC_YEAR,
          'year-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('permanently deletes an academic year once the retention period has elapsed', async () => {
      const longAgo = new Date();
      longAgo.setUTCDate(longAgo.getUTCDate() - 31);
      prismaMock.academicYear.findFirst.mockResolvedValue({
        ...baseAcademicYear,
        deletedAt: longAgo,
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.ACADEMIC_YEAR,
        'year-1',
      );

      expect(prismaMock.academicYear.delete).toHaveBeenCalledWith({
        where: { id: 'year-1', deletedAt: { not: null } },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'ACADEMIC_YEAR_PERMANENTLY_DELETED',
          entity: 'AcademicYear',
          entityId: 'year-1',
        }),
      );
      expect(result).toMatchObject({
        message: 'Academic year permanently deleted successfully',
        data: { id: 'year-1' },
      });
    });

    it('blocks a permanent delete of an academic year before the retention period has elapsed', async () => {
      prismaMock.academicYear.findFirst.mockResolvedValue({
        ...baseAcademicYear,
        deletedAt: new Date(), // deleted moments ago, default retention 30 days
      });

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.ACADEMIC_YEAR,
          'year-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.academicYear.delete).not.toHaveBeenCalled();
    });

    it('returns 404 permanently deleting an academic year that is not in the recycle bin', async () => {
      prismaMock.academicYear.findFirst.mockResolvedValue(null);

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.ACADEMIC_YEAR,
          'missing-year',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.academicYear.delete).not.toHaveBeenCalled();
    });
  });

  describe('StaffProfile recycle bin wiring', () => {
    const baseStaffProfile = {
      id: 'staff-profile-1',
      cnic: '12345-1234567-1',
      designation: 'Teacher',
      campus: { institutionId: 'institution-1' },
    };

    it('lists deleted staff profiles filtered by institution and search', async () => {
      prismaMock.staffProfile.findMany.mockResolvedValue([
        {
          ...baseStaffProfile,
          deletedAt: new Date('2026-05-06T10:00:00.000Z'),
          deletedBy: 'admin-1',
          deleteReason: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-05-06T09:00:00.000Z'),
        },
      ]);
      prismaMock.user.findMany.mockResolvedValueOnce([
        {
          id: 'admin-1',
          name: 'Admin User',
          email: 'admin@nexus.test',
          role: UserRole.ADMIN,
        },
      ]);

      const result = await service.listDeletedItems(adminUser, {
        page: 1,
        limit: 10,
        entity: RecycleBinEntity.STAFF_PROFILE,
        search: '12345',
      });

      expect(prismaMock.staffProfile.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: { not: null },
          campus: { institutionId: 'institution-1' },
          OR: [
            { cnic: { contains: '12345', mode: 'insensitive' } },
            { designation: { contains: '12345', mode: 'insensitive' } },
            { user: { name: { contains: '12345', mode: 'insensitive' } } },
          ],
        },
        select: {
          id: true,
          cnic: true,
          designation: true,
          campus: { select: { institutionId: true } },
          deletedAt: true,
          deletedBy: true,
          deleteReason: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { deletedAt: 'desc' },
      });
      expect(result).toMatchObject({
        message: 'Recycle bin items retrieved successfully',
        data: {
          total: 1,
          items: [
            {
              entity: RecycleBinEntity.STAFF_PROFILE,
              id: 'staff-profile-1',
              label: '12345-1234567-1',
              subtitle: 'Teacher',
            },
          ],
        },
      });
    });

    it('restores a soft-deleted staff profile and records an audit log', async () => {
      prismaMock.staffProfile.findFirst.mockResolvedValue({
        ...baseStaffProfile,
        deletedAt: new Date('2026-05-06T10:00:00.000Z'),
      });
      prismaMock.staffProfile.update.mockResolvedValue({
        ...baseStaffProfile,
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.STAFF_PROFILE,
        'staff-profile-1',
      );

      expect(prismaMock.staffProfile.update).toHaveBeenCalledWith({
        where: { id: 'staff-profile-1', deletedAt: { not: null } },
        data: { deletedAt: null, deletedBy: null, deleteReason: null },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'STAFF_PROFILE_RESTORED',
          entity: 'StaffProfile',
          entityId: 'staff-profile-1',
        }),
      );
      expect(result).toMatchObject({
        message: 'Staff profile restored successfully',
        data: { id: 'staff-profile-1' },
      });
    });

    it('returns 404 restoring a staff profile that is not in the recycle bin', async () => {
      prismaMock.staffProfile.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.STAFF_PROFILE,
          'missing-staff-profile',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.staffProfile.update).not.toHaveBeenCalled();
    });

    it('blocks an admin from restoring a staff profile belonging to another institution', async () => {
      prismaMock.staffProfile.findFirst.mockResolvedValue({
        ...baseStaffProfile,
        campus: { institutionId: 'institution-2' },
        deletedAt: new Date('2026-05-06T10:00:00.000Z'),
      });

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.STAFF_PROFILE,
          'staff-profile-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.staffProfile.update).not.toHaveBeenCalled();
    });

    it('surfaces a unique-constraint collision on restore as a 409 conflict', async () => {
      prismaMock.staffProfile.findFirst.mockResolvedValue({
        ...baseStaffProfile,
        deletedAt: new Date('2026-05-06T10:00:00.000Z'),
      });
      prismaMock.staffProfile.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.STAFF_PROFILE,
          'staff-profile-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('permanently deletes a staff profile once the retention period has elapsed', async () => {
      const longAgo = new Date();
      longAgo.setUTCDate(longAgo.getUTCDate() - 31);
      prismaMock.staffProfile.findFirst.mockResolvedValue({
        ...baseStaffProfile,
        deletedAt: longAgo,
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.STAFF_PROFILE,
        'staff-profile-1',
      );

      expect(prismaMock.staffProfile.delete).toHaveBeenCalledWith({
        where: { id: 'staff-profile-1', deletedAt: { not: null } },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'STAFF_PROFILE_PERMANENTLY_DELETED',
          entity: 'StaffProfile',
          entityId: 'staff-profile-1',
        }),
      );
      expect(result).toMatchObject({
        message: 'Staff profile permanently deleted successfully',
        data: { id: 'staff-profile-1' },
      });
    });

    it('blocks a permanent delete of a staff profile before the retention period has elapsed', async () => {
      prismaMock.staffProfile.findFirst.mockResolvedValue({
        ...baseStaffProfile,
        deletedAt: new Date(), // deleted moments ago, default retention 30 days
      });

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.STAFF_PROFILE,
          'staff-profile-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.staffProfile.delete).not.toHaveBeenCalled();
    });

    it('returns 404 permanently deleting a staff profile that is not in the recycle bin', async () => {
      prismaMock.staffProfile.findFirst.mockResolvedValue(null);

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.STAFF_PROFILE,
          'missing-staff-profile',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.staffProfile.delete).not.toHaveBeenCalled();
    });
  });
});
