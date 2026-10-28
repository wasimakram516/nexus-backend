import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { decryptFile } from './backup-crypto';
import {
  backupKey,
  DEFAULT_RETENTION_DAYS,
  StoredBackup,
} from './backup-policy';
import { BackupStorage } from './backup-storage';
import { BackupConfig, BackupService, formatBytes } from './backup.service';

/** Keeps "stored" backups in memory, with the bytes so they can be decrypted again. */
class MemoryStorage implements BackupStorage {
  objects = new Map<string, { bytes: Buffer; retainUntil?: Date }>();
  locked = new Set<string>();

  async put(key: string, filePath: string, retainUntil?: Date) {
    this.objects.set(key, { bytes: await fs.readFile(filePath), retainUntil });
  }
  copy(fromKey: string, toKey: string, retainUntil?: Date) {
    const source = this.objects.get(fromKey);
    if (!source) return Promise.reject(new Error('missing source'));
    this.objects.set(toKey, { bytes: source.bytes, retainUntil });
    return Promise.resolve();
  }
  async download(key: string, filePath: string) {
    await fs.writeFile(
      filePath,
      this.objects.get(key)?.bytes ?? Buffer.alloc(0),
    );
  }
  list(): Promise<StoredBackup[]> {
    return Promise.resolve(
      [...this.objects].map(([key, value]) => ({
        key,
        sizeBytes: value.bytes.length,
      })),
    );
  }
  delete(key: string) {
    if (this.locked.has(key))
      return Promise.reject(new Error('Object is locked'));
    this.objects.delete(key);
    return Promise.resolve();
  }
}

