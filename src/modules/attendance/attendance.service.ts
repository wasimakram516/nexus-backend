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
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AutoAbsentDto,
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
  ) {}

  async checkIn(currentUser: CurrentUser, dto: CheckInDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );
    this.assertAttendanceActor(currentUser, dto.userId);
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) throw new NotFoundException('User not found.');

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
    this.assertAttendanceActor(currentUser, dto.userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: dto.userId },
    });
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
    const users = await this.prisma.userCampus.findMany({
      where: { campusId: dto.campusId },
      include: { user: true },
    });
    const existing = await this.prisma.attendance.findMany({
      where: { campusId: dto.campusId, date: new Date(dto.date) },
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
        campusId: dto.campusId,
        date: new Date(dto.date),
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
      const student = await this.prisma.student.findUniqueOrThrow({
        where: { userId },
      });
      return student.campusId;
    }
    if (role === PrismaUserRole.TEACHER) {
      const teacher = await this.prisma.teacher.findUniqueOrThrow({
        where: { userId },
      });
      return teacher.campusId;
    }
    if (role === PrismaUserRole.GUARDIAN) {
      const guardian = await this.prisma.guardian.findUniqueOrThrow({
        where: { userId },
      });
      return guardian.campusId;
    }
    const assignment = await this.prisma.userCampus.findFirstOrThrow({
      where: { userId },
    });
    return assignment.campusId;
  }

  private assertAttendanceActor(
    currentUser: CurrentUser,
    targetUserId: string,
  ) {
    const isPrivileged =
      currentUser.role === UserRole.SUPERADMIN ||
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.ACCOUNTANT;

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

    if (
      currentUser.role !== UserRole.SUPERADMIN &&
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.ACCOUNTANT &&
      currentUser.sub !== record.userId
    ) {
      throw new ForbiddenException(
        'You can only view your own attendance records.',
      );
    }
  }

  private async buildAttendanceWhere(
    currentUser: CurrentUser,
    query: ListAttendanceQueryDto,
  ) {
    const effectiveUserId = this.resolveScopedAttendanceUserId(
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

  private resolveScopedAttendanceUserId(
    currentUser: CurrentUser,
    requestedUserId?: string,
  ) {
    const isPrivileged =
      currentUser.role === UserRole.SUPERADMIN ||
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.ACCOUNTANT;

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

  private toDateOnly(value: string | Date) {
    const date = value instanceof Date ? value : new Date(value);
    return new Date(date.toISOString().slice(0, 10));
  }
}
