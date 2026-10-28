import {
  backupKey,
  DEFAULT_RETENTION_DAYS,
  expiredBackups,
  latestInTier,
  parseBackupKey,
  promotionTiers,
  retainUntil,
} from './backup-policy';

const at = (iso: string) => new Date(iso);
const stored = (...keys: string[]) =>
  keys.map((key) => ({ key, sizeBytes: 100 }));

describe('backup keys', () => {
  it('names a backup by tier and time, without characters storage dislikes', () => {
    expect(backupKey('daily', at('2026-10-28T23:30:00.000Z'))).toBe(
      'backups/daily/2026-10-28T23-30-00Z.dump.enc',
    );
  });

  it('reads back the tier and time a key names', () => {
    const parsed = parseBackupKey(
      backupKey('weekly', at('2026-11-01T02:00:05.000Z')),
    );

    expect(parsed?.tier).toBe('weekly');
    expect(parsed?.takenAt.toISOString()).toBe('2026-11-01T02:00:05.000Z');
  });

  it.each([
    'backups/hourly/2026-10-28T23-30-00Z.dump.enc',
    'backups/daily/2026-10-28.dump.enc',
    'other/daily/2026-10-28T23-30-00Z.dump.enc',
    'backups/daily/2026-10-28T23-30-00Z.dump',
    'backups/daily/2026-13-45T99-99-99Z.dump.enc',
  ])('does not mistake %s for a backup', (key) => {
    expect(parseBackupKey(key)).toBeNull();
  });
});

describe('promotionTiers', () => {
  it('copies an ordinary day into daily only', () => {
    expect(promotionTiers(at('2026-10-28T23:30:00.000Z'))).toEqual(['daily']);
  });

  it('adds weekly on a Sunday', () => {
    expect(promotionTiers(at('2026-11-01T23:30:00.000Z'))).toContain('weekly');
    expect(promotionTiers(at('2026-10-31T23:30:00.000Z'))).not.toContain(
      'weekly',
    );
  });

  it('adds monthly on the 1st, and yearly on 1 January as well', () => {
    expect(promotionTiers(at('2026-10-01T23:30:00.000Z'))).toContain('monthly');
    expect(promotionTiers(at('2026-10-01T23:30:00.000Z'))).not.toContain(
      'yearly',
    );
    expect(promotionTiers(at('2027-01-01T23:30:00.000Z'))).toEqual([
      'daily',
      'monthly',
      'yearly',
    ]);
  });

  it('gives a Sunday that is also the 1st all three of daily, weekly and monthly', () => {
    expect(promotionTiers(at('2026-11-01T23:30:00.000Z'))).toEqual([
      'daily',
      'weekly',
      'monthly',
    ]);
  });
});

describe('retainUntil', () => {
  it('adds the tier retention to the time the dump was taken', () => {
    expect(
      retainUntil(
        'daily',
        at('2026-10-01T00:00:00.000Z'),
        DEFAULT_RETENTION_DAYS,
      ).toISOString(),
    ).toBe('2026-10-31T00:00:00.000Z');
  });
});

describe('expiredBackups', () => {
  const now = at('2026-10-28T12:00:00.000Z');

  it('removes an intraday backup older than 3 days and keeps a newer one', () => {
    const old = backupKey('intraday', at('2026-10-24T12:00:00.000Z'));
    const recent = backupKey('intraday', at('2026-10-27T12:00:00.000Z'));
    const newest = backupKey('intraday', at('2026-10-28T09:00:00.000Z'));

    expect(
      expiredBackups(stored(old, recent, newest), DEFAULT_RETENTION_DAYS, now),
    ).toEqual([old]);
  });

  it('applies each tier its own retention', () => {
    const dailyOld = backupKey('daily', at('2026-09-20T00:00:00.000Z'));
    const dailyNew = backupKey('daily', at('2026-10-27T00:00:00.000Z'));
    const monthlyOld = backupKey('monthly', at('2026-09-01T00:00:00.000Z'));
    const monthlyNew = backupKey('monthly', at('2026-10-01T00:00:00.000Z'));

    expect(
      expiredBackups(
        stored(dailyOld, dailyNew, monthlyOld, monthlyNew),
        DEFAULT_RETENTION_DAYS,
        now,
      ),
    ).toEqual([dailyOld]);
  });

  it('never removes the newest backup of a tier, even long past its retention', () => {
    const onlyOne = backupKey('yearly', at('2000-01-01T00:00:00.000Z'));
    const lone = backupKey('intraday', at('2026-01-01T00:00:00.000Z'));

    expect(
      expiredBackups(stored(onlyOne, lone), DEFAULT_RETENTION_DAYS, now),
    ).toEqual([]);
  });

  it('keeps a yearly backup for ten years', () => {
    const nineYears = backupKey('yearly', at('2017-10-28T00:00:00.000Z'));
    const elevenYears = backupKey('yearly', at('2015-10-28T00:00:00.000Z'));
    const newest = backupKey('yearly', at('2026-01-01T00:00:00.000Z'));

    expect(
      expiredBackups(
        stored(nineYears, elevenYears, newest),
        DEFAULT_RETENTION_DAYS,
        now,
      ),
    ).toEqual([elevenYears]);
  });

  it('leaves alone anything that is not a backup', () => {
    expect(
      expiredBackups(
        stored('backups/readme.txt', 'somewhere/else'),
        DEFAULT_RETENTION_DAYS,
        now,
      ),
    ).toEqual([]);
  });

  it('follows a retention changed from the environment', () => {
    const old = backupKey('daily', at('2026-10-20T00:00:00.000Z'));
    const newest = backupKey('daily', at('2026-10-27T00:00:00.000Z'));

    expect(
      expiredBackups(
        stored(old, newest),
        { ...DEFAULT_RETENTION_DAYS, daily: 5 },
        now,
      ),
    ).toEqual([old]);
  });
});

describe('latestInTier', () => {
  it('finds the newest backup in a tier, ignoring other tiers', () => {
    const items = stored(
      backupKey('daily', at('2026-10-26T00:00:00.000Z')),
      backupKey('daily', at('2026-10-27T00:00:00.000Z')),
      backupKey('weekly', at('2026-10-28T00:00:00.000Z')),
    );

    expect(latestInTier(items, 'daily')?.takenAt.toISOString()).toBe(
      '2026-10-27T00:00:00.000Z',
    );
  });

  it('is null for an empty tier', () => {
    expect(latestInTier([], 'monthly')).toBeNull();
  });
});
