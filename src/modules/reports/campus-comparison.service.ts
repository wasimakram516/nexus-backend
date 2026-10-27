import { Injectable } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import { readFinanceSettings } from '../../common/utils/finance-settings.util';
import { formatDate } from '../../common/utils/date-format.util';
import {
  AttendanceStatus,
  EnrollmentStatus,
  Prisma,
  UserRole,
  VoucherStatus,
} from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CampusComparisonQueryDto } from './dto/reports.dto';
import { ReportCampus, ReportsAccessService } from './reports-access.service';
import { requireRealDate } from './report-dates.util';
import { money, percent, ReportRow, ReportTable } from './report-table';

const DAILY = 'DAILY';
const ZERO = new Prisma.Decimal(0);

interface CampusFigures {
  students: number;
  present: number;
  absent: number;
  leave: number;
  billed: Prisma.Decimal;
  collected: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  defaulters: number;
}

/**
 * The multi-campus comparison: every campus the administrator can see side by
 * side, with a total row. This is the school group's one-glance view of
 * enrollment, today's attendance, this month's fees and who owes.
 */
@Injectable()
export class CampusComparisonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ReportsAccessService,
    private readonly timezones: TimezoneResolverService,
  ) {}

  /**
   * @param {CurrentUser} currentUser - The administrator.
   * @param {CampusComparisonQueryDto} query - The day to report on and, for a superadmin, the institution.
   * @returns {Promise<ReportTable>} One row per campus plus a total.
   * @throws {ForbiddenException} If the caller may not run reports.
   */
  async build(
    currentUser: CurrentUser,
    query: CampusComparisonQueryDto,
  ): Promise<ReportTable> {
    if (query.date) requireRealDate(query.date, 'The date');
    const scope = await this.access.resolve(currentUser, {
      institutionId: query.institutionId,
    });
    const institution = await this.prisma.institution.findUnique({
      where: { id: scope.institutionId },
      select: {
        currentAcademicYearId: true,
        settings: { where: { key: 'finance' }, select: { value: true } },
      },
    });
    const currency = readFinanceSettings(
      institution?.settings[0]?.value,
    ).currencyLabel;
    const yearId = institution?.currentAcademicYearId ?? null;

    const figures = await Promise.all(
      scope.campuses.map((campus) =>
        this.figuresFor(campus, yearId, query.date),
      ),
    );

    const rows: ReportRow[] = scope.campuses.map((campus, index) =>
      this.rowOf(campus.name, figures[index]),
    );
    const total = figures.reduce<CampusFigures>(
      (sum, item) => ({
        students: sum.students + item.students,
        present: sum.present + item.present,
        absent: sum.absent + item.absent,
        leave: sum.leave + item.leave,
        billed: sum.billed.plus(item.billed),
        collected: sum.collected.plus(item.collected),
        outstanding: sum.outstanding.plus(item.outstanding),
        defaulters: sum.defaulters + item.defaulters,
      }),
      this.empty(),
    );

    const notes = [
      'Attendance is the share of students marked present or late, leaving out those on leave, among the students marked that day.',
      `Amounts are in ${currency}`,
      'Attendance counts daily marking; period-by-period marking is not included.',
    ];
    if (!yearId) {
      notes.push(
        'No current academic year is set, so student counts use every registered student.',
      );
    }
    return {
      key: 'campus-comparison',
      title: 'Campus comparison',
      subtitle: query.date
        ? `As of ${formatDate(query.date)}`
        : 'As of today at each campus',
      columns: [
        { key: 'campus', label: 'Campus', weight: 2.2 },
        { key: 'students', label: 'Students', align: 'right' },
        { key: 'present', label: 'Present', align: 'right' },
        { key: 'absent', label: 'Absent', align: 'right' },
        { key: 'leave', label: 'On leave', align: 'right' },
        { key: 'attendance', label: 'Attendance %', align: 'right' },
        {
          key: 'billed',
          label: 'Billed this month',
          align: 'right',
          weight: 1.3,
        },
        {
          key: 'collected',
          label: 'Collected this month',
          align: 'right',
          weight: 1.3,
        },
        { key: 'collection', label: 'Collection %', align: 'right' },
        {
          key: 'outstanding',
          label: 'Outstanding (all months)',
          align: 'right',
          weight: 1.4,
        },
        { key: 'defaulters', label: 'Defaulters', align: 'right' },
      ],
      rows,
      totals:
        scope.campuses.length > 1 ? this.rowOf('All campuses', total) : null,
      notes,
      institutionId: scope.institutionId,
      campusId: null,
    };
  }

  private empty(): CampusFigures {
    return {
      students: 0,
      present: 0,
      absent: 0,
      leave: 0,
      billed: ZERO,
      collected: ZERO,
      outstanding: ZERO,
      defaulters: 0,
    };
  }

  private rowOf(name: string, item: CampusFigures): ReportRow {
    return {
      campus: name,
      students: item.students,
      present: item.present,
      absent: item.absent,
      leave: item.leave,
      attendance: percent(item.present, item.present + item.absent),
      billed: money(item.billed),
      collected: money(item.collected),
      collection: percent(Number(item.collected), Number(item.billed)),
      outstanding: money(item.outstanding),
      defaulters: item.defaulters,
    };
  }

  /** Everything the table shows for one campus. */
  private async figuresFor(
    campus: ReportCampus,
    academicYearId: string | null,
    requestedDate?: string,
  ): Promise<CampusFigures> {
    const date =
      requestedDate ?? this.timezones.localDateString(campus.timezone);
    const [year, month] = date.split('-').map(Number);
    const monthStart = this.timezones.zonedTimeToInstant(
      campus.timezone,
      `${year}-${String(month).padStart(2, '0')}-01`,
      '00:00',
    );
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextMonthStart = this.timezones.zonedTimeToInstant(
      campus.timezone,
      `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
      '00:00',
    );
    const startOfToday = new Date(`${date}T00:00:00.000Z`);
    const ofCampus = { student: { campusId: campus.id, deletedAt: null } };

    const [students, marked, billed, collected, unpaid, paidOnUnpaid, overdue] =
      await Promise.all([
        academicYearId
          ? this.prisma.studentEnrollment.count({
              where: {
                campusId: campus.id,
                academicYearId,
                status: EnrollmentStatus.ACTIVE,
                deletedAt: null,
              },
            })
          : this.prisma.student.count({
              where: { campusId: campus.id, deletedAt: null },
            }),
        this.prisma.attendance.groupBy({
          by: ['status'],
          where: {
            campusId: campus.id,
            role: UserRole.STUDENT,
            date: startOfToday,
            periodKey: DAILY,
            deletedAt: null,
          },
          _count: { _all: true },
        }),
        this.prisma.feeVoucher.aggregate({
          where: { ...ofCampus, month, year, deletedAt: null },
          _sum: { finalAmountDue: true },
        }),
        this.prisma.feePayment.aggregate({
          where: {
            deletedAt: null,
            paymentDate: { gte: monthStart, lt: nextMonthStart },
            voucher: { ...ofCampus, deletedAt: null },
          },
          _sum: { paidAmount: true },
        }),
        this.prisma.feeVoucher.aggregate({
          where: {
            ...ofCampus,
            status: { not: VoucherStatus.PAID },
            deletedAt: null,
          },
          _sum: { finalAmountDue: true },
        }),
        this.prisma.feePayment.aggregate({
          where: {
            deletedAt: null,
            voucher: {
              ...ofCampus,
              status: { not: VoucherStatus.PAID },
              deletedAt: null,
            },
          },
          _sum: { paidAmount: true },
        }),
        this.prisma.feeVoucher.groupBy({
          by: ['studentId'],
          where: {
            ...ofCampus,
            status: { not: VoucherStatus.PAID },
            dueDate: { lt: startOfToday },
            deletedAt: null,
          },
        }),
      ]);

    const count = (status: AttendanceStatus) =>
      marked.find((row) => row.status === status)?._count._all ?? 0;
    return {
      students,
      present: count(AttendanceStatus.PRESENT) + count(AttendanceStatus.LATE),
      absent: count(AttendanceStatus.ABSENT),
      leave: count(AttendanceStatus.LEAVE),
      billed: billed._sum.finalAmountDue ?? ZERO,
      collected: collected._sum.paidAmount ?? ZERO,
      outstanding: Prisma.Decimal.max(
        (unpaid._sum.finalAmountDue ?? ZERO).minus(
          paidOnUnpaid._sum.paidAmount ?? ZERO,
        ),
        0,
      ),
      defaulters: overdue.length,
    };
  }
}
