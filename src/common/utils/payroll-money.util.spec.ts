import { payrollMoney, payrollSum } from './payroll-money.util';

describe('payroll money', () => {
  it('rounds half cents up and adds the rounded components exactly', () => {
    expect(payrollMoney('1.005')).toBe(1.01);
    expect(payrollSum([payrollMoney('0.335'), payrollMoney('0.335')])).toBe(
      0.68,
    );
    expect(payrollSum([0.1, 0.2])).toBe(0.3);
  });
  it.each([Infinity, NaN, 100000000])(
    'rejects unsupported amount %s',
    (amount) => {
      expect(() => payrollMoney(amount)).toThrow('currency range');
    },
  );
});
