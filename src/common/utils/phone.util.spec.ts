import { BadRequestException } from '@nestjs/common';
import {
  COUNTRY_CODE_LIST,
  isCountryCode,
  requireE164,
  resolveCountry,
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
