import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogsService } from './audit-logs.service';

describe('AuditLogsService', () => {
  type AuditLogQuery = Record<string, unknown>;
  const prismaMock = {
    auditLog: {
      findMany: jest.fn<unknown, [AuditLogQuery]>(),
      count: jest.fn<unknown, [AuditLogQuery]>(),
    },
    $transaction: jest.fn<Promise<[unknown[], number]>, [unknown[]]>(),
  };

  const superadminUser: CurrentUser = {
    sub: 'root-1',
    email: 'root@nexus.test',
    role: UserRole.SUPERADMIN,
  };

  const adminUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'institution-1',
  };

  let service: AuditLogsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditLogsService(prismaMock as never);
  });

  it('builds frontend-friendly paginated audit results', async () => {
    const items = [{ id: 'log-1', action: 'STUDENT_CREATED' }];
    prismaMock.$transaction.mockResolvedValue([items, 3]);

    const result = await service.listAuditLogs(superadminUser, {
      page: 1,
      limit: 2,
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      message: 'Audit logs retrieved successfully',
      data: {
        items,
        total: 3,
        page: 1,
        limit: 2,
        totalPages: 2,
        hasNextPage: true,
        hasPreviousPage: false,
      },
    });
  });

  it('supports search across user and institution fields and normalizes date ranges', async () => {
    prismaMock.$transaction.mockResolvedValue([[], 0]);

    await service.listAuditLogs(superadminUser, {
      page: 2,
      limit: 10,
      search: 'nexus',
      action: 'created',
      entity: 'student',
      entityId: 'student-1',
      userId: 'user-1',
      institutionId: 'institution-1',
      fromDate: '2026-05-01',
      toDate: '2026-05-08',
    });

    expect(prismaMock.$transaction.mock.calls[0]?.[0]).toHaveLength(2);

    const findManyArgs = prismaMock.auditLog.findMany.mock.calls[0]?.[0];
    const where = findManyArgs?.where as AuditLogQuery;
    const createdAt = where.createdAt as { gte: Date; lte: Date };
    const orFilters = where.OR as AuditLogQuery[];

    expect(findManyArgs).toMatchObject({
      skip: 10,
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    expect(where).toMatchObject({
      entityId: 'student-1',
      userId: 'user-1',
      institutionId: 'institution-1',
      action: { contains: 'created', mode: 'insensitive' },
      entity: { contains: 'student', mode: 'insensitive' },
    });
    expect(createdAt).toEqual({
      gte: new Date('2026-05-01'),
      lte: new Date('2026-05-08T23:59:59.999Z'),
    });
    expect(orFilters).toEqual(
      expect.arrayContaining([
        { action: { contains: 'nexus', mode: 'insensitive' } },
        {
          user: {
            email: { contains: 'nexus', mode: 'insensitive' },
          },
        },
        {
          institution: {
            slug: { contains: 'nexus', mode: 'insensitive' },
          },
        },
      ]),
    );
  });

  describe('institution scoping', () => {
    it('locks a non-superadmin to their own institution regardless of the requested filter', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0]);

      await service.listAuditLogs(adminUser, {
        page: 1,
        limit: 10,
        institutionId: 'someone-elses-institution',
      });

      const findManyArgs = prismaMock.auditLog.findMany.mock.calls[0]?.[0];
      const where = findManyArgs?.where as AuditLogQuery;
      expect(where.institutionId).toBe('institution-1');
    });

    it('lets a superadmin cross institutions via the institutionId filter', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0]);

      await service.listAuditLogs(superadminUser, {
        page: 1,
        limit: 10,
        institutionId: 'institution-9',
      });

      const findManyArgs = prismaMock.auditLog.findMany.mock.calls[0]?.[0];
      const where = findManyArgs?.where as AuditLogQuery;
      expect(where.institutionId).toBe('institution-9');
    });

    it('lets a superadmin see every institution when no filter is given', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0]);

      await service.listAuditLogs(superadminUser, { page: 1, limit: 10 });

      const findManyArgs = prismaMock.auditLog.findMany.mock.calls[0]?.[0];
      const where = findManyArgs?.where as AuditLogQuery;
      expect(where).not.toHaveProperty('institutionId');
    });

    it('refuses a non-superadmin with no institution at all rather than returning unscoped results', async () => {
      const orphanUser: CurrentUser = {
        sub: 'staff-1',
        email: 'staff@nexus.test',
        role: UserRole.STAFF,
      };

      await expect(
        service.listAuditLogs(orphanUser, { page: 1, limit: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });
});
