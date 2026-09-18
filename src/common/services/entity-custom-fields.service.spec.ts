import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomFieldEntity } from '../constants/custom-field-entities.constants';
import { EntityCustomFieldsService } from './entity-custom-fields.service';
import { ModuleAccessService } from './module-access.service';
import { RequestContextService } from './request-context.service';

describe('EntityCustomFieldsService', () => {
  let service: EntityCustomFieldsService;
  let requestContext: RequestContextService;

  const prismaMock = {
    customFieldDefinition: {
      findMany: jest.fn(),
    },
    customFieldValue: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    staffProfile: {
      findUnique: jest.fn(),
    },
    campus: {
      findUnique: jest.fn(),
    },
    level: {
      findUnique: jest.fn(),
    },
    academicClass: {
      findUnique: jest.fn(),
    },
    section: {
      findUnique: jest.fn(),
    },
    subject: {
      findUnique: jest.fn(),
    },
    student: {
      findUnique: jest.fn(),
    },
    guardian: {
      findUnique: jest.fn(),
    },
    staffSalary: {
      findUnique: jest.fn(),
    },
    feeStructure: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        EntityCustomFieldsService,
        RequestContextService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = moduleRef.get<EntityCustomFieldsService>(
      EntityCustomFieldsService,
    );
    requestContext = moduleRef.get(RequestContextService);
  });

  it('requires missing values on creation even when the custom field payload is omitted', async () => {
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([
      {
        id: 'required',
        fieldKey: 'name',
        label: 'Name',
        inputType: 'TEXT',
        isRequired: true,
      },
    ]);
    await expect(
      service.saveValues({
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT,
        entityId: 'student-1',
        requireRequiredFields: true,
      }),
    ).rejects.toThrow('Name is required');
    expect(prismaMock.customFieldValue.upsert).not.toHaveBeenCalled();
  });

  it('saves creation defaults using the same transaction client as the record mutation', async () => {
    const transaction = {
      customFieldDefinition: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'default',
            fieldKey: 'count',
            label: 'Count',
            inputType: 'NUMBER',
            isRequired: true,
            defaultValue: 0,
          },
        ]),
      },
      customFieldValue: { upsert: jest.fn().mockResolvedValue({}) },
    };
    prismaMock.$transaction.mockImplementationOnce(
      async (
        callback: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => callback(transaction as unknown as Prisma.TransactionClient),
    );
    const mutation = jest.fn().mockImplementation(() => {
      expect(requestContext.get('transactionClient')).toBe(transaction);
      return Promise.resolve({ id: 'student-1' });
    });
    await expect(
      service.saveRecord(
        {
          institutionId: 'institution-1',
          moduleKey: ModuleKey.PEOPLE,
          entityType: CustomFieldEntity.STUDENT,
          create: true,
        },
        mutation,
      ),
    ).resolves.toEqual({ id: 'student-1' });
    expect(mutation).toHaveBeenCalledWith(transaction);
    expect(transaction.customFieldValue.upsert.mock.calls).toMatchObject([
      [{ create: { value: 0, entityId: 'student-1' } }],
    ]);
    expect(prismaMock.customFieldValue.upsert).not.toHaveBeenCalled();
    expect(requestContext.get('transactionClient')).toBeUndefined();
  });

  it('does not re-validate an untouched required field on a partial update', async () => {
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([
      {
        id: 'required',
        fieldKey: 'name',
        label: 'Name',
        inputType: 'TEXT',
        isRequired: true,
      },
      {
        id: 'other',
        fieldKey: 'nickname',
        label: 'Nickname',
        inputType: 'TEXT',
        isRequired: false,
      },
    ]);
    prismaMock.$transaction.mockResolvedValue(undefined);

    // requireRequiredFields is false (the update path) and only "nickname"
    // is submitted — "name" being required and absent must not block this.
    await expect(
      service.saveValues({
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT,
        entityId: 'student-1',
        values: { nickname: 'Ace' },
      }),
    ).resolves.toEqual({ nickname: 'Ace' });
  });

  it('rejects an update that explicitly clears a required field to empty', async () => {
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([
      {
        id: 'required',
        fieldKey: 'name',
        label: 'Name',
        inputType: 'TEXT',
        isRequired: true,
      },
    ]);

    // Submitting the field with an empty value is different from omitting
    // it: the caller is explicitly clearing a required field, which must
    // still be rejected even outside the create/requireRequiredFields path.
    await expect(
      service.saveValues({
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT,
        entityId: 'student-1',
        values: { name: '' },
      }),
    ).rejects.toThrow('Name is required');
    expect(prismaMock.customFieldValue.upsert).not.toHaveBeenCalled();
  });

  it('applies the configured default only when a field is omitted, never when explicitly cleared', async () => {
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([
      {
        id: 'defaulted',
        fieldKey: 'shift',
        label: 'Shift',
        inputType: 'TEXT',
        isRequired: true,
        defaultValue: 'Morning',
      },
    ]);
    prismaMock.$transaction.mockResolvedValue(undefined);

    // Omitted entirely on create: the default is applied.
    await expect(
      service.saveValues({
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT,
        entityId: 'student-1',
        requireRequiredFields: true,
      }),
    ).resolves.toEqual({ shift: 'Morning' });

    // Explicitly cleared on create: the default must NOT paper over an
    // intentional empty submission — this is still a required-field failure.
    await expect(
      service.saveValues({
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT,
        entityId: 'student-1',
        values: { shift: '' },
        requireRequiredFields: true,
      }),
    ).rejects.toThrow('Shift is required');
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

  it('rejects conflicting legacy and canonical definitions instead of choosing one', async () => {
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([
      { id: 'one', fieldKey: 'name' },
      { id: 'two', fieldKey: 'name' },
    ]);
    await expect(
      service.saveValues({
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT,
        entityId: 'student-1',
        values: { name: 'Name' },
      }),
    ).rejects.toThrow('Conflicting');
    expect(prismaMock.customFieldDefinition.findMany.mock.calls).toMatchObject([
      [{ where: { entityType: { equals: 'student', mode: 'insensitive' } } }],
    ]);
    expect(prismaMock.customFieldValue.upsert).not.toHaveBeenCalled();
  });

  it('validates every submitted value before issuing any writes', async () => {
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([
      {
        id: 'valid',
        fieldKey: 'name',
        label: 'Name',
        inputType: 'TEXT',
        isRequired: false,
      },
      {
        id: 'invalid',
        fieldKey: 'age',
        label: 'Age',
        inputType: 'NUMBER',
        isRequired: false,
      },
    ]);

    await expect(
      service.saveValues({
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT,
        entityId: 'student-1',
        values: { name: 'Valid name', age: 'invalid number' },
      }),
    ).rejects.toThrow('Age has an invalid value');
    expect(prismaMock.customFieldValue.upsert).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
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

  describe('plan gating (M4.5 shared blocker #3)', () => {
    let gatedService: EntityCustomFieldsService;
    const resolvePlanKeyForInstitution = jest.fn();

    beforeEach(async () => {
      jest.clearAllMocks();
      resolvePlanKeyForInstitution.mockResolvedValue('starter');

      const moduleRef = await Test.createTestingModule({
        providers: [
          EntityCustomFieldsService,
          RequestContextService,
          { provide: PrismaService, useValue: prismaMock },
          {
            provide: ModuleAccessService,
            useValue: { resolvePlanKeyForInstitution },
          },
        ],
      }).compile();

      gatedService = moduleRef.get(EntityCustomFieldsService);
    });

    it('rejects a submitted value for a field the institution’s plan does not include', async () => {
      prismaMock.customFieldDefinition.findMany.mockResolvedValue([
        {
          id: 'gated',
          fieldKey: 'premium_note',
          label: 'Premium note',
          inputType: 'TEXT',
          isRequired: false,
          planKeys: ['pro', 'enterprise'],
        },
      ]);

      await expect(
        gatedService.saveValues({
          institutionId: 'institution-1',
          moduleKey: ModuleKey.PEOPLE,
          entityType: CustomFieldEntity.STUDENT,
          entityId: 'student-1',
          values: { premium_note: 'Should be rejected' },
        }),
      ).rejects.toThrow('Unknown custom field keys');
      expect(resolvePlanKeyForInstitution).toHaveBeenCalledWith(
        'institution-1',
      );
      expect(prismaMock.customFieldValue.upsert).not.toHaveBeenCalled();
    });

    it('never force-requires a plan-gated-out field on create', async () => {
      prismaMock.customFieldDefinition.findMany.mockResolvedValue([
        {
          id: 'gated-required',
          fieldKey: 'premium_required',
          label: 'Premium required',
          inputType: 'TEXT',
          isRequired: true,
          planKeys: ['pro'],
        },
      ]);

      // The institution is on "starter" — this required-but-gated-out field
      // must not block creation just because it's technically required.
      await expect(
        gatedService.saveValues({
          institutionId: 'institution-1',
          moduleKey: ModuleKey.PEOPLE,
          entityType: CustomFieldEntity.STUDENT,
          entityId: 'student-1',
          requireRequiredFields: true,
        }),
      ).resolves.toEqual({});
    });

    it('allows a submitted value once the institution’s plan includes it', async () => {
      resolvePlanKeyForInstitution.mockResolvedValue('pro');
      prismaMock.customFieldDefinition.findMany.mockResolvedValue([
        {
          id: 'gated',
          fieldKey: 'premium_note',
          label: 'Premium note',
          inputType: 'TEXT',
          isRequired: false,
          planKeys: ['pro', 'enterprise'],
        },
      ]);
      prismaMock.$transaction.mockResolvedValue(undefined);

      await expect(
        gatedService.saveValues({
          institutionId: 'institution-1',
          moduleKey: ModuleKey.PEOPLE,
          entityType: CustomFieldEntity.STUDENT,
          entityId: 'student-1',
          values: { premium_note: 'Allowed on pro' },
        }),
      ).resolves.toEqual({ premium_note: 'Allowed on pro' });
    });

    it('omits a plan-gated-out value from attachToItems even though it was saved while the plan still included it', async () => {
      resolvePlanKeyForInstitution.mockResolvedValue('starter');
      prismaMock.customFieldValue.findMany.mockResolvedValue([
        {
          entityId: 'student-1',
          institutionId: 'institution-1',
          value: 'Was allowed once',
          definition: { fieldKey: 'premium_note', planKeys: ['pro'] },
        },
        {
          entityId: 'student-1',
          institutionId: 'institution-1',
          value: 'A+',
          definition: { fieldKey: 'blood_group', planKeys: null },
        },
      ]);

      await expect(
        gatedService.attachToItems(
          [{ id: 'student-1', regNo: 'NEX-001' }],
          CustomFieldEntity.STUDENT,
        ),
      ).resolves.toEqual([
        {
          id: 'student-1',
          regNo: 'NEX-001',
          customFields: { blood_group: 'A+' },
        },
      ]);
    });
  });

  describe('visibilityRules gating (M4.5 / P1-2a follow-up)', () => {
    it('rejects a submitted value for a field not visible to the actor role, dropping it as an unknown key', async () => {
      prismaMock.customFieldDefinition.findMany.mockResolvedValue([
        {
          id: 'internal-note',
          fieldKey: 'internal_hr_note',
          label: 'Internal HR note',
          inputType: 'TEXT',
          isRequired: false,
          visibilityRules: { roles: [UserRole.STAFF, UserRole.ADMIN] },
        },
      ]);

      await expect(
        requestContext.runWith(
          {
            currentUser: {
              sub: 'g1',
              email: 'g@t.com',
              role: UserRole.GUARDIAN,
            },
          },
          () =>
            service.saveValues({
              institutionId: 'institution-1',
              moduleKey: ModuleKey.PEOPLE,
              entityType: CustomFieldEntity.STUDENT,
              entityId: 'student-1',
              values: { internal_hr_note: 'Should be rejected' },
            }),
        ),
      ).rejects.toThrow('Unknown custom field keys');
      expect(prismaMock.customFieldValue.upsert).not.toHaveBeenCalled();
    });

    it('never force-requires a role-invisible field on create', async () => {
      prismaMock.customFieldDefinition.findMany.mockResolvedValue([
        {
          id: 'internal-note',
          fieldKey: 'internal_hr_note',
          label: 'Internal HR note',
          inputType: 'TEXT',
          isRequired: true,
          visibilityRules: { roles: [UserRole.STAFF] },
        },
      ]);

      await expect(
        requestContext.runWith(
          {
            currentUser: {
              sub: 'g1',
              email: 'g@t.com',
              role: UserRole.GUARDIAN,
            },
          },
          () =>
            service.saveValues({
              institutionId: 'institution-1',
              moduleKey: ModuleKey.PEOPLE,
              entityType: CustomFieldEntity.STUDENT,
              entityId: 'student-1',
              requireRequiredFields: true,
            }),
        ),
      ).resolves.toEqual({});
    });

    it('allows a submitted value once the actor role is included in the allow-list', async () => {
      prismaMock.customFieldDefinition.findMany.mockResolvedValue([
        {
          id: 'internal-note',
          fieldKey: 'internal_hr_note',
          label: 'Internal HR note',
          inputType: 'TEXT',
          isRequired: false,
          visibilityRules: { roles: [UserRole.STAFF, UserRole.ADMIN] },
        },
      ]);
      prismaMock.$transaction.mockResolvedValue(undefined);

      await expect(
        requestContext.runWith(
          {
            currentUser: { sub: 's1', email: 's@t.com', role: UserRole.STAFF },
          },
          () =>
            service.saveValues({
              institutionId: 'institution-1',
              moduleKey: ModuleKey.PEOPLE,
              entityType: CustomFieldEntity.STUDENT,
              entityId: 'student-1',
              values: { internal_hr_note: 'Allowed for staff' },
            }),
        ),
      ).resolves.toEqual({ internal_hr_note: 'Allowed for staff' });
    });

    it('omits a role-invisible value from attachToItems even though a permitted role saved it', async () => {
      prismaMock.customFieldValue.findMany.mockResolvedValue([
        {
          entityId: 'student-1',
          institutionId: 'institution-1',
          value: 'Staff-only note',
          definition: {
            fieldKey: 'internal_hr_note',
            planKeys: null,
            visibilityRules: { roles: [UserRole.STAFF] },
          },
        },
        {
          entityId: 'student-1',
          institutionId: 'institution-1',
          value: 'A+',
          definition: {
            fieldKey: 'blood_group',
            planKeys: null,
            visibilityRules: null,
          },
        },
      ]);

      await expect(
        requestContext.runWith(
          {
            currentUser: {
              sub: 'g1',
              email: 'g@t.com',
              role: UserRole.GUARDIAN,
            },
          },
          () =>
            service.attachToItems(
              [{ id: 'student-1', regNo: 'NEX-001' }],
              CustomFieldEntity.STUDENT,
            ),
        ),
      ).resolves.toEqual([
        {
          id: 'student-1',
          regNo: 'NEX-001',
          customFields: { blood_group: 'A+' },
        },
      ]);
    });

    it('includes a role-gated value in attachToItems for a role in its allow-list', async () => {
      prismaMock.customFieldValue.findMany.mockResolvedValue([
        {
          entityId: 'student-1',
          institutionId: 'institution-1',
          value: 'Staff-only note',
          definition: {
            fieldKey: 'internal_hr_note',
            planKeys: null,
            visibilityRules: { roles: [UserRole.STAFF] },
          },
        },
      ]);

      await expect(
        requestContext.runWith(
          {
            currentUser: { sub: 's1', email: 's@t.com', role: UserRole.STAFF },
          },
          () =>
            service.attachToItems(
              [{ id: 'student-1', regNo: 'NEX-001' }],
              CustomFieldEntity.STUDENT,
            ),
        ),
      ).resolves.toEqual([
        {
          id: 'student-1',
          regNo: 'NEX-001',
          customFields: { internal_hr_note: 'Staff-only note' },
        },
      ]);
    });
  });

  describe('resolveInstitutionIdByStaffProfile', () => {
    it('resolves the institution via the staff profile campus', async () => {
      prismaMock.staffProfile.findUnique.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.resolveInstitutionIdByStaffProfile('staff-profile-1'),
      ).resolves.toBe('institution-1');
      expect(prismaMock.staffProfile.findUnique).toHaveBeenCalledWith({
        where: { id: 'staff-profile-1' },
        select: { campus: { select: { institutionId: true } } },
      });
    });

    it('throws NotFoundException when the staff profile has no resolvable institution', async () => {
      prismaMock.staffProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveInstitutionIdByStaffProfile('missing-staff-profile'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveInstitutionIdByCampus', () => {
    it('resolves the institution for a campus', async () => {
      prismaMock.campus.findUnique.mockResolvedValue({
        institutionId: 'institution-1',
      });

      await expect(
        service.resolveInstitutionIdByCampus('campus-1'),
      ).resolves.toBe('institution-1');
    });

    it('throws NotFoundException when the campus has no institution', async () => {
      prismaMock.campus.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveInstitutionIdByCampus('missing-campus'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveInstitutionIdByLevel', () => {
    it('resolves the institution via the level campus', async () => {
      prismaMock.level.findUnique.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.resolveInstitutionIdByLevel('level-1'),
      ).resolves.toBe('institution-1');
    });

    it('throws NotFoundException when the level has no resolvable institution', async () => {
      prismaMock.level.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveInstitutionIdByLevel('missing-level'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveInstitutionIdByClass', () => {
    it('resolves the institution via level -> campus', async () => {
      prismaMock.academicClass.findUnique.mockResolvedValue({
        level: { campus: { institutionId: 'institution-1' } },
      });

      await expect(
        service.resolveInstitutionIdByClass('class-1'),
      ).resolves.toBe('institution-1');
    });

    it('throws NotFoundException when the class has no resolvable institution', async () => {
      prismaMock.academicClass.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveInstitutionIdByClass('missing-class'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveInstitutionIdBySection', () => {
    it('resolves the institution via class -> level -> campus', async () => {
      prismaMock.section.findUnique.mockResolvedValue({
        class: { level: { campus: { institutionId: 'institution-1' } } },
      });

      await expect(
        service.resolveInstitutionIdBySection('section-1'),
      ).resolves.toBe('institution-1');
    });

    it('throws NotFoundException when the section has no resolvable institution', async () => {
      prismaMock.section.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveInstitutionIdBySection('missing-section'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveInstitutionIdBySubject', () => {
    it('resolves the institution via class -> level -> campus', async () => {
      prismaMock.subject.findUnique.mockResolvedValue({
        class: { level: { campus: { institutionId: 'institution-1' } } },
      });

      await expect(
        service.resolveInstitutionIdBySubject('subject-1'),
      ).resolves.toBe('institution-1');
    });

    it('throws NotFoundException when the subject has no resolvable institution', async () => {
      prismaMock.subject.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveInstitutionIdBySubject('missing-subject'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveInstitutionIdByStudent', () => {
    it('resolves the institution via the student campus', async () => {
      prismaMock.student.findUnique.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.resolveInstitutionIdByStudent('student-1'),
      ).resolves.toBe('institution-1');
    });

    it('throws NotFoundException when the student has no resolvable institution', async () => {
      prismaMock.student.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveInstitutionIdByStudent('missing-student'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveInstitutionIdByGuardian', () => {
    it('resolves the institution via the guardian campus', async () => {
      prismaMock.guardian.findUnique.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.resolveInstitutionIdByGuardian('guardian-1'),
      ).resolves.toBe('institution-1');
    });

    it('throws NotFoundException when the guardian has no resolvable institution', async () => {
      prismaMock.guardian.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveInstitutionIdByGuardian('missing-guardian'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveInstitutionIdBySalary', () => {
    it('resolves the institution via the salary campus', async () => {
      prismaMock.staffSalary.findUnique.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.resolveInstitutionIdBySalary('salary-1'),
      ).resolves.toBe('institution-1');
    });

    it('throws NotFoundException when the salary record has no resolvable institution', async () => {
      prismaMock.staffSalary.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveInstitutionIdBySalary('missing-salary'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveInstitutionIdByFeeStructure', () => {
    it('resolves the institution via the fee structure campus', async () => {
      prismaMock.feeStructure.findUnique.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.resolveInstitutionIdByFeeStructure('fee-structure-1'),
      ).resolves.toBe('institution-1');
    });

    it('throws NotFoundException when the fee structure has no resolvable institution', async () => {
      prismaMock.feeStructure.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveInstitutionIdByFeeStructure('missing-fee-structure'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveInstitutionIdByContact', () => {
    it('routes "student" to resolveInstitutionIdByStudent', async () => {
      prismaMock.student.findUnique.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.resolveInstitutionIdByContact('student', 'student-1'),
      ).resolves.toBe('institution-1');
    });

    it('routes "guardian" to resolveInstitutionIdByGuardian', async () => {
      prismaMock.guardian.findUnique.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.resolveInstitutionIdByContact('guardian', 'guardian-1'),
      ).resolves.toBe('institution-1');
    });

    it('routes "staff" to resolveInstitutionIdByStaffProfile', async () => {
      prismaMock.staffProfile.findUnique.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.resolveInstitutionIdByContact('staff', 'staff-profile-1'),
      ).resolves.toBe('institution-1');
    });

    it('rejects an unsupported person type', async () => {
      await expect(
        service.resolveInstitutionIdByContact('vendor', 'vendor-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('attachToItem', () => {
    it('returns null when the item is null', async () => {
      await expect(
        service.attachToItem(null, CustomFieldEntity.STUDENT),
      ).resolves.toBeNull();
      expect(prismaMock.customFieldValue.findMany).not.toHaveBeenCalled();
    });

    it('attaches custom fields to a single item', async () => {
      prismaMock.customFieldValue.findMany.mockResolvedValue([
        {
          entityId: 'student-1',
          value: 'A+',
          definition: { fieldKey: 'blood_group' },
        },
      ]);

      await expect(
        service.attachToItem(
          { id: 'student-1', regNo: 'NEX-001' },
          CustomFieldEntity.STUDENT,
        ),
      ).resolves.toEqual({
        id: 'student-1',
        regNo: 'NEX-001',
        customFields: { blood_group: 'A+' },
      });
    });
  });

  describe('attachToItems', () => {
    it('returns an empty array without querying when there are no items', async () => {
      await expect(
        service.attachToItems([], CustomFieldEntity.STUDENT),
      ).resolves.toEqual([]);
      expect(prismaMock.customFieldValue.findMany).not.toHaveBeenCalled();
    });
  });
});
