import { Prisma } from '../../prisma/client';
import { feeSettlement } from './fee-settlement.util';

describe('fee settlement', () => {
  const now = new Date('2026-09-15T10:00:00Z');
  const future = new Date('2026-10-01T00:00:00Z');
  const past = new Date('2026-09-01T00:00:00Z');
  it.each([
    ['0', future, 'PENDING', '100.00'],
    ['25.50', future, 'PARTIAL', '74.50'],
    ['100', future, 'PAID', '0.00'],
    ['25.50', past, 'OVERDUE', '74.50'],
    ['0', past, 'OVERDUE', '100.00'],
    ['100', past, 'PAID', '0.00'],
  ] as const)(
    'settles %s with correct due-date semantics',
    (paid, dueDate, status, remainingBalance) => {
      expect(
        feeSettlement(
          new Prisma.Decimal(100),
          new Prisma.Decimal(paid),
          dueDate,
          now,
        ),
      ).toMatchObject({ status, remainingBalance });
    },
  );
  it('rejects overpayment rather than silently losing credit', () => {
    expect(() =>
      feeSettlement(
        new Prisma.Decimal(100),
        new Prisma.Decimal('100.01'),
        future,
        now,
      ),
    ).toThrow('exceeds');
  });
  it('keeps a voucher due today payable for the rest of its due date', () => {
    expect(
      feeSettlement(
        new Prisma.Decimal(100),
        new Prisma.Decimal(25),
        new Date('2026-09-15T00:00:00Z'),
        now,
      ).status,
    ).toBe('PARTIAL');
  });
  it('calculates decimal balances without binary floating-point drift', () => {
    expect(
      feeSettlement(
        new Prisma.Decimal('0.30'),
        new Prisma.Decimal('0.10').plus('0.20'),
        future,
        now,
      ).remainingBalance,
    ).toBe('0.00');
  });
  it('exposes existing overpayments when reading or reducing legacy payments', () => {
    expect(
      feeSettlement(
        new Prisma.Decimal(100),
        new Prisma.Decimal(110),
        future,
        now,
        false,
      ),
    ).toMatchObject({
      status: 'PAID',
      remainingBalance: '0.00',
      overpaymentAmount: '10.00',
    });
  });
});
