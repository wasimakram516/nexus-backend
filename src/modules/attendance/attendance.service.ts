import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceStatus as PrismaAttendanceStatus,
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
  UpdateAttendanceRecordDto,
} from './dto/attendance.dto';

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
   * Register-style marking: upserts one attendance row per valid entry for
   * the campus/date. Invalid entries are skipped and reported, never fatal.
   * Punch times (checkIn/checkOut) are facts — bulk marking never touches them.
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
      valid.push({
        userId: entry.userId,
        role: user.role,
        status: entry.status,
        halfDay: entry.halfDay,
        remarks: entry.remarks,
      });
    }

    // Deterministic order; each upsert is an atomic ON CONFLICT DO UPDATE,
    // so no wrapping transaction is needed (audit side-queries stay short).
    valid.sort((a, b) => a.userId.localeCompare(b.userId));

    for (const entry of valid) {
      await this.prisma.attendance.upsert({
        where: {
          userId_campusId_date_activeScopeKey: {
            userId: entry.userId,
            campusId: dto.campusId,
            date: day,
            activeScopeKey: 'ACTIVE',
          },
        },
        create: {
          userId: entry.userId,
          role: entry.role,
          campusId: dto.campusId,
          date: day,
          status: entry.status,
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
}
