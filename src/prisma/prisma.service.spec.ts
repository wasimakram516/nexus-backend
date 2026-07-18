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
    buildSnapshot: (value: unknown) => unknown;
    fetchPreImage: (
      service: Record<string, unknown>,
      contextService: {
        runWith: (
          state: Record<string, unknown>,
          callback: () => Promise<unknown>,
        ) => Promise<unknown>;
      },
      model: string,
      where: unknown,
    ) => Promise<unknown>;
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

  describe('buildSnapshot', () => {
    it('redacts passwordHash and tokenHash while keeping other fields', () => {
      expect(
        PrismaServiceInternal.buildSnapshot({
          id: 'user-1',
          email: 'user@nexus.test',
          passwordHash: 'super-secret-hash',
        }),
      ).toEqual({
        id: 'user-1',
        email: 'user@nexus.test',
        passwordHash: '[REDACTED]',
      });

      expect(
        PrismaServiceInternal.buildSnapshot({
          id: 'session-1',
          tokenHash: 'refresh-token-hash',
        }),
      ).toEqual({
        id: 'session-1',
        tokenHash: '[REDACTED]',
      });
    });

    it('returns undefined for null/undefined input instead of storing an empty snapshot', () => {
      expect(PrismaServiceInternal.buildSnapshot(undefined)).toBeUndefined();
      expect(PrismaServiceInternal.buildSnapshot(null)).toBeUndefined();
    });

    it('caps oversized snapshots instead of storing the full payload', () => {
      const hugeValue = { blob: 'x'.repeat(20_000) };

      const result = PrismaServiceInternal.buildSnapshot(hugeValue) as {
        truncated: boolean;
        note: string;
      };

      expect(result.truncated).toBe(true);
      expect(result.note).toContain('exceeded');
      expect(JSON.stringify(result).length).toBeLessThan(20_000);
    });

    it('leaves small snapshots untouched', () => {
      expect(
        PrismaServiceInternal.buildSnapshot({ id: 'level-1', name: 'Grade 1' }),
      ).toEqual({ id: 'level-1', name: 'Grade 1' });
    });
  });

  describe('fetchPreImage', () => {
    const contextService = {
      runWith: jest
        .fn<
          Promise<unknown>,
          [Record<string, unknown>, () => Promise<unknown>]
        >()
        .mockImplementation((_state, callback) => callback()),
    };

    it('fetches the current row via the model delegate matching the where clause', async () => {
      const service = {
        level: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'level-1', name: 'Grade 1' }),
        },
      };

      await expect(
        PrismaServiceInternal.fetchPreImage(service, contextService, 'Level', {
          id: 'level-1',
        }),
      ).resolves.toEqual({ id: 'level-1', name: 'Grade 1' });
      expect(service.level.findUnique).toHaveBeenCalledWith({
        where: { id: 'level-1' },
      });
    });

    it('returns undefined instead of throwing when the lookup fails', async () => {
      const service = {
        level: {
          findUnique: jest.fn().mockRejectedValue(new Error('db down')),
        },
      };

      await expect(
        PrismaServiceInternal.fetchPreImage(service, contextService, 'Level', {
          id: 'level-1',
        }),
      ).resolves.toBeUndefined();
    });

    it('returns undefined when the where clause is not an object (bulk-safe)', async () => {
      const service = { level: { findUnique: jest.fn() } };

      await expect(
        PrismaServiceInternal.fetchPreImage(
          service,
          contextService,
          'Level',
          undefined,
        ),
      ).resolves.toBeUndefined();
      expect(service.level.findUnique).not.toHaveBeenCalled();
    });
  });
});
