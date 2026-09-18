import { BadRequestException, Injectable } from '@nestjs/common';
import { DayOfWeek } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Fail-safe default used only when neither a campus nor its parent
 *  institution can be resolved at all (e.g. a campus mid-setup with no
 *  institutionId yet) — matches the migration's own documented backfill
 *  policy (see P0-6-7-9-CORRECTIVE-DESIGN.md § 3.3), never a silent guess
 *  invented here. */
const FAILSAFE_TIMEZONE = 'Asia/Karachi';

/** JS Date#getUTCDay()-shaped index (0 = Sunday) -> Prisma DayOfWeek,
 *  reused by localDayOfWeek() below — Intl's weekday formatting is
 *  locale/string based, so this table is still the simplest reliable way to
 *  map "Sunday"/"Monday"/... text back onto the enum. */
const DAY_OF_WEEK_BY_NAME: Record<string, DayOfWeek> = {
  Sunday: DayOfWeek.SUNDAY,
  Monday: DayOfWeek.MONDAY,
  Tuesday: DayOfWeek.TUESDAY,
  Wednesday: DayOfWeek.WEDNESDAY,
  Thursday: DayOfWeek.THURSDAY,
  Friday: DayOfWeek.FRIDAY,
  Saturday: DayOfWeek.SATURDAY,
};

interface ZonedParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

/**
 * P0-7 (§ 4 of P0-6-7-9-CORRECTIVE-DESIGN.md): single shared resolution
 * point for every campus/institution timezone lookup and every wall-clock
 * <-> UTC-instant conversion used by AttendanceService and SchedulerService.
 * No new dependency — Node's built-in Intl.DateTimeFormat covers IANA zone
 * validation and DST-correct instant resolution without a timezone-database
 * library (date-fns-tz/luxon/moment-timezone), per the design doc's § 3.2
 * investigation.
 */
@Injectable()
export class TimezoneResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Campus timezone if explicitly set, else the parent institution's, else
   * the documented Asia/Karachi fail-safe. Never throws — a campus mid-setup
   * with no institutionId yet must not crash the hourly cron.
   *
   * @param {string} campusId
   * @returns {Promise<string>} A validated IANA timezone identifier.
   */
  async resolveForCampus(campusId: string): Promise<string> {
    const campus = await this.prisma.campus.findUnique({
      where: { id: campusId },
      select: { timezone: true, institution: { select: { timezone: true } } },
    });

    return (
      campus?.timezone ?? campus?.institution?.timezone ?? FAILSAFE_TIMEZONE
    );
  }

  /**
   * "YYYY-MM-DD" for the given instant (default: right now), resolved in
   * the given IANA zone — replaces every
   * `new Date().toISOString().slice(0, 10)` call in scheduler/attendance,
   * which silently used the UTC calendar date instead of the campus's local
   * one.
   *
   * @param {string} timezone - IANA identifier.
   * @param {Date} [at] - Instant to resolve; defaults to now.
   * @returns {string} "YYYY-MM-DD" in the given zone.
   */
  localDateString(timezone: string, at: Date = new Date()): string {
    // en-CA locale is the standard trick for ISO-ordered (YYYY-MM-DD)
    // output without manual string surgery.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  }

  /**
   * DayOfWeek enum for the given instant (default: right now), resolved in
   * the given IANA zone — replaces
   * `DAY_OF_WEEK_BY_JS_INDEX[now.getUTCDay()]`, which picked the wrong
   * weekday whenever local midnight and UTC midnight fall on different
   * calendar dates.
   *
   * @param {string} timezone - IANA identifier.
   * @param {Date} [at] - Instant to resolve; defaults to now.
   * @returns {DayOfWeek}
   */
  localDayOfWeek(timezone: string, at: Date = new Date()): DayOfWeek {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
    }).format(at);
    return DAY_OF_WEEK_BY_NAME[weekday] ?? DayOfWeek.SUNDAY;
  }

  /**
   * Resolves a "HH:mm" wall-clock string + a "YYYY-MM-DD" date, in the
   * given zone, to the equivalent UTC instant — replaces every
   * `new Date(`${dateStr}T${time}:00.000Z`)` construction, which silently
   * treated an admin-entered local time as literal UTC.
   *
   * Two-pass correction: a first guess treats the wall-clock string as if
   * it were UTC, then reads back what that instant looks like in the
   * target zone and corrects by the observed delta. A single pass can be
   * off by the DST delta right at a transition boundary; two passes
   * converge correctly on both sides of it.
   *
   * @param {string} timezone - IANA identifier.
   * @param {string} dateStr - "YYYY-MM-DD".
   * @param {string} time - "HH:mm" (optionally "HH:mm:ss").
   * @returns {Date} The equivalent UTC instant.
   * @throws {BadRequestException} If `time` isn't a valid "HH:mm" prefix.
   */
  zonedTimeToInstant(timezone: string, dateStr: string, time: string): Date {
    const match = /^(\d{2}):(\d{2})/.exec(time);
    if (!match) {
      throw new BadRequestException(
        `Invalid time value "${time}" — expected "HH:mm".`,
      );
    }
    const h = Number(match[1]);
    const m = Number(match[2]);
    const targetY = Number(dateStr.slice(0, 4));
    const targetMo = Number(dateStr.slice(5, 7));
    const targetD = Number(dateStr.slice(8, 10));

    let guess = new Date(`${dateStr}T${match[1]}:${match[2]}:00.000Z`);
    for (let i = 0; i < 2; i++) {
      const parts = this.readZonedParts(guess, timezone);
      const deltaMs =
        Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi) -
        Date.UTC(targetY, targetMo - 1, targetD, h, m);
      guess = new Date(guess.getTime() - deltaMs);
    }
    return guess;
  }

  /**
   * Validates an IANA timezone identifier; throws if invalid. Used by
   * CampusesService/PlatformService on write, and by the working-calendar
   * module's DTOs where applicable.
   *
   * @param {string} timezone
   * @throws {BadRequestException} If `timezone` is not a valid IANA zone.
   */
  assertValidTimezone(timezone: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      throw new BadRequestException(
        `"${timezone}" is not a valid IANA timezone identifier.`,
      );
    }
  }

  /** Reads the numeric y/mo/d/h/mi parts of `instant` as displayed in
   *  `timezone` — the private helper `zonedTimeToInstant` needs to invert
   *  Intl's forward-only "instant -> local parts" resolution. */
  private readZonedParts(instant: Date, timezone: string): ZonedParts {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);

    const read = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');

    return {
      y: read('year'),
      mo: read('month'),
      d: read('day'),
      h: read('hour'),
      mi: read('minute'),
    };
  }
}
