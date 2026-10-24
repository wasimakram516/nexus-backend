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

/**
 * Adds one-time charge lines (admission fee, exam fee, annual charges) to a
 * fee structure's monthly breakdown. A charge whose label matches an existing
 * line keeps both: the new one is labelled "(one-time)", numbered if needed,
 * so neither amount is silently replaced or doubled.
 *
 * @param {unknown} breakdown - The fee structure's monthly breakdown.
 * @param {Array<{label: string, amount: number}>} charges - One-time charge lines.
 * @returns {Record<string, unknown>} A new breakdown containing every line.
 * @throws {BadRequestException} If the breakdown is not an object.
 */
export function mergeOneTimeCharges(
  breakdown: unknown,
  charges: Array<{ label: string; amount: number }>,
): Record<string, unknown> {
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown))
    throw new BadRequestException(
      'Fee breakdown must be an object of numeric amounts.',
    );
  const merged: Record<string, unknown> = { ...breakdown };
  for (const charge of charges) {
    const label = charge.label.trim();
    let key = label;
    if (key in merged) key = `${label} (one-time)`;
    for (let counter = 2; key in merged; counter += 1)
      key = `${label} (one-time ${counter})`;
    merged[key] = charge.amount;
  }
  return merged;
}

/**
 * The one-time charge lines already on a voucher: every breakdown line that
 * the fee structure does not have. Editing a voucher keeps these unless new
 * charges are supplied, so a recalculation never silently drops them.
 *
 * @param {unknown} voucherBreakdown - The voucher's stored breakdown.
 * @param {unknown} structureBreakdown - The fee structure's monthly breakdown.
 * @returns {Array<{label: string, amount: number}>} The extra lines, empty when there are none.
 */
export function extractOneTimeCharges(
  voucherBreakdown: unknown,
  structureBreakdown: unknown,
): Array<{ label: string; amount: number }> {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(voucherBreakdown)) return [];
  const structure = isObject(structureBreakdown) ? structureBreakdown : {};
  return Object.entries(voucherBreakdown)
    .filter(([label]) => !(label in structure))
    .map(([label, amount]) => ({ label, amount: Number(amount) }));
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
    /** One-time charge lines added to this voucher's breakdown only. */
    oneTimeCharges?: Array<{ label: string; amount: number }>;
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
    params.oneTimeCharges?.length
      ? mergeOneTimeCharges(structure.feeBreakdown, params.oneTimeCharges)
      : structure.feeBreakdown,
    discounts.map((discount) => discount.discountAmount),
    fine?.totalFineAmount ?? 0,
    params.lateFeeFine,
  );
}
