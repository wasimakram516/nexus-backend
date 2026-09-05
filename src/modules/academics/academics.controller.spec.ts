import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AcademicsController } from './academics.controller';
import { AcademicsService } from './academics.service';

/**
 * Only the AcademicYear routes carry real controller-level logic
 * (`requireInstitutionId`, added when the platform-mirror scope-out landed)
 * — every other route on this controller is pure delegation, matching the
 * rest of this codebase's convention of not unit-testing thin controllers.
 */
describe('AcademicsController', () => {
  let controller: AcademicsController;

  const academicsServiceMock = {
    createAcademicYear: jest.fn(),
    listAcademicYears: jest.fn(),
    getCurrentAcademicYear: jest.fn(),
    getAcademicYear: jest.fn(),
    updateAcademicYear: jest.fn(),
    setCurrentAcademicYear: jest.fn(),
    deleteAcademicYear: jest.fn(),
  };

  const currentUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'institution-1',
  };

  const unscopedUser: CurrentUser = {
    sub: 'super-1',
    email: 'super@nexus.test',
    role: UserRole.SUPERADMIN,
    institutionId: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AcademicsController(
      academicsServiceMock as unknown as AcademicsService,
    );
  });

  it('resolves institutionId from currentUser when creating an academic year', () => {
    const dto = {
      name: '2026-27',
      startDate: '2026-08-01',
      endDate: '2027-06-30',
    };

    void controller.createAcademicYear(currentUser, dto);

    expect(academicsServiceMock.createAcademicYear).toHaveBeenCalledWith(
      'institution-1',
      dto,
      currentUser,
    );
  });

  it('resolves institutionId from currentUser when listing academic years', () => {
    void controller.listAcademicYears(currentUser);

    expect(academicsServiceMock.listAcademicYears).toHaveBeenCalledWith(
      'institution-1',
      currentUser,
    );
  });

  it('resolves institutionId from currentUser when getting the current academic year', () => {
    void controller.getCurrentAcademicYear(currentUser, 'campus-1');

    expect(academicsServiceMock.getCurrentAcademicYear).toHaveBeenCalledWith(
      'institution-1',
      currentUser,
      'campus-1',
    );
  });

  it('resolves institutionId from currentUser when getting one academic year', () => {
    void controller.getAcademicYear(currentUser, 'year-1');

    expect(academicsServiceMock.getAcademicYear).toHaveBeenCalledWith(
      'institution-1',
      'year-1',
      currentUser,
    );
  });

  it('resolves institutionId from currentUser when updating an academic year', () => {
    const dto = { name: '2025-26' };

    void controller.updateAcademicYear(currentUser, 'year-1', dto);

    expect(academicsServiceMock.updateAcademicYear).toHaveBeenCalledWith(
      'institution-1',
      'year-1',
      dto,
      currentUser,
    );
  });

  it('resolves institutionId from currentUser when setting the current academic year', () => {
    void controller.setCurrentAcademicYear(currentUser, 'year-1');

    expect(academicsServiceMock.setCurrentAcademicYear).toHaveBeenCalledWith(
      'institution-1',
      'year-1',
      currentUser,
    );
  });

  it('resolves institutionId from currentUser when deleting an academic year', () => {
    void controller.deleteAcademicYear(currentUser, 'year-1', {
      reason: 'test',
    });

    expect(academicsServiceMock.deleteAcademicYear).toHaveBeenCalledWith(
      'institution-1',
      'year-1',
      currentUser,
      'test',
    );
  });

  it('throws ForbiddenException instead of calling the service when the caller has no institution context', () => {
    expect(() => controller.listAcademicYears(unscopedUser)).toThrow(
      ForbiddenException,
    );
    expect(academicsServiceMock.listAcademicYears).not.toHaveBeenCalled();
  });
});
