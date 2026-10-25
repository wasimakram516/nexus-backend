import {
  formatClockRange,
  formatClockTime,
  formatDate,
  formatDateTime,
  formatTime,
} from './date-format.util';

describe('date-format.util', () => {
  describe('formatDate', () => {
    it('writes a date as day, short month and year without padding the day', () => {
      expect(formatDate('2026-10-25')).toBe('25 Oct 2026');
      expect(formatDate('2026-11-02')).toBe('2 Nov 2026');
      expect(formatDate('2027-01-05')).toBe('5 Jan 2027');
    });

    it('writes a calendar date as stored, whatever the timezone', () => {
      expect(
        formatDate('2026-10-25T00:00:00.000Z', 'America/Los_Angeles'),
      ).toBe('25 Oct 2026');
      expect(
        formatDate(new Date('2026-10-25T00:00:00.000Z'), 'Pacific/Auckland'),
      ).toBe('25 Oct 2026');
    });

    it('writes an instant on the day it falls in the school timezone', () => {
      // 20:00 UTC on the 24th is already the 25th in Karachi, still the 24th in London.
      expect(formatDate('2026-10-24T20:00:00.000Z', 'Asia/Karachi')).toBe(
        '25 Oct 2026',
      );
      expect(formatDate('2026-10-24T20:00:00.000Z', 'Europe/London')).toBe(
        '24 Oct 2026',
      );
    });

    it('uses Karachi when no timezone is given and returns nothing for a non-date', () => {
      expect(formatDate('2026-10-24T20:00:00.000Z')).toBe('25 Oct 2026');
      expect(formatDate('not a date')).toBe('');
    });
  });

  describe('formatTime and formatDateTime', () => {
    it('writes a 12 hour time with AM or PM and no leading zero', () => {
      expect(formatTime('2026-10-25T03:00:00.000Z', 'Asia/Karachi')).toBe(
        '8:00 AM',
      );
      expect(formatTime('2026-10-25T10:05:00.000Z', 'Asia/Karachi')).toBe(
        '3:05 PM',
      );
    });

    it('writes midnight as 12 AM and noon as 12 PM', () => {
      expect(formatTime('2026-10-24T19:00:00.000Z', 'Asia/Karachi')).toBe(
        '12:00 AM',
      );
      expect(formatTime('2026-10-25T07:00:00.000Z', 'Asia/Karachi')).toBe(
        '12:00 PM',
      );
    });

    it('writes the date and time together in the school timezone', () => {
      expect(formatDateTime('2026-10-24T20:30:00.000Z', 'Asia/Karachi')).toBe(
        '25 Oct 2026, 1:30 AM',
      );
      expect(formatDateTime('2026-10-24T20:30:00.000Z', 'Europe/London')).toBe(
        '24 Oct 2026, 9:30 PM',
      );
    });

    it('returns nothing for a value that is not a date', () => {
      expect(formatTime('nope')).toBe('');
      expect(formatDateTime('nope')).toBe('');
    });
  });

  describe('formatClockTime and formatClockRange', () => {
    it('turns a stored 24 hour time into 12 hour without converting a timezone', () => {
      expect(formatClockTime('08:00')).toBe('8:00 AM');
      expect(formatClockTime('13:40')).toBe('1:40 PM');
      expect(formatClockTime('00:15')).toBe('12:15 AM');
      expect(formatClockTime('12:00')).toBe('12:00 PM');
    });

    it('leaves a value that is not a time as it is', () => {
      expect(formatClockTime('soon')).toBe('soon');
    });

    it('writes a range', () => {
      expect(formatClockRange('08:00', '08:40')).toBe('8:00 AM - 8:40 AM');
      expect(formatClockRange('11:30', '12:10')).toBe('11:30 AM - 12:10 PM');
    });
  });
});
