import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceService } from './attendance.service';

describe('AttendanceService', () => {
  let service: AttendanceService;

  const teacherUser: CurrentUser = {
    sub: 'teacher-user-1',
    email: 'teacher@nexus.test',
    role: UserRole.STAFF,
    institutionId: 'institution-1',
  };

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
    },
    teacher: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
    },
    student: {
      findMany: jest.fn(),
    },
    userCampus: {
      findMany: jest.fn(),
    },
    campus: {
      findUniqueOrThrow: jest.fn(),
    },
    attendance: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const campusAccessServiceMock = {
    getScopedCampusIds: jest.fn(),
    getCampusIdsForUser: jest.fn(),
    assertCampusAccess: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AttendanceService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: CampusAccessService,
          useValue: campusAccessServiceMock,
        },
        {
          provide: ModuleAccessService,
          useValue: {
            assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: UserPermissionsService,
          useValue: {
            can: jest.fn().mockResolvedValue(false),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<AttendanceService>(AttendanceService);
  });

  it('blocks non-privileged users from viewing other users attendance', async () => {
    await expect(
      service.listAttendance(teacherUser, { userId: 'student-user-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes attendance listing to the current non-privileged user', async () => {
    campusAccessServiceMock.getCampusIdsForUser.mockResolvedValue(['campus-1']);
    prismaMock.attendance.findMany.mockResolvedValue([
      { id: 'attendance-1', campusId: 'campus-1', userId: 'teacher-user-1' },
    ]);

    const result = await service.listAttendance(teacherUser, {});

    expect(prismaMock.attendance.findMany).toHaveBeenCalledWith({
      where: {
        campusId: { in: ['campus-1'] },
        userId: 'teacher-user-1',
      },
      orderBy: { date: 'desc' },
    });
    expect(result).toMatchObject({
      message: 'Attendance retrieved successfully',
      data: [{ id: 'attendance-1', campusId: 'campus-1' }],
    });
  });

  it('retrieves an attendance record when the user has access to the campus and user', async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({
      id: 'attendance-1',
      campusId: 'campus-1',
      userId: 'teacher-user-1',
    });
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');

    const result = await service.getAttendanceRecord(
      teacherUser,
      'attendance-1',
    );

    expect(result).toMatchObject({
      message: 'Attendance record retrieved successfully',
      data: {
        id: 'attendance-1',
        campusId: 'campus-1',
      },
    });
  });

  it('returns an attendance summary for the scoped query', async () => {
    campusAccessServiceMock.getCampusIdsForUser.mockResolvedValue(['campus-1']);
    prismaMock.attendance.findMany.mockResolvedValue([
      {
        status: 'PRESENT',
        halfDay: false,
        checkIn: new Date('2026-05-07T08:00:00.000Z'),
        checkOut: new Date('2026-05-07T16:00:00.000Z'),
      },
      {
        status: 'LATE',
        halfDay: true,
        checkIn: new Date('2026-05-08T09:00:00.000Z'),
        checkOut: null,
      },
    ]);

    const result = await service.getAttendanceSummary(teacherUser, {
      dateFrom: '2026-05-01',
      dateTo: '2026-05-31',
    });

    expect(prismaMock.attendance.findMany).toHaveBeenCalledWith({
      where: {
        campusId: { in: ['campus-1'] },
        userId: 'teacher-user-1',
        date: {
          gte: new Date('2026-05-01T00:00:00.000Z'),
          lte: new Date('2026-05-31T00:00:00.000Z'),
        },
      },
      select: {
        status: true,
        halfDay: true,
        checkIn: true,
        checkOut: true,
      },
    });
    expect(result).toMatchObject({
      message: 'Attendance summary retrieved successfully',
      data: {
        totalRecords: 2,
        presentCount: 1,
        lateCount: 1,
        absentCount: 0,
        leaveCount: 0,
        halfDayCount: 1,
        checkedInCount: 2,
        checkedOutCount: 1,
      },
    });
  });

  it('updates an attendance record and recalculates half-day when check-out changes', async () => {
    const adminUser: CurrentUser = {
      sub: 'admin-1',
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
      institutionId: 'institution-1',
    };

    prismaMock.attendance.findUnique.mockResolvedValue({
      id: 'attendance-1',
      campusId: 'campus-1',
      userId: 'teacher-user-1',
      role: UserRole.STAFF,
      date: new Date('2026-05-07T00:00:00.000Z'),
      checkOut: null,
    });
    prismaMock.campus.findUniqueOrThrow.mockResolvedValue({
      id: 'campus-1',
      studentEndTime: '13:00:00',
      staffEndTime: '17:00:00',
      earlyLeaveThreshold: 30,
    });
    prismaMock.attendance.update.mockResolvedValue({
      id: 'attendance-1',
      campusId: 'campus-1',
      userId: 'teacher-user-1',
      halfDay: true,
      remarks: 'Left early',
    });
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');

    const result = await service.updateAttendanceRecord(
      adminUser,
      'attendance-1',
      {
        checkOut: '2026-05-07T16:00:00.000Z',
        remarks: 'Left early',
      },
    );

    expect(prismaMock.attendance.update).toHaveBeenCalledWith({
      where: { id: 'attendance-1' },
      data: {
        checkOut: new Date('2026-05-07T16:00:00.000Z'),
        halfDay: true,
        remarks: 'Left early',
      },
    });
    expect(result).toMatchObject({
      message: 'Attendance record updated successfully',
      data: {
        id: 'attendance-1',
        halfDay: true,
      },
    });
  });

  it('bulk-marks valid entries and skips guardians and non-members with reasons', async () => {
    const adminUser: CurrentUser = {
      sub: 'admin-1',
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
      institutionId: 'institution-1',
    };

    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'student-user-1', role: UserRole.STUDENT },
      { id: 'guardian-user-1', role: UserRole.GUARDIAN },
      { id: 'teacher-user-9', role: UserRole.STAFF },
    ]);
    prismaMock.student.findMany.mockResolvedValue([
      { userId: 'student-user-1' },
    ]);
    prismaMock.teacher.findMany.mockResolvedValue([]);
    prismaMock.userCampus.findMany.mockResolvedValue([]);
    prismaMock.attendance.upsert.mockResolvedValue({ id: 'attendance-1' });

    const result = await service.bulkMark(adminUser, {
      campusId: 'campus-1',
      date: '2026-06-12',
      entries: [
        { userId: 'student-user-1', status: 'PRESENT' as never },
        { userId: 'student-user-1', status: 'ABSENT' as never },
        { userId: 'guardian-user-1', status: 'PRESENT' as never },
        { userId: 'teacher-user-9', status: 'LATE' as never },
        { userId: 'missing-user-1', status: 'PRESENT' as never },
      ],
    });

    expect(prismaMock.attendance.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.attendance.upsert).toHaveBeenCalledWith({
      where: {
        userId_campusId_date_activeScopeKey: {
          userId: 'student-user-1',
          campusId: 'campus-1',
          date: new Date('2026-06-12'),
          activeScopeKey: 'ACTIVE',
        },
      },
      create: {
        userId: 'student-user-1',
        role: UserRole.STUDENT,
        campusId: 'campus-1',
        date: new Date('2026-06-12'),
        status: 'PRESENT',
      },
      update: {
        status: 'PRESENT',
      },
    });
    expect(result).toMatchObject({
      message: 'Attendance marked successfully',
      data: {
        marked: 1,
        skipped: expect.arrayContaining([
          { userId: 'student-user-1', reason: 'DUPLICATE_ENTRY' },
          { userId: 'guardian-user-1', reason: 'ROLE_NOT_ALLOWED' },
          { userId: 'teacher-user-9', reason: 'NOT_IN_CAMPUS' },
          { userId: 'missing-user-1', reason: 'USER_NOT_FOUND' },
        ]),
      },
    });
  });

  it('blocks duplicate check-in records for the same user and date', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'teacher-user-1',
      role: UserRole.STAFF,
    });
    prismaMock.teacher.findUnique.mockResolvedValue({
      userId: 'teacher-user-1',
      campusId: 'campus-1',
    });
    prismaMock.campus.findUniqueOrThrow.mockResolvedValue({
      id: 'campus-1',
      studentStartTime: '08:00:00',
      staffStartTime: '08:00:00',
      lateThreshold: 15,
    });
    prismaMock.attendance.findFirst.mockResolvedValue({
      id: 'attendance-1',
      userId: 'teacher-user-1',
      campusId: 'campus-1',
    });
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');

    await expect(
      service.checkIn(teacherUser, {
        userId: 'teacher-user-1',
        date: '2026-05-08',
        checkIn: '2026-05-08T08:05:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
