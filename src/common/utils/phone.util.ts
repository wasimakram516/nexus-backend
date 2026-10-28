import { BadRequestException } from '@nestjs/common';
import {
  CountryCode,
  getCountries,
  getCountryCallingCode,
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
 * Every way a number may already be stored: international, national with and
 * without the leading zero, and as typed. Numbers saved before international
 * form was kept are matched through these, so the same person is not added twice.
 *
 * @param {string | null | undefined} raw - The number as written.
 * @param {string | null | undefined} [country] - The country a number without a calling code belongs to.
 * @returns {string[]} The forms to look for; empty when it is not a valid number.
 */
export function storedPhoneVariants(
  raw: string | null | undefined,
  country?: string | null,
): string[] {
  const text = (raw ?? '').trim();
  const international = text.startsWith('00') ? `+${text.slice(2)}` : text;
  const parsed = parsePhoneNumberFromString(
    international,
    resolveCountry(country),
  );
  if (!parsed?.isValid()) return [];
  return Array.from(
    new Set([
      parsed.number,
      `0${parsed.nationalNumber}`,
      parsed.nationalNumber,
      text,
      text.replace(/[^\d+]/g, ''),
    ]),
  ).filter(Boolean);
}

/**
 * What a sign-in name might be stored as. A guardian signs in with a phone
 * number that is now kept in international form, but may type it any way, and
 * numbers saved earlier are in the local Pakistani form, so each is tried.
 *
 * @param {string} raw - What was typed at sign-in.
 * @returns {string[]} The typed text first, then the international form and, for a Pakistani number, the old local form.
 */
export function signInCandidates(raw: string): string[] {
  const text = raw.trim();
  const candidates = [text];
  const international = toE164(text, FALLBACK_COUNTRY);
  if (international) {
    candidates.push(international);
    if (international.startsWith('+92')) {
      candidates.push(`0${international.slice(3)}`);
    }
  }
  return Array.from(new Set(candidates));
}

/** A phone number in international form, with the country it was entered for. */
export interface PhoneWithCountry {
  number: string;
  /** ISO country code such as `PK`, or null when the number does not identify one. */
  country: string | null;
}

/**
 * Reads a number and decides which country to keep beside it. Countries share
 * calling codes (+1, +7, +44), so when a country is chosen the number must be
 * valid for that country, not just somewhere: a Bahamas number is refused for
 * Canada. A choice that contradicts the calling code itself (Pakistan chosen
 * for a +971 number) is ignored and the number's own country is used.
 *
 * @param {string} raw - The number as written.
 * @param {string | null | undefined} chosen - The country the person picked, if any.
 * @param {string | null | undefined} [fallback] - The country a number without a calling code belongs to.
 * @returns {PhoneWithCountry | null} The number and its country, or null when it is not a valid number.
 */
export function readPhone(
  raw: string | null | undefined,
  chosen?: string | null,
  fallback?: string | null,
): PhoneWithCountry | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const international = text.startsWith('00') ? `+${text.slice(2)}` : text;
  const parsed = parsePhoneNumberFromString(
    international,
    resolveCountry(chosen ?? fallback),
  );
  if (!parsed?.isValid()) return null;
  const region = isCountryCode(chosen)
    ? (chosen.toUpperCase() as CountryCode)
    : null;
  const sameCode =
    region !== null &&
    getCountryCallingCode(region) === parsed.countryCallingCode;
  // Shared calling code: the digits must belong to the chosen country.
  if (sameCode && parsed.country && parsed.country !== region) return null;
  return {
    number: parsed.number,
    country: sameCode ? region : (parsed.country ?? null),
  };
}

/**
 * Like {@link readPhone} but refuses a number that cannot be right, naming what it was for.
 *
 * @param {string} raw - The number as written.
 * @param {string | null | undefined} chosen - The country the person picked, if any.
 * @param {string | null | undefined} fallback - The country a number without a calling code belongs to.
 * @param {string} [label] - What the number is, for the message.
 * @returns {PhoneWithCountry} The number and its country.
 * @throws {BadRequestException} When it is not a valid number.
 */
export function requirePhone(
  raw: string,
  chosen: string | null | undefined,
  fallback: string | null | undefined,
  label = 'Phone number',
): PhoneWithCountry {
  const phone = readPhone(raw, chosen, fallback);
  if (!phone) {
    throw new BadRequestException(
      `${label} "${raw.trim()}" is not a valid phone number. Include the country code for a number from another country.`,
    );
  }
  return phone;
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
