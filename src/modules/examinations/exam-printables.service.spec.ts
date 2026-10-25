import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { PrintableMetaService } from '../../common/services/printable-meta.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { ModuleKey, UserRole } from '../../prisma/client';
import { PrintableCustomValuesService } from '../../common/services/printable-custom-values.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamPrintablesService } from './exam-printables.service';
import { ExamResultsViewService } from './exam-results-view.service';

describe('ExamPrintablesService', () => {
  let service: ExamPrintablesService;

  const user = (role: UserRole, sub: string): CurrentUser => ({
    sub,
    email: `${sub}@nexus.test`,
    role,
    institutionId: 'inst-1',
  });
  const admin = user(UserRole.ADMIN, 'admin-1');
  const staff = user(UserRole.STAFF, 'staff-1');
  const student = user(UserRole.STUDENT, 'u-ayesha');
  const guardian = user(UserRole.GUARDIAN, 'u-guardian');

  const prismaMock = {
    exam: { findUnique: jest.fn(), findMany: jest.fn() },
    student: { findMany: jest.fn() },
    institution: { findUnique: jest.fn() },
    studentEnrollment: { findMany: jest.fn(), count: jest.fn() },
  };
  const moduleAccessMock = {
    assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
  };
  const campusAccessMock = {
    assertCampusAccess: jest.fn().mockResolvedValue(undefined),
  };
  const permissionsMock = { can: jest.fn().mockResolvedValue(true) };
  const metaMock = {
    build: jest.fn((documentType: string) =>
      Promise.resolve({ documentType, generatedAt: 'now' }),
    ),
  };
  const viewMock = { resolveOwnedStudentIds: jest.fn() };

  const paper = (
    id: string,
    name: string,
    examDate: string | null,
    startTime: string | null,
  ) => ({
    id,
    subjectId: `sub-${id}`,
    maxMarks: '100',
    passingMarks: '40',
    examDate: examDate ? new Date(examDate) : null,
    startTime,
    endTime: null,
    room: null,
    subject: { name },
  });

  const examRow = () => ({
    id: 'exam-1',
    name: 'First Term',
    status: 'DRAFT',
    examType: 'REGULAR',
    campusId: 'campus-1',
    classId: 'class-1',
    academicYearId: 'year-1',
    campus: { institutionId: 'inst-1' },
    class: { name: 'Grade 5' },
    examTerm: { name: 'Term 1' },
    academicYear: { name: '2026-27' },
    subjects: [
      paper('u', 'Urdu', null, null),
      paper('m2', 'Maths', '2026-12-02', '10:00'),
      paper('s', 'Science', '2026-12-01', '09:00'),
      paper('m1', 'Biology', '2026-12-02', '09:00'),
    ],
  });

  const enrollment = (id: string, name: string, section: string | null) => ({
    section: section ? { name: section } : null,
    student: { id, regNo: `R-${id}`, picture: null, user: { name } },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.exam.findUnique.mockResolvedValue(examRow());
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      enrollment('s-bilal', 'Bilal', 'B'),
      enrollment('s-ayesha', 'Ayesha', 'A'),
    ]);
    prismaMock.studentEnrollment.count.mockResolvedValue(1);
    permissionsMock.can.mockResolvedValue(true);
    viewMock.resolveOwnedStudentIds.mockResolvedValue(['s-ayesha']);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExamPrintablesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ModuleAccessService, useValue: moduleAccessMock },
        { provide: CampusAccessService, useValue: campusAccessMock },
        { provide: UserPermissionsService, useValue: permissionsMock },
        { provide: PrintableMetaService, useValue: metaMock },
        { provide: ExamResultsViewService, useValue: viewMock },
        {
          provide: PrintableCustomValuesService,
          useValue: {
            forRecords: (
              _institutionId: string,
              _type: string,
              ids: string[],
            ) => Promise.resolve(new Map(ids.map((id) => [id, []]))),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(ExamPrintablesService);
  });

  describe('getDatesheet', () => {
    it('orders papers by date then start time, with undated papers last, and adds the print header', async () => {
      const { data } = await service.getDatesheet(admin, 'exam-1');

      expect(moduleAccessMock.assertModuleEnabledForUser).toHaveBeenCalledWith(
        admin,
        ModuleKey.EXAMINATIONS,
      );
      expect(data.papers.map((p) => p.subjectName)).toEqual([
        'Science',
        'Biology',
        'Maths',
        'Urdu',
      ]);
      expect(data.exam).toMatchObject({
        className: 'Grade 5',
        termName: 'Term 1',
        academicYearName: '2026-27',
      });
      expect(metaMock.build).toHaveBeenCalledWith(
        'DATESHEET',
        'inst-1',
        'campus-1',
      );
    });

    it('shows a draft exam datesheet, because its purpose is advance notice', async () => {
      await expect(
        service.getDatesheet(admin, 'exam-1'),
      ).resolves.toBeDefined();
    });

    it('lets staff read it only with the exams permission and campus access', async () => {
      permissionsMock.can.mockResolvedValue(false);
      await expect(service.getDatesheet(staff, 'exam-1')).rejects.toThrow(
        /read permission for exams/,
      );

      permissionsMock.can.mockResolvedValue(true);
      campusAccessMock.assertCampusAccess.mockRejectedValueOnce(
        new ForbiddenException(),
      );
      await expect(service.getDatesheet(staff, 'exam-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets a student or guardian with someone in the exam class see it', async () => {
      await expect(
        service.getDatesheet(student, 'exam-1'),
      ).resolves.toBeDefined();
      await expect(
        service.getDatesheet(guardian, 'exam-1'),
      ).resolves.toBeDefined();
      expect(prismaMock.studentEnrollment.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          studentId: { in: ['s-ayesha'] },
          classId: 'class-1',
          academicYearId: 'year-1',
        }) as never,
      });
    });

    it('refuses a student or guardian with no one in that class', async () => {
      prismaMock.studentEnrollment.count.mockResolvedValue(0);
      await expect(service.getDatesheet(student, 'exam-1')).rejects.toThrow(
        /not for your class/,
      );

      viewMock.resolveOwnedStudentIds.mockResolvedValue([]);
      await expect(service.getDatesheet(guardian, 'exam-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('404s for an unknown exam', async () => {
      prismaMock.exam.findUnique.mockResolvedValue(null);

      await expect(service.getDatesheet(admin, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getAdmitCard', () => {
    it('builds the card with the student, their section and the datesheet', async () => {
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        enrollment('s-ayesha', 'Ayesha', 'A'),
      ]);

      const { data } = await service.getAdmitCard(
        student,
        'exam-1',
        's-ayesha',
      );

      expect(data.student).toMatchObject({
        name: 'Ayesha',
        regNo: 'R-s-ayesha',
        className: 'Grade 5',
        sectionName: 'A',
      });
      expect(data.papers).toHaveLength(4);
      expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ studentId: 's-ayesha' }) as never,
        }),
      );
      expect(metaMock.build).toHaveBeenCalledWith(
        'ADMIT_CARD',
        'inst-1',
        'campus-1',
      );
    });

    it("refuses someone else's card", async () => {
      await expect(
        service.getAdmitCard(student, 'exam-1', 's-bilal'),
      ).rejects.toThrow(/only view your own admit card/);
      expect(prismaMock.studentEnrollment.findMany).not.toHaveBeenCalled();
    });

    it('404s when the student is not in the exam class', async () => {
      prismaMock.studentEnrollment.findMany.mockResolvedValue([]);

      await expect(
        service.getAdmitCard(admin, 'exam-1', 's-nobody'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAdmitCards', () => {
    it('builds one card per student, ordered by name, with one shared header', async () => {
      const { data } = await service.getAdmitCards(admin, 'exam-1');

      expect(data.cards.map((card) => card.student.name)).toEqual([
        'Ayesha',
        'Bilal',
      ]);
      expect(metaMock.build).toHaveBeenCalledTimes(1);
    });

    it('limits the batch to a section when asked', async () => {
      await service.getAdmitCards(admin, 'exam-1', 'sec-a');

      expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sectionId: 'sec-a' }) as never,
        }),
      );
    });

    it('is staff only', async () => {
      await expect(service.getAdmitCards(student, 'exam-1')).rejects.toThrow(
        /Only staff/,
      );
      await expect(service.getAdmitCards(guardian, 'exam-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getExamsForMe', () => {
    const forMeExam = (
      id: string,
      classId: string,
      extra: Record<string, unknown> = {},
    ) => ({
      id,
      name: `Exam ${id}`,
      classId,
      status: 'PUBLISHED',
      academicYearId: 'year-now',
      examType: 'REGULAR',
      originalExamId: null,
      examTerm: { name: 'Term 1', sortOrder: 1 },
      subjects: [
        {
          subject: { name: 'Maths' },
          examDate: new Date('2026-12-03'),
          startTime: '09:00',
          endTime: '11:00',
          room: 'A',
        },
        {
          subject: { name: 'Art' },
          examDate: new Date('2026-12-01'),
          startTime: '09:00',
          endTime: null,
          room: null,
        },
      ],
      ...extra,
    });

    beforeEach(() => {
      prismaMock.student.findMany.mockResolvedValue([
        { id: 's-ayesha', institutionId: 'inst-1', user: { name: 'Ayesha' } },
      ]);
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-now',
      });
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        { studentId: 's-ayesha', classId: 'class-1' },
      ]);
      prismaMock.exam.findMany.mockResolvedValue([forMeExam('e1', 'class-1')]);
    });

    it('lists the exams of the student class in the current year, datesheet in date order', async () => {
      const { data } = await service.getExamsForMe(student);

      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        id: 'e1',
        academicYearId: 'year-now',
        examTermName: 'Term 1',
        resultsPublished: true,
        studentId: 's-ayesha',
        studentName: 'Ayesha',
      });
      expect(data[0].datesheet.map((p) => p.subjectName)).toEqual([
        'Art',
        'Maths',
      ]);
      expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            academicYearId: 'year-now',
          }) as never,
        }),
      );
    });

    it('uses the requested academic year instead of the current one', async () => {
      await service.getExamsForMe(student, 'year-old');

      expect(prismaMock.institution.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            academicYearId: 'year-old',
          }) as never,
        }),
      );
    });

    it('marks an unpublished exam as not yet published, and tags a retake', async () => {
      prismaMock.exam.findMany.mockResolvedValue([
        forMeExam('e1', 'class-1', { status: 'DRAFT' }),
        forMeExam('r1', 'class-1', {
          examType: 'RETAKE',
          originalExamId: 'e1',
        }),
      ]);

      const { data } = await service.getExamsForMe(student);

      expect(data[0].resultsPublished).toBe(false);
      expect(data[1]).toMatchObject({
        examType: 'RETAKE',
        originalExamId: 'e1',
      });
    });

    it('repeats each exam for each ward of a guardian, in that ward class only', async () => {
      viewMock.resolveOwnedStudentIds.mockResolvedValue(['s-ayesha', 's-sara']);
      prismaMock.student.findMany.mockResolvedValue([
        { id: 's-ayesha', institutionId: 'inst-1', user: { name: 'Ayesha' } },
        { id: 's-sara', institutionId: 'inst-1', user: { name: 'Sara' } },
      ]);
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        { studentId: 's-ayesha', classId: 'class-1' },
        { studentId: 's-sara', classId: 'class-2' },
      ]);
      prismaMock.exam.findMany.mockResolvedValue([
        forMeExam('e1', 'class-1'),
        forMeExam('e2', 'class-2'),
      ]);

      const { data } = await service.getExamsForMe(guardian);

      expect(data.map((row) => `${row.studentName}:${row.id}`)).toEqual([
        'Ayesha:e1',
        'Sara:e2',
      ]);
    });

    it('returns nothing for staff, an unlinked account, no current year or no enrollment', async () => {
      viewMock.resolveOwnedStudentIds.mockResolvedValue([]);
      expect((await service.getExamsForMe(admin)).data).toEqual([]);

      viewMock.resolveOwnedStudentIds.mockResolvedValue(['s-ayesha']);
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: null,
      });
      expect((await service.getExamsForMe(student)).data).toEqual([]);

      prismaMock.studentEnrollment.findMany.mockResolvedValue([]);
      expect((await service.getExamsForMe(student, 'year-1')).data).toEqual([]);
      expect(prismaMock.exam.findMany).not.toHaveBeenCalled();
    });
  });
});
