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
