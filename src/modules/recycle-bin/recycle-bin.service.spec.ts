import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogService } from '../../common/services/audit-log.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole, UserStatus } from '../../prisma/client';
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
    permissionTemplate: {
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
    },
    guardian: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    teacher: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    level: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    academicClass: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    section: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    subject: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    staffSalary: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    salaryDeductionRule: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    salaryAdjustment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    salaryPayment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
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
    },
    feeStructure: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    studentDiscount: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    studentFineRule: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    studentFine: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    feeVoucher: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    feePayment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
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
          role: UserRole.TEACHER,
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
      role: UserRole.TEACHER,
      status: UserStatus.ACTIVE,
      institutionId: 'institution-1',
      deletedAt: new Date('2026-05-06T10:00:00.000Z'),
    });
    prismaMock.user.update.mockResolvedValue({
      id: 'user-1',
      name: 'Deleted User',
      email: 'deleted@nexus.test',
      role: UserRole.TEACHER,
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
});
