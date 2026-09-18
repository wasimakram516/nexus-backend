import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateFeePaymentDto,
  SalaryAdjustmentDto,
  CreateFeeVoucherDto,
  CreateStudentDiscountDto,
  CreateStudentFineRuleDto,
  CreateSalaryDto,
  CreateDeductionRuleDto,
  SalaryPaymentDto,
} from './finance.dto';

describe('payroll input boundaries', () => {
  it.each([-1, 0.001, Infinity, 100000000])(
    'rejects invalid salary and adjustment amount %s',
    async (amount) => {
      expect(
        (
          await validate(
            plainToInstance(CreateSalaryDto, { baseSalary: amount }),
          )
        ).some((error) => error.property === 'baseSalary'),
      ).toBe(true);
      expect(
        (await validate(plainToInstance(SalaryAdjustmentDto, { amount }))).some(
          (error) => error.property === 'amount',
        ),
      ).toBe(true);
    },
  );
  it.each([-1, 100.01])('rejects deduction percentage %s', async (percent) => {
    expect(
      (
        await validate(
          plainToInstance(CreateDeductionRuleDto, {
            absenceDeductionPercent: percent,
          }),
        )
      ).some((error) => error.property === 'absenceDeductionPercent'),
    ).toBe(true);
  });
  it.each([
    { month: 0 },
    { month: 13 },
    { month: 1.5 },
    { year: 1999 },
    { year: 2026.5 },
  ])('rejects payroll period %j', async (payload) => {
    expect(
      (await validate(plainToInstance(SalaryPaymentDto, payload))).some(
        (error) => error.property === Object.keys(payload)[0],
      ),
    ).toBe(true);
  });
  it('accepts the upper percentage boundary and zero allowance', async () => {
    const errors = await validate(
      plainToInstance(CreateDeductionRuleDto, {
        absenceDeductionPercent: 100,
        allowedAbsences: 0,
      }),
    );
    expect(
      errors.some((error) =>
        ['absenceDeductionPercent', 'allowedAbsences'].includes(error.property),
      ),
    ).toBe(false);
  });
});

describe('fee amount and period boundaries', () => {
  it.each([-1, 0.001, Infinity, 100000000])(
    'rejects invalid discount %s',
    async (discountAmount) => {
      const errors = await validate(
        plainToInstance(CreateStudentDiscountDto, { discountAmount }),
      );
      expect(errors.some((error) => error.property === 'discountAmount')).toBe(
        true,
      );
    },
  );
  it.each([
    { month: 0 },
    { month: 13 },
    { month: 1.5 },
    { year: 1999 },
    { year: 2026.5 },
    { lateFeeFine: -1 },
  ])('rejects invalid voucher input %j', async (payload) => {
    const errors = await validate(
      plainToInstance(CreateFeeVoucherDto, payload),
    );
    expect(
      errors.some((error) => error.property === Object.keys(payload)[0]),
    ).toBe(true);
  });
  it('accepts zero discounts and integer fine allowances but rejects fractional allowances', async () => {
    const discountErrors = await validate(
      plainToInstance(CreateStudentDiscountDto, { discountAmount: 0 }),
    );
    expect(
      discountErrors.some((error) => error.property === 'discountAmount'),
    ).toBe(false);
    const errors = await validate(
      plainToInstance(CreateStudentFineRuleDto, { allowedAbsences: 0.5 }),
    );
    expect(errors.some((error) => error.property === 'allowedAbsences')).toBe(
      true,
    );
  });
});

describe('fee payment input', () => {
  it.each([0, -1, 1.001, Infinity, NaN])(
    'rejects invalid payment amount %s',
    async (paidAmount) => {
      const dto = plainToInstance(CreateFeePaymentDto, {
        voucherId: '11111111-1111-4111-8111-111111111111',
        month: 9,
        year: 2026,
        paidAmount,
        paymentMethod: 'CASH',
        paymentDate: '2026-09-15',
      });
      expect(
        (await validate(dto)).some((error) => error.property === 'paidAmount'),
      ).toBe(true);
    },
  );
});

describe('SalaryAdjustmentDto form contract', () => {
  const payload = {
    userId: '11111111-1111-4111-8111-111111111111',
    salaryId: '22222222-2222-4222-8222-222222222222',
    campusId: '33333333-3333-4333-8333-333333333333',
    adjustmentType: 'BONUS',
    amount: 50,
    month: '3',
    year: 2026,
  };

  it('accepts the numeric year and select month emitted by the adjustment form', async () => {
    const dto = plainToInstance(SalaryAdjustmentDto, payload, {
      enableImplicitConversion: true,
    });
    expect(
      await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).toEqual([]);
    expect(dto.month).toBe(3);
    expect(dto.year).toBe(2026);
  });

  it.each([
    { month: undefined, year: undefined },
    { month: '13', year: 2026 },
    { month: '3', year: 1999 },
    { month: '3', year: 2026.5 },
  ])('rejects missing or invalid payroll period %j', async (period) => {
    const dto = plainToInstance(
      SalaryAdjustmentDto,
      { ...payload, ...period },
      {
        enableImplicitConversion: true,
      },
    );
    expect(
      (await validate(dto)).some((error) =>
        ['month', 'year'].includes(error.property),
      ),
    ).toBe(true);
  });
});
