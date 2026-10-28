import { BadRequestException } from '@nestjs/common';
import {
  CountryCode,
  getCountries,
  parsePhoneNumberFromString,
} from 'libphonenumber-js/min';

/** Used when a school has not chosen a default country. */
export const FALLBACK_COUNTRY: CountryCode = 'PK';

const COUNTRY_CODES = new Set<string>(getCountries());

/** Every country code the phone rules know, such as `PK` or `AE`. */
export const COUNTRY_CODE_LIST: string[] = getCountries();

/**
 * @param {string | null | undefined} value - A country code in any case.
 * @returns {value is CountryCode} Whether it is a country the phone rules know.
 */
export function isCountryCode(
  value: string | null | undefined,
): value is CountryCode {
  return Boolean(value) && COUNTRY_CODES.has((value as string).toUpperCase());
}

/**
 * @param {string | null | undefined} value - A country code, or nothing.
 * @returns {CountryCode} The code upper-cased if it is a known country, otherwise the fallback.
 */
export function resolveCountry(value: string | null | undefined): CountryCode {
  return isCountryCode(value)
    ? (value.toUpperCase() as CountryCode)
    : FALLBACK_COUNTRY;
}

/**
 * Reads a number as a full international number. One that starts with `+` or
 * `00` is taken as written; any other is read as a number of the given
 * country, so `0300 1234567` is a Pakistani number for a Pakistani school.
 *
 * @param {string | null | undefined} raw - The number as written.
 * @param {string | null | undefined} [country] - The country a number without a calling code belongs to.
 * @returns {string | null} The number as `+923001234567`, or null when it is not a valid number.
 */
export function toE164(
  raw: string | null | undefined,
  country?: string | null,
): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const international = text.startsWith('00') ? `+${text.slice(2)}` : text;
  const parsed = parsePhoneNumberFromString(
    international,
    resolveCountry(country),
  );
  return parsed?.isValid() ? parsed.number : null;
}

/**
 * Like {@link toE164} but refuses a number that cannot be right, naming what it was for.
 *
 * @param {string} raw - The number as written.
 * @param {string | null | undefined} country - The country a number without a calling code belongs to.
 * @param {string} [label] - What the number is, for the message ("Guardian phone").
 * @returns {string} The number as `+923001234567`.
 * @throws {BadRequestException} When it is not a valid number.
 */
export function requireE164(
  raw: string,
  country: string | null | undefined,
  label = 'Phone number',
): string {
  const number = toE164(raw, country);
  if (!number) {
    throw new BadRequestException(
      `${label} "${raw.trim()}" is not a valid phone number. Include the country code for a number from another country.`,
    );
  }
  return number;
}
