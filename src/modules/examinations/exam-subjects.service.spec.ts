import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExamSubjectDto } from './dto/examinations.dto';
import { ExamSubjectsService } from './exam-subjects.service';

describe('ExamSubjectsService', () => {
  let service: ExamSubjectsService;

  const currentUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const prismaMock = {
    exam: { findUnique: jest.fn() },
    subject: { findUnique: jest.fn() },
    examSubject: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const customFieldsMock = {
    resolveInstitutionIdByCampus: jest.fn().mockResolvedValue('inst-1'),
    saveRecord: jest.fn(
      (_params: unknown, mutation: (client: unknown) => Promise<unknown>) =>
        mutation({
          examSubject: {
            create: jest.fn().mockResolvedValue({ id: 'paper-1' }),
            update: prismaMock.examSubject.update,
          },
        }),
    ),
    attachToItem: jest.fn((item: unknown) => Promise.resolve(item)),
    attachToItems: jest.fn((items: unknown) => Promise.resolve(items)),
  };

  const campusAccessMock = {
    assertCampusAccess: jest.fn().mockResolvedValue(undefined),
    getCampusIdsForUser: jest.fn().mockResolvedValue(['campus-1']),
  };

  const moduleAccessMock = {
    assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
  };

  const draftExam = {
    id: 'exam-1',
    campusId: 'campus-1',
    classId: 'class-1',
    status: 'DRAFT',
    unlockedForEditing: false,
    examType: 'REGULAR',
    originalExamId: null,
  };

  const dto = (
    overrides: Partial<CreateExamSubjectDto> = {},
  ): CreateExamSubjectDto => ({
    examId: 'exam-1',
    subjectId: 'subject-1',
    maxMarks: 100,
    passingMarks: 40,
    ...overrides,
  });

  const paper = {
    id: 'paper-1',
    examId: 'exam-1',
    subjectId: 'subject-1',
    maxMarks: '100.00',
    passingMarks: '40.00',
    startTime: null,
    endTime: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.exam.findUnique.mockResolvedValue(draftExam);
    prismaMock.subject.findUnique.mockResolvedValue({
      id: 'subject-1',
      classId: 'class-1',
    });
    prismaMock.examSubject.findUnique.mockResolvedValue(paper);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExamSubjectsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ModuleAccessService, useValue: moduleAccessMock },
        { provide: CampusAccessService, useValue: campusAccessMock },
        { provide: EntityCustomFieldsService, useValue: customFieldsMock },
      ],
    }).compile();
    service = moduleRef.get(ExamSubjectsService);
  });

  describe('createExamSubject', () => {
    it('adds a paper through the custom field helper with the Examinations module', async () => {
      await service.createExamSubject(
        currentUser,
        dto({ customFields: { venue: 'Hall A' } }),
      );

      expect(moduleAccessMock.assertModuleEnabledForUser).toHaveBeenCalledWith(
        currentUser,
        ModuleKey.EXAMINATIONS,
      );
      expect(campusAccessMock.assertCampusAccess).toHaveBeenCalledWith(
        currentUser,
        'campus-1',
      );
      expect(customFieldsMock.saveRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'exam_subject',
          values: { venue: 'Hall A' },
          create: true,
        }),
        expect.any(Function),
      );
    });

    it('refuses once the exam is published', async () => {
      prismaMock.exam.findUnique.mockResolvedValue({
        ...draftExam,
        status: 'PUBLISHED',
      });

      await expect(
        service.createExamSubject(currentUser, dto()),
      ).rejects.toThrow(/while it is a draft/);
      expect(customFieldsMock.saveRecord).not.toHaveBeenCalled();
    });

    it('rejects a subject from another class', async () => {
      prismaMock.subject.findUnique.mockResolvedValue({
        id: 'subject-1',
        classId: 'class-9',
      });

      await expect(
        service.createExamSubject(currentUser, dto()),
      ).rejects.toThrow(/does not belong to the exam's class/);
    });

    it('404s for a subject or exam that does not exist', async () => {
      prismaMock.subject.findUnique.mockResolvedValue(null);
      await expect(
        service.createExamSubject(currentUser, dto()),
      ).rejects.toThrow(NotFoundException);

      prismaMock.exam.findUnique.mockResolvedValue(null);
      await expect(
        service.createExamSubject(currentUser, dto()),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects passing marks above the maximum and an end time before the start', async () => {
      await expect(
        service.createExamSubject(currentUser, dto({ passingMarks: 120 })),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createExamSubject(
          currentUser,
          dto({ startTime: '11:00', endTime: '09:00' }),
        ),
      ).rejects.toThrow(/end time must be after/);
    });

    it('does not touch anything when campus access is denied', async () => {
      campusAccessMock.assertCampusAccess.mockRejectedValueOnce(
        new ForbiddenException(),
      );

      await expect(
        service.createExamSubject(currentUser, dto()),
      ).rejects.toThrow(ForbiddenException);
      expect(customFieldsMock.saveRecord).not.toHaveBeenCalled();
    });

    it('turns a duplicate subject into a 409', async () => {
      customFieldsMock.saveRecord.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createExamSubject(currentUser, dto()),
      ).rejects.toThrow(ConflictException);
    });

    describe('on a retake exam', () => {
      beforeEach(() => {
        prismaMock.exam.findUnique.mockResolvedValue({
          ...draftExam,
          examType: 'RETAKE',
          originalExamId: 'exam-0',
        });
      });

      it('accepts a subject that was on the original exam', async () => {
        prismaMock.examSubject.count.mockResolvedValue(1);

        await expect(
          service.createExamSubject(currentUser, dto()),
        ).resolves.toBeDefined();
        expect(prismaMock.examSubject.count).toHaveBeenCalledWith({
          where: { examId: 'exam-0', subjectId: 'subject-1' },
        });
      });

      it('rejects a subject that was not on the original exam', async () => {
        prismaMock.examSubject.count.mockResolvedValue(0);

        await expect(
          service.createExamSubject(currentUser, dto()),
        ).rejects.toThrow(/not part of the original exam/);
        expect(customFieldsMock.saveRecord).not.toHaveBeenCalled();
      });
    });
  });

  describe('listExamSubjects', () => {
    it('limits the list to the caller campuses and one exam when given', async () => {
      prismaMock.examSubject.findMany.mockResolvedValue([]);

      await service.listExamSubjects(currentUser, { examId: 'exam-1' });

      expect(prismaMock.examSubject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { exam: { campusId: { in: ['campus-1'] } }, examId: 'exam-1' },
        }),
      );
    });

    it('checks access to the requested exam first', async () => {
      campusAccessMock.assertCampusAccess.mockRejectedValueOnce(
        new ForbiddenException(),
      );

      await expect(
        service.listExamSubjects(currentUser, { examId: 'exam-1' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.examSubject.findMany).not.toHaveBeenCalled();
    });
  });

  describe('updateExamSubject', () => {
    it('lets a published, locked exam change its room and date', async () => {
      prismaMock.exam.findUnique.mockResolvedValue({
        ...draftExam,
        status: 'PUBLISHED',
      });
      prismaMock.examSubject.update.mockResolvedValue({ id: 'paper-1' });

      await expect(
        service.updateExamSubject(currentUser, 'paper-1', {
          room: 'B-12',
          examDate: '2026-12-01',
        }),
      ).resolves.toBeDefined();
    });

    it('accepts the unchanged marks an edit form resends on a locked exam', async () => {
      prismaMock.exam.findUnique.mockResolvedValue({
        ...draftExam,
        status: 'PUBLISHED',
      });
      prismaMock.examSubject.update.mockResolvedValue({ id: 'paper-1' });

      await expect(
        service.updateExamSubject(currentUser, 'paper-1', {
          maxMarks: 100,
          passingMarks: 40,
          room: 'C-3',
        }),
      ).resolves.toBeDefined();
    });

    it('blocks mark changes on a published, locked exam', async () => {
      prismaMock.exam.findUnique.mockResolvedValue({
        ...draftExam,
        status: 'PUBLISHED',
      });

      await expect(
        service.updateExamSubject(currentUser, 'paper-1', { maxMarks: 80 }),
      ).rejects.toThrow(/marks of a published exam are locked/);
      expect(prismaMock.examSubject.update).not.toHaveBeenCalled();
    });

    it('allows mark changes once the exam is unlocked, and on a draft', async () => {
      prismaMock.examSubject.update.mockResolvedValue({ id: 'paper-1' });
      prismaMock.exam.findUnique.mockResolvedValue({
        ...draftExam,
        status: 'PUBLISHED',
        unlockedForEditing: true,
      });
      await expect(
        service.updateExamSubject(currentUser, 'paper-1', { maxMarks: 120 }),
      ).resolves.toBeDefined();

      prismaMock.exam.findUnique.mockResolvedValue(draftExam);
      await expect(
        service.updateExamSubject(currentUser, 'paper-1', { passingMarks: 35 }),
      ).resolves.toBeDefined();
    });

    it('checks the passing marks against the stored maximum when only one is sent', async () => {
      await expect(
        service.updateExamSubject(currentUser, 'paper-1', {
          passingMarks: 150,
        }),
      ).rejects.toThrow(/passing marks cannot be greater/);
      await expect(
        service.updateExamSubject(currentUser, 'paper-1', { maxMarks: 30 }),
      ).rejects.toThrow(/passing marks cannot be greater/);
    });

    it('checks a new end time against the stored start time', async () => {
      prismaMock.examSubject.findUnique.mockResolvedValue({
        ...paper,
        startTime: '10:00',
      });

      await expect(
        service.updateExamSubject(currentUser, 'paper-1', { endTime: '09:00' }),
      ).rejects.toThrow(/end time must be after/);
    });
  });

  describe('deleteExamSubject', () => {
    it('soft-deletes a paper of a draft exam', async () => {
      await service.deleteExamSubject(currentUser, 'paper-1', 'wrong subject');

      expect(prismaMock.examSubject.update).toHaveBeenCalledWith({
        where: { id: 'paper-1' },
        data: expect.objectContaining({
          deletedBy: 'admin-1',
          deleteReason: 'wrong subject',
        }) as never,
      });
    });

    it('blocks removing a paper once the exam is published', async () => {
      prismaMock.exam.findUnique.mockResolvedValue({
        ...draftExam,
        status: 'PUBLISHED',
        unlockedForEditing: true,
      });

      await expect(
        service.deleteExamSubject(currentUser, 'paper-1'),
      ).rejects.toThrow(/while it is a draft/);
      expect(prismaMock.examSubject.update).not.toHaveBeenCalled();
    });
  });
});
