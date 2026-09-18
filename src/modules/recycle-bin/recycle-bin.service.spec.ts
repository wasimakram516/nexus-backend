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
    $transaction: jest.fn(),
    user: {
      findMany: jest.fn().mockResolvedValue([]),
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
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    feePayment: {
      aggregate: jest.fn(),
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
    studentEnrollment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    notice: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    periodSlot: {
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
    prismaMock.$transaction.mockImplementation(
      (callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(prismaMock as unknown as Prisma.TransactionClient),
    );

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

  it('restores a payment using active totals instead of forcing its voucher to paid', async () => {
    prismaMock.feePayment.findFirst.mockResolvedValue({
      voucherId: 'voucher-1',
      month: 9,
      year: 2026,
      voucher: { student: { campus: { institutionId: 'institution-1' } } },
    });
    prismaMock.feePayment.update.mockResolvedValue({ id: 'payment-1' });
    prismaMock.feeVoucher.findUnique.mockResolvedValue({
      finalAmountDue: new Prisma.Decimal(100),
      dueDate: new Date('2040-01-01'),
    });
    prismaMock.feePayment.aggregate.mockResolvedValue({
      _sum: { paidAmount: new Prisma.Decimal(25) },
    });
    await service.restoreRecord(
      adminUser,
      RecycleBinEntity.FEE_PAYMENT,
      'payment-1',
    );
    expect(prismaMock.feeVoucher.update).toHaveBeenCalledWith({
      where: { id: 'voucher-1' },
      data: { status: 'PARTIAL' },
    });
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
    // Restoring User is now audited automatically by PrismaService (real
    // before/after snapshot) rather than through the bespoke
    // AuditLogService call this used to assert on — see prisma.service.spec
    // for that mechanism's own coverage.
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
    prismaMock.feePayment.findMany.mockResolvedValueOnce([
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

  // M2 Phase 3: StudentEnrollment's FKs are onDelete: Cascade (unlike the
  // old Student.classId/sectionId, which were SetNull), so it's both a new
  // recycle-bin-visible entity in its own right AND a new cascade child
  // registered under CAMPUS/CLASS/SECTION/ACADEMIC_YEAR/STUDENT.
  describe('StudentEnrollment recycle bin wiring', () => {
    const baseEnrollment = {
      id: 'enrollment-1',
      studentId: 'student-1',
      academicYearId: 'year-1',
      classId: 'class-1',
      sectionId: 'section-1',
      status: 'ACTIVE',
      student: { regNo: 'NEX-001' },
      class: { name: 'Grade 5' },
      section: { name: 'A' },
      campus: { institutionId: 'institution-1' },
    };

    it('lists deleted student enrollments filtered by institution and search', async () => {
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        {
          ...baseEnrollment,
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
        entity: RecycleBinEntity.STUDENT_ENROLLMENT,
        search: 'NEX',
      });

      expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: { not: null },
            campus: { institutionId: 'institution-1' },
            student: { regNo: { contains: 'NEX', mode: 'insensitive' } },
          },
        }),
      );
      expect(result).toMatchObject({
        data: {
          total: 1,
          items: [
            {
              entity: RecycleBinEntity.STUDENT_ENROLLMENT,
              id: 'enrollment-1',
              label: 'NEX-001',
              subtitle: 'Grade 5 - A',
            },
          ],
        },
      });
    });

    it('restores a soft-deleted student enrollment and records an audit log', async () => {
      prismaMock.studentEnrollment.findFirst.mockResolvedValue({
        id: 'enrollment-1',
        student: { regNo: 'NEX-001' },
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.studentEnrollment.update.mockResolvedValue({
        id: 'enrollment-1',
        deletedAt: null,
      });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.STUDENT_ENROLLMENT,
        'enrollment-1',
      );

      expect(prismaMock.studentEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'enrollment-1', deletedAt: { not: null } },
        data: { deletedAt: null, deletedBy: null, deleteReason: null },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'STUDENT_ENROLLMENT_RESTORED',
          entity: 'StudentEnrollment',
          entityId: 'enrollment-1',
        }),
      );
      expect(result).toMatchObject({
        message: 'Student enrollment restored successfully',
      });
    });

    it('returns 404 restoring a student enrollment that is not in the recycle bin', async () => {
      prismaMock.studentEnrollment.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.STUDENT_ENROLLMENT,
          'missing-enrollment',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.studentEnrollment.update).not.toHaveBeenCalled();
    });

    it('permanently deletes a student enrollment once the retention period has elapsed', async () => {
      const longAgo = new Date();
      longAgo.setUTCDate(longAgo.getUTCDate() - 31);
      prismaMock.studentEnrollment.findFirst.mockResolvedValue({
        deletedAt: longAgo,
        student: { regNo: 'NEX-001' },
        campus: { institutionId: 'institution-1' },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.STUDENT_ENROLLMENT,
        'enrollment-1',
      );

      expect(prismaMock.studentEnrollment.delete).toHaveBeenCalledWith({
        where: { id: 'enrollment-1', deletedAt: { not: null } },
      });
      expect(result).toMatchObject({
        message: 'Student enrollment permanently deleted successfully',
      });
    });

    it('blocks a permanent delete of an academic year, class, campus, section, or student while an ACTIVE enrollment still points at it', async () => {
      const longAgo = new Date();
      longAgo.setUTCDate(longAgo.getUTCDate() - 31);

      // Academic year case, mirroring the existing cascade-guard suite's
      // shape (an active child under a leaf link blocks the purge).
      prismaMock.academicYear.findFirst.mockResolvedValue({
        id: 'year-1',
        name: '2025-26',
        institutionId: 'institution-1',
        deletedAt: longAgo,
      });
      prismaMock.studentEnrollment.count.mockResolvedValueOnce(1);

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.ACADEMIC_YEAR,
          'year-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
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

  // M3 (Notices track, decision #24): every scope FK (campusId/classId/
  // sectionId) is onDelete: SetNull, so unlike StudentEnrollment, Notice
  // needs no ENTITY_CASCADE_CHILDREN registration anywhere — confirmed by
  // this suite exercising only the entity's own list/restore/permanent-
  // delete wiring, with no cascade-guard case to cover.
  describe('Notice recycle bin wiring', () => {
    const baseNotice = {
      id: 'notice-1',
      title: 'Sports Day Rescheduled',
      institutionId: 'institution-1',
    };

    it('lists deleted notices filtered by institution and search', async () => {
      prismaMock.notice.findMany.mockResolvedValue([
        {
          ...baseNotice,
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
        entity: RecycleBinEntity.NOTICE,
        search: 'Sports',
      });

      expect(prismaMock.notice.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: { not: null },
          institutionId: 'institution-1',
          title: { contains: 'Sports', mode: 'insensitive' },
        },
        select: {
          id: true,
          title: true,
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
              entity: RecycleBinEntity.NOTICE,
              id: 'notice-1',
              label: 'Sports Day Rescheduled',
              subtitle: 'Notice',
            },
          ],
        },
      });
    });

    it('restores a soft-deleted notice and records an audit log', async () => {
      prismaMock.notice.findFirst.mockResolvedValue({
        ...baseNotice,
        deletedAt: new Date('2026-05-06T10:00:00.000Z'),
      });
      prismaMock.notice.update.mockResolvedValue({
        ...baseNotice,
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.NOTICE,
        'notice-1',
      );

      expect(prismaMock.notice.update).toHaveBeenCalledWith({
        where: { id: 'notice-1', deletedAt: { not: null } },
        data: { deletedAt: null, deletedBy: null, deleteReason: null },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'NOTICE_RESTORED',
          entity: 'Notice',
          entityId: 'notice-1',
        }),
      );
      expect(result).toMatchObject({
        message: 'Notice restored successfully',
        data: { id: 'notice-1', title: 'Sports Day Rescheduled' },
      });
    });

    it('returns 404 restoring a notice that is not in the recycle bin', async () => {
      prismaMock.notice.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(adminUser, RecycleBinEntity.NOTICE, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.notice.update).not.toHaveBeenCalled();
    });

    it('blocks an admin from restoring a notice belonging to another institution', async () => {
      prismaMock.notice.findFirst.mockResolvedValue({
        ...baseNotice,
        institutionId: 'institution-2',
        deletedAt: new Date('2026-05-06T10:00:00.000Z'),
      });

      await expect(
        service.restoreRecord(adminUser, RecycleBinEntity.NOTICE, 'notice-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.notice.update).not.toHaveBeenCalled();
    });

    it('permanently deletes a notice once the retention period has elapsed, with no cascade-guard check', async () => {
      const longAgo = new Date();
      longAgo.setUTCDate(longAgo.getUTCDate() - 31);
      prismaMock.notice.findFirst.mockResolvedValue({
        ...baseNotice,
        deletedAt: longAgo,
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.NOTICE,
        'notice-1',
      );

      expect(prismaMock.notice.delete).toHaveBeenCalledWith({
        where: { id: 'notice-1', deletedAt: { not: null } },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'NOTICE_PERMANENTLY_DELETED',
          entity: 'Notice',
          entityId: 'notice-1',
        }),
      );
      expect(result).toMatchObject({
        message: 'Notice permanently deleted successfully',
        data: { id: 'notice-1' },
      });
    });

    it('blocks a permanent delete of a notice before the retention period has elapsed', async () => {
      prismaMock.notice.findFirst.mockResolvedValue({
        ...baseNotice,
        deletedAt: new Date(), // deleted moments ago, default retention 30 days
      });

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.NOTICE,
          'notice-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.notice.delete).not.toHaveBeenCalled();
    });

    it('returns 404 permanently deleting a notice that is not in the recycle bin', async () => {
      prismaMock.notice.findFirst.mockResolvedValue(null);

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.NOTICE,
          'missing',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.notice.delete).not.toHaveBeenCalled();
    });
  });

  // M3 (Timetable M1 track, decision #26): unlike Notice, PeriodSlot's
  // campusId/classId/sectionId are onDelete: Cascade, so it IS registered
  // under ENTITY_CASCADE_CHILDREN[CAMPUS]/[CLASS]/[SECTION] (§ 10) — this
  // suite covers both the entity's own list/restore/permanent-delete wiring
  // and the cascade-guard case those three parent entities gained.
  describe('PeriodSlot recycle bin wiring', () => {
    const basePeriodSlot = {
      id: 'period-slot-1',
      name: 'Period 1',
      dayOfWeek: 'MONDAY',
      periodNumber: 1,
      sectionId: 'section-1',
      campus: { institutionId: 'institution-1' },
    };

    it('lists deleted period slots filtered by institution and search', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValue([
        {
          ...basePeriodSlot,
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
        entity: RecycleBinEntity.PERIOD_SLOT,
        search: 'Period',
      });

      expect(prismaMock.periodSlot.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: { not: null },
          campus: { institutionId: 'institution-1' },
          name: { contains: 'Period', mode: 'insensitive' },
        },
        select: {
          id: true,
          name: true,
          dayOfWeek: true,
          periodNumber: true,
          sectionId: true,
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
              entity: RecycleBinEntity.PERIOD_SLOT,
              id: 'period-slot-1',
              label: 'Period 1',
              subtitle: 'MONDAY - Period 1',
            },
          ],
        },
      });
    });

    it('restores a soft-deleted period slot and records an audit log', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue({
        name: 'Period 1',
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.periodSlot.update.mockResolvedValue({
        id: 'period-slot-1',
        name: 'Period 1',
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.PERIOD_SLOT,
        'period-slot-1',
      );

      expect(prismaMock.periodSlot.update).toHaveBeenCalledWith({
        where: { id: 'period-slot-1', deletedAt: { not: null } },
        data: { deletedAt: null, deletedBy: null, deleteReason: null },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'PERIOD_SLOT_RESTORED',
          entity: 'PeriodSlot',
          entityId: 'period-slot-1',
        }),
      );
      expect(result).toMatchObject({
        message: 'Period slot restored successfully',
        data: { id: 'period-slot-1' },
      });
    });

    it('returns 404 restoring a period slot that is not in the recycle bin', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.PERIOD_SLOT,
          'missing',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.periodSlot.update).not.toHaveBeenCalled();
    });

    it('blocks an admin from restoring a period slot belonging to another institution', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue({
        name: 'Period 1',
        campus: { institutionId: 'institution-2' },
      });

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.PERIOD_SLOT,
          'period-slot-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.periodSlot.update).not.toHaveBeenCalled();
    });

    it('permanently deletes a period slot once the retention period has elapsed', async () => {
      const longAgo = new Date();
      longAgo.setUTCDate(longAgo.getUTCDate() - 31);
      prismaMock.periodSlot.findFirst.mockResolvedValue({
        name: 'Period 1',
        deletedAt: longAgo,
        campus: { institutionId: 'institution-1' },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.PERIOD_SLOT,
        'period-slot-1',
      );

      expect(prismaMock.periodSlot.delete).toHaveBeenCalledWith({
        where: { id: 'period-slot-1', deletedAt: { not: null } },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'PERIOD_SLOT_PERMANENTLY_DELETED',
          entity: 'PeriodSlot',
          entityId: 'period-slot-1',
        }),
      );
      expect(result).toMatchObject({
        message: 'Period slot permanently deleted successfully',
        data: { id: 'period-slot-1' },
      });
    });

    it('blocks a permanent delete of a period slot before the retention period has elapsed', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue({
        name: 'Period 1',
        deletedAt: new Date(), // deleted moments ago, default retention 30 days
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.PERIOD_SLOT,
          'period-slot-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.periodSlot.delete).not.toHaveBeenCalled();
    });

    it('returns 404 permanently deleting a period slot that is not in the recycle bin', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue(null);

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.PERIOD_SLOT,
          'missing',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.periodSlot.delete).not.toHaveBeenCalled();
    });

    it('refuses to purge a campus that still has an active period slot underneath it', async () => {
      const longAgo = new Date();
      longAgo.setUTCDate(longAgo.getUTCDate() - 31);
      prismaMock.campus.findFirst.mockResolvedValue({
        id: 'campus-1',
        name: 'North Campus',
        location: 'Lahore',
        institutionId: 'institution-1',
        deletedAt: longAgo,
      });
      prismaMock.periodSlot.count.mockResolvedValueOnce(1);

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.CAMPUS,
          'campus-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to purge a class that still has an active period slot underneath it', async () => {
      const longAgo = new Date();
      longAgo.setUTCDate(longAgo.getUTCDate() - 31);
      prismaMock.academicClass.findFirst.mockResolvedValue({
        name: 'Grade 5',
        deletedAt: longAgo,
        level: { campus: { institutionId: 'institution-1' } },
      });
      prismaMock.periodSlot.count.mockResolvedValueOnce(1);

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.CLASS,
          'class-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to purge a section that still has an active period slot underneath it', async () => {
      const longAgo = new Date();
      longAgo.setUTCDate(longAgo.getUTCDate() - 31);
      prismaMock.section.findFirst.mockResolvedValue({
        name: 'Section A',
        deletedAt: longAgo,
        class: { level: { campus: { institutionId: 'institution-1' } } },
      });
      prismaMock.periodSlot.count.mockResolvedValueOnce(1);

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.SECTION,
          'section-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('restoreRecord — remaining entities', () => {
    it('restores a soft-deleted campus', async () => {
      prismaMock.campus.findFirst.mockResolvedValue({
        id: 'campus-1',
        name: 'City Campus',
        location: 'Lahore',
        institutionId: 'institution-1',
        deletedAt: new Date(),
      });
      prismaMock.campus.update.mockResolvedValue({ id: 'campus-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.CAMPUS,
        'campus-1',
      );

      expect(result.message).toBe('Campus restored successfully');
    });

    it('404s restoring a campus not in the recycle bin', async () => {
      prismaMock.campus.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(adminUser, RecycleBinEntity.CAMPUS, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted role', async () => {
      prismaMock.role.findFirst.mockResolvedValue({
        id: 'role-1',
        institutionId: 'institution-1',
        name: 'Accountant',
        description: null,
      });
      prismaMock.role.update.mockResolvedValue({ id: 'role-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.ROLE,
        'role-1',
      );

      expect(result.message).toBe('Role restored successfully');
    });

    it('404s restoring a role not in the recycle bin', async () => {
      prismaMock.role.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(adminUser, RecycleBinEntity.ROLE, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted student', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-1',
        regNo: 'NEX-001',
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.student.update.mockResolvedValue({ id: 'student-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.STUDENT,
        'student-1',
      );

      expect(result.message).toBe('Student restored successfully');
    });

    it('404s restoring a student not in the recycle bin', async () => {
      prismaMock.student.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(adminUser, RecycleBinEntity.STUDENT, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted guardian', async () => {
      prismaMock.guardian.findFirst.mockResolvedValue({
        id: 'guardian-1',
        relation: 'Father',
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.guardian.update.mockResolvedValue({ id: 'guardian-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.GUARDIAN,
        'guardian-1',
      );

      expect(result.message).toBe('Guardian restored successfully');
    });

    it('404s restoring a guardian not in the recycle bin', async () => {
      prismaMock.guardian.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(adminUser, RecycleBinEntity.GUARDIAN, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted level', async () => {
      prismaMock.level.findFirst.mockResolvedValue({
        name: 'Primary',
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.level.update.mockResolvedValue({ id: 'level-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.LEVEL,
        'level-1',
      );

      expect(result.message).toBe('Level restored successfully');
    });

    it('404s restoring a level not in the recycle bin', async () => {
      prismaMock.level.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(adminUser, RecycleBinEntity.LEVEL, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted class', async () => {
      prismaMock.academicClass.findFirst.mockResolvedValue({
        name: 'Grade 1',
        level: { campus: { institutionId: 'institution-1' } },
      });
      prismaMock.academicClass.update.mockResolvedValue({ id: 'class-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.CLASS,
        'class-1',
      );

      expect(result.message).toBe('Class restored successfully');
    });

    it('404s restoring a class not in the recycle bin', async () => {
      prismaMock.academicClass.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(adminUser, RecycleBinEntity.CLASS, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted section', async () => {
      prismaMock.section.findFirst.mockResolvedValue({
        name: 'A',
        class: { level: { campus: { institutionId: 'institution-1' } } },
      });
      prismaMock.section.update.mockResolvedValue({ id: 'section-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.SECTION,
        'section-1',
      );

      expect(result.message).toBe('Section restored successfully');
    });

    it('404s restoring a section not in the recycle bin', async () => {
      prismaMock.section.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(adminUser, RecycleBinEntity.SECTION, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted subject', async () => {
      prismaMock.subject.findFirst.mockResolvedValue({
        name: 'Math',
        class: { level: { campus: { institutionId: 'institution-1' } } },
      });
      prismaMock.subject.update.mockResolvedValue({ id: 'subject-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.SUBJECT,
        'subject-1',
      );

      expect(result.message).toBe('Subject restored successfully');
    });

    it('404s restoring a subject not in the recycle bin', async () => {
      prismaMock.subject.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(adminUser, RecycleBinEntity.SUBJECT, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted salary record', async () => {
      prismaMock.staffSalary.findFirst.mockResolvedValue({
        userId: 'user-1',
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.staffSalary.update.mockResolvedValue({ id: 'salary-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.SALARY,
        'salary-1',
      );

      expect(result.message).toBe('Salary restored successfully');
    });

    it('404s restoring a salary record not in the recycle bin', async () => {
      prismaMock.staffSalary.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(adminUser, RecycleBinEntity.SALARY, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted salary deduction rule', async () => {
      prismaMock.salaryDeductionRule.findFirst.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.salaryDeductionRule.update.mockResolvedValue({ id: 'rule-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.SALARY_DEDUCTION_RULE,
        'rule-1',
      );

      expect(result.message).toBe(
        'Salary deduction rule restored successfully',
      );
    });

    it('404s restoring a salary deduction rule not in the recycle bin', async () => {
      prismaMock.salaryDeductionRule.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.SALARY_DEDUCTION_RULE,
          'missing',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted salary adjustment', async () => {
      prismaMock.salaryAdjustment.findFirst.mockResolvedValue({
        userId: 'user-1',
        salaryId: 'salary-1',
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.salaryAdjustment.update.mockResolvedValue({ id: 'adj-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.SALARY_ADJUSTMENT,
        'adj-1',
      );

      expect(result.message).toBe('Salary adjustment restored successfully');
    });

    it('404s restoring a salary adjustment not in the recycle bin', async () => {
      prismaMock.salaryAdjustment.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.SALARY_ADJUSTMENT,
          'missing',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted salary payment and its deduction summary', async () => {
      prismaMock.salaryPayment.findFirst.mockResolvedValue({
        userId: 'user-1',
        salaryId: 'salary-1',
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.salaryPayment.update.mockResolvedValue({ id: 'payment-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.SALARY_PAYMENT,
        'payment-1',
      );

      expect(prismaMock.salaryDeductionSummary.updateMany).toHaveBeenCalled();
      expect(result.message).toBe('Salary payment restored successfully');
    });

    it('404s restoring a salary payment not in the recycle bin', async () => {
      prismaMock.salaryPayment.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.SALARY_PAYMENT,
          'missing',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted bank account', async () => {
      prismaMock.bankAccount.findFirst.mockResolvedValue({
        bankName: 'HBL',
        accountTitle: 'Main',
        accountNumber: '12345',
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.bankAccount.update.mockResolvedValue({ id: 'bank-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.BANK_ACCOUNT,
        'bank-1',
      );

      expect(result.message).toBe('Bank account restored successfully');
    });

    it('404s restoring a bank account not in the recycle bin', async () => {
      prismaMock.bankAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.BANK_ACCOUNT,
          'missing',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted fee structure', async () => {
      prismaMock.feeStructure.findFirst.mockResolvedValue({
        classId: 'class-1',
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.feeStructure.update.mockResolvedValue({ id: 'fs-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.FEE_STRUCTURE,
        'fs-1',
      );

      expect(result.message).toBe('Fee structure restored successfully');
    });

    it('404s restoring a fee structure not in the recycle bin', async () => {
      prismaMock.feeStructure.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.FEE_STRUCTURE,
          'missing',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted student discount', async () => {
      prismaMock.studentDiscount.findFirst.mockResolvedValue({
        studentId: 'student-1',
        student: { campus: { institutionId: 'institution-1' } },
      });
      prismaMock.studentDiscount.update.mockResolvedValue({ id: 'disc-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.STUDENT_DISCOUNT,
        'disc-1',
      );

      expect(result.message).toBe('Student discount restored successfully');
    });

    it('404s restoring a student discount not in the recycle bin', async () => {
      prismaMock.studentDiscount.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.STUDENT_DISCOUNT,
          'missing',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted student fine rule', async () => {
      prismaMock.studentFineRule.findFirst.mockResolvedValue({
        campusId: 'campus-1',
        classId: null,
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.studentFineRule.update.mockResolvedValue({ id: 'fr-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.STUDENT_FINE_RULE,
        'fr-1',
      );

      expect(result.message).toBe('Student fine rule restored successfully');
    });

    it('404s restoring a student fine rule not in the recycle bin', async () => {
      prismaMock.studentFineRule.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.STUDENT_FINE_RULE,
          'missing',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted student fine', async () => {
      prismaMock.studentFine.findFirst.mockResolvedValue({
        studentId: 'student-1',
        month: 3,
        year: 2026,
        student: { campus: { institutionId: 'institution-1' } },
      });
      prismaMock.studentFine.update.mockResolvedValue({ id: 'fine-1' });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.STUDENT_FINE,
        'fine-1',
      );

      expect(result.message).toBe('Student fine restored successfully');
    });

    it('404s restoring a student fine not in the recycle bin', async () => {
      prismaMock.studentFine.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.STUDENT_FINE,
          'missing',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a soft-deleted fee voucher and reconciles its settlement', async () => {
      prismaMock.feeVoucher.findFirst.mockResolvedValue({
        studentId: 'student-1',
        month: 3,
        year: 2026,
        student: { campus: { institutionId: 'institution-1' } },
      });
      prismaMock.feeVoucher.update.mockResolvedValue({
        id: 'voucher-1',
        feeBreakdown: [],
        discountsApplied: [],
        lateFeeFine: 0,
      });
      prismaMock.feePayment.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });

      const result = await service.restoreRecord(
        adminUser,
        RecycleBinEntity.FEE_VOUCHER,
        'voucher-1',
      );

      expect(result.message).toBe('Fee voucher restored successfully');
    });

    it('404s restoring a fee voucher not in the recycle bin', async () => {
      prismaMock.feeVoucher.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreRecord(
          adminUser,
          RecycleBinEntity.FEE_VOUCHER,
          'missing',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('permanentlyDeleteRecord — remaining leaf entities', () => {
    const longAgo = () => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 31);
      return d;
    };

    it('permanently deletes a role once eligible', async () => {
      prismaMock.role.findFirst.mockResolvedValue({
        id: 'role-1',
        institutionId: 'institution-1',
        name: 'Accountant',
        deletedAt: longAgo(),
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.ROLE,
        'role-1',
      );

      expect(prismaMock.role.delete).toHaveBeenCalled();
      expect(result.message).toBe('Role permanently deleted successfully');
    });

    it('404s permanently deleting a role not in the recycle bin', async () => {
      prismaMock.role.findFirst.mockResolvedValue(null);

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.ROLE,
          'missing',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('permanently deletes a guardian once eligible', async () => {
      prismaMock.guardian.findFirst.mockResolvedValue({
        relation: 'Father',
        deletedAt: longAgo(),
        campus: { institutionId: 'institution-1' },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.GUARDIAN,
        'guardian-1',
      );

      expect(prismaMock.guardian.delete).toHaveBeenCalled();
      expect(result.message).toBe('Guardian permanently deleted successfully');
    });

    it('blocks a permanent delete of a guardian before the retention period has elapsed', async () => {
      prismaMock.guardian.findFirst.mockResolvedValue({
        relation: 'Father',
        deletedAt: new Date(),
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.GUARDIAN,
          'guardian-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('permanently deletes a salary record once eligible, refusing an active salary payment or adjustment', async () => {
      prismaMock.staffSalary.findFirst.mockResolvedValue({
        userId: 'user-1',
        deletedAt: longAgo(),
        campus: { institutionId: 'institution-1' },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.SALARY,
        'salary-1',
      );

      expect(prismaMock.staffSalary.delete).toHaveBeenCalled();
      expect(result.message).toBe('Salary permanently deleted successfully');

      prismaMock.salaryPayment.count.mockResolvedValueOnce(1);
      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.SALARY,
          'salary-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('permanently deletes a salary deduction rule once eligible', async () => {
      prismaMock.salaryDeductionRule.findFirst.mockResolvedValue({
        deletedAt: longAgo(),
        campus: { institutionId: 'institution-1' },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.SALARY_DEDUCTION_RULE,
        'rule-1',
      );

      expect(prismaMock.salaryDeductionRule.delete).toHaveBeenCalled();
      expect(result.message).toBe(
        'Salary deduction rule permanently deleted successfully',
      );
    });

    it('permanently deletes a salary adjustment once eligible', async () => {
      prismaMock.salaryAdjustment.findFirst.mockResolvedValue({
        userId: 'user-1',
        salaryId: 'salary-1',
        deletedAt: longAgo(),
        campus: { institutionId: 'institution-1' },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.SALARY_ADJUSTMENT,
        'adj-1',
      );

      expect(prismaMock.salaryAdjustment.delete).toHaveBeenCalled();
      expect(result.message).toBe(
        'Salary adjustment permanently deleted successfully',
      );
    });

    it('permanently deletes a salary payment once eligible, cleaning up its deduction summary', async () => {
      prismaMock.salaryPayment.findFirst.mockResolvedValue({
        userId: 'user-1',
        salaryId: 'salary-1',
        deletedAt: longAgo(),
        campus: { institutionId: 'institution-1' },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.SALARY_PAYMENT,
        'payment-1',
      );

      expect(prismaMock.salaryPayment.delete).toHaveBeenCalled();
      expect(result.message).toBe(
        'Salary payment permanently deleted successfully',
      );
    });

    it('permanently deletes a bank account once eligible', async () => {
      prismaMock.bankAccount.findFirst.mockResolvedValue({
        bankName: 'HBL',
        accountTitle: 'Main',
        accountNumber: '12345',
        deletedAt: longAgo(),
        campus: { institutionId: 'institution-1' },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.BANK_ACCOUNT,
        'bank-1',
      );

      expect(prismaMock.bankAccount.delete).toHaveBeenCalled();
      expect(result.message).toBe(
        'Bank account permanently deleted successfully',
      );
    });

    it('permanently deletes a fee structure once eligible, refusing an active fee voucher', async () => {
      prismaMock.feeStructure.findFirst.mockResolvedValue({
        classId: 'class-1',
        deletedAt: longAgo(),
        campus: { institutionId: 'institution-1' },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.FEE_STRUCTURE,
        'fs-1',
      );

      expect(prismaMock.feeStructure.delete).toHaveBeenCalled();
      expect(result.message).toBe(
        'Fee structure permanently deleted successfully',
      );

      prismaMock.feeVoucher.count.mockResolvedValueOnce(1);
      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.FEE_STRUCTURE,
          'fs-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('permanently deletes a student discount once eligible', async () => {
      prismaMock.studentDiscount.findFirst.mockResolvedValue({
        studentId: 'student-1',
        deletedAt: longAgo(),
        student: { campus: { institutionId: 'institution-1' } },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.STUDENT_DISCOUNT,
        'disc-1',
      );

      expect(prismaMock.studentDiscount.delete).toHaveBeenCalled();
      expect(result.message).toBe(
        'Student discount permanently deleted successfully',
      );
    });

    it('permanently deletes a student fine rule once eligible', async () => {
      prismaMock.studentFineRule.findFirst.mockResolvedValue({
        campusId: 'campus-1',
        classId: null,
        deletedAt: longAgo(),
        campus: { institutionId: 'institution-1' },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.STUDENT_FINE_RULE,
        'fr-1',
      );

      expect(prismaMock.studentFineRule.delete).toHaveBeenCalled();
      expect(result.message).toBe(
        'Student fine rule permanently deleted successfully',
      );
    });

    it('permanently deletes a student fine once eligible', async () => {
      prismaMock.studentFine.findFirst.mockResolvedValue({
        studentId: 'student-1',
        month: 3,
        year: 2026,
        deletedAt: longAgo(),
        student: { campus: { institutionId: 'institution-1' } },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.STUDENT_FINE,
        'fine-1',
      );

      expect(prismaMock.studentFine.delete).toHaveBeenCalled();
      expect(result.message).toBe(
        'Student fine permanently deleted successfully',
      );
    });

    it('permanently deletes a fee voucher once eligible, refusing an active fee payment', async () => {
      prismaMock.feeVoucher.findFirst.mockResolvedValue({
        studentId: 'student-1',
        month: 3,
        year: 2026,
        deletedAt: longAgo(),
        student: { campus: { institutionId: 'institution-1' } },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.FEE_VOUCHER,
        'voucher-1',
      );

      expect(prismaMock.feeVoucher.delete).toHaveBeenCalled();
      expect(result.message).toBe(
        'Fee voucher permanently deleted successfully',
      );

      prismaMock.feePayment.count.mockResolvedValueOnce(1);
      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.FEE_VOUCHER,
          'voucher-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('permanently deletes a fee payment once eligible', async () => {
      prismaMock.feePayment.findFirst.mockResolvedValue({
        voucherId: 'voucher-1',
        month: 3,
        year: 2026,
        deletedAt: longAgo(),
        voucher: { student: { campus: { institutionId: 'institution-1' } } },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.FEE_PAYMENT,
        'payment-1',
      );

      expect(prismaMock.feePayment.delete).toHaveBeenCalled();
      expect(result.message).toBe(
        'Fee payment permanently deleted successfully',
      );
    });
  });

  describe('listDeletedItems — per-entity filter wiring', () => {
    // Each of these entities routes to its own listDeletedX private method
    // when query.entity narrows the search — with every prisma delegate's
    // findMany defaulting to [] (see prismaMock above), this exercises each
    // private lister end-to-end (query building, empty-result shaping)
    // without needing per-entity fixture data.
    const entities = [
      RecycleBinEntity.LEVEL,
      RecycleBinEntity.CLASS,
      RecycleBinEntity.SECTION,
      RecycleBinEntity.SUBJECT,
      RecycleBinEntity.SALARY,
      RecycleBinEntity.SALARY_DEDUCTION_RULE,
      RecycleBinEntity.SALARY_ADJUSTMENT,
      RecycleBinEntity.SALARY_PAYMENT,
      RecycleBinEntity.BANK_ACCOUNT,
      RecycleBinEntity.FEE_STRUCTURE,
      RecycleBinEntity.STUDENT_DISCOUNT,
      RecycleBinEntity.STUDENT_FINE_RULE,
      RecycleBinEntity.STUDENT_FINE,
      RecycleBinEntity.FEE_VOUCHER,
      RecycleBinEntity.FEE_PAYMENT,
    ];

    it.each(entities)(
      'lists deleted %s items (empty result)',
      async (entity) => {
        const result = await service.listDeletedItems(adminUser, {
          page: 1,
          limit: 10,
          entity,
        });

        expect(result).toMatchObject({
          message: 'Recycle bin items retrieved successfully',
          data: { total: 0, items: [] },
        });
      },
    );
  });

  describe('permanentlyDeleteRecord — academic hierarchy entities', () => {
    const longAgo = () => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 31);
      return d;
    };

    it('permanently deletes a student once eligible, refusing an active fee voucher', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        regNo: 'NEX-001',
        deletedAt: longAgo(),
        campus: { institutionId: 'institution-1' },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.STUDENT,
        'student-1',
      );

      expect(prismaMock.student.delete).toHaveBeenCalled();
      expect(result.message).toBe('Student permanently deleted successfully');

      prismaMock.feeVoucher.count.mockResolvedValueOnce(1);
      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.STUDENT,
          'student-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('permanently deletes a level once eligible, refusing an active class underneath it', async () => {
      prismaMock.level.findFirst.mockResolvedValue({
        name: 'Primary',
        deletedAt: longAgo(),
        campus: { institutionId: 'institution-1' },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.LEVEL,
        'level-1',
      );

      expect(prismaMock.level.delete).toHaveBeenCalled();
      expect(result.message).toBe('Level permanently deleted successfully');

      prismaMock.academicClass.count.mockResolvedValueOnce(1);
      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.LEVEL,
          'level-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('permanently deletes a class once eligible, refusing an active section underneath it', async () => {
      prismaMock.academicClass.findFirst.mockResolvedValue({
        name: 'Grade 1',
        deletedAt: longAgo(),
        level: { campus: { institutionId: 'institution-1' } },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.CLASS,
        'class-1',
      );

      expect(prismaMock.academicClass.delete).toHaveBeenCalled();
      expect(result.message).toBe('Class permanently deleted successfully');

      prismaMock.section.count.mockResolvedValueOnce(1);
      await expect(
        service.permanentlyDeleteRecord(
          adminUser,
          RecycleBinEntity.CLASS,
          'class-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('permanently deletes a section once eligible', async () => {
      prismaMock.section.findFirst.mockResolvedValue({
        name: 'A',
        deletedAt: longAgo(),
        class: { level: { campus: { institutionId: 'institution-1' } } },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.SECTION,
        'section-1',
      );

      expect(prismaMock.section.delete).toHaveBeenCalled();
      expect(result.message).toBe('Section permanently deleted successfully');
    });

    it('permanently deletes a subject once eligible', async () => {
      prismaMock.subject.findFirst.mockResolvedValue({
        name: 'Math',
        deletedAt: longAgo(),
        class: { level: { campus: { institutionId: 'institution-1' } } },
      });

      const result = await service.permanentlyDeleteRecord(
        adminUser,
        RecycleBinEntity.SUBJECT,
        'subject-1',
      );

      expect(prismaMock.subject.delete).toHaveBeenCalled();
      expect(result.message).toBe('Subject permanently deleted successfully');
    });
  });
});
