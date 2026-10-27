import { Injectable, NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import { formatDate } from '../../common/utils/date-format.util';
import {
  AttendanceStatus,
  EnrollmentStatus,
  UserRole,
} from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { loadStudentPlacements } from '../finance/student-scope.util';
import {
  ChronicAbsenteesQueryDto,
  CampusPeriodQueryDto,
  MonthlyRegisterQueryDto,
} from './dto/reports.dto';
import {
  dayStart,
  daysOfMonth,
  requireRealDate,
  resolvePeriod,
} from './report-dates.util';
import { percent, ReportRow, ReportTable } from './report-table';
import { ReportsAccessService, ReportScope } from './reports-access.service';

const DAILY = 'DAILY';
/** A student with only a few days marked is not a pattern, so they are left out of the chronic list. */
const MIN_DAYS_MARKED = 5;
const DEFAULT_THRESHOLD_PERCENT = 20;

const DAY_CODE: Record<AttendanceStatus, string> = {
  PRESENT: 'P',
  ABSENT: 'A',
  LATE: 'L',
  LEAVE: 'V',
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const monthLabel = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return `${MONTH_NAMES[number - 1]} ${year}`;
};

/**
 * Attendance reports for administrators: a section's register for a month,
 * how staff attended, and the students who are absent too often. They read
 * daily marking only; period-by-period marking is not included.
 */
@Injectable()
export class AttendanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ReportsAccessService,
    private readonly timezones: TimezoneResolverService,
  ) {}

  /**
   * One section's register for a month: a row per student, a column per day.
   *
   * @param {CurrentUser} currentUser - The administrator.
   * @param {MonthlyRegisterQueryDto} query - The section and the month.
   * @returns {Promise<ReportTable>} P present, A absent, L late, V leave, blank when not marked.
   * @throws {NotFoundException} If the section does not exist.
   * @throws {ForbiddenException} If the caller cannot see the section's campus.
   */
  async monthlyRegister(
    currentUser: CurrentUser,
    query: MonthlyRegisterQueryDto,
  ): Promise<ReportTable> {
    const section = await this.prisma.section.findUnique({
      where: { id: query.sectionId },
      select: {
        name: true,
        classId: true,
        class: {
          select: { name: true, level: { select: { campusId: true } } },
        },
      },
    });
    if (!section) throw new NotFoundException('Section not found.');
    const campusId = section.class.level.campusId;
    const scope = await this.access.resolve(currentUser, {
      institutionId: query.institutionId,
      campusId,
    });
    const timezone = scope.campuses[0].timezone;
    const month =
      query.month ?? this.timezones.localDateString(timezone).slice(0, 7);
    const days = daysOfMonth(month);
    requireRealDate(days[0], 'The month');

    const institution = await this.prisma.institution.findUnique({
      where: { id: scope.institutionId },
      select: { currentAcademicYearId: true },
    });
    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        sectionId: query.sectionId,
        campusId,
        status: EnrollmentStatus.ACTIVE,
        deletedAt: null,
        ...(institution?.currentAcademicYearId
          ? { academicYearId: institution.currentAcademicYearId }
          : {}),
      },
      select: {
        student: {
          select: {
            userId: true,
            regNo: true,
            user: { select: { name: true } },
          },
        },
      },
    });
    const students = enrollments
      .map((row) => row.student)
      .sort((a, b) => a.user.name.localeCompare(b.user.name));

    const records = await this.prisma.attendance.findMany({
      where: {
        userId: { in: students.map((student) => student.userId) },
        campusId,
        role: UserRole.STUDENT,
        periodKey: DAILY,
        deletedAt: null,
        date: { gte: dayStart(days[0]), lte: dayStart(days[days.length - 1]) },
      },
      select: { userId: true, date: true, status: true },
    });
    const byStudent = new Map<string, Map<string, AttendanceStatus>>();
    for (const record of records) {
      const marks =
        byStudent.get(record.userId) ?? new Map<string, AttendanceStatus>();
      marks.set(record.date.toISOString().slice(0, 10), record.status);
      byStudent.set(record.userId, marks);
    }

    const rows: ReportRow[] = students.map((student) => {
      const marks =
        byStudent.get(student.userId) ?? new Map<string, AttendanceStatus>();
      const counts = { present: 0, late: 0, absent: 0, leave: 0 };
      const row: ReportRow = { regNo: student.regNo, name: student.user.name };
      days.forEach((day, index) => {
        const status = marks.get(day);
        row[`d${index + 1}`] = status ? DAY_CODE[status] : '';
        if (status === AttendanceStatus.PRESENT) counts.present += 1;
        if (status === AttendanceStatus.LATE) counts.late += 1;
        if (status === AttendanceStatus.ABSENT) counts.absent += 1;
        if (status === AttendanceStatus.LEAVE) counts.leave += 1;
      });
      row.present = counts.present + counts.late;
      row.late = counts.late;
      row.absent = counts.absent;
      row.leave = counts.leave;
      row.attendance = percent(
        counts.present + counts.late,
        counts.present + counts.late + counts.absent,
      );
      return row;
    });

    return {
      key: 'attendance-register',
      title: `Attendance register, ${section.class.name} section ${section.name}`,
      subtitle: monthLabel(month),
      columns: [
        { key: 'regNo', label: 'Reg no', weight: 1.4 },
        { key: 'name', label: 'Student', weight: 3 },
        ...days.map((_, index) => ({
          key: `d${index + 1}`,
          label: String(index + 1),
          align: 'center' as const,
          weight: 0.4,
        })),
        { key: 'present', label: 'Present', align: 'right', weight: 0.8 },
        { key: 'late', label: 'Late', align: 'right', weight: 0.6 },
        { key: 'absent', label: 'Absent', align: 'right', weight: 0.8 },
        { key: 'leave', label: 'Leave', align: 'right', weight: 0.7 },
        { key: 'attendance', label: '%', align: 'right', weight: 0.7 },
      ],
      rows,
      totals: null,
      notes: [
        'P present, A absent, L late, V on leave, blank not marked. Present counts late arrivals; the percentage leaves leave days out.',
        'Daily marking only; period-by-period marking is not included.',
      ],
      institutionId: scope.institutionId,
      campusId,
    };
  }

  /**
   * How administrators and staff attended over a period, one row each.
   *
   * @param {CurrentUser} currentUser - The administrator.
   * @param {CampusPeriodQueryDto} query - Campus (or all), and the period.
   * @returns {Promise<ReportTable>} Counts per person with an attendance percentage.
   */
  async staffSummary(
    currentUser: CurrentUser,
    query: CampusPeriodQueryDto,
  ): Promise<ReportTable> {
    const scope = await this.access.resolve(currentUser, {
      institutionId: query.institutionId,
      campusId: query.campusId,
    });
    const period = this.periodOf(scope, query);
    const campusIds = scope.campuses.map((campus) => campus.id);
    const where = {
      campusId: { in: campusIds },
      role: { in: [UserRole.STAFF, UserRole.ADMIN] },
      periodKey: DAILY,
      deletedAt: null,
      date: { gte: dayStart(period.from), lte: dayStart(period.to) },
    };
    const [counts, halfDays] = await Promise.all([
      this.prisma.attendance.groupBy({
        by: ['userId', 'campusId', 'role', 'status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.attendance.groupBy({
        by: ['userId', 'campusId'],
        where: { ...where, halfDay: true },
        _count: { _all: true },
      }),
    ]);

    const people = new Map<
      string,
      {
        userId: string;
        campusId: string;
        role: UserRole;
        present: number;
        late: number;
        absent: number;
        leave: number;
      }
    >();
    for (const row of counts) {
      const key = `${row.userId}:${row.campusId}`;
      const person = people.get(key) ?? {
        userId: row.userId,
        campusId: row.campusId,
        role: row.role,
        present: 0,
        late: 0,
        absent: 0,
        leave: 0,
      };
      const n = row._count._all;
      if (row.status === AttendanceStatus.PRESENT) person.present += n;
      if (row.status === AttendanceStatus.LATE) person.late += n;
      if (row.status === AttendanceStatus.ABSENT) person.absent += n;
      if (row.status === AttendanceStatus.LEAVE) person.leave += n;
      people.set(key, person);
    }
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: [...people.values()].map((p) => p.userId) } },
          select: { id: true, name: true },
        })
      ).map((user) => [user.id, user.name]),
    );
    const halfByKey = new Map(
      halfDays.map((row) => [`${row.userId}:${row.campusId}`, row._count._all]),
    );
    const campusName = new Map(
      scope.campuses.map((campus) => [campus.id, campus.name]),
    );

    const rows = [...people.entries()]
      .map(([key, person]): ReportRow => {
        const present = person.present + person.late;
        return {
          name: names.get(person.userId) ?? 'Unknown',
          role: person.role === UserRole.ADMIN ? 'Administrator' : 'Staff',
          campus: campusName.get(person.campusId) ?? '',
          present,
          late: person.late,
          absent: person.absent,
          leave: person.leave,
          halfDays: halfByKey.get(key) ?? 0,
          attendance: percent(present, present + person.absent),
        };
      })
      .sort(
        (a, b) =>
          String(a.campus).localeCompare(String(b.campus)) ||
          String(a.name).localeCompare(String(b.name)),
      );

    return {
      key: 'staff-attendance',
      title: 'Staff attendance summary',
      subtitle: this.periodText(period, scope),
      columns: [
        { key: 'name', label: 'Name', weight: 3 },
        { key: 'role', label: 'Role', weight: 1.4 },
        { key: 'campus', label: 'Campus', weight: 2 },
        { key: 'present', label: 'Present', align: 'right' },
        { key: 'late', label: 'Late', align: 'right' },
        { key: 'absent', label: 'Absent', align: 'right' },
        { key: 'leave', label: 'Leave', align: 'right' },
        { key: 'halfDays', label: 'Half days', align: 'right' },
        { key: 'attendance', label: 'Attendance %', align: 'right' },
      ],
      rows,
      totals: null,
      notes: [
        'Present counts late arrivals; the percentage is present over present and absent, leaving leave days out.',
      ],
      institutionId: scope.institutionId,
      campusId: scope.campuses.length === 1 ? scope.campuses[0].id : null,
    };
  }

  /**
   * Students absent on a large share of the days they were marked.
   *
   * @param {CurrentUser} currentUser - The administrator.
   * @param {ChronicAbsenteesQueryDto} query - Campus (or all), the period and the threshold.
   * @returns {Promise<ReportTable>} Students at or over the threshold, worst first.
   */
  async chronicAbsentees(
    currentUser: CurrentUser,
    query: ChronicAbsenteesQueryDto,
  ): Promise<ReportTable> {
    const scope = await this.access.resolve(currentUser, {
      institutionId: query.institutionId,
      campusId: query.campusId,
    });
    const period = this.periodOf(scope, query);
    const threshold = query.thresholdPercent ?? DEFAULT_THRESHOLD_PERCENT;
    const counts = await this.prisma.attendance.groupBy({
      by: ['userId', 'status'],
      where: {
        campusId: { in: scope.campuses.map((campus) => campus.id) },
        role: UserRole.STUDENT,
        periodKey: DAILY,
        deletedAt: null,
        date: { gte: dayStart(period.from), lte: dayStart(period.to) },
      },
      _count: { _all: true },
    });

    const byUser = new Map<
      string,
      { marked: number; absent: number; late: number }
    >();
    for (const row of counts) {
      if (row.status === AttendanceStatus.LEAVE) continue;
      const entry = byUser.get(row.userId) ?? { marked: 0, absent: 0, late: 0 };
      entry.marked += row._count._all;
      if (row.status === AttendanceStatus.ABSENT)
        entry.absent += row._count._all;
      if (row.status === AttendanceStatus.LATE) entry.late += row._count._all;
      byUser.set(row.userId, entry);
    }
    const flagged = [...byUser.entries()].filter(
      ([, entry]) =>
        entry.marked >= MIN_DAYS_MARKED &&
        percent(entry.absent, entry.marked) >= threshold,
    );

    const students = await this.prisma.student.findMany({
      where: {
        userId: { in: flagged.map(([userId]) => userId) },
        deletedAt: null,
      },
      select: {
        id: true,
        userId: true,
        regNo: true,
        campusId: true,
        user: { select: { name: true } },
      },
    });
    const placements = await loadStudentPlacements(
      this.prisma,
      students.map((student) => student.id),
    );
    const stats = new Map(flagged);
    const campusName = new Map(
      scope.campuses.map((campus) => [campus.id, campus.name]),
    );
    const rows = students
      .filter((student) => stats.has(student.userId))
      .map((student): ReportRow => {
        const entry = stats.get(student.userId) ?? {
          marked: 0,
          absent: 0,
          late: 0,
        };
        const placement = placements.get(student.id);
        return {
          name: student.user.name,
          regNo: student.regNo,
          className: placement?.className ?? '',
          sectionName: placement?.sectionName ?? '',
          campus: campusName.get(student.campusId) ?? '',
          marked: entry.marked,
          absent: entry.absent,
          late: entry.late,
          absentPercent: percent(entry.absent, entry.marked),
        };
      })
      .sort(
        (a, b) =>
          Number(b.absentPercent) - Number(a.absentPercent) ||
          String(a.name).localeCompare(String(b.name)),
      );

    return {
      key: 'chronic-absentees',
      title: 'Chronic absentees',
      subtitle: `${this.periodText(period, scope)}, absent on at least ${threshold}% of days marked`,
      columns: [
        { key: 'name', label: 'Student', weight: 3 },
        { key: 'regNo', label: 'Reg no', weight: 1.4 },
        { key: 'className', label: 'Class', weight: 1.5 },
        { key: 'sectionName', label: 'Section', weight: 1.2 },
        { key: 'campus', label: 'Campus', weight: 2 },
        { key: 'marked', label: 'Days marked', align: 'right' },
        { key: 'absent', label: 'Absent', align: 'right' },
        { key: 'late', label: 'Late', align: 'right' },
        { key: 'absentPercent', label: 'Absent %', align: 'right' },
      ],
      rows,
      totals: null,
      notes: [
        `Only students marked on at least ${MIN_DAYS_MARKED} days are listed, and leave days are not counted.`,
      ],
      institutionId: scope.institutionId,
      campusId: scope.campuses.length === 1 ? scope.campuses[0].id : null,
    };
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
