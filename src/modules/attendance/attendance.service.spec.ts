import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, UserRole } from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { WorkingDayResolverService } from '../../common/services/working-day-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceService } from './attendance.service';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CheckOutDto } from './dto/attendance.dto';

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

  // Reproduces the pre-P0-7 literal-UTC construction so every pre-existing
  // test (none of which care about real timezone resolution — that's
  // covered by timezone-resolver.service.spec.ts) keeps its exact expected
  // Date values without a rewrite.
  const timezoneResolverMock = {
    resolveForCampus: jest.fn().mockResolvedValue('Asia/Karachi'),
    localDateString: jest.fn(),
    localDayOfWeek: jest.fn(),
    zonedTimeToInstant: jest
      .fn()
      .mockImplementation(
        (_tz: string, dateStr: string, time: string) =>
          new Date(`${dateStr}T${time}.000Z`),
      ),
    assertValidTimezone: jest.fn(),
  };

  const workingDayResolverMock = {
    isWorkingDay: jest.fn().mockResolvedValue(true),
  };

  const entityCustomFieldsServiceMock = {
    resolveInstitutionIdByCampus: jest.fn().mockResolvedValue('institution-1'),
    saveRecord: jest
      .fn()
      .mockImplementation(
        (
          _params: unknown,
          mutation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
        ) => mutation(prismaMock as unknown as Prisma.TransactionClient),
      ),
    attachToItem: jest
      .fn()
      .mockImplementation((item: unknown) => Promise.resolve(item)),
    attachToItems: jest
      .fn()
      .mockImplementation((items: unknown) => Promise.resolve(items)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    timezoneResolverMock.resolveForCampus.mockResolvedValue('Asia/Karachi');
    timezoneResolverMock.zonedTimeToInstant.mockImplementation(
      (_tz: string, dateStr: string, time: string) =>
        new Date(`${dateStr}T${time}.000Z`),
    );
    workingDayResolverMock.isWorkingDay.mockResolvedValue(true);

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
          provide: EntityCustomFieldsService,
          useValue: entityCustomFieldsServiceMock,
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
        { provide: TimezoneResolverService, useValue: timezoneResolverMock },
        {
          provide: WorkingDayResolverService,
          useValue: workingDayResolverMock,
        },
      ],
    }).compile();

    service = moduleRef.get<AttendanceService>(AttendanceService);
  });

  it('refuses another user context before resolving campus metadata', async () => {
    await expect(
      service.getPunchContext(teacherUser, 'other-user'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(timezoneResolverMock.resolveForCampus).not.toHaveBeenCalled();
  });

  it('returns the authorized self-service campus timezone', async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      role: UserRole.STAFF,
    });
    prismaMock.staffProfile.findUnique.mockResolvedValue({
      campusId: 'campus-1',
    });
    prismaMock.staffProfile.findUniqueOrThrow.mockResolvedValue({
      campusId: 'campus-1',
    });
    expect(await service.getPunchContext(teacherUser)).toMatchObject({
      data: { campusId: 'campus-1', timezone: 'Asia/Karachi' },
    });
    expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
      teacherUser,
      'campus-1',
    );
  });

  describe('checkout DTO under the application ValidationPipe options', () => {
    // Mirrors src/main.ts exactly: whitelist + forbidNonWhitelisted + implicit conversion.
    const pipeOptions = {
      whitelist: true,
      forbidNonWhitelisted: true,
    } as const;
    const base = {
      userId: '11111111-1111-4111-8111-111111111111',
      date: '2026-09-19',
      checkOut: '2026-09-19T09:00:00.000Z',
    };
    const check = (payload: Record<string, unknown>) =>
      validateSync(
        plainToInstance(CheckOutDto, payload, {
          enableImplicitConversion: true,
        }),
        pipeOptions,
      );

    it('accepts an empty customFields object', () => {
      expect(check({ ...base, customFields: {} })).toEqual([]);
    });

    it('accepts a populated customFields object', () => {
      expect(
        check({ ...base, customFields: { device: 'gate', n: 0 } }),
      ).toEqual([]);
    });

    it('accepts a payload without customFields', () => {
      expect(check(base)).toEqual([]);
    });

    it('still rejects unknown properties and non-object customFields', () => {
      expect(check({ ...base, bogus: 1 })).not.toEqual([]);
      expect(check({ ...base, customFields: 'x' })).not.toEqual([]);
    });
  });

  it('saves checkout and custom values through the shared atomic update', async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      role: UserRole.STAFF,
    });
    prismaMock.staffProfile.findUnique.mockResolvedValue({
      campusId: 'campus-1',
    });
    prismaMock.staffProfile.findUniqueOrThrow.mockResolvedValue({
      campusId: 'campus-1',
    });
    prismaMock.attendance.findFirst.mockResolvedValue({ id: 'attendance-1' });
    prismaMock.campus.findUniqueOrThrow.mockResolvedValue({
      staffEndTime: '16:00',
      earlyLeaveThreshold: 10,
    });
    prismaMock.attendance.update.mockResolvedValue({ id: 'attendance-1' });
    await service.checkOut(teacherUser, {
      userId: teacherUser.sub,
      date: '2026-09-19',
      checkOut: '2026-09-19T16:00:00.000Z',
      customFields: { device: 'gate' },
    });
    expect(entityCustomFieldsServiceMock.saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'attendance',
        create: false,
        values: { device: 'gate' },
      }),
      expect.any(Function),
    );
    expect(prismaMock.attendance.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'attendance-1' } }),
    );
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

  describe('custom fields wiring (M4.5 / P1-2a)', () => {
    it('checkIn commits the attendance row and its custom field values through the same saveRecord transaction', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'teacher-user-1',
        role: UserRole.STAFF,
      });
      prismaMock.staffProfile.findUnique.mockResolvedValue({
        campusId: 'campus-1',
      });
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue(undefined);
      prismaMock.campus.findUniqueOrThrow.mockResolvedValue({
        id: 'campus-1',
        staffStartTime: '08:00:00',
        lateThreshold: 10,
      });
      prismaMock.attendance.findFirst.mockResolvedValue(null);
      prismaMock.attendance.create.mockResolvedValue({ id: 'attendance-1' });

      await service.checkIn(teacherUser, {
        userId: 'teacher-user-1',
        date: '2026-06-12',
        checkIn: '2026-06-12T08:00:00.000Z',
        customFields: { device: 'kiosk-1' },
      });

      expect(
        entityCustomFieldsServiceMock.resolveInstitutionIdByCampus,
      ).toHaveBeenCalledWith('campus-1');
      expect(entityCustomFieldsServiceMock.saveRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          institutionId: 'institution-1',
          entityType: 'attendance',
          values: { device: 'kiosk-1' },
          create: true,
        }),
        expect.any(Function),
      );
    });

    it('updateAttendanceRecord saves custom field values against the existing record', async () => {
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
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      prismaMock.attendance.update.mockResolvedValue({ id: 'attendance-1' });

      await service.updateAttendanceRecord(adminUser, 'attendance-1', {
        remarks: 'ok',
        customFields: { verifiedBy: 'admin-1' },
      });

      expect(entityCustomFieldsServiceMock.saveRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          institutionId: 'institution-1',
          entityType: 'attendance',
          values: { verifiedBy: 'admin-1' },
          create: false,
        }),
        expect.any(Function),
      );
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
      it('checks the requested period date and skips closure dates before reading the roster', async () => {
        prismaMock.periodSlot.findFirst.mockResolvedValue({
          id: 'period-1',
          campusId: 'campus-1',
        });
        workingDayResolverMock.isWorkingDay.mockResolvedValue(false);
        timezoneResolverMock.localDayOfWeek.mockReturnValue('SUNDAY');
        const result = await service.markPeriodAbsentees(
          'period-1',
          '2026-06-14',
        );
        expect(workingDayResolverMock.isWorkingDay).toHaveBeenCalledWith(
          'institution-1',
          'campus-1',
          '2026-06-14',
          'SUNDAY',
        );
        expect(result.data.count).toBe(0);
        expect(prismaMock.studentEnrollment.findMany).not.toHaveBeenCalled();
        expect(prismaMock.attendance.createMany).not.toHaveBeenCalled();
      });
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
        prismaMock.attendance.createMany.mockResolvedValueOnce({ count: 1 });
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
          skipDuplicates: true,
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

    // P0-6 (§ 6.1 of P0-6-7-9-CORRECTIVE-DESIGN.md), mapped to
    // FOCUS-AREAS.md's own P0-6 Verification 1-3.
    describe('markCampusAbsentees', () => {
      beforeEach(() => {
        prismaMock.campus.findUniqueOrThrow.mockResolvedValue({
          institutionId: 'institution-1',
        });
        // resolveAttendanceMode() defaults to DAILY when unset.
        prismaMock.institutionSetting.findUnique.mockResolvedValue(undefined);
        prismaMock.institution.findUnique.mockResolvedValue({
          currentAcademicYearId: 'year-1',
        });
        prismaMock.studentEnrollment.findMany.mockResolvedValue([]);
        prismaMock.attendance.findMany.mockResolvedValue([]);
        prismaMock.attendance.createMany.mockImplementation(
          (args: { data: unknown[] }) =>
            Promise.resolve({ count: args.data.length }),
        );
      });

      it('includes active staff and active DAILY-mode students, excludes withdrawn students, inactive staff, and guardians', async () => {
        prismaMock.userCampus.findMany.mockResolvedValue([
          {
            userId: 'staff-active',
            user: { role: UserRole.STAFF },
          },
          {
            userId: 'admin-active',
            user: { role: UserRole.ADMIN },
          },
        ]);
        prismaMock.studentEnrollment.findMany.mockResolvedValue([
          { student: { userId: 'student-active' } },
        ]);

        const result = await service.markCampusAbsentees(
          'campus-1',
          '2026-06-12',
        );

        // Withdrawn students (LEFT), RESIGNED/SUSPENDED staff, and stray
        // guardian UserCampus rows are excluded by construction: the
        // staffCandidates query filters on User.status ACTIVE + role STAFF/
        // ADMIN only, and the studentCandidates query filters on
        // StudentEnrollment.status ACTIVE only — neither query can surface
        // them, which this assertion locks in via the exact WHERE shape.
        expect(prismaMock.userCampus.findMany).toHaveBeenCalledWith({
          where: {
            campusId: 'campus-1',
            deletedAt: null,
            user: {
              deletedAt: null,
              status: 'ACTIVE',
              role: { in: [UserRole.STAFF, UserRole.ADMIN] },
            },
          },
          select: { userId: true, user: { select: { role: true } } },
        });
        expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith({
          where: {
            campusId: 'campus-1',
            academicYearId: 'year-1',
            status: 'ACTIVE',
            deletedAt: null,
            student: {
              deletedAt: null,
              user: { deletedAt: null, status: 'ACTIVE' },
            },
          },
          select: { student: { select: { userId: true } } },
        });
        expect(result.data.count).toBe(3);
        expect(prismaMock.attendance.createMany).toHaveBeenCalledWith({
          data: expect.arrayContaining([
            expect.objectContaining({
              userId: 'staff-active',
              role: UserRole.STAFF,
            }),
            expect.objectContaining({
              userId: 'admin-active',
              role: UserRole.ADMIN,
            }),
            expect.objectContaining({
              userId: 'student-active',
              role: UserRole.STUDENT,
            }),
          ]) as unknown,
          skipDuplicates: true,
        });
      });

      it('omits students entirely in PERIOD mode while still covering staff', async () => {
        prismaMock.institutionSetting.findUnique.mockResolvedValue({
          value: { mode: 'PERIOD' },
        });
        prismaMock.userCampus.findMany.mockResolvedValue([
          { userId: 'staff-active', user: { role: UserRole.STAFF } },
        ]);

        const result = await service.markCampusAbsentees(
          'campus-1',
          '2026-06-12',
        );

        expect(prismaMock.studentEnrollment.findMany).not.toHaveBeenCalled();
        expect(result.data.count).toBe(1);
        expect(prismaMock.attendance.createMany).toHaveBeenCalledWith({
          data: [
            expect.objectContaining({
              userId: 'staff-active',
              role: UserRole.STAFF,
            }),
          ],
          skipDuplicates: true,
        });
      });

      it('generates zero absences and skips roster queries entirely on a non-working day', async () => {
        workingDayResolverMock.isWorkingDay.mockResolvedValue(false);
        timezoneResolverMock.localDayOfWeek.mockReturnValue('SUNDAY');

        const result = await service.markCampusAbsentees(
          'campus-1',
          '2026-06-14',
        );
        expect(workingDayResolverMock.isWorkingDay).toHaveBeenCalledWith(
          'institution-1',
          'campus-1',
          '2026-06-14',
          'SUNDAY',
        );
        expect(timezoneResolverMock.zonedTimeToInstant).toHaveBeenCalledWith(
          'Asia/Karachi',
          '2026-06-14',
          '12:00',
        );

        expect(result).toEqual({
          message: 'No absences generated — not a working day',
          data: { count: 0 },
        });
        expect(prismaMock.userCampus.findMany).not.toHaveBeenCalled();
        expect(prismaMock.attendance.createMany).not.toHaveBeenCalled();
      });

      it('degrades gracefully (skips the working-day check, still covers staff) when the campus has no institutionId', async () => {
        prismaMock.campus.findUniqueOrThrow.mockResolvedValue({
          institutionId: null,
        });
        prismaMock.userCampus.findMany.mockResolvedValue([
          { userId: 'staff-active', user: { role: UserRole.STAFF } },
        ]);

        const result = await service.markCampusAbsentees(
          'campus-1',
          '2026-06-12',
        );

        expect(workingDayResolverMock.isWorkingDay).not.toHaveBeenCalled();
        expect(prismaMock.studentEnrollment.findMany).not.toHaveBeenCalled();
        expect(result.data.count).toBe(1);
      });

      it('preserves a manually-marked row and reports only the newly-created count on re-run', async () => {
        prismaMock.userCampus.findMany.mockResolvedValue([
          { userId: 'staff-active', user: { role: UserRole.STAFF } },
        ]);
        prismaMock.studentEnrollment.findMany.mockResolvedValue([
          { student: { userId: 'student-active' } },
        ]);
        // student-active was already manually marked PRESENT by bulkMark().
        prismaMock.attendance.findMany.mockResolvedValue([
          { userId: 'student-active' },
        ]);

        const result = await service.markCampusAbsentees(
          'campus-1',
          '2026-06-12',
        );

        expect(result.data.count).toBe(1);
        expect(prismaMock.attendance.createMany).toHaveBeenCalledWith({
          data: [expect.objectContaining({ userId: 'staff-active' })],
          skipDuplicates: true,
        });
      });

      it('is idempotent: a second run after createMany reports zero new rows', async () => {
        prismaMock.userCampus.findMany.mockResolvedValue([
          { userId: 'staff-active', user: { role: UserRole.STAFF } },
        ]);
        prismaMock.attendance.findMany.mockResolvedValueOnce([]);
        const first = await service.markCampusAbsentees(
          'campus-1',
          '2026-06-12',
        );
        expect(first.data.count).toBe(1);

        prismaMock.attendance.findMany.mockResolvedValueOnce([
          { userId: 'staff-active' },
        ]);
        prismaMock.attendance.createMany.mockClear();
        const second = await service.markCampusAbsentees(
          'campus-1',
          '2026-06-12',
        );
        expect(second.data.count).toBe(0);
        expect(prismaMock.attendance.createMany).not.toHaveBeenCalled();
      });

      it('tolerates a colliding concurrent sweep via skipDuplicates, reporting only the rows this call actually inserted', async () => {
        prismaMock.userCampus.findMany.mockResolvedValue([
          { userId: 'staff-1', user: { role: UserRole.STAFF } },
          { userId: 'staff-2', user: { role: UserRole.STAFF } },
        ]);
        // Neither had a row at read time, but staff-1's row was inserted by
        // a concurrent sweep run between the read and this createMany call
        // -> Postgres ON CONFLICT DO NOTHING skips it, createMany reports
        // only the row that actually landed.
        prismaMock.attendance.createMany.mockResolvedValueOnce({ count: 1 });

        const result = await service.markCampusAbsentees(
          'campus-1',
          '2026-06-12',
        );

        expect(result.data.count).toBe(1);
        expect(prismaMock.attendance.createMany).toHaveBeenCalledWith({
          data: expect.arrayContaining([
            expect.objectContaining({ userId: 'staff-1' }),
            expect.objectContaining({ userId: 'staff-2' }),
          ]) as unknown,
          skipDuplicates: true,
        });
      });
    });
  });
});
