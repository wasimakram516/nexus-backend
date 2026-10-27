import {
  generatePassword,
  normalizeLabel,
  normalizePhone,
  parseGender,
  parseImportDate,
  parseReligion,
  parseRelation,
  placeholderEmail,
  yearsBetween,
} from './student-import.util';

describe('student-import.util', () => {
  describe('parseImportDate', () => {
    it.each([
      ['2016-06-12', '2016-06-12'],
      ['2016-6-2', '2016-06-02'],
      ['12/06/2016', '2016-06-12'],
      ['12-06-2016', '2016-06-12'],
      ['12.06.2016', '2016-06-12'],
      ['5/1/2015', '2015-01-05'],
      ['12 Jun 2016', '2016-06-12'],
      ['12-June-2016', '2016-06-12'],
      ['  29 feb 2016 ', '2016-02-29'],
    ])('reads %s as %s', (input, expected) => {
      expect(parseImportDate(input)).toBe(expected);
    });

    it.each([
      '',
      'soon',
      '31/04/2016',
      '29/02/2015',
      '2016-13-01',
      '13/13/2016',
      '12 Foo 2016',
    ])('refuses %s', (input) => {
      expect(parseImportDate(input)).toBeNull();
    });

    it('treats a missing value as no date', () => {
      expect(parseImportDate(undefined)).toBeNull();
    });
  });

  describe('words', () => {
    it('reads gender in its common spellings', () => {
      expect(parseGender('Male')).toBe('MALE');
      expect(parseGender(' f ')).toBe('FEMALE');
      expect(parseGender('Girl')).toBe('FEMALE');
      expect(parseGender('other')).toBe('OTHER');
      expect(parseGender('')).toBeNull();
      expect(parseGender('x')).toBeNull();
    });

    it('treats religion as optional and reports one it does not know', () => {
      expect(parseReligion('')).toBeUndefined();
      expect(parseReligion(undefined)).toBeUndefined();
      expect(parseReligion('Muslim')).toBe('ISLAM');
      expect(parseReligion('Christian')).toBe('CHRISTIANITY');
      expect(parseReligion('hindu')).toBe('HINDUISM');
      expect(parseReligion('Sikh')).toBeNull();
    });

    it('reads a relation, with other for guardians and kin, and nothing meaning other', () => {
      expect(parseRelation('Father')).toBe('FATHER');
      expect(parseRelation('mother')).toBe('MOTHER');
      expect(parseRelation('uncle')).toBe('UNCLE');
      expect(parseRelation('Aunt')).toBe('AUNT');
      expect(parseRelation('guardian')).toBe('OTHER');
      expect(parseRelation('')).toBe('OTHER');
      expect(parseRelation('neighbour')).toBeNull();
    });
  });

  describe('normalizePhone', () => {
    it('keeps digits and a leading plus, dropping spaces, dashes and brackets', () => {
      expect(normalizePhone('0300-123 4567')).toBe('03001234567');
      expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    });

    it('writes a Pakistani number given with the country code the local way, so it matches the same family', () => {
      expect(normalizePhone('+92 300 1234567')).toBe('03001234567');
      expect(normalizePhone('0092-300-1234567')).toBe('03001234567');
      expect(normalizePhone('923001234567')).toBe('03001234567');
      expect(normalizePhone('03001234567')).toBe('03001234567');
    });

    it('refuses too few or too many digits, and blanks', () => {
      expect(normalizePhone('12345')).toBeNull();
      expect(normalizePhone('1'.repeat(16))).toBeNull();
      expect(normalizePhone('   ')).toBeNull();
      expect(normalizePhone(undefined)).toBeNull();
      expect(normalizePhone('call me')).toBeNull();
    });
  });

  it('compares labels without regard to case or extra spaces', () => {
    expect(normalizeLabel('  Grade   5 ')).toBe('grade 5');
    expect(normalizeLabel(undefined)).toBe('');
  });

  describe('generated values', () => {
    it('makes ten-character passwords without letters that look alike, and not the same twice', () => {
      const passwords = new Set(Array.from({ length: 50 }, generatePassword));

      expect(passwords.size).toBe(50);
      for (const password of passwords) {
        expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{10}$/);
      }
    });

    it('makes a unique address that can never receive mail', () => {
      const first = placeholderEmail();

      expect(first).toMatch(/^no-email-[0-9a-f-]{12}@import\.nexus\.invalid$/);
      expect(placeholderEmail()).not.toBe(first);
    });
  });

  it('counts years between two dates', () => {
    expect(yearsBetween('2016-06-12', '2026-06-12')).toBeCloseTo(10, 1);
    expect(yearsBetween('2026-06-12', '2016-06-12')).toBeLessThan(0);
  });
});
