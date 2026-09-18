import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';

/** Rounds each persisted payroll component half-up to cents before totals are calculated. */
export function payrollMoney(value: Prisma.Decimal.Value): number {
  const amount = new Prisma.Decimal(value).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
  if (!amount.isFinite() || amount.abs().greaterThan('99999999.99'))
    throw new BadRequestException(
      'Payroll amounts exceed the supported currency range.',
    );
  return amount.toNumber();
}

/** Adds already-rounded components exactly so preview, payment and summary totals agree. */
export function payrollSum(values: Prisma.Decimal.Value[]): number {
  return payrollMoney(
    values.reduce<Prisma.Decimal>(
      (total, value) => total.plus(value),
      new Prisma.Decimal(0),
    ),
  );
}
