import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AcademicsService } from './academics.service';

describe('AcademicsService', () => {
  let service: AcademicsService;

  const currentUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'institution-1',
  };

  const academicYearTxMock = {
    academicYear: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    academicYearCampusOverride: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const prismaMock = {
    level: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    academicClass: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    section: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    subject: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    institution: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    campus: {
      findUnique: jest.fn(),
    },
    academicYear: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    academicYearCampusOverride: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(
      async (callback: (tx: typeof academicYearTxMock) => Promise<unknown>) =>
        callback(academicYearTxMock),
    ),
  };

  const campusAccessServiceMock = {
    getScopedCampusIds: jest.fn(),
    getCampusIdsForUser: jest.fn(),
    assertCampusAccess: jest.fn(),
    assertLevelAccess: jest.fn(),
    assertClassAccess: jest.fn(),
    assertSectionAccess: jest.fn(),
    assertSubjectAccess: jest.fn(),
  };

  const entityCustomFieldsServiceMock = {
    attachToItems: jest.fn(),
    attachToItem: jest.fn(),
    saveRecord: jest.fn(
      async (
        _params: unknown,
        mutation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      ) => mutation(prismaMock as unknown as Prisma.TransactionClient),
    ),
    resolveInstitutionIdByCampus: jest.fn(),
    resolveInstitutionIdByLevel: jest.fn(),
    resolveInstitutionIdByClass: jest.fn(),
  };

  const attachPassthrough = <T>(item: T) =>
    Promise.resolve(item ? { ...item, customFields: {} } : null);
  const attachItemsPassthrough = <T>(items: T[]) =>
    Promise.resolve(
      items.map((item) => ({ ...(item as object), customFields: {} })),
    );

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AcademicsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: CampusAccessService,
          useValue: campusAccessServiceMock,
        },
        {
          provide: EntityCustomFieldsService,
          useValue: entityCustomFieldsServiceMock,
        },
        {
          provide: ModuleAccessService,
          useValue: {
            assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RequestContextService,
          useValue: {
            runWith: jest
              .fn()
              .mockImplementation(
                (
                  _state: Record<string, unknown>,
                  callback: () => Promise<unknown>,
                ) => callback(),
              ),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<AcademicsService>(AcademicsService);
  });

  it('scopes level listing to accessible campuses for non-superadmins', async () => {
    campusAccessServiceMock.getScopedCampusIds.mockResolvedValue(['campus-1']);
    prismaMock.level.findMany.mockResolvedValue([
      { id: 'level-1', campusId: 'campus-1', name: 'Primary' },
    ]);
    entityCustomFieldsServiceMock.attachToItems.mockResolvedValue([
      {
        id: 'level-1',
        campusId: 'campus-1',
        name: 'Primary',
        customFields: {},
      },
    ]);

    const result = await service.listLevels(currentUser);

    expect(campusAccessServiceMock.getScopedCampusIds).toHaveBeenCalledWith(
      currentUser,
      undefined,
    );
    expect(prismaMock.level.findMany).toHaveBeenCalledWith({
      where: { campusId: { in: ['campus-1'] } },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toMatchObject({
      message: 'Levels retrieved successfully',
      data: [
        {
          id: 'level-1',
          campusId: 'campus-1',
        },
      ],
    });
  });

  it('retrieves a level with attached custom fields', async () => {
    campusAccessServiceMock.assertLevelAccess.mockResolvedValue('campus-1');
    prismaMock.level.findUnique.mockResolvedValue({
      id: 'level-1',
      campusId: 'campus-1',
      name: 'Primary',
    });
    entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
      id: 'level-1',
      campusId: 'campus-1',
      name: 'Primary',
      customFields: { shift: 'morning' },
    });

    const result = await service.getLevel(currentUser, 'level-1');

    expect(result).toMatchObject({
      message: 'Level retrieved successfully',
      data: {
        id: 'level-1',
        customFields: { shift: 'morning' },
      },
    });
  });

  it('updates a level and persists custom fields for the resolved campus institution', async () => {
    campusAccessServiceMock.assertLevelAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
    prismaMock.level.findUnique.mockResolvedValue({
      id: 'level-1',
      campusId: 'campus-1',
      name: 'Primary',
    });
    prismaMock.level.update.mockResolvedValue({
      id: 'level-1',
      campusId: 'campus-1',
      name: 'Senior Primary',
    });
    entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
      'institution-1',
    );
    entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
      id: 'level-1',
      name: 'Senior Primary',
      customFields: { shift: 'evening' },
    });

    const result = await service.updateLevel(currentUser, 'level-1', {
      name: 'Senior Primary',
      customFields: { shift: 'evening' },
    });

    expect(prismaMock.level.update).toHaveBeenCalledWith({
      where: { id: 'level-1' },
      data: {
        name: 'Senior Primary',
      },
    });
    expect(
      entityCustomFieldsServiceMock.saveRecord.mock.calls.map(
        ([params]) => params,
      ),
    ).toMatchObject([
      {
        institutionId: 'institution-1',
        moduleKey: ModuleKey.ACADEMICS,
        entityType: 'level',
        create: false,
        values: { shift: 'evening' },
      },
    ]);
    expect(result).toMatchObject({
      message: 'Level updated successfully',
      data: {
        id: 'level-1',
        customFields: { shift: 'evening' },
      },
    });
  });

  it('creates a level for the resolved campus institution', async () => {
    entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
      'institution-1',
    );
    prismaMock.level.create.mockResolvedValue({
      id: 'level-1',
      campusId: 'campus-1',
      name: 'Primary',
    });
    entityCustomFieldsServiceMock.attachToItem.mockImplementation(
      attachPassthrough,
    );

    const result = await service.createLevel(currentUser, {
      campusId: 'campus-1',
      name: 'Primary',
    });

    expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
      currentUser,
      'campus-1',
    );
    expect(result).toMatchObject({ message: 'Level created successfully' });
  });

  it('soft-deletes a level', async () => {
    campusAccessServiceMock.assertLevelAccess.mockResolvedValue('campus-1');
    prismaMock.level.findUnique.mockResolvedValue({
      id: 'level-1',
      campusId: 'campus-1',
      name: 'Primary',
    });

    const result = await service.deleteLevel(currentUser, 'level-1', 'Merged');

    expect(prismaMock.level.update).toHaveBeenCalledWith({
      where: { id: 'level-1' },
      data: expect.objectContaining({
        deleteReason: 'Merged',
        deletedBy: currentUser.sub,
      }) as never,
    });
    expect(result.message).toBe('Level moved to recycle bin successfully');
  });

  it('returns 404 deleting a level that does not exist', async () => {
    campusAccessServiceMock.assertLevelAccess.mockResolvedValue('campus-1');
    prismaMock.level.findUnique.mockResolvedValue(null);

    await expect(
      service.deleteLevel(currentUser, 'missing-level'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 updating a level that does not exist', async () => {
    prismaMock.level.findUnique.mockResolvedValue(null);

    await expect(
      service.updateLevel(currentUser, 'missing-level', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('Class', () => {
    beforeEach(() => {
      entityCustomFieldsServiceMock.resolveInstitutionIdByLevel.mockResolvedValue(
        'institution-1',
      );
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        attachPassthrough,
      );
      entityCustomFieldsServiceMock.attachToItems.mockImplementation(
        attachItemsPassthrough,
      );
    });

    it('creates a class scoped to the level', async () => {
      prismaMock.academicClass.create.mockResolvedValue({
        id: 'class-1',
        levelId: 'level-1',
        name: 'Grade 1',
      });

      const result = await service.createClass(currentUser, {
        levelId: 'level-1',
        name: 'Grade 1',
      });

      expect(campusAccessServiceMock.assertLevelAccess).toHaveBeenCalledWith(
        currentUser,
        'level-1',
      );
      expect(result).toMatchObject({ message: 'Class created successfully' });
    });

    it('lists classes scoped to accessible campuses for non-superadmins', async () => {
      campusAccessServiceMock.getCampusIdsForUser.mockResolvedValue([
        'campus-1',
      ]);
      prismaMock.academicClass.findMany.mockResolvedValue([]);

      await service.listClasses(currentUser);

      expect(prismaMock.academicClass.findMany).toHaveBeenCalledWith({
        where: { level: { campusId: { in: ['campus-1'] } } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('lists classes for a superadmin with no campus filter', async () => {
      const superadmin: CurrentUser = {
        sub: 'super-1',
        email: 'super@nexus.test',
        role: UserRole.SUPERADMIN,
        institutionId: null,
      };
      prismaMock.academicClass.findMany.mockResolvedValue([]);

      await service.listClasses(superadmin);

      expect(prismaMock.academicClass.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
      });
      expect(
        campusAccessServiceMock.getCampusIdsForUser,
      ).not.toHaveBeenCalled();
    });

    it('filters classes by levelId and asserts level access', async () => {
      prismaMock.academicClass.findMany.mockResolvedValue([]);
      campusAccessServiceMock.getCampusIdsForUser.mockResolvedValue([
        'campus-1',
      ]);

      await service.listClasses(currentUser, 'level-1');

      expect(campusAccessServiceMock.assertLevelAccess).toHaveBeenCalledWith(
        currentUser,
        'level-1',
      );
      expect(prismaMock.academicClass.findMany).toHaveBeenCalledWith({
        where: {
          levelId: 'level-1',
          level: { campusId: { in: ['campus-1'] } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('gets a class and throws 404 when missing', async () => {
      prismaMock.academicClass.findUnique.mockResolvedValue({
        id: 'class-1',
        levelId: 'level-1',
      });

      await expect(
        service.getClass(currentUser, 'class-1'),
      ).resolves.toMatchObject({ message: 'Class retrieved successfully' });

      entityCustomFieldsServiceMock.attachToItem.mockResolvedValueOnce(null);
      prismaMock.academicClass.findUnique.mockResolvedValue(null);

      await expect(
        service.getClass(currentUser, 'missing-class'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 updating a class that does not exist', async () => {
      prismaMock.academicClass.findUnique.mockResolvedValue(null);

      await expect(
        service.updateClass(currentUser, 'missing-class', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates a class, re-asserting access to the target level', async () => {
      prismaMock.academicClass.findUnique.mockResolvedValue({
        id: 'class-1',
        levelId: 'level-1',
        name: 'Grade 1',
      });
      prismaMock.academicClass.update.mockResolvedValue({
        id: 'class-1',
        levelId: 'level-2',
        name: 'Grade 1',
      });

      const result = await service.updateClass(currentUser, 'class-1', {
        levelId: 'level-2',
      });

      expect(campusAccessServiceMock.assertLevelAccess).toHaveBeenCalledWith(
        currentUser,
        'level-2',
      );
      expect(result).toMatchObject({ message: 'Class updated successfully' });
    });

    it('soft-deletes a class', async () => {
      prismaMock.academicClass.findUnique.mockResolvedValue({
        id: 'class-1',
        levelId: 'level-1',
        name: 'Grade 1',
      });

      const result = await service.deleteClass(currentUser, 'class-1');

      expect(prismaMock.academicClass.update).toHaveBeenCalledWith({
        where: { id: 'class-1' },
        data: expect.objectContaining({ deletedBy: currentUser.sub }) as never,
      });
      expect(result.message).toBe('Class moved to recycle bin successfully');
    });

    it('returns 404 deleting a class that does not exist', async () => {
      prismaMock.academicClass.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteClass(currentUser, 'missing-class'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Section', () => {
    beforeEach(() => {
      entityCustomFieldsServiceMock.resolveInstitutionIdByClass.mockResolvedValue(
        'institution-1',
      );
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        attachPassthrough,
      );
      entityCustomFieldsServiceMock.attachToItems.mockImplementation(
        attachItemsPassthrough,
      );
    });

    it('creates a section scoped to the class', async () => {
      prismaMock.section.create.mockResolvedValue({
        id: 'section-1',
        classId: 'class-1',
        name: 'A',
      });

      const result = await service.createSection(currentUser, {
        classId: 'class-1',
        name: 'A',
      });

      expect(campusAccessServiceMock.assertClassAccess).toHaveBeenCalledWith(
        currentUser,
        'class-1',
      );
      expect(result).toMatchObject({
        message: 'Section created successfully',
      });
    });

    it('lists sections scoped to accessible campuses, filtered by classId', async () => {
      campusAccessServiceMock.getCampusIdsForUser.mockResolvedValue([
        'campus-1',
      ]);
      prismaMock.section.findMany.mockResolvedValue([]);

      await service.listSections(currentUser, 'class-1');

      expect(campusAccessServiceMock.assertClassAccess).toHaveBeenCalledWith(
        currentUser,
        'class-1',
      );
      expect(prismaMock.section.findMany).toHaveBeenCalledWith({
        where: {
          classId: 'class-1',
          class: { level: { campusId: { in: ['campus-1'] } } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('gets a section and throws 404 when missing', async () => {
      prismaMock.section.findUnique.mockResolvedValue(null);

      await expect(
        service.getSection(currentUser, 'missing-section'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 updating a section that does not exist', async () => {
      prismaMock.section.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSection(currentUser, 'missing-section', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates a section, re-asserting access to the target class', async () => {
      prismaMock.section.findUnique.mockResolvedValue({
        id: 'section-1',
        classId: 'class-1',
        name: 'A',
      });
      prismaMock.section.update.mockResolvedValue({
        id: 'section-1',
        classId: 'class-2',
        name: 'A',
      });

      const result = await service.updateSection(currentUser, 'section-1', {
        classId: 'class-2',
      });

      expect(campusAccessServiceMock.assertClassAccess).toHaveBeenCalledWith(
        currentUser,
        'class-2',
      );
      expect(result).toMatchObject({
        message: 'Section updated successfully',
      });
    });

    it('soft-deletes a section', async () => {
      prismaMock.section.findUnique.mockResolvedValue({
        id: 'section-1',
        classId: 'class-1',
        name: 'A',
      });

      const result = await service.deleteSection(currentUser, 'section-1');

      expect(result.message).toBe('Section moved to recycle bin successfully');
    });

    it('returns 404 deleting a section that does not exist', async () => {
      prismaMock.section.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteSection(currentUser, 'missing-section'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Subject', () => {
    beforeEach(() => {
      entityCustomFieldsServiceMock.resolveInstitutionIdByClass.mockResolvedValue(
        'institution-1',
      );
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        attachPassthrough,
      );
      entityCustomFieldsServiceMock.attachToItems.mockImplementation(
        attachItemsPassthrough,
      );
    });

    it('creates a subject scoped to the class', async () => {
      prismaMock.subject.create.mockResolvedValue({
        id: 'subject-1',
        classId: 'class-1',
        name: 'Math',
      });

      const result = await service.createSubject(currentUser, {
        classId: 'class-1',
        name: 'Math',
      });

      expect(campusAccessServiceMock.assertClassAccess).toHaveBeenCalledWith(
        currentUser,
        'class-1',
      );
      expect(result).toMatchObject({
        message: 'Subject created successfully',
      });
    });

    it('lists subjects with no classId filter and non-superadmin campus scoping', async () => {
      campusAccessServiceMock.getCampusIdsForUser.mockResolvedValue([
        'campus-1',
      ]);
      prismaMock.subject.findMany.mockResolvedValue([]);

      await service.listSubjects(currentUser);

      expect(campusAccessServiceMock.assertClassAccess).not.toHaveBeenCalled();
      expect(prismaMock.subject.findMany).toHaveBeenCalledWith({
        where: { class: { level: { campusId: { in: ['campus-1'] } } } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('gets a subject and throws 404 when missing', async () => {
      prismaMock.subject.findUnique.mockResolvedValue(null);

      await expect(
        service.getSubject(currentUser, 'missing-subject'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 updating a subject that does not exist', async () => {
      prismaMock.subject.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSubject(currentUser, 'missing-subject', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates a subject, re-asserting access to the target class', async () => {
      prismaMock.subject.findUnique.mockResolvedValue({
        id: 'subject-1',
        classId: 'class-1',
        name: 'Math',
      });
      prismaMock.subject.update.mockResolvedValue({
        id: 'subject-1',
        classId: 'class-2',
        name: 'Math',
      });

      const result = await service.updateSubject(currentUser, 'subject-1', {
        classId: 'class-2',
      });

      expect(campusAccessServiceMock.assertClassAccess).toHaveBeenCalledWith(
        currentUser,
        'class-2',
      );
      expect(result).toMatchObject({
        message: 'Subject updated successfully',
      });
    });

    it('soft-deletes a subject', async () => {
      prismaMock.subject.findUnique.mockResolvedValue({
        id: 'subject-1',
        classId: 'class-1',
        name: 'Math',
      });

      const result = await service.deleteSubject(currentUser, 'subject-1');

      expect(result.message).toBe('Subject moved to recycle bin successfully');
    });

    it('returns 404 deleting a subject that does not exist', async () => {
      prismaMock.subject.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteSubject(currentUser, 'missing-subject'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Academic Years', () => {
    // `institutionId` is always an explicit parameter now (RolesService
    // shape) — this matches `currentUser.institutionId` for the regular
    // institution-scoped path, and is a caller-supplied value for the
    // superadmin platform-mirror path (see the "platform-mirror" tests
    // below, which pass a *different* institution than the caller's own).
    const institutionId = 'institution-1';

    const superadmin: CurrentUser = {
      sub: 'super-1',
      email: 'super@nexus.test',
      role: UserRole.SUPERADMIN,
      institutionId: null,
    };

    it('creates an academic year with no overrides', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
      });
      academicYearTxMock.academicYear.create.mockResolvedValue({
        id: 'year-1',
      });
      academicYearTxMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        institutionId,
        name: '2026-27',
        campusOverrides: [],
      });

      const result = await service.createAcademicYear(
        institutionId,
        {
          name: '2026-27',
          startDate: '2026-08-01',
          endDate: '2027-06-30',
        },
        currentUser,
      );

      expect(campusAccessServiceMock.assertCampusAccess).not.toHaveBeenCalled();
      expect(academicYearTxMock.academicYear.create).toHaveBeenCalledWith({
        data: {
          institutionId,
          name: '2026-27',
          startDate: new Date('2026-08-01'),
          endDate: new Date('2027-06-30'),
        },
      });
      expect(
        academicYearTxMock.academicYearCampusOverride.createMany,
      ).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        message: 'Academic year created successfully',
        data: { id: 'year-1', isCurrent: false },
      });
    });

    it('returns 404 creating an academic year for an institution that does not exist', async () => {
      prismaMock.institution.findUnique.mockResolvedValue(null);

      await expect(
        service.createAcademicYear(
          'bogus-institution',
          {
            name: '2026-27',
            startDate: '2026-08-01',
            endDate: '2027-06-30',
          },
          superadmin,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('validates campus access and institution match, then creates campus overrides', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
      });
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      prismaMock.campus.findUnique.mockResolvedValue({
        institutionId,
      });
      academicYearTxMock.academicYear.create.mockResolvedValue({
        id: 'year-1',
      });
      academicYearTxMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        campusOverrides: [{ campusId: 'campus-1' }],
      });

      await service.createAcademicYear(
        institutionId,
        {
          name: '2026-27',
          startDate: '2026-08-01',
          endDate: '2027-06-30',
          campusOverrides: [{ campusId: 'campus-1', startDate: '2026-09-01' }],
        },
        currentUser,
      );

      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        currentUser,
        'campus-1',
      );
      expect(prismaMock.campus.findUnique).toHaveBeenCalledWith({
        where: { id: 'campus-1' },
        select: { institutionId: true },
      });
      expect(
        academicYearTxMock.academicYearCampusOverride.createMany,
      ).toHaveBeenCalledWith({
        data: [
          {
            academicYearId: 'year-1',
            campusId: 'campus-1',
            startDate: new Date('2026-09-01'),
            endDate: null,
          },
        ],
      });
    });

    it('rejects a campus override whose campus belongs to a different institution — even for a superadmin acting on another institution', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: 'institution-B',
      });
      // SUPERADMIN has blanket campus access (getCampusIdsForUser returns
      // every campus across every institution), so this always resolves —
      // it's the explicit institution-match check below that must catch
      // a campus belonging to a *third* institution.
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-c');
      prismaMock.campus.findUnique.mockResolvedValue({
        institutionId: 'institution-C',
      });

      await expect(
        service.createAcademicYear(
          'institution-B',
          {
            name: '2026-27',
            startDate: '2026-08-01',
            endDate: '2027-06-30',
            campusOverrides: [{ campusId: 'campus-c' }],
          },
          superadmin,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(academicYearTxMock.academicYear.create).not.toHaveBeenCalled();
    });

    it('accepts a superadmin campus override when the campus matches the target institution, not the superadmin own (null) institution', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: 'institution-B',
      });
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-b');
      prismaMock.campus.findUnique.mockResolvedValue({
        institutionId: 'institution-B',
      });
      academicYearTxMock.academicYear.create.mockResolvedValue({
        id: 'year-b1',
      });
      academicYearTxMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-b1',
        institutionId: 'institution-B',
        campusOverrides: [{ campusId: 'campus-b' }],
      });

      const result = await service.createAcademicYear(
        'institution-B',
        {
          name: '2026-27',
          startDate: '2026-08-01',
          endDate: '2027-06-30',
          campusOverrides: [{ campusId: 'campus-b' }],
        },
        superadmin,
      );

      expect(academicYearTxMock.academicYear.create).toHaveBeenCalledWith({
        data: {
          institutionId: 'institution-B',
          name: '2026-27',
          startDate: new Date('2026-08-01'),
          endDate: new Date('2027-06-30'),
        },
      });
      expect(result).toMatchObject({
        data: { id: 'year-b1' },
      });
    });

    it('surfaces a duplicate academic year name as a 409 conflict', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
      });
      academicYearTxMock.academicYear.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createAcademicYear(
          institutionId,
          {
            name: '2026-27',
            startDate: '2026-08-01',
            endDate: '2027-06-30',
          },
          currentUser,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows a non-conflict error from academic year creation unchanged', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
      });
      const dbError = new Error('connection lost');
      academicYearTxMock.academicYear.create.mockRejectedValue(dbError);

      await expect(
        service.createAcademicYear(
          institutionId,
          {
            name: '2026-27',
            startDate: '2026-08-01',
            endDate: '2027-06-30',
          },
          currentUser,
        ),
      ).rejects.toBe(dbError);
    });

    it('flags the institution current year when listing academic years', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
        currentAcademicYearId: 'year-2',
      });
      prismaMock.academicYear.findMany.mockResolvedValue([
        { id: 'year-1', name: '2025-26' },
        { id: 'year-2', name: '2026-27' },
      ]);

      const result = await service.listAcademicYears(
        institutionId,
        currentUser,
      );

      expect(prismaMock.academicYear.findMany).toHaveBeenCalledWith({
        where: { institutionId },
        include: { campusOverrides: true },
        orderBy: { startDate: 'desc' },
      });
      expect(result.data).toEqual([
        { id: 'year-1', name: '2025-26', isCurrent: false },
        { id: 'year-2', name: '2026-27', isCurrent: true },
      ]);
    });

    it('lists academic years for another institution via the platform-mirror (explicit institutionId) path', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: 'institution-B',
        currentAcademicYearId: null,
      });
      prismaMock.academicYear.findMany.mockResolvedValue([
        { id: 'year-b1', name: '2026-27' },
      ]);

      const result = await service.listAcademicYears(
        'institution-B',
        superadmin,
      );

      expect(prismaMock.academicYear.findMany).toHaveBeenCalledWith({
        where: { institutionId: 'institution-B' },
        include: { campusOverrides: true },
        orderBy: { startDate: 'desc' },
      });
      expect(result.data).toEqual([
        { id: 'year-b1', name: '2026-27', isCurrent: false },
      ]);
    });

    it('returns 404 listing academic years for an institution that does not exist', async () => {
      prismaMock.institution.findUnique.mockResolvedValue(null);

      await expect(
        service.listAcademicYears('bogus-institution', superadmin),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 when resolving the current year and none is set', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
        currentAcademicYearId: null,
      });

      await expect(
        service.getCurrentAcademicYear(institutionId, currentUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 resolving the current year when the pointer references a missing row', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
        currentAcademicYearId: 'year-orphaned',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue(null);

      await expect(
        service.getCurrentAcademicYear(institutionId, currentUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resolves the institution-wide dates when no campus override exists', async () => {
      const staffUser: CurrentUser = { ...currentUser, role: UserRole.STAFF };
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
        currentAcademicYearId: 'year-1',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-06-30'),
      });
      prismaMock.academicYearCampusOverride.findFirst.mockResolvedValue(null);
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');

      const result = await service.getCurrentAcademicYear(
        institutionId,
        staffUser,
        'campus-1',
      );

      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        staffUser,
        'campus-1',
      );
      expect(result.data).toMatchObject({
        effectiveStartDate: new Date('2026-08-01'),
        effectiveEndDate: new Date('2027-06-30'),
        isOverridden: false,
      });
    });

    it('applies a campus override on both dates', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
        currentAcademicYearId: 'year-1',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-06-30'),
      });
      prismaMock.academicYearCampusOverride.findFirst.mockResolvedValue({
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-05-31'),
      });

      const result = await service.getCurrentAcademicYear(
        institutionId,
        currentUser,
        'campus-1',
      );

      expect(result.data).toMatchObject({
        effectiveStartDate: new Date('2026-09-01'),
        effectiveEndDate: new Date('2027-05-31'),
        isOverridden: true,
      });
    });

    it('applies a partial campus override on only the start date', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
        currentAcademicYearId: 'year-1',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-06-30'),
      });
      prismaMock.academicYearCampusOverride.findFirst.mockResolvedValue({
        startDate: new Date('2026-09-15'),
        endDate: null,
      });

      const result = await service.getCurrentAcademicYear(
        institutionId,
        currentUser,
        'campus-1',
      );

      expect(result.data).toMatchObject({
        effectiveStartDate: new Date('2026-09-15'),
        effectiveEndDate: new Date('2027-06-30'),
        isOverridden: true,
      });
    });

    it('gets a single academic year belonging to the given institution', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
        currentAcademicYearId: 'year-1',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        institutionId,
        name: '2026-27',
        campusOverrides: [],
      });

      const result = await service.getAcademicYear(
        institutionId,
        'year-1',
        currentUser,
      );

      expect(result).toMatchObject({
        message: 'Academic year retrieved successfully',
        data: { id: 'year-1', isCurrent: true },
      });
    });

    it('returns 404 getting an academic year that does not exist', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
      });
      prismaMock.academicYear.findUnique.mockResolvedValue(null);

      await expect(
        service.getAcademicYear(institutionId, 'missing-year', currentUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 getting an academic year belonging to another institution', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        institutionId: 'institution-2',
      });

      await expect(
        service.getAcademicYear(institutionId, 'year-1', currentUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 updating an academic year belonging to another institution', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        institutionId: 'institution-2',
      });

      await expect(
        service.updateAcademicYear(
          institutionId,
          'year-1',
          { name: 'x' },
          currentUser,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('surfaces a duplicate name conflict when renaming an academic year on update', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        institutionId,
      });
      academicYearTxMock.academicYear.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.updateAcademicYear(
          institutionId,
          'year-1',
          { name: '2025-26' },
          currentUser,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('replaces campus overrides on update, rotating the old rows out of the unique slot', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
        currentAcademicYearId: null,
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        institutionId,
      });
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-2');
      prismaMock.campus.findUnique.mockResolvedValue({
        institutionId,
      });
      academicYearTxMock.academicYearCampusOverride.findMany.mockResolvedValue([
        { id: 'override-old-1' },
      ]);
      academicYearTxMock.academicYear.update.mockResolvedValue({});
      academicYearTxMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        campusOverrides: [],
      });

      await service.updateAcademicYear(
        institutionId,
        'year-1',
        { campusOverrides: [{ campusId: 'campus-2', endDate: '2027-05-01' }] },
        currentUser,
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock */
      expect(
        academicYearTxMock.academicYearCampusOverride.update,
      ).toHaveBeenCalledWith({
        where: { id: 'override-old-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          deletedBy: currentUser.sub,
          activeScopeKey: 'REPLACED-override-old-1',
        }),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(
        academicYearTxMock.academicYearCampusOverride.createMany,
      ).toHaveBeenCalledWith({
        data: [
          {
            academicYearId: 'year-1',
            campusId: 'campus-2',
            startDate: null,
            endDate: new Date('2027-05-01'),
          },
        ],
      });
    });

    it('sets the institution current academic year pointer', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        institutionId,
      });
      prismaMock.institution.update.mockResolvedValue({});

      const result = await service.setCurrentAcademicYear(
        institutionId,
        'year-1',
        currentUser,
      );

      expect(prismaMock.institution.update).toHaveBeenCalledWith({
        where: { id: institutionId },
        data: { currentAcademicYearId: 'year-1' },
      });
      expect(result).toMatchObject({
        message: 'Current academic year updated successfully',
        data: { id: 'year-1' },
      });
    });

    it('scopes set-current to the path-param institution on the platform-mirror route', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: 'institution-B',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-b1',
        institutionId: 'institution-B',
      });
      prismaMock.institution.update.mockResolvedValue({});

      await service.setCurrentAcademicYear(
        'institution-B',
        'year-b1',
        superadmin,
      );

      expect(prismaMock.institution.update).toHaveBeenCalledWith({
        where: { id: 'institution-B' },
        data: { currentAcademicYearId: 'year-b1' },
      });
    });

    it('rejects setting the current year to one belonging to another institution', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        institutionId: 'institution-2',
      });

      await expect(
        service.setCurrentAcademicYear(institutionId, 'year-1', currentUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.institution.update).not.toHaveBeenCalled();
    });

    it('returns 404 when setting the current year to one that does not exist', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
      });
      prismaMock.academicYear.findUnique.mockResolvedValue(null);

      await expect(
        service.setCurrentAcademicYear(
          institutionId,
          'missing-year',
          currentUser,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 deleting an academic year that does not exist', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
      });
      prismaMock.academicYear.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteAcademicYear(institutionId, 'missing-year', currentUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('blocks deleting the institution current academic year with a 409', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
        currentAcademicYearId: 'year-1',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        institutionId,
        name: '2026-27',
      });

      await expect(
        service.deleteAcademicYear(institutionId, 'year-1', currentUser),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.academicYear.update).not.toHaveBeenCalled();
    });

    it('soft-deletes an academic year that is not the current one', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: institutionId,
        currentAcademicYearId: 'year-2',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-1',
        institutionId,
        name: '2025-26',
      });
      prismaMock.academicYear.update.mockResolvedValue({});

      const result = await service.deleteAcademicYear(
        institutionId,
        'year-1',
        currentUser,
        'No longer needed',
      );

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- untyped Prisma mock */
      expect(prismaMock.academicYear.update).toHaveBeenCalledWith({
        where: { id: 'year-1' },
        data: {
          deletedAt: expect.any(Date),
          deletedBy: currentUser.sub,
          deleteReason: 'No longer needed',
          updatedBy: currentUser.sub,
        },
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(result.message).toBe(
        'Academic year moved to recycle bin successfully',
      );
    });

    it('deletes an academic year for another institution via the platform-mirror (explicit institutionId) path', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: 'institution-B',
        currentAcademicYearId: 'year-b2',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        id: 'year-b1',
        institutionId: 'institution-B',
        name: '2025-26',
      });
      prismaMock.academicYear.update.mockResolvedValue({});

      const result = await service.deleteAcademicYear(
        'institution-B',
        'year-b1',
        superadmin,
      );

      expect(result.message).toBe(
        'Academic year moved to recycle bin successfully',
      );
    });
  });
});
