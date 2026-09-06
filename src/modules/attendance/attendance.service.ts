import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceStatus as PrismaAttendanceStatus,
  EnrollmentStatus,
  ModuleKey,
  UserRole,
  UserRole as PrismaUserRole,
} from '../../prisma/client';
import { AttendanceStatus } from '../../common/enums/domain.enums';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AutoAbsentDto,
  BulkMarkAttendanceDto,
  CheckInDto,
  CheckOutDto,
  ListAttendanceQueryDto,
  MarkLeaveDto,
  PeriodRosterQueryDto,
  UpdateAttendanceRecordDto,
} from './dto/attendance.dto';

/** Institution-level attendance capture granularity (§ 5.3, § 9 of
 *  M3-SCHEDULING-COMMUNICATION-DESIGN.md). Governs STUDENT bulk-marking and
 *  the auto-absent job only — STAFF check-in/out/leave stays DAILY-only
 *  regardless of this setting. */
export type AttendanceMode = 'DAILY' | 'PERIOD';

/** Sentinel periodKey value for every non-period-scoped Attendance row —
 *  every DAILY-mode row, plus every STAFF/ADMIN row regardless of mode. */
const DAILY_PERIOD_KEY = 'DAILY';

/** Roster entry shape shared by getPeriodRoster(), bulkMark()'s
 *  period-membership check, and markPeriodAbsentees(). */
