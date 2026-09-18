import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { RequestContextService } from '../services/request-context.service';
import { runAuditedTransaction } from './transaction.util';

describe('audited transactions', () => {
  it('retries serialization conflicts and restores the request context after success', async () => {
    const context = new RequestContextService();
    const transaction = {} as Prisma.TransactionClient;
    const run = jest
      .fn()
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('retry', {
          code: 'P2034',
          clientVersion: '7.8.0',
        }),
      )
      .mockImplementationOnce(
        (callback: (client: Prisma.TransactionClient) => Promise<string>) =>
          callback(transaction),
      );
    await expect(
      runAuditedTransaction(
        { $transaction: run } as unknown as PrismaService,
        context,
        () => {
          expect(context.get('transactionClient')).toBe(transaction);
          return Promise.resolve('saved');
        },
        Prisma.TransactionIsolationLevel.Serializable,
      ),
    ).resolves.toBe('saved');
    expect(run).toHaveBeenCalledTimes(2);
    expect(context.get('transactionClient')).toBeUndefined();
  });
  it('bounds retries and returns a conflict the caller can act on', async () => {
    const run = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('retry', {
        code: 'P2034',
        clientVersion: '7.8.0',
      }),
    );
    await expect(
      runAuditedTransaction(
        { $transaction: run } as unknown as PrismaService,
        new RequestContextService(),
        () => Promise.resolve(null),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('does not retry business validation failures', async () => {
    const run = jest
      .fn()
      .mockRejectedValue(new BadRequestException('Invalid payment'));
    await expect(
      runAuditedTransaction(
        { $transaction: run } as unknown as PrismaService,
        new RequestContextService(),
        () => Promise.resolve(null),
      ),
    ).rejects.toThrow('Invalid payment');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
