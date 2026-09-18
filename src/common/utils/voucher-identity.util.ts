import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';

type VoucherIdentity = {
  studentId: string;
  feeStructureId: string;
  month: number;
  year: number;
};

/** Rejects stale authorization/period checks within the transaction that writes the ledger. */
export async function assertVoucherIdentityUnchanged(
  transaction: Prisma.TransactionClient,
  voucherId: string,
  expected: VoucherIdentity,
): Promise<void> {
  const current = await transaction.feeVoucher.findUnique({
    where: { id: voucherId },
    select: { studentId: true, feeStructureId: true, month: true, year: true },
  });
  if (!current) throw new NotFoundException('Fee voucher not found.');
  if (
    Object.entries(expected).some(
      ([key, value]) => current[key as keyof VoucherIdentity] !== value,
    )
  )
    throw new ConflictException(
      'The voucher changed. Reload it before saving.',
    );
}

/** Preserves receipt ownership and periods, including receipts retained in the recycle bin. */
export async function assertVoucherReceiptIdentity(
  transaction: Prisma.TransactionClient,
  voucherId: string,
  existing: VoucherIdentity,
  changes: Partial<VoucherIdentity>,
): Promise<void> {
  const changed = (['studentId', 'month', 'year'] as const).some(
    (key) => changes[key] !== undefined && changes[key] !== existing[key],
  );
  if (!changed) return;
  const receipt = await transaction.feePayment.findFirst({
    // Explicit undefined includes deleted receipts with this repository's soft-delete extension.
    where: { voucherId, deletedAt: undefined },
    select: { id: true },
  });
  if (receipt)
    throw new ConflictException(
      'A voucher with payment history cannot change student, month or year.',
    );
}
