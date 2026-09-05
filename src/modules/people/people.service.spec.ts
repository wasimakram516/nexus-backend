import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EnrollmentStatus, Gender } from '../../common/enums/domain.enums';
import {
  ModuleKey,
  Prisma,
  UserRole,
  VoucherStatus,
} from '../../prisma/client';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PromotionOverrideAction } from './dto/people.dto';
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
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
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
    institution: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    institutionSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    campus: {
      findUnique: jest.fn(),
    },
    academicYear: {
      findUnique: jest.fn(),
    },
    studentEnrollment: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    studentHistory: {
      create: jest.fn(),
    },
    feeVoucher: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest
      .fn()
      .mockImplementation((callback: (tx: unknown) => Promise<unknown>) =>
        callback(prismaMock),
      ),
  };

  const campusAccessServiceMock = {
    assertCampusAccess: jest.fn(),
    assertClassAccess: jest.fn(),
    assertSectionAccess: jest.fn(),
    assertStudentAccess: jest.fn(),
    assertGuardianAccess: jest.fn(),
    assertStaffProfileAccess: jest.fn(),
    assertSubjectAccess: jest.fn(),
    assertEnrollmentAccess: jest.fn(),
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
    prismaMock.institution.findMany.mockResolvedValue([]);
    prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
    prismaMock.studentEnrollment.findMany.mockResolvedValue([]);
    prismaMock.feeVoucher.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(prismaMock),
    );

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

  it('updates a student and persists custom fields for the resolved campus institution, without touching class/section', async () => {
    campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
    prismaMock.student.findUnique.mockResolvedValue({
      id: 'student-1',
      userId: 'user-1',
      campusId: 'campus-1',
      institutionId: 'institution-1',
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

    // classId/sectionId are no longer part of UpdateStudentDto's type — only
    // regNo and customFields are exercised here (§ 10 item 5: class/section
    // changes must go through PATCH /people/student-enrollments/:id).
    const result = await service.updateStudent(currentUser, 'student-1', {
      regNo: 'NEX-009',
      customFields: { transport: 'yes' },
    });

    expect(prismaMock.student.update).toHaveBeenCalledWith({
      where: { id: 'student-1' },
      data: {
        regNo: 'NEX-009',
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is intentionally typed `any` by @types/jest
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

  // -------------------------------------------------------------------
  // M2 Phase 3 — regNo generation (§ 7.2)
  // -------------------------------------------------------------------
  describe('regNo generation', () => {
    it('throws ConflictException from resolveNextRegNo when the institution has no current academic year', async () => {
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: null,
      });

      await expect(
        service.resolveNextRegNo(currentUser, 'campus-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('resolves {CAMPUS}/{YEAR}/{SEQ} tokens using Campus.code, the academic year start date, and a live per-year sequence count', async () => {
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
      prismaMock.campus.findUnique.mockResolvedValue({
        code: 'GUL',
        name: 'Gulberg Campus',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        startDate: new Date('2026-04-01T00:00:00.000Z'),
      });
      prismaMock.student.count.mockResolvedValue(6);

      const result = await service.resolveNextRegNo(currentUser, 'campus-1');

      expect(prismaMock.student.count).toHaveBeenCalledWith({
        where: {
          institutionId: 'institution-1',
          enrollments: { some: { academicYearId: 'year-1' } },
        },
      });
      expect(result).toMatchObject({
        data: { suggestedRegNo: 'GUL-26-0007' },
      });
    });

    it('falls back to the first 3 uppercase letters of the campus name when Campus.code is not set', async () => {
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
      prismaMock.campus.findUnique.mockResolvedValue({
        code: null,
        name: 'gulberg campus',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        startDate: new Date('2026-04-01T00:00:00.000Z'),
      });
      prismaMock.student.count.mockResolvedValue(0);

      const result = await service.resolveNextRegNo(currentUser, 'campus-1');

      expect(result).toMatchObject({
        data: { suggestedRegNo: 'GUL-26-0001' },
      });
    });

    it('scopes the sequence count institution-wide (ALL_TIME) when the student_admission setting overrides the PER_ACADEMIC_YEAR default', async () => {
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      prismaMock.institutionSetting.findUnique.mockResolvedValue({
        value: { seqScope: 'ALL_TIME' },
      });
      prismaMock.campus.findUnique.mockResolvedValue({
        code: 'GUL',
        name: 'Gulberg Campus',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        startDate: new Date('2026-04-01T00:00:00.000Z'),
      });
      prismaMock.student.count.mockResolvedValue(2);

      await service.resolveNextRegNo(currentUser, 'campus-1');

      expect(prismaMock.student.count).toHaveBeenCalledWith({
        where: { institutionId: 'institution-1' },
      });
    });

    it('creates the student and its first StudentEnrollment row when a class is given at admission, generating a regNo since none was provided', async () => {
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-1');
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        institutionId: 'institution-1',
        role: UserRole.STUDENT,
      });
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
      prismaMock.campus.findUnique.mockResolvedValue({
        code: 'GUL',
        name: 'Gulberg Campus',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        startDate: new Date('2026-04-01T00:00:00.000Z'),
      });
      prismaMock.student.count.mockResolvedValue(3);
      prismaMock.student.findFirst.mockResolvedValue(null);
      prismaMock.student.create.mockResolvedValue({
        id: 'student-1',
        regNo: 'GUL-26-0004',
        userId: 'user-1',
      });
      prismaMock.studentEnrollment.create.mockResolvedValue({
        id: 'enrollment-1',
      });
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        (item: Record<string, unknown>) => ({ ...item, customFields: {} }),
      );

      const result = await service.createStudent(currentUser, {
        userId: 'user-1',
        dob: '2020-01-01',
        gender: Gender.MALE,
        campusId: 'campus-1',
        admissionDate: '2026-01-01',
        classId: 'class-1',
        sectionId: 'section-1',
      });

      expect(prismaMock.student.create).toHaveBeenCalledWith({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest
        data: expect.objectContaining({
          institutionId: 'institution-1',
          campusId: 'campus-1',
          regNo: 'GUL-26-0004',
        }),
      });
      // classId/sectionId/regNo must NOT be persisted on the Student row
      // itself — they were destructured out before the create call.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- jest.fn() mock.calls args are untyped (any)
      const createCallData = prismaMock.student.create.mock.calls[0][0].data;
      expect(createCallData).not.toHaveProperty('classId');
      expect(createCallData).not.toHaveProperty('sectionId');

      expect(prismaMock.studentEnrollment.create).toHaveBeenCalledWith({
        data: {
          studentId: 'student-1',
          academicYearId: 'year-1',
          campusId: 'campus-1',
          classId: 'class-1',
          sectionId: 'section-1',
          createdBy: currentUser.sub,
        },
      });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { identifier: 'GUL-26-0004' },
      });
      expect(result).toMatchObject({ message: 'Student created successfully' });
    });

    it('retries with the next sequence value when a generated regNo collides on create (P2002), succeeding on the second attempt', async () => {
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        institutionId: 'institution-1',
        role: UserRole.STUDENT,
      });
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      prismaMock.institutionSetting.findUnique.mockResolvedValue(null);
      prismaMock.campus.findUnique.mockResolvedValue({
        code: 'GUL',
        name: 'Gulberg Campus',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        startDate: new Date('2026-04-01T00:00:00.000Z'),
      });
      prismaMock.student.count.mockResolvedValue(9);
      prismaMock.student.findFirst.mockResolvedValue(null);

      const conflictError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`institution_id`,`reg_no`,`active_scope_key`)',
        { code: 'P2002', clientVersion: 'test' },
      );
      prismaMock.student.create
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce({
          id: 'student-1',
          regNo: 'GUL-26-0011',
          userId: 'user-1',
        });
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        (item: Record<string, unknown>) => ({ ...item, customFields: {} }),
      );

      await service.createStudent(currentUser, {
        userId: 'user-1',
        dob: '2020-01-01',
        gender: Gender.MALE,
        campusId: 'campus-1',
        admissionDate: '2026-01-01',
      });

      expect(prismaMock.student.create).toHaveBeenCalledTimes(2);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.fn() mock.calls args are untyped (any)
      expect(prismaMock.student.create.mock.calls[0][0].data.regNo).toBe(
        'GUL-26-0010',
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.fn() mock.calls args are untyped (any)
      expect(prismaMock.student.create.mock.calls[1][0].data.regNo).toBe(
        'GUL-26-0011',
      );
    });

    it('throws ConflictException from createStudent when the institution has no current academic year', async () => {
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        institutionId: 'institution-1',
        role: UserRole.STUDENT,
      });
      entityCustomFieldsServiceMock.resolveInstitutionIdByCampus.mockResolvedValue(
        'institution-1',
      );
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: null,
      });

      await expect(
        service.createStudent(currentUser, {
          userId: 'user-1',
          dob: '2020-01-01',
          gender: Gender.MALE,
          campusId: 'campus-1',
          admissionDate: '2026-01-01',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // -------------------------------------------------------------------
  // M2 Phase 3 — recordPromotion / applyEnrollmentTransition pairing (§ 7.5)
  // -------------------------------------------------------------------
  describe('recordPromotion (manual transfer)', () => {
    it('updates the existing enrollment row in place and writes a paired StudentHistory row', async () => {
      campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
      campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-1');
      prismaMock.student.findUnique.mockResolvedValue({
        institutionId: 'institution-1',
      });
      prismaMock.studentEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        classId: 'class-1',
        sectionId: 'section-1',
      });
      prismaMock.studentEnrollment.update.mockResolvedValue({
        id: 'enrollment-1',
        classId: 'class-2',
        sectionId: null,
      });
      prismaMock.studentHistory.create.mockResolvedValue({
        id: 'history-1',
      });
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        (item: Record<string, unknown>) => ({ ...item, customFields: {} }),
      );

      await service.recordPromotion(currentUser, {
        studentId: 'student-1',
        academicYearId: 'year-1',
        newClassId: 'class-2',
        promotionDate: '2026-04-01',
        promotionReason: 'Mid-year transfer',
      });

      expect(prismaMock.studentEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'enrollment-1' },
        data: {
          classId: 'class-2',
          sectionId: 'section-1',
          updatedBy: currentUser.sub,
        },
      });
      expect(prismaMock.studentEnrollment.create).not.toHaveBeenCalled();
      expect(prismaMock.studentHistory.create).toHaveBeenCalledWith({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest
        data: expect.objectContaining({
          studentId: 'student-1',
          previousClassId: null,
          newClassId: 'class-2',
          academicYearId: 'year-1',
          promotionReason: 'Mid-year transfer',
        }),
      });
    });

    it('creates a new enrollment row when none exists yet for the resolved academic year', async () => {
      campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
      campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-1');
      prismaMock.student.findUnique.mockResolvedValue({
        institutionId: 'institution-1',
      });
      prismaMock.studentEnrollment.findUnique.mockResolvedValue(null);
      prismaMock.studentEnrollment.create.mockResolvedValue({
        id: 'enrollment-2',
      });
      prismaMock.studentHistory.create.mockResolvedValue({ id: 'history-2' });
      entityCustomFieldsServiceMock.attachToItem.mockImplementation(
        (item: Record<string, unknown>) => ({ ...item, customFields: {} }),
      );

      await service.recordPromotion(currentUser, {
        studentId: 'student-1',
        academicYearId: 'year-1',
        newClassId: 'class-1',
        promotionDate: '2026-04-01',
      });

      expect(prismaMock.studentEnrollment.update).not.toHaveBeenCalled();
      expect(prismaMock.studentEnrollment.create).toHaveBeenCalledWith({
        data: {
          studentId: 'student-1',
          academicYearId: 'year-1',
          campusId: 'campus-1',
          classId: 'class-1',
          sectionId: null,
          createdBy: currentUser.sub,
        },
      });
      expect(prismaMock.studentHistory.create).toHaveBeenCalled();
    });

    it('throws ConflictException when no academic year can be resolved for the student', async () => {
      campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
      prismaMock.student.findUnique.mockResolvedValue({
        institutionId: 'institution-1',
      });
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: null,
      });

      await expect(
        service.recordPromotion(currentUser, {
          studentId: 'student-1',
          promotionDate: '2026-04-01',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // -------------------------------------------------------------------
  // M2 Phase 3 — StudentEnrollment CRUD (§ 6.2)
  // -------------------------------------------------------------------
  describe('student enrollment CRUD', () => {
    it('creates a student enrollment after validating class/section campus alignment', async () => {
      campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
      campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-1');
      campusAccessServiceMock.assertSectionAccess.mockResolvedValue('campus-1');
      prismaMock.student.findUnique.mockResolvedValue({
        institutionId: 'institution-1',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        institutionId: 'institution-1',
      });
      prismaMock.studentEnrollment.create.mockResolvedValue({
        id: 'enrollment-1',
      });

      const result = await service.createStudentEnrollment(currentUser, {
        studentId: 'student-1',
        academicYearId: 'year-1',
        classId: 'class-1',
        sectionId: 'section-1',
      });

      expect(prismaMock.studentEnrollment.create).toHaveBeenCalledWith({
        data: {
          studentId: 'student-1',
          academicYearId: 'year-1',
          campusId: 'campus-1',
          classId: 'class-1',
          sectionId: 'section-1',
          createdBy: currentUser.sub,
        },
      });
      expect(result).toMatchObject({
        message: 'Student enrollment created successfully',
      });
    });

    it('rejects creating an enrollment when the academic year belongs to a different institution', async () => {
      campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
      campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-1');
      prismaMock.student.findUnique.mockResolvedValue({
        institutionId: 'institution-1',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        institutionId: 'institution-2',
      });

      await expect(
        service.createStudentEnrollment(currentUser, {
          studentId: 'student-1',
          academicYearId: 'year-1',
          classId: 'class-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('converts a P2002 collision on (studentId, academicYearId) into a 409', async () => {
      campusAccessServiceMock.assertStudentAccess.mockResolvedValue('campus-1');
      campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-1');
      prismaMock.student.findUnique.mockResolvedValue({
        institutionId: 'institution-1',
      });
      prismaMock.academicYear.findUnique.mockResolvedValue({
        institutionId: 'institution-1',
      });
      prismaMock.studentEnrollment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createStudentEnrollment(currentUser, {
          studentId: 'student-1',
          academicYearId: 'year-1',
          classId: 'class-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('updateStudentEnrollment writes a paired StudentHistory row for a class/section change', async () => {
      campusAccessServiceMock.assertEnrollmentAccess.mockResolvedValue(
        'campus-1',
      );
      campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-1');
      prismaMock.studentEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        studentId: 'student-1',
        academicYearId: 'year-1',
        classId: 'class-1',
        sectionId: 'section-1',
      });
      prismaMock.studentEnrollment.update.mockResolvedValue({
        id: 'enrollment-1',
        classId: 'class-2',
        sectionId: 'section-1',
      });
      prismaMock.studentHistory.create.mockResolvedValue({ id: 'history-1' });

      const result = await service.updateStudentEnrollment(
        currentUser,
        'enrollment-1',
        { classId: 'class-2', reason: 'Section reshuffle' },
      );

      expect(prismaMock.studentEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'enrollment-1' },
        data: {
          classId: 'class-2',
          sectionId: 'section-1',
          updatedBy: currentUser.sub,
        },
      });
      expect(prismaMock.studentHistory.create).toHaveBeenCalledWith({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest
        data: expect.objectContaining({
          previousClassId: 'class-1',
          previousSectionId: 'section-1',
          newClassId: 'class-2',
          newSectionId: 'section-1',
          promotionReason: 'Section reshuffle',
        }),
      });
      expect(result).toMatchObject({
        message: 'Student enrollment updated successfully',
      });
    });

    it('updateStudentEnrollment is a no-op (no transaction, no history write) when neither classId nor sectionId is given', async () => {
      campusAccessServiceMock.assertEnrollmentAccess.mockResolvedValue(
        'campus-1',
      );
      prismaMock.studentEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        studentId: 'student-1',
        academicYearId: 'year-1',
        classId: 'class-1',
        sectionId: 'section-1',
      });

      await service.updateStudentEnrollment(currentUser, 'enrollment-1', {
        reason: 'just a note',
      });

      expect(prismaMock.studentEnrollment.update).not.toHaveBeenCalled();
      expect(prismaMock.studentHistory.create).not.toHaveBeenCalled();
    });

    it('deleteStudentEnrollment soft-deletes the row', async () => {
      campusAccessServiceMock.assertEnrollmentAccess.mockResolvedValue(
        'campus-1',
      );
      prismaMock.studentEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        studentId: 'student-1',
        academicYearId: 'year-1',
        campusId: 'campus-1',
      });
      prismaMock.studentEnrollment.update.mockResolvedValue({});

      const result = await service.deleteStudentEnrollment(
        currentUser,
        'enrollment-1',
        'Mistaken entry',
      );

      expect(prismaMock.studentEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'enrollment-1' },
        data: {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is intentionally typed `any` by @types/jest
          deletedAt: expect.any(Date),
          deletedBy: currentUser.sub,
          deleteReason: 'Mistaken entry',
          updatedBy: currentUser.sub,
        },
      });
      expect(result).toMatchObject({
        message: 'Student enrollment moved to recycle bin successfully',
      });
    });
  });

  // -------------------------------------------------------------------
  // M2 Phase 3 — withdrawal + dues clearance (§ 7.4)
  // -------------------------------------------------------------------
  describe('withdrawStudent', () => {
    it('blocks withdrawal with a 409 carrying outstandingAmount when dues are unacknowledged', async () => {
      campusAccessServiceMock.assertEnrollmentAccess.mockResolvedValue(
        'campus-1',
      );
      prismaMock.studentEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        studentId: 'student-1',
        academicYearId: 'year-1',
        classId: 'class-1',
        sectionId: null,
        status: EnrollmentStatus.ACTIVE,
      });
      prismaMock.feeVoucher.findMany.mockResolvedValue([
        {
          finalAmountDue: 5000,
          status: VoucherStatus.PENDING,
          payments: [{ paidAmount: 1000 }],
        },
      ]);

      const promise = service.withdrawStudent(currentUser, 'enrollment-1', {
        leftDate: '2026-06-01',
        leftReason: 'Relocating',
      });
      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await promise.catch((error: ConflictException) => {
        expect(error.getResponse()).toMatchObject({ outstandingAmount: 4000 });
      });
      expect(prismaMock.studentEnrollment.update).not.toHaveBeenCalled();
    });

    it('proceeds when acknowledgeOutstandingDues is true despite outstanding dues', async () => {
      campusAccessServiceMock.assertEnrollmentAccess.mockResolvedValue(
        'campus-1',
      );
      prismaMock.studentEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        studentId: 'student-1',
        academicYearId: 'year-1',
        classId: 'class-1',
        sectionId: null,
        status: EnrollmentStatus.ACTIVE,
      });
      prismaMock.feeVoucher.findMany.mockResolvedValue([
        {
          finalAmountDue: 5000,
          status: VoucherStatus.OVERDUE,
          payments: [],
        },
      ]);
      prismaMock.studentEnrollment.update.mockResolvedValue({
        id: 'enrollment-1',
        status: EnrollmentStatus.LEFT,
      });
      prismaMock.studentHistory.create.mockResolvedValue({ id: 'history-1' });

      const result = await service.withdrawStudent(
        currentUser,
        'enrollment-1',
        {
          leftDate: '2026-06-01',
          leftReason: 'Relocating',
          acknowledgeOutstandingDues: true,
        },
      );

      expect(prismaMock.studentEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'enrollment-1' },
        data: {
          status: EnrollmentStatus.LEFT,
          leftDate: new Date('2026-06-01'),
          leftReason: 'Relocating',
          updatedBy: currentUser.sub,
        },
      });
      expect(prismaMock.studentHistory.create).toHaveBeenCalledWith({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest
        data: expect.objectContaining({
          promotionReason: 'Withdrawal',
          remarks: 'Relocating',
        }),
      });
      expect(result).toMatchObject({
        message: 'Student withdrawn successfully',
      });
    });

    it('proceeds directly when there are no outstanding dues', async () => {
      campusAccessServiceMock.assertEnrollmentAccess.mockResolvedValue(
        'campus-1',
      );
      prismaMock.studentEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        studentId: 'student-1',
        academicYearId: 'year-1',
        classId: 'class-1',
        sectionId: null,
        status: EnrollmentStatus.ACTIVE,
      });
      prismaMock.feeVoucher.findMany.mockResolvedValue([]);
      prismaMock.studentEnrollment.update.mockResolvedValue({
        id: 'enrollment-1',
        status: EnrollmentStatus.LEFT,
      });
      prismaMock.studentHistory.create.mockResolvedValue({ id: 'history-1' });

      await expect(
        service.withdrawStudent(currentUser, 'enrollment-1', {
          leftDate: '2026-06-01',
          leftReason: 'Graduated early',
        }),
      ).resolves.toMatchObject({ message: 'Student withdrawn successfully' });
    });

    it('throws ConflictException when the enrollment is already LEFT', async () => {
      campusAccessServiceMock.assertEnrollmentAccess.mockResolvedValue(
        'campus-1',
      );
      prismaMock.studentEnrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        status: EnrollmentStatus.LEFT,
      });

      await expect(
        service.withdrawStudent(currentUser, 'enrollment-1', {
          leftDate: '2026-06-01',
          leftReason: 'Relocating',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('confirms createFeeVoucher-side enforcement is a separate guard: withdrawal itself never touches FeeVoucher.create', () => {
      // Documents the division of responsibility from § 7.4 item 5 — the
      // actual "reject a voucher for a LEFT student" behavior is verified in
      // finance.service.spec.ts, since that guard lives in
      // FinanceService.createFeeVoucher(), not here.
      expect(prismaMock.feeVoucher).not.toHaveProperty('create');
    });
  });

  // -------------------------------------------------------------------
  // M2 Phase 3 — bulk promotion wizard (§ 7.3)
  // -------------------------------------------------------------------
  describe('promotion wizard', () => {
    const campus = { institutionId: 'institution-1' };
    const sourceYear = { institutionId: 'institution-1' };
    const targetYear = { institutionId: 'institution-1' };

    beforeEach(() => {
      campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
      prismaMock.campus.findUnique.mockResolvedValue(campus);
      prismaMock.academicYear.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === 'source-year' ? sourceYear : targetYear),
      );
    });

    const baseDto = {
      campusId: 'campus-1',
      sourceAcademicYearId: 'source-year',
      targetAcademicYearId: 'target-year',
      classMappings: [{ fromClassId: 'class-1', toClassId: 'class-2' }],
    };

    it('previewPromotion reports a conflict for a student whose class has no mapping and no override', async () => {
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        {
          id: 'enr-1',
          studentId: 'student-1',
          classId: 'class-99',
          sectionId: null,
          student: { id: 'student-1', regNo: 'NEX-001' },
        },
      ]);

      const result = await service.previewPromotion(currentUser, baseDto);

      expect(result.data).toMatchObject({
        totalStudents: 1,
        byOutcome: { promoted: 0, repeated: 0, left: 0 },
        conflicts: [
          { studentId: 'student-1', regNo: 'NEX-001', classId: 'class-99' },
        ],
      });
    });

    it('previewPromotion resolves REPEAT and LEAVE overrides correctly alongside a default class mapping', async () => {
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        {
          id: 'enr-1',
          studentId: 'student-1',
          classId: 'class-1',
          sectionId: null,
          student: { id: 'student-1', regNo: 'NEX-001' },
        },
        {
          id: 'enr-2',
          studentId: 'student-2',
          classId: 'class-1',
          sectionId: null,
          student: { id: 'student-2', regNo: 'NEX-002' },
        },
        {
          id: 'enr-3',
          studentId: 'student-3',
          classId: 'class-1',
          sectionId: null,
          student: { id: 'student-3', regNo: 'NEX-003' },
        },
      ]);

      const result = await service.previewPromotion(currentUser, {
        ...baseDto,
        studentOverrides: [
          { studentId: 'student-2', action: PromotionOverrideAction.REPEAT },
          { studentId: 'student-3', action: PromotionOverrideAction.LEAVE },
        ],
      });

      expect(result.data).toMatchObject({
        totalStudents: 3,
        byOutcome: { promoted: 1, repeated: 1, left: 1 },
        conflicts: [],
      });
    });

    it('commitPromotion promotes, repeats, and leaves students in one transaction, skipping conflicts', async () => {
      prismaMock.studentEnrollment.findMany
        .mockResolvedValueOnce([
          {
            id: 'enr-1',
            studentId: 'student-1',
            classId: 'class-1',
            sectionId: null,
            student: { id: 'student-1', regNo: 'NEX-001' },
          },
          {
            id: 'enr-2',
            studentId: 'student-2',
            classId: 'class-1',
            sectionId: null,
            student: { id: 'student-2', regNo: 'NEX-002' },
          },
          {
            id: 'enr-3',
            studentId: 'student-3',
            classId: 'class-99',
            sectionId: null,
            student: { id: 'student-3', regNo: 'NEX-003' },
          },
        ])
        // idempotency pre-check query — nobody already processed.
        .mockResolvedValueOnce([]);
      prismaMock.studentEnrollment.update.mockResolvedValue({});
      prismaMock.studentEnrollment.create.mockResolvedValue({});
      prismaMock.studentHistory.create.mockResolvedValue({});

      const result = await service.commitPromotion(currentUser, {
        ...baseDto,
        studentOverrides: [
          { studentId: 'student-2', action: PromotionOverrideAction.LEAVE },
        ],
      });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      // student-1: promoted (class mapping) -> enrollment created + history.
      expect(prismaMock.studentEnrollment.create).toHaveBeenCalledWith({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest
        data: expect.objectContaining({
          studentId: 'student-1',
          academicYearId: 'target-year',
          classId: 'class-2',
          status: EnrollmentStatus.ACTIVE,
        }),
      });
      // student-2: LEAVE override -> source row marked LEFT, no new row for them.
      expect(prismaMock.studentEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'enr-2' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest
        data: expect.objectContaining({ status: EnrollmentStatus.LEFT }),
      });
      expect(result.data).toMatchObject({
        promoted: 1,
        repeated: 0,
        left: 1,
        skippedAlreadyProcessed: 0,
        conflicts: [
          { studentId: 'student-3', regNo: 'NEX-003', classId: 'class-99' },
        ],
      });
    });

    it('commitPromotion is idempotent: skips a student who already has a target-year enrollment row', async () => {
      prismaMock.studentEnrollment.findMany
        .mockResolvedValueOnce([
          {
            id: 'enr-1',
            studentId: 'student-1',
            classId: 'class-1',
            sectionId: null,
            student: { id: 'student-1', regNo: 'NEX-001' },
          },
        ])
        // idempotency pre-check: student-1 already has a target-year row.
        .mockResolvedValueOnce([{ studentId: 'student-1' }]);

      const result = await service.commitPromotion(currentUser, baseDto);

      expect(prismaMock.studentEnrollment.create).not.toHaveBeenCalled();
      expect(prismaMock.studentEnrollment.update).not.toHaveBeenCalled();
      expect(result.data).toMatchObject({
        promoted: 0,
        repeated: 0,
        left: 0,
        skippedAlreadyProcessed: 1,
      });
    });
  });
});
