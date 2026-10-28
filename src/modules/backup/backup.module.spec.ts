import { createBackupConfig, createBackupStorage } from './backup.module';
import { S3BackupStorage } from './backup-storage';

const configOf = (values: Record<string, unknown>) => ({
  get: <T>(key: string) => values[key] as T,
});

describe('createBackupConfig', () => {
  it('needs no key while backups are off', () => {
    const config = createBackupConfig(
      configOf({ BACKUP_ENABLED: false, DATABASE_URL: 'postgresql://x/y' }),
    );

    expect(config.enabled).toBe(false);
    expect(config.encryptionKey).toHaveLength(0);
    expect(config.retention.yearly).toBe(3653);
  });

  it('reads the key and the retention from the environment when on', () => {
    const config = createBackupConfig(
      configOf({
        BACKUP_ENABLED: true,
        DATABASE_URL: 'postgresql://x/y',
        BACKUP_ENCRYPTION_KEY: 'cd'.repeat(32),
        BACKUP_RETENTION_DAILY_DAYS: '45',
      }),
    );

    expect(config.encryptionKey).toHaveLength(32);
    expect(config.retention.daily).toBe(45);
    expect(config.retention.intraday).toBe(3);
  });
});

describe('createBackupStorage', () => {
  it('creates no storage while backups are off, so no AWS setup is needed', () => {
    expect(createBackupStorage(configOf({ BACKUP_ENABLED: false }))).toBeNull();
  });

  it('creates the S3 storage when on', () => {
    expect(
      createBackupStorage(
        configOf({
          BACKUP_ENABLED: true,
          BACKUP_S3_BUCKET: 'nexus-backups',
          BACKUP_S3_REGION: 'me-south-1',
        }),
      ),
    ).toBeInstanceOf(S3BackupStorage);
  });
});
