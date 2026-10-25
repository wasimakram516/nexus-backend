import {
  DEFAULT_CURRENCY_LABEL,
  DEFAULT_DUE_DAY,
  readFinanceSettings,
  validateFinanceSettingInput,
} from './finance-settings.util';

describe('readFinanceSettings', () => {
  it.each([undefined, null, 'text', [], 7])(
    'falls back to the defaults for %p',
    (value) => {
      expect(readFinanceSettings(value)).toEqual({
        dueDayOfMonth: DEFAULT_DUE_DAY,
        currencyLabel: DEFAULT_CURRENCY_LABEL,
        voucherInstructions: [],
        voucherContact: '',
        autoCalculateFines: false,
      });
    },
  );

  it('reads a complete setting, trimming text and splitting instructions into lines', () => {
    expect(
      readFinanceSettings({
        dueDayOfMonth: 5,
        currencyLabel: ' SAR ',
        voucherInstructions: ' Pay at the bank. \r\n\r\nKeep the receipt.\n',
        voucherContact: ' info@school.test ',
        autoCalculateFines: true,
      }),
    ).toEqual({
      dueDayOfMonth: 5,
      currencyLabel: 'SAR',
      voucherInstructions: ['Pay at the bank.', 'Keep the receipt.'],
      voucherContact: 'info@school.test',
      autoCalculateFines: true,
    });
  });

  it.each([true, 'yes', 1, null, undefined])(
    'only a real true switches automatic fines on (%p)',
    (autoCalculateFines) => {
      expect(
        readFinanceSettings({ autoCalculateFines }).autoCalculateFines,
      ).toBe(autoCalculateFines === true);
    },
  );

  it.each([0, 29, 4.5, '5', null])(
    'ignores an unusable due day %p',
    (dueDayOfMonth) => {
      expect(readFinanceSettings({ dueDayOfMonth }).dueDayOfMonth).toBe(
        DEFAULT_DUE_DAY,
      );
    },
  );

  it('uses the default currency when the label is blank', () => {
    expect(readFinanceSettings({ currencyLabel: '   ' }).currencyLabel).toBe(
      DEFAULT_CURRENCY_LABEL,
    );
  });
});

describe('validateFinanceSettingInput', () => {
  it('accepts an empty object and a full valid one', () => {
    expect(validateFinanceSettingInput({})).toBeNull();
    expect(
      validateFinanceSettingInput({
        dueDayOfMonth: 28,
        currencyLabel: 'Rs.',
        voucherInstructions: 'One\nTwo',
        voucherContact: 'info@school.test',
      }),
    ).toBeNull();
  });

  it.each([null, 'x', [], 3])('rejects a non-object %p', (value) => {
    expect(validateFinanceSettingInput(value)).toBe(
      'The finance setting must be an object.',
    );
  });

  it.each(['yes', 1, 'true'])('rejects automatic fines set to %p', (value) => {
    expect(validateFinanceSettingInput({ autoCalculateFines: value })).toMatch(
      /autoCalculateFines/,
    );
  });

  it.each([true, false, null])('accepts automatic fines set to %p', (value) => {
    expect(
      validateFinanceSettingInput({ autoCalculateFines: value }),
    ).toBeNull();
  });

  it.each([0, 29, 1.5, '10'])('rejects due day %p', (dueDayOfMonth) => {
    expect(validateFinanceSettingInput({ dueDayOfMonth })).toMatch(
      /dueDayOfMonth/,
    );
  });

  it.each([
    ['currencyLabel', 'x'.repeat(11)],
    ['voucherInstructions', 'x'.repeat(2001)],
    ['voucherContact', 'x'.repeat(201)],
    ['voucherContact', 42],
  ])('rejects %s of %p', (field, value) => {
    expect(validateFinanceSettingInput({ [field]: value })).toMatch(
      new RegExp(field),
    );
  });
});
