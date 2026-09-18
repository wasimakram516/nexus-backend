import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, VoucherStatus } from '../../prisma/client';

/** Computes settlement using decimal money and preserves overdue status for unpaid balances. */
export function feeSettlement(
  totalDue: Prisma.Decimal,
  paid: Prisma.Decimal,
  dueDate: Date,
  now = new Date(),
  rejectOverpayment = true,
) {
  if (
    !totalDue.isFinite() ||
    !paid.isFinite() ||
    totalDue.isNegative() ||
    paid.isNegative()
  ) {
    throw new BadRequestException(
      'Voucher and payment totals must be nonnegative finite amounts.',
    );
  }
  if (rejectOverpayment && paid.greaterThan(totalDue))
    throw new BadRequestException(
      'Payment exceeds the outstanding voucher balance.',
    );
  const balance = Prisma.Decimal.max(totalDue.minus(paid), 0);
  const overpayment = Prisma.Decimal.max(paid.minus(totalDue), 0);
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const status = balance.isZero()
    ? VoucherStatus.PAID
    : dueDate < startOfToday
      ? VoucherStatus.OVERDUE
      : paid.greaterThan(0)
        ? VoucherStatus.PARTIAL
        : VoucherStatus.PENDING;
  return {
    totalPaid: paid.toFixed(2),
    remainingBalance: balance.toFixed(2),
    overpaymentAmount: overpayment.toFixed(2),
    status,
  };
}

/** Reconciles against active payment totals inside the caller's payment transaction. */
export async function reconcileFeeVoucher(
  transaction: Prisma.TransactionClient,
  voucherId: string,
  rejectOverpayment = true,
) {
  const voucher = await transaction.feeVoucher.findUnique({
    where: { id: voucherId },
    select: { finalAmountDue: true, dueDate: true },
  });
  if (!voucher) throw new NotFoundException('Fee voucher not found.');
  const payments = await transaction.feePayment.aggregate({
    where: { voucherId, deletedAt: null },
    _sum: { paidAmount: true },
  });
  const settlement = feeSettlement(
    new Prisma.Decimal(voucher.finalAmountDue),
    new Prisma.Decimal(payments._sum.paidAmount ?? 0),
    voucher.dueDate,
    new Date(),
    rejectOverpayment,
  );
  await transaction.feeVoucher.update({
    where: { id: voucherId },
    data: { status: settlement.status },
  });
  return settlement;
}

/** Adds ledger balances with one grouped payment query for an entire voucher list. */
export async function attachFeeVoucherBalances<
  T extends { id: string; finalAmountDue: Prisma.Decimal; dueDate: Date },
>(client: Prisma.TransactionClient, vouchers: T[]) {
  if (!vouchers.length) return [];
  const totals = await client.feePayment.groupBy({
    by: ['voucherId'],
    where: {
      voucherId: { in: vouchers.map((voucher) => voucher.id) },
      deletedAt: null,
    },
    _sum: { paidAmount: true },
  });
  const paidByVoucher = new Map(
    totals.map((total) => [
      total.voucherId,
      total._sum.paidAmount ?? new Prisma.Decimal(0),
    ]),
  );
  return vouchers.map((voucher) => ({
    ...voucher,
    ...feeSettlement(
      voucher.finalAmountDue,
      paidByVoucher.get(voucher.id) ?? new Prisma.Decimal(0),
      voucher.dueDate,
      new Date(),
      false,
    ),
  }));
}
