import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { ModuleKey, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamResultsViewService } from './exam-results-view.service';

describe('ExamResultsViewService', () => {
  let service: ExamResultsViewService;

  const user = (role: UserRole, sub = 'user-1'): CurrentUser => ({
    sub,
    email: `${sub}@nexus.test`,
    role,
    institutionId: 'inst-1',
  });
  const admin = user(UserRole.ADMIN, 'admin-1');
  const staff = user(UserRole.STAFF, 'staff-1');
  const student = user(UserRole.STUDENT, 'user-ayesha');
  const guardian = user(UserRole.GUARDIAN, 'user-guardian');

  const prismaMock = {
    exam: { findUnique: jest.fn() },
    institutionSetting: { findUnique: jest.fn() },
    studentEnrollment: { findMany: jest.fn() },
    examResult: { findMany: jest.fn() },
    student: { findFirst: jest.fn() },
    guardian: { findFirst: jest.fn() },
    studentGuardian: { findMany: jest.fn() },
  };
  const moduleAccessMock = {
    assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
  };
  const campusAccessMock = {
    assertCampusAccess: jest.fn().mockResolvedValue(undefined),
  };
  const permissionsMock = { can: jest.fn().mockResolvedValue(true) };

  const examRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'exam-1',
    name: 'First Term',
    classId: 'class-1',
    campusId: 'campus-1',
    academicYearId: 'year-1',
    examTermId: 'term-1',
    status: 'PUBLISHED',
    examType: 'REGULAR',
    originalExamId: null,
    campus: { institutionId: 'inst-1' },
    gradingScale: {
      bands: [
        {
          grade: 'A',
          minPercentage: '80',
          maxPercentage: '100',
          remarks: 'Top',
        },
        {
          grade: 'F',
          minPercentage: '0',
          maxPercentage: '79.99',
          remarks: 'Below',
        },
      ],
    },
    subjects: [
      {
        id: 'paper-m',
        subjectId: 'sub-m',
        maxMarks: '100',
        passingMarks: '40',
        subject: { name: 'Maths' },
      },
    ],
    ...overrides,
  });

  const enrollment = (
    id: string,
    name: string,
    regNo: string,
    section: string,
  ) => ({
    sectionId: section,
    section: { name: section.toUpperCase() },
    student: { id, regNo, user: { name } },
  });
  const result = (
    studentId: string,
    marks: number | null,
    isAbsent = false,
  ) => ({
    examSubjectId: 'paper-m',
    studentId,
    marksObtained: marks === null ? null : String(marks),
    isAbsent,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.exam.findUnique.mockResolvedValue(examRow());
    prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      enrollment('s-ayesha', 'Ayesha', 'R-1', 'sec-a'),
      enrollment('s-bilal', 'Bilal', 'R-2', 'sec-a'),
      enrollment('s-sara', 'Sara', 'R-3', 'sec-b'),
      enrollment('s-omar', 'Omar', 'R-4', 'sec-b'),
    ]);
    prismaMock.examResult.findMany.mockResolvedValue([
      result('s-ayesha', 90),
      result('s-bilal', 90),
      result('s-sara', 30),
      result('s-omar', null, true),
    ]);
    permissionsMock.can.mockResolvedValue(true);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExamResultsViewService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ModuleAccessService, useValue: moduleAccessMock },
        { provide: CampusAccessService, useValue: campusAccessMock },
        { provide: UserPermissionsService, useValue: permissionsMock },
      ],
    }).compile();
    service = moduleRef.get(ExamResultsViewService);
  });

  describe('getClassSummary', () => {
    it('computes each student with grade, status and ties sharing a class position', async () => {
      const { data } = await service.getClassSummary(admin, 'exam-1');

      expect(moduleAccessMock.assertModuleEnabledForUser).toHaveBeenCalledWith(
        admin,
        ModuleKey.EXAMINATIONS,
      );
      const byName = Object.fromEntries(
        data.students.map((row) => [row.name, row]),
      );
      expect(byName.Ayesha).toMatchObject({
        positionInClass: 1,
        classSize: 3,
        outcome: { percentage: 90, grade: 'A', status: 'PASS' },
      });
      expect(byName.Bilal.positionInClass).toBe(1);
      expect(byName.Sara).toMatchObject({
        positionInClass: 3,
        outcome: { percentage: 30, status: 'FAIL' },
      });
      expect(byName.Omar).toMatchObject({
        positionInClass: null,
        outcome: { status: 'ABSENT', percentage: null },
      });
    });

    it('ranks within each section separately', async () => {
      const { data } = await service.getClassSummary(admin, 'exam-1');

      const byName = Object.fromEntries(
        data.students.map((row) => [row.name, row]),
      );
      expect(byName.Ayesha).toMatchObject({
        positionInSection: 1,
        sectionSize: 2,
      });
      expect(byName.Sara).toMatchObject({
        positionInSection: 1,
        sectionSize: 1,
      });
    });

    it('limits the rows to one section but keeps class positions', async () => {
      const { data } = await service.getClassSummary(admin, 'exam-1', 'sec-b');

      expect(data.students.map((row) => row.name)).toEqual(['Omar', 'Sara']);
      expect(
        data.students.find((row) => row.name === 'Sara')?.positionInClass,
      ).toBe(3);
    });

    it('tallies passes, failures and absences and averages the percentages', async () => {
      const { data } = await service.getClassSummary(admin, 'exam-1');

      expect(data.summary).toEqual({
        total: 4,
        pass: 2,
        fail: 1,
        incomplete: 0,
        absent: 1,
        averagePercentage: 70,
      });
    });

    it('uses the institution pass policy from settings', async () => {
      prismaMock.institutionSetting.findUnique.mockResolvedValue({
        value: { passPolicy: 'AGGREGATE', aggregatePassPercentage: 25 },
      });

      const { data } = await service.getClassSummary(admin, 'exam-1');

      expect(data.exam.passPolicy).toBe('AGGREGATE');
      expect(
        data.students.find((row) => row.name === 'Sara')?.outcome.status,
      ).toBe('PASS');
    });

    it('lists only students who sat a retake exam', async () => {
      prismaMock.exam.findUnique.mockResolvedValue(
        examRow({ examType: 'RETAKE', originalExamId: 'exam-0' }),
      );
      prismaMock.examResult.findMany.mockResolvedValue([result('s-sara', 55)]);

      const { data } = await service.getClassSummary(admin, 'exam-1');

      expect(data.students.map((row) => row.name)).toEqual(['Sara']);
    });

    it('returns an empty, valid summary for an exam with no papers', async () => {
      prismaMock.exam.findUnique.mockResolvedValue(examRow({ subjects: [] }));

      const { data } = await service.getClassSummary(admin, 'exam-1');

      expect(prismaMock.examResult.findMany).not.toHaveBeenCalled();
      expect(data.summary.incomplete).toBe(4);
      expect(data.summary.averagePercentage).toBeNull();
    });

    it('requires the results permission and campus access for staff', async () => {
      permissionsMock.can.mockResolvedValue(false);
      await expect(service.getClassSummary(staff, 'exam-1')).rejects.toThrow(
        /read permission for exam results/,
      );

      permissionsMock.can.mockResolvedValue(true);
      campusAccessMock.assertCampusAccess.mockRejectedValueOnce(
        new ForbiddenException(),
      );
      await expect(service.getClassSummary(staff, 'exam-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('is never available to students or guardians', async () => {
      await expect(service.getClassSummary(student, 'exam-1')).rejects.toThrow(
        /Only staff/,
      );
      await expect(service.getClassSummary(guardian, 'exam-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.studentEnrollment.findMany).not.toHaveBeenCalled();
    });

    it('404s for an unknown exam', async () => {
      prismaMock.exam.findUnique.mockResolvedValue(null);

      await expect(service.getClassSummary(admin, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getStudentSummary', () => {
    it('lets a student read their own published result, with position and class size', async () => {
      prismaMock.student.findFirst.mockResolvedValue({ id: 's-ayesha' });

      const { data } = await service.getStudentSummary(
        student,
        'exam-1',
        's-ayesha',
      );

      expect(data.result).toMatchObject({
        studentId: 's-ayesha',
        positionInClass: 1,
        classSize: 3,
      });
    });

    it('never exposes another student to a student', async () => {
      prismaMock.student.findFirst.mockResolvedValue({ id: 's-ayesha' });

      await expect(
        service.getStudentSummary(student, 'exam-1', 's-bilal'),
      ).rejects.toThrow(/only view your own results/);
    });

    it('returns only the requested student, with no other student in the payload', async () => {
      prismaMock.student.findFirst.mockResolvedValue({ id: 's-ayesha' });

      const { data } = await service.getStudentSummary(
        student,
        'exam-1',
        's-ayesha',
      );

      const text = JSON.stringify(data);
      expect(text).not.toContain('Bilal');
      expect(text).not.toContain('Sara');
      expect(text).not.toContain('Omar');
    });

    it('hides an unpublished exam from the student', async () => {
      prismaMock.exam.findUnique.mockResolvedValue(
        examRow({ status: 'DRAFT' }),
      );
      prismaMock.student.findFirst.mockResolvedValue({ id: 's-ayesha' });

      await expect(
        service.getStudentSummary(student, 'exam-1', 's-ayesha'),
      ).rejects.toThrow(NotFoundException);
    });

    it('lets a guardian read a ward but not another family', async () => {
      prismaMock.guardian.findFirst.mockResolvedValue({ id: 'g-1' });
      prismaMock.studentGuardian.findMany.mockResolvedValue([
        { studentId: 's-sara' },
      ]);

      await expect(
        service.getStudentSummary(guardian, 'exam-1', 's-sara'),
      ).resolves.toBeDefined();
      await expect(
        service.getStudentSummary(guardian, 'exam-1', 's-ayesha'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a student account with no student record', async () => {
      prismaMock.student.findFirst.mockResolvedValue(null);

      await expect(
        service.getStudentSummary(student, 'exam-1', 's-ayesha'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets staff with the permission see a draft exam result', async () => {
      prismaMock.exam.findUnique.mockResolvedValue(
        examRow({ status: 'DRAFT' }),
      );

      await expect(
        service.getStudentSummary(staff, 'exam-1', 's-ayesha'),
      ).resolves.toBeDefined();
    });

    it('404s when the student has no result for this exam', async () => {
      await expect(
        service.getStudentSummary(admin, 'exam-1', 's-stranger'),
      ).rejects.toThrow(/no result for this exam/);
    });
  });
});
