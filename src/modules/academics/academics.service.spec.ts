import { Test } from '@nestjs/testing';
import { ModuleKey, UserRole } from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
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

  const prismaMock = {
    level: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    academicClass: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    section: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    subject: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
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
    saveValues: jest.fn(),
    resolveInstitutionIdByCampus: jest.fn(),
    resolveInstitutionIdByLevel: jest.fn(),
    resolveInstitutionIdByClass: jest.fn(),
  };

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
    expect(entityCustomFieldsServiceMock.saveValues).toHaveBeenCalledWith({
      institutionId: 'institution-1',
      moduleKey: ModuleKey.ACADEMICS,
      entityType: 'level',
      entityId: 'level-1',
      values: { shift: 'evening' },
    });
    expect(result).toMatchObject({
      message: 'Level updated successfully',
      data: {
        id: 'level-1',
        customFields: { shift: 'evening' },
      },
    });
  });
});
