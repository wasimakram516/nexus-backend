import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { encryptFile } from './backup-crypto';
import { backupKey, DEFAULT_RETENTION_DAYS } from './backup-policy';
import { BackupStorage } from './backup-storage';
import { BackupService } from './backup.service';
import { compareSnapshots } from './restore-verification';
import { RestoreVerifier, SCRATCH_PREFIX } from './restore-verifier.service';

const snap = (
  tableCounts: Record<string, number>,
  migrations = ['m1', 'm2'],
) => ({
  tableCounts,
  migrations,
});

describe('compareSnapshots', () => {
  it('passes when the backup holds what the live database holds', () => {
    const result = compareSnapshots(
      snap({ users: 10, vouchers: 500 }),
      snap({ users: 10, vouchers: 500 }),
    );

    expect(result).toEqual({
      passed: true,
      summary: '2 tables and 510 rows matched the live database.',
    });
  });

  it('allows the few rows that changed since the dump', () => {
    expect(
      compareSnapshots(snap({ vouchers: 1000 }), snap({ vouchers: 960 }))
        .passed,
    ).toBe(true);
    expect(
      compareSnapshots(snap({ users: 3 }), snap({ users: 2 })).passed,
    ).toBe(true);
  });

  it('fails when a table lost more than 5% of its rows', () => {
    const result = compareSnapshots(
      snap({ vouchers: 1000 }),
      snap({ vouchers: 900 }),
    );

    expect(result.passed).toBe(false);
    expect(result.summary).toBe(
      'table vouchers has 900 rows in the backup but 1000 now',
    );
  });

  it('fails when a table that holds data is missing from the backup', () => {
    const result = compareSnapshots(snap({ users: 5 }), snap({}));

    expect(result.passed).toBe(false);
    expect(result.summary).toContain('table users is missing');
  });

  it('forgives a table created by a migration applied after the dump', () => {
    const result = compareSnapshots(
      snap({ users: 5, reports: 2 }, ['m1', 'm2', 'm3']),
      snap({ users: 5 }, ['m1', 'm2']),
    );

    expect(result.passed).toBe(true);
  });

  it('fails when the backup has migrations the live database does not', () => {
    const result = compareSnapshots(
      snap({ users: 5 }, ['m1']),
      snap({ users: 5 }, ['m1', 'mX']),
    );

    expect(result.passed).toBe(false);
    expect(result.summary).toContain('mX');
  });

  it('fails when the backup has no migration history at all', () => {
    const result = compareSnapshots(snap({ users: 5 }), snap({ users: 5 }, []));

    expect(result.passed).toBe(false);
    expect(result.summary).toContain('no migration history');
  });

  it('reports every problem, not only the first', () => {
    const result = compareSnapshots(
      snap({ a: 100, b: 100 }),
      snap({ a: 10, b: 10 }),
    );

    expect(result.summary).toContain('table a');
    expect(result.summary).toContain('table b');
  });
});

