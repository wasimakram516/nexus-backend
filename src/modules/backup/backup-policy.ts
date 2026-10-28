/**
 * The rules of the backup rotation, kept free of any storage or clock so they
 * can be proven by tests: how a backup is named, which longer-lived tiers an
 * end-of-day backup is copied into, and which old backups may be removed.
 */

export const BACKUP_TIERS = [
  'intraday',
  'daily',
  'weekly',
  'monthly',
  'yearly',
] as const;
export type BackupTier = (typeof BACKUP_TIERS)[number];

/** How many days each tier is kept. Tunable from the environment. */
export type BackupRetentionDays = Record<BackupTier, number>;

export const DEFAULT_RETENTION_DAYS: BackupRetentionDays = {
  intraday: 3,
  daily: 30,
  weekly: 84,
  monthly: 365,
  // Ten calendar years including their leap days (3650 would fall three days short).
  yearly: 3653,
};

const KEY_PREFIX = 'backups';
const KEY_SUFFIX = '.dump.enc';
const KEY_PATTERN = new RegExp(
  `^${KEY_PREFIX}/(${BACKUP_TIERS.join('|')})/(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}Z)\\.dump\\.enc$`,
);

/** One stored backup, as the storage reports it. */
export interface StoredBackup {
  key: string;
  sizeBytes: number;
}

export interface ParsedBackupKey {
  tier: BackupTier;
  takenAt: Date;
}

/**
 * @param {BackupTier} tier - The tier the backup lives in.
 * @param {Date} takenAt - When the dump was taken.
 * @returns {string} The storage key, such as `backups/daily/2026-10-28T23-30-00Z.dump.enc`.
 */
export function backupKey(tier: BackupTier, takenAt: Date): string {
  const stamp = takenAt
    .toISOString()
    .slice(0, 19)
    .replace(/:/g, '-')
    .concat('Z');
  return `${KEY_PREFIX}/${tier}/${stamp}${KEY_SUFFIX}`;
}

/**
 * @param {string} key - A storage key.
 * @returns {ParsedBackupKey | null} The tier and time it names, or null for any other object.
 */
export function parseBackupKey(key: string): ParsedBackupKey | null {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  const [date, time] = match[2].slice(0, -1).split('T');
  const takenAt = new Date(`${date}T${time.replace(/-/g, ':')}.000Z`);
  if (Number.isNaN(takenAt.getTime())) return null;
  return { tier: match[1] as BackupTier, takenAt };
}

/**
 * The longer-lived tiers that the day's last backup is copied into. Copying
 * the finished dump, rather than dumping again, means every tier holds a
 * backup that really was taken, never a second, slightly different one.
 *
 * @param {Date} day - The day being closed (UTC).
 * @returns {BackupTier[]} Daily always; weekly on Sunday; monthly on the 1st; yearly on 1 January.
 */
export function promotionTiers(day: Date): BackupTier[] {
  const tiers: BackupTier[] = ['daily'];
  if (day.getUTCDay() === 0) tiers.push('weekly');
  if (day.getUTCDate() === 1) tiers.push('monthly');
  if (day.getUTCMonth() === 0 && day.getUTCDate() === 1) tiers.push('yearly');
  return tiers;
}

/**
 * When an object stored in a tier stops needing protection.
 *
 * @param {BackupTier} tier - The tier being written to.
 * @param {Date} takenAt - When the dump was taken.
 * @param {BackupRetentionDays} retention - Days kept per tier.
 * @returns {Date} The earliest time the backup may be deleted.
 */
export function retainUntil(
  tier: BackupTier,
  takenAt: Date,
  retention: BackupRetentionDays,
): Date {
  return new Date(takenAt.getTime() + retention[tier] * 24 * 60 * 60 * 1000);
}

/**
 * The backups that are past their tier's retention and may be removed. The
 * newest backup in a tier is always kept, so a stopped job can never leave a
 * tier empty, and anything that does not look like a backup is left alone.
 *
 * @param {StoredBackup[]} stored - Everything under the backup prefix.
 * @param {BackupRetentionDays} retention - Days kept per tier.
 * @param {Date} now - The present moment.
 * @returns {string[]} The keys that may be deleted.
 */
export function expiredBackups(
  stored: StoredBackup[],
  retention: BackupRetentionDays,
  now: Date,
): string[] {
  const byTier = new Map<BackupTier, { key: string; takenAt: Date }[]>();
  for (const { key } of stored) {
    const parsed = parseBackupKey(key);
    if (!parsed) continue;
    const list = byTier.get(parsed.tier) ?? [];
    list.push({ key, takenAt: parsed.takenAt });
    byTier.set(parsed.tier, list);
  }

  const expired: string[] = [];
  for (const [tier, items] of byTier) {
    items.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
    for (const item of items.slice(1)) {
      if (retainUntil(tier, item.takenAt, retention) <= now) {
        expired.push(item.key);
      }
    }
  }
  return expired;
}

/**
 * The most recent backup of a tier, for the health report and for choosing
 * what to promote or restore.
 *
 * @param {StoredBackup[]} stored - Everything under the backup prefix.
 * @param {BackupTier} tier - The tier to look in.
 * @returns {{ key: string; takenAt: Date; sizeBytes: number } | null} The newest, or null when the tier is empty.
 */
export function latestInTier(
  stored: StoredBackup[],
  tier: BackupTier,
): { key: string; takenAt: Date; sizeBytes: number } | null {
  let best: { key: string; takenAt: Date; sizeBytes: number } | null = null;
  for (const item of stored) {
    const parsed = parseBackupKey(item.key);
    if (parsed?.tier !== tier) continue;
    if (!best || parsed.takenAt > best.takenAt) {
      best = {
        key: item.key,
        takenAt: parsed.takenAt,
        sizeBytes: item.sizeBytes,
      };
    }
  }
  return best;
}
