import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RequestContextService } from '../services/request-context.service';

/** Keeps audit operations in the transaction and retries only database serialization conflicts. */
export async function runAuditedTransaction<T>(
  prisma: PrismaService,
  context: RequestContextService,
  mutation: (transaction: Prisma.TransactionClient) => Promise<T>,
  isolationLevel?: Prisma.TransactionIsolationLevel,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        (transaction) =>
          context.runWith({ transactionClient: transaction }, () =>
            mutation(transaction),
          ),
        { isolationLevel },
      );
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2034'
      )
        throw error;
      if (attempt === 2)
        throw new ConflictException(
          'This record changed during saving. Reload it and retry.',
        );
    }
  }
  throw new ConflictException('The transaction could not be completed.');
}
