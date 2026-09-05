import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Gender } from '../../common/enums/domain.enums';
import { ModuleKey, UserRole } from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PeopleService } from './people.service';

describe('PeopleService', () => {
  let service: PeopleService;

  const currentUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'institution-1',
  };

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    student: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    guardian: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    staffProfile: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    teacherSubject: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    section: {
      findUnique: jest.fn(),
    },
    contact: {
      create: jest.fn(),
    },
    userCampus: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const campusAccessServiceMock = {
    assertCampusAccess: jest.fn(),
    assertClassAccess: jest.fn(),
    assertSectionAccess: jest.fn(),
    assertStudentAccess: jest.fn(),
    assertGuardianAccess: jest.fn(),
    assertStaffProfileAccess: jest.fn(),
    assertSubjectAccess: jest.fn(),
    getScopedCampusIds: jest.fn(),
  };

  const entityCustomFieldsServiceMock = {
    resolveInstitutionIdByCampus: jest.fn(),
    resolveInstitutionIdByStudent: jest.fn(),
    resolveInstitutionIdByGuardian: jest.fn(),
    resolveInstitutionIdByStaffProfile: jest.fn(),
    resolveInstitutionIdByContact: jest.fn(),
    saveValues: jest.fn(),
    attachToItem: jest.fn(),
    attachToItems: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PeopleService,
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

    service = moduleRef.get<PeopleService>(PeopleService);
  });

  it('rejects creating a student when the class belongs to a different campus', async () => {
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-2');
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      institutionId: 'institution-1',
      role: UserRole.STUDENT,
    });
    entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
      'institution-1',
    );

    await expect(
      service.createStudent(currentUser, {
        userId: 'user-1',
        regNo: 'NEX-001',
        dob: '2020-01-01',
        gender: Gender.MALE,
        classId: 'class-1',
        campusId: 'campus-1',
        admissionDate: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes student listing to accessible campuses for non-superadmins', async () => {
    campusAccessServiceMock.getScopedCampusIds.mockResolvedValue(['campus-1']);
    prismaMock.student.findMany.mockResolvedValue([
      { id: 'student-1', campusId: 'campus-1', regNo: 'NEX-001' },
    ]);
    entityCustomFieldsServiceMock.attachToItems.mockResolvedValue([
      {
        id: 'student-1',
        campusId: 'campus-1',
        regNo: 'NEX-001',
        customFields: {},
      },
    ]);

    const result = await service.listStudents(currentUser);

    expect(prismaMock.student.findMany).toHaveBeenCalledWith({
      where: { campusId: { in: ['campus-1'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        guardians: {
          where: { deletedAt: null },
          select: { id: true, guardianId: true },
        },
      },
    });
    expect(result).toMatchObject({
      message: 'Students retrieved successfully',
      data: [{ id: 'student-1', campusId: 'campus-1' }],
    });
  });

  it('retrieves a student with attached custom fields', async () => {
    campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
    prismaMock.student.findUnique.mockResolvedValue({
      id: 'student-1',
      campusId: 'campus-1',
      regNo: 'NEX-001',
    });
    entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
      id: 'student-1',
      campusId: 'campus-1',
      regNo: 'NEX-001',
      customFields: { bloodGroup: 'A+' },
    });

    const result = await service.getStudent(currentUser, 'student-1');

    expect(result).toMatchObject({
      message: 'Student retrieved successfully',
      data: {
        id: 'student-1',
        customFields: { bloodGroup: 'A+' },
      },
    });
  });

  it('updates a student and persists custom fields for the resolved campus institution', async () => {
    campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertSectionAccess.mockResolvedValue('campus-1');
    prismaMock.student.findUnique.mockResolvedValue({
      id: 'student-1',
      userId: 'user-1',
      campusId: 'campus-1',
      classId: 'class-1',
      sectionId: 'section-1',
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      institutionId: 'institution-1',
      role: UserRole.STUDENT,
    });
    prismaMock.student.update.mockResolvedValue({
      id: 'student-1',
      userId: 'user-1',
      campusId: 'campus-1',
      regNo: 'NEX-009',
    });
    entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
      'institution-1',
    );
    entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
      id: 'student-1',
      regNo: 'NEX-009',
      customFields: { transport: 'yes' },
    });

    const result = await service.updateStudent(currentUser, 'student-1', {
      regNo: 'NEX-009',
      classId: 'class-1',
      sectionId: 'section-1',
      customFields: { transport: 'yes' },
    });

    expect(prismaMock.student.update).toHaveBeenCalledWith({
      where: { id: 'student-1' },
      data: {
        regNo: 'NEX-009',
        classId: 'class-1',
        sectionId: 'section-1',
      },
    });
    expect(entityCustomFieldsServiceMock.saveValues).toHaveBeenCalledWith({
      institutionId: 'institution-1',
      moduleKey: ModuleKey.PEOPLE,
      entityType: 'student',
      entityId: 'student-1',
      values: { transport: 'yes' },
    });
    expect(result).toMatchObject({
      message: 'Student updated successfully',
      data: {
        id: 'student-1',
        customFields: { transport: 'yes' },
      },
    });
  });

  it('creates a contact using FK-backed owner fields while preserving the API contract', async () => {
    campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
    prismaMock.contact.create.mockResolvedValue({
      id: 'contact-1',
      studentId: 'student-1',
      guardianId: null,
      staffProfileId: null,
      personType: 'STUDENT',
      phone1: '03001234567',
    });
    entityCustomFieldsServiceMock.resolveInstitutionIdByContact.mockResolvedValue(
      'institution-1',
    );
    entityCustomFieldsServiceMock.attachToItem.mockImplementation(
      (item: Record<string, unknown>) => ({
        ...item,
        customFields: {},
      }),
    );

    const result = await service.createContact(currentUser, {
      personId: 'student-1',
      personType: 'student',
      phone1: '03001234567',
    });

    expect(prismaMock.contact.create).toHaveBeenCalledWith({
      data: {
        personType: 'STUDENT',
        studentId: 'student-1',
        phone1: '03001234567',
      },
    });
    expect(result).toMatchObject({
      message: 'Contact created successfully',
      data: {
        id: 'contact-1',
        personId: 'student-1',
        personType: 'STUDENT',
      },
    });
  });

  it('blocks duplicate teacher subject assignments for the same section mapping', async () => {
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertStaffProfileAccess.mockResolvedValue(
      'campus-1',
    );
    campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertSubjectAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertSectionAccess.mockResolvedValue('campus-1');
    prismaMock.section.findUnique.mockResolvedValue({ classId: 'class-1' });
    prismaMock.teacherSubject.findFirst.mockResolvedValue({
      id: 'assignment-1',
    });

    await expect(
      service.assignTeacherSubject(currentUser, {
        staffProfileId: 'staff-profile-1',
        classId: 'class-1',
        subjectId: 'subject-1',
        sectionId: 'section-1',
        campusId: 'campus-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects assignment when the section belongs to a different class', async () => {
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertStaffProfileAccess.mockResolvedValue(
      'campus-1',
    );
    campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertSubjectAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertSectionAccess.mockResolvedValue('campus-1');
    prismaMock.section.findUnique.mockResolvedValue({ classId: 'class-2' });

    await expect(
      service.assignTeacherSubject(currentUser, {
        staffProfileId: 'staff-profile-1',
        classId: 'class-1',
        subjectId: 'subject-1',
        sectionId: 'section-9',
        campusId: 'campus-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('createStaffProfile', () => {
    const baseDto = {
      userId: 'user-1',
      employmentType: 'TEACHING' as never,
      designation: 'Teacher',
      gender: Gender.MALE,
      campusId: 'campus-1',
      joiningDate: '2026-01-05',
    };

    it('creates a new staff profile when no soft-deleted row exists for the user', async () => {
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        institutionId: 'institution-1',
        role: UserRole.STAFF,
      });
      prismaMock.staffProfile.findFirst.mockResolvedValue(null);
      prismaMock.staffProfile.create.mockResolvedValue({
        id: 'staff-profile-1',
        userId: 'user-1',
        campusId: 'campus-1',
      });
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        (item: Record<string, unknown>) => ({ ...item, customFields: {} }),
      );

      await service.createStaffProfile(currentUser, baseDto);

      expect(prismaMock.staffProfile.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          employmentType: 'TEACHING',
          designation: 'Teacher',
          gender: Gender.MALE,
          campusId: 'campus-1',
          joiningDate: new Date('2026-01-05'),
        },
      });
      expect(prismaMock.staffProfile.update).not.toHaveBeenCalled();
    });

    it('reactivates a soft-deleted staff profile instead of creating a new one, since userId is not scoped by activeScopeKey', async () => {
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        institutionId: 'institution-1',
        role: UserRole.STAFF,
      });
      prismaMock.staffProfile.findFirst.mockResolvedValue({
        id: 'staff-profile-1',
      });
      prismaMock.staffProfile.update.mockResolvedValue({
        id: 'staff-profile-1',
        userId: 'user-1',
        campusId: 'campus-1',
      });
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        (item: Record<string, unknown>) => ({ ...item, customFields: {} }),
      );

      await service.createStaffProfile(currentUser, baseDto);

      expect(prismaMock.staffProfile.create).not.toHaveBeenCalled();
      expect(prismaMock.staffProfile.update).toHaveBeenCalledWith({
        where: { id: 'staff-profile-1' },
        data: {
          userId: 'user-1',
          employmentType: 'TEACHING',
          designation: 'Teacher',
          gender: Gender.MALE,
          campusId: 'campus-1',
          joiningDate: new Date('2026-01-05'),
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
        },
      });
    });

    it('syncs a matching UserCampus row on create so the staff member resolves to their home campus', async () => {
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        institutionId: 'institution-1',
        role: UserRole.STAFF,
      });
      prismaMock.staffProfile.findFirst.mockResolvedValue(null);
      prismaMock.staffProfile.create.mockResolvedValue({
        id: 'staff-profile-1',
        userId: 'user-1',
        campusId: 'campus-1',
      });
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        (item: Record<string, unknown>) => ({ ...item, customFields: {} }),
      );

      await service.createStaffProfile(currentUser, baseDto);

      expect(prismaMock.userCampus.upsert).toHaveBeenCalledWith({
        where: {
          userId_campusId_activeScopeKey: {
            userId: 'user-1',
            campusId: 'campus-1',
            activeScopeKey: 'ACTIVE',
          },
        },
        create: { userId: 'user-1', campusId: 'campus-1' },
        update: {},
      });
    });

    it('syncs a matching UserCampus row and removes the stale one when a staff profile transfers campuses', async () => {
      campusAccessServiceMock.assertStaffProfileAccess.mockResolvedValue(
        'campus-1',
      );
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-2');
      prismaMock.staffProfile.findUnique.mockResolvedValue({
        id: 'staff-profile-1',
        userId: 'user-1',
        campusId: 'campus-1',
      });
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        institutionId: 'institution-1',
        role: UserRole.STAFF,
      });
      prismaMock.staffProfile.update.mockResolvedValue({
        id: 'staff-profile-1',
        userId: 'user-1',
        campusId: 'campus-2',
      });
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        (item: Record<string, unknown>) => ({ ...item, customFields: {} }),
      );

      await service.updateStaffProfile(currentUser, 'staff-profile-1', {
        campusId: 'campus-2',
      });

      // The old campus's assignment must be gone — otherwise the transferred
      // employee keeps scoped access to a campus they no longer belong to,
      // since CampusAccessService resolves STAFF access purely from
      // UserCampus (§ 7.6).
      expect(prismaMock.userCampus.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', campusId: 'campus-1' },
      });
      expect(prismaMock.userCampus.upsert).toHaveBeenCalledWith({
        where: {
          userId_campusId_activeScopeKey: {
            userId: 'user-1',
            campusId: 'campus-2',
            activeScopeKey: 'ACTIVE',
          },
        },
        create: { userId: 'user-1', campusId: 'campus-2' },
        update: {},
      });
    });

    it('does not touch UserCampus removal when a staff profile update keeps the same campus', async () => {
      campusAccessServiceMock.assertStaffProfileAccess.mockResolvedValue(
        'campus-1',
      );
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      prismaMock.staffProfile.findUnique.mockResolvedValue({
        id: 'staff-profile-1',
        userId: 'user-1',
        campusId: 'campus-1',
      });
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        institutionId: 'institution-1',
        role: UserRole.STAFF,
      });
      prismaMock.staffProfile.update.mockResolvedValue({
        id: 'staff-profile-1',
        userId: 'user-1',
        campusId: 'campus-1',
      });
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        (item: Record<string, unknown>) => ({ ...item, customFields: {} }),
      );

      await service.updateStaffProfile(currentUser, 'staff-profile-1', {
        designation: 'Senior Teacher',
      });

      expect(prismaMock.userCampus.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.userCampus.upsert).toHaveBeenCalledWith({
        where: {
          userId_campusId_activeScopeKey: {
            userId: 'user-1',
            campusId: 'campus-1',
            activeScopeKey: 'ACTIVE',
          },
        },
        create: { userId: 'user-1', campusId: 'campus-1' },
        update: {},
      });
    });
  });

  it('scopes staff profile listing to accessible campuses for non-superadmins', async () => {
    campusAccessServiceMock.getScopedCampusIds.mockResolvedValue(['campus-1']);
    prismaMock.staffProfile.findMany.mockResolvedValue([
      { id: 'staff-profile-1', campusId: 'campus-1' },
    ]);
    entityCustomFieldsServiceMock.attachToItems.mockResolvedValue([
      { id: 'staff-profile-1', campusId: 'campus-1', customFields: {} },
    ]);

    const result = await service.listStaffProfiles(currentUser);

    expect(prismaMock.staffProfile.findMany).toHaveBeenCalledWith({
      where: { campusId: { in: ['campus-1'] } },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toMatchObject({
      message: 'Staff profiles retrieved successfully',
      data: [{ id: 'staff-profile-1', campusId: 'campus-1' }],
    });
  });

  it('retrieves a staff profile with attached custom fields', async () => {
    campusAccessServiceMock.assertStaffProfileAccess.mockResolvedValue(
      'campus-1',
    );
    prismaMock.staffProfile.findUnique.mockResolvedValue({
      id: 'staff-profile-1',
      campusId: 'campus-1',
    });
    entityCustomFieldsServiceMock.attachToItem.mockResolvedValue({
      id: 'staff-profile-1',
      campusId: 'campus-1',
      customFields: { emergencyContact: '03001234567' },
    });

    const result = await service.getStaffProfile(
      currentUser,
      'staff-profile-1',
    );

    expect(result).toMatchObject({
      message: 'Staff profile retrieved successfully',
      data: {
        id: 'staff-profile-1',
        customFields: { emergencyContact: '03001234567' },
      },
    });
  });

  it('throws NotFoundException getting a staff profile that does not exist', async () => {
    campusAccessServiceMock.assertStaffProfileAccess.mockResolvedValue(
      'campus-1',
    );
    prismaMock.staffProfile.findUnique.mockResolvedValue(null);
    entityCustomFieldsServiceMock.attachToItem.mockResolvedValue(null);

    await expect(
      service.getStaffProfile(currentUser, 'missing-staff-profile'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('moves a staff profile to the recycle bin on delete', async () => {
    campusAccessServiceMock.assertStaffProfileAccess.mockResolvedValue(
      'campus-1',
    );
    prismaMock.staffProfile.findUnique.mockResolvedValue({
      id: 'staff-profile-1',
      campusId: 'campus-1',
      userId: 'user-1',
      cnic: '12345-1234567-1',
    });
    prismaMock.staffProfile.update.mockResolvedValue({});

    const result = await service.deleteStaffProfile(
      currentUser,
      'staff-profile-1',
      'No longer employed',
    );

    expect(prismaMock.staffProfile.update).toHaveBeenCalledWith({
      where: { id: 'staff-profile-1' },
      data: {
        deletedAt: expect.any(Date),
        deletedBy: currentUser.sub,
        deleteReason: 'No longer employed',
        updatedBy: currentUser.sub,
      },
    });
    expect(result).toMatchObject({
      message: 'Staff profile moved to recycle bin successfully',
      data: { id: 'staff-profile-1' },
    });
  });

  it('throws NotFoundException deleting a staff profile that does not exist', async () => {
    campusAccessServiceMock.assertStaffProfileAccess.mockResolvedValue(
      'campus-1',
    );
    prismaMock.staffProfile.findUnique.mockResolvedValue(null);

    await expect(
      service.deleteStaffProfile(currentUser, 'missing-staff-profile'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
