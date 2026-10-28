import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1),
    // How long a database transaction may run before it is cancelled. Prisma's
    // own default (5 s) is too short when the database is in another region,
    // where every query costs a round trip.
    DB_TRANSACTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(5000)
      .max(120000)
      .default(20000),
    DB_TRANSACTION_MAX_WAIT_MS: z.coerce
      .number()
      .int()
      .min(2000)
      .max(60000)
      .default(10000),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().default(7),
    MASTER_LOGIN_KEY: z.string().min(16).optional(),
    TRIAL_DAYS: z.coerce.number().int().positive().default(14),
    SUPERADMIN_SEED_NAME: z.string().min(1).optional(),
    SUPERADMIN_SEED_EMAIL: z.string().email().optional(),
    SUPERADMIN_SEED_PASSWORD: z.string().min(8).optional(),
    CORS_ORIGINS: z.string().optional(),
    COOKIE_DOMAIN: z.string().optional(),
    // Cloudinary
    CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
    CLOUDINARY_API_KEY: z.string().min(1).optional(),
    CLOUDINARY_API_SECRET: z.string().min(1).optional(),
    CLOUDINARY_FOLDER: z.string().default('Nexus'),
    // Realtime (parked for v1, decision #11 — P0-10). Disabled by default:
    // no domain-event consumer exists yet, so there is nothing legitimate to
    // authorize room access against. Flip only once real events are wired.
    // z.coerce.boolean() is deliberately NOT used here — it coerces the
    // literal string "false" to `true` (Boolean("false") === true in JS),
    // which would make this flag impossible to explicitly disable via env.
    REALTIME_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // The address of the web app, used to build links in emails (password reset).
    APP_URL: z.string().url().default('http://localhost:3000'),
    // How messages leave the system. `log` (default) sends nothing and only
    // records that a message would have been sent; `smtp` sends real email.
    NOTIFICATIONS_PROVIDER: z.enum(['log', 'smtp']).default('log'),
    NOTIFICATIONS_FROM: z.string().min(3).optional(),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    // Automated database backups. Built but OFF: only the real production
    // environment turns this on, after a manual restore drill.
    BACKUP_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    BACKUP_S3_BUCKET: z.string().min(3).optional(),
    BACKUP_S3_REGION: z.string().min(2).optional(),
    BACKUP_KMS_KEY_ID: z.string().min(1).optional(),
    // 64 hex characters (256 bits). The dump is encrypted with this before upload.
    BACKUP_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters')
      .optional(),
    // A PostgreSQL server where the weekly restore check may create and drop scratch databases.
    BACKUP_VERIFY_ADMIN_URL: z.string().min(1).optional(),
    BACKUP_OBJECT_LOCK: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    BACKUP_RETENTION_INTRADAY_DAYS: z.coerce.number().int().min(1).default(3),
    BACKUP_RETENTION_DAILY_DAYS: z.coerce.number().int().min(1).default(30),
    BACKUP_RETENTION_WEEKLY_DAYS: z.coerce.number().int().min(1).default(84),
    BACKUP_RETENTION_MONTHLY_DAYS: z.coerce.number().int().min(1).default(365),
    BACKUP_RETENTION_YEARLY_DAYS: z.coerce.number().int().min(1).default(3653),
  })
  .superRefine((config, context) => {
    if (config.NOTIFICATIONS_PROVIDER === 'smtp') {
      for (const key of ['SMTP_HOST', 'NOTIFICATIONS_FROM'] as const) {
        if (!config[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} is required when NOTIFICATIONS_PROVIDER is smtp.`,
            path: [key],
          });
        }
      }
    }
    if (config.BACKUP_ENABLED) {
      for (const key of [
        'BACKUP_S3_BUCKET',
        'BACKUP_S3_REGION',
        'BACKUP_ENCRYPTION_KEY',
      ] as const) {
        if (!config[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} is required when BACKUP_ENABLED is true.`,
            path: [key],
          });
        }
      }
    }
    if (Boolean(config.SMTP_USER) !== Boolean(config.SMTP_PASSWORD)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SMTP_USER and SMTP_PASSWORD must be provided together.',
        path: config.SMTP_USER ? ['SMTP_PASSWORD'] : ['SMTP_USER'],
      });
    }
    const hasSuperadminEmail = Boolean(config.SUPERADMIN_SEED_EMAIL);
    const hasSuperadminPassword = Boolean(config.SUPERADMIN_SEED_PASSWORD);

    if (hasSuperadminEmail !== hasSuperadminPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'SUPERADMIN_SEED_EMAIL and SUPERADMIN_SEED_PASSWORD must be provided together.',
        path: hasSuperadminEmail
          ? ['SUPERADMIN_SEED_PASSWORD']
          : ['SUPERADMIN_SEED_EMAIL'],
      });
    }
  });
