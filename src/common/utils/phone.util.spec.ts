import { BadRequestException } from '@nestjs/common';
import {
  COUNTRY_CODE_LIST,
  isCountryCode,
  requireE164,
  readPhone,
  resolveCountry,
  signInCandidates,
  storedPhoneVariants,
  toE164,
} from './phone.util';

describe('phone util', () => {
  it.each([
    ['0300 1234567', 'PK', '+923001234567'],
    ['+92 300 1234567', 'PK', '+923001234567'],
    ['0092 300 1234567', 'PK', '+923001234567'],
    ['03001234567', undefined, '+923001234567'],
    ['+44 7911 123456', 'PK', '+447911123456'],
    ['50 123 4567', 'AE', '+971501234567'],
  ])('reads %s (%s) as %s', (raw, country, expected) => {
    expect(toE164(raw, country)).toBe(expected);
  });

  it.each(['', '   ', '123', 'not a number', '+92 12'])('rejects %s', (raw) => {
    expect(toE164(raw, 'PK')).toBeNull();
  });

  it('rejects nothing at all', () => {
    expect(toE164(null)).toBeNull();
    expect(toE164(undefined)).toBeNull();
  });

  it('knows which country codes are real', () => {
    expect(isCountryCode('pk')).toBe(true);
    expect(isCountryCode('AE')).toBe(true);
    expect(isCountryCode('ZZ')).toBe(false);
    expect(isCountryCode(null)).toBe(false);
    expect(COUNTRY_CODE_LIST.length).toBeGreaterThan(200);
  });

  it('falls back to Pakistan for an unknown country', () => {
    expect(resolveCountry('ae')).toBe('AE');
    expect(resolveCountry('ZZ')).toBe('PK');
    expect(resolveCountry(undefined)).toBe('PK');
  });

  it('lists every way a number may already be stored', () => {
    const variants = storedPhoneVariants('0300-1234567', 'PK');

    expect(variants).toEqual(
      expect.arrayContaining([
        '+923001234567',
        '03001234567',
        '3001234567',
        '0300-1234567',
      ]),
    );
    expect(storedPhoneVariants('12', 'PK')).toEqual([]);
    expect(storedPhoneVariants(undefined)).toEqual([]);
  });

  it('tries every form a sign-in name may be stored in', () => {
    expect(signInCandidates(' 0300 1234567 ')).toEqual([
      '0300 1234567',
      '+923001234567',
      '03001234567',
    ]);
    expect(signInCandidates('+971 50 123 4567')).toEqual([
      '+971 50 123 4567',
      '+971501234567',
    ]);
    expect(signInCandidates('2026-0001')).toEqual(['2026-0001']);
    expect(signInCandidates('parent@home.test')).toEqual(['parent@home.test']);
  });

  describe('readPhone — countries that share a calling code', () => {
    it('keeps the country that was chosen when the number belongs to it', () => {
      expect(readPhone('+1 604 555 0123', 'CA')).toEqual({
        number: '+16045550123',
        country: 'CA',
      });
      expect(readPhone('+1 212 555 0123', 'US')).toEqual({
        number: '+12125550123',
        country: 'US',
      });
    });

    it('refuses a number that is valid, but for another country than the one chosen', () => {
      expect(readPhone('+1 212 555 0123', 'CA')).toBeNull();
      expect(readPhone('+1 242 555 0123', 'US')).toBeNull();
    });

    it('works out the country when none was chosen', () => {
      expect(readPhone('+1 604 555 0123')?.country).toBe('CA');
      expect(readPhone('0300 1234567', undefined, 'PK')?.country).toBe('PK');
    });

    it('lets a calling code that contradicts the chosen country win', () => {
      expect(readPhone('+971 50 123 4567', 'PK')).toEqual({
        number: '+971501234567',
        country: 'AE',
      });
    });
  });

  it('requireE164 returns the number or names what was wrong', () => {
    expect(requireE164('0300 1234567', 'PK')).toBe('+923001234567');
    expect(() => requireE164('12', 'PK', 'Guardian phone')).toThrow(
      BadRequestException,
    );
    expect(() => requireE164('12', 'PK', 'Guardian phone')).toThrow(
      /Guardian phone "12" is not a valid phone number/,
    );
  });
});
