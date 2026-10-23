import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GradeBandInputDto } from './dto/examinations.dto';
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
    examTerm: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
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
});
