export const DEFAULT_DUE_DAY = 10;
export const DEFAULT_CURRENCY_LABEL = 'Rs.';
export const MAX_INSTRUCTIONS_LENGTH = 2000;
export const MAX_CONTACT_LENGTH = 200;
export const MAX_CURRENCY_LENGTH = 10;

export interface FinanceSettings {
  /** Day of the month vouchers fall due when none is chosen (1 to 28). */
  dueDayOfMonth: number;
  /** Shown beside amounts on printed vouchers, such as "Rs." or "SAR". */
  currencyLabel: string;
  /** Printed under the payment details, one instruction per line. */
  voucherInstructions: string[];
  /** The footer line of a printed voucher, such as queries email and phone. */
  voucherContact: string;
  /** Calculate last month's attendance fines by themselves on the 1st. Off unless a school turns it on. */
  autoCalculateFines: boolean;
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * The institution's `finance` setting with every missing or unusable field
 * replaced by its default, so callers never branch on a half-filled setting.
 *
 * @param {unknown} value - The stored setting value.
 * @returns {FinanceSettings} Usable settings.
 */
export function readFinanceSettings(value: unknown): FinanceSettings {
  const raw = asObject(value) ?? {};
  const day = raw.dueDayOfMonth;
  const currency =
    typeof raw.currencyLabel === 'string' ? raw.currencyLabel.trim() : '';
  const instructions =
    typeof raw.voucherInstructions === 'string' ? raw.voucherInstructions : '';
  return {
    dueDayOfMonth:
      typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 28
        ? day
        : DEFAULT_DUE_DAY,
    currencyLabel: currency || DEFAULT_CURRENCY_LABEL,
    voucherInstructions: instructions
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    voucherContact:
      typeof raw.voucherContact === 'string' ? raw.voucherContact.trim() : '',
    autoCalculateFines: raw.autoCalculateFines === true,
  };
}

/**
 * What is wrong with a submitted `finance` setting, so a bad value is
 * refused when saved instead of silently falling back to a default later.
 *
 * @param {unknown} value - The submitted setting value.
 * @returns {string | null} The problem, or null when the setting is valid.
 */
export function validateFinanceSettingInput(value: unknown): string | null {
  const raw = asObject(value);
  if (!raw) return 'The finance setting must be an object.';
  const day = raw.dueDayOfMonth;
  if (
    day !== undefined &&
    day !== null &&
    (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 28)
  ) {
    return 'dueDayOfMonth must be a whole number from 1 to 28.';
  }
  if (
    raw.autoCalculateFines !== undefined &&
    raw.autoCalculateFines !== null &&
    typeof raw.autoCalculateFines !== 'boolean'
  ) {
    return 'autoCalculateFines must be true or false.';
  }
  const text: Array<[string, number]> = [
    ['currencyLabel', MAX_CURRENCY_LENGTH],
    ['voucherInstructions', MAX_INSTRUCTIONS_LENGTH],
    ['voucherContact', MAX_CONTACT_LENGTH],
  ];
  for (const [field, max] of text) {
    const candidate = raw[field];
    if (candidate === undefined || candidate === null) continue;
    if (typeof candidate !== 'string' || candidate.length > max) {
      return `${field} must be text of at most ${max} characters.`;
    }
  }
  return null;
}
