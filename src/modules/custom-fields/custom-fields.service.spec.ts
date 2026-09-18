import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CustomFieldEntity } from '../../common/constants/custom-field-entities.constants';
import { CustomFieldInputType, ModuleKey, UserRole } from '../../prisma/client';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomFieldsService } from './custom-fields.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';

describe('CustomFieldsService', () => {
  let service: CustomFieldsService;
  const canMock = jest.fn();

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
      update: jest.fn(),
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
    notice: {
      findUnique: jest.fn(),
    },
    periodSlot: {
      findUnique: jest.fn(),
    },
    attendance: {
      findUnique: jest.fn(),
    },
    user: {
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
    guardian: {
      findUnique: jest.fn(),
    },
    staffProfile: {
      findUnique: jest.fn(),
    },
    staffSalary: {
      findUnique: jest.fn(),
    },
    salaryDeductionRule: {
      findUnique: jest.fn(),
    },
    salaryAdjustment: {
      findUnique: jest.fn(),
    },
    salaryPayment: {
      findUnique: jest.fn(),
    },
    bankAccount: {
      findUnique: jest.fn(),
    },
    feeStructure: {
      findUnique: jest.fn(),
    },
    studentDiscount: {
      findUnique: jest.fn(),
    },
    studentFineRule: {
      findUnique: jest.fn(),
    },
    studentFine: {
      findUnique: jest.fn(),
    },
    feeVoucher: {
      findUnique: jest.fn(),
    },
    feePayment: {
      findUnique: jest.fn(),
    },
    studentHistory: {
      findUnique: jest.fn(),
    },
    teacherSubject: {
      findUnique: jest.fn(),
    },
    contact: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([]);
    canMock.mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomFieldsService,
        { provide: UserPermissionsService, useValue: { can: canMock } },
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
            assertStaffProfileAccess: jest.fn(),
          },
        },
        {
          provide: ModuleAccessService,
          useValue: {
            assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
            resolvePlanKeyForInstitution: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<CustomFieldsService>(CustomFieldsService);
  });

  it.each([
    {
      isActive: true,
      inputType: CustomFieldInputType.NUMBER,
      value: 'invalid',
    },
    { isActive: false, inputType: CustomFieldInputType.TEXT, value: 'text' },
  ])(
    'rejects invalid or inactive standalone values before writing: %j',
    async ({ isActive, inputType, value }) => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-1',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT,
        fieldKey: 'test',
        label: 'Test',
        isRequired: false,
        isActive,
        inputType,
      });
      prismaMock.student.findUnique.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });
      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-1',
          entityId: 'student-1',
          value,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.customFieldValue.upsert).not.toHaveBeenCalled();
    },
  );

  it('blocks a canonical definition that duplicates a legacy entity name', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    prismaMock.customFieldDefinition.findMany.mockResolvedValue([
      { id: 'legacy' },
    ]);
    await expect(
      service.createDefinition(adminUser, {
        moduleKey: ModuleKey.PEOPLE,
        entityType: 'STUDENT',
        fieldKey: 'name',
        label: 'Name',
        inputType: CustomFieldInputType.TEXT,
      }),
    ).rejects.toThrow('already exists');
    expect(prismaMock.customFieldDefinition.create).not.toHaveBeenCalled();
    expect(prismaMock.customFieldDefinition.findMany.mock.calls).toMatchObject([
      [
        {
          where: {
            institutionId: 'institution-1',
            entityType: { equals: 'student', mode: 'insensitive' },
            fieldKey: 'name',
            deletedAt: null,
          },
        },
      ],
    ]);
  });

  it('loads form definitions using resource permissions instead of definition administration', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    await service.listFormDefinitions(adminUser, {
      entityType: 'STUDENT',
      action: 'create',
    });
    expect(canMock).toHaveBeenCalledWith(adminUser, 'students', 'create');
    expect(prismaMock.customFieldDefinition.findMany.mock.calls).toMatchObject([
      [
        {
          where: {
            institutionId: 'institution-1',
            moduleKey: ModuleKey.PEOPLE,
            isActive: true,
            entityType: { equals: 'student', mode: 'insensitive' },
          },
        },
      ],
    ]);
  });

  it('rejects form definition access without the requested record permission', async () => {
    canMock.mockResolvedValue(false);
    await expect(
      service.listFormDefinitions(adminUser, {
        entityType: 'student',
        action: 'update',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.customFieldDefinition.findMany).not.toHaveBeenCalled();
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

  it('preserves existing choices when editing only a definition label', async () => {
    prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
      id: 'definition-1',
      institutionId: 'institution-1',
      moduleKey: ModuleKey.PEOPLE,
      inputType: CustomFieldInputType.SELECT,
      options: [{ label: 'One', value: 'one' }],
    });
    await expect(
      service.updateDefinition(adminUser, 'definition-1', {
        label: 'New label',
      }),
    ).resolves.toBeDefined();
    expect(prismaMock.customFieldDefinition.update.mock.calls).toMatchObject([
      [{ data: { label: 'New label', options: undefined } }],
    ]);
  });

  it('rejects duplicate choice values', async () => {
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });
    await expect(
      service.createDefinition(adminUser, {
        moduleKey: ModuleKey.PEOPLE,
        entityType: 'student',
        fieldKey: 'choice',
        label: 'Choice',
        inputType: CustomFieldInputType.SELECT,
        options: [
          { label: 'One', value: 'same' },
          { label: 'Two', value: 'same' },
        ],
      }),
    ).rejects.toThrow('must be unique');
    expect(prismaMock.customFieldDefinition.create).not.toHaveBeenCalled();
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

  describe('M4.5 / P1-2a follow-up — visibilityRules enforcement', () => {
    const guardianUser: CurrentUser = {
      sub: 'guardian-1',
      email: 'guardian@nexus.test',
      role: UserRole.GUARDIAN,
      institutionId: 'institution-1',
    };
    const staffUser: CurrentUser = {
      sub: 'staff-1',
      email: 'staff@nexus.test',
      role: UserRole.STAFF,
      institutionId: 'institution-1',
    };

    it('rejects a value write for a field not visible to the caller role', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-1',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT,
        fieldKey: 'internal_hr_note',
        label: 'Internal HR note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
        visibilityRules: { roles: [UserRole.STAFF, UserRole.ADMIN] },
      });
      prismaMock.student.findUnique.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.upsertValue(guardianUser, {
          definitionId: 'definition-1',
          entityId: 'student-1',
          value: 'Should be rejected',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.customFieldValue.upsert).not.toHaveBeenCalled();
    });

    it('allows a value write once the caller role is included in the allow-list', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-1',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT,
        fieldKey: 'internal_hr_note',
        label: 'Internal HR note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
        visibilityRules: { roles: [UserRole.STAFF, UserRole.ADMIN] },
      });
      prismaMock.student.findUnique.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.customFieldValue.upsert.mockResolvedValue({
        id: 'value-1',
        entityId: 'student-1',
        definition: { id: 'definition-1' },
      });

      await expect(
        service.upsertValue(staffUser, {
          definitionId: 'definition-1',
          entityId: 'student-1',
          value: 'Allowed for staff',
        }),
      ).resolves.toMatchObject({
        message: 'Custom field value saved successfully',
      });
    });

    it('omits a role-invisible value from listValues', async () => {
      prismaMock.customFieldValue.findMany.mockResolvedValue([
        {
          institutionId: 'institution-1',
          entityId: 'student-1',
          value: 'Staff-only note',
          definition: {
            fieldKey: 'internal_hr_note',
            planKeys: null,
            visibilityRules: { roles: [UserRole.STAFF] },
          },
        },
        {
          institutionId: 'institution-1',
          entityId: 'student-1',
          value: 'A+',
          definition: {
            fieldKey: 'blood_group',
            planKeys: null,
            visibilityRules: null,
          },
        },
      ]);

      await expect(
        service.listValues(guardianUser, { entityId: 'student-1' }),
      ).resolves.toMatchObject({
        data: [{ value: 'A+' }],
      });
    });

    it('includes a role-gated value in listValues for a role in its allow-list', async () => {
      prismaMock.customFieldValue.findMany.mockResolvedValue([
        {
          institutionId: 'institution-1',
          entityId: 'student-1',
          value: 'Staff-only note',
          definition: {
            fieldKey: 'internal_hr_note',
            planKeys: null,
            visibilityRules: { roles: [UserRole.STAFF] },
          },
        },
      ]);

      await expect(
        service.listValues(staffUser, { entityId: 'student-1' }),
      ).resolves.toMatchObject({
        data: [{ value: 'Staff-only note' }],
      });
    });

    it('excludes a role-invisible definition from listFormDefinitions', async () => {
      prismaMock.institution.findUnique.mockResolvedValue({
        id: 'institution-1',
      });
      prismaMock.customFieldDefinition.findMany.mockResolvedValue([
        {
          id: 'definition-1',
          fieldKey: 'internal_hr_note',
          planKeys: null,
          visibilityRules: { roles: [UserRole.STAFF] },
        },
        {
          id: 'definition-2',
          fieldKey: 'blood_group',
          planKeys: null,
          visibilityRules: null,
        },
      ]);

      await expect(
        service.listFormDefinitions(guardianUser, {
          entityType: 'student',
          action: 'read',
        }),
      ).resolves.toMatchObject({
        data: [{ fieldKey: 'blood_group' }],
      });
    });
  });

  describe('M4.5 shared blocker #3 — plan gating on the standalone value endpoint', () => {
    it('rejects a value write for a field the institution’s plan does not include', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-1',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT,
        fieldKey: 'premium_note',
        label: 'Premium note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
        planKeys: ['pro', 'enterprise'],
      });
      prismaMock.student.findUnique.mockResolvedValue({
        campus: { institutionId: 'institution-1' },
      });
      // Default mock resolves null — no resolvable plan, so an explicitly
      // gated field must be rejected rather than silently allowed.

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-1',
          entityId: 'student-1',
          value: 'Should be rejected',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.customFieldValue.upsert).not.toHaveBeenCalled();
    });
  });

  describe('M4.5 / P1-2a — Notice/PeriodSlot/Attendance/User access scoping', () => {
    it('resolves NOTICE access through its campusId when the notice is campus-scoped', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-notice',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.NOTICES,
        entityType: CustomFieldEntity.NOTICE,
        fieldKey: 'audience_note',
        label: 'Audience note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.notice.findUnique.mockResolvedValue({
        institutionId: 'institution-1',
        campusId: 'campus-1',
      });
      prismaMock.customFieldValue.upsert.mockResolvedValue({
        id: 'value-1',
        entityId: 'notice-1',
        definition: { id: 'definition-notice' },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-notice',
          entityId: 'notice-1',
          value: 'note',
        }),
      ).resolves.toMatchObject({
        message: 'Custom field value saved successfully',
      });
    });

    it('resolves NOTICE access without a campus check when the notice is institution-wide (campusId null)', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-notice',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.NOTICES,
        entityType: CustomFieldEntity.NOTICE,
        fieldKey: 'audience_note',
        label: 'Audience note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.notice.findUnique.mockResolvedValue({
        institutionId: 'institution-1',
        campusId: null,
      });
      prismaMock.customFieldValue.upsert.mockResolvedValue({
        id: 'value-1',
        entityId: 'notice-1',
        definition: { id: 'definition-notice' },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-notice',
          entityId: 'notice-1',
          value: 'note',
        }),
      ).resolves.toMatchObject({
        message: 'Custom field value saved successfully',
      });
    });

    it('blocks NOTICE access outside the actor institution', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-notice',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.NOTICES,
        entityType: CustomFieldEntity.NOTICE,
        fieldKey: 'audience_note',
        label: 'Audience note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.notice.findUnique.mockResolvedValue({
        institutionId: 'institution-2',
        campusId: null,
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-notice',
          entityId: 'notice-1',
          value: 'note',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolves PERIOD_SLOT access through its campusId', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-slot',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.TIMETABLE,
        entityType: CustomFieldEntity.PERIOD_SLOT,
        fieldKey: 'room',
        label: 'Room',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.periodSlot.findUnique.mockResolvedValue({
        campusId: 'campus-1',
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.customFieldValue.upsert.mockResolvedValue({
        id: 'value-1',
        entityId: 'slot-1',
        definition: { id: 'definition-slot' },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-slot',
          entityId: 'slot-1',
          value: 'B-12',
        }),
      ).resolves.toMatchObject({
        message: 'Custom field value saved successfully',
      });
    });

    it('resolves ATTENDANCE access through its campusId', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-attendance',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.ATTENDANCE,
        entityType: CustomFieldEntity.ATTENDANCE,
        fieldKey: 'device',
        label: 'Device',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.attendance.findUnique.mockResolvedValue({
        campusId: 'campus-1',
        campus: { institutionId: 'institution-1' },
      });
      prismaMock.customFieldValue.upsert.mockResolvedValue({
        id: 'value-1',
        entityId: 'attendance-1',
        definition: { id: 'definition-attendance' },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-attendance',
          entityId: 'attendance-1',
          value: 'kiosk-1',
        }),
      ).resolves.toMatchObject({
        message: 'Custom field value saved successfully',
      });
    });

    it('resolves USER access through institutionId directly, with no campus-level check', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-user',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.USER,
        fieldKey: 'employee_id',
        label: 'Employee ID',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.user.findUnique.mockResolvedValue({
        institutionId: 'institution-1',
      });
      prismaMock.customFieldValue.upsert.mockResolvedValue({
        id: 'value-1',
        entityId: 'user-1',
        definition: { id: 'definition-user' },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-user',
          entityId: 'user-1',
          value: 'EMP-042',
        }),
      ).resolves.toMatchObject({
        message: 'Custom field value saved successfully',
      });
    });

    it('blocks USER access outside the actor institution', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-user',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.USER,
        fieldKey: 'employee_id',
        label: 'Employee ID',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.user.findUnique.mockResolvedValue({
        institutionId: 'institution-2',
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-user',
          entityId: 'user-1',
          value: 'EMP-042',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertEntityAccess — campus-scoped entity types', () => {
    // Every one of these entity types shares the exact same
    // "select campusId + campus.institutionId, then delegate to
    // assertCampusScopedEntityAccess" shape — table-driven to cover each
    // switch case in one pass instead of repeating the same test 15 times.
    type FindUniqueDelegate = { findUnique: jest.Mock };
    const delegates = prismaMock as unknown as Record<
      string,
      FindUniqueDelegate
    >;
    const cases: Array<{
      entityType: string;
      delegate: string;
    }> = [
      { entityType: CustomFieldEntity.LEVEL, delegate: 'level' },
      { entityType: CustomFieldEntity.GUARDIAN, delegate: 'guardian' },
      {
        entityType: CustomFieldEntity.STAFF_PROFILE,
        delegate: 'staffProfile',
      },
      { entityType: CustomFieldEntity.STAFF_SALARY, delegate: 'staffSalary' },
      {
        entityType: CustomFieldEntity.SALARY_DEDUCTION_RULE,
        delegate: 'salaryDeductionRule',
      },
      {
        entityType: CustomFieldEntity.SALARY_ADJUSTMENT,
        delegate: 'salaryAdjustment',
      },
      {
        entityType: CustomFieldEntity.SALARY_PAYMENT,
        delegate: 'salaryPayment',
      },
      { entityType: CustomFieldEntity.BANK_ACCOUNT, delegate: 'bankAccount' },
      {
        entityType: CustomFieldEntity.FEE_STRUCTURE,
        delegate: 'feeStructure',
      },
      {
        entityType: CustomFieldEntity.STUDENT_FINE_RULE,
        delegate: 'studentFineRule',
      },
      {
        entityType: CustomFieldEntity.TEACHER_SUBJECT,
        delegate: 'teacherSubject',
      },
      { entityType: CustomFieldEntity.PERIOD_SLOT, delegate: 'periodSlot' },
      { entityType: CustomFieldEntity.ATTENDANCE, delegate: 'attendance' },
    ];

    it.each(cases)(
      'resolves $entityType access via campus scoping and rejects entities outside the institution',
      async ({ entityType, delegate }) => {
        const definitionId = `definition-${entityType}`;
        prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
          id: definitionId,
          institutionId: 'institution-1',
          moduleKey: ModuleKey.PEOPLE,
          entityType,
          fieldKey: 'note',
          label: 'Note',
          inputType: CustomFieldInputType.TEXT,
          isRequired: false,
          isActive: true,
          sortOrder: 0,
        });

        delegates[delegate].findUnique.mockResolvedValueOnce(null);

        await expect(
          service.upsertValue(adminUser, {
            definitionId,
            entityId: 'entity-1',
            value: 'text',
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);

        delegates[delegate].findUnique.mockResolvedValueOnce({
          campusId: 'campus-1',
          campus: { institutionId: 'institution-1' },
        });

        await expect(
          service.upsertValue(adminUser, {
            definitionId,
            entityId: 'entity-1',
            value: 'text',
          }),
        ).resolves.toBeDefined();
      },
    );

    // CLASS/SECTION/SUBJECT reshape a nested level/class lookup into the
    // same { campusId, campus } shape before delegating — worth a dedicated
    // check that the reshape itself (not just the final campus check) works.
    it('reshapes the CLASS entity nested level lookup into campusId/campus', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-class',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.ACADEMICS,
        entityType: CustomFieldEntity.CLASS,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.academicClass.findUnique.mockResolvedValue({
        level: {
          campusId: 'campus-1',
          campus: { institutionId: 'institution-1' },
        },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-class',
          entityId: 'class-1',
          value: 'text',
        }),
      ).resolves.toBeDefined();
    });

    it('reshapes the SECTION entity nested class/level lookup into campusId/campus', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-section',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.ACADEMICS,
        entityType: CustomFieldEntity.SECTION,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.section.findUnique.mockResolvedValue({
        class: {
          level: {
            campusId: 'campus-1',
            campus: { institutionId: 'institution-1' },
          },
        },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-section',
          entityId: 'section-1',
          value: 'text',
        }),
      ).resolves.toBeDefined();
    });

    it('reshapes the SUBJECT entity nested class/level lookup into campusId/campus', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-subject',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.ACADEMICS,
        entityType: CustomFieldEntity.SUBJECT,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.subject.findUnique.mockResolvedValue({
        class: {
          level: {
            campusId: 'campus-1',
            campus: { institutionId: 'institution-1' },
          },
        },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-subject',
          entityId: 'subject-1',
          value: 'text',
        }),
      ).resolves.toBeDefined();
    });

    it('rejects a CLASS/SECTION/SUBJECT lookup that resolves to no record', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-class-missing',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.ACADEMICS,
        entityType: CustomFieldEntity.CLASS,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.academicClass.findUnique.mockResolvedValue(null);

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-class-missing',
          entityId: 'missing-class',
          value: 'text',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertEntityAccess — CAMPUS', () => {
    it('resolves campus access directly and rejects a campus outside the institution', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-campus',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.ACADEMICS,
        entityType: CustomFieldEntity.CAMPUS,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.campus.findUnique.mockResolvedValueOnce({
        institutionId: 'institution-2',
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-campus',
          entityId: 'campus-1',
          value: 'text',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      prismaMock.campus.findUnique.mockResolvedValueOnce({
        institutionId: 'institution-1',
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-campus',
          entityId: 'campus-1',
          value: 'text',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('assertEntityAccess — STUDENT_DISCOUNT/STUDENT_FINE/FEE_VOUCHER/FEE_PAYMENT/STUDENT_HISTORY', () => {
    it('resolves STUDENT_DISCOUNT access through the owning student', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-discount',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.FINANCE,
        entityType: CustomFieldEntity.STUDENT_DISCOUNT,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.studentDiscount.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-discount',
          entityId: 'discount-1',
          value: 'text',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      prismaMock.studentDiscount.findUnique.mockResolvedValueOnce({
        studentId: 'student-1',
        student: { campus: { institutionId: 'institution-1' } },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-discount',
          entityId: 'discount-1',
          value: 'text',
        }),
      ).resolves.toBeDefined();
    });

    it('resolves STUDENT_FINE access through campus and student checks', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-fine',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.FINANCE,
        entityType: CustomFieldEntity.STUDENT_FINE,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.studentFine.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-fine',
          entityId: 'fine-1',
          value: 'text',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      prismaMock.studentFine.findUnique.mockResolvedValueOnce({
        campusId: 'campus-1',
        studentId: 'student-1',
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-fine',
          entityId: 'fine-1',
          value: 'text',
        }),
      ).resolves.toBeDefined();
    });

    it('resolves FEE_VOUCHER access through the owning student', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-voucher',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.FINANCE,
        entityType: CustomFieldEntity.FEE_VOUCHER,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.feeVoucher.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-voucher',
          entityId: 'voucher-1',
          value: 'text',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      prismaMock.feeVoucher.findUnique.mockResolvedValueOnce({
        studentId: 'student-1',
        student: {
          campusId: 'campus-1',
          campus: { institutionId: 'institution-1' },
        },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-voucher',
          entityId: 'voucher-1',
          value: 'text',
        }),
      ).resolves.toBeDefined();
    });

    it('resolves FEE_PAYMENT access through the voucher -> student chain', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-payment',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.FINANCE,
        entityType: CustomFieldEntity.FEE_PAYMENT,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.feePayment.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-payment',
          entityId: 'payment-1',
          value: 'text',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      prismaMock.feePayment.findUnique.mockResolvedValueOnce({
        voucher: {
          studentId: 'student-1',
          student: {
            campusId: 'campus-1',
            campus: { institutionId: 'institution-1' },
          },
        },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-payment',
          entityId: 'payment-1',
          value: 'text',
        }),
      ).resolves.toBeDefined();
    });

    it('resolves STUDENT_HISTORY access through the owning student', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-history',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.STUDENT_HISTORY,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.studentHistory.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-history',
          entityId: 'history-1',
          value: 'text',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      prismaMock.studentHistory.findUnique.mockResolvedValueOnce({
        studentId: 'student-1',
        student: { campus: { institutionId: 'institution-1' } },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-history',
          entityId: 'history-1',
          value: 'text',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('assertEntityAccess — CONTACT', () => {
    it('rejects a contact with no resolvable owner', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-contact',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.CONTACT,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.contact.findUnique.mockResolvedValue({
        studentId: null,
        guardianId: null,
        staffProfileId: null,
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-contact',
          entityId: 'contact-1',
          value: 'text',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('routes a student-owned contact through STUDENT entity access', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-contact',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.CONTACT,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.contact.findUnique.mockResolvedValue({
        studentId: 'student-1',
        guardianId: null,
        staffProfileId: null,
      });
      prismaMock.student.findUnique.mockResolvedValue({
        campusId: 'campus-1',
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-contact',
          entityId: 'contact-1',
          value: 'text',
        }),
      ).resolves.toBeDefined();
    });

    it('routes a guardian-owned contact through GUARDIAN entity access', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-contact',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.CONTACT,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.contact.findUnique.mockResolvedValue({
        studentId: null,
        guardianId: 'guardian-1',
        staffProfileId: null,
      });
      prismaMock.guardian.findUnique.mockResolvedValue({
        campusId: 'campus-1',
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-contact',
          entityId: 'contact-1',
          value: 'text',
        }),
      ).resolves.toBeDefined();
    });

    it('routes a staff-owned contact through STAFF_PROFILE entity access', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-contact',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: CustomFieldEntity.CONTACT,
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });
      prismaMock.contact.findUnique.mockResolvedValue({
        studentId: null,
        guardianId: null,
        staffProfileId: 'staff-profile-1',
      });
      prismaMock.staffProfile.findUnique.mockResolvedValue({
        campusId: 'campus-1',
        campus: { institutionId: 'institution-1' },
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-contact',
          entityId: 'contact-1',
          value: 'text',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('assertEntityAccess — default (unconfigured entity type)', () => {
    it('rejects an entity type with no configured access check', async () => {
      prismaMock.customFieldDefinition.findUnique.mockResolvedValue({
        id: 'definition-unknown',
        institutionId: 'institution-1',
        moduleKey: ModuleKey.PEOPLE,
        entityType: 'student_guardian',
        fieldKey: 'note',
        label: 'Note',
        inputType: CustomFieldInputType.TEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
      });

      await expect(
        service.upsertValue(adminUser, {
          definitionId: 'definition-unknown',
          entityId: 'entity-1',
          value: 'text',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
