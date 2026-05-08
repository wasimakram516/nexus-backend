import { PrismaService } from './prisma.service';

describe('PrismaService audit helpers', () => {
  type PrismaServiceInternals = {
    resolveAuditAction: (
      originalOperation: string,
      effectiveOperation: string,
      args: Record<string, unknown>,
    ) => string | null;
    buildAuditMetadata: (
      action: string,
      args: Record<string, unknown>,
      deleteReason?: string | null,
    ) => Record<string, unknown> | undefined;
    resolveAuditInstitutionId: (
      service: Record<string, unknown>,
      contextService: {
        runWith: (
          state: Record<string, unknown>,
          callback: () => Promise<unknown>,
        ) => Promise<unknown>;
      },
      args: Record<string, unknown>,
      result: unknown,
      fallbackInstitutionId: string | null,
    ) => Promise<string | null>;
  };

  const PrismaServiceInternal =
    PrismaService as unknown as PrismaServiceInternals;

  it('treats soft deletes as deleted audit actions', () => {
    expect(
      PrismaServiceInternal.resolveAuditAction('delete', 'update', {
        data: { deletedAt: new Date() },
      }),
    ).toBe('DELETED');
  });

  it('treats deletedAt reset as a restore audit action', () => {
    expect(
      PrismaServiceInternal.resolveAuditAction('update', 'update', {
        data: { deletedAt: null, deletedBy: null, deleteReason: null },
      }),
    ).toBe('RESTORED');
  });

  it('builds upsert audit metadata using tracked field names', () => {
    expect(
      PrismaServiceInternal.buildAuditMetadata(
        'UPSERTED',
        {
          where: { id: 'record-1' },
          create: { name: 'Created', activeScopeKey: 'ACTIVE' },
          update: { name: 'Updated', updatedBy: 'user-1' },
        },
        null,
      ),
    ).toEqual({
      where: { id: 'record-1' },
      createFields: ['name'],
      updateFields: ['name'],
    });
  });

  it('resolves institution ids from related campus records', async () => {
    const contextService = {
      runWith: jest
        .fn<
          Promise<unknown>,
          [Record<string, unknown>, () => Promise<unknown>]
        >()
        .mockImplementation((_state, callback) => callback()),
    };
    const service = {
      campus: {
        findUnique: jest.fn().mockResolvedValue({
          institutionId: 'institution-1',
        }),
      },
    };

    await expect(
      PrismaServiceInternal.resolveAuditInstitutionId(
        service,
        contextService,
        { data: { campusId: 'campus-1' } },
        null,
        null,
      ),
    ).resolves.toBe('institution-1');
    expect(service.campus.findUnique).toHaveBeenCalledWith({
      where: { id: 'campus-1' },
      select: { institutionId: true },
    });
  });
});
