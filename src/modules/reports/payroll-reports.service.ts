import { Injectable } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import { formatDate } from '../../common/utils/date-format.util';
import { Prisma, SalaryStatus } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CampusPeriodQueryDto,
  PayrollRegisterQueryDto,
} from './dto/reports.dto';
import { reportCurrency } from './report-currency.util';
import { monthText, resolvePeriod } from './report-dates.util';
import { money, ReportRow, ReportTable } from './report-table';
import { ReportsAccessService } from './reports-access.service';

const ZERO = new Prisma.Decimal(0);
const sumOf = (values: Prisma.Decimal[]) =>
  values.reduce((total, value) => total.plus(value), ZERO);

/**
 * Payroll reports for administrators. They read the salary payments that were
 * actually recorded, with the breakdown saved at the moment of payment, so a
 * later change to a salary or an attendance record never rewrites a month that
 * was already paid.
 */
@Injectable()
export class PayrollReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ReportsAccessService,
    private readonly timezones: TimezoneResolverService,
  ) {}

  /**
   * One month's payroll: what each person was paid and how it was worked out,
   * with the staff who have not been paid yet listed after them.
   *
   * @param {CurrentUser} currentUser - The administrator.
   * @param {PayrollRegisterQueryDto} query - Campus (or all) and the month.
   * @returns {Promise<ReportTable>} One row per person, with a total of what was paid.
   */
  async register(
    currentUser: CurrentUser,
    query: PayrollRegisterQueryDto,
  ): Promise<ReportTable> {
    const scope = await this.access.resolve(currentUser, {
      institutionId: query.institutionId,
      campusId: query.campusId,
    });
    const currency = await reportCurrency(this.prisma, scope.institutionId);
    const today = this.timezones.localDateString(scope.campuses[0].timezone);
    const [year, month] = (query.month ?? today.slice(0, 7))
      .split('-')
      .map(Number);
    const campusIds = scope.campuses.map((campus) => campus.id);
    const campusById = new Map(scope.campuses.map((c) => [c.id, c]));

    const payments = await this.prisma.salaryPayment.findMany({
      where: { campusId: { in: campusIds }, month, year, deletedAt: null },
      include: { summaries: { where: { deletedAt: null }, take: 1 } },
    });
    const paidKeys = new Set(
      payments.map((payment) => `${payment.userId}:${payment.campusId}`),
    );

    // Current salaries, one per person and campus; the latest one that had started by the end of the month.
    const startOfNextMonth = new Date(Date.UTC(year, month, 1));
    const salaries = await this.prisma.staffSalary.findMany({
      where: {
        campusId: { in: campusIds },
        deletedAt: null,
        status: { not: SalaryStatus.TERMINATED },
        effectiveDate: { lt: startOfNextMonth },
      },
      orderBy: { effectiveDate: 'desc' },
      select: { userId: true, campusId: true, baseSalary: true },
    });
    const owed = new Map<string, (typeof salaries)[number]>();
    for (const salary of salaries) {
      const key = `${salary.userId}:${salary.campusId}`;
      if (!paidKeys.has(key) && !owed.has(key)) owed.set(key, salary);
    }

    const names = await this.namesOf([
      ...payments.map((payment) => payment.userId),
      ...[...owed.values()].map((salary) => salary.userId),
    ]);

    const paidRows = payments.map((payment) => {
      const summary = payment.summaries[0];
      const attendanceDeductions = summary
        ? sumOf([
            summary.absenceDeduction,
            summary.lateDeduction,
            summary.halfDayDeduction,
            summary.leaveDeduction,
          ])
        : ZERO;
      const campus = campusById.get(payment.campusId);
      return {
        sort: `${campus?.name ?? ''}\u0000${names.get(payment.userId) ?? ''}`,
        payment,
        attendanceDeductions,
        row: {
          staff: names.get(payment.userId) ?? 'Former staff member',
          campus: campus?.name ?? '',
          status: 'Paid',
          base: money(payment.baseSalaryAtPayment),
          bonuses: money(payment.totalBonuses),
          attendanceDeductions: money(attendanceDeductions),
          manualDeductions: money(
            summary
              ? summary.manualDeductions
              : payment.totalDeductions.minus(attendanceDeductions),
          ),
          net: money(payment.finalSalaryPaid),
          paidOn: formatDate(
            this.timezones.localDateString(
              campus?.timezone ?? scope.campuses[0].timezone,
              payment.paymentDate,
            ),
          ),
        } satisfies ReportRow,
      };
    });
    const unpaidRows = [...owed.values()].map((salary) => {
      const campus = campusById.get(salary.campusId);
      return {
        sort: `${campus?.name ?? ''}\u0000${names.get(salary.userId) ?? ''}`,
        row: {
          staff: names.get(salary.userId) ?? 'Former staff member',
          campus: campus?.name ?? '',
          status: 'Not paid',
          base: money(salary.baseSalary),
          bonuses: null,
          attendanceDeductions: null,
          manualDeductions: null,
          net: null,
          paidOn: '',
        } satisfies ReportRow,
      };
    });
    const bySort = (a: { sort: string }, b: { sort: string }) =>
      a.sort.localeCompare(b.sort);
    paidRows.sort(bySort);
    unpaidRows.sort(bySort);

    const totalOf = (pick: (p: (typeof payments)[number]) => Prisma.Decimal) =>
      sumOf(payments.map(pick));
    const stillToPay = sumOf([...owed.values()].map((s) => s.baseSalary));
    const where =
      scope.campuses.length === 1 ? scope.campuses[0].name : 'All campuses';

    return {
      key: 'payroll-register',
      title: 'Payroll register',
      subtitle: `${monthText(year, month)}, ${where}`,
      columns: [
        { key: 'staff', label: 'Staff', weight: 3 },
        { key: 'campus', label: 'Campus', weight: 2 },
        { key: 'status', label: 'Status', weight: 1.2 },
        { key: 'base', label: 'Base salary', align: 'right', weight: 1.4 },
        { key: 'bonuses', label: 'Bonuses', align: 'right', weight: 1.2 },
        {
          key: 'attendanceDeductions',
          label: 'Attendance deductions',
          align: 'right',
          weight: 1.6,
        },
        {
          key: 'manualDeductions',
          label: 'Other deductions',
          align: 'right',
          weight: 1.4,
        },
        { key: 'net', label: 'Net paid', align: 'right', weight: 1.4 },
        { key: 'paidOn', label: 'Paid on', weight: 1.5 },
      ],
      rows: [...paidRows, ...unpaidRows].map((entry) => entry.row),
      totals: {
        staff: `Total, ${payments.length} paid${unpaidRows.length > 0 ? `, ${unpaidRows.length} not yet paid` : ''}`,
        base: money(totalOf((p) => p.baseSalaryAtPayment)),
        bonuses: money(totalOf((p) => p.totalBonuses)),
        attendanceDeductions: money(
          sumOf(paidRows.map((entry) => entry.attendanceDeductions)),
        ),
        manualDeductions: money(
          totalOf((p) => p.totalDeductions).minus(
            sumOf(paidRows.map((entry) => entry.attendanceDeductions)),
          ),
        ),
        net: money(totalOf((p) => p.finalSalaryPaid)),
      },
      notes: [
        `Figures are those recorded when each person was paid. Staff not yet paid are shown with their current base salary, which is ${money(stillToPay)} before any deductions or bonuses. Amounts are in ${currency}`,
      ],
      institutionId: scope.institutionId,
      campusId: scope.campuses.length === 1 ? scope.campuses[0].id : null,
    };
  }

  /**
   * What payroll cost each month: staff paid, salaries, bonuses, deductions and
   * the net total, by month and campus.
   *
   * @param {CurrentUser} currentUser - The administrator.
   * @param {CampusPeriodQueryDto} query - Campus (or all) and the period; whole months are covered.
   * @returns {Promise<ReportTable>} One row per month and campus, with a total.
   */
  async cost(
    currentUser: CurrentUser,
    query: CampusPeriodQueryDto,
  ): Promise<ReportTable> {
    const scope = await this.access.resolve(currentUser, {
      institutionId: query.institutionId,
      campusId: query.campusId,
    });
    const currency = await reportCurrency(this.prisma, scope.institutionId);
    const today = this.timezones.localDateString(scope.campuses[0].timezone);
    const period = resolvePeriod(query, today);
    const [fromYear, fromMonth] = period.from.split('-').map(Number);
    const [toYear, toMonth] = period.to.split('-').map(Number);
    const inRange = (year: number, month: number) =>
      year * 12 + month >= fromYear * 12 + fromMonth &&
      year * 12 + month <= toYear * 12 + toMonth;

    const payments = await this.prisma.salaryPayment.findMany({
      where: {
        campusId: { in: scope.campuses.map((campus) => campus.id) },
        deletedAt: null,
        year: { gte: fromYear, lte: toYear },
      },
      select: {
        campusId: true,
        month: true,
        year: true,
        baseSalaryAtPayment: true,
        totalBonuses: true,
        totalDeductions: true,
        finalSalaryPaid: true,
      },
    });
    const campusName = new Map(scope.campuses.map((c) => [c.id, c.name]));

    interface Group {
      campus: string;
      year: number;
      month: number;
      staff: number;
      base: Prisma.Decimal;
      bonuses: Prisma.Decimal;
      deductions: Prisma.Decimal;
      net: Prisma.Decimal;
    }
    const groups = new Map<string, Group>();
    for (const payment of payments) {
      if (!inRange(payment.year, payment.month)) continue;
      const key = `${payment.year}-${String(payment.month).padStart(2, '0')}:${payment.campusId}`;
      const group = groups.get(key) ?? {
        campus: campusName.get(payment.campusId) ?? '',
        year: payment.year,
        month: payment.month,
        staff: 0,
        base: ZERO,
        bonuses: ZERO,
        deductions: ZERO,
        net: ZERO,
      };
      group.staff += 1;
      group.base = group.base.plus(payment.baseSalaryAtPayment);
      group.bonuses = group.bonuses.plus(payment.totalBonuses);
      group.deductions = group.deductions.plus(payment.totalDeductions);
      group.net = group.net.plus(payment.finalSalaryPaid);
      groups.set(key, group);
    }
    const ordered = [...groups.entries()]
      .sort(([a, groupA], [b, groupB]) => {
        const monthA = a.split(':')[0];
        const monthB = b.split(':')[0];
        return (
          monthA.localeCompare(monthB) ||
          groupA.campus.localeCompare(groupB.campus)
        );
      })
      .map(([, group]) => group);
    const sum = (pick: (group: Group) => Prisma.Decimal) =>
      sumOf(ordered.map(pick));

    return {
      key: 'payroll-cost',
      title: 'Payroll cost by month',
      subtitle: `${monthText(fromYear, fromMonth)} to ${monthText(toYear, toMonth)}, ${scope.campuses.length === 1 ? scope.campuses[0].name : 'All campuses'}`,
      columns: [
        { key: 'month', label: 'Month', weight: 1.6 },
        { key: 'campus', label: 'Campus', weight: 2 },
        { key: 'staff', label: 'Staff paid', align: 'right' },
        { key: 'base', label: 'Base salaries', align: 'right', weight: 1.4 },
        { key: 'bonuses', label: 'Bonuses', align: 'right', weight: 1.2 },
        { key: 'deductions', label: 'Deductions', align: 'right', weight: 1.3 },
        { key: 'net', label: 'Net paid', align: 'right', weight: 1.4 },
      ],
      rows: ordered.map(
        (group): ReportRow => ({
          month: monthText(group.year, group.month),
          campus: group.campus,
          staff: group.staff,
          base: money(group.base),
          bonuses: money(group.bonuses),
          deductions: money(group.deductions),
          net: money(group.net),
        }),
      ),
      totals: {
        month: 'Total',
        staff: ordered.reduce((n, group) => n + group.staff, 0),
        base: money(sum((group) => group.base)),
        bonuses: money(sum((group) => group.bonuses)),
        deductions: money(sum((group) => group.deductions)),
        net: money(sum((group) => group.net)),
      },
      notes: [
        `Whole months are covered, by the payroll month each payment is for. Staff paid counts payments, so a person paid in two months counts twice. Amounts are in ${currency}`,
      ],
      institutionId: scope.institutionId,
      campusId: scope.campuses.length === 1 ? scope.campuses[0].id : null,
    };
  }

  private async namesOf(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}
