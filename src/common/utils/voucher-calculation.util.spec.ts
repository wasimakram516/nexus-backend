import { Prisma } from '../../prisma/client';
import {
  calculateVoucherAmounts,
  extractOneTimeCharges,
  mergeOneTimeCharges,
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

describe('one-time charges', () => {
  it('adds each charge as its own line without changing the original breakdown', () => {
    const base = { tuition: 5000 };
    const merged = mergeOneTimeCharges(base, [
      { label: 'Admission fee', amount: 2000 },
      { label: ' Exam fee ', amount: 500 },
    ]);

    expect(merged).toEqual({
      tuition: 5000,
      'Admission fee': 2000,
      'Exam fee': 500,
    });
    expect(base).toEqual({ tuition: 5000 });
  });

  it('keeps both amounts when a charge label matches an existing line, and numbers repeats', () => {
    const merged = mergeOneTimeCharges({ tuition: 5000 }, [
      { label: 'tuition', amount: 100 },
      { label: 'Tuition', amount: 200 },
      { label: 'Tuition', amount: 300 },
    ]);

    // Matching is case-sensitive, so 'tuition' is its own line; the two
    // 'Tuition' charges become the second and third lines of that label.
    expect(merged).toEqual({
      tuition: 5000,
      'tuition (one-time)': 100,
      Tuition: 200,
      'Tuition (one-time)': 300,
    });
    const crowded = mergeOneTimeCharges({ Fee: 1 }, [
      { label: 'Fee', amount: 2 },
      { label: 'Fee', amount: 3 },
    ]);
    expect(crowded).toEqual({
      Fee: 1,
      'Fee (one-time)': 2,
      'Fee (one-time 2)': 3,
    });
  });

  it('rejects a breakdown that is not an object', () => {
    expect(() => mergeOneTimeCharges(null, [])).toThrow(
      'Fee breakdown must be an object',
    );
    expect(() => mergeOneTimeCharges([1, 2], [])).toThrow();
  });

  it('counts the charges in the total and caps discounts against the total including them', () => {
    const result = calculateVoucherAmounts(
      mergeOneTimeCharges({ tuition: 1000 }, [
        { label: 'Admission fee', amount: 500 },
      ]),
      [200, 100],
      0,
      0,
    );

    expect(result.finalAmountDue.toFixed(2)).toBe('1200.00');
    expect(result.discountAmount.toFixed(2)).toBe('300.00');
  });

  it('readVoucherAmounts adds the charges to this voucher only', async () => {
    const tx = {
      feeStructure: {
        findUnique: jest.fn().mockResolvedValue({
          campusId: 'campus',
          feeBreakdown: { tuition: 1000 },
        }),
      },
      student: {
        findUnique: jest.fn().mockResolvedValue({ campusId: 'campus' }),
      },
      bankAccount: { findUnique: jest.fn() },
      studentDiscount: { findMany: jest.fn().mockResolvedValue([]) },
      studentFine: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as Prisma.TransactionClient;
    const params = {
      studentId: 'student',
      feeStructureId: 'structure',
      campusId: 'campus',
      month: 9,
      year: 2026,
      lateFeeFine: 0,
    };

    const withCharges = await readVoucherAmounts(tx, {
      ...params,
      oneTimeCharges: [{ label: 'Paper fund', amount: 250 }],
    });
    const without = await readVoucherAmounts(tx, params);

    expect(withCharges.finalAmountDue.toFixed(2)).toBe('1250.00');
    expect(withCharges.feeBreakdown).toEqual({
      tuition: 1000,
      'Paper fund': 250,
    });
    expect(without.finalAmountDue.toFixed(2)).toBe('1000.00');
  });
});

describe('extractOneTimeCharges', () => {
  it('returns only the lines the fee structure does not have', () => {
    expect(
      extractOneTimeCharges(
        { tuition: 5000, transport: 1000, 'Admission fee': 2000 },
        { tuition: 5000, transport: 1000 },
      ),
    ).toEqual([{ label: 'Admission fee', amount: 2000 }]);
  });

  it('is empty when the voucher has no extra lines', () => {
    expect(extractOneTimeCharges({ tuition: 5000 }, { tuition: 5000 })).toEqual(
      [],
    );
  });

  it.each([null, undefined, 'x', [], 7])(
    'is empty for a bad voucher breakdown %p',
    (value) => {
      expect(extractOneTimeCharges(value, { tuition: 1 })).toEqual([]);
    },
  );

  it('treats every line as extra when the structure breakdown is unusable', () => {
    expect(extractOneTimeCharges({ a: '5' }, null)).toEqual([
      { label: 'a', amount: 5 },
    ]);
  });

  it('round-trips with mergeOneTimeCharges, including a label that collides with a structure line', () => {
    const structure = { tuition: 5000 };
    const merged = mergeOneTimeCharges(structure, [
      { label: 'tuition', amount: 100 },
    ]);

    expect(extractOneTimeCharges(merged, structure)).toEqual([
      { label: 'tuition (one-time)', amount: 100 },
    ]);
  });
});
