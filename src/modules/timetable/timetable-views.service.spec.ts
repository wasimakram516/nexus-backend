import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { OwnedStudentsService } from '../../common/services/owned-students.service';
import { DayOfWeek, ModuleKey, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TimetableViewsService } from './timetable-views.service';

describe('TimetableViewsService', () => {
  let service: TimetableViewsService;

  const prismaMock = {
    periodSlot: { findMany: jest.fn() },
    periodSubstitution: { findMany: jest.fn() },
    staffProfile: { findFirst: jest.fn(), findUnique: jest.fn() },
    studentEnrollment: { findMany: jest.fn() },
    institution: { findUnique: jest.fn() },
  };
  const moduleAccessMock = { assertModuleEnabledForUser: jest.fn() };
  const campusAccessMock = {
    assertSectionAccess: jest.fn(),
    assertStaffProfileAccess: jest.fn(),
  };
  const ownedMock = { resolveOwnedStudentIds: jest.fn() };

  const user = (role: UserRole): CurrentUser => ({
    sub: 'user-1',
    email: 'u@nexus.test',
    role,
    institutionId: 'inst-1',
  });

  const row = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    dayOfWeek: DayOfWeek.MONDAY,
    periodNumber: 1,
    name: 'Period 1',
    startTime: '08:00',
    endTime: '08:40',
    room: 'R1',
    sectionId: 'sec-1',
    staffProfileId: 't1',
    class: { name: 'Grade 5' },
    section: { name: 'A' },
    subject: { name: 'Maths' },
    staffProfile: { user: { name: 'Teacher One' } },
    ...overrides,
  });

  const coverRow = {
    id: 'c1',
    periodSlotId: 's1',
    date: new Date('2026-11-02T00:00:00.000Z'),
    reason: 'Sick',
    substituteStaffProfileId: 't2',
    substitute: { user: { name: 'Teacher Two' } },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    moduleAccessMock.assertModuleEnabledForUser.mockResolvedValue(undefined);
    campusAccessMock.assertSectionAccess.mockResolvedValue(undefined);
    campusAccessMock.assertStaffProfileAccess.mockResolvedValue(undefined);
    prismaMock.periodSlot.findMany.mockResolvedValue([]);
    prismaMock.periodSubstitution.findMany.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [
        TimetableViewsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ModuleAccessService, useValue: moduleAccessMock },
        { provide: CampusAccessService, useValue: campusAccessMock },
        { provide: OwnedStudentsService, useValue: ownedMock },
      ],
    }).compile();
    service = module.get(TimetableViewsService);
  });

  it('checks the timetable module and access to the section, then shows its week with cover', async () => {
    prismaMock.periodSlot.findMany.mockResolvedValue([row('s1')]);
    prismaMock.periodSubstitution.findMany.mockResolvedValue([coverRow]);

    const { data } = await service.sectionSchedule(
      user(UserRole.ADMIN),
      'sec-1',
      '2026-11-04',
    );

    expect(moduleAccessMock.assertModuleEnabledForUser).toHaveBeenCalledWith(
      expect.anything(),
      ModuleKey.TIMETABLE,
    );
    expect(campusAccessMock.assertSectionAccess).toHaveBeenCalledWith(
      expect.anything(),
      'sec-1',
    );
    expect(data.week).toMatchObject({ from: '2026-11-02', to: '2026-11-08' });
    expect(data.group).toMatchObject({
      kind: 'SECTION',
      title: 'Grade 5, section A',
    });
    expect(data.group.entries[0]).toMatchObject({
      date: '2026-11-02',
      isCovered: true,
      effectiveTeacherName: 'Teacher Two',
      room: 'R1',
    });
  });

  it('shows an empty section without a title', async () => {
    const { data } = await service.sectionSchedule(
      user(UserRole.ADMIN),
      'sec-1',
      '2026-11-04',
    );

    expect(data.group).toMatchObject({ title: '', entries: [] });
  });

  it("shows a teacher's own periods and the ones they are covering, in date and time order", async () => {
    prismaMock.periodSlot.findMany
      .mockResolvedValueOnce([
        row('own', { startTime: '10:00', endTime: '10:40' }),
      ])
      .mockResolvedValueOnce([row('duty', { staffProfileId: 't9' })]);
    prismaMock.periodSubstitution.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...coverRow, periodSlotId: 'duty' }]);
    prismaMock.staffProfile.findUnique.mockResolvedValue({
      designation: 'Senior teacher',
      user: { name: 'Teacher Two' },
    });

    const { data } = await service.teacherSchedule(
      user(UserRole.ADMIN),
      't2',
      '2026-11-02',
    );

    expect(campusAccessMock.assertStaffProfileAccess).toHaveBeenCalledWith(
      expect.anything(),
      't2',
    );
    expect(data.group).toMatchObject({
      kind: 'TEACHER',
      title: 'Teacher Two',
      subtitle: 'Senior teacher',
    });
    expect(
      data.group.entries.map((entry) => [entry.id, entry.isCoverDuty]),
    ).toEqual([
      ['duty', true],
      ['own', false],
    ]);
  });

  it('does not look up cover-duty periods when there are none', async () => {
    prismaMock.periodSlot.findMany.mockResolvedValue([row('own')]);
    prismaMock.staffProfile.findUnique.mockResolvedValue(null);

    const { data } = await service.teacherSchedule(
      user(UserRole.ADMIN),
      't1',
      '2026-11-02',
    );

    expect(prismaMock.periodSlot.findMany).toHaveBeenCalledTimes(1);
    expect(data.group.title).toBe('Teacher');
  });

  describe('mySchedule', () => {
    it("gives a student or guardian each child's section, named by child and sorted", async () => {
      ownedMock.resolveOwnedStudentIds.mockResolvedValue(['s-a', 's-b']);
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        { sectionId: 'sec-1', student: { id: 's-b', user: { name: 'Zara' } } },
        {
          sectionId: 'sec-1',
          student: { id: 's-a', user: { name: 'Ayesha' } },
        },
        {
          sectionId: null,
          student: { id: 's-c', user: { name: 'No section' } },
        },
      ]);
      prismaMock.periodSlot.findMany.mockResolvedValue([row('s1')]);

      const { data } = await service.mySchedule(
        user(UserRole.GUARDIAN),
        '2026-11-02',
      );

      expect(
        data.groups.map((group) => [group.kind, group.title, group.subtitle]),
      ).toEqual([
        ['STUDENT', 'Ayesha', 'Grade 5, section A'],
        ['STUDENT', 'Zara', 'Grade 5, section A'],
      ]);
    });

    it('gives nothing when the family has no students, or the institution has no current year', async () => {
      ownedMock.resolveOwnedStudentIds.mockResolvedValue([]);
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      expect(
        (await service.mySchedule(user(UserRole.STUDENT))).data.groups,
      ).toEqual([]);

      ownedMock.resolveOwnedStudentIds.mockResolvedValue(['s-a']);
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: null,
      });
      expect(
        (await service.mySchedule(user(UserRole.STUDENT))).data.groups,
      ).toEqual([]);
      expect(prismaMock.studentEnrollment.findMany).not.toHaveBeenCalled();
    });

    it('gives a teacher their own week, and anyone without a teaching profile nothing', async () => {
      prismaMock.staffProfile.findFirst.mockResolvedValue({ id: 't1' });
      prismaMock.staffProfile.findUnique.mockResolvedValue({
        designation: 'Teacher',
        user: { name: 'Teacher One' },
      });
      const teacher = await service.mySchedule(
        user(UserRole.STAFF),
        '2026-11-02',
      );
      expect(teacher.data.groups[0]).toMatchObject({
        kind: 'TEACHER',
        id: 't1',
      });

      prismaMock.staffProfile.findFirst.mockResolvedValue(null);
      const nobody = await service.mySchedule(
        user(UserRole.ADMIN),
        '2026-11-02',
      );
      expect(nobody.data.groups).toEqual([]);
    });

    it('uses the current week when no date is given', async () => {
      prismaMock.staffProfile.findFirst.mockResolvedValue(null);

      const { data } = await service.mySchedule(user(UserRole.STAFF));

      expect(data.week.from <= data.week.to).toBe(true);
      expect(data.week.dates.MONDAY).toBe(data.week.from);
    });
  });
});
