import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CustomFieldEntity } from '../../common/constants/custom-field-entities.constants';
import { CustomFieldInputType, ModuleKey, UserRole } from '../../prisma/client';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomFieldsService } from './custom-fields.service';

describe('CustomFieldsService', () => {
  let service: CustomFieldsService;

  const adminUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'institution-1',
  };

  const prismaMock = {
    institution: {
      findUnique: jest.fn(),
    },
    customFieldDefinition: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    customFieldValue: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    student: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomFieldsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: CampusAccessService,
          useValue: {
            assertCampusAccess: jest.fn(),
            assertLevelAccess: jest.fn(),
            assertClassAccess: jest.fn(),
            assertSectionAccess: jest.fn(),
            assertSubjectAccess: jest.fn(),
            assertStudentAccess: jest.fn(),
            assertGuardianAccess: jest.fn(),
            assertTeacherAccess: jest.fn(),
          },
        },
        {
          provide: ModuleAccessService,
          useValue: {
            assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<CustomFieldsService>(CustomFieldsService);
  });

  it('creates a definition for the admin institution', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    prismaMock.customFieldDefinition.create.mockResolvedValue({
      id: 'field-1',
      institutionId: 'institution-1',
      fieldKey: 'blood_group',
    });

    await expect(
      service.createDefinition(adminUser, {
        moduleKey: ModuleKey.PEOPLE,
        entityType: 'student',
        fieldKey: 'blood_group',
        label: 'Blood Group',
        inputType: CustomFieldInputType.SELECT,
        options: [
          { label: 'A+', value: 'A+' },
          { label: 'O+', value: 'O+' },
        ],
      }),
    ).resolves.toMatchObject({
      message: 'Custom field definition created successfully',
      data: {
        institutionId: 'institution-1',
        fieldKey: 'blood_group',
      },
    });
  });

  it('blocks admins from listing another institution custom fields', async () => {
    await expect(
      service.listDefinitions(adminUser, {
        institutionId: 'institution-2',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows first-class email fields without options', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    prismaMock.customFieldDefinition.create.mockResolvedValue({
      id: 'field-2',
      institutionId: 'institution-1',
      fieldKey: 'parent_email',
      inputType: CustomFieldInputType.EMAIL,
    });

    await expect(
      service.createDefinition(adminUser, {
        moduleKey: ModuleKey.PEOPLE,
        entityType: 'guardian',
        fieldKey: 'parent_email',
        label: 'Parent Email',
        inputType: CustomFieldInputType.EMAIL,
      }),
    ).resolves.toMatchObject({
      data: {
        fieldKey: 'parent_email',
        inputType: CustomFieldInputType.EMAIL,
      },
    });
  });

  it('requires options for select-like field types', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });

    await expect(
      service.createDefinition(adminUser, {
        moduleKey: ModuleKey.PEOPLE,
        entityType: 'student',
        fieldKey: 'transport_route',
        label: 'Transport Route',
        inputType: CustomFieldInputType.SELECT,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks saving a custom field value for a student outside the actor institution scope', async () => {
    prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
      id: 'definition-1',
      institutionId: 'institution-1',
      moduleKey: ModuleKey.PEOPLE,
      entityType: CustomFieldEntity.STUDENT,
      fieldKey: 'blood_group',
      label: 'Blood Group',
      inputType: CustomFieldInputType.TEXT,
      isRequired: false,
      isActive: true,
      sortOrder: 0,
    });
    prismaMock.student.findUnique.mockResolvedValue({
      campus: {
        institutionId: 'institution-2',
      },
    });

    await expect(
      service.upsertValue(adminUser, {
        definitionId: 'definition-1',
        entityId: 'student-1',
        value: 'A+',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('saves a custom field value for an accessible student entity', async () => {
    prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
      id: 'definition-1',
      institutionId: 'institution-1',
      moduleKey: ModuleKey.PEOPLE,
      entityType: CustomFieldEntity.STUDENT,
      fieldKey: 'blood_group',
      label: 'Blood Group',
      inputType: CustomFieldInputType.TEXT,
      isRequired: false,
      isActive: true,
      sortOrder: 0,
    });
    prismaMock.student.findUnique.mockResolvedValue({
      campus: {
        institutionId: 'institution-1',
      },
    });
    prismaMock.customFieldValue.upsert.mockResolvedValue({
      id: 'value-1',
      entityId: 'student-1',
      definition: {
        id: 'definition-1',
      },
    });

    await expect(
      service.upsertValue(adminUser, {
        definitionId: 'definition-1',
        entityId: 'student-1',
        value: 'A+',
      }),
    ).resolves.toMatchObject({
      message: 'Custom field value saved successfully',
      data: {
        id: 'value-1',
        entityId: 'student-1',
      },
    });
  });
});
