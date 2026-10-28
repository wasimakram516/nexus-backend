import { envSchema } from './env.schema';

describe('envSchema database transaction limits', () => {
  const base = {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nexus',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
  };

  it('defaults to a transaction timeout that suits a remote database', () => {
    const config = envSchema.parse(base);

    expect(config.DB_TRANSACTION_TIMEOUT_MS).toBe(20000);
    expect(config.DB_TRANSACTION_MAX_WAIT_MS).toBe(10000);
  });

  it('reads the limits from the environment as numbers', () => {
    const config = envSchema.parse({
      ...base,
      DB_TRANSACTION_TIMEOUT_MS: '45000',
      DB_TRANSACTION_MAX_WAIT_MS: '15000',
    });

    expect(config.DB_TRANSACTION_TIMEOUT_MS).toBe(45000);
    expect(config.DB_TRANSACTION_MAX_WAIT_MS).toBe(15000);
  });

  it.each([
    ['DB_TRANSACTION_TIMEOUT_MS', '1000'],
    ['DB_TRANSACTION_TIMEOUT_MS', '999999'],
    ['DB_TRANSACTION_MAX_WAIT_MS', '100'],
    ['DB_TRANSACTION_TIMEOUT_MS', 'soon'],
  ])('refuses %s of %s at startup', (key, value) => {
    expect(() => envSchema.parse({ ...base, [key]: value })).toThrow();
  });
});

describe('envSchema backups', () => {
  const base = {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nexus',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
  };
  const complete = {
    ...base,
    BACKUP_ENABLED: 'true',
    BACKUP_S3_BUCKET: 'nexus-backups',
    BACKUP_S3_REGION: 'me-south-1',
    BACKUP_ENCRYPTION_KEY: 'ab'.repeat(32),
  };

  it('is off by default and needs no backup settings', () => {
    const config = envSchema.parse(base);

    expect(config.BACKUP_ENABLED).toBe(false);
    expect(config.BACKUP_OBJECT_LOCK).toBe(true);
    expect(config.BACKUP_RETENTION_YEARLY_DAYS).toBe(3650);
  });

  it('treats the text "false" as off, not as a truthy string', () => {
    expect(
      envSchema.parse({ ...base, BACKUP_ENABLED: 'false' }).BACKUP_ENABLED,
    ).toBe(false);
  });

  it('accepts a complete set of settings when turned on', () => {
    expect(envSchema.parse(complete).BACKUP_ENABLED).toBe(true);
  });

  it.each(['BACKUP_S3_BUCKET', 'BACKUP_S3_REGION', 'BACKUP_ENCRYPTION_KEY'])(
    'refuses to start with backups on and %s missing',
    (key) => {
      const { [key]: _omitted, ...rest } = complete as Record<string, string>;
      void _omitted;

      expect(() => envSchema.parse(rest)).toThrow(key);
    },
  );

  it('refuses an encryption key that is not 64 hex characters', () => {
    expect(() =>
      envSchema.parse({ ...complete, BACKUP_ENCRYPTION_KEY: 'too-short' }),
    ).toThrow('64 hex characters');
  });
});
