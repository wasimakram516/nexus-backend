import { BadRequestException } from '@nestjs/common';
import {
  addDays,
  daysBetween,
  daysOfMonth,
  isRealDate,
  requireRealDate,
  resolvePeriod,
} from './report-dates.util';

describe('report-dates.util', () => {
  it('knows a real day from one that only looks like a date', () => {
    expect(isRealDate('2026-10-25')).toBe(true);
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2026-04-31')).toBe(false);
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('25-10-2026')).toBe(false);
  });

  it('refuses a date that is not real, naming it', () => {
    expect(requireRealDate('2026-10-25', 'The date')).toBe('2026-10-25');
    expect(() => requireRealDate('2026-02-30', 'The date')).toThrow(
      'The date must be a real date (YYYY-MM-DD).',
    );
  });

  it('moves and counts days across month and year ends, inclusive', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(31);
    expect(daysBetween('2026-10-05', '2026-10-05')).toBe(1);
  });

  it('lists every day of a month, including a leap February', () => {
    expect(daysOfMonth('2026-10')).toHaveLength(31);
    expect(daysOfMonth('2026-02')).toHaveLength(28);
    expect(daysOfMonth('2028-02')).toHaveLength(29);
    expect(daysOfMonth('2026-10')[0]).toBe('2026-10-01');
  });

  describe('resolvePeriod', () => {
    it('defaults to the start of the month through today', () => {
      expect(resolvePeriod({}, '2026-10-25')).toEqual({
        from: '2026-10-01',
        to: '2026-10-25',
      });
    });

    it('starts the default period in the month of the end date it was given', () => {
      expect(resolvePeriod({ to: '2026-08-15' }, '2026-10-25')).toEqual({
        from: '2026-08-01',
        to: '2026-08-15',
      });
    });

    it('takes both dates as sent', () => {
      expect(
        resolvePeriod({ from: '2026-09-01', to: '2026-09-30' }, '2026-10-25'),
      ).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    });

    it('refuses dates that are not real, out of order, or more than a year long', () => {
      expect(() => resolvePeriod({ from: '2026-02-30' }, '2026-10-25')).toThrow(
        BadRequestException,
      );
      expect(() =>
        resolvePeriod({ from: '2026-10-10', to: '2026-10-01' }, '2026-10-25'),
      ).toThrow('The start date must not be after the end date.');
      expect(() =>
        resolvePeriod({ from: '2025-01-01', to: '2026-10-01' }, '2026-10-25'),
      ).toThrow('A report can cover at most 366 days.');
    });

    it('allows exactly a leap year', () => {
      expect(() =>
        resolvePeriod({ from: '2027-01-01', to: '2027-12-31' }, '2028-01-01'),
      ).not.toThrow();
    });
  });
});
