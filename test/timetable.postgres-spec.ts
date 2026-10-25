import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { AuditLogService } from '../src/common/services/audit-log.service';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { EntityCustomFieldsService } from '../src/common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { TimetableService } from '../src/modules/timetable/timetable.service';
import { DayOfWeek, UserRole } from '../src/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-database proof for the timetable rules: a teacher or room is never in
 * two places at once, back-to-back periods are fine, swapping two periods of a
 * section works despite the one-period-per-cell rule, and clashes that already
 * exist are found. Run via `npm run test:postgres`.
 */
describe('PostgreSQL timetable clashes and swaps', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let service: TimetableService;
  let institutionId: string;
  let campusId: string;
  let classId: string;
  let sectionA: string;
  let sectionB: string;
  let teacher1: string;
  let teacher2: string;

  const superadmin: CurrentUser = {
    sub: randomUUID(),
    email: 'super@nexus.test',
    role: UserRole.SUPERADMIN,
    institutionId: null,
  };

  const newTeacher = async (name: string) => {
    const user = await prisma.user.create({
      data: {
        institutionId,
        name,
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'STAFF',
      },
    });
    return (
      await prisma.staffProfile.create({
        data: {
          userId: user.id,
          employmentType: 'TEACHING',
          designation: 'Teacher',
          gender: 'FEMALE',
          campusId,
          joiningDate: new Date('2024-01-01'),
        },
      })
    ).id;
  };

  const period = (
    sectionId: string,
    day: DayOfWeek,
    number: number,
    start: string,
    end: string,
    extra: { staffProfileId?: string; room?: string } = {},
  ) =>
    service.createPeriodSlot(superadmin, {
      classId,
      sectionId,
      name: `Period ${number}`,
      periodNumber: number,
      dayOfWeek: day,
      startTime: start,
      endTime: end,
      ...extra,
    });

  /** Creates a period and returns its id, failing clearly if the response had none. */
  const periodId = async (...args: Parameters<typeof period>) => {
    const created = (await period(...args)).data;
    if (!created) throw new Error('The period was not created.');
    return created.id;
  };

  const placeOf = async (id: string) => {
    const row = await prisma.periodSlot.findUniqueOrThrow({ where: { id } });
    return [row.dayOfWeek, row.periodNumber, row.startTime];
  };

  beforeAll(async () => {
    const connection = process.env.TEST_DATABASE_URL;
    if (!connection) throw new Error('TEST_DATABASE_URL is required');
    const url = new URL(connection);
    if (
      url.hostname !== '127.0.0.1' ||
      !/^\/nexus_audit_test(?:_[a-z0-9]+)?$/.test(url.pathname)
    )
      throw new Error('Use an isolated loopback nexus_audit_test database');
    process.env.DATABASE_URL = connection;
    prisma = new PrismaService(context);

    // Module entitlement is not what these tests prove, so that one check is skipped.
    const allowModule = {
      assertModuleEnabledForUser: () => Promise.resolve(),
    } as unknown as ModuleAccessService;
    service = new TimetableService(
      prisma,
      new AuditLogService(prisma),
      new CampusAccessService(prisma),
      new EntityCustomFieldsService(prisma, context),
      allowModule,
      context,
    );

    institutionId = (
      await prisma.institution.create({
        data: { name: 'Timetable test', slug: randomUUID() },
      })
    ).id;
    await prisma.user.create({
      data: {
        id: superadmin.sub,
        name: 'Timetable superadmin',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'SUPERADMIN',
      },
    });
    campusId = (
      await prisma.campus.create({
        data: {
          institutionId,
          name: 'Timetable campus',
          location: 'Test',
          studentStartTime: '08:00',
          studentEndTime: '14:00',
          staffStartTime: '08:00',
          staffEndTime: '14:00',
          lateThreshold: 10,
          earlyLeaveThreshold: 10,
        },
      })
    ).id;
    const level = await prisma.level.create({
      data: { name: 'Timetable level', campusId },
    });
    classId = (
      await prisma.academicClass.create({
        data: { name: 'Grade 5', levelId: level.id },
      })
    ).id;
    sectionA = (await prisma.section.create({ data: { name: 'A', classId } }))
      .id;
    sectionB = (await prisma.section.create({ data: { name: 'B', classId } }))
      .id;
    teacher1 = await newTeacher('Teacher One');
    teacher2 = await newTeacher('Teacher Two');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('refuses the same teacher in two sections at overlapping times, but allows back to back', async () => {
    await period(sectionA, DayOfWeek.MONDAY, 1, '08:00', '08:40', {
      staffProfileId: teacher1,
    });

    await expect(
      period(sectionB, DayOfWeek.MONDAY, 1, '08:20', '09:00', {
        staffProfileId: teacher1,
      }),
    ).rejects.toThrow(/already teaching Grade 5, section A, 08:00 to 08:40/);

    await expect(
      period(sectionB, DayOfWeek.MONDAY, 2, '08:40', '09:20', {
        staffProfileId: teacher1,
      }),
    ).resolves.toMatchObject({ message: 'Period slot created successfully' });
  });

  it('allows the same teacher on another day, and another teacher at the same time', async () => {
    await expect(
      period(sectionB, DayOfWeek.TUESDAY, 1, '08:00', '08:40', {
        staffProfileId: teacher1,
      }),
    ).resolves.toBeDefined();
    await expect(
      period(sectionB, DayOfWeek.MONDAY, 3, '08:00', '08:40', {
        staffProfileId: teacher2,
      }),
    ).resolves.toBeDefined();
  });

  it('refuses a room used twice at once, ignoring case and spaces, and remembers the rooms', async () => {
    await period(sectionA, DayOfWeek.WEDNESDAY, 1, '09:00', '09:40', {
      room: 'Lab 1',
    });

    await expect(
      period(sectionB, DayOfWeek.WEDNESDAY, 1, '09:20', '10:00', {
        room: '  LAB 1 ',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await period(sectionB, DayOfWeek.WEDNESDAY, 2, '09:40', '10:20', {
      room: 'Library',
    });
    const { data } = await service.listRooms(superadmin, campusId);
    expect(data).toEqual(['Lab 1', 'Library']);
  });

  it('swaps two periods of a section in the database despite one period per cell', async () => {
    const first = await periodId(
      sectionA,
      DayOfWeek.THURSDAY,
      1,
      '08:00',
      '08:40',
    );
    const second = await periodId(
      sectionA,
      DayOfWeek.FRIDAY,
      4,
      '10:40',
      '11:20',
    );

    await service.swapPeriodSlots(superadmin, {
      firstId: first,
      secondId: second,
    });

    expect(await placeOf(first)).toEqual([DayOfWeek.FRIDAY, 4, '10:40']);
    expect(await placeOf(second)).toEqual([DayOfWeek.THURSDAY, 1, '08:00']);
  });

  it('refuses a swap that would put a teacher in two places, and changes nothing', async () => {
    const mine = await periodId(
      sectionA,
      DayOfWeek.SATURDAY,
      1,
      '08:00',
      '08:40',
      {
        staffProfileId: teacher2,
      },
    );
    const target = await periodId(
      sectionA,
      DayOfWeek.SATURDAY,
      2,
      '09:40',
      '10:20',
    );
    await period(sectionB, DayOfWeek.SATURDAY, 2, '09:30', '10:10', {
      staffProfileId: teacher2,
    });

    await expect(
      service.swapPeriodSlots(superadmin, {
        firstId: mine,
        secondId: target,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await placeOf(mine)).toEqual([DayOfWeek.SATURDAY, 1, '08:00']);
    expect(await placeOf(target)).toEqual([DayOfWeek.SATURDAY, 2, '09:40']);
  });

  it('finds a clash that already existed, written around the checks', async () => {
    await prisma.periodSlot.createMany({
      data: [
        {
          campusId,
          classId,
          sectionId: sectionA,
          name: 'Old 1',
          periodNumber: 8,
          dayOfWeek: DayOfWeek.SUNDAY,
          startTime: '08:00',
          endTime: '08:40',
          staffProfileId: teacher1,
        },
        {
          campusId,
          classId,
          sectionId: sectionB,
          name: 'Old 2',
          periodNumber: 8,
          dayOfWeek: DayOfWeek.SUNDAY,
          startTime: '08:20',
          endTime: '09:00',
          staffProfileId: teacher1,
        },
      ],
    });

    const { data } = await service.listClashes(superadmin, campusId);

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      kind: 'TEACHER',
      first: { teacherName: 'Teacher One', dayOfWeek: 'SUNDAY' },
    });
  });

  it('moves a period when its own time is edited without clashing with itself', async () => {
    const slot = await periodId(
      sectionA,
      DayOfWeek.MONDAY,
      5,
      '11:00',
      '11:40',
      {
        staffProfileId: teacher2,
      },
    );

    await expect(
      service.updatePeriodSlot(superadmin, slot, {
        startTime: '11:10',
        endTime: '11:50',
      }),
    ).resolves.toMatchObject({ message: 'Period slot updated successfully' });
  });
});
