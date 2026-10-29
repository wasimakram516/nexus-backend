import { Injectable } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import { formatDate } from '../../common/utils/date-format.util';
import { attachFeeVoucherBalances } from '../../common/utils/fee-settlement.util';
import { PaymentMethod, Prisma, VoucherStatus } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { loadStudentPlacements } from '../finance/student-scope.util';
import {
  CampusPeriodQueryDto,
  FeeCollectionQueryDto,
  ReportQueryDto,
} from './dto/reports.dto';
import { reportCurrency } from './report-currency.util';
import { dayStart, monthText, resolvePeriod } from './report-dates.util';
import { money, ReportRow, ReportTable } from './report-table';
import { ReportsAccessService, ReportScope } from './reports-access.service';

const ZERO = new Prisma.Decimal(0);

interface Bucket {
  label: string;
  /** Sorts buckets: a date, a `YYYY-MM`, or a campus name. */
  sort: string;
  payments: number;
  cash: Prisma.Decimal;
  bank: Prisma.Decimal;
}

/**
 * Finance reports for administrators: what was collected, who still owes, and
 * what discounts and fines were applied. They read the same vouchers and
 * payments as the finance screens, so the figures agree.
 */
@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ReportsAccessService,
    private readonly timezones: TimezoneResolverService,
  ) {}

  /**
   * Payments received in a period, grouped by day, month or campus.
   *
   * @param {CurrentUser} currentUser - The administrator.
   * @param {FeeCollectionQueryDto} query - Campus (or all), the period and the grouping.
   * @returns {Promise<ReportTable>} Counts and amounts by method, with a total.
   */
  async collection(
    currentUser: CurrentUser,
    query: FeeCollectionQueryDto,
  ): Promise<ReportTable> {
    const scope = await this.access.resolve(currentUser, {
      institutionId: query.institutionId,
      campusId: query.campusId,
    });
    const period = this.periodOf(scope, query);
    const groupBy = query.groupBy ?? 'DAY';
    const currency = await reportCurrency(this.prisma, scope.institutionId);

    const buckets = new Map<string, Bucket>();
    for (const campus of scope.campuses) {
      const payments = await this.prisma.feePayment.findMany({
        where: {
          deletedAt: null,
          voucher: { deletedAt: null, student: { campusId: campus.id } },
          paymentDate: {
            gte: this.timezones.zonedTimeToInstant(
              campus.timezone,
              period.from,
              '00:00',
            ),
            lt: this.timezones.zonedTimeToInstant(
              campus.timezone,
              this.nextDay(period.to),
              '00:00',
            ),
          },
        },
        select: { paidAmount: true, paymentMethod: true, paymentDate: true },
      });
      for (const payment of payments) {
        const day = this.timezones.localDateString(
          campus.timezone,
          payment.paymentDate,
        );
        const [year, month] = day.split('-').map(Number);
        const bucket = this.bucketFor(
          buckets,
          groupBy,
          campus.name,
          day,
          year,
          month,
        );
        bucket.payments += 1;
        if (payment.paymentMethod === PaymentMethod.CASH) {
          bucket.cash = bucket.cash.plus(payment.paidAmount);
        } else {
          bucket.bank = bucket.bank.plus(payment.paidAmount);
        }
      }
    }

    const ordered = [...buckets.values()].sort((a, b) =>
      a.sort.localeCompare(b.sort),
    );
    const rows = ordered.map(
      (bucket): ReportRow => ({
        group: bucket.label,
        payments: bucket.payments,
        cash: money(bucket.cash),
        bank: money(bucket.bank),
        total: money(bucket.cash.plus(bucket.bank)),
      }),
    );
    const sum = (pick: (bucket: Bucket) => Prisma.Decimal) =>
      ordered.reduce((total, bucket) => total.plus(pick(bucket)), ZERO);
    const cash = sum((bucket) => bucket.cash);
    const bank = sum((bucket) => bucket.bank);

    return {
      key: 'fee-collection',
      title: 'Fee collection',
      subtitle: `${this.periodText(period, scope)}, by ${groupBy.toLowerCase()}`,
      columns: [
        {
          key: 'group',
          label: { DAY: 'Date', MONTH: 'Month', CAMPUS: 'Campus' }[groupBy],
          weight: 2,
        },
        { key: 'payments', label: 'Payments', align: 'right' },
        { key: 'cash', label: 'Cash', align: 'right', weight: 1.4 },
        { key: 'bank', label: 'Bank transfer', align: 'right', weight: 1.4 },
        { key: 'total', label: 'Total', align: 'right', weight: 1.4 },
      ],
      rows,
      totals: {
        group: 'Total',
        payments: ordered.reduce((n, bucket) => n + bucket.payments, 0),
        cash: money(cash),
        bank: money(bank),
        total: money(cash.plus(bank)),
      },
      notes: [
        `Payments are counted on the day they were received at the campus. Amounts are in ${currency}`,
      ],
      institutionId: scope.institutionId,
      campusId: scope.campuses.length === 1 ? scope.campuses[0].id : null,
    };
  }

  /**
   * Students with fees past their due date, and how much each owes.
   *
   * @param {CurrentUser} currentUser - The administrator.
   * @param {ReportQueryDto & {campusId?: string}} query - Campus (or all).
   * @returns {Promise<ReportTable>} One row per student, largest balance first.
   */
  async outstandingDues(
    currentUser: CurrentUser,
    query: ReportQueryDto & { campusId?: string },
  ): Promise<ReportTable> {
    const scope = await this.access.resolve(currentUser, {
      institutionId: query.institutionId,
      campusId: query.campusId,
    });
    const today = this.timezones.localDateString(scope.campuses[0].timezone);
    const currency = await reportCurrency(this.prisma, scope.institutionId);
    const vouchers = await this.prisma.feeVoucher.findMany({
      where: {
        deletedAt: null,
        status: { not: VoucherStatus.PAID },
        dueDate: { lt: dayStart(today) },
        student: {
          deletedAt: null,
          campusId: { in: scope.campuses.map((campus) => campus.id) },
        },
      },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
      include: {
        student: {
          select: {
            campusId: true,
            regNo: true,
            user: { select: { name: true } },
          },
        },
      },
    });
    const owing = (
      await attachFeeVoucherBalances(this.prisma, vouchers)
    ).filter((voucher) => new Prisma.Decimal(voucher.remainingBalance).gt(0));

    const byStudent = new Map<string, typeof owing>();
    for (const voucher of owing) {
      byStudent.set(voucher.studentId, [
        ...(byStudent.get(voucher.studentId) ?? []),
        voucher,
      ]);
    }
    const placements = await loadStudentPlacements(this.prisma, [
      ...byStudent.keys(),
    ]);
    const campusName = new Map(
      scope.campuses.map((campus) => [campus.id, campus.name]),
    );
    const entries = [...byStudent.entries()].map(([studentId, list]) => {
      const total = list.reduce(
        (sum, voucher) => sum.plus(voucher.remainingBalance),
        ZERO,
      );
      return { studentId, list, total };
    });
    entries.sort(
      (a, b) =>
        b.total.comparedTo(a.total) ||
        a.list[0].student.user.name.localeCompare(b.list[0].student.user.name),
    );

    const rows = entries.map(({ studentId, list, total }): ReportRow => {
      const placement = placements.get(studentId);
      return {
        name: list[0].student.user.name,
        regNo: list[0].student.regNo,
        className: placement?.className ?? '',
        sectionName: placement?.sectionName ?? '',
        campus: campusName.get(list[0].student.campusId) ?? '',
        months: list.length,
        oldestDue: formatDate(list[0].dueDate),
        outstanding: money(total),
      };
    });
    const grand = entries.reduce((sum, entry) => sum.plus(entry.total), ZERO);

    return {
      key: 'outstanding-dues',
      title: 'Outstanding dues',
      subtitle: `Fees past their due date as of ${formatDate(today)}, ${scope.campuses.length === 1 ? scope.campuses[0].name : 'All campuses'}`,
      columns: [
        { key: 'name', label: 'Student', weight: 3 },
        { key: 'regNo', label: 'Reg no', weight: 1.4 },
        { key: 'className', label: 'Class', weight: 1.5 },
        { key: 'sectionName', label: 'Section', weight: 1.2 },
        { key: 'campus', label: 'Campus', weight: 2 },
        { key: 'months', label: 'Months owed', align: 'right' },
        { key: 'oldestDue', label: 'Oldest due date', weight: 1.5 },
        {
          key: 'outstanding',
          label: 'Outstanding',
          align: 'right',
          weight: 1.4,
        },
      ],
      rows,
      totals: {
        name: `Total, ${rows.length} student${rows.length === 1 ? '' : 's'}`,
        outstanding: money(grand),
      },
      notes: [`Amounts are in ${currency}`],
      institutionId: scope.institutionId,
      campusId: scope.campuses.length === 1 ? scope.campuses[0].id : null,
    };
  }

  /**
   * Discounts, fines and late fees applied on the vouchers of a period's months.
   *
   * @param {CurrentUser} currentUser - The administrator.
   * @param {CampusPeriodQueryDto} query - Campus (or all) and the period; whole months are covered.
   * @returns {Promise<ReportTable>} One row per campus and month, with a total.
   */
  async adjustments(
    currentUser: CurrentUser,
    query: CampusPeriodQueryDto,
  ): Promise<ReportTable> {
    const scope = await this.access.resolve(currentUser, {
      institutionId: query.institutionId,
      campusId: query.campusId,
    });
    const period = this.periodOf(scope, query);
    const currency = await reportCurrency(this.prisma, scope.institutionId);
    const [fromYear, fromMonth] = period.from.split('-').map(Number);
    const [toYear, toMonth] = period.to.split('-').map(Number);
    const inRange = (year: number, month: number) =>
      year * 12 + month >= fromYear * 12 + fromMonth &&
      year * 12 + month <= toYear * 12 + toMonth;

    const vouchers = await this.prisma.feeVoucher.findMany({
      where: {
        deletedAt: null,
        year: { gte: fromYear, lte: toYear },
        student: {
          deletedAt: null,
          campusId: { in: scope.campuses.map((campus) => campus.id) },
        },
      },
      select: {
        month: true,
        year: true,
        discountAmount: true,
        fineAmount: true,
        lateFeeFine: true,
        finalAmountDue: true,
        student: { select: { campusId: true } },
      },
    });
    const campusName = new Map(
      scope.campuses.map((campus) => [campus.id, campus.name]),
    );

    const groups = new Map<
      string,
      {
        campus: string;
        year: number;
        month: number;
        vouchers: number;
        billed: Prisma.Decimal;
        discounts: Prisma.Decimal;
        fines: Prisma.Decimal;
        lateFees: Prisma.Decimal;
      }
    >();
    for (const voucher of vouchers) {
      if (!inRange(voucher.year, voucher.month)) continue;
      const key = `${voucher.student.campusId}:${voucher.year}-${String(voucher.month).padStart(2, '0')}`;
      const group = groups.get(key) ?? {
        campus: campusName.get(voucher.student.campusId) ?? '',
        year: voucher.year,
        month: voucher.month,
        vouchers: 0,
        billed: ZERO,
        discounts: ZERO,
        fines: ZERO,
        lateFees: ZERO,
      };
      group.vouchers += 1;
      group.billed = group.billed.plus(voucher.finalAmountDue);
      group.discounts = group.discounts.plus(voucher.discountAmount);
      group.fines = group.fines.plus(voucher.fineAmount);
      group.lateFees = group.lateFees.plus(voucher.lateFeeFine);
      groups.set(key, group);
    }
    const ordered = [...groups.entries()].sort(([a], [b]) => {
      const [campusA, monthA] = a.split(':');
      const [campusB, monthB] = b.split(':');
      return (
        monthA.localeCompare(monthB) ||
        String(campusName.get(campusA)).localeCompare(
          String(campusName.get(campusB)),
        )
      );
    });
    const sum = (
      pick: (group: (typeof ordered)[number][1]) => Prisma.Decimal,
    ) => ordered.reduce((total, [, group]) => total.plus(pick(group)), ZERO);

    return {
      key: 'discounts-and-fines',
      title: 'Discounts and fines',
      subtitle: `${monthText(fromYear, fromMonth)} to ${monthText(toYear, toMonth)}, ${scope.campuses.length === 1 ? scope.campuses[0].name : 'All campuses'}`,
      columns: [
        { key: 'month', label: 'Month', weight: 1.6 },
        { key: 'campus', label: 'Campus', weight: 2 },
        { key: 'vouchers', label: 'Vouchers', align: 'right' },
        { key: 'billed', label: 'Billed', align: 'right', weight: 1.4 },
        { key: 'discounts', label: 'Discounts', align: 'right', weight: 1.3 },
        {
          key: 'fines',
          label: 'Attendance fines',
          align: 'right',
          weight: 1.4,
        },
        { key: 'lateFees', label: 'Late fees', align: 'right', weight: 1.2 },
      ],
      rows: ordered.map(
        ([, group]): ReportRow => ({
          month: monthText(group.year, group.month),
          campus: group.campus,
          vouchers: group.vouchers,
          billed: money(group.billed),
          discounts: money(group.discounts),
          fines: money(group.fines),
          lateFees: money(group.lateFees),
        }),
      ),
      totals: {
        month: 'Total',
        vouchers: ordered.reduce((n, [, group]) => n + group.vouchers, 0),
        billed: money(sum((group) => group.billed)),
        discounts: money(sum((group) => group.discounts)),
        fines: money(sum((group) => group.fines)),
        lateFees: money(sum((group) => group.lateFees)),
      },
      notes: [
        `Whole months are covered, by the month each voucher is for. Billed is the amount due after discounts and fines. Amounts are in ${currency}`,
      ],
      institutionId: scope.institutionId,
      campusId: scope.campuses.length === 1 ? scope.campuses[0].id : null,
    };
  }

  private bucketFor(
    buckets: Map<string, Bucket>,
    groupBy: 'DAY' | 'MONTH' | 'CAMPUS',
    campus: string,
    day: string,
    year: number,
    month: number,
  ): Bucket {
    const [key, label, sort] =
      groupBy === 'DAY'
        ? [day, formatDate(day), day]
        : groupBy === 'MONTH'
          ? [day.slice(0, 7), monthText(year, month), day.slice(0, 7)]
          : [campus, campus, campus];
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: Bucket = {
      label,
      sort,
      payments: 0,
      cash: ZERO,
      bank: ZERO,
    };
    buckets.set(key, created);
    return created;
  }

  private nextDay(day: string): string {
    return new Date(dayStart(day).getTime() + 86_400_000)
      .toISOString()
      .slice(0, 10);
  }

  private periodOf(scope: ReportScope, query: CampusPeriodQueryDto) {
    const today = this.timezones.localDateString(scope.campuses[0].timezone);
    return resolvePeriod(query, today);
  }

  private periodText(period: { from: string; to: string }, scope: ReportScope) {
    const where =
      scope.campuses.length === 1 ? scope.campuses[0].name : 'All campuses';
    return `${formatDate(period.from)} to ${formatDate(period.to)}, ${where}`;
  }
}
