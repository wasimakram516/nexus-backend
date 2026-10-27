/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers are typed any */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { TimezoneResolverService } from '../../common/services/timezone-resolver.service';
import { AttendanceStatus, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceReportsService } from './attendance-reports.service';
import { ReportsAccessService } from './reports-access.service';

describe('AttendanceReportsService', () => {
  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'a@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const prismaMock = {
    section: { findUnique: jest.fn() },
    institution: { findUnique: jest.fn() },
    studentEnrollment: { findMany: jest.fn() },
    attendance: { findMany: jest.fn(), groupBy: jest.fn() },
    user: { findMany: jest.fn() },
    student: { findMany: jest.fn() },
  };
  const accessMock = { resolve: jest.fn() };
  const service = new AttendanceReportsService(
    prismaMock as unknown as PrismaService,
    accessMock as unknown as ReportsAccessService,
    new TimezoneResolverService(prismaMock as unknown as PrismaService),
  );

  const scopeOf = (...campuses: [string, string][]) => ({
    institutionId: 'inst-1',
    campuses: campuses.map(([id, name]) => ({
      id,
      name,
      timezone: 'Asia/Karachi',
    })),
  });

  beforeEach(() => {
    jest.resetAllMocks();
    accessMock.resolve.mockResolvedValue(scopeOf(['c1', 'Main']));
  });

  describe('monthlyRegister', () => {
    const student = (userId: string, name: string, regNo: string) => ({
      student: { userId, regNo, user: { name } },
    });
    const mark = (userId: string, date: string, status: AttendanceStatus) => ({
      userId,
      date: new Date(`${date}T00:00:00.000Z`),
      status,
    });

    beforeEach(() => {
      prismaMock.section.findUnique.mockResolvedValue({
        name: 'A',
        classId: 'class-1',
        class: { name: 'Grade 5', level: { campusId: 'c1' } },
      });
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        student('u2', 'Bilal', 'R-2'),
        student('u1', 'Ayesha', 'R-1'),
      ]);
      prismaMock.attendance.findMany.mockResolvedValue([
        mark('u1', '2026-10-01', AttendanceStatus.PRESENT),
        mark('u1', '2026-10-02', AttendanceStatus.LATE),
        mark('u1', '2026-10-05', AttendanceStatus.ABSENT),
        mark('u1', '2026-10-06', AttendanceStatus.LEAVE),
        mark('u2', '2026-10-01', AttendanceStatus.ABSENT),
      ]);
    });

    it('makes a row per student in name order with a letter for each marked day and the counts', async () => {
      const table = await service.monthlyRegister(admin, {
        sectionId: 'sec-1',
        month: '2026-10',
      });

      expect(table.title).toBe('Attendance register, Grade 5 section A');
      expect(table.subtitle).toBe('October 2026');
      expect(table.campusId).toBe('c1');
      expect(table.rows.map((row) => row.name)).toEqual(['Ayesha', 'Bilal']);
      expect(table.rows[0]).toMatchObject({
        regNo: 'R-1',
        d1: 'P',
        d2: 'L',
        d3: '',
        d5: 'A',
        d6: 'V',
        present: 2,
        late: 1,
        absent: 1,
        leave: 1,
        attendance: 66.7,
      });
      expect(table.rows[1]).toMatchObject({
        d1: 'A',
        absent: 1,
        attendance: 0,
      });
      expect(table.columns.filter((c) => /^d\d+$/.test(c.key))).toHaveLength(
        31,
      );
    });

    it('asks only for daily student marks of this section’s current-year students in the month', async () => {
      await service.monthlyRegister(admin, {
        sectionId: 'sec-1',
        month: '2026-02',
      });

      expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sectionId: 'sec-1',
            academicYearId: 'year-1',
            status: 'ACTIVE',
          }),
        }),
      );
      expect(prismaMock.attendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: { in: ['u1', 'u2'] },
            role: UserRole.STUDENT,
            periodKey: 'DAILY',
            date: {
              gte: new Date('2026-02-01T00:00:00.000Z'),
              lte: new Date('2026-02-28T00:00:00.000Z'),
            },
          }),
        }),
      );
    });

    it('checks the campus of the section, and says when it does not exist', async () => {
      await service.monthlyRegister(admin, {
        sectionId: 'sec-1',
        month: '2026-10',
      });
      expect(accessMock.resolve).toHaveBeenCalledWith(admin, {
        institutionId: undefined,
        campusId: 'c1',
      });

      prismaMock.section.findUnique.mockResolvedValue(null);
      await expect(
        service.monthlyRegister(admin, { sectionId: 'nope', month: '2026-10' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('shows a student with no marks as a row of blanks, and an empty section as no rows', async () => {
      prismaMock.attendance.findMany.mockResolvedValue([]);
      const quiet = await service.monthlyRegister(admin, {
        sectionId: 'sec-1',
        month: '2026-10',
      });
      expect(quiet.rows[0]).toMatchObject({
        d1: '',
        present: 0,
        attendance: 0,
      });

      prismaMock.studentEnrollment.findMany.mockResolvedValue([]);
      const empty = await service.monthlyRegister(admin, {
        sectionId: 'sec-1',
        month: '2026-10',
      });
      expect(empty.rows).toEqual([]);
    });
  });

  describe('staffSummary', () => {
    it('adds up each person per campus with their half days and a percentage that leaves leave out', async () => {
      accessMock.resolve.mockResolvedValue(
        scopeOf(['c1', 'Main'], ['c2', 'North']),
      );
      prismaMock.attendance.groupBy
        .mockResolvedValueOnce([
          row('t1', 'c1', UserRole.STAFF, AttendanceStatus.PRESENT, 16),
          row('t1', 'c1', UserRole.STAFF, AttendanceStatus.LATE, 2),
          row('t1', 'c1', UserRole.STAFF, AttendanceStatus.ABSENT, 2),
          row('t1', 'c1', UserRole.STAFF, AttendanceStatus.LEAVE, 3),
          row('a1', 'c2', UserRole.ADMIN, AttendanceStatus.PRESENT, 10),
        ])
        .mockResolvedValueOnce([
          { userId: 't1', campusId: 'c1', _count: { _all: 1 } },
        ]);
      prismaMock.user.findMany.mockResolvedValue([
        { id: 't1', name: 'Teacher One' },
        { id: 'a1', name: 'Admin One' },
      ]);

      const table = await service.staffSummary(admin, {
        from: '2026-10-01',
        to: '2026-10-31',
      });

      expect(table.subtitle).toBe('1 Oct 2026 to 31 Oct 2026, All campuses');
      expect(table.campusId).toBeNull();
      expect(table.rows).toEqual([
        {
          name: 'Teacher One',
          role: 'Staff',
          campus: 'Main',
          present: 18,
          late: 2,
          absent: 2,
          leave: 3,
          halfDays: 1,
          attendance: 90,
        },
        {
          name: 'Admin One',
          role: 'Administrator',
          campus: 'North',
          present: 10,
          late: 0,
          absent: 0,
          leave: 0,
          halfDays: 0,
          attendance: 100,
        },
      ]);
      expect(prismaMock.attendance.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            campusId: { in: ['c1', 'c2'] },
            role: { in: [UserRole.STAFF, UserRole.ADMIN] },
            periodKey: 'DAILY',
          }),
        }),
      );
    });

    it('names the campus when one is chosen and refuses a bad period', async () => {
      prismaMock.attendance.groupBy.mockResolvedValue([]);
      prismaMock.user.findMany.mockResolvedValue([]);

      const table = await service.staffSummary(admin, {
        campusId: 'c1',
        from: '2026-10-01',
        to: '2026-10-31',
      });
      expect(table.campusId).toBe('c1');
      expect(table.subtitle).toContain('Main');

      await expect(
        service.staffSummary(admin, { from: '2026-10-31', to: '2026-10-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    function row(
      userId: string,
      campusId: string,
      role: UserRole,
      status: AttendanceStatus,
      count: number,
    ) {
      return { userId, campusId, role, status, _count: { _all: count } };
    }
  });

  describe('chronicAbsentees', () => {
    const counts = (userId: string, status: AttendanceStatus, n: number) => ({
      userId,
      status,
      _count: { _all: n },
    });

    beforeEach(() => {
      prismaMock.attendance.groupBy.mockResolvedValue([
        counts('u1', AttendanceStatus.PRESENT, 12),
        counts('u1', AttendanceStatus.ABSENT, 8),
        counts('u2', AttendanceStatus.PRESENT, 18),
        counts('u2', AttendanceStatus.ABSENT, 2),
        counts('u3', AttendanceStatus.ABSENT, 3),
        counts('u3', AttendanceStatus.PRESENT, 1),
        counts('u4', AttendanceStatus.ABSENT, 6),
        counts('u4', AttendanceStatus.LEAVE, 30),
        counts('u4', AttendanceStatus.LATE, 4),
      ]);
      prismaMock.student.findMany.mockResolvedValue([
        {
          id: 's1',
          userId: 'u1',
          regNo: 'R-1',
          campusId: 'c1',
          user: { name: 'Ayesha' },
        },
        {
          id: 's4',
          userId: 'u4',
          regNo: 'R-4',
          campusId: 'c1',
          user: { name: 'Danish' },
        },
      ]);
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        { studentId: 's1', class: { name: 'Grade 5' }, section: { name: 'A' } },
      ]);
    });

    it('lists students absent on at least the threshold of marked days, worst first, leaving out leave days and thin data', async () => {
      const table = await service.chronicAbsentees(admin, {
        from: '2026-10-01',
        to: '2026-10-31',
      });

      expect(table.rows.map((row) => row.name)).toEqual(['Danish', 'Ayesha']);
      expect(table.rows[1]).toMatchObject({
        regNo: 'R-1',
        className: 'Grade 5',
        sectionName: 'A',
        campus: 'Main',
        marked: 20,
        absent: 8,
        absentPercent: 40,
      });
      // Leave days are not counted: 6 absent of 10 marked (absent + late).
      expect(table.rows[0]).toMatchObject({
        marked: 10,
        absent: 6,
        late: 4,
        absentPercent: 60,
      });
      expect(prismaMock.student.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: { in: ['u1', 'u4'] }, deletedAt: null },
        }),
      );
      expect(table.subtitle).toContain('at least 20% of days marked');
    });

    it('uses the threshold it is given', async () => {
      const table = await service.chronicAbsentees(admin, {
        from: '2026-10-01',
        to: '2026-10-31',
        thresholdPercent: 50,
      });

      expect(table.rows.map((row) => row.name)).toEqual(['Danish']);
    });

    it('lists nobody when nobody qualifies', async () => {
      prismaMock.attendance.groupBy.mockResolvedValue([]);
      prismaMock.student.findMany.mockResolvedValue([]);

      const table = await service.chronicAbsentees(admin, {});

      expect(table.rows).toEqual([]);
    });
  });
});
