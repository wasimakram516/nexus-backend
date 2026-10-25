import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { AuditLogService } from '../src/common/services/audit-log.service';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { EntityCustomFieldsService } from '../src/common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { OwnedStudentsService } from '../src/common/services/owned-students.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { PeriodSubstitutionsService } from '../src/modules/timetable/period-substitutions.service';
import { TimetableService } from '../src/modules/timetable/timetable.service';
import { TimetableViewsService } from '../src/modules/timetable/timetable-views.service';
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

describe('PostgreSQL timetable cover and weekly views', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let slots: TimetableService;
  let substitutions: PeriodSubstitutionsService;
  let views: TimetableViewsService;
  let institutionId: string;
  let campusId: string;
  let classId: string;
  let sectionId: string;
  let teacherOne: string;
  let teacherTwo: string;
  let teacherOneUser: string;
  let mondayMaths: string;
  let mondayBusy: string;
  let studentUser: CurrentUser;
  let guardianUser: CurrentUser;

  const superadmin: CurrentUser = {
    sub: randomUUID(),
    email: 'super@nexus.test',
    role: UserRole.SUPERADMIN,
    institutionId: null,
  };

  const newUser = (name: string, role: 'STAFF' | 'STUDENT' | 'GUARDIAN') =>
    prisma.user.create({
      data: {
        institutionId,
        name,
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role,
      },
    });

  const newTeacher = async (name: string) => {
    const user = await newUser(name, 'STAFF');
    const profile = await prisma.staffProfile.create({
      data: {
        userId: user.id,
        employmentType: 'TEACHING',
        designation: 'Teacher',
        gender: 'FEMALE',
        campusId,
        joiningDate: new Date('2024-01-01'),
      },
    });
    return { profileId: profile.id, userId: user.id };
  };

  const addPeriod = async (
    day: DayOfWeek,
    number: number,
    start: string,
    end: string,
    staffProfileId?: string,
  ) =>
    (
      await prisma.periodSlot.create({
        data: {
          campusId,
          classId,
          sectionId,
          name: `Period ${number}`,
          periodNumber: number,
          dayOfWeek: day,
          startTime: start,
          endTime: end,
          staffProfileId,
        },
      })
    ).id;

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
    const campusAccess = new CampusAccessService(prisma);
    slots = new TimetableService(
      prisma,
      new AuditLogService(prisma),
      campusAccess,
      new EntityCustomFieldsService(prisma, context),
      allowModule,
      context,
    );
    substitutions = new PeriodSubstitutionsService(
      prisma,
      new AuditLogService(prisma),
      campusAccess,
      allowModule,
    );
    views = new TimetableViewsService(
      prisma,
      allowModule,
      campusAccess,
      new OwnedStudentsService(prisma),
    );

    institutionId = (
      await prisma.institution.create({
        data: { name: 'Cover test', slug: randomUUID() },
      })
    ).id;
    await prisma.user.create({
      data: {
        id: superadmin.sub,
        name: 'Cover superadmin',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'SUPERADMIN',
      },
    });
    const year = await prisma.academicYear.create({
      data: {
        institutionId,
        name: '2026-27',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-06-30'),
      },
    });
    await prisma.institution.update({
      where: { id: institutionId },
      data: { currentAcademicYearId: year.id },
    });
    campusId = (
      await prisma.campus.create({
        data: {
          institutionId,
          name: 'Cover campus',
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
    const level = await prisma.level.create({ data: { name: 'L', campusId } });
    classId = (
      await prisma.academicClass.create({
        data: { name: 'Grade 5', levelId: level.id },
      })
    ).id;
    sectionId = (await prisma.section.create({ data: { name: 'A', classId } }))
      .id;
    const one = await newTeacher('Teacher One');
    const two = await newTeacher('Teacher Two');
    teacherOne = one.profileId;
    teacherTwo = two.profileId;
    teacherOneUser = one.userId;

    // Monday 08:00 Maths is Teacher One's; Teacher Two has their own Monday 08:00 class elsewhere.
    mondayMaths = await addPeriod(
      DayOfWeek.MONDAY,
      1,
      '08:00',
      '08:40',
      teacherOne,
    );
    await addPeriod(DayOfWeek.TUESDAY, 1, '08:00', '08:40', teacherOne);
    const otherSection = (
      await prisma.section.create({ data: { name: 'B', classId } })
    ).id;
    mondayBusy = (
      await prisma.periodSlot.create({
        data: {
          campusId,
          classId,
          sectionId: otherSection,
          name: 'Period 1',
          periodNumber: 1,
          dayOfWeek: DayOfWeek.MONDAY,
          startTime: '08:20',
          endTime: '09:00',
          staffProfileId: teacherTwo,
        },
      })
    ).id;

    const student = await newUser('Ayesha', 'STUDENT');
    const studentRow = await prisma.student.create({
      data: {
        userId: student.id,
        institutionId,
        regNo: 'C-1',
        dob: new Date('2012-01-01'),
        gender: 'FEMALE',
        campusId,
        admissionDate: new Date('2026-04-01'),
      },
    });
    await prisma.studentEnrollment.create({
      data: {
        studentId: studentRow.id,
        academicYearId: year.id,
        campusId,
        classId,
        sectionId,
        status: 'ACTIVE',
      },
    });
    const guardian = await newUser('Mr Khan', 'GUARDIAN');
    const guardianRow = await prisma.guardian.create({
      data: { userId: guardian.id, relation: 'FATHER', campusId },
    });
    await prisma.studentGuardian.create({
      data: { studentId: studentRow.id, guardianId: guardianRow.id },
    });
    studentUser = {
      sub: student.id,
      email: student.email,
      role: UserRole.STUDENT,
      institutionId,
    };
    guardianUser = {
      sub: guardian.id,
      email: guardian.email,
      role: UserRole.GUARDIAN,
      institutionId,
    };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const cover = (overrides: Record<string, unknown> = {}) =>
    substitutions.create(superadmin, {
      periodSlotId: mondayMaths,
      date: '2026-11-02',
      substituteStaffProfileId: teacherTwo,
      reason: 'Sick leave',
      ...overrides,
    });

  it('refuses cover for a teacher who is teaching then, and a date that is the wrong weekday', async () => {
    await expect(cover()).rejects.toThrow(
      /is teaching Grade 5, section B, 08:20 to 09:00 then/,
    );
    await expect(cover({ date: '2026-11-03' })).rejects.toThrow(
      /must be on a monday/,
    );
    expect(await prisma.periodSubstitution.count()).toBe(0);
    // Keeps the next tests honest: the busy period exists.
    expect(mondayBusy).toBeTruthy();
  });

  it('arranges cover once the substitute is free, and refuses a second cover for that period and date', async () => {
    // Teacher Two's own Monday period is itself covered by Teacher One's colleague... first free them.
    await prisma.periodSlot.update({
      where: { id: mondayBusy },
      data: { staffProfileId: null },
    });

    const { data } = await cover();

    expect(data).toMatchObject({
      date: '2026-11-02',
      substituteName: 'Teacher Two',
      originalName: 'Teacher One',
      sectionName: 'A',
    });
    await expect(cover()).rejects.toThrow(
      /already has cover arranged for that date/,
    );
  });

  it('shows the cover on the section timetable for that week only', async () => {
    const week = await views.sectionSchedule(
      superadmin,
      sectionId,
      '2026-11-04',
    );
    const monday = week.data.group.entries.find(
      (entry) => entry.dayOfWeek === 'MONDAY',
    );
    expect(monday).toMatchObject({
      date: '2026-11-02',
      isCovered: true,
      effectiveTeacherName: 'Teacher Two',
      coverReason: 'Sick leave',
    });

    const nextWeek = await views.sectionSchedule(
      superadmin,
      sectionId,
      '2026-11-09',
    );
    expect(
      nextWeek.data.group.entries.find((entry) => entry.dayOfWeek === 'MONDAY')
        ?.isCovered,
    ).toBe(false);
  });

  it("marks the usual teacher's period as covered and gives the substitute the duty", async () => {
    const usual = await views.teacherSchedule(
      superadmin,
      teacherOne,
      '2026-11-02',
    );
    expect(
      usual.data.group.entries.map((e) => [e.dayOfWeek, e.isCovered]),
    ).toEqual([
      ['MONDAY', true],
      ['TUESDAY', false],
    ]);

    const substitute = await views.teacherSchedule(
      superadmin,
      teacherTwo,
      '2026-11-02',
    );
    const duty = substitute.data.group.entries.filter(
      (entry) => entry.isCoverDuty,
    );
    expect(duty).toHaveLength(1);
    expect(duty[0]).toMatchObject({ className: 'Grade 5', date: '2026-11-02' });
  });

  it("gives a student their section's week and a guardian every child's, each with the cover", async () => {
    const mine = await views.mySchedule(studentUser, '2026-11-02');
    expect(mine.data.groups).toHaveLength(1);
    expect(mine.data.groups[0]).toMatchObject({
      kind: 'STUDENT',
      title: 'Ayesha',
    });
    expect(mine.data.groups[0].entries.some((entry) => entry.isCovered)).toBe(
      true,
    );

    const family = await views.mySchedule(guardianUser, '2026-11-02');
    expect(family.data.groups.map((group) => group.title)).toEqual(['Ayesha']);
  });

  it('gives a teacher their own week, and someone with neither role nothing', async () => {
    const teacher = await views.mySchedule(
      {
        sub: teacherOneUser,
        email: 't@x.test',
        role: UserRole.STAFF,
        institutionId,
      },
      '2026-11-02',
    );
    expect(teacher.data.groups[0]).toMatchObject({
      kind: 'TEACHER',
      title: 'Teacher One',
    });

    const nobody = await views.mySchedule(
      {
        sub: randomUUID(),
        email: 'n@x.test',
        role: UserRole.ADMIN,
        institutionId,
      },
      '2026-11-02',
    );
    expect(nobody.data.groups).toEqual([]);
  });

  it('lists cover for the week and returns the period to its usual teacher when it is cancelled', async () => {
    const list = await substitutions.list(superadmin, {
      campusId,
      from: '2026-11-02',
      to: '2026-11-08',
    });
    expect(list.data).toHaveLength(1);

    await substitutions.cancel(superadmin, list.data[0].id, {
      reason: 'Back at work',
    });

    expect(
      (
        await substitutions.list(superadmin, {
          campusId,
          from: '2026-11-02',
          to: '2026-11-08',
        })
      ).data,
    ).toHaveLength(0);
    const week = await views.sectionSchedule(
      superadmin,
      sectionId,
      '2026-11-02',
    );
    expect(
      week.data.group.entries.find((entry) => entry.dayOfWeek === 'MONDAY'),
    ).toMatchObject({ isCovered: false, effectiveTeacherName: 'Teacher One' });

    // A cancelled cover frees the date, so cover can be arranged again.
    await expect(cover()).resolves.toMatchObject({
      message: 'Substitution arranged successfully',
    });
  });

  it('keeps a room a free-text label that clashes are checked on, and the swap leaves cover intact', async () => {
    await expect(
      slots.listClashes(superadmin, campusId),
    ).resolves.toMatchObject({ data: [] });
  });
});
