import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
    staffProfile: {
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
    institutionSetting: {
      findUnique: jest.fn(),
    },
    institution: {
      findUnique: jest.fn(),
    },
    periodSlot: {
      findFirst: jest.fn(),
    },
    studentEnrollment: {
      findMany: jest.fn(),
    },
    attendance: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
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
    prismaMock.campus.findUniqueOrThrow.mockResolvedValue({
      institutionId: 'institution-1',
    });
    // No `attendance` InstitutionSetting row -> resolveAttendanceMode()
    // defaults to DAILY, matching this test's no-periodId call.
    prismaMock.institutionSetting.findUnique.mockResolvedValue(undefined);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'student-user-1', role: UserRole.STUDENT },
      { id: 'guardian-user-1', role: UserRole.GUARDIAN },
      { id: 'teacher-user-9', role: UserRole.STAFF },
    ]);
    prismaMock.student.findMany.mockResolvedValue([
      { userId: 'student-user-1' },
    ]);
    prismaMock.staffProfile.findMany.mockResolvedValue([]);
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
        userId_campusId_date_periodKey_activeScopeKey: {
          userId: 'student-user-1',
          campusId: 'campus-1',
          date: new Date('2026-06-12'),
          periodKey: 'DAILY',
          activeScopeKey: 'ACTIVE',
        },
      },
      create: {
        userId: 'student-user-1',
        role: UserRole.STUDENT,
        campusId: 'campus-1',
        date: new Date('2026-06-12'),
        status: 'PRESENT',
        periodKey: 'DAILY',
      },
      update: {
        status: 'PRESENT',
      },
    });
    expect(result).toMatchObject({
      message: 'Attendance marked successfully',
      data: {
        marked: 1,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.arrayContaining() is intentionally typed `any` by @types/jest
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
    prismaMock.staffProfile.findUnique.mockResolvedValue({
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

  describe('Attendance dual mode (§ 5.3)', () => {
    const adminUser: CurrentUser = {
      sub: 'admin-1',
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
      institutionId: 'institution-1',
    };

    /** Shape of the compound-unique `where` key bulkMark()'s upsert uses.
     *  `prismaMock.attendance.upsert` is an untyped jest.fn(), so its
     *  `.mock.calls` are `any[][]` by construction (a @types/jest
     *  limitation, same category as this file's existing
     *  `expect.arrayContaining()` any-typing) — this single cast keeps that
     *  contained instead of sprinkling eslint-disable comments per call site. */
    interface UpsertWhereKey {
      userId: string;
      campusId: string;
      date: Date;
      periodKey: string;
      activeScopeKey: string;
    }
    const getUpsertCall = (
      callIndex: number,
    ): {
      where: { userId_campusId_date_periodKey_activeScopeKey: UpsertWhereKey };
      create: { periodId?: string };
    } =>
      (
        prismaMock.attendance.upsert.mock.calls as unknown as Array<
          [
            {
              where: {
                userId_campusId_date_periodKey_activeScopeKey: UpsertWhereKey;
              };
              create: { periodId?: string };
            },
          ]
        >
      )[callIndex][0];

    beforeEach(() => {
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      prismaMock.campus.findUniqueOrThrow.mockResolvedValue({
        institutionId: 'institution-1',
      });
      prismaMock.staffProfile.findMany.mockResolvedValue([]);
      prismaMock.userCampus.findMany.mockResolvedValue([]);
      prismaMock.attendance.upsert.mockResolvedValue({ id: 'attendance-1' });
    });

    it('autoMarkAbsent falls back to the campus-wide sweep when no periodId is given', async () => {
      const result = {
        message: 'Absent users marked successfully',
        data: { count: 2 },
      };
      prismaMock.attendance.findMany.mockResolvedValue([]);
      prismaMock.userCampus.findMany.mockResolvedValue([]);
      const markCampusAbsenteesSpy = jest
        .spyOn(service, 'markCampusAbsentees')
        .mockResolvedValue(result);

      const response = await service.autoMarkAbsent(adminUser, {
        campusId: 'campus-1',
        date: '2026-06-12',
      });

      expect(markCampusAbsenteesSpy).toHaveBeenCalledWith(
        'campus-1',
        '2026-06-12',
      );
      expect(response).toBe(result);
    });

    it('autoMarkAbsent branches to markPeriodAbsentees and resolves campus access from the period slot itself, not the client-supplied campusId', async () => {
      const result = {
        message: 'Absent students marked successfully',
        data: { count: 1 },
      };
      prismaMock.periodSlot.findFirst.mockResolvedValue({
        campusId: 'campus-1',
      });
      const markPeriodAbsenteesSpy = jest
        .spyOn(service, 'markPeriodAbsentees')
        .mockResolvedValue(result);

      const response = await service.autoMarkAbsent(adminUser, {
        campusId: 'campus-1',
        date: '2026-06-12',
        periodId: 'period-1',
      });

      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        adminUser,
        'campus-1',
      );
      expect(markPeriodAbsenteesSpy).toHaveBeenCalledWith(
        'period-1',
        '2026-06-12',
      );
      expect(response).toBe(result);
    });

    it('autoMarkAbsent throws NotFoundException when periodId does not resolve to a period slot', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue(null);

      await expect(
        service.autoMarkAbsent(adminUser, {
          campusId: 'campus-1',
          date: '2026-06-12',
          periodId: 'missing-period',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('keys two DAILY-mode marks for the same user/day with the identical, non-null periodKey tuple (the central design finding: periodKey — not a nullable periodId — is what must sit in the unique constraint, since Postgres treats every NULL as distinct and two periodId=null rows would never collide)', async () => {
      prismaMock.institutionSetting.findUnique.mockResolvedValue(undefined); // DAILY default
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'student-user-1', role: UserRole.STUDENT },
      ]);
      prismaMock.student.findMany.mockResolvedValue([
        { userId: 'student-user-1' },
      ]);

      await service.bulkMark(adminUser, {
        campusId: 'campus-1',
        date: '2026-06-12',
        entries: [{ userId: 'student-user-1', status: 'PRESENT' as never }],
      });
      await service.bulkMark(adminUser, {
        campusId: 'campus-1',
        date: '2026-06-12',
        entries: [{ userId: 'student-user-1', status: 'ABSENT' as never }],
      });

      expect(prismaMock.attendance.upsert).toHaveBeenCalledTimes(2);
      const firstKey =
        getUpsertCall(0).where.userId_campusId_date_periodKey_activeScopeKey;
      const secondKey =
        getUpsertCall(1).where.userId_campusId_date_periodKey_activeScopeKey;

      // Same tuple both times -> these would collide as the same row under
      // Postgres's real unique index, exactly the DAILY-mode invariant
      // (one row per user per day) this design exists to preserve.
      expect(firstKey).toEqual(secondKey);
      expect(firstKey.periodKey).toBe('DAILY');
      expect(firstKey).not.toHaveProperty('periodId');
    });

    it('gives two different periods the same day genuinely different periodKey tuples, so PERIOD mode can carry one row per period', async () => {
      prismaMock.institutionSetting.findUnique.mockResolvedValue({
        value: { mode: 'PERIOD' },
      });
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'student-user-1', role: UserRole.STUDENT },
      ]);
      prismaMock.student.findMany.mockResolvedValue([
        { userId: 'student-user-1' },
      ]);
      prismaMock.periodSlot.findFirst
        .mockResolvedValueOnce({
          id: 'period-1',
          campusId: 'campus-1',
          classId: 'class-1',
          sectionId: 'section-1',
        })
        .mockResolvedValueOnce({
          id: 'period-2',
          campusId: 'campus-1',
          classId: 'class-1',
          sectionId: 'section-1',
        });
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        {
          student: {
            id: 'student-1',
            userId: 'student-user-1',
            regNo: 'REG-1',
            user: { name: 'Student One' },
          },
        },
      ]);

      await service.bulkMark(adminUser, {
        campusId: 'campus-1',
        date: '2026-06-12',
        periodId: 'period-1',
        entries: [{ userId: 'student-user-1', status: 'PRESENT' as never }],
      });
      await service.bulkMark(adminUser, {
        campusId: 'campus-1',
        date: '2026-06-12',
        periodId: 'period-2',
        entries: [{ userId: 'student-user-1', status: 'PRESENT' as never }],
      });

      const firstKey =
        getUpsertCall(0).where.userId_campusId_date_periodKey_activeScopeKey;
      const secondKey =
        getUpsertCall(1).where.userId_campusId_date_periodKey_activeScopeKey;

      expect(firstKey.periodKey).toBe('period-1');
      expect(secondKey.periodKey).toBe('period-2');
      expect(firstKey).not.toEqual(secondKey);
      expect(getUpsertCall(0).create.periodId).toBe('period-1');
    });

    it('rejects periodId on bulk marking when the institution is DAILY mode', async () => {
      prismaMock.institutionSetting.findUnique.mockResolvedValue(undefined);

      await expect(
        service.bulkMark(adminUser, {
          campusId: 'campus-1',
          date: '2026-06-12',
          periodId: 'period-1',
          entries: [{ userId: 'student-user-1', status: 'PRESENT' as never }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.attendance.upsert).not.toHaveBeenCalled();
    });

    it('requires periodId for student entries when the institution is PERIOD mode', async () => {
      prismaMock.institutionSetting.findUnique.mockResolvedValue({
        value: { mode: 'PERIOD' },
      });
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'student-user-1', role: UserRole.STUDENT },
      ]);

      await expect(
        service.bulkMark(adminUser, {
          campusId: 'campus-1',
          date: '2026-06-12',
          entries: [{ userId: 'student-user-1', status: 'PRESENT' as never }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.attendance.upsert).not.toHaveBeenCalled();
    });

    it('allows staff-only bulk marking in PERIOD mode without periodId, keeping staff DAILY-keyed (§ 9 design call: staff attendance is unaffected by this feature)', async () => {
      prismaMock.institutionSetting.findUnique.mockResolvedValue({
        value: { mode: 'PERIOD' },
      });
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'teacher-user-9', role: UserRole.STAFF },
      ]);
      prismaMock.student.findMany.mockResolvedValue([]);
      prismaMock.staffProfile.findMany.mockResolvedValue([
        { userId: 'teacher-user-9' },
      ]);

      const result = await service.bulkMark(adminUser, {
        campusId: 'campus-1',
        date: '2026-06-12',
        entries: [{ userId: 'teacher-user-9', status: 'PRESENT' as never }],
      });

      expect(result.data.marked).toBe(1);
      expect(
        getUpsertCall(0).where.userId_campusId_date_periodKey_activeScopeKey
          .periodKey,
      ).toBe('DAILY');
    });

    it('skips a student not enrolled in the period slot roster with NOT_IN_PERIOD_ROSTER', async () => {
      prismaMock.institutionSetting.findUnique.mockResolvedValue({
        value: { mode: 'PERIOD' },
      });
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'student-user-1', role: UserRole.STUDENT },
      ]);
      prismaMock.student.findMany.mockResolvedValue([
        { userId: 'student-user-1' },
      ]);
      prismaMock.periodSlot.findFirst.mockResolvedValue({
        id: 'period-1',
        campusId: 'campus-1',
        classId: 'class-1',
        sectionId: 'section-1',
      });
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      // Roster comes back empty -> student-user-1 is not on it.
      prismaMock.studentEnrollment.findMany.mockResolvedValue([]);

      const result = await service.bulkMark(adminUser, {
        campusId: 'campus-1',
        date: '2026-06-12',
        periodId: 'period-1',
        entries: [{ userId: 'student-user-1', status: 'PRESENT' as never }],
      });

      expect(prismaMock.attendance.upsert).not.toHaveBeenCalled();
      expect(result.data.skipped).toEqual(
        expect.arrayContaining([
          { userId: 'student-user-1', reason: 'NOT_IN_PERIOD_ROSTER' },
        ]),
      );
    });

    it('rejects a periodId whose period slot belongs to a different campus', async () => {
      prismaMock.institutionSetting.findUnique.mockResolvedValue({
        value: { mode: 'PERIOD' },
      });
      prismaMock.periodSlot.findFirst.mockResolvedValue({
        id: 'period-1',
        campusId: 'campus-OTHER',
        classId: 'class-1',
        sectionId: 'section-1',
      });

      await expect(
        service.bulkMark(adminUser, {
          campusId: 'campus-1',
          date: '2026-06-12',
          periodId: 'period-1',
          entries: [{ userId: 'student-user-1', status: 'PRESENT' as never }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    describe('getPeriodRoster', () => {
      it('returns an empty roster (not a throw) when the institution has no current academic year', async () => {
        prismaMock.periodSlot.findFirst.mockResolvedValue({
          id: 'period-1',
          campusId: 'campus-1',
          classId: 'class-1',
          sectionId: 'section-1',
        });
        prismaMock.institution.findUnique.mockResolvedValue({
          currentAcademicYearId: null,
        });

        const result = await service.getPeriodRoster(adminUser, {
          periodId: 'period-1',
          date: '2026-06-12',
        });

        expect(result).toEqual({
          message: 'Period roster retrieved successfully',
          data: [],
        });
        expect(prismaMock.studentEnrollment.findMany).not.toHaveBeenCalled();
      });

      it("annotates the roster with each student's existing attendance status for that (date, periodId)", async () => {
        prismaMock.periodSlot.findFirst.mockResolvedValue({
          id: 'period-1',
          campusId: 'campus-1',
          classId: 'class-1',
          sectionId: 'section-1',
        });
        prismaMock.institution.findUnique.mockResolvedValue({
          currentAcademicYearId: 'year-1',
        });
        prismaMock.studentEnrollment.findMany.mockResolvedValue([
          {
            student: {
              id: 'student-1',
              userId: 'student-user-1',
              regNo: 'REG-1',
              user: { name: 'Student One' },
            },
          },
          {
            student: {
              id: 'student-2',
              userId: 'student-user-2',
              regNo: 'REG-2',
              user: { name: 'Student Two' },
            },
          },
        ]);
        prismaMock.attendance.findMany.mockResolvedValue([
          {
            userId: 'student-user-1',
            status: 'PRESENT',
            halfDay: false,
            remarks: null,
          },
        ]);

        const result = await service.getPeriodRoster(adminUser, {
          periodId: 'period-1',
          date: '2026-06-12',
        });

        expect(result.data).toEqual([
          {
            userId: 'student-user-1',
            studentId: 'student-1',
            name: 'Student One',
            regNo: 'REG-1',
            status: 'PRESENT',
            halfDay: false,
            remarks: null,
          },
          {
            userId: 'student-user-2',
            studentId: 'student-2',
            name: 'Student Two',
            regNo: 'REG-2',
            status: null,
            halfDay: false,
            remarks: null,
          },
        ]);
      });
    });

    describe('markPeriodAbsentees', () => {
      it('is idempotent: a second run creates no new rows once every roster student already has one', async () => {
        prismaMock.periodSlot.findFirst.mockResolvedValue({
          id: 'period-1',
          campusId: 'campus-1',
          classId: 'class-1',
          sectionId: 'section-1',
        });
        prismaMock.institution.findUnique.mockResolvedValue({
          currentAcademicYearId: 'year-1',
        });
        prismaMock.studentEnrollment.findMany.mockResolvedValue([
          {
            student: {
              id: 'student-1',
              userId: 'student-user-1',
              regNo: 'REG-1',
              user: { name: 'Student One' },
            },
          },
        ]);

        // First run: nobody has a row yet.
        prismaMock.attendance.findMany.mockResolvedValueOnce([]);
        const first = await service.markPeriodAbsentees(
          'period-1',
          '2026-06-12',
        );
        expect(first.data.count).toBe(1);
        expect(prismaMock.attendance.createMany).toHaveBeenCalledWith({
          data: [
            {
              userId: 'student-user-1',
              role: UserRole.STUDENT,
              campusId: 'campus-1',
              date: new Date('2026-06-12'),
              status: 'ABSENT',
              periodId: 'period-1',
              periodKey: 'period-1',
            },
          ],
        });

        // Second run: the roster student now already has a row for this
        // exact (date, periodId) -> no new rows, no error.
        prismaMock.attendance.findMany.mockResolvedValueOnce([
          { userId: 'student-user-1' },
        ]);
        prismaMock.attendance.createMany.mockClear();
        const second = await service.markPeriodAbsentees(
          'period-1',
          '2026-06-12',
        );
        expect(second.data.count).toBe(0);
        expect(prismaMock.attendance.createMany).not.toHaveBeenCalled();
      });

      it('returns a zero count without querying attendance when the roster is empty (no current academic year)', async () => {
        prismaMock.periodSlot.findFirst.mockResolvedValue({
          id: 'period-1',
          campusId: 'campus-1',
          classId: 'class-1',
          sectionId: 'section-1',
        });
        prismaMock.institution.findUnique.mockResolvedValue({
          currentAcademicYearId: null,
        });

        const result = await service.markPeriodAbsentees(
          'period-1',
          '2026-06-12',
        );

        expect(result.data.count).toBe(0);
        expect(prismaMock.attendance.createMany).not.toHaveBeenCalled();
      });
    });
  });
});
