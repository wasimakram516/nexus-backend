import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().default(7),
    MASTER_LOGIN_KEY: z.string().min(16).optional(),
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
  })
  .superRefine((config, context) => {
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
