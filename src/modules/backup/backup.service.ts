import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { formatDateTime } from '../../common/utils/date-format.util';
import { TemplateData } from '../notifications/notification-templates';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole, UserStatus } from '../../prisma/client';
import { encryptFile } from './backup-crypto';
import {
  backupKey,
  BACKUP_TIERS,
  BackupRetentionDays,
  BackupTier,
  expiredBackups,
  latestInTier,
  parseBackupKey,
  promotionTiers,
  retainUntil,
} from './backup-policy';
import { BackupStorage } from './backup-storage';
import { CommandRunner, dumpDatabase, runCommand } from './pg-dump.runner';

/** Everything the backup job needs that comes from the environment. */
export interface BackupConfig {
  enabled: boolean;
  databaseUrl: string;
  encryptionKey: Buffer;
  retention: BackupRetentionDays;
}

export interface TierStatus {
  tier: BackupTier;
  count: number;
  latestAt: string | null;
  latestSizeBytes: number | null;
}

export interface BackupStatus {
  enabled: boolean;
  tiers: TierStatus[];
  totalSizeBytes: number;
  lastError: { jobName: string; reason: string; at: string } | null;
}

export const BACKUP_CONFIG = Symbol('BACKUP_CONFIG');
export const BACKUP_STORAGE = Symbol('BACKUP_STORAGE');
export const BACKUP_COMMAND_RUNNER = Symbol('BACKUP_COMMAND_RUNNER');

/** A readable size such as `1.2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Takes encrypted whole-database backups and keeps them in rotating tiers.
 * Every step is guarded: a failure is recorded, the superadmins are emailed at
 * once, and the error never escapes into the scheduler.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private lastError: BackupStatus['lastError'] = null;

  constructor(
    private readonly config: BackupConfig,
    private readonly storage: BackupStorage | null,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly run: CommandRunner = runCommand,
  ) {}

  get enabled(): boolean {
    return this.config.enabled && this.storage !== null;
  }

  /**
   * Dumps the database, encrypts it and stores it in the intraday tier.
   *
   * @param {Date} [now] - When the dump is taken (a parameter so it can be tested).
   * @returns {Promise<string | null>} The storage key, or null when disabled or it failed.
   */
  async runIntraday(now: Date = new Date()): Promise<string | null> {
    return this.guarded('intraday backup', async (storage) => {
      const workDir = await fs.mkdtemp(join(tmpdir(), 'nexus-backup-'));
      try {
        const plain = join(workDir, 'database.dump');
        const encrypted = join(workDir, 'database.dump.enc');
        await dumpDatabase(this.config.databaseUrl, plain, this.run);
        await encryptFile(plain, encrypted, this.config.encryptionKey);
        // The plain dump holds every record in the clear: remove it before uploading.
        await fs.rm(plain, { force: true });
        const key = backupKey('intraday', now);
        await storage.put(
          key,
          encrypted,
          retainUntil('intraday', now, this.config.retention),
        );
        return key;
      } finally {
        await fs.rm(workDir, { recursive: true, force: true });
      }
    });
  }

  /**
   * Copies the day's last backup into the daily tier, and into weekly,
   * monthly and yearly on the days they fall due. Nothing is dumped again.
   *
   * @param {Date} [now] - The moment the day is closed.
   * @returns {Promise<BackupTier[]>} The tiers written; empty when disabled or it failed.
   */
  async closeDay(now: Date = new Date()): Promise<BackupTier[]> {
    const written = await this.guarded('end of day copy', async (storage) => {
      const stored = await storage.list();
      const source = latestInTier(stored, 'intraday');
      if (!source) throw new Error('There is no intraday backup to copy.');
      const tiers = promotionTiers(now);
      for (const tier of tiers) {
        await storage.copy(
          source.key,
          backupKey(tier, source.takenAt),
          retainUntil(tier, source.takenAt, this.config.retention),
        );
      }
      return tiers;
    });
    return written ?? [];
  }

  /**
   * Removes backups past their tier's retention, always keeping the newest of each tier.
   *
   * @param {Date} [now] - The present moment.
   * @returns {Promise<number>} How many were removed.
   */
  async prune(now: Date = new Date()): Promise<number> {
    const removed = await this.guarded(
      'pruning old backups',
      async (storage) => {
        const expired = expiredBackups(
          await storage.list(),
          this.config.retention,
          now,
        );
        let count = 0;
        for (const key of expired) {
          try {
            await storage.delete(key);
            count += 1;
          } catch (error) {
            // A locked object cannot be removed before its date; leave it for the next run.
            this.logger.warn(`Could not remove ${key}: ${this.reason(error)}`);
          }
        }
        return count;
      },
    );
    return removed ?? 0;
  }

  /**
   * @returns {Promise<BackupStatus>} The latest backup in each tier, for the health report.
   */
  async status(): Promise<BackupStatus> {
    const empty = BACKUP_TIERS.map((tier) => ({
      tier,
      count: 0,
      latestAt: null,
      latestSizeBytes: null,
    }));
    if (!this.enabled || !this.storage) {
      return {
        enabled: false,
        tiers: empty,
        totalSizeBytes: 0,
        lastError: this.lastError,
      };
    }
    const stored = await this.storage.list();
    const tiers: TierStatus[] = BACKUP_TIERS.map((tier) => {
      const latest = latestInTier(stored, tier);
      return {
        tier,
        count: stored.filter((item) => parseBackupKey(item.key)?.tier === tier)
          .length,
        latestAt: latest ? latest.takenAt.toISOString() : null,
        latestSizeBytes: latest ? latest.sizeBytes : null,
      };
    });
    return {
      enabled: true,
      tiers,
      totalSizeBytes: stored.reduce((sum, item) => sum + item.sizeBytes, 0),
      lastError: this.lastError,
    };
  }

  /** Emails every active superadmin. Never throws. */
  async notifySuperadmins<K extends 'BACKUP_ALERT' | 'BACKUP_REPORT'>(
    key: K,
    data: TemplateData[K],
  ): Promise<void> {
    try {
      const admins = await this.prisma.user.findMany({
        where: {
          role: UserRole.SUPERADMIN,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
        select: { email: true },
      });
      for (const admin of admins) {
        await this.notifications.sendEmail(key, admin.email, data);
      }
    } catch (error) {
      this.logger.error(
        `Could not email the superadmins: ${this.reason(error)}`,
      );
    }
  }

  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  /** Runs one step if backups are on; on failure records it, alerts at once, and returns null. */
  private async guarded<T>(
    jobName: string,
    job: (storage: BackupStorage) => Promise<T>,
  ): Promise<T | null> {
    if (!this.enabled || !this.storage) return null;
    try {
      return await job(this.storage);
    } catch (error) {
      const reason = this.reason(error);
      const at = new Date();
      this.logger.error(`The ${jobName} failed: ${reason}`);
      this.lastError = { jobName, reason, at: at.toISOString() };
      await this.notifySuperadmins('BACKUP_ALERT', {
        jobName,
        reason,
        at: formatDateTime(at),
      });
      return null;
    }
  }
}
