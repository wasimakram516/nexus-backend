import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { PrintableCustomValuesService } from '../../common/services/printable-custom-values.service';
import { PrintableMetaService } from '../../common/services/printable-meta.service';
import { ModuleKey, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MAX_ID_CARDS,
  StudentIdCardsService,
} from './student-id-cards.service';

describe('StudentIdCardsService', () => {
  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'a@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };
  const prismaMock = {
    institution: { findUnique: jest.fn() },
    academicYear: { findUnique: jest.fn() },
    studentEnrollment: { findMany: jest.fn() },
  };
  const moduleAccess = { assertModuleEnabledForUser: jest.fn() };
  const campusAccess = { assertCampusAccess: jest.fn() };
  const customFields = { resolveInstitutionIdByCampus: jest.fn() };
  const printableValues = { forRecords: jest.fn() };
  const printableMeta = { build: jest.fn() };
  const service = new StudentIdCardsService(
    prismaMock as unknown as PrismaService,
    moduleAccess as unknown as ModuleAccessService,
    campusAccess as unknown as CampusAccessService,
    customFields as unknown as EntityCustomFieldsService,
    printableValues as unknown as PrintableCustomValuesService,
    printableMeta as unknown as PrintableMetaService,
  );

  const enrollment = (
    id: string,
    name: string,
    className: string,
    section: string | null,
    phone: string | null = null,
  ) => ({
    class: { name: className },
    section: section ? { name: section } : null,
    student: {
      id,
      regNo: `R-${id}`,
      picture: null,
      dob: new Date('2016-06-12T00:00:00.000Z'),
      user: { name },
      guardians: phone
        ? [{ guardian: { contacts: [{ phone1: phone }] } }]
        : [{ guardian: { contacts: [] } }],
    },
  });

  beforeEach(() => {
    jest.resetAllMocks();
    moduleAccess.assertModuleEnabledForUser.mockResolvedValue(undefined);
    campusAccess.assertCampusAccess.mockResolvedValue(undefined);
    customFields.resolveInstitutionIdByCampus.mockResolvedValue('inst-1');
    prismaMock.institution.findUnique.mockResolvedValue({
      currentAcademicYearId: 'year-1',
    });
    prismaMock.academicYear.findUnique.mockResolvedValue({
      endDate: new Date('2027-03-31T00:00:00.000Z'),
    });
    printableMeta.build.mockResolvedValue({ documentType: 'ID_CARD' });
    printableValues.forRecords.mockResolvedValue(
      new Map([['s1', [{ label: 'Blood group', value: 'B+' }]]]),
    );
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      enrollment('s2', 'Bilal', 'Grade 5', 'B', '03001234567'),
      enrollment('s1', 'Ayesha', 'Grade 5', 'A'),
      enrollment('s3', 'Cyrus', 'Grade 10', null),
    ]);
  });

  it('makes a card for each enrolled student with what is printed on it, in class, section and name order', async () => {
    const result = await service.getCards(admin, { campusId: 'campus-1' });

    expect(result.data.cards.map((card) => card.name)).toEqual([
      'Ayesha',
      'Bilal',
      'Cyrus',
    ]);
    expect(result.data.cards[0]).toEqual({
      studentId: 's1',
      name: 'Ayesha',
      regNo: 'R-s1',
      className: 'Grade 5',
      sectionName: 'A',
      picture: null,
      dob: '2016-06-12',
      validUntil: '2027-03-31',
      guardianPhone: null,
      customValues: [{ label: 'Blood group', value: 'B+' }],
    });
    expect(result.data.cards[1].guardianPhone).toBe('03001234567');
    expect(result.data.cards[2].sectionName).toBeNull();
    expect(result.data.printMeta).toEqual({ documentType: 'ID_CARD' });
    expect(printableMeta.build).toHaveBeenCalledWith(
      'ID_CARD',
      'inst-1',
      'campus-1',
    );
  });

  it('numbers classes the way people do, so Grade 10 follows Grade 9', async () => {
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      enrollment('a', 'A', 'Grade 10', 'A'),
      enrollment('b', 'B', 'Grade 9', 'A'),
    ]);

    const result = await service.getCards(admin, { campusId: 'campus-1' });

    expect(result.data.cards.map((card) => card.className)).toEqual([
      'Grade 9',
      'Grade 10',
    ]);
  });

  it('asks only for active students of the current year at the campus, narrowed by what was chosen', async () => {
    await service.getCards(admin, {
      campusId: 'campus-1',
      classId: 'class-1',
      sectionId: 'section-1',
      studentId: 's1',
    });

    expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          academicYearId: 'year-1',
          campusId: 'campus-1',
          status: 'ACTIVE',
          deletedAt: null,
          classId: 'class-1',
          sectionId: 'section-1',
          studentId: 's1',
        },
      }),
    );
    expect(printableValues.forRecords).toHaveBeenCalledWith(
      'inst-1',
      'student',
      ['s2', 's1', 's3'],
    );
  });

  it('checks the module and the campus', async () => {
    await service.getCards(admin, { campusId: 'campus-1' });
    expect(moduleAccess.assertModuleEnabledForUser).toHaveBeenCalledWith(
      admin,
      ModuleKey.PEOPLE,
    );
    expect(campusAccess.assertCampusAccess).toHaveBeenCalledWith(
      admin,
      'campus-1',
    );

    campusAccess.assertCampusAccess.mockRejectedValue(
      new ForbiddenException('no'),
    );
    await expect(
      service.getCards(admin, { campusId: 'campus-9' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('has no cards, but still the print header, when no academic year is current', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      currentAcademicYearId: null,
    });

    const result = await service.getCards(admin, { campusId: 'campus-1' });

    expect(result.data.cards).toEqual([]);
    expect(result.data.printMeta).toEqual({ documentType: 'ID_CARD' });
    expect(prismaMock.studentEnrollment.findMany).not.toHaveBeenCalled();
  });

  it('refuses to make more cards than the limit at once, asking for a class', async () => {
    prismaMock.studentEnrollment.findMany.mockResolvedValue(
      Array.from({ length: MAX_ID_CARDS + 1 }, (_, i) =>
        enrollment(`s${i}`, `S${i}`, 'Grade 1', 'A'),
      ),
    );

    await expect(
      service.getCards(admin, { campusId: 'campus-1' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.getCards(admin, { campusId: 'campus-1' }),
    ).rejects.toThrow('Choose a class or section');
  });

  it('leaves the end of the year blank when the year cannot be found', async () => {
    prismaMock.academicYear.findUnique.mockResolvedValue(null);

    const result = await service.getCards(admin, { campusId: 'campus-1' });

    expect(result.data.cards[0].validUntil).toBeNull();
  });
});
