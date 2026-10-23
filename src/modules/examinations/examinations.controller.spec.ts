import { ForbiddenException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { UserRole } from '../../prisma/client';
import { ExaminationsController } from './examinations.controller';
import { ExaminationsService } from './examinations.service';

/**
 * Every route resolves the institution from the JWT, never from client input
 * (the superadmin path lives on the platform mirror instead), so the
 * institution-scoping behaviour is what is worth pinning here.
 */
describe('ExaminationsController', () => {
  let controller: ExaminationsController;

  const serviceMock = {
    createGradingScale: jest.fn(),
    listGradingScales: jest.fn(),
    getGradingScale: jest.fn(),
    updateGradingScale: jest.fn(),
    setCurrentGradingScale: jest.fn(),
    deleteGradingScale: jest.fn(),
    createExamTerm: jest.fn(),
    listExamTerms: jest.fn(),
    getExamTerm: jest.fn(),
    updateExamTerm: jest.fn(),
    deleteExamTerm: jest.fn(),
  };

  const currentUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const unscopedUser: CurrentUser = {
    sub: 'super-1',
    email: 'super@nexus.test',
    role: UserRole.SUPERADMIN,
    institutionId: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ExaminationsController(
      serviceMock as unknown as ExaminationsService,
    );
  });

  it('passes the JWT institution id when creating a grading scale', () => {
    const dto = {
      name: 'Standard',
      bands: [{ grade: 'A', minPercentage: 0, maxPercentage: 100 }],
    };

    void controller.createGradingScale(currentUser, dto);

    expect(serviceMock.createGradingScale).toHaveBeenCalledWith(
      'inst-1',
      dto,
      currentUser,
    );
  });

  it('passes the JWT institution id and academic year filter when listing terms', () => {
    void controller.listExamTerms(currentUser, 'year-1');

    expect(serviceMock.listExamTerms).toHaveBeenCalledWith(
      'inst-1',
      currentUser,
      'year-1',
    );
  });

  it('passes the delete reason through for both resources', () => {
    void controller.deleteGradingScale(currentUser, 'scale-1', {
      reason: 'obsolete',
    });
    void controller.deleteExamTerm(currentUser, 'term-1', { reason: 'typo' });

    expect(serviceMock.deleteGradingScale).toHaveBeenCalledWith(
      'inst-1',
      'scale-1',
      currentUser,
      'obsolete',
    );
    expect(serviceMock.deleteExamTerm).toHaveBeenCalledWith(
      'inst-1',
      'term-1',
      currentUser,
      'typo',
    );
  });

  it('rejects a caller whose account is not scoped to an institution', () => {
    expect(() => controller.listGradingScales(unscopedUser)).toThrow(
      ForbiddenException,
    );
    expect(() => controller.getExamTerm(unscopedUser, 'term-1')).toThrow(
      ForbiddenException,
    );
    expect(serviceMock.listGradingScales).not.toHaveBeenCalled();
    expect(serviceMock.getExamTerm).not.toHaveBeenCalled();
  });
});
