import { ConflictException, ForbiddenException } from '@nestjs/common';
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
    teacher: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    teacherSubject: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    contact: {
      create: jest.fn(),
    },
  };

  const campusAccessServiceMock = {
    assertCampusAccess: jest.fn(),
    assertClassAccess: jest.fn(),
    assertSectionAccess: jest.fn(),
    assertStudentAccess: jest.fn(),
    assertGuardianAccess: jest.fn(),
    assertTeacherAccess: jest.fn(),
    assertSubjectAccess: jest.fn(),
    getScopedCampusIds: jest.fn(),
  };

  const entityCustomFieldsServiceMock = {
    resolveInstitutionIdByCampus: jest.fn(),
    resolveInstitutionIdByStudent: jest.fn(),
    resolveInstitutionIdByGuardian: jest.fn(),
    resolveInstitutionIdByTeacher: jest.fn(),
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
      teacherId: null,
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

  it('blocks duplicate teacher subject assignments for the same campus mapping', async () => {
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertTeacherAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertClassAccess.mockResolvedValue('campus-1');
    campusAccessServiceMock.assertSubjectAccess.mockResolvedValue('campus-1');
    prismaMock.teacherSubject.findFirst.mockResolvedValue({
      id: 'assignment-1',
    });

    await expect(
      service.assignTeacherSubject(currentUser, {
        teacherId: 'teacher-1',
        classId: 'class-1',
        subjectId: 'subject-1',
        campusId: 'campus-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
