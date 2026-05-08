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

  let service: AuditLogsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditLogsService(prismaMock as never);
  });

  it('builds frontend-friendly paginated audit results', async () => {
    const items = [{ id: 'log-1', action: 'STUDENT_CREATED' }];
    prismaMock.$transaction.mockResolvedValue([items, 3]);

    const result = await service.listAuditLogs({
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

    await service.listAuditLogs({
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
});
