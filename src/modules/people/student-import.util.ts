import { randomInt, randomUUID } from 'crypto';

/** Everything one imported line can say. All of it arrives as text, as it does in a spreadsheet. */
export interface ImportRow {
  name?: string;
  regNo?: string;
  email?: string;
  dob?: string;
  gender?: string;
  className?: string;
  sectionName?: string;
  admissionDate?: string;
  religion?: string;
  cnic?: string;
  prevSchool?: string;
  guardianName?: string;
  guardianPhone?: string;
  guardianRelation?: string;
}

export type Gender = 'MALE' | 'FEMALE' | 'OTHER';
export type Religion = 'ISLAM' | 'CHRISTIANITY' | 'HINDUISM' | 'OTHER';
export type GuardianRelation = 'FATHER' | 'MOTHER' | 'UNCLE' | 'AUNT' | 'OTHER';

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

const isRealDay = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/**
 * A date as written in a spreadsheet, as `YYYY-MM-DD`. Day first, as in
 * Pakistan (`12/06/2016` is the 12th of June), and also `2016-06-12`,
 * `12-06-2016` and `12 Jun 2016`.
 *
 * @param {string} value - The text.
 * @returns {string | null} The date, or null when it is not a real date.
 */
export function parseImportDate(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) {
    const [year, month, day] = [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ];
    return isRealDay(year, month, day) ? iso(year, month, day) : null;
  }
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (match) {
    const [day, month, year] = [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ];
    return isRealDay(year, month, day) ? iso(year, month, day) : null;
  }
  match = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ ,-]*(\d{4})$/.exec(text);
  if (match) {
    const month = MONTHS.indexOf(match[2].toLowerCase()) + 1;
    const [day, year] = [Number(match[1]), Number(match[3])];
    return month > 0 && isRealDay(year, month, day)
      ? iso(year, month, day)
      : null;
  }
  return null;
}

/** `male`, `m`, `boy` and the like. Returns null for something unrecognised. */
export function parseGender(value: string | undefined): Gender | null {
  const text = (value ?? '').trim().toLowerCase();
  if (['male', 'm', 'boy', 'b'].includes(text)) return 'MALE';
  if (['female', 'f', 'girl', 'g'].includes(text)) return 'FEMALE';
  if (['other', 'o'].includes(text)) return 'OTHER';
  return null;
}

/**
 * The religion column is optional: nothing means none, and something that is
 * not recognised is reported rather than guessed.
 *
 * @returns {Religion | null | undefined} undefined when blank, null when not recognised.
 */
export function parseReligion(
  value: string | undefined,
): Religion | null | undefined {
  const text = (value ?? '').trim().toLowerCase();
  if (!text) return undefined;
  if (['islam', 'muslim'].includes(text)) return 'ISLAM';
  if (['christianity', 'christian'].includes(text)) return 'CHRISTIANITY';
  if (['hinduism', 'hindu'].includes(text)) return 'HINDUISM';
  if (['other', 'others'].includes(text)) return 'OTHER';
  return null;
}

/** `father`, `mother`, `uncle`, `aunt`; `guardian` and anything else a school writes counts as other. */
export function parseRelation(
  value: string | undefined,
): GuardianRelation | null {
  const text = (value ?? '').trim().toLowerCase();
  if (!text) return 'OTHER';
  if (['father', 'dad', 'abu'].includes(text)) return 'FATHER';
  if (['mother', 'mom', 'mum', 'ammi'].includes(text)) return 'MOTHER';
  if (text === 'uncle') return 'UNCLE';
  if (text === 'aunt') return 'AUNT';
  if (
    [
      'other',
      'guardian',
      'brother',
      'sister',
      'grandfather',
      'grandmother',
    ].includes(text)
  ) {
    return 'OTHER';
  }
  return null;
}

/**
 * A phone number as the system stores it: digits, with a leading `+` kept.
 * Spaces, dashes and brackets are dropped. A Pakistani number written with the
 * country code (`+92 300 1234567`, `0092...`, `92300...`) is written the local
 * way (`03001234567`), so the same family is never given two guardians.
 *
 * @returns {string | null} The number, or null when it is not 7 to 15 digits.
 */
export function normalizePhone(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const plus = text.startsWith('+') ? '+' : '';
  let digits = text.replace(/\D/g, '');
  if (digits.startsWith('0092')) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith('92')) {
    return `0${digits.slice(2)}`;
  }
  return digits.length >= 7 && digits.length <= 15 ? `${plus}${digits}` : null;
}

/** A name or label compared without regard to case, extra spaces or a trailing dot. */
export const normalizeLabel = (value: string | undefined): string =>
  (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** A first password to hand to a family: ten letters and digits, none easily mistaken for another. */
export function generatePassword(): string {
  return Array.from(
    { length: 10 },
    () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)],
  ).join('');
}

/**
 * An address for an account that has none. It can never receive mail, and it
 * is unique, so many students without email can be imported.
 */
export function placeholderEmail(): string {
  return `no-email-${randomUUID().slice(0, 12)}@import.nexus.invalid`;
}

/** Years between two `YYYY-MM-DD` dates, as a decimal. */
export function yearsBetween(from: string, to: string): number {
  return (
    (new Date(`${to}T00:00:00.000Z`).getTime() -
      new Date(`${from}T00:00:00.000Z`).getTime()) /
    (365.25 * 86_400_000)
  );
}
