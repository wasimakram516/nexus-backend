import { NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ExamStatus, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeExamOutcome,
  DEFAULT_PASS_POLICY,
  ResultLite,
} from '../examinations/exam-computation';
import {
  ExamContext,
  ExamResultsViewService,
  StudentOutcome,
} from '../examinations/exam-results-view.service';
import { ExamReportsService } from './exam-reports.service';
import { ReportsAccessService } from './reports-access.service';

describe('ExamReportsService', () => {
  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'a@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };
  const papers = [
    {
      examSubjectId: 'p-maths',
      subjectId: 's1',
      subjectName: 'Maths',
      maxMarks: 100,
      passingMarks: 40,
    },
    {
      examSubjectId: 'p-eng',
      subjectId: 's2',
      subjectName: 'English',
      maxMarks: 50,
      passingMarks: 20,
    },
  ];
  const bands = [
    { grade: 'A', minPercentage: 80, maxPercentage: 100, remarks: null },
    { grade: 'B', minPercentage: 50, maxPercentage: 79.99, remarks: null },
    { grade: 'F', minPercentage: 0, maxPercentage: 49.99, remarks: null },
  ];
  const exam: ExamContext = {
    id: 'exam-1',
    name: 'Midterm',
    classId: 'class-1',
    campusId: 'c1',
    institutionId: 'inst-1',
    academicYearId: 'y1',
    examTermId: 't1',
    status: ExamStatus.PUBLISHED,
    examType: 'REGULAR',
    originalExamId: null,
    papers,
    bands,
    policy: DEFAULT_PASS_POLICY,
  };

  const student = (
    id: string,
    name: string,
    results: Record<string, ResultLite>,
  ): StudentOutcome => ({
    studentId: id,
    name,
    regNo: `R-${id}`,
    sectionId: 'sec-a',
    sectionName: 'A',
    outcome: computeExamOutcome(
      papers,
      new Map(Object.entries(results)),
      bands,
      DEFAULT_PASS_POLICY,
    ),
    positionInClass: null,
    classSize: 0,
    positionInSection: null,
    sectionSize: 0,
  });
  const marks = (value: number): ResultLite => ({
    marksObtained: value,
    isAbsent: false,
  });
  const absent: ResultLite = { marksObtained: null, isAbsent: true };

  // Ayesha passes with an A, Bilal fails Maths, Cyrus missed Maths and fails English, Dina is waiting on English.
  const students = [
    student('1', 'Ayesha', { 'p-maths': marks(90), 'p-eng': marks(45) }),
    student('2', 'Bilal', { 'p-maths': marks(30), 'p-eng': marks(30) }),
    student('3', 'Cyrus', { 'p-maths': absent, 'p-eng': marks(10) }),
    student('4', 'Dina', { 'p-maths': marks(70) }),
  ];

  const prismaMock = { exam: { findUnique: jest.fn(), findMany: jest.fn() } };
  const accessMock = { resolve: jest.fn() };
  const resultsMock = {
    loadExam: jest.fn(),
    computeStudentOutcomes: jest.fn(),
  };
  const service = new ExamReportsService(
    prismaMock as unknown as PrismaService,
    accessMock as unknown as ReportsAccessService,
    resultsMock as unknown as ExamResultsViewService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    accessMock.resolve.mockResolvedValue({
      institutionId: 'inst-1',
      campuses: [{ id: 'c1', name: 'Main', timezone: 'Asia/Karachi' }],
    });
    resultsMock.loadExam.mockResolvedValue(exam);
    resultsMock.computeStudentOutcomes.mockResolvedValue(students);
    prismaMock.exam.findUnique.mockResolvedValue({
      name: 'Midterm',
      class: { name: 'Grade 5' },
      examTerm: { name: 'Term 1' },
    });
  });

  it('names each exam so repeats across classes and terms can be told apart', async () => {
    prismaMock.exam.findMany.mockResolvedValue([
      {
        id: 'e1',
        name: 'Midterm',
        status: ExamStatus.PUBLISHED,
        campus: { name: 'Main' },
        class: { name: 'Grade 5' },
        examTerm: { name: 'Term 1' },
      },
      {
        id: 'e2',
        name: 'Final',
        status: ExamStatus.DRAFT,
        campus: { name: 'Main' },
        class: { name: 'Grade 6' },
        examTerm: { name: 'Term 2' },
      },
    ]);

    await expect(service.options(admin, {})).resolves.toEqual([
      { id: 'e1', label: 'Midterm · Grade 5 · Term 1' },
      { id: 'e2', label: 'Final · Grade 6 · Term 2 · draft' },
    ]);
    expect(prismaMock.exam.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campusId: { in: ['c1'] }, deletedAt: null },
      }),
    );
  });

  it('adds the campus to an exam name when the administrator has several', async () => {
    accessMock.resolve.mockResolvedValue({
      institutionId: 'inst-1',
      campuses: [
        { id: 'c1', name: 'Main', timezone: 'Asia/Karachi' },
        { id: 'c2', name: 'North', timezone: 'Asia/Karachi' },
      ],
    });
    prismaMock.exam.findMany.mockResolvedValue([
      {
        id: 'e1',
        name: 'Midterm',
        status: ExamStatus.PUBLISHED,
        campus: { name: 'North' },
        class: { name: 'Grade 5' },
        examTerm: { name: 'Term 1' },
      },
    ]);

    await expect(service.options(admin, {})).resolves.toEqual([
      { id: 'e1', label: 'Midterm · Grade 5 · Term 1 · North' },
    ]);
  });

  it('summarises each paper without scoring an absence as zero', async () => {
    const table = await service.subjectResults(admin, { examId: 'exam-1' });

    expect(table.subtitle).toBe('Midterm, Term 1, Grade 5, Main');
    expect(table.campusId).toBe('c1');
    expect(table.rows).toEqual([
      {
        subject: 'Maths',
        maxMarks: 100,
        passingMarks: 40,
        appeared: 3,
        absent: 1,
        awaiting: 0,
        passed: 2,
        failed: 1,
        passPercent: 66.7,
        averagePercent: 63.3,
        highest: 90,
        lowest: 30,
      },
      {
        subject: 'English',
        maxMarks: 50,
        passingMarks: 20,
        appeared: 4,
        absent: 0,
        awaiting: 1,
        passed: 2,
        failed: 1,
        passPercent: 66.7,
        averagePercent: 56.7,
        highest: 45,
        lowest: 10,
      },
    ]);
  });

  it('counts students per grade, leaving out anyone whose marks are incomplete', async () => {
    const table = await service.gradeDistribution(admin, { examId: 'exam-1' });

    expect(table.rows).toEqual([
      { grade: 'A', range: '80 to 100%', students: 1, share: 25 },
      { grade: 'B', range: '50 to 79.99%', students: 0, share: 0 },
      { grade: 'F', range: '0 to 49.99%', students: 2, share: 50 },
      {
        grade: 'Not graded',
        range: 'Absent, or marks still to enter',
        students: 1,
        share: 25,
      },
    ]);
    expect(table.totals).toEqual({ grade: 'Total', students: 4, share: 100 });
    expect(table.notes[0]).toBe(
      'Overall result: 1 passed, 2 failed, 1 with marks still to enter, 0 absent for every paper.',
    );
  });

  it('lists failing students lowest first with the papers they failed', async () => {
    const table = await service.failedStudents(admin, { examId: 'exam-1' });

    expect(table.rows).toEqual([
      {
        name: 'Cyrus',
        regNo: 'R-3',
        sectionName: 'A',
        percentage: 20,
        failedPapers: 1,
        subjects: 'English',
      },
      {
        name: 'Bilal',
        regNo: 'R-2',
        sectionName: 'A',
        percentage: 40,
        failedPapers: 1,
        subjects: 'Maths',
      },
    ]);
    expect(table.totals).toEqual({ name: 'Total, 2 students' });
  });

  it('warns when the exam is not published', async () => {
    resultsMock.loadExam.mockResolvedValue({
      ...exam,
      status: ExamStatus.DRAFT,
    });

    const table = await service.subjectResults(admin, { examId: 'exam-1' });

    expect(table.notes[0]).toContain('not published yet');
  });

  it('says an exam at a campus the administrator cannot report on does not exist', async () => {
    resultsMock.loadExam.mockResolvedValue({ ...exam, campusId: 'other' });

    await expect(
      service.gradeDistribution(admin, { examId: 'exam-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('says an exam from another institution does not exist', async () => {
    resultsMock.loadExam.mockResolvedValue({
      ...exam,
      institutionId: 'inst-2',
    });

    await expect(
      service.failedStudents(admin, { examId: 'exam-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