describe('RestoreVerifier', () => {
  const key = randomBytes(32);
  const config = {
    enabled: true,
    databaseUrl: 'postgresql://u:p@live/Nexus',
    encryptionKey: key,
    retention: DEFAULT_RETENTION_DAYS,
  };
  const now = new Date('2026-11-01T03:00:00.000Z');
  let dir: string;
  let encryptedBytes: Buffer;

  const storage: BackupStorage = {
    put: jest.fn(),
    copy: jest.fn(),
    list: jest.fn(),
    delete: jest.fn(),
    download: jest.fn(async (_key: string, filePath: string) => {
      await fs.writeFile(filePath, encryptedBytes);
    }),
  };
  const backups = {
    enabled: true,
    recordVerification: jest.fn(),
  };
  const inspector = {
    snapshot: jest.fn(),
    createDatabase: jest.fn(),
    dropDatabase: jest.fn(),
  };
  const run = jest.fn();

  const build = (
    scratchUrl: string | null = 'postgresql://a:b@scratch/postgres',
  ) =>
    new RestoreVerifier(
      config,
      storage,
      backups as unknown as BackupService,
      inspector,
      scratchUrl,
      run,
    );

  beforeEach(async () => {
    jest.clearAllMocks();
    backups.enabled = true;
    dir = await fs.mkdtemp(join(tmpdir(), 'nexus-vspec-'));
    await fs.writeFile(join(dir, 'p'), 'a dump');
    await encryptFile(join(dir, 'p'), join(dir, 'e'), key);
    encryptedBytes = await fs.readFile(join(dir, 'e'));
    (storage.list as jest.Mock).mockResolvedValue([
      {
        key: backupKey('daily', new Date('2026-10-31T21:00:00.000Z')),
        sizeBytes: 10,
      },
    ]);
    inspector.createDatabase.mockResolvedValue(
      'postgresql://a:b@scratch/scratchdb',
    );
    inspector.dropDatabase.mockResolvedValue(undefined);
    run.mockResolvedValue(undefined);
  });

  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it('does nothing while backups are off', async () => {
    backups.enabled = false;

    expect(await build().verifyLatestDaily(now)).toBeNull();
    expect(inspector.createDatabase).not.toHaveBeenCalled();
  });

  it('restores into a scratch database, compares, records the pass and removes the scratch database', async () => {
    inspector.snapshot.mockResolvedValue(snap({ users: 5 }));

    const result = await build().verifyLatestDaily(now);

    expect(result?.passed).toBe(true);
    const scratchName = `${SCRATCH_PREFIX}${now.getTime()}`;
    expect(inspector.createDatabase).toHaveBeenCalledWith(
      'postgresql://a:b@scratch/postgres',
      scratchName,
    );
    expect(run).toHaveBeenCalledWith(
      'pg_restore',
      expect.arrayContaining(['--dbname', scratchName]),
      expect.objectContaining({ PGDATABASE: 'scratchdb' }),
    );
    expect(inspector.snapshot).toHaveBeenCalledWith(config.databaseUrl);
    expect(inspector.dropDatabase).toHaveBeenCalledWith(
      'postgresql://a:b@scratch/postgres',
      scratchName,
    );
    expect(backups.recordVerification).toHaveBeenCalledWith(
      true,
      expect.stringContaining('matched'),
    );
  });

  it('records a failure, and still removes the scratch database, when the restore itself fails', async () => {
    run.mockRejectedValue(new Error('pg_restore exited with 1'));

    const result = await build().verifyLatestDaily(now);

    expect(result).toEqual({
      passed: false,
      summary: 'pg_restore exited with 1',
    });
    expect(inspector.dropDatabase).toHaveBeenCalled();
    expect(backups.recordVerification).toHaveBeenCalledWith(
      false,
      'pg_restore exited with 1',
    );
  });

  it('records a failure when the backup differs from the live database', async () => {
    inspector.snapshot
      .mockResolvedValueOnce(snap({ users: 1000 }))
      .mockResolvedValueOnce(snap({ users: 10 }));

    const result = await build().verifyLatestDaily(now);

    expect(result?.passed).toBe(false);
    expect(backups.recordVerification).toHaveBeenCalledWith(
      false,
      expect.stringContaining('table users'),
    );
  });

  it('fails clearly when there is no daily backup or no scratch server', async () => {
    (storage.list as jest.Mock).mockResolvedValue([]);
    expect((await build().verifyLatestDaily(now))?.summary).toBe(
      'There is no daily backup to check yet.',
    );
    expect((await build(null).verifyLatestDaily(now))?.summary).toContain(
      'BACKUP_VERIFY_ADMIN_URL',
    );
    expect(inspector.createDatabase).not.toHaveBeenCalled();
  });

  it('fails when the backup cannot be decrypted, without creating a scratch database', async () => {
    encryptedBytes = Buffer.alloc(100, 1);

    const result = await build().verifyLatestDaily(now);

    expect(result?.passed).toBe(false);
    expect(inspector.createDatabase).not.toHaveBeenCalled();
  });
});
