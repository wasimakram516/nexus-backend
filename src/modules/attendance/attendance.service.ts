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
  UserStatus as PrismaUserStatus,
} from '../../prisma/client';
import { AttendanceStatus } from '../../common/enums/domain.enums';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { CustomFieldEntity } from '../../common/constants/custom-field-entities.constants';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { WorkingDayResolverService } from '../../common/services/working-day-resolver.service';
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
    private readonly entityCustomFieldsService: EntityCustomFieldsService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly userPermissionsService: UserPermissionsService,
    private readonly timezoneResolver: TimezoneResolverService,
    private readonly workingDayResolver: WorkingDayResolverService,
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
    const timezone = await this.timezoneResolver.resolveForCampus(campusId);
    const lateThresholdTime = this.timezoneResolver.zonedTimeToInstant(
      timezone,
      dto.date,
      officialStart,
    );
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

    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        campusId,
      );
    const { customFields, ...checkInFields } = dto;
    const item = await this.entityCustomFieldsService.saveRecord(
      {
        institutionId,
        moduleKey: ModuleKey.ATTENDANCE,
        entityType: CustomFieldEntity.ATTENDANCE,
        values: customFields,
        create: true,
      },
      (transaction) =>
        transaction.attendance.create({
          data: {
            userId: checkInFields.userId,
            role: user.role,
            campusId,
            date: new Date(checkInFields.date),
            checkIn: new Date(checkInFields.checkIn),
            remarks: checkInFields.remarks,
            status,
          },
        }),
    );
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.ATTENDANCE,
    );
    return { message: 'Check-in recorded successfully', data };
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
    const checkOutTimezone =
      await this.timezoneResolver.resolveForCampus(campusId);
    const threshold = this.timezoneResolver.zonedTimeToInstant(
      checkOutTimezone,
      dto.date,
      officialEnd,
    );
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
   *
   * P0-6 (§ 6.1 of P0-6-7-9-CORRECTIVE-DESIGN.md): roster is now built from
   * active enrollment/employment state instead of raw UserCampus
   * membership — GUARDIAN/SUPERADMIN are excluded by construction (neither
   * archetype is touched by either candidate query below), RESIGNED/
   * SUSPENDED accounts and withdrawn (non-ACTIVE) student enrollments are
   * excluded, and STUDENT rows are omitted entirely in PERIOD-mode
   * institutions (their whole-day obligation is expressed at period
   * granularity by markPeriodAbsentees, not the daily key) while STAFF/
   * ADMIN stay DAILY regardless of mode (§ 9's locked design call).
   *
   * P0-6 (§ 6.1) + P0-9 (§ 7.2 / § 7.3): also gated on the campus's local
   * working-day/closure calendar (fail-closed when unconfigured — a
   * deliberate product decision, see WorkingDayResolverService), and writes
   * via `createMany({ skipDuplicates: true })` so overlapping sweep runs or
   * a manual mark that lands first never throws on the unique-index
   * collision and never overwrite an existing row (an upsert here would be
   * wrong — see § 7.3 of the design doc).
   *
   * @param {string} campusId
   * @param {string} date - Date-only string ("YYYY-MM-DD"), the campus's
   *   already-resolved local date (the scheduler resolves this per campus;
   *   the manual autoMarkAbsent() endpoint passes whatever the caller sent).
   * @returns {Promise<{message: string, data: {count: number}}>}
   */
  async markCampusAbsentees(campusId: string, date: string) {
    const institutionId = await this.resolveInstitutionIdForCampus(campusId);
    const mode = await this.resolveAttendanceMode(institutionId);

    if (institutionId) {
      const timezone = await this.timezoneResolver.resolveForCampus(campusId);
      const localDate = this.timezoneResolver.localDateString(timezone);
      const localDayOfWeek = this.timezoneResolver.localDayOfWeek(timezone);
      const isWorking = await this.workingDayResolver.isWorkingDay(
        institutionId,
        campusId,
        localDate,
        localDayOfWeek,
      );
      if (!isWorking) {
        return {
          message: 'No absences generated — not a working day',
          data: { count: 0 },
        };
      }
    }

    // STAFF/ADMIN: always DAILY, regardless of institution mode. Active
    // employment = User.status ACTIVE + a live, non-deleted UserCampus
    // assignment at this campus (covers both StaffProfile-holding teaching
    // staff and UserCampus-only non-teaching staff/campus admins).
    const staffCandidates = await this.prisma.userCampus.findMany({
      where: {
        campusId,
        deletedAt: null,
        user: {
          deletedAt: null,
          status: PrismaUserStatus.ACTIVE,
          role: { in: [PrismaUserRole.STAFF, PrismaUserRole.ADMIN] },
        },
      },
      select: { userId: true, user: { select: { role: true } } },
    });

    // STUDENT: only in DAILY mode. Roster is active enrollment, not
    // UserCampus membership — mirrors resolvePeriodRosterStudents's
    // "current academic year, ACTIVE status" resolution, applied
    // campus-wide instead of section-scoped.
    let studentCandidates: { userId: string }[] = [];
    if (mode === 'DAILY' && institutionId) {
      const institution = await this.prisma.institution.findUnique({
        where: { id: institutionId },
        select: { currentAcademicYearId: true },
      });
      if (institution?.currentAcademicYearId) {
        const enrollments = await this.prisma.studentEnrollment.findMany({
          where: {
            campusId,
            academicYearId: institution.currentAcademicYearId,
            status: EnrollmentStatus.ACTIVE,
            deletedAt: null,
            student: {
              deletedAt: null,
              user: { deletedAt: null, status: PrismaUserStatus.ACTIVE },
            },
          },
          select: { student: { select: { userId: true } } },
        });
        studentCandidates = enrollments.map((e) => ({
          userId: e.student.userId,
        }));
      }
      // No current academic year configured => empty roster, same
      // fail-safe convention as resolvePeriodRosterStudents — never throws.
    }

    const candidates = [
      ...staffCandidates.map((c) => ({ userId: c.userId, role: c.user.role })),
      ...studentCandidates.map((c) => ({
        userId: c.userId,
        role: PrismaUserRole.STUDENT,
      })),
    ];

    if (!candidates.length) {
      return {
        message: 'Absent users marked successfully',
        data: { count: 0 },
      };
    }

    const day = this.toDateOnly(date);
    const existing = await this.prisma.attendance.findMany({
      where: {
        campusId,
        date: day,
        userId: { in: candidates.map((c) => c.userId) },
      },
      select: { userId: true },
    });
    const existingIds = new Set(existing.map((item) => item.userId));

    const data = candidates
      .filter((c) => !existingIds.has(c.userId))
      .map((c) => ({
        userId: c.userId,
        role: c.role,
        campusId,
        date: day,
        status: AttendanceStatus.ABSENT,
      }));

    let created = 0;
    if (data.length) {
      // P0-9 (§ 7.3): skipDuplicates tolerates an overlapping sweep run or
      // a manual mark that landed between the existingIds read above and
      // this write, without failing the whole batch or overwriting the row
      // that won the race.
      const result = await this.prisma.attendance.createMany({
        data,
        skipDuplicates: true,
      });
      created = result.count;
    }

    return {
      message: 'Absent users marked successfully',
      data: { count: created },
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

    let periodCreated = 0;
    if (data.length) {
      // P0-9 (§ 7.3): same skipDuplicates rationale as markCampusAbsentees —
      // overlapping period sweeps or a manual mark must not throw or
      // overwrite.
      const result = await this.prisma.attendance.createMany({
        data,
        skipDuplicates: true,
      });
      periodCreated = result.count;
    }

    return {
      message: 'Absent students marked successfully',
      data: { count: periodCreated },
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
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.ATTENDANCE,
    );
    return { message: 'Attendance retrieved successfully', data };
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

    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.ATTENDANCE,
    );
    return { message: 'Attendance record retrieved successfully', data };
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

    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        existing.campusId,
      );
    const { customFields, ...updateFields } = dto;
    const halfDay = updateFields.checkOut
      ? await this.resolveHalfDayStatus(
          existing.campusId,
          existing.role,
          nextDate,
          nextCheckOut,
        )
      : undefined;

    const item = await this.entityCustomFieldsService.saveRecord(
      {
        institutionId,
        moduleKey: ModuleKey.ATTENDANCE,
        entityType: CustomFieldEntity.ATTENDANCE,
        values: customFields,
        create: false,
      },
      (transaction) =>
        transaction.attendance.update({
          where: { id: attendanceId },
          data: {
            ...(updateFields.date ? { date: nextDate } : {}),
            ...(updateFields.checkIn
              ? { checkIn: new Date(updateFields.checkIn) }
              : {}),
            ...(updateFields.checkOut
              ? { checkOut: nextCheckOut, halfDay }
              : {}),
            ...(updateFields.status ? { status: updateFields.status } : {}),
            ...(updateFields.halfDay !== undefined
              ? { halfDay: updateFields.halfDay }
              : {}),
            ...(updateFields.remarks !== undefined
              ? { remarks: updateFields.remarks }
              : {}),
          },
        }),
    );

    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.ATTENDANCE,
    );
    return { message: 'Attendance record updated successfully', data };
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
    const timezone = await this.timezoneResolver.resolveForCampus(campusId);
    const datePart = date.toISOString().slice(0, 10);
    const threshold = this.timezoneResolver.zonedTimeToInstant(
      timezone,
      datePart,
      officialEnd,
    );
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
