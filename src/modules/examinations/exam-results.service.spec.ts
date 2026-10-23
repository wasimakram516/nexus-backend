import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { ModuleKey, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamResultsService } from './exam-results.service';

describe('ExamResultsService', () => {
  let service: ExamResultsService;

  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };
  const teacher: CurrentUser = {
    sub: 'user-teacher',
    email: 'teacher@nexus.test',
    role: UserRole.STAFF,
    institutionId: 'inst-1',
  };

  const tx = {
    examResult: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const prismaMock = {
    $transaction: jest.fn(),
    examSubject: { findUnique: jest.fn() },
    section: { findUnique: jest.fn() },
    studentEnrollment: { findMany: jest.fn() },
    examResult: { findMany: jest.fn() },
    staffProfile: { findUnique: jest.fn() },
    teacherSubject: { findFirst: jest.fn() },
  };

  const moduleAccessMock = {
    assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
  };
  const campusAccessMock = {
    assertCampusAccess: jest.fn().mockResolvedValue(undefined),
  };

  const paper = (examOverrides: Record<string, unknown> = {}) => ({
    id: 'paper-1',
    subjectId: 'subject-1',
    maxMarks: '100.00',
    passingMarks: '40.00',
    exam: {
      id: 'exam-1',
      classId: 'class-1',
      campusId: 'campus-1',
      academicYearId: 'year-1',
      status: 'DRAFT',
      unlockedForEditing: false,
      ...examOverrides,
    },
  });

  const enrollment = (id: string, name: string, regNo: string) => ({
    student: { id, regNo, user: { name } },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    prismaMock.examSubject.findUnique.mockResolvedValue(paper());
    prismaMock.section.findUnique.mockResolvedValue({ classId: 'class-1' });
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      enrollment('s-bilal', 'Bilal', 'R-2'),
      enrollment('s-ayesha', 'Ayesha', 'R-1'),
      enrollment('s-sara', 'Sara', 'R-3'),
    ]);
    prismaMock.examResult.findMany.mockResolvedValue([]);
    tx.examResult.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExamResultsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ModuleAccessService, useValue: moduleAccessMock },
        { provide: CampusAccessService, useValue: campusAccessMock },
        RequestContextService,
      ],
    }).compile();
    service = moduleRef.get(ExamResultsService);
  });

  describe('getResults', () => {
    it('lists the section roster by name with each student result, and the paper limits', async () => {
      prismaMock.examResult.findMany.mockResolvedValue([
        {
          id: 'r-1',
          studentId: 's-ayesha',
          marksObtained: '72.50',
          isAbsent: false,
          remarks: 'Good',
        },
      ]);

      const { data } = await service.getResults(admin, 'paper-1', 'section-1');

      expect(moduleAccessMock.assertModuleEnabledForUser).toHaveBeenCalledWith(
        admin,
        ModuleKey.EXAMINATIONS,
      );
      expect(data.maxMarks).toBe(100);
      expect(data.locked).toBe(false);
      expect(data.students.map((student) => student.name)).toEqual([
        'Ayesha',
        'Bilal',
        'Sara',
      ]);
      expect(data.students[0].result).toEqual({
        id: 'r-1',
        marksObtained: 72.5,
        isAbsent: false,
        remarks: 'Good',
      });
      expect(data.students[1].result).toBeNull();
    });

    it("resolves the roster in the exam's own academic year and excludes withdrawn students", async () => {
      await service.getResults(admin, 'paper-1', 'section-1');

      expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            classId: 'class-1',
            sectionId: 'section-1',
            academicYearId: 'year-1',
            status: { not: 'LEFT' },
            deletedAt: null,
          },
        }),
      );
    });

    it('reports a published exam as locked unless it is unlocked', async () => {
      prismaMock.examSubject.findUnique.mockResolvedValue(
        paper({ status: 'PUBLISHED' }),
      );
      expect(
        (await service.getResults(admin, 'paper-1', 's')).data.locked,
      ).toBe(true);

      prismaMock.examSubject.findUnique.mockResolvedValue(
        paper({ status: 'PUBLISHED', unlockedForEditing: true }),
      );
      expect(
        (await service.getResults(admin, 'paper-1', 's')).data.locked,
      ).toBe(false);
    });

    it('rejects a section from another class and an unknown paper', async () => {
      prismaMock.section.findUnique.mockResolvedValue({ classId: 'class-9' });
      await expect(
        service.getResults(admin, 'paper-1', 'section-1'),
      ).rejects.toThrow(BadRequestException);

      prismaMock.examSubject.findUnique.mockResolvedValue(null);
      await expect(
        service.getResults(admin, 'missing', 'section-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not read the roster when campus access is denied', async () => {
      campusAccessMock.assertCampusAccess.mockRejectedValueOnce(
        new ForbiddenException(),
      );

      await expect(
        service.getResults(admin, 'paper-1', 'section-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.studentEnrollment.findMany).not.toHaveBeenCalled();
    });
  });

  describe('bulkSave', () => {
    const save = (
      entries: Array<Record<string, unknown>>,
      caller: CurrentUser = admin,
    ) =>
      service.bulkSave(caller, 'paper-1', {
        sectionId: 'section-1',
        entries: entries as never,
      });

    it('creates results with the section copied onto each row', async () => {
      const { data } = await save([
        { studentId: 's-ayesha', marksObtained: 80 },
        { studentId: 's-bilal', isAbsent: true },
      ]);

      expect(tx.examResult.create).toHaveBeenCalledWith({
        data: {
          examSubjectId: 'paper-1',
          studentId: 's-ayesha',
          sectionId: 'section-1',
          marksObtained: 80,
          isAbsent: false,
          remarks: null,
          createdBy: 'admin-1',
        },
      });
      expect(tx.examResult.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          studentId: 's-bilal',
          marksObtained: null,
          isAbsent: true,
        }) as never,
      });
      expect(data).toEqual({ saved: 2, unchanged: 0 });
    });

    it('updates a changed row and leaves an identical row alone', async () => {
      tx.examResult.findMany.mockResolvedValue([
        {
          id: 'r-1',
          studentId: 's-ayesha',
          marksObtained: '80.00',
          isAbsent: false,
          remarks: null,
          sectionId: 'section-1',
        },
        {
          id: 'r-2',
          studentId: 's-bilal',
          marksObtained: '50.00',
          isAbsent: false,
          remarks: 'ok',
          sectionId: 'section-1',
        },
      ]);

      const { data } = await save([
        { studentId: 's-ayesha', marksObtained: 80 },
        { studentId: 's-bilal', marksObtained: 55 },
      ]);

      expect(tx.examResult.update).toHaveBeenCalledTimes(1);
      expect(tx.examResult.update).toHaveBeenCalledWith({
        where: { id: 'r-2' },
        data: {
          marksObtained: 55,
          isAbsent: false,
          remarks: 'ok',
          sectionId: 'section-1',
          updatedBy: 'admin-1',
        },
      });
      expect(data).toEqual({ saved: 1, unchanged: 1 });
    });

    it('clears a mark when null is sent, and marks absent over existing marks', async () => {
      tx.examResult.findMany.mockResolvedValue([
        {
          id: 'r-1',
          studentId: 's-ayesha',
          marksObtained: '80.00',
          isAbsent: false,
          remarks: null,
          sectionId: 'section-1',
        },
        {
          id: 'r-2',
          studentId: 's-bilal',
          marksObtained: '50.00',
          isAbsent: false,
          remarks: null,
          sectionId: 'section-1',
        },
      ]);

      await save([
        { studentId: 's-ayesha', marksObtained: null },
        { studentId: 's-bilal', isAbsent: true },
      ]);

      expect(tx.examResult.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r-1' },
          data: expect.objectContaining({ marksObtained: null }) as never,
        }),
      );
      expect(tx.examResult.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r-2' },
          data: expect.objectContaining({
            marksObtained: null,
            isAbsent: true,
          }) as never,
        }),
      );
    });

    it('rejects marks above the maximum, naming the student', async () => {
      await expect(
        save([{ studentId: 's-ayesha', marksObtained: 120 }]),
      ).rejects.toThrow(/Ayesha \(R-1\): marks cannot be more than 100/);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects marks sent together with an absence', async () => {
      await expect(
        save([{ studentId: 's-ayesha', marksObtained: 50, isAbsent: true }]),
      ).rejects.toThrow(/marked absent cannot have marks/);
    });

    it('rejects a student outside the section and a duplicate student, before writing', async () => {
      await expect(
        save([{ studentId: 's-stranger', marksObtained: 10 }]),
      ).rejects.toThrow(/not enrolled in this section/);
      await expect(
        save([
          { studentId: 's-ayesha', marksObtained: 10 },
          { studentId: 's-ayesha', marksObtained: 20 },
        ]),
      ).rejects.toThrow(/appears more than once/);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('reports every problem at once', async () => {
      await expect(
        save([
          { studentId: 's-ayesha', marksObtained: 500 },
          { studentId: 's-stranger', marksObtained: 10 },
        ]),
      ).rejects.toThrow(/Ayesha[\s\S]*not enrolled/);
    });

    it('blocks everyone, admins included, while the exam is published and locked', async () => {
      prismaMock.examSubject.findUnique.mockResolvedValue(
        paper({ status: 'PUBLISHED' }),
      );

      await expect(
        save([{ studentId: 's-ayesha', marksObtained: 10 }]),
      ).rejects.toThrow(ConflictException);
      expect(tx.examResult.create).not.toHaveBeenCalled();
    });

    it('allows marks on a published exam once it is unlocked', async () => {
      prismaMock.examSubject.findUnique.mockResolvedValue(
        paper({ status: 'PUBLISHED', unlockedForEditing: true }),
      );

      await expect(
        save([{ studentId: 's-ayesha', marksObtained: 10 }]),
      ).resolves.toBeDefined();
    });

    describe('staff allocation', () => {
      it('lets a teacher save marks for a subject they teach in this section', async () => {
        prismaMock.staffProfile.findUnique.mockResolvedValue({ id: 'staff-1' });
        prismaMock.teacherSubject.findFirst.mockResolvedValue({
          id: 'alloc-1',
        });

        await expect(
          save([{ studentId: 's-ayesha', marksObtained: 10 }], teacher),
        ).resolves.toBeDefined();
        expect(prismaMock.teacherSubject.findFirst).toHaveBeenCalledWith({
          where: {
            staffProfileId: 'staff-1',
            classId: 'class-1',
            subjectId: 'subject-1',
            sectionId: 'section-1',
            deletedAt: null,
          },
          select: { id: true },
        });
      });

      it('rejects a teacher with no allocation for this subject and section', async () => {
        prismaMock.staffProfile.findUnique.mockResolvedValue({ id: 'staff-1' });
        prismaMock.teacherSubject.findFirst.mockResolvedValue(null);

        await expect(
          save([{ studentId: 's-ayesha', marksObtained: 10 }], teacher),
        ).rejects.toThrow(/not assigned to teach this subject/);
        expect(tx.examResult.create).not.toHaveBeenCalled();
      });

      it('rejects a staff account that has no staff profile at all', async () => {
        prismaMock.staffProfile.findUnique.mockResolvedValue(null);

        await expect(
          save([{ studentId: 's-ayesha', marksObtained: 10 }], teacher),
        ).rejects.toThrow(ForbiddenException);
        expect(prismaMock.teacherSubject.findFirst).not.toHaveBeenCalled();
      });

      it('does not apply the allocation check to admins', async () => {
        await save([{ studentId: 's-ayesha', marksObtained: 10 }]);

        expect(prismaMock.staffProfile.findUnique).not.toHaveBeenCalled();
      });

      it('applies the lock before the allocation check', async () => {
        prismaMock.examSubject.findUnique.mockResolvedValue(
          paper({ status: 'PUBLISHED' }),
        );

        await expect(
          save([{ studentId: 's-ayesha', marksObtained: 10 }], teacher),
        ).rejects.toThrow(ConflictException);
        expect(prismaMock.staffProfile.findUnique).not.toHaveBeenCalled();
      });
    });
  });

  describe('getFailingStudents', () => {
    it('lists absent students and those below this paper passing marks, and skips unmarked ones', async () => {
      prismaMock.examResult.findMany.mockResolvedValue([
        { studentId: 's-ayesha', marksObtained: '39.99', isAbsent: false },
        { studentId: 's-bilal', marksObtained: null, isAbsent: true },
        { studentId: 's-sara', marksObtained: '40.00', isAbsent: false },
      ]);

      const { data } = await service.getFailingStudents(
        admin,
        'paper-1',
        'section-1',
      );

      expect(data.map((student) => student.name)).toEqual(['Ayesha', 'Bilal']);
      expect(data[0]).toMatchObject({ marksObtained: 39.99, isAbsent: false });
      expect(data[1]).toMatchObject({ marksObtained: null, isAbsent: true });
    });

    it('leaves out a student with no result row and one with an empty, present row', async () => {
      prismaMock.examResult.findMany.mockResolvedValue([
        { studentId: 's-ayesha', marksObtained: null, isAbsent: false },
      ]);

      const { data } = await service.getFailingStudents(
        admin,
        'paper-1',
        'section-1',
      );

      expect(data).toEqual([]);
    });
  });
});
