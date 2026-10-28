import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { parseBackupKeyHex } from './backup-crypto';
import { BackupRetentionDays } from './backup-policy';
import { BackupScheduler } from './backup.scheduler';
import { BackupConfig, BackupService } from './backup.service';
import { BackupStorage, S3BackupStorage } from './backup-storage';
import { PgDatabaseInspector } from './restore-verification';
import { RestoreVerifier } from './restore-verifier.service';

/**
 * Builds the backup settings from the environment. While backups are off, no
 * key is needed and no storage is created, so a normal deployment carries no
 * AWS configuration at all.
 *
 * @param {Pick<ConfigService, 'get'>} config - The validated environment.
 * @returns {BackupConfig} The settings.
 */
export function createBackupConfig(
  config: Pick<ConfigService, 'get'>,
): BackupConfig {
  const days = (name: string, fallback: number) =>
    Number(config.get(name) ?? fallback);
  const retention: BackupRetentionDays = {
    intraday: days('BACKUP_RETENTION_INTRADAY_DAYS', 3),
    daily: days('BACKUP_RETENTION_DAILY_DAYS', 30),
    weekly: days('BACKUP_RETENTION_WEEKLY_DAYS', 84),
    monthly: days('BACKUP_RETENTION_MONTHLY_DAYS', 365),
    yearly: days('BACKUP_RETENTION_YEARLY_DAYS', 3653),
  };
  const enabled = config.get('BACKUP_ENABLED') === true;
  return {
    enabled,
    databaseUrl: config.get<string>('DATABASE_URL') ?? '',
    encryptionKey: enabled
      ? parseBackupKeyHex(config.get<string>('BACKUP_ENCRYPTION_KEY') ?? '')
      : Buffer.alloc(0),
    retention,
  };
}

/**
 * @param {Pick<ConfigService, 'get'>} config - The validated environment.
 * @returns {BackupStorage | null} The S3 storage, or null while backups are off.
 */
export function createBackupStorage(
  config: Pick<ConfigService, 'get'>,
): BackupStorage | null {
  if (config.get('BACKUP_ENABLED') !== true) return null;
  return new S3BackupStorage({
    bucket: config.get<string>('BACKUP_S3_BUCKET') as string,
    region: config.get<string>('BACKUP_S3_REGION') as string,
    kmsKeyId: config.get<string>('BACKUP_KMS_KEY_ID'),
    objectLock: config.get('BACKUP_OBJECT_LOCK') !== false,
  });
}

@Module({
  providers: [
    {
      provide: BackupService,
      inject: [ConfigService, PrismaService, NotificationsService],
      useFactory: (
        config: ConfigService,
        prisma: PrismaService,
        notifications: NotificationsService,
      ) =>
        new BackupService(
          createBackupConfig(config),
          createBackupStorage(config),
          prisma,
          notifications,
        ),
    },
    {
      provide: RestoreVerifier,
      inject: [ConfigService, BackupService],
      useFactory: (config: ConfigService, backups: BackupService) =>
        new RestoreVerifier(
          createBackupConfig(config),
          createBackupStorage(config),
          backups,
          new PgDatabaseInspector(),
          config.get<string>('BACKUP_VERIFY_ADMIN_URL') ?? null,
        ),
    },
    BackupScheduler,
  ],
  exports: [BackupService],
})
export class BackupModule {}
