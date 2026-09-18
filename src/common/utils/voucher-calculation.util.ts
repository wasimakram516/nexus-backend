import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '../../prisma/client';

/** Validates a stored or entered currency amount before arithmetic or persistence. */
function money(value: unknown): Prisma.Decimal {
  if (typeof value !== 'number' && !(value instanceof Prisma.Decimal))
    throw new BadRequestException('Fee amounts must be numeric.');
  const amount = new Prisma.Decimal(value);
  if (
    !amount.isFinite() ||
    amount.isNegative() ||
    amount.decimalPlaces() > 2 ||
    amount.greaterThan('99999999.99')
  )
    throw new BadRequestException(
      'Fee amounts must be nonnegative, at most 99999999.99, with at most two decimal places.',
    );
  return amount;
}

/** Calculates exact currency totals and caps stacked discounts at the base fee. */
export function calculateVoucherAmounts(
  breakdown: unknown,
  discounts: unknown[],
  fine: unknown,
  lateFee: unknown,
) {
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown))
    throw new BadRequestException(
      'Fee breakdown must be an object of numeric amounts.',
    );
  const amounts = Object.values(breakdown).map(money);
  const total = amounts.reduce(
    (sum, amount) => sum.plus(amount),
    new Prisma.Decimal(0),
  );
  const discountAmount = Prisma.Decimal.min(
    discounts
      .map(money)
      .reduce((sum, amount) => sum.plus(amount), new Prisma.Decimal(0)),
    total,
  );
  const fineAmount = money(fine);
  const lateFeeFine = money(lateFee);
  return {
    feeBreakdown: breakdown as Prisma.InputJsonObject,
    discountAmount: money(discountAmount),
    fineAmount,
    lateFeeFine,
    finalAmountDue: money(
      total.minus(discountAmount).plus(fineAmount).plus(lateFeeFine),
    ),
  };
}

/** Reads every financial source using the same serializable transaction as the voucher write. */
export async function readVoucherAmounts(
  transaction: Prisma.TransactionClient,
  params: {
    studentId: string;
    feeStructureId: string;
    campusId: string;
    month: number;
    year: number;
    lateFeeFine: number | Prisma.Decimal;
    bankId?: string | null;
  },
) {
  const structure = await transaction.feeStructure.findUnique({
    where: { id: params.feeStructureId },
  });
  const student = await transaction.student.findUnique({
    where: { id: params.studentId },
  });
  if (params.bankId) {
    const bank = await transaction.bankAccount.findUnique({
      where: { id: params.bankId },
      select: { campusId: true },
    });
    if (!bank || bank.campusId !== params.campusId)
      throw new ForbiddenException(
        'The bank account must be active and belong to the voucher campus.',
      );
  }
  if (
    !structure ||
    !student ||
    structure.campusId !== params.campusId ||
    student.campusId !== params.campusId
  )
    throw new ConflictException(
      'The student or fee structure changed. Reload before saving.',
    );
  const discounts = await transaction.studentDiscount.findMany({
    where: { studentId: params.studentId, deletedAt: null },
    select: { discountAmount: true },
  });
  const fine = await transaction.studentFine.findFirst({
    where: {
      studentId: params.studentId,
      month: params.month,
      year: params.year,
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });
  return calculateVoucherAmounts(
    structure.feeBreakdown,
    discounts.map((discount) => discount.discountAmount),
    fine?.totalFineAmount ?? 0,
    params.lateFeeFine,
  );
}
