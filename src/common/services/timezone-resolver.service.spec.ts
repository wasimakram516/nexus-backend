import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DayOfWeek } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TimezoneResolverService } from './timezone-resolver.service';

/**
 * P0-7 Verification 2 (FOCUS-AREAS.md): zone correctness independent of
 * server time — Asia/Karachi, Asia/Dubai, local-vs-UTC midnight, and a real
 * DST spring-forward/fall-back boundary (America/New_York).
 */
describe('TimezoneResolverService', () => {
  let service: TimezoneResolverService;

  const prismaMock = {
    campus: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        TimezoneResolverService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(TimezoneResolverService);
  });

  describe('resolveForCampus', () => {
    it('uses the campus timezone when set', async () => {
      prismaMock.campus.findUnique.mockResolvedValue({
        timezone: 'Asia/Dubai',
        institution: { timezone: 'Asia/Karachi' },
      });
      await expect(service.resolveForCampus('campus-1')).resolves.toBe(
        'Asia/Dubai',
      );
    });

    it('falls back to the institution timezone when the campus has none', async () => {
      prismaMock.campus.findUnique.mockResolvedValue({
        timezone: null,
        institution: { timezone: 'Asia/Karachi' },
      });
      await expect(service.resolveForCampus('campus-1')).resolves.toBe(
        'Asia/Karachi',
      );
    });

    it('falls back to the Asia/Karachi fail-safe when the campus has no institution at all', async () => {
      prismaMock.campus.findUnique.mockResolvedValue({
        timezone: null,
        institution: null,
      });
      await expect(service.resolveForCampus('campus-1')).resolves.toBe(
        'Asia/Karachi',
      );
    });

    it('falls back to the fail-safe when the campus is not found (never throws)', async () => {
      prismaMock.campus.findUnique.mockResolvedValue(null);
      await expect(service.resolveForCampus('campus-1')).resolves.toBe(
        'Asia/Karachi',
      );
    });
  });

  describe('zonedTimeToInstant', () => {
    it('resolves Asia/Karachi (UTC+5, no DST): 14:00 local -> 09:00Z', () => {
      const instant = service.zonedTimeToInstant(
        'Asia/Karachi',
        '2026-06-15',
        '14:00',
      );
      expect(instant.toISOString()).toBe('2026-06-15T09:00:00.000Z');
    });

    it('resolves Asia/Dubai (UTC+4, no DST): 14:00 local -> 10:00Z', () => {
      const instant = service.zonedTimeToInstant(
        'Asia/Dubai',
        '2026-06-15',
        '14:00',
      );
      expect(instant.toISOString()).toBe('2026-06-15T10:00:00.000Z');
    });

    it('resolves local midnight correctly for a positive-offset zone whose local date differs from the UTC date', () => {
      // 00:30 local in Karachi (UTC+5) on 2026-06-16 is still 2026-06-15
      // 19:30 UTC — the exact "local midnight vs UTC midnight" case P0-7
      // reports for "today" selection.
      const instant = service.zonedTimeToInstant(
        'Asia/Karachi',
        '2026-06-16',
        '00:30',
      );
      expect(instant.toISOString()).toBe('2026-06-15T19:30:00.000Z');
    });

    it('resolves correctly on both sides of a US DST spring-forward boundary (America/New_York, 2026-03-08)', () => {
      // Before the transition (2026-03-08 01:00 local, still EST = UTC-5).
      const before = service.zonedTimeToInstant(
        'America/New_York',
        '2026-03-08',
        '01:00',
      );
      expect(before.toISOString()).toBe('2026-03-08T06:00:00.000Z');

      // After the transition (2026-03-08 03:00 local, now EDT = UTC-4 —
      // clocks jumped from 02:00 to 03:00 at 07:00 UTC).
      const after = service.zonedTimeToInstant(
        'America/New_York',
        '2026-03-08',
        '03:00',
      );
      expect(after.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    });

    it('resolves correctly on both sides of a US DST fall-back boundary (America/New_York, 2026-11-01)', () => {
      // Before the transition (2026-11-01 01:00 local EDT = UTC-4).
      const before = service.zonedTimeToInstant(
        'America/New_York',
        '2026-11-01',
        '01:00',
      );
      expect(before.toISOString()).toBe('2026-11-01T05:00:00.000Z');

      // After the transition (2026-11-01 03:00 local EST = UTC-5 — clocks
      // fell back from 02:00 to 01:00 at 06:00 UTC).
      const after = service.zonedTimeToInstant(
        'America/New_York',
        '2026-11-01',
        '03:00',
      );
      expect(after.toISOString()).toBe('2026-11-01T08:00:00.000Z');
    });

    it('throws BadRequestException on a malformed time string', () => {
      expect(() =>
        service.zonedTimeToInstant('Asia/Karachi', '2026-06-15', 'not-a-time'),
      ).toThrow(BadRequestException);
    });
  });

  describe('localDateString / localDayOfWeek', () => {
    it('resolves the zone-local calendar date and weekday, not the UTC ones, when they differ', () => {
      // 2026-06-15T20:30:00.000Z is 2026-06-16 01:30 in Karachi (UTC+5) —
      // Monday UTC, Tuesday local.
      const at = new Date('2026-06-15T20:30:00.000Z');
      expect(service.localDateString('Asia/Karachi', at)).toBe('2026-06-16');
      expect(service.localDayOfWeek('Asia/Karachi', at)).toBe(
        DayOfWeek.TUESDAY,
      );
    });

    it('is independent of the server process timezone (TZ env)', () => {
      const at = new Date('2026-06-15T20:30:00.000Z');
      const originalTz = process.env.TZ;
      try {
        process.env.TZ = 'America/Los_Angeles';
        expect(service.localDateString('Asia/Karachi', at)).toBe('2026-06-16');
        expect(service.localDayOfWeek('Asia/Karachi', at)).toBe(
          DayOfWeek.TUESDAY,
        );
      } finally {
        process.env.TZ = originalTz;
      }
    });
  });

  describe('assertValidTimezone', () => {
    it.each(['Asia/Karachi', 'Asia/Dubai', 'America/New_York', 'UTC'])(
      'accepts %s',
      (zone) => {
        expect(() => service.assertValidTimezone(zone)).not.toThrow();
      },
    );

    it.each(['Not/AZone', 'UTC+5', ''])('rejects %s', (zone) => {
      expect(() => service.assertValidTimezone(zone)).toThrow(
        BadRequestException,
      );
    });
  });
});
