import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GradeBandInputDto, RetakeExamType } from './dto/examinations.dto';
import { ExaminationsService } from './examinations.service';

describe('ExaminationsService', () => {
  let service: ExaminationsService;

  const currentUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const tx = {
    gradingScale: {
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    exam: {
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    gradeBand: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const prismaMock = {
    $transaction: jest.fn(),
    institution: { findUnique: jest.fn(), update: jest.fn() },
    gradingScale: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    academicYear: { findUnique: jest.fn() },
    academicClass: { findUnique: jest.fn() },
    examSubject: { aggregate: jest.fn() },
    exam: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    examTerm: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  // saveRecord runs the mutation against the same mocked delegates, so the
  // existing prismaMock assertions still apply; attach* pass items through.
  const customFieldsMock = {
    saveRecord: jest.fn(
      (_params: unknown, mutation: (client: unknown) => Promise<unknown>) =>
        mutation(prismaMock),
    ),
    attachToItem: jest.fn((item: unknown) => Promise.resolve(item)),
    attachToItems: jest.fn((items: unknown) => Promise.resolve(items)),
  };

  const auditLogMock = { log: jest.fn().mockResolvedValue(undefined) };

  const campusAccessMock = {
    assertClassAccess: jest.fn().mockResolvedValue(undefined),
    assertCampusAccess: jest.fn().mockResolvedValue(undefined),
    getScopedCampusIds: jest.fn(),
  };

  const moduleAccessMock = {
    assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
  };

  const band = (
    grade: string,
    minPercentage: number,
    maxPercentage: number,
  ): GradeBandInputDto => ({ grade, minPercentage, maxPercentage });

  const validBands = [
    band('A', 80, 100),
    band('B', 60, 79.99),
    band('F', 0, 59.99),
  ];

  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'inst-1',
      currentGradingScaleId: null,
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExaminationsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ModuleAccessService, useValue: moduleAccessMock },
        RequestContextService,
        { provide: CampusAccessService, useValue: campusAccessMock },
        { provide: EntityCustomFieldsService, useValue: customFieldsMock },
        { provide: AuditLogService, useValue: auditLogMock },
      ],
    }).compile();
    service = moduleRef.get(ExaminationsService);
  });

  describe('createGradingScale', () => {
    it('creates the scale and its bands in one transaction, in input order', async () => {
      tx.gradingScale.create.mockResolvedValue({ id: 'scale-1' });
      tx.gradingScale.findUniqueOrThrow.mockResolvedValue({
        id: 'scale-1',
        bands: [],
      });

      const result = await service.createGradingScale(
        'inst-1',
        { name: 'Standard', bands: validBands },
        currentUser,
      );

      expect(moduleAccessMock.assertModuleEnabledForUser).toHaveBeenCalledWith(
        currentUser,
        ModuleKey.EXAMINATIONS,
      );
      expect(tx.gradingScale.create).toHaveBeenCalledWith({
        data: { institutionId: 'inst-1', name: 'Standard', description: null },
      });
      const rows = (
        tx.gradeBand.create.mock.calls as Array<
          [{ data: { sortOrder: number } }]
        >
      ).map(([args]) => args.data.sortOrder);
      expect(rows).toEqual([0, 1, 2]);
      expect(result.data.isCurrent).toBe(false);
    });

    it('rejects overlapping bands naming both grades', async () => {
      await expect(
        service.createGradingScale(
          'inst-1',
          { name: 'Bad', bands: [band('A', 70, 100), band('B', 60, 70)] },
          currentUser,
        ),
      ).rejects.toThrow(/"B" and "A"|"A" and "B"|overlapping/);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('allows gaps between bands', async () => {
      tx.gradingScale.create.mockResolvedValue({ id: 'scale-1' });
      tx.gradingScale.findUniqueOrThrow.mockResolvedValue({
        id: 'scale-1',
        bands: [],
      });

      await expect(
        service.createGradingScale(
          'inst-1',
          { name: 'Gappy', bands: [band('A', 90, 100), band('C', 40, 60)] },
          currentUser,
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a band whose minimum exceeds its maximum', async () => {
      await expect(
        service.createGradingScale(
          'inst-1',
          { name: 'Bad', bands: [band('A', 90, 80)] },
          currentUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate grade label case-insensitively', async () => {
      await expect(
        service.createGradingScale(
          'inst-1',
          { name: 'Bad', bands: [band('A', 90, 100), band('a', 0, 50)] },
          currentUser,
        ),
      ).rejects.toThrow(/more than once/);
    });

    it('rejects ranges that touch at a boundary', async () => {
      await expect(
        service.createGradingScale(
          'inst-1',
          { name: 'Bad', bands: [band('A', 80, 100), band('B', 60, 80)] },
          currentUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('turns a duplicate scale name into a 409', async () => {
      prismaMock.$transaction.mockRejectedValue(p2002());

      await expect(
        service.createGradingScale(
          'inst-1',
          { name: 'Standard', bands: validBands },
          currentUser,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('404s for an institution that does not exist', async () => {
      prismaMock.institution.findUnique.mockResolvedValue(null);

      await expect(
        service.createGradingScale(
          'missing',
          { name: 'Standard', bands: validBands },
          currentUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listGradingScales', () => {
    it('flags only the current scale', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: 'inst-1',
        currentGradingScaleId: 'scale-2',
      });
      prismaMock.gradingScale.findMany.mockResolvedValue([
        { id: 'scale-1', bands: [] },
        { id: 'scale-2', bands: [] },
      ]);

      const { data } = await service.listGradingScales('inst-1', currentUser);

      expect(data.map((scale) => scale.isCurrent)).toEqual([false, true]);
    });
  });

  describe('getGradingScale', () => {
    it('404s for a scale belonging to another institution', async () => {
      prismaMock.gradingScale.findUnique.mockResolvedValue({
        id: 'scale-1',
        institutionId: 'inst-2',
        bands: [],
      });

      await expect(
        service.getGradingScale('inst-1', 'scale-1', currentUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateGradingScale', () => {
    beforeEach(() => {
      prismaMock.gradingScale.findUnique.mockResolvedValue({
        id: 'scale-1',
        institutionId: 'inst-1',
        name: 'Standard',
        bands: [],
      });
      tx.gradingScale.findUniqueOrThrow.mockResolvedValue({
        id: 'scale-1',
        bands: [],
      });
    });

    it('leaves bands untouched when the payload has none', async () => {
      await service.updateGradingScale(
        'inst-1',
        'scale-1',
        { name: 'Renamed' },
        currentUser,
      );

      expect(tx.gradeBand.findMany).not.toHaveBeenCalled();
      expect(tx.gradeBand.create).not.toHaveBeenCalled();
    });

    it('replaces the band set, rotating the old rows out of the unique slot', async () => {
      tx.gradeBand.findMany.mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);

      await service.updateGradingScale(
        'inst-1',
        'scale-1',
        { bands: validBands },
        currentUser,
      );

      expect(tx.gradeBand.update).toHaveBeenCalledTimes(2);
      expect(tx.gradeBand.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'b1' },
          data: expect.objectContaining({
            activeScopeKey: 'REPLACED-b1',
            deletedBy: 'admin-1',
          }) as never,
        }),
      );
      expect(tx.gradeBand.create).toHaveBeenCalledTimes(3);
    });

    it('rejects invalid replacement bands before opening a transaction', async () => {
      await expect(
        service.updateGradingScale(
          'inst-1',
          'scale-1',
          { bands: [band('A', 50, 100), band('B', 40, 60)] },
          currentUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('turns a rename collision into a 409', async () => {
      prismaMock.$transaction.mockRejectedValue(p2002());

      await expect(
        service.updateGradingScale(
          'inst-1',
          'scale-1',
          { name: 'Dup' },
          currentUser,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('setCurrentGradingScale', () => {
    it('flips the pointer for a scale of this institution', async () => {
      prismaMock.gradingScale.findUnique.mockResolvedValue({
        id: 'scale-1',
        institutionId: 'inst-1',
        bands: [],
      });

      await service.setCurrentGradingScale('inst-1', 'scale-1', currentUser);

      expect(prismaMock.institution.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { currentGradingScaleId: 'scale-1' },
      });
    });

    it('refuses a scale of another institution without touching the pointer', async () => {
      prismaMock.gradingScale.findUnique.mockResolvedValue({
        id: 'scale-1',
        institutionId: 'inst-2',
        bands: [],
      });

      await expect(
        service.setCurrentGradingScale('inst-1', 'scale-1', currentUser),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.institution.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteGradingScale', () => {
    beforeEach(() => {
      prismaMock.gradingScale.findUnique.mockResolvedValue({
        id: 'scale-1',
        institutionId: 'inst-1',
        name: 'Standard',
        bands: [],
      });
    });

    it('soft-deletes a non-current scale', async () => {
      await service.deleteGradingScale(
        'inst-1',
        'scale-1',
        currentUser,
        'obsolete',
      );

      expect(prismaMock.gradingScale.update).toHaveBeenCalledWith({
        where: { id: 'scale-1' },
        data: expect.objectContaining({
          deletedBy: 'admin-1',
          deleteReason: 'obsolete',
          activeScopeKey: 'DELETED:scale-1',
        }) as never,
      });
    });

    it('blocks deleting the current scale', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: 'inst-1',
        currentGradingScaleId: 'scale-1',
      });

      await expect(
        service.deleteGradingScale('inst-1', 'scale-1', currentUser),
      ).rejects.toThrow(ConflictException);
      expect(prismaMock.gradingScale.update).not.toHaveBeenCalled();
    });
  });

  describe('exam terms', () => {
    const term = {
      id: 'term-1',
      institutionId: 'inst-1',
      academicYearId: 'year-1',
      name: 'First Term',
      startDate: null,
      endDate: null,
    };

    it('creates a term inside an academic year of the institution', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        institutionId: 'inst-1',
      });
      prismaMock.examTerm.create.mockResolvedValue(term);

      await service.createExamTerm(
        'inst-1',
        { academicYearId: 'year-1', name: 'First Term', weight: 2 },
        currentUser,
      );

      expect(prismaMock.examTerm.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          institutionId: 'inst-1',
          academicYearId: 'year-1',
          weight: 2,
          createdBy: 'admin-1',
        }) as never,
      });
    });

    it('404s for an academic year of another institution', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        institutionId: 'inst-2',
      });

      await expect(
        service.createExamTerm(
          'inst-1',
          { academicYearId: 'year-9', name: 'First Term' },
          currentUser,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.examTerm.create).not.toHaveBeenCalled();
    });

    it('rejects an inverted date range', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        institutionId: 'inst-1',
      });

      await expect(
        service.createExamTerm(
          'inst-1',
          {
            academicYearId: 'year-1',
            name: 'First Term',
            startDate: '2026-12-01',
            endDate: '2026-11-01',
          },
          currentUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('turns a duplicate (year, name) into a 409', async () => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        institutionId: 'inst-1',
      });
      prismaMock.examTerm.create.mockRejectedValue(p2002());

      await expect(
        service.createExamTerm(
          'inst-1',
          { academicYearId: 'year-1', name: 'First Term' },
          currentUser,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('lists terms filtered by academic year when given', async () => {
      prismaMock.examTerm.findMany.mockResolvedValue([term]);

      await service.listExamTerms('inst-1', currentUser, 'year-1');

      expect(prismaMock.examTerm.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { institutionId: 'inst-1', academicYearId: 'year-1' },
        }),
      );
    });

    it('refuses to move a term to another academic year', async () => {
      prismaMock.examTerm.findUnique.mockResolvedValue(term);

      await expect(
        service.updateExamTerm(
          'inst-1',
          'term-1',
          { academicYearId: 'year-2' },
          currentUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.examTerm.update).not.toHaveBeenCalled();
    });

    it('validates a new end date against the stored start date', async () => {
      prismaMock.examTerm.findUnique.mockResolvedValue({
        ...term,
        startDate: new Date('2026-12-01'),
      });

      await expect(
        service.updateExamTerm(
          'inst-1',
          'term-1',
          { endDate: '2026-11-01' },
          currentUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates the editable fields', async () => {
      prismaMock.examTerm.findUnique.mockResolvedValue(term);
      prismaMock.examTerm.update.mockResolvedValue(term);

      await service.updateExamTerm(
        'inst-1',
        'term-1',
        { name: 'Mid Term', weight: 1.5 },
        currentUser,
      );

      expect(prismaMock.examTerm.update).toHaveBeenCalledWith({
        where: { id: 'term-1' },
        data: expect.objectContaining({
          name: 'Mid Term',
          weight: 1.5,
          updatedBy: 'admin-1',
        }) as never,
      });
    });

    it('soft-deletes a term with the reason', async () => {
      prismaMock.examTerm.findUnique.mockResolvedValue(term);

      await service.deleteExamTerm(
        'inst-1',
        'term-1',
        currentUser,
        'wrong year',
      );

      expect(prismaMock.examTerm.update).toHaveBeenCalledWith({
        where: { id: 'term-1' },
        data: expect.objectContaining({
          deletedBy: 'admin-1',
          deleteReason: 'wrong year',
          activeScopeKey: 'DELETED:term-1',
        }) as never,
      });
    });

    it('404s when reading a term of another institution', async () => {
      prismaMock.examTerm.findUnique.mockResolvedValue({
        ...term,
        institutionId: 'inst-2',
      });

      await expect(
        service.getExamTerm('inst-1', 'term-1', currentUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('exams', () => {
    const exam = {
      id: 'exam-1',
      examTermId: 'term-1',
      academicYearId: 'year-1',
      campusId: 'campus-1',
      classId: 'class-1',
      name: 'First Term Examination',
      gradingScaleId: 'scale-1',
      status: 'DRAFT',
      examType: 'REGULAR',
      originalExamId: null,
    };
    const term = {
      id: 'term-1',
      institutionId: 'inst-1',
      academicYearId: 'year-1',
    };

    beforeEach(() => {
      prismaMock.examSubject.aggregate.mockResolvedValue({
        _min: { examDate: null },
        _max: { examDate: null },
      });
      prismaMock.academicClass.findUnique.mockResolvedValue({
        level: { campusId: 'campus-1', campus: { institutionId: 'inst-1' } },
      });
      prismaMock.examTerm.findUnique.mockResolvedValue(term);
      prismaMock.institution.findUnique.mockResolvedValue({
        id: 'inst-1',
        currentGradingScaleId: 'scale-current',
      });
      prismaMock.exam.findUnique.mockResolvedValue(exam);
    });

    describe('createExam', () => {
      it('pins the current grading scale and derives campus and year server-side', async () => {
        prismaMock.exam.create.mockResolvedValue(exam);

        await service.createExam(currentUser, {
          classId: 'class-1',
          examTermId: 'term-1',
          name: 'First Term Examination',
        });

        expect(campusAccessMock.assertClassAccess).toHaveBeenCalledWith(
          currentUser,
          'class-1',
        );
        expect(prismaMock.exam.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            campusId: 'campus-1',
            academicYearId: 'year-1',
            gradingScaleId: 'scale-current',
            examType: 'REGULAR',
            retakeKey: 'REGULAR',
            createdBy: 'admin-1',
          }) as never,
        });
      });

      it('uses an explicit grading scale of this institution', async () => {
        prismaMock.gradingScale.findUnique.mockResolvedValue({
          institutionId: 'inst-1',
        });
        prismaMock.exam.create.mockResolvedValue(exam);

        await service.createExam(currentUser, {
          classId: 'class-1',
          examTermId: 'term-1',
          name: 'Exam',
          gradingScaleId: 'scale-9',
        });

        expect(prismaMock.exam.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ gradingScaleId: 'scale-9' }) as never,
        });
      });

      it('404s for a grading scale of another institution', async () => {
        prismaMock.gradingScale.findUnique.mockResolvedValue({
          institutionId: 'inst-2',
        });

        await expect(
          service.createExam(currentUser, {
            classId: 'class-1',
            examTermId: 'term-1',
            name: 'Exam',
            gradingScaleId: 'scale-9',
          }),
        ).rejects.toThrow(NotFoundException);
      });

      it('409s when there is no current grading scale and none was supplied', async () => {
        prismaMock.institution.findUnique.mockResolvedValue({
          id: 'inst-1',
          currentGradingScaleId: null,
        });

        await expect(
          service.createExam(currentUser, {
            classId: 'class-1',
            examTermId: 'term-1',
            name: 'Exam',
          }),
        ).rejects.toThrow(/Set up a grading scale/);
        expect(prismaMock.exam.create).not.toHaveBeenCalled();
      });

      it('404s for a term of another institution', async () => {
        prismaMock.examTerm.findUnique.mockResolvedValue({
          ...term,
          institutionId: 'inst-2',
        });

        await expect(
          service.createExam(currentUser, {
            classId: 'class-1',
            examTermId: 'term-1',
            name: 'Exam',
          }),
        ).rejects.toThrow(NotFoundException);
      });

      it('turns a duplicate regular exam into a 409', async () => {
        prismaMock.exam.create.mockRejectedValue(p2002());

        await expect(
          service.createExam(currentUser, {
            classId: 'class-1',
            examTermId: 'term-1',
            name: 'Exam',
          }),
        ).rejects.toThrow(ConflictException);
      });

      it('does not touch the database when class access is denied', async () => {
        campusAccessMock.assertClassAccess.mockRejectedValueOnce(
          new ForbiddenException(),
        );

        await expect(
          service.createExam(currentUser, {
            classId: 'class-1',
            examTermId: 'term-1',
            name: 'Exam',
          }),
        ).rejects.toThrow(ForbiddenException);
        expect(prismaMock.exam.create).not.toHaveBeenCalled();
      });
    });

    describe('listExams', () => {
      it('limits the list to the caller campuses and applies filters', async () => {
        campusAccessMock.getScopedCampusIds.mockResolvedValue(['campus-1']);
        prismaMock.exam.findMany.mockResolvedValue([exam]);

        await service.listExams(currentUser, {
          status: 'PUBLISHED',
          examType: 'RETAKE',
          originalExamId: 'exam-0',
        });

        expect(prismaMock.exam.findMany).toHaveBeenCalledWith({
          where: {
            campusId: { in: ['campus-1'] },
            status: 'PUBLISHED',
            examType: 'RETAKE',
            originalExamId: 'exam-0',
          },
          orderBy: [{ createdAt: 'desc' }],
        });
      });

      it('checks access to a requested class before querying', async () => {
        campusAccessMock.getScopedCampusIds.mockResolvedValue(['campus-1']);
        prismaMock.exam.findMany.mockResolvedValue([]);

        await service.listExams(currentUser, { classId: 'class-1' });

        expect(campusAccessMock.assertClassAccess).toHaveBeenCalledWith(
          currentUser,
          'class-1',
        );
      });
    });

    describe('getExam', () => {
      it('checks campus access for the exam', async () => {
        await service.getExam(currentUser, 'exam-1');

        expect(campusAccessMock.assertCampusAccess).toHaveBeenCalledWith(
          currentUser,
          'campus-1',
        );
      });

      it('returns the datesheet range computed from the papers', async () => {
        const start = new Date('2026-12-01');
        const end = new Date('2026-12-09');
        prismaMock.examSubject.aggregate.mockResolvedValue({
          _min: { examDate: start },
          _max: { examDate: end },
        });

        const { data } = await service.getExam(currentUser, 'exam-1');

        expect(prismaMock.examSubject.aggregate).toHaveBeenCalledWith({
          where: { examId: 'exam-1' },
          _min: { examDate: true },
          _max: { examDate: true },
        });
        expect(data).toMatchObject({
          datesheetStart: start,
          datesheetEnd: end,
        });
      });

      it('returns no range while no paper has a date', async () => {
        const { data } = await service.getExam(currentUser, 'exam-1');

        expect(data).toMatchObject({
          datesheetStart: null,
          datesheetEnd: null,
        });
      });

      it('404s for a missing exam', async () => {
        prismaMock.exam.findUnique.mockResolvedValue(null);

        await expect(service.getExam(currentUser, 'missing')).rejects.toThrow(
          NotFoundException,
        );
      });
    });

    describe('updateExam', () => {
      it('renames without touching the grading scale', async () => {
        prismaMock.exam.update.mockResolvedValue(exam);

        await service.updateExam(currentUser, 'exam-1', { name: 'Renamed' });

        expect(prismaMock.exam.update).toHaveBeenCalledWith({
          where: { id: 'exam-1' },
          data: {
            name: 'Renamed',
            gradingScaleId: undefined,
            updatedBy: 'admin-1',
          },
        });
      });

      it('locks the grading scale once the exam is published', async () => {
        prismaMock.exam.findUnique.mockResolvedValue({
          ...exam,
          status: 'PUBLISHED',
        });

        await expect(
          service.updateExam(currentUser, 'exam-1', {
            gradingScaleId: 'scale-9',
          }),
        ).rejects.toThrow(ConflictException);
        expect(prismaMock.exam.update).not.toHaveBeenCalled();
      });

      it('allows re-sending the same grading scale on a published exam', async () => {
        prismaMock.exam.findUnique.mockResolvedValue({
          ...exam,
          status: 'PUBLISHED',
        });
        prismaMock.exam.update.mockResolvedValue(exam);

        await expect(
          service.updateExam(currentUser, 'exam-1', {
            gradingScaleId: 'scale-1',
            name: 'Same scale',
          }),
        ).resolves.toBeDefined();
      });
    });

    describe('deleteExam', () => {
      it('soft-deletes an exam with no retakes', async () => {
        prismaMock.exam.count.mockResolvedValue(0);

        await service.deleteExam(currentUser, 'exam-1', 'duplicate');

        expect(prismaMock.exam.update).toHaveBeenCalledWith({
          where: { id: 'exam-1' },
          data: expect.objectContaining({
            deleteReason: 'duplicate',
            deletedBy: 'admin-1',
          }) as never,
        });
      });

      it('blocks deleting an exam that still has retakes', async () => {
        prismaMock.exam.count.mockResolvedValue(1);

        await expect(service.deleteExam(currentUser, 'exam-1')).rejects.toThrow(
          ConflictException,
        );
        expect(prismaMock.exam.update).not.toHaveBeenCalled();
      });
    });

    describe('createRetakeExam', () => {
      const published = { ...exam, status: 'PUBLISHED' };

      it('requires the original exam to be published', async () => {
        await expect(
          service.createRetakeExam(currentUser, 'exam-1', {
            examType: RetakeExamType.RETAKE,
            name: 'Retake',
          }),
        ).rejects.toThrow(/Publish the original exam/);
        expect(prismaMock.exam.create).not.toHaveBeenCalled();
      });

      it('links the retake to the original with a server-computed key', async () => {
        prismaMock.exam.findUnique.mockResolvedValue(published);
        prismaMock.exam.create.mockResolvedValue({ id: 'exam-2' });

        await service.createRetakeExam(currentUser, 'exam-1', {
          examType: RetakeExamType.IMPROVEMENT,
          name: 'Improvement',
        });

        expect(prismaMock.exam.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            classId: 'class-1',
            campusId: 'campus-1',
            examTermId: 'term-1',
            gradingScaleId: 'scale-1',
            examType: 'IMPROVEMENT',
            originalExamId: 'exam-1',
            retakeKey: 'IMPROVEMENT:exam-1',
          }) as never,
        });
      });

      it('rejects a term from another academic year', async () => {
        prismaMock.exam.findUnique.mockResolvedValue(published);
        prismaMock.examTerm.findUnique.mockResolvedValue({
          ...term,
          id: 'term-9',
          academicYearId: 'year-9',
        });

        await expect(
          service.createRetakeExam(currentUser, 'exam-1', {
            examType: RetakeExamType.RETAKE,
            name: 'Retake',
            examTermId: 'term-9',
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('allows a retake of a published retake', async () => {
        prismaMock.exam.findUnique.mockResolvedValue({
          ...published,
          examType: 'RETAKE',
          originalExamId: 'exam-0',
        });
        prismaMock.exam.create.mockResolvedValue({ id: 'exam-3' });

        await expect(
          service.createRetakeExam(currentUser, 'exam-1', {
            examType: RetakeExamType.SUPPLEMENTARY,
            name: 'Second chance',
          }),
        ).resolves.toBeDefined();
      });

      it('turns a duplicate retake type into a 409', async () => {
        prismaMock.exam.findUnique.mockResolvedValue(published);
        prismaMock.exam.create.mockRejectedValue(p2002());

        await expect(
          service.createRetakeExam(currentUser, 'exam-1', {
            examType: RetakeExamType.RETAKE,
            name: 'Retake again',
          }),
        ).rejects.toThrow(ConflictException);
      });
    });

    describe('listRetakeExams', () => {
      it('lists the exams pointing at the original', async () => {
        prismaMock.exam.findMany.mockResolvedValue([]);

        await service.listRetakeExams(currentUser, 'exam-1');

        expect(prismaMock.exam.findMany).toHaveBeenCalledWith({
          where: { originalExamId: 'exam-1' },
          orderBy: [{ createdAt: 'asc' }],
        });
      });
    });
  });

  describe('custom field values', () => {
    const term = {
      id: 'term-1',
      institutionId: 'inst-1',
      academicYearId: 'year-1',
    };

    beforeEach(() => {
      prismaMock.academicYear.findUnique.mockResolvedValue({
        institutionId: 'inst-1',
      });
      prismaMock.academicClass.findUnique.mockResolvedValue({
        level: { campusId: 'campus-1', campus: { institutionId: 'inst-1' } },
      });
      prismaMock.examTerm.findUnique.mockResolvedValue(term);
      prismaMock.institution.findUnique.mockResolvedValue({
        id: 'inst-1',
        currentGradingScaleId: 'scale-1',
      });
    });

    it('saves exam term custom values with the record, as a required-field create', async () => {
      prismaMock.examTerm.create.mockResolvedValue({ id: 'term-2' });

      await service.createExamTerm(
        'inst-1',
        {
          academicYearId: 'year-1',
          name: 'Mid Term',
          customFields: { venue: 'Hall A' },
        },
        currentUser,
      );

      expect(customFieldsMock.saveRecord).toHaveBeenCalledWith(
        {
          institutionId: 'inst-1',
          moduleKey: ModuleKey.EXAMINATIONS,
          entityType: 'exam_term',
          values: { venue: 'Hall A' },
          create: true,
        },
        expect.any(Function),
      );
      expect(customFieldsMock.attachToItem).toHaveBeenCalledWith(
        { id: 'term-2' },
        'exam_term',
      );
    });

    it('does not require fields again on an exam term update', async () => {
      prismaMock.examTerm.findUnique.mockResolvedValue({
        ...term,
        name: 'Mid Term',
        startDate: null,
        endDate: null,
      });
      prismaMock.examTerm.update.mockResolvedValue({ id: 'term-1' });

      await service.updateExamTerm(
        'inst-1',
        'term-1',
        { customFields: { venue: 'Hall B' } },
        currentUser,
      );

      expect(customFieldsMock.saveRecord).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'exam_term', create: false }),
        expect.any(Function),
      );
    });

    it('saves exam custom values scoped to the class institution', async () => {
      prismaMock.exam.create.mockResolvedValue({ id: 'exam-9' });

      await service.createExam(currentUser, {
        classId: 'class-1',
        examTermId: 'term-1',
        name: 'Exam',
        customFields: { invigilator: 'Ms Ali' },
      });

      expect(customFieldsMock.saveRecord).toHaveBeenCalledWith(
        {
          institutionId: 'inst-1',
          moduleKey: ModuleKey.EXAMINATIONS,
          entityType: 'exam',
          values: { invigilator: 'Ms Ali' },
          create: true,
        },
        expect.any(Function),
      );
    });

    it('attaches custom values to exam lists and details', async () => {
      campusAccessMock.getScopedCampusIds.mockResolvedValue(['campus-1']);
      prismaMock.examSubject.aggregate.mockResolvedValue({
        _min: { examDate: null },
        _max: { examDate: null },
      });
      prismaMock.exam.findMany.mockResolvedValueOnce([{ id: 'exam-1' }]);
      prismaMock.exam.findUnique.mockResolvedValueOnce({
        id: 'exam-1',
        campusId: 'campus-1',
      });

      await service.listExams(currentUser, {});
      await service.getExam(currentUser, 'exam-1');

      expect(customFieldsMock.attachToItems).toHaveBeenCalledWith(
        [{ id: 'exam-1' }],
        'exam',
      );
      expect(customFieldsMock.attachToItem).toHaveBeenCalledWith(
        { id: 'exam-1', campusId: 'campus-1' },
        'exam',
      );
    });
  });

  describe('publish, unlock and relock', () => {
    const exam = {
      id: 'exam-1',
      classId: 'class-1',
      campusId: 'campus-1',
      name: 'First Term Examination',
      examType: 'REGULAR',
      status: 'DRAFT',
      unlockedForEditing: false,
    };

    beforeEach(() => {
      prismaMock.academicClass.findUnique.mockResolvedValue({
        level: { campusId: 'campus-1', campus: { institutionId: 'inst-1' } },
      });
      prismaMock.exam.findUnique.mockResolvedValue(exam);
      tx.exam.updateMany.mockResolvedValue({ count: 1 });
      tx.exam.findUniqueOrThrow.mockResolvedValue({ id: 'exam-1' });
    });

    it('publishes a draft, stamps who and when, and writes a dedicated audit entry', async () => {
      await service.publishExam(currentUser, 'exam-1');

      expect(tx.exam.updateMany).toHaveBeenCalledWith({
        where: { id: 'exam-1', status: 'DRAFT', unlockedForEditing: false },
        data: expect.objectContaining({
          status: 'PUBLISHED',
          unlockedForEditing: false,
          publishedBy: 'admin-1',
          updatedBy: 'admin-1',
        }) as never,
      });
      expect(auditLogMock.log).toHaveBeenCalledWith(
        currentUser,
        expect.objectContaining({
          action: 'EXAM_PUBLISHED',
          entity: 'Exam',
          entityId: 'exam-1',
          institutionId: 'inst-1',
        }),
        tx,
      );
    });

    it('rejects publishing an exam that is already published', async () => {
      prismaMock.exam.findUnique.mockResolvedValue({
        ...exam,
        status: 'PUBLISHED',
      });

      await expect(service.publishExam(currentUser, 'exam-1')).rejects.toThrow(
        ConflictException,
      );
      expect(tx.exam.updateMany).not.toHaveBeenCalled();
    });

    it('unlocks only a published, locked exam', async () => {
      await expect(service.unlockExam(currentUser, 'exam-1')).rejects.toThrow(
        /Only a published exam/,
      );

      prismaMock.exam.findUnique.mockResolvedValue({
        ...exam,
        status: 'PUBLISHED',
        unlockedForEditing: true,
      });
      await expect(service.unlockExam(currentUser, 'exam-1')).rejects.toThrow(
        /already unlocked/,
      );

      prismaMock.exam.findUnique.mockResolvedValue({
        ...exam,
        status: 'PUBLISHED',
      });
      await service.unlockExam(currentUser, 'exam-1');
      expect(tx.exam.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ unlockedForEditing: true }) as never,
        }),
      );
      expect(auditLogMock.log).toHaveBeenCalledWith(
        currentUser,
        expect.objectContaining({ action: 'EXAM_UNLOCKED' }),
        tx,
      );
    });

    it('relocks only an unlocked exam', async () => {
      prismaMock.exam.findUnique.mockResolvedValue({
        ...exam,
        status: 'PUBLISHED',
      });
      await expect(service.relockExam(currentUser, 'exam-1')).rejects.toThrow(
        ConflictException,
      );

      prismaMock.exam.findUnique.mockResolvedValue({
        ...exam,
        status: 'PUBLISHED',
        unlockedForEditing: true,
      });
      await service.relockExam(currentUser, 'exam-1');
      expect(auditLogMock.log).toHaveBeenCalledWith(
        currentUser,
        expect.objectContaining({ action: 'EXAM_RELOCKED' }),
        tx,
      );
    });

    it('turns a concurrent change into a 409 and writes no audit entry', async () => {
      tx.exam.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.publishExam(currentUser, 'exam-1')).rejects.toThrow(
        /changed while you were working/,
      );
      expect(auditLogMock.log).not.toHaveBeenCalled();
    });

    it('checks campus access before changing anything', async () => {
      campusAccessMock.assertCampusAccess.mockRejectedValueOnce(
        new ForbiddenException(),
      );

      await expect(service.publishExam(currentUser, 'exam-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(tx.exam.updateMany).not.toHaveBeenCalled();
    });
  });
});
