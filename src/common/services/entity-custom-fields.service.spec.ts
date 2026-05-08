import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ModuleKey } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomFieldEntity } from '../constants/custom-field-entities.constants';
import { EntityCustomFieldsService } from './entity-custom-fields.service';

describe('EntityCustomFieldsService', () => {
  let service: EntityCustomFieldsService;

  const prismaMock = {
    customFieldDefinition: {
      findMany: jest.fn(),
    },
    customFieldValue: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        EntityCustomFieldsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = moduleRef.get<EntityCustomFieldsService>(
      EntityCustomFieldsService,
    );
  });

  it('rejects unknown field keys when saving values', async () => {
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([
      {
        id: 'definition-1',
        fieldKey: 'blood_group',
        label: 'Blood Group',
        inputType: 'SELECT',
        isRequired: false,
        isActive: true,
        sortOrder: 0,
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT,
      },
    ]);

    await expect(
      service.saveValues({
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT,
        entityId: 'student-1',
        values: {
          unknown_key: 'value',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('attaches normalized custom fields to entity items', async () => {
    prismaMock.customFieldValue.findMany.mockResolvedValue([
      {
        entityId: 'student-1',
        value: 'A+',
        definition: {
          fieldKey: 'blood_group',
        },
      },
      {
        entityId: 'student-1',
        value: 'Route 5',
        definition: {
          fieldKey: 'transport_route',
        },
      },
    ]);

    await expect(
      service.attachToItems(
        [
          {
            id: 'student-1',
            regNo: 'NEX-001',
          },
        ],
        CustomFieldEntity.STUDENT,
      ),
    ).resolves.toEqual([
      {
        id: 'student-1',
        regNo: 'NEX-001',
        customFields: {
          blood_group: 'A+',
          transport_route: 'Route 5',
        },
      },
    ]);
  });
});
