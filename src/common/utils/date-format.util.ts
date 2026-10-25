/**
 * The one way dates and times are written for people: `25 Oct 2026`,
 * `8:00 AM`, `25 Oct 2026, 8:00 AM`. Stored values stay ISO; these are only for
 * text a person reads (PDFs, messages, emails). The frontend has the same
 * rules in `src/lib/dateFormat.ts`; change both together.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Used when no school timezone is known. */
export const DEFAULT_DISPLAY_TIME_ZONE = 'Asia/Karachi';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MIDNIGHT_UTC = /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/;
const CLOCK_TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** The wall-clock parts of an instant in a timezone. */
function partsIn(date: Date, timeZone: string): Parts {
  const found = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) =>
    Number(found.find((part) => part.type === type)?.value ?? 0);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour') % 24,
    minute: pick('minute'),
  };
}

const writeDate = (parts: Pick<Parts, 'year' | 'month' | 'day'>) =>
  `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;

const writeTime = (hour: number, minute: number) =>
  `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${
    hour < 12 ? 'AM' : 'PM'
  }`;

/**
 * Whether a value is a calendar date (no time of day) rather than an instant:
 * a `YYYY-MM-DD` string, or midnight UTC, which is how a database date comes
 * back. A calendar date must not move to another day in another timezone.
 */
function isCalendarDate(value: Date | string): boolean {
  if (typeof value === 'string') {
    return DATE_ONLY.test(value) || MIDNIGHT_UTC.test(value);
  }
  return (
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  );
}

/**
 * A date as `25 Oct 2026`. A calendar date (a due date, an exam date) is
 * written as stored; any other instant is written on the day it falls in the
 * school's timezone.
 *
 * @param {Date | string} value - A date, an ISO string or a `YYYY-MM-DD` string.
 * @param {string} [timeZone] - The school's IANA timezone.
 * @returns {string} The date, or an empty string when the value is not a date.
 */
export function formatDate(
  value: Date | string,
  timeZone: string = DEFAULT_DISPLAY_TIME_ZONE,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (isCalendarDate(value)) {
    return writeDate({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    });
  }
  return writeDate(partsIn(date, timeZone));
}

/**
 * An instant's time of day as `8:00 AM` in the school's timezone.
 *
 * @param {Date | string} value - An instant.
 * @param {string} [timeZone] - The school's IANA timezone.
 * @returns {string} The time, or an empty string when the value is not a date.
 */
export function formatTime(
  value: Date | string,
  timeZone: string = DEFAULT_DISPLAY_TIME_ZONE,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = partsIn(date, timeZone);
  return writeTime(parts.hour, parts.minute);
}

/**
 * An instant as `25 Oct 2026, 8:00 AM` in the school's timezone.
 *
 * @param {Date | string} value - An instant.
 * @param {string} [timeZone] - The school's IANA timezone.
 * @returns {string} The date and time, or an empty string when the value is not a date.
 */
export function formatDateTime(
  value: Date | string,
  timeZone: string = DEFAULT_DISPLAY_TIME_ZONE,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = partsIn(date, timeZone);
  return `${writeDate(parts)}, ${writeTime(parts.hour, parts.minute)}`;
}

/**
 * A stored wall-clock time (`"08:00"`, 24 hour) as `8:00 AM`. A period's start
 * time has no timezone, so nothing is converted.
 *
 * @param {string} value - A `HH:mm` time.
 * @returns {string} The time, or the value unchanged when it is not `HH:mm`.
 */
export function formatClockTime(value: string): string {
  const match = CLOCK_TIME.exec(value);
  return match ? writeTime(Number(match[1]), Number(match[2])) : value;
}

/**
 * Two stored wall-clock times as `8:00 AM - 8:40 AM`.
 *
 * @param {string} start - A `HH:mm` start.
 * @param {string} end - A `HH:mm` end.
 * @returns {string} The range.
 */
export function formatClockRange(start: string, end: string): string {
  return `${formatClockTime(start)} - ${formatClockTime(end)}`;
}
