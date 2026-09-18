import { Prisma } from '../../prisma/client';
import {
  assertVoucherIdentityUnchanged,
  assertVoucherReceiptIdentity,
} from './voucher-identity.util';

describe('voucher identity guards', () => {
  const existing = {
    studentId: 'student',
    feeStructureId: 'structure',
    month: 9,
    year: 2026,
  };
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const tx = {
    feeVoucher: { findUnique },
    feePayment: { findFirst },
  } as unknown as Prisma.TransactionClient;
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it.each(['studentId', 'feeStructureId', 'month', 'year'] as const)(
    'rejects a concurrent %s change',
    async (key) => {
      findUnique.mockResolvedValue({
        ...existing,
        [key]: key === 'month' || key === 'year' ? 1 : 'changed',
      });
      await expect(
        assertVoucherIdentityUnchanged(tx, 'voucher', existing),
      ).rejects.toThrow('changed');
    },
  );
  it('accepts an unchanged voucher and rejects a deleted voucher', async () => {
    findUnique.mockResolvedValue(existing);
    await expect(
      assertVoucherIdentityUnchanged(tx, 'voucher', existing),
    ).resolves.toBeUndefined();
    findUnique.mockResolvedValue(null);
    await expect(
      assertVoucherIdentityUnchanged(tx, 'voucher', existing),
    ).rejects.toThrow('not found');
  });
  it.each([{ studentId: 'other' }, { month: 10 }, { year: 2027 }])(
    'rejects receipt identity changes %j',
    async (changes) => {
      findFirst.mockResolvedValue({ id: 'receipt' });
      await expect(
        assertVoucherReceiptIdentity(tx, 'voucher', existing, changes),
      ).rejects.toThrow('payment history');
      expect(findFirst).toHaveBeenCalledWith({
        where: { voucherId: 'voucher', deletedAt: undefined },
        select: { id: true },
      });
    },
  );
  it('permits identity changes before receipts exist and nonidentity edits afterward', async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      assertVoucherReceiptIdentity(tx, 'voucher', existing, { month: 10 }),
    ).resolves.toBeUndefined();
    findFirst.mockResolvedValue({ id: 'receipt' });
    await expect(
      assertVoucherReceiptIdentity(tx, 'voucher', existing, { month: 9 }),
    ).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
