import { BadRequestException } from '@nestjs/common';

/** The longest period a report may cover, so one request cannot scan years of records. */
export const MAX_REPORT_DAYS = 366;

const DAY_MS = 86_400_000;

/** Whether `YYYY-MM-DD` names a real day (not the 31st of April). */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/**
 * A date the caller sent, checked to be a real day.
 *
 * @param {string} value - `YYYY-MM-DD`.
 * @param {string} label - What it is called in the message.
 * @returns {string} The same value.
 * @throws {BadRequestException} If it is not a real day.
 */
export function requireRealDate(value: string, label: string): string {
  if (!isRealDate(value)) {
    throw new BadRequestException(`${label} must be a real date (YYYY-MM-DD).`);
  }
  return value;
}

/** A `YYYY-MM-DD` date as midnight UTC, which is how date columns are stored. */
export const dayStart = (value: string): Date =>
  new Date(`${value}T00:00:00.000Z`);

/** `YYYY-MM-DD` moved by whole days. */
export function addDays(value: string, days: number): string {
  return new Date(dayStart(value).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Whole days from `from` to `to`, inclusive. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / DAY_MS) + 1;

/**
 * The period a report covers: the dates sent, or from the start of the month
 * to `today`, checked to be real days, in order and not longer than a year.
 *
 * @param {{from?: string, to?: string}} query - What the caller sent.
 * @param {string} today - Today's date where the report is read.
 * @returns {{from: string, to: string}} The period.
 * @throws {BadRequestException} If a date is not real, they are out of order, or the period is too long.
 */
export function resolvePeriod(
  query: { from?: string; to?: string },
  today: string,
): { from: string; to: string } {
  const to = requireRealDate(query.to ?? today, 'The end date');
  const from = requireRealDate(
    query.from ?? `${to.slice(0, 7)}-01`,
    'The start date',
  );
  if (from > to) {
    throw new BadRequestException(
      'The start date must not be after the end date.',
    );
  }
  if (daysBetween(from, to) > MAX_REPORT_DAYS) {
    throw new BadRequestException(
      `A report can cover at most ${MAX_REPORT_DAYS} days.`,
    );
  }
  return { from, to };
}

/** Every day of a `YYYY-MM` month as `YYYY-MM-DD`. */
export function daysOfMonth(month: string): string[] {
  const [year, number] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
  );
}