interface PeriodRosterStudent {
  studentId: string;
  userId: string;
  name: string;
  regNo: string;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campusAccessService: CampusAccessService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly userPermissionsService: UserPermissionsService,
  ) {}

  /** SUPERADMIN/ADMIN always qualify; other archetypes (STAFF) qualify only
   *  when granted attendance.update via their assigned Role — this is what
   *  replaces the old hardcoded ACCOUNTANT-archetype privilege check. */
  private async isAttendancePrivileged(
    currentUser: CurrentUser,
  ): Promise<boolean> {
    if (
      currentUser.role === UserRole.SUPERADMIN ||
      currentUser.role === UserRole.ADMIN
    ) {
      return true;
    }
    return this.userPermissionsService.can(currentUser, 'attendance', 'update');
  }

  async checkIn(currentUser: CurrentUser, dto: CheckInDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );
    await this.assertAttendanceActor(currentUser, dto.userId);
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) throw new NotFoundException('User not found.');
    this.assertAttendanceSubject(user.role);

    const campusId = await this.resolveCampusId(dto.userId, user.role);
    await this.campusAccessService.assertCampusAccess(currentUser, campusId);
    const campus = await this.prisma.campus.findUniqueOrThrow({
      where: { id: campusId },
    });

    const officialStart =
      user.role === PrismaUserRole.STUDENT
        ? campus.studentStartTime
        : campus.staffStartTime;
    const lateThresholdTime = new Date(`${dto.date}T${officialStart}.000Z`);
    lateThresholdTime.setUTCMinutes(
      lateThresholdTime.getUTCMinutes() + campus.lateThreshold,
    );
    const status =
      new Date(dto.checkIn) > lateThresholdTime
        ? AttendanceStatus.LATE
        : AttendanceStatus.PRESENT;

    const existing = await this.prisma.attendance.findFirst({
      where: { userId: dto.userId, campusId, date: new Date(dto.date) },
    });

    if (existing) {
      throw new ConflictException(
        'Attendance has already been recorded for this user on the selected date.',
      );
    }

    const item = await this.prisma.attendance.create({
      data: {
        userId: dto.userId,
        role: user.role,
        campusId,
        date: new Date(dto.date),
        checkIn: new Date(dto.checkIn),
        remarks: dto.remarks,
        status,
      },
    });
    return { message: 'Check-in recorded successfully', data: item };
  }

  async checkOut(currentUser: CurrentUser, dto: CheckOutDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );
    await this.assertAttendanceActor(currentUser, dto.userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: dto.userId },
    });
    this.assertAttendanceSubject(user.role);
    const campusId = await this.resolveCampusId(dto.userId, user.role);
    await this.campusAccessService.assertCampusAccess(currentUser, campusId);
    const record = await this.prisma.attendance.findFirst({
      where: { userId: dto.userId, campusId, date: new Date(dto.date) },
    });
    if (!record) throw new NotFoundException('Attendance record not found.');
    const campus = await this.prisma.campus.findUniqueOrThrow({
      where: { id: campusId },
    });
    const officialEnd =
      user.role === PrismaUserRole.STUDENT
        ? campus.studentEndTime
        : campus.staffEndTime;
    const threshold = new Date(`${dto.date}T${officialEnd}.000Z`);
    threshold.setUTCMinutes(
      threshold.getUTCMinutes() - campus.earlyLeaveThreshold,
    );
    const item = await this.prisma.attendance.update({
      where: { id: record.id },
      data: {
        checkOut: new Date(dto.checkOut),
        halfDay: new Date(dto.checkOut) < threshold,
      },
    });
    return { message: 'Check-out recorded successfully', data: item };
  }

  async markLeave(currentUser: CurrentUser, dto: MarkLeaveDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: dto.userId },
    });
    this.assertAttendanceSubject(user.role);
    if (
      currentUser.role !== UserRole.SUPERADMIN &&
      currentUser.role !== UserRole.ADMIN
    ) {
      throw new ForbiddenException(
        'Only admin-level users can mark leave for other users.',
      );
    }
    const campusId = await this.resolveCampusId(dto.userId, user.role);
    await this.campusAccessService.assertCampusAccess(currentUser, campusId);
    const existing = await this.prisma.attendance.findFirst({
      where: { userId: dto.userId, campusId, date: new Date(dto.date) },
    });

    const item = existing
      ? await this.prisma.attendance.update({
          where: { id: existing.id },
          data: { status: AttendanceStatus.LEAVE, remarks: dto.remarks },
        })
      : await this.prisma.attendance.create({
          data: {
            userId: dto.userId,
            role: user.role,
            campusId,
            date: new Date(dto.date),
            status: AttendanceStatus.LEAVE,
            remarks: dto.remarks,
          },
        });

    return { message: 'Leave marked successfully', data: item };
  }

  async autoMarkAbsent(currentUser: CurrentUser, dto: AutoAbsentDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );

    if (dto.periodId) {
      // Manual equivalent of the scheduler's PERIOD-mode branch (§ 7.2/§
      // 7.4) — campusId is re-resolved from the period slot itself (never
      // trusted from the client) so access is checked against where the
      // period actually lives, not wherever the caller claims dto.campusId
      // to be.
      const periodSlot = await this.prisma.periodSlot.findFirst({
        where: { id: dto.periodId, deletedAt: null },
        select: { campusId: true },
      });
      if (!periodSlot) {
        throw new NotFoundException('Period slot not found.');
      }
      await this.campusAccessService.assertCampusAccess(
        currentUser,
        periodSlot.campusId,
      );
      return this.markPeriodAbsentees(dto.periodId, dto.date);
    }

    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    return this.markCampusAbsentees(dto.campusId, dto.date);
  }

  /**
   * Shared by the manual autoMarkAbsent() endpoint and the scheduled
   * end-of-day job — kept guard-free so the scheduler (which has already
   * done its own per-institution module/subscription eligibility check) can
   * call it directly without a synthetic actor. Idempotent: only creates
   * rows for users who don't already have an attendance record that day.
   */
  async markCampusAbsentees(campusId: string, date: string) {
    const users = await this.prisma.userCampus.findMany({
      where: { campusId },
      include: { user: true },
    });
    const existing = await this.prisma.attendance.findMany({
      where: { campusId, date: new Date(date) },
      select: { userId: true },
    });
    const existingIds = new Set(
      existing.map((item: { userId: string }) => item.userId),
    );
    const data = users
      .filter(
        (item: { userId: string; user: { role: PrismaUserRole } }) =>
          !existingIds.has(item.userId),
      )
      .map((item: { userId: string; user: { role: PrismaUserRole } }) => ({
        userId: item.userId,
        role: item.user.role,
        campusId,
        date: new Date(date),
        status: AttendanceStatus.ABSENT,
      }));
    if (data.length) {
      await this.prisma.attendance.createMany({ data });
    }
    return {
      message: 'Absent users marked successfully',
      data: { count: data.length },
    };
  }

  /**
   * PERIOD-mode sibling to markCampusAbsentees(), scoped to one period
   * slot's roster instead of a whole campus's day (§ 7.2, § 12 Track B Step
   * 2). Kept guard-free for the same reason as its campus-wide counterpart
   * — the scheduler calls it directly per due PeriodSlot without a
   * synthetic actor. Idempotent: only creates rows for roster students who
   * don't already have an attendance row for this exact (date, periodId).
   * STUDENT-only by construction (the roster comes from StudentEnrollment)
   * — staff attendance never runs through this path (§ 9's design call).
   *
   * @param {string} periodSlotId - PeriodSlot to sweep.
   * @param {string} date - Date-only string ("YYYY-MM-DD").
   * @returns {Promise<{message: string, data: {count: number}}>}
   * @throws {NotFoundException} If the period slot doesn't exist.
   */
  async markPeriodAbsentees(periodSlotId: string, date: string) {
    const periodSlot = await this.prisma.periodSlot.findFirst({
      where: { id: periodSlotId, deletedAt: null },
      select: { id: true, campusId: true, classId: true, sectionId: true },
    });
    if (!periodSlot) {
      throw new NotFoundException('Period slot not found.');
    }

    const institutionId = await this.resolveInstitutionIdForCampus(
      periodSlot.campusId,
    );
    const roster = await this.resolvePeriodRosterStudents(
      periodSlot,
      institutionId,
    );
    if (!roster.length) {
      return {
        message: 'Absent students marked successfully',
        data: { count: 0 },
      };
    }

    const day = this.toDateOnly(date);
    const existing = await this.prisma.attendance.findMany({
      where: {
        campusId: periodSlot.campusId,
        date: day,
        periodId: periodSlot.id,
        userId: { in: roster.map((entry) => entry.userId) },
      },
      select: { userId: true },
    });
    const existingIds = new Set(
      existing.map((item: { userId: string }) => item.userId),
    );

    const data = roster
      .filter((entry) => !existingIds.has(entry.userId))
      .map((entry) => ({
        userId: entry.userId,
        role: PrismaUserRole.STUDENT,
        campusId: periodSlot.campusId,
        date: day,
        status: AttendanceStatus.ABSENT,
        periodId: periodSlot.id,
        periodKey: periodSlot.id,
      }));

    if (data.length) {
      await this.prisma.attendance.createMany({ data });
    }

    return {
      message: 'Absent students marked successfully',
      data: { count: data.length },
    };
  }

  /**
   * Register-style marking: upserts one attendance row per valid entry for
   * the campus/date. Invalid entries are skipped and reported, never fatal.
   * Punch times (checkIn/checkOut) are facts — bulk marking never touches
   * them.
   *
   * Attendance dual mode (§ 5.3, § 9): `dto.periodId` is rejected outright
   * when the institution is DAILY-mode, and required whenever this batch
   * includes STUDENT entries in a PERIOD-mode institution — there's no
   * whole-day bypass once PERIOD mode is on. It applies to STUDENT entries
   * only: STAFF/ADMIN entries in the same batch always stay DAILY-keyed,
   * matching the design call that staff attendance is unaffected by this
   * feature.
   *
   * @throws {BadRequestException} If periodId is supplied in DAILY mode, omitted for a STUDENT entry in PERIOD mode, or the period slot doesn't belong to this campus.
   * @throws {NotFoundException} If periodId doesn't resolve to a period slot.
   */
  async bulkMark(currentUser: CurrentUser, dto: BulkMarkAttendanceDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );

    const institutionId = await this.resolveInstitutionIdForCampus(
      dto.campusId,
    );
    const mode = await this.resolveAttendanceMode(institutionId);

    if (mode === 'DAILY' && dto.periodId) {
      throw new BadRequestException(
        'This institution is in DAILY attendance mode; periodId is not allowed on bulk marking.',
      );
    }

    let periodRosterUserIds: Set<string> | null = null;
    if (dto.periodId) {
      const periodSlot = await this.prisma.periodSlot.findFirst({
        where: { id: dto.periodId, deletedAt: null },
        select: { id: true, campusId: true, classId: true, sectionId: true },
      });
      if (!periodSlot) {
        throw new NotFoundException('Period slot not found.');
      }
      if (periodSlot.campusId !== dto.campusId) {
        throw new BadRequestException(
          'The selected period slot does not belong to this campus.',
        );
      }
      const roster = await this.resolvePeriodRosterStudents(
        periodSlot,
        institutionId,
      );
      periodRosterUserIds = new Set(roster.map((entry) => entry.userId));
    }

    const day = this.toDateOnly(dto.date);
    const skipped: Array<{ userId: string; reason: string }> = [];

    const seen = new Set<string>();
    const entries = dto.entries.filter((entry) => {
      if (seen.has(entry.userId)) {
        skipped.push({ userId: entry.userId, reason: 'DUPLICATE_ENTRY' });
        return false;
      }
      seen.add(entry.userId);
      return true;
    });

    const ids = entries.map((entry) => entry.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, role: true },
    });
    const userById = new Map(users.map((user) => [user.id, user]));

    const studentIds = users
      .filter((user) => user.role === PrismaUserRole.STUDENT)
      .map((user) => user.id);

    if (mode === 'PERIOD' && !dto.periodId && studentIds.length > 0) {
      throw new BadRequestException(
        'This institution is in PERIOD attendance mode; periodId is required when bulk-marking student attendance.',
      );
    }

    // STAFF covers both teaching and non-teaching employees; membership is
    // proven by EITHER a StaffProfile at this campus (teaching staff) OR
    // an explicit UserCampus assignment (non-teaching staff, campus admins).
    const staffIds = users
      .filter(
        (user) =>
          user.role === PrismaUserRole.STAFF ||
          user.role === PrismaUserRole.ADMIN,
      )
      .map((user) => user.id);

    const [studentMembers, teacherMembers, staffMembers] = await Promise.all([
      studentIds.length
        ? this.prisma.student.findMany({
            where: { userId: { in: studentIds }, campusId: dto.campusId },
            select: { userId: true },
          })
        : Promise.resolve([]),
      staffIds.length
        ? this.prisma.staffProfile.findMany({
            where: { userId: { in: staffIds }, campusId: dto.campusId },
            select: { userId: true },
          })
        : Promise.resolve([]),
      staffIds.length
        ? this.prisma.userCampus.findMany({
            where: { userId: { in: staffIds }, campusId: dto.campusId },
            select: { userId: true },
          })
        : Promise.resolve([]),
    ]);
    const memberIds = new Set([
      ...studentMembers.map((member) => member.userId),
      ...teacherMembers.map((member) => member.userId),
      ...staffMembers.map((member) => member.userId),
    ]);

    const valid: Array<{
      userId: string;
      role: PrismaUserRole;
      status: AttendanceStatus;
      halfDay?: boolean;
      remarks?: string;
      periodKey: string;
    }> = [];

    for (const entry of entries) {
      const user = userById.get(entry.userId);
      if (!user) {
        skipped.push({ userId: entry.userId, reason: 'USER_NOT_FOUND' });
        continue;
      }
      if (
        user.role === PrismaUserRole.GUARDIAN ||
        user.role === PrismaUserRole.SUPERADMIN
      ) {
        skipped.push({ userId: entry.userId, reason: 'ROLE_NOT_ALLOWED' });
        continue;
      }
      if (!memberIds.has(entry.userId)) {
        skipped.push({ userId: entry.userId, reason: 'NOT_IN_CAMPUS' });
        continue;
      }

      // periodId only ever scopes STUDENT entries — STAFF/ADMIN entries in
      // the same batch stay DAILY-keyed regardless (§ 9's design call).
      const isStudent = user.role === PrismaUserRole.STUDENT;
      if (
        isStudent &&
        periodRosterUserIds &&
        !periodRosterUserIds.has(entry.userId)
      ) {
        skipped.push({ userId: entry.userId, reason: 'NOT_IN_PERIOD_ROSTER' });
        continue;
      }

      valid.push({
        userId: entry.userId,
        role: user.role,
        status: entry.status,
        halfDay: entry.halfDay,
        remarks: entry.remarks,
        periodKey: isStudent && dto.periodId ? dto.periodId : DAILY_PERIOD_KEY,
      });
    }

    // Deterministic order; each upsert is an atomic ON CONFLICT DO UPDATE,
    // so no wrapping transaction is needed (audit side-queries stay short).
    valid.sort((a, b) => a.userId.localeCompare(b.userId));

    for (const entry of valid) {
      await this.prisma.attendance.upsert({
        where: {
          userId_campusId_date_periodKey_activeScopeKey: {
            userId: entry.userId,
            campusId: dto.campusId,
            date: day,
            periodKey: entry.periodKey,
            activeScopeKey: 'ACTIVE',
          },
        },
        create: {
          userId: entry.userId,
          role: entry.role,
          campusId: dto.campusId,
          date: day,
          status: entry.status,
          periodKey: entry.periodKey,
          ...(entry.periodKey !== DAILY_PERIOD_KEY
            ? { periodId: entry.periodKey }
            : {}),
          ...(entry.halfDay !== undefined ? { halfDay: entry.halfDay } : {}),
          ...(entry.remarks !== undefined ? { remarks: entry.remarks } : {}),
        },
        update: {
          status: entry.status,
          ...(entry.halfDay !== undefined ? { halfDay: entry.halfDay } : {}),
          ...(entry.remarks !== undefined ? { remarks: entry.remarks } : {}),
        },
      });
    }

    return {
      message: 'Attendance marked successfully',
      data: { marked: valid.length, skipped },
    };
  }

  /**
   * Backs the PERIOD-mode marking grid (§ 7.2): the enrolled ACTIVE
   * students for a period slot's (classId, sectionId) at the institution's
   * current academic year, each annotated with any existing attendance
   * status for that exact (date, periodId). Returns an empty roster (not an
   * error) when there's no current academic year set — the same
   * "no current context = empty result" convention as
   * PeopleService.attachCurrentEnrollment.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {PeriodRosterQueryDto} query - periodId + date to resolve the roster/attendance snapshot for.
   * @returns {Promise<{message: string, data: object[]}>}
   * @throws {NotFoundException} If the period slot doesn't exist.
   * @throws {ForbiddenException} If the caller lacks access to the period slot's campus.
   */
  async getPeriodRoster(currentUser: CurrentUser, query: PeriodRosterQueryDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );

    const periodSlot = await this.prisma.periodSlot.findFirst({
      where: { id: query.periodId, deletedAt: null },
      select: { id: true, campusId: true, classId: true, sectionId: true },
    });
    if (!periodSlot) {
      throw new NotFoundException('Period slot not found.');
    }
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      periodSlot.campusId,
    );

    const institutionId = await this.resolveInstitutionIdForCampus(
      periodSlot.campusId,
    );
    const roster = await this.resolvePeriodRosterStudents(
      periodSlot,
      institutionId,
    );

    if (!roster.length) {
      return { message: 'Period roster retrieved successfully', data: [] };
    }

    const day = this.toDateOnly(query.date);
    const existing = await this.prisma.attendance.findMany({
      where: {
        campusId: periodSlot.campusId,
        date: day,
        periodId: periodSlot.id,
        userId: { in: roster.map((entry) => entry.userId) },
      },
      select: { userId: true, status: true, halfDay: true, remarks: true },
    });
    const attendanceByUserId = new Map(
      existing.map((item) => [item.userId, item] as const),
    );

    const data = roster.map((entry) => {
      const attendance = attendanceByUserId.get(entry.userId);
      return {
        userId: entry.userId,
        studentId: entry.studentId,
        name: entry.name,
        regNo: entry.regNo,
        status: attendance?.status ?? null,
        halfDay: attendance?.halfDay ?? false,
        remarks: attendance?.remarks ?? null,
      };
    });

    return { message: 'Period roster retrieved successfully', data };
  }

  async listAttendance(
    currentUser: CurrentUser,
    query: ListAttendanceQueryDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );
    const where = await this.buildAttendanceWhere(currentUser, query);
    const items = await this.prisma.attendance.findMany({
      where,
      orderBy: { date: 'desc' },
    });
    return { message: 'Attendance retrieved successfully', data: items };
  }

  async getAttendanceSummary(
    currentUser: CurrentUser,
    query: ListAttendanceQueryDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );
    const where = await this.buildAttendanceWhere(currentUser, query);
    const items = await this.prisma.attendance.findMany({
      where,
      select: {
        status: true,
        halfDay: true,
        checkIn: true,
        checkOut: true,
      },
    });

    const summary = items.reduce(
      (accumulator, item) => {
        accumulator.totalRecords += 1;
        accumulator.halfDayCount += item.halfDay ? 1 : 0;
        accumulator.checkedInCount += item.checkIn ? 1 : 0;
        accumulator.checkedOutCount += item.checkOut ? 1 : 0;

        if (item.status === PrismaAttendanceStatus.PRESENT) {
          accumulator.presentCount += 1;
        } else if (item.status === PrismaAttendanceStatus.ABSENT) {
          accumulator.absentCount += 1;
        } else if (item.status === PrismaAttendanceStatus.LATE) {
          accumulator.lateCount += 1;
        } else if (item.status === PrismaAttendanceStatus.LEAVE) {
          accumulator.leaveCount += 1;
        }

        return accumulator;
      },
      {
        totalRecords: 0,
        presentCount: 0,
        absentCount: 0,
        lateCount: 0,
        leaveCount: 0,
        halfDayCount: 0,
        checkedInCount: 0,
        checkedOutCount: 0,
      },
    );

    return {
      message: 'Attendance summary retrieved successfully',
      data: summary,
    };
  }

  async getAttendanceRecord(currentUser: CurrentUser, attendanceId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );

    const item = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
    });

    if (!item) {
      throw new NotFoundException('Attendance record not found.');
    }

    await this.assertAttendanceRecordAccess(currentUser, item);

    return { message: 'Attendance record retrieved successfully', data: item };
  }

  async updateAttendanceRecord(
    currentUser: CurrentUser,
    attendanceId: string,
    dto: UpdateAttendanceRecordDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );

    const existing = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
    });

    if (!existing) {
      throw new NotFoundException('Attendance record not found.');
    }

    await this.assertAttendanceRecordAccess(currentUser, existing);

    const nextDate = dto.date
      ? this.toDateOnly(dto.date)
      : this.toDateOnly(existing.date);
    const nextCheckOut = dto.checkOut
      ? new Date(dto.checkOut)
      : (existing.checkOut ?? undefined);

    const item = await this.prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        ...(dto.date ? { date: nextDate } : {}),
        ...(dto.checkIn ? { checkIn: new Date(dto.checkIn) } : {}),
        ...(dto.checkOut
          ? {
              checkOut: nextCheckOut,
              halfDay: await this.resolveHalfDayStatus(
                existing.campusId,
                existing.role,
                nextDate,
                nextCheckOut,
              ),
            }
          : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.halfDay !== undefined ? { halfDay: dto.halfDay } : {}),
        ...(dto.remarks !== undefined ? { remarks: dto.remarks } : {}),
      },
    });

    return { message: 'Attendance record updated successfully', data: item };
  }

  private async resolveCampusId(userId: string, role: string): Promise<string> {
    if (role === PrismaUserRole.STUDENT) {
      const student = await this.prisma.student.findUnique({
        where: { userId },
      });
      if (!student) {
        throw new ConflictException(
          'This account has no student profile yet — create one under People → Students.',
        );
      }
      return student.campusId;
    }
    if (role === PrismaUserRole.STAFF) {
      // Teaching staff resolve to their profile's campus; non-teaching
      // staff (accountants, front-desk, campus admins) fall through to the
      // generic UserCampus assignment lookup below. This is a different
      // concern from CampusAccessService's permission scoping (§ 7.6) —
      // here we want "where does this person physically punch in," which
      // stays profile-first-then-UserCampus-fallback.
      const staffProfile = await this.prisma.staffProfile.findUnique({
        where: { userId },
      });
      if (staffProfile) {
        return staffProfile.campusId;
      }
    }
    if (role === PrismaUserRole.GUARDIAN) {
      const guardian = await this.prisma.guardian.findUnique({
        where: { userId },
      });
      if (!guardian) {
        throw new ConflictException(
          'This account has no guardian profile yet — create one under People → Guardians.',
        );
      }
      return guardian.campusId;
    }
    const assignment = await this.prisma.userCampus.findFirst({
      where: { userId },
    });
    if (!assignment) {
      throw new ConflictException(
        'This account is not assigned to any campus yet — assign it under Campuses → Manage Users, then punch again.',
      );
    }
    return assignment.campusId;
  }

  private async assertAttendanceActor(
    currentUser: CurrentUser,
    targetUserId: string,
  ) {
    const isPrivileged = await this.isAttendancePrivileged(currentUser);

    if (!isPrivileged && currentUser.sub !== targetUserId) {
      throw new ForbiddenException('You can only manage your own attendance.');
    }
  }

  private async assertAttendanceRecordAccess(
    currentUser: CurrentUser,
    record: {
      campusId: string;
      userId: string;
    },
  ) {
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      record.campusId,
    );

    const isPrivileged = await this.isAttendancePrivileged(currentUser);
    if (!isPrivileged && currentUser.sub !== record.userId) {
      throw new ForbiddenException(
        'You can only view your own attendance records.',
      );
    }
  }

  private async buildAttendanceWhere(
    currentUser: CurrentUser,
    query: ListAttendanceQueryDto,
  ) {
    const effectiveUserId = await this.resolveScopedAttendanceUserId(
      currentUser,
      query.userId,
    );
    const campusIds = query.campusId
      ? await this.campusAccessService.getScopedCampusIds(
          currentUser,
          query.campusId,
        )
      : currentUser.role === UserRole.SUPERADMIN
        ? undefined
        : await this.campusAccessService.getCampusIdsForUser(currentUser);

    const dateFilter = query.date ? this.toDateOnly(query.date) : undefined;
    const dateFrom = query.dateFrom
      ? this.toDateOnly(query.dateFrom)
      : undefined;
    const dateTo = query.dateTo ? this.toDateOnly(query.dateTo) : undefined;

    return {
      ...(query.campusId ? { campusId: query.campusId } : {}),
      ...(campusIds ? { campusId: { in: campusIds } } : {}),
      ...(effectiveUserId ? { userId: effectiveUserId } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.periodId ? { periodId: query.periodId } : {}),
      ...(dateFilter
        ? { date: dateFilter }
        : dateFrom || dateTo
          ? {
              date: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
    };
  }

  private async resolveScopedAttendanceUserId(
    currentUser: CurrentUser,
    requestedUserId?: string,
  ) {
    const isPrivileged = await this.isAttendancePrivileged(currentUser);

    if (isPrivileged) {
      return requestedUserId;
    }

    if (requestedUserId && requestedUserId !== currentUser.sub) {
      throw new ForbiddenException(
        'You can only view your own attendance records.',
      );
    }

    return currentUser.sub;
  }

  private async resolveHalfDayStatus(
    campusId: string,
    role: PrismaUserRole,
    date: Date,
    checkOut?: Date,
  ) {
    if (!checkOut) {
      return false;
    }

    const campus = await this.prisma.campus.findUniqueOrThrow({
      where: { id: campusId },
    });
    const officialEnd =
      role === PrismaUserRole.STUDENT
        ? campus.studentEndTime
        : campus.staffEndTime;
    const datePart = date.toISOString().slice(0, 10);
    const threshold = new Date(`${datePart}T${officialEnd}.000Z`);
    threshold.setUTCMinutes(
      threshold.getUTCMinutes() - campus.earlyLeaveThreshold,
    );

    return checkOut < threshold;
  }

  /** Guardians and superadmins are not attendance subjects. */
  private assertAttendanceSubject(role: PrismaUserRole) {
    if (
      role === PrismaUserRole.GUARDIAN ||
      role === PrismaUserRole.SUPERADMIN
    ) {
      throw new ConflictException(
        `${role.toLowerCase()} accounts do not have attendance records.`,
      );
    }
  }

  private toDateOnly(value: string | Date) {
    const date = value instanceof Date ? value : new Date(value);
    return new Date(date.toISOString().slice(0, 10));
  }

  /**
   * Reads the `attendance` InstitutionSetting (§ 5.3, § 7.2), following the
   * exact existing convention of `payroll.perDayBasis`
   * (FinanceService.resolvePerDayBasis) / `student_admission`
   * (PeopleService.resolveRegNoSettings): same generic settings table,
   * defaulting to DAILY when unset or malformed. Public — the scheduler
   * calls this directly to branch its auto-absent sweep per institution.
   *
   * @param {string | null} institutionId - Target institution id. Null (a campus not yet linked to an institution) fails safe to DAILY.
   * @returns {Promise<AttendanceMode>}
   */
  async resolveAttendanceMode(
    institutionId: string | null,
  ): Promise<AttendanceMode> {
    if (!institutionId) {
      return 'DAILY';
    }

    const setting = await this.prisma.institutionSetting.findUnique({
      where: {
        institutionId_key_activeScopeKey: {
          institutionId,
          key: 'attendance',
          activeScopeKey: 'ACTIVE',
        },
      },
      select: { value: true },
    });

    const value = setting?.value as { mode?: unknown } | undefined;
    return value?.mode === 'PERIOD' ? 'PERIOD' : 'DAILY';
  }

  /**
   * Resolves a campus's institutionId — the FK hop attendance mode
   * resolution needs but bulk/period marking doesn't otherwise look up.
   * Never trusted from the client, matching this codebase's "resolve scope
   * server-side" convention (see TimetableService.resolveSectionScope).
   *
   * @param {string} campusId
   * @returns {Promise<string | null>} Null for the rare not-yet-linked campus (see resolveAttendanceMode's fail-safe default).
   */
  private async resolveInstitutionIdForCampus(
    campusId: string,
  ): Promise<string | null> {
    const campus = await this.prisma.campus.findUniqueOrThrow({
      where: { id: campusId },
      select: { institutionId: true },
    });
    return campus.institutionId;
  }

  /**
   * Resolves a period slot's roster: the enrolled ACTIVE students for its
   * (classId, sectionId) at the institution's current academic year.
   * Mirrors PeopleService.attachCurrentEnrollment's resolution shape
   * (institution.currentAcademicYearId, then a StudentEnrollment lookup at
   * that year) rather than re-deriving it — same "no current academic year
   * = empty result" convention, never a throw. Shared by getPeriodRoster(),
   * bulkMark()'s period-membership check, and markPeriodAbsentees().
   *
   * @param {{classId: string, sectionId: string}} periodSlot
   * @param {string | null} institutionId
   * @returns {Promise<PeriodRosterStudent[]>}
   */
  private async resolvePeriodRosterStudents(
    periodSlot: { classId: string; sectionId: string },
    institutionId: string | null,
  ): Promise<PeriodRosterStudent[]> {
    if (!institutionId) {
      return [];
    }

    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { currentAcademicYearId: true },
    });
    if (!institution?.currentAcademicYearId) {
      return [];
    }

    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        classId: periodSlot.classId,
        sectionId: periodSlot.sectionId,
        academicYearId: institution.currentAcademicYearId,
        status: EnrollmentStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        student: {
          select: {
            id: true,
            userId: true,
            regNo: true,
            user: { select: { name: true } },
          },
        },
      },
    });

    return enrollments.map((enrollment) => ({
      studentId: enrollment.student.id,
      userId: enrollment.student.userId,
      name: enrollment.student.user.name,
      regNo: enrollment.student.regNo,
    }));
  }
}