describe('BackupService', () => {
  const encryptionKey = randomBytes(32);
  const config: BackupConfig = {
    enabled: true,
    databaseUrl: 'postgresql://u:p@host/db',
    encryptionKey,
    retention: DEFAULT_RETENTION_DAYS,
  };
  const prisma = { user: { findMany: jest.fn() } };
  const notifications = { sendEmail: jest.fn() };
  const dumpContents = Buffer.from('the whole database');
  /** Stands in for pg_dump: writes the file it is asked to. */
  const run = jest.fn(async (_command: string, args: string[]) => {
    await fs.writeFile(args[args.indexOf('--file') + 1], dumpContents);
  });
  let storage: MemoryStorage;

  const build = (overrides: Partial<BackupConfig> = {}, withStorage = true) =>
    new BackupService(
      { ...config, ...overrides },
      withStorage ? storage : null,
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      run,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new MemoryStorage();
    prisma.user.findMany.mockResolvedValue([
      { email: 'owner@wisemensoft.com' },
    ]);
    notifications.sendEmail.mockResolvedValue({ delivered: true });
  });

  describe('when turned off', () => {
    it('does nothing at all: no dump, no upload, no email', async () => {
      const service = build({ enabled: false });

      expect(await service.runIntraday()).toBeNull();
      expect(await service.closeDay()).toEqual([]);
      expect(await service.prune()).toBe(0);
      expect(run).not.toHaveBeenCalled();
      expect(storage.objects.size).toBe(0);
      expect(notifications.sendEmail).not.toHaveBeenCalled();
      expect((await service.status()).enabled).toBe(false);
    });

    it('also does nothing without a storage to write to', async () => {
      expect(await build({}, false).runIntraday()).toBeNull();
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe('runIntraday', () => {
    const now = new Date('2026-10-28T09:00:00.000Z');

    it('stores an encrypted dump that restores to exactly what was dumped', async () => {
      const key = (await build().runIntraday(now)) as string;

      expect(key).toBe('backups/intraday/2026-10-28T09-00-00Z.dump.enc');
      expect(storage.objects.get(key)?.bytes.includes('whole database')).toBe(
        false,
      );

      const dir = await fs.mkdtemp(join(tmpdir(), 'nexus-spec-'));
      try {
        await storage.download(key, join(dir, 'in.enc'));
        await decryptFile(
          join(dir, 'in.enc'),
          join(dir, 'out.dump'),
          encryptionKey,
        );

        expect(
          (await fs.readFile(join(dir, 'out.dump'))).equals(dumpContents),
        ).toBe(true);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it('locks the backup until its tier retention ends', async () => {
      const key = (await build().runIntraday(now)) as string;

      expect(storage.objects.get(key)?.retainUntil?.toISOString()).toBe(
        '2026-10-31T09:00:00.000Z',
      );
    });

    it('leaves no copy of the database in the temporary folder', async () => {
      let dumpPath = '';
      run.mockImplementationOnce(async (_c: string, args: string[]) => {
        dumpPath = args[args.indexOf('--file') + 1];
        await fs.writeFile(dumpPath, dumpContents);
      });

      await build().runIntraday(now);

      await expect(fs.access(dumpPath)).rejects.toThrow();
    });

    it('cleans up, records the error and emails the superadmin when the dump fails', async () => {
      let dumpPath = '';
      run.mockImplementationOnce(async (_c: string, args: string[]) => {
        dumpPath = args[args.indexOf('--file') + 1];
        await fs.writeFile(dumpPath, 'half a dump');
        throw new Error('pg_dump exited with 1: connection refused');
      });
      const service = build();

      expect(await service.runIntraday(now)).toBeNull();

      await expect(fs.access(dumpPath)).rejects.toThrow();
      expect(storage.objects.size).toBe(0);
      expect(notifications.sendEmail).toHaveBeenCalledWith(
        'BACKUP_ALERT',
        'owner@wisemensoft.com',
        expect.objectContaining({
          jobName: 'intraday backup',
          reason: expect.stringContaining('connection refused') as string,
        }),
      );
      expect((await service.status()).lastError?.jobName).toBe(
        'intraday backup',
      );
    });

    it('does not let a failed alert email throw', async () => {
      run.mockRejectedValueOnce(new Error('disk full'));
      prisma.user.findMany.mockRejectedValueOnce(new Error('db down'));

      await expect(build().runIntraday(now)).resolves.toBeNull();
    });
  });

  describe('closeDay', () => {
    it('copies the newest intraday backup into daily without dumping again', async () => {
      const service = build();
      await service.runIntraday(new Date('2026-10-28T06:00:00.000Z'));
      await service.runIntraday(new Date('2026-10-28T21:00:00.000Z'));
      run.mockClear();

      const tiers = await service.closeDay(
        new Date('2026-10-28T23:30:00.000Z'),
      );

      expect(tiers).toEqual(['daily']);
      expect(run).not.toHaveBeenCalled();
      expect([...storage.objects.keys()]).toContain(
        backupKey('daily', new Date('2026-10-28T21:00:00.000Z')),
      );
    });

    it('also fills weekly, monthly and yearly on a Sunday that is 1 January', async () => {
      const service = build();
      await service.runIntraday(new Date('2023-01-01T21:00:00.000Z'));

      const tiers = await service.closeDay(
        new Date('2023-01-01T23:30:00.000Z'),
      );

      expect(tiers).toEqual(['daily', 'weekly', 'monthly', 'yearly']);
      const yearly = storage.objects.get(
        backupKey('yearly', new Date('2023-01-01T21:00:00.000Z')),
      );
      expect(yearly?.retainUntil?.getUTCFullYear()).toBe(2033);
    });

    it('raises an alert when there is nothing to copy', async () => {
      expect(await build().closeDay()).toEqual([]);
      expect(notifications.sendEmail).toHaveBeenCalledWith(
        'BACKUP_ALERT',
        expect.any(String),
        expect.objectContaining({
          reason: 'There is no intraday backup to copy.',
        }),
      );
    });
  });

  describe('prune', () => {
    it('removes only what is past retention, and carries on past one that is still locked', async () => {
      const service = build();
      const oldA = backupKey('intraday', new Date('2026-10-01T00:00:00.000Z'));
      const oldB = backupKey('intraday', new Date('2026-10-02T00:00:00.000Z'));
      const fresh = backupKey('intraday', new Date('2026-10-28T00:00:00.000Z'));
      for (const key of [oldA, oldB, fresh]) {
        storage.objects.set(key, { bytes: Buffer.from('x') });
      }
      storage.locked.add(oldA);

      const removed = await service.prune(new Date('2026-10-28T12:00:00.000Z'));

      expect(removed).toBe(1);
      expect([...storage.objects.keys()].sort()).toEqual([oldA, fresh].sort());
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('reports the newest backup in each tier and the total size', async () => {
      const service = build();
      await service.runIntraday(new Date('2026-10-28T06:00:00.000Z'));
      await service.runIntraday(new Date('2026-10-28T09:00:00.000Z'));

      const status = await service.status();

      expect(status.enabled).toBe(true);
      const intraday = status.tiers.find((tier) => tier.tier === 'intraday');
      expect(intraday?.count).toBe(2);
      expect(intraday?.latestAt).toBe('2026-10-28T09:00:00.000Z');
      expect(
        status.tiers.find((tier) => tier.tier === 'daily')?.latestAt,
      ).toBeNull();
      expect(status.totalSizeBytes).toBeGreaterThan(0);
    });
  });
});

describe('BackupService reporting', () => {
  const prisma = { user: { findMany: jest.fn() } };
  const notifications = { sendEmail: jest.fn() };
  const run = jest.fn(async (_command: string, args: string[]) => {
    await fs.writeFile(args[args.indexOf('--file') + 1], 'dump');
  });
  let storage: MemoryStorage;
  let service: BackupService;
  const now = new Date('2026-10-28T23:50:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new MemoryStorage();
    prisma.user.findMany.mockResolvedValue([
      { email: 'owner@wisemensoft.com' },
    ]);
    notifications.sendEmail.mockResolvedValue({ delivered: true });
    service = new BackupService(
      {
        enabled: true,
        databaseUrl: 'postgresql://u:p@host/db',
        encryptionKey: randomBytes(32),
        retention: DEFAULT_RETENTION_DAYS,
      },
      storage,
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      run,
    );
  });

  /** A normal day: an intraday backup 2 hours ago, closed into daily. */
  const healthyDay = async () => {
    await service.runIntraday(new Date('2026-10-28T21:00:00.000Z'));
    await service.closeDay(new Date('2026-10-28T23:30:00.000Z'));
  };

  it('reports healthy when the newest intraday and daily backups are fresh', async () => {
    await healthyDay();

    expect(service.isHealthy(await service.status(), now)).toBe(true);
  });

  it('reports unhealthy when no backup has been taken for over 4 hours', async () => {
    await healthyDay();

    expect(
      service.isHealthy(
        await service.status(),
        new Date('2026-10-29T02:30:00.000Z'),
      ),
    ).toBe(false);
  });

  it('reports unhealthy when a failure happened in the last day, or a restore check failed', async () => {
    await healthyDay();
    await service.recordVerification(false, 'rows missing in users');

    expect(service.isHealthy(await service.status(), now)).toBe(false);
  });

  it('emails an alert at once when a restore check fails, and not when it passes', async () => {
    await service.recordVerification(true, 'all tables match');
    expect(notifications.sendEmail).not.toHaveBeenCalled();

    await service.recordVerification(false, 'users: 10 of 100 rows');

    expect(notifications.sendEmail).toHaveBeenCalledWith(
      'BACKUP_ALERT',
      'owner@wisemensoft.com',
      expect.objectContaining({
        jobName: 'restore check',
        reason: 'users: 10 of 100 rows',
      }),
    );
  });

  it('sends the daily report with each tier, the storage used and the restore check', async () => {
    await healthyDay();
    await service.recordVerification(true, 'all tables match');

    expect(await service.sendDailyReport(now)).toBe(true);

    const call = notifications.sendEmail.mock.calls.find(
      (args: unknown[]) => args[0] === 'BACKUP_REPORT',
    ) as [string, string, { lines: string[]; healthy: boolean }];
    expect(call[1]).toBe('owner@wisemensoft.com');
    expect(call[2].healthy).toBe(true);
    expect(
      call[2].lines.some((line) => line.startsWith('intraday: 1 kept')),
    ).toBe(true);
    expect(call[2].lines).toContain('weekly: none yet');
    expect(
      call[2].lines.some((line) => line.startsWith('Total storage used')),
    ).toBe(true);
    expect(call[2].lines.some((line) => line.includes('passed'))).toBe(true);
  });

  it('sends no report while backups are off', async () => {
    const off = new BackupService(
      {
        enabled: false,
        databaseUrl: '',
        encryptionKey: Buffer.alloc(0),
        retention: DEFAULT_RETENTION_DAYS,
      },
      null,
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );

    expect(await off.sendDailyReport(now)).toBe(false);
    expect(notifications.sendEmail).not.toHaveBeenCalled();
  });

  it('alerts instead of reporting when the storage cannot be read', async () => {
    jest.spyOn(storage, 'list').mockRejectedValue(new Error('access denied'));

    expect(await service.sendDailyReport(now)).toBe(false);
    expect(notifications.sendEmail).toHaveBeenCalledWith(
      'BACKUP_ALERT',
      'owner@wisemensoft.com',
      expect.objectContaining({
        jobName: 'daily report',
        reason: 'access denied',
      }),
    );
  });
});

describe('formatBytes', () => {
  it.each([
    [500, '500 B'],
    [1536, '1.5 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [3 * 1024 ** 3, '3.0 GB'],
  ])('writes %i bytes as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
