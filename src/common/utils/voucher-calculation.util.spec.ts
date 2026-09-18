import { Prisma } from '../../prisma/client';
import {
  calculateVoucherAmounts,
  readVoucherAmounts,
} from './voucher-calculation.util';

describe('voucher calculation', () => {
  it('stacks discounts with exact decimal arithmetic', () => {
    const result = calculateVoucherAmounts(
      { tuition: 0.1, transport: 0.2 },
      [0.1, 0.05],
      0.1,
      0,
    );
    expect(result.discountAmount.toFixed(2)).toBe('0.15');
    expect(result.finalAmountDue.toFixed(2)).toBe('0.25');
  });
  it('caps discounts at base fees without discounting fines', () => {
    const result = calculateVoucherAmounts({ tuition: 100 }, [80, 70], 10, 5);
    expect(result.discountAmount.toFixed(2)).toBe('100.00');
    expect(result.finalAmountDue.toFixed(2)).toBe('15.00');
  });
  it.each([-1, NaN, Infinity, 0.001, '10', null, 100000000])(
    'rejects an invalid fee amount %s',
    (amount) => {
      expect(() =>
        calculateVoucherAmounts({ tuition: amount }, [], 0, 0),
      ).toThrow();
    },
  );
  it('rejects invalid discounts, fines and overflowing totals', () => {
    expect(() => calculateVoucherAmounts({ tuition: 1 }, [-1], 0, 0)).toThrow();
    expect(() => calculateVoucherAmounts({ tuition: 1 }, [], -1, 0)).toThrow();
    expect(() => calculateVoucherAmounts({ tuition: 1 }, [], 0, -1)).toThrow();
    expect(() =>
      calculateVoucherAmounts({ tuition: 99999999.99 }, [], 1, 0),
    ).toThrow();
  });
  it('reads active discounts and period fines from the provided transaction', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { discountAmount: new Prisma.Decimal(30) },
        { discountAmount: new Prisma.Decimal(20) },
      ]);
    const findFirst = jest
      .fn()
      .mockResolvedValue({ totalFineAmount: new Prisma.Decimal(5) });
    const student = jest.fn().mockResolvedValue({ campusId: 'campus' });
    const bank = jest.fn().mockResolvedValue({ campusId: 'other' });
    const tx = {
      feeStructure: {
        findUnique: jest.fn().mockResolvedValue({
          campusId: 'campus',
          feeBreakdown: { tuition: 100 },
        }),
      },
      student: { findUnique: student },
      bankAccount: { findUnique: bank },
      studentDiscount: { findMany },
      studentFine: { findFirst },
    } as unknown as Prisma.TransactionClient;
    const params = {
      studentId: 'student',
      feeStructureId: 'structure',
      campusId: 'campus',
      month: 9,
      year: 2026,
      lateFeeFine: 0,
    };
    expect(
      (await readVoucherAmounts(tx, params)).finalAmountDue.toFixed(2),
    ).toBe('55.00');
    expect(findMany).toHaveBeenCalledWith({
      where: { studentId: 'student', deletedAt: null },
      select: { discountAmount: true },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { studentId: 'student', month: 9, year: 2026, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    await expect(
      readVoucherAmounts(tx, { ...params, bankId: 'bank' }),
    ).rejects.toThrow('voucher campus');
    bank.mockResolvedValue(null);
    await expect(
      readVoucherAmounts(tx, { ...params, bankId: 'bank' }),
    ).rejects.toThrow('active');
    bank.mockResolvedValue({ campusId: 'campus' });
    expect(
      (
        await readVoucherAmounts(tx, { ...params, bankId: 'bank' })
      ).finalAmountDue.toFixed(2),
    ).toBe('55.00');
    student.mockResolvedValue({ campusId: 'changed' });
    await expect(readVoucherAmounts(tx, params)).rejects.toThrow('changed');
  });
});
