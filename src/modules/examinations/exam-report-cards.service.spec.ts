import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { PrintableMetaService } from '../../common/services/printable-meta.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamReportCardsService } from './exam-report-cards.service';
import { ExamResultsViewService } from './exam-results-view.service';

describe('ExamReportCardsService', () => {
  let service: ExamReportCardsService;

  const user = (role: UserRole, sub: string): CurrentUser => ({
    sub,
    email: `${sub}@nexus.test`,
    role,
    institutionId: 'inst-1',
  });
  const admin = user(UserRole.ADMIN, 'admin-1');
  const staff = user(UserRole.STAFF, 'staff-1');
  const student = user(UserRole.STUDENT, 'u-ayesha');

  const prismaMock = {
    academicYear: { findUnique: jest.fn() },
    academicClass: { findUnique: jest.fn() },
    exam: { findMany: jest.fn() },
    studentEnrollment: { findMany: jest.fn(), findFirst: jest.fn() },
    institutionSetting: { findUnique: jest.fn() },
    examResult: { findMany: jest.fn() },
  };
  const moduleAccessMock = {
    assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
  };
  const campusAccessMock = {
    assertCampusAccess: jest.fn().mockResolvedValue(undefined),
  };
  const permissionsMock = { can: jest.fn().mockResolvedValue(true) };
  const metaMock = {
    build: jest.fn((documentType: string) => Promise.resolve({ documentType })),
  };
  const viewMock = { resolveOwnedStudentIds: jest.fn() };

  const bands = [
    { grade: 'A', minPercentage: '80', maxPercentage: '100', remarks: null },
    { grade: 'F', minPercentage: '0', maxPercentage: '79.99', remarks: null },
  ];
  const paper = (
    id: string,
    subjectId: string,
    name: string,
    max = 100,
    pass = 40,
  ) => ({
    id,
    subjectId,
    maxMarks: String(max),
    passingMarks: String(pass),
    subject: { name },
  });
  const exam = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: id,
    examType: 'REGULAR',
    status: 'PUBLISHED',
    originalExamId: null,
    createdAt: new Date('2026-09-01'),
    examTerm: {
      id: `term-${id}`,
      name: `Term ${id}`,
      weight: '1',
      sortOrder: 1,
    },
    gradingScale: { bands },
    subjects: [paper(`${id}-m`, 'maths', 'Maths')],
    ...overrides,
  });
  const result = (
    examSubjectId: string,
    marks: number | null,
    isAbsent = false,
  ) => ({
    examSubjectId,
    studentId: 's-ayesha',
    marksObtained: marks === null ? null : String(marks),
    isAbsent,
  });

  const arrange = (exams: unknown[], results: unknown[]) => {
    prismaMock.exam.findMany.mockResolvedValue(exams);
    prismaMock.examResult.findMany.mockResolvedValue(results);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.academicYear.findUnique.mockResolvedValue({
      name: '2026-27',
      institutionId: 'inst-1',
    });
    prismaMock.academicClass.findUnique.mockResolvedValue({
      name: 'Grade 5',
      level: { campusId: 'campus-1' },
    });
    prismaMock.studentEnrollment.findFirst.mockResolvedValue({
      classId: 'class-1',
      campusId: 'campus-1',
    });
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      {
        sectionId: 'sec-a',
        section: { name: 'A' },
        student: {
          id: 's-ayesha',
          regNo: 'R-1',
          picture: null,
          user: { name: 'Ayesha' },
        },
      },
      {
        sectionId: 'sec-a',
        section: { name: 'A' },
        student: {
          id: 's-bilal',
          regNo: 'R-2',
          picture: null,
          user: { name: 'Bilal' },
        },
      },
    ]);
    prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
    permissionsMock.can.mockResolvedValue(true);
    viewMock.resolveOwnedStudentIds.mockResolvedValue(['s-ayesha']);
    arrange([exam('e1')], [result('e1-m', 90)]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExamReportCardsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ModuleAccessService, useValue: moduleAccessMock },
        { provide: CampusAccessService, useValue: campusAccessMock },
        { provide: UserPermissionsService, useValue: permissionsMock },
        { provide: PrintableMetaService, useValue: metaMock },
        { provide: ExamResultsViewService, useValue: viewMock },
      ],
    }).compile();
    service = moduleRef.get(ExamReportCardsService);
  });

  const cardOf = async (studentId = 's-ayesha') =>
    (await service.getReportCard(admin, studentId, 'year-1')).data;

  it('shows a published regular exam term with its grade, and the print header', async () => {
    const card = await cardOf();

    expect(card.student).toMatchObject({
      name: 'Ayesha',
      className: 'Grade 5',
      sectionName: 'A',
    });
    expect(card.terms).toHaveLength(1);
    expect(card.terms[0].outcome).toMatchObject({
      percentage: 90,
      grade: 'A',
      status: 'PASS',
    });
    expect(metaMock.build).toHaveBeenCalledWith(
      'REPORT_CARD',
      'inst-1',
      'campus-1',
    );
  });

  it('leaves out draft exams entirely, and retake exams as terms of their own', async () => {
    arrange(
      [
        exam('e1'),
        exam('draft', { status: 'DRAFT' }),
        exam('r1', { examType: 'RETAKE', originalExamId: 'e1' }),
      ],
      [result('e1-m', 90)],
    );

    const card = await cardOf();

    expect(card.terms.map((t) => t.exam.id)).toEqual(['e1']);
  });

  it('orders terms by their sort order', async () => {
    arrange(
      [
        exam('late', {
          examTerm: { id: 't2', name: 'Final', weight: '1', sortOrder: 2 },
        }),
        exam('early', {
          examTerm: { id: 't1', name: 'Mid', weight: '1', sortOrder: 1 },
        }),
      ],
      [result('late-m', 70), result('early-m', 80)],
    );

    const card = await cardOf();

    expect(card.terms.map((t) => t.term.name)).toEqual(['Mid', 'Final']);
  });

  describe('retake substitution', () => {
    const retake = (
      id: string,
      createdAt: string,
      overrides: Record<string, unknown> = {},
    ) =>
      exam(id, {
        examType: 'RETAKE',
        originalExamId: 'e1',
        createdAt: new Date(createdAt),
        ...overrides,
      });

    it('uses a published retake mark and keeps the original mark and grade beside it', async () => {
      arrange(
        [exam('e1'), retake('r1', '2026-10-01')],
        [result('e1-m', 30), result('r1-m', 85)],
      );

      const [maths] = (await cardOf()).terms[0].outcome.subjects;

      expect(maths).toMatchObject({
        marksObtained: 85,
        grade: 'A',
        isRetake: true,
        retakeExamId: 'r1',
        retakeExamType: 'RETAKE',
        originalMarksObtained: 30,
        originalPercentage: 30,
        originalGrade: 'F',
      });
    });

    it('prefers the most recently created retake', async () => {
      arrange(
        [exam('e1'), retake('old', '2026-10-01'), retake('new', '2026-11-01')],
        [result('e1-m', 30), result('old-m', 50), result('new-m', 70)],
      );

      expect((await cardOf()).terms[0].outcome.subjects[0]).toMatchObject({
        marksObtained: 70,
        retakeExamId: 'new',
      });
    });

    it('falls back to an older retake when the newest one has no mark for the student', async () => {
      arrange(
        [exam('e1'), retake('old', '2026-10-01'), retake('new', '2026-11-01')],
        [result('e1-m', 30), result('old-m', 50)],
      );

      expect((await cardOf()).terms[0].outcome.subjects[0].retakeExamId).toBe(
        'old',
      );
    });

    it('does not substitute when the student was absent for the retake', async () => {
      arrange(
        [exam('e1'), retake('r1', '2026-10-01')],
        [result('e1-m', 30), result('r1-m', null, true)],
      );

      expect((await cardOf()).terms[0].outcome.subjects[0]).toMatchObject({
        marksObtained: 30,
        isRetake: false,
        originalMarksObtained: null,
      });
    });

    it('ignores an unpublished retake', async () => {
      arrange(
        [exam('e1'), retake('r1', '2026-10-01', { status: 'DRAFT' })],
        [result('e1-m', 30), result('r1-m', 85)],
      );

      expect((await cardOf()).terms[0].outcome.subjects[0].marksObtained).toBe(
        30,
      );
    });

    it('uses the retake paper maximum for the substituted subject', async () => {
      arrange(
        [
          exam('e1'),
          retake('r1', '2026-10-01', {
            subjects: [paper('r1-m', 'maths', 'Maths', 50, 20)],
          }),
        ],
        [result('e1-m', 30), result('r1-m', 45)],
      );

      expect((await cardOf()).terms[0].outcome.subjects[0]).toMatchObject({
        marksObtained: 45,
        maxMarks: 50,
        percentage: 90,
      });
    });

    it('follows a retake of a retake back to the original exam', async () => {
      arrange(
        [
          exam('e1'),
          retake('r1', '2026-10-01'),
          retake('r2', '2026-11-01', { originalExamId: 'r1' }),
        ],
        [result('e1-m', 30), result('r1-m', 50), result('r2-m', 75)],
      );

      expect((await cardOf()).terms[0].outcome.subjects[0].retakeExamId).toBe(
        'r2',
      );
    });
  });

  describe('annual figures', () => {
    const twoTerms = (weights: [number, number]) =>
      [
        exam('e1', {
          examTerm: {
            id: 't1',
            name: 'T1',
            weight: String(weights[0]),
            sortOrder: 1,
          },
        }),
        exam('e2', {
          examTerm: {
            id: 't2',
            name: 'T2',
            weight: String(weights[1]),
            sortOrder: 2,
          },
        }),
      ] as unknown[];

    it('weights each term by its weight', async () => {
      arrange(twoTerms([1, 3]), [result('e1-m', 40), result('e2-m', 80)]);

      const { annual } = await cardOf();

      // (40 x 1 + 80 x 3) / 4
      expect(annual?.percentage).toBe(70);
      expect(annual?.subjects[0].percentage).toBe(70);
    });

    it('averages equally when weights are equal', async () => {
      arrange(twoTerms([1, 1]), [result('e1-m', 60), result('e2-m', 90)]);

      expect((await cardOf()).annual?.percentage).toBe(75);
    });

    it('applies the same pass policy as a single exam', async () => {
      arrange(twoTerms([1, 1]), [result('e1-m', 30), result('e2-m', 60)]);
      // 45% against a 40% subject pass line.
      expect((await cardOf()).annual).toMatchObject({
        isOverallPass: true,
        status: 'PASS',
      });

      arrange(twoTerms([1, 1]), [result('e1-m', 20), result('e2-m', 50)]);
      // 35%.
      expect((await cardOf()).annual).toMatchObject({
        isOverallPass: false,
        status: 'FAIL',
      });
    });

    it('uses the institution aggregate policy when configured', async () => {
      prismaMock.institutionSetting.findUnique.mockResolvedValue({
        value: { passPolicy: 'AGGREGATE', aggregatePassPercentage: 30 },
      });
      arrange(twoTerms([1, 1]), [result('e1-m', 20), result('e2-m', 50)]);

      expect((await cardOf()).annual).toMatchObject({
        percentage: 35,
        isOverallPass: true,
      });
    });

    it('is not judged while a term still has marks outstanding', async () => {
      arrange(twoTerms([1, 1]), [result('e1-m', 90)]);

      expect((await cardOf()).annual).toMatchObject({
        isOverallPass: null,
        status: 'INCOMPLETE',
      });
    });

    it('is null when nothing is marked yet', async () => {
      arrange(twoTerms([1, 1]), []);

      expect((await cardOf()).annual).toBeNull();
    });

    it('is null with no published exam at all', async () => {
      arrange([exam('draft', { status: 'DRAFT' })], []);

      const card = await cardOf();

      expect(card.terms).toEqual([]);
      expect(card.annual).toBeNull();
    });
  });

  describe('positions', () => {
    it('come from each exam own literal marks, not from substituted ones', async () => {
      prismaMock.examResult.findMany.mockResolvedValue([
        result('e1-m', 40),
        { ...result('e1-m', 60), studentId: 's-bilal' },
        { ...result('r1-m', 99), examSubjectId: 'r1-m' },
      ]);
      prismaMock.exam.findMany.mockResolvedValue([
        exam('e1'),
        exam('r1', { examType: 'RETAKE', originalExamId: 'e1' }),
      ]);

      const card = await cardOf();

      // Ayesha's effective mark is the retake's 99, yet she is still second
      // on the exam's own results (40 against Bilal's 60).
      expect(card.terms[0].outcome.percentage).toBe(99);
      expect(card.terms[0]).toMatchObject({ positionInClass: 2, classSize: 2 });
    });
  });

  describe('access', () => {
    it('lets a student read their own card but not a classmate card', async () => {
      await expect(
        service.getReportCard(student, 's-ayesha', 'year-1'),
      ).resolves.toBeDefined();
      prismaMock.studentEnrollment.findFirst.mockResolvedValue({
        classId: 'class-1',
        campusId: 'campus-1',
      });
      await expect(
        service.getReportCard(student, 's-bilal', 'year-1'),
      ).rejects.toThrow(/only view your own report card/);
    });

    it('requires the results permission for staff', async () => {
      permissionsMock.can.mockResolvedValue(false);

      await expect(
        service.getReportCard(staff, 's-ayesha', 'year-1'),
      ).rejects.toThrow(/read permission for exam results/);
    });

    it('404s for a student with no enrollment that year, and 404s a missing card', async () => {
      prismaMock.studentEnrollment.findFirst.mockResolvedValue(null);
      await expect(
        service.getReportCard(admin, 's-ayesha', 'year-1'),
      ).rejects.toThrow(NotFoundException);

      prismaMock.studentEnrollment.findFirst.mockResolvedValue({
        classId: 'class-1',
        campusId: 'campus-1',
      });
      await expect(
        service.getReportCard(admin, 's-stranger', 'year-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getReportCards (batch)', () => {
    it('builds every student card from one load of the class, ordered by name', async () => {
      const { data } = await service.getReportCards(admin, 'year-1', 'class-1');

      expect(data.cards.map((c) => c.student.name)).toEqual([
        'Ayesha',
        'Bilal',
      ]);
      expect(prismaMock.exam.findMany).toHaveBeenCalledTimes(1);
      expect(metaMock.build).toHaveBeenCalledTimes(1);
    });

    it('limits the batch to a section', async () => {
      const { data } = await service.getReportCards(
        admin,
        'year-1',
        'class-1',
        'sec-none',
      );

      expect(data.cards).toEqual([]);
    });

    it('is staff only, and 404s for an unknown class', async () => {
      await expect(
        service.getReportCards(student, 'year-1', 'class-1'),
      ).rejects.toThrow(/Only staff/);
      prismaMock.academicClass.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.getReportCards(admin, 'year-1', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects staff without campus access before loading anything', async () => {
      campusAccessMock.assertCampusAccess.mockRejectedValueOnce(
        new ForbiddenException(),
      );

      await expect(
        service.getReportCards(staff, 'year-1', 'class-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.exam.findMany).not.toHaveBeenCalled();
    });
  });
});
