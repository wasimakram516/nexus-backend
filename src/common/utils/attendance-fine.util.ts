import { Prisma } from '../../prisma/client';

export interface AttendanceCounts {
  absent: number;
  late: number;
  halfDay: number;
  leave: number;
}

export interface FineRuleAmounts {
  allowedAbsences: number;
  absenceFineAmount: Prisma.Decimal.Value;
  allowedLates: number;
  lateFineAmount: Prisma.Decimal.Value;
  allowedHalfDays: number;
  halfDayFineAmount: Prisma.Decimal.Value;
  allowedLeaves: number;
  leaveFineAmount: Prisma.Decimal.Value;
}

/** Marks the fines this system calculated, so a manual fine is never overwritten. */
export const AUTOMATIC_FINE_REASON_PREFIX = 'Attendance fine:';

/**
 * Fine for one month: each kind of mark beyond the rule's allowance costs the
 * rule's amount per extra mark. Marks within the allowance cost nothing.
 *
 * @param {AttendanceCounts} counts - The student's marks for the month.
 * @param {FineRuleAmounts} rule - The allowances and per-mark amounts.
 * @returns {Prisma.Decimal} Total fine, never negative.
 */
export function calculateAttendanceFine(
  counts: AttendanceCounts,
  rule: FineRuleAmounts,
): Prisma.Decimal {
  const part = (count: number, allowed: number, amount: Prisma.Decimal.Value) =>
    new Prisma.Decimal(amount).times(Math.max(0, count - allowed));
  return part(counts.absent, rule.allowedAbsences, rule.absenceFineAmount)
    .plus(part(counts.late, rule.allowedLates, rule.lateFineAmount))
    .plus(part(counts.halfDay, rule.allowedHalfDays, rule.halfDayFineAmount))
    .plus(part(counts.leave, rule.allowedLeaves, rule.leaveFineAmount));
}

/** The reason text stored on an automatic fine. */
export function describeAttendanceFine(counts: AttendanceCounts): string {
  return `${AUTOMATIC_FINE_REASON_PREFIX} ${counts.absent} absent, ${counts.late} late, ${counts.halfDay} half day, ${counts.leave} leave.`;
}
