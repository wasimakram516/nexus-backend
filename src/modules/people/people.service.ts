import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomFieldEntity } from '../../common/constants/custom-field-entities.constants';
import { ContactPersonType } from '../../common/enums/domain.enums';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import {
  buildContactOwnerFields,
  normalizeContactPersonType,
} from '../../common/utils/contact-owner.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import {
  AssignTeacherSubjectDto,
  CreateContactDto,
  CreateGuardianDto,
  CreateStaffProfileDto,
  CreateStudentDto,
  LinkGuardianDto,
  StudentPromotionDto,
  UpdateGuardianDto,
  UpdateStaffProfileDto,
  UpdateStudentDto,
} from './dto/people.dto';

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campusAccessService: CampusAccessService,
    private readonly entityCustomFieldsService: EntityCustomFieldsService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly requestContext: RequestContextService,
  ) {}

  async createStudent(currentUser: CurrentUser, dto: CreateStudentDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    await this.assertUserInstitutionAlignment(
      currentUser,
      dto.userId,
      dto.campusId,
    );

    if (dto.classId) {
      const classCampusId = await this.campusAccessService.assertClassAccess(
        currentUser,
        dto.classId,
      );
      this.assertSameCampus(dto.campusId, classCampusId, 'class');
    }

    if (dto.sectionId) {
      const sectionCampusId =
        await this.campusAccessService.assertSectionAccess(
          currentUser,
          dto.sectionId,
        );
      this.assertSameCampus(dto.campusId, sectionCampusId, 'section');
    }

    const { customFields, ...studentFields } = dto;
    // Prisma DateTime columns reject date-only strings like "2016-06-12".
    const studentData = {
      ...studentFields,
      dob: new Date(dto.dob),
      admissionDate: new Date(dto.admissionDate),
    };
    const deletedStudent = await this.prisma.student.findFirst({
      where: {
        userId: dto.userId,
        deletedAt: { not: null },
      },
      select: { id: true },
    });

    let item;
    try {
      item = deletedStudent
        ? await this.prisma.student.update({
            where: { id: deletedStudent.id },
            data: {
              ...studentData,
              deletedAt: null,
              deletedBy: null,
              deleteReason: null,
            },
          })
        : await this.prisma.student.create({ data: studentData });
    } catch (error) {
      this.rethrowUniqueConflict(error, 'student');
    }
    // Students log in with their registration number (see AuthService.login).
    await this.prisma.user.update({
      where: { id: dto.userId },
      data: { identifier: dto.regNo },
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.PEOPLE,
      entityType: CustomFieldEntity.STUDENT,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STUDENT,
    );
    return { message: 'Student created successfully', data };
  }

  async listStudents(currentUser: CurrentUser, campusId?: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.student.findMany({
      where:
        currentUser.role === UserRole.SUPERADMIN && !campusId
          ? undefined
          : { campusId: { in: campusIds } },
      orderBy: { createdAt: 'desc' },
      include: {
        guardians: {
          where: { deletedAt: null },
          select: { id: true, guardianId: true },
        },
      },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.STUDENT,
    );
    return { message: 'Students retrieved successfully', data };
  }

  async getStudent(currentUser: CurrentUser, studentId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertStudentAccess(currentUser, studentId);

    const item = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STUDENT,
    );

    if (!data) {
      throw new NotFoundException('Student not found.');
    }

    return { message: 'Student retrieved successfully', data };
  }

  async updateStudent(
    currentUser: CurrentUser,
    studentId: string,
    dto: UpdateStudentDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );

    const existing = await this.prisma.student.findUnique({
      where: { id: studentId },
    });

    if (!existing) {
      throw new NotFoundException('Student not found.');
    }

    await this.campusAccessService.assertStudentAccess(currentUser, studentId);
    const targetCampusId = dto.campusId ?? existing.campusId;
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      targetCampusId,
    );

    await this.assertUserInstitutionAlignment(
      currentUser,
      dto.userId ?? existing.userId,
      targetCampusId,
    );

    if (dto.classId) {
      const classCampusId = await this.campusAccessService.assertClassAccess(
        currentUser,
        dto.classId,
      );
      this.assertSameCampus(targetCampusId, classCampusId, 'class');
    }

    if (dto.sectionId) {
      const sectionCampusId =
        await this.campusAccessService.assertSectionAccess(
          currentUser,
          dto.sectionId,
        );
      this.assertSameCampus(targetCampusId, sectionCampusId, 'section');
    }

    const { customFields, ...studentFields } = dto;
    const item = await this.prisma.student.update({
      where: { id: studentId },
      data: {
        ...studentFields,
        ...(dto.dob && { dob: new Date(dto.dob) }),
        ...(dto.admissionDate && {
          admissionDate: new Date(dto.admissionDate),
        }),
      },
    });
    if (dto.regNo && dto.regNo !== existing.regNo) {
      // Keep the login identifier in sync with the registration number.
      await this.prisma.user.update({
        where: { id: item.userId },
        data: { identifier: dto.regNo },
      });
    }
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        targetCampusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.PEOPLE,
      entityType: CustomFieldEntity.STUDENT,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STUDENT,
    );
    return { message: 'Student updated successfully', data };
  }

  async deleteStudent(
    currentUser: CurrentUser,
    studentId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertStudentAccess(currentUser, studentId);

    const existing = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, campusId: true, userId: true, regNo: true },
    });

    if (!existing) {
      throw new NotFoundException('Student not found.');
    }

    await this.prisma.student.update({
      where: { id: studentId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return {
      message: 'Student moved to recycle bin successfully',
      data: existing,
    };
  }

  async createGuardian(currentUser: CurrentUser, dto: CreateGuardianDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    await this.assertUserInstitutionAlignment(
      currentUser,
      dto.userId,
      dto.campusId,
    );
    const { customFields, ...guardianData } = dto;
    const deletedGuardian = await this.prisma.guardian.findFirst({
      where: {
        userId: dto.userId,
        deletedAt: { not: null },
      },
      select: { id: true },
    });
    let item;
    try {
      item = deletedGuardian
        ? await this.prisma.guardian.update({
            where: { id: deletedGuardian.id },
            data: {
              ...guardianData,
              deletedAt: null,
              deletedBy: null,
              deleteReason: null,
            },
          })
        : await this.prisma.guardian.create({ data: guardianData });
    } catch (error) {
      this.rethrowUniqueConflict(error, 'guardian');
    }
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.PEOPLE,
      entityType: CustomFieldEntity.GUARDIAN,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.GUARDIAN,
    );
    return { message: 'Guardian created successfully', data };
  }

  async listGuardians(currentUser: CurrentUser, campusId?: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.guardian.findMany({
      where:
        currentUser.role === UserRole.SUPERADMIN && !campusId
          ? undefined
          : { campusId: { in: campusIds } },
      orderBy: { createdAt: 'desc' },
      include: {
        students: {
          where: { deletedAt: null },
          select: { id: true, studentId: true },
        },
      },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.GUARDIAN,
    );
    return { message: 'Guardians retrieved successfully', data };
  }

  async getGuardian(currentUser: CurrentUser, guardianId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertGuardianAccess(
      currentUser,
      guardianId,
    );

    const item = await this.prisma.guardian.findUnique({
      where: { id: guardianId },
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.GUARDIAN,
    );

    if (!data) {
      throw new NotFoundException('Guardian not found.');
    }

    return { message: 'Guardian retrieved successfully', data };
  }

  async updateGuardian(
    currentUser: CurrentUser,
    guardianId: string,
    dto: UpdateGuardianDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );

    const existing = await this.prisma.guardian.findUnique({
      where: { id: guardianId },
    });

    if (!existing) {
      throw new NotFoundException('Guardian not found.');
    }

    await this.campusAccessService.assertGuardianAccess(
      currentUser,
      guardianId,
    );
    const targetCampusId = dto.campusId ?? existing.campusId;
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      targetCampusId,
    );

    await this.assertUserInstitutionAlignment(
      currentUser,
      dto.userId ?? existing.userId,
      targetCampusId,
    );

    const { customFields, ...guardianData } = dto;
    const item = await this.prisma.guardian.update({
      where: { id: guardianId },
      data: guardianData,
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        targetCampusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.PEOPLE,
      entityType: CustomFieldEntity.GUARDIAN,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.GUARDIAN,
    );
    return { message: 'Guardian updated successfully', data };
  }

  async deleteGuardian(
    currentUser: CurrentUser,
    guardianId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertGuardianAccess(
      currentUser,
      guardianId,
    );

    const existing = await this.prisma.guardian.findUnique({
      where: { id: guardianId },
      select: { id: true, campusId: true, userId: true, relation: true },
    });

    if (!existing) {
      throw new NotFoundException('Guardian not found.');
    }

    await this.prisma.guardian.update({
      where: { id: guardianId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return {
      message: 'Guardian moved to recycle bin successfully',
      data: existing,
    };
  }

  async createStaffProfile(
    currentUser: CurrentUser,
    dto: CreateStaffProfileDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    await this.assertUserInstitutionAlignment(
      currentUser,
      dto.userId,
      dto.campusId,
    );
    const { customFields, ...staffProfileFields } = dto;
    // Prisma DateTime columns reject date-only strings like "2026-01-01".
    const staffProfileData = {
      ...staffProfileFields,
      joiningDate: new Date(dto.joiningDate),
    };
    // StaffProfile.userId is @unique directly (not part of a compound
    // [userId, activeScopeKey] unique like most soft-deletable entities), so
    // a soft-deleted profile's userId slot is NOT automatically freed for
    // reuse — reactivate the existing row instead of trying (and failing) to
    // create a new one. Preserved from the legacy Teacher implementation.
    const deletedStaffProfile = await this.prisma.staffProfile.findFirst({
      where: {
        userId: dto.userId,
        deletedAt: { not: null },
      },
      select: { id: true },
    });
    let item;
    try {
      item = deletedStaffProfile
        ? await this.prisma.staffProfile.update({
            where: { id: deletedStaffProfile.id },
            data: {
              ...staffProfileData,
              deletedAt: null,
              deletedBy: null,
              deleteReason: null,
            },
          })
        : await this.prisma.staffProfile.create({ data: staffProfileData });
    } catch (error) {
      this.rethrowUniqueConflict(error, 'staff profile');
    }
    await this.syncUserCampusAssignment(dto.userId, dto.campusId);
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.PEOPLE,
      entityType: CustomFieldEntity.STAFF_PROFILE,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STAFF_PROFILE,
    );
    return { message: 'Staff profile created successfully', data };
  }

  async listStaffProfiles(currentUser: CurrentUser, campusId?: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const items = await this.prisma.staffProfile.findMany({
      where:
        currentUser.role === UserRole.SUPERADMIN && !campusId
          ? undefined
          : { campusId: { in: campusIds } },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.STAFF_PROFILE,
    );
    return { message: 'Staff profiles retrieved successfully', data };
  }

  async getStaffProfile(currentUser: CurrentUser, staffProfileId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertStaffProfileAccess(
      currentUser,
      staffProfileId,
    );

    const item = await this.prisma.staffProfile.findUnique({
      where: { id: staffProfileId },
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STAFF_PROFILE,
    );

    if (!data) {
      throw new NotFoundException('Staff profile not found.');
    }

    return { message: 'Staff profile retrieved successfully', data };
  }

  async updateStaffProfile(
    currentUser: CurrentUser,
    staffProfileId: string,
    dto: UpdateStaffProfileDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );

    const existing = await this.prisma.staffProfile.findUnique({
      where: { id: staffProfileId },
    });

    if (!existing) {
      throw new NotFoundException('Staff profile not found.');
    }

    await this.campusAccessService.assertStaffProfileAccess(
      currentUser,
      staffProfileId,
    );
    const targetCampusId = dto.campusId ?? existing.campusId;
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      targetCampusId,
    );

    await this.assertUserInstitutionAlignment(
      currentUser,
      dto.userId ?? existing.userId,
      targetCampusId,
    );

    const { customFields, ...staffProfileFields } = dto;
    const item = await this.prisma.staffProfile.update({
      where: { id: staffProfileId },
      data: {
        ...staffProfileFields,
        ...(dto.joiningDate && { joiningDate: new Date(dto.joiningDate) }),
      },
    });
    await this.syncUserCampusAssignment(
      item.userId,
      targetCampusId,
      existing.campusId,
    );
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        targetCampusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.PEOPLE,
      entityType: CustomFieldEntity.STAFF_PROFILE,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STAFF_PROFILE,
    );
    return { message: 'Staff profile updated successfully', data };
  }

  async deleteStaffProfile(
    currentUser: CurrentUser,
    staffProfileId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertStaffProfileAccess(
      currentUser,
      staffProfileId,
    );

    const existing = await this.prisma.staffProfile.findUnique({
      where: { id: staffProfileId },
      select: { id: true, campusId: true, userId: true, cnic: true },
    });

    if (!existing) {
      throw new NotFoundException('Staff profile not found.');
    }

    await this.prisma.staffProfile.update({
      where: { id: staffProfileId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return {
      message: 'Staff profile moved to recycle bin successfully',
      data: existing,
    };
  }

  async linkGuardian(currentUser: CurrentUser, dto: LinkGuardianDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertStudentAccess(
      currentUser,
      dto.studentId,
    );
    await this.campusAccessService.assertGuardianAccess(
      currentUser,
      dto.guardianId,
    );
    const studentInstitutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByStudent(
        dto.studentId,
      );
    const guardianInstitutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByGuardian(
        dto.guardianId,
      );

    if (studentInstitutionId !== guardianInstitutionId) {
      throw new ForbiddenException(
        'Student and guardian must belong to the same institution.',
      );
    }

    const { customFields, ...linkData } = dto;
    const item = await this.prisma.studentGuardian.upsert({
      where: {
        studentId_guardianId_activeScopeKey: {
          studentId: dto.studentId,
          guardianId: dto.guardianId,
          activeScopeKey: 'ACTIVE',
        },
      },
      create: linkData,
      update: {},
    });
    const institutionId = studentInstitutionId;
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.PEOPLE,
      entityType: CustomFieldEntity.STUDENT_GUARDIAN,
      entityId: `${item.studentId}:${item.guardianId}`,
      values: customFields,
    });
    return {
      message: 'Guardian linked successfully',
      data: {
        ...item,
        id: `${item.studentId}:${item.guardianId}`,
        customFields: customFields ?? {},
      },
    };
  }

  async recordPromotion(currentUser: CurrentUser, dto: StudentPromotionDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    const studentCampusId = await this.campusAccessService.assertStudentAccess(
      currentUser,
      dto.studentId,
    );

    if (dto.previousClassId) {
      const classCampusId = await this.campusAccessService.assertClassAccess(
        currentUser,
        dto.previousClassId,
      );
      this.assertSameCampus(studentCampusId, classCampusId, 'previous class');
    }

    if (dto.previousSectionId) {
      const sectionCampusId =
        await this.campusAccessService.assertSectionAccess(
          currentUser,
          dto.previousSectionId,
        );
      this.assertSameCampus(
        studentCampusId,
        sectionCampusId,
        'previous section',
      );
    }

    if (dto.newClassId) {
      const classCampusId = await this.campusAccessService.assertClassAccess(
        currentUser,
        dto.newClassId,
      );
      this.assertSameCampus(studentCampusId, classCampusId, 'new class');
    }

    if (dto.newSectionId) {
      const sectionCampusId =
        await this.campusAccessService.assertSectionAccess(
          currentUser,
          dto.newSectionId,
        );
      this.assertSameCampus(studentCampusId, sectionCampusId, 'new section');
    }

    const { customFields, ...promotionFields } = dto;
    const item = await this.prisma.studentHistory.create({
      data: {
        ...promotionFields,
        promotionDate: new Date(dto.promotionDate),
      },
    });
    if (dto.newClassId || dto.newSectionId) {
      await this.prisma.student.update({
        where: { id: dto.studentId },
        data: {
          classId: dto.newClassId,
          sectionId: dto.newSectionId,
        },
      });
    }
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByStudent(
        dto.studentId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.PEOPLE,
      entityType: CustomFieldEntity.STUDENT_HISTORY,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.STUDENT_HISTORY,
    );
    return { message: 'Student promotion recorded successfully', data };
  }

  async assignTeacherSubject(
    currentUser: CurrentUser,
    dto: AssignTeacherSubjectDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    const teacherCampusId =
      await this.campusAccessService.assertStaffProfileAccess(
        currentUser,
        dto.staffProfileId,
      );
    const classCampusId = await this.campusAccessService.assertClassAccess(
      currentUser,
      dto.classId,
    );
    const subjectCampusId = await this.campusAccessService.assertSubjectAccess(
      currentUser,
      dto.subjectId,
    );
    const sectionCampusId = await this.campusAccessService.assertSectionAccess(
      currentUser,
      dto.sectionId,
    );

    this.assertSameCampus(dto.campusId, teacherCampusId, 'teacher');
    this.assertSameCampus(dto.campusId, classCampusId, 'class');
    this.assertSameCampus(dto.campusId, subjectCampusId, 'subject');
    this.assertSameCampus(dto.campusId, sectionCampusId, 'section');

    const section = await this.prisma.section.findUnique({
      where: { id: dto.sectionId },
      select: { classId: true },
    });
    if (!section || section.classId !== dto.classId) {
      throw new ConflictException(
        'The selected section does not belong to the selected class.',
      );
    }

    const existingAssignment = await this.prisma.teacherSubject.findFirst({
      where: {
        staffProfileId: dto.staffProfileId,
        classId: dto.classId,
        subjectId: dto.subjectId,
        sectionId: dto.sectionId,
        campusId: dto.campusId,
      },
    });

    if (existingAssignment) {
      throw new ConflictException(
        'This teacher is already assigned to this subject for the selected section.',
      );
    }

    const { customFields, ...assignmentData } = dto;
    const item = await this.prisma.teacherSubject.create({
      data: assignmentData,
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.PEOPLE,
      entityType: CustomFieldEntity.TEACHER_SUBJECT,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.TEACHER_SUBJECT,
    );
    return { message: 'Teacher subject assigned successfully', data };
  }

  async listTeacherSubjects(currentUser: CurrentUser, campusId?: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const data = await this.prisma.teacherSubject.findMany({
      where:
        currentUser.role === UserRole.SUPERADMIN && !campusId
          ? undefined
          : { campusId: { in: campusIds } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      message: 'Teacher subject assignments retrieved successfully',
      data,
    };
  }

  async removeTeacherSubject(currentUser: CurrentUser, assignmentId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    const existing = await this.prisma.teacherSubject.findUnique({
      where: { id: assignmentId },
    });
    if (!existing) {
      throw new NotFoundException('Teacher subject assignment not found.');
    }
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );
    await this.prisma.teacherSubject.delete({ where: { id: assignmentId } });
    return { message: 'Teacher unassigned successfully', data: existing };
  }

  async unlinkGuardian(currentUser: CurrentUser, linkId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    const link = await this.prisma.studentGuardian.findUnique({
      where: { id: linkId },
      include: { student: { select: { campusId: true } } },
    });
    if (!link) {
      throw new NotFoundException('Guardian link not found.');
    }
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      link.student.campusId,
    );
    await this.prisma.studentGuardian.delete({ where: { id: linkId } });
    return {
      message: 'Guardian unlinked successfully',
      data: {
        id: link.id,
        studentId: link.studentId,
        guardianId: link.guardianId,
      },
    };
  }

  async createContact(currentUser: CurrentUser, dto: CreateContactDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.assertPersonAccess(currentUser, dto.personType, dto.personId);
    const resolvedOwner = buildContactOwnerFields(dto.personType, dto.personId);

    if (!resolvedOwner) {
      throw new ForbiddenException(
        `Unsupported contact person type "${dto.personType}".`,
      );
    }

    const { customFields } = dto;
    const createData: Prisma.ContactUncheckedCreateInput = {
      phone1: dto.phone1,
      phone2: dto.phone2,
      whatsapp: dto.whatsapp,
      address: dto.address,
      personType: resolvedOwner.personType,
      ...resolvedOwner.ownerFields,
    };
    const item = await this.prisma.contact.create({
      data: createData,
    });
    if (resolvedOwner.personType === ContactPersonType.GUARDIAN) {
      // Guardians log in with their phone number (see AuthService.login).
      const guardian = await this.prisma.guardian.findUnique({
        where: { id: resolvedOwner.personId },
        select: { userId: true },
      });
      if (guardian) {
        await this.prisma.user.update({
          where: { id: guardian.userId },
          data: { identifier: dto.phone1 },
        });
      }
    }
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByContact(
        resolvedOwner.personType,
        resolvedOwner.personId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.PEOPLE,
      entityType: CustomFieldEntity.CONTACT,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      {
        ...item,
        personId: resolvedOwner.personId,
      },
      CustomFieldEntity.CONTACT,
    );
    return { message: 'Contact created successfully', data };
  }

  private async assertUserInstitutionAlignment(
    currentUser: CurrentUser,
    userId: string,
    campusId: string,
  ) {
    const [user, institutionId] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, institutionId: true, role: true },
      }),
      this.entityCustomFieldsService.resolveInstitutionIdByCampus(campusId),
    ]);

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (
      currentUser.role !== UserRole.SUPERADMIN &&
      user.role === UserRole.SUPERADMIN
    ) {
      throw new ForbiddenException(
        'You cannot bind superadmin users to records.',
      );
    }

    if (user.institutionId && user.institutionId !== institutionId) {
      throw new ForbiddenException(
        'User must belong to the same institution as the selected campus.',
      );
    }
  }

  private async assertPersonAccess(
    currentUser: CurrentUser,
    personType: string,
    personId: string,
  ) {
    const normalized = normalizeContactPersonType(personType);

    if (normalized === null) {
      throw new ForbiddenException(
        `Unsupported contact person type "${personType}".`,
      );
    }

    if (normalized === ContactPersonType.STUDENT) {
      await this.campusAccessService.assertStudentAccess(currentUser, personId);
      return;
    }

    if (normalized === ContactPersonType.GUARDIAN) {
      await this.campusAccessService.assertGuardianAccess(
        currentUser,
        personId,
      );
      return;
    }

    if (normalized === ContactPersonType.STAFF) {
      await this.campusAccessService.assertStaffProfileAccess(
        currentUser,
        personId,
      );
      return;
    }
  }

  /**
   * Keeps UserCampus in sync with a staff member's home campus. Once every
   * employee has a StaffProfile row, CampusAccessService.getCampusIdsForUser
   * resolves STAFF purely from UserCampus (§ 7.6) — so every staff profile's
   * campus must also be present there, or a staff member with no other
   * UserCampus assignment would end up with zero accessible campuses.
   * Idempotent — mirrors the upsert-on-unique-constraint pattern already
   * used by linkGuardian() for StudentGuardian. When `previousCampusId` is
   * given and differs from `campusId` (a staff profile transfer), the stale
   * assignment for the old campus is permanently removed first — otherwise a
   * transferred employee would keep scoped access to a campus they no
   * longer belong to. This row is genuinely hard-deleted (allowHardDelete),
   * not soft-deleted: it's a pure access grant with no business meaning of
   * its own, UserCampus has no recycle-bin entry to ever surface or purge a
   * soft-deleted row, and the actual transfer history (with a timestamp)
   * already lives in StaffProfile's own audit-log snapshot on the campusId
   * change — keeping an invisible, unpurgeable duplicate here would be pure
   * dead weight (confirmed with Wasim, see M2-PEOPLE-ACADEMIC-DESIGN.md § 7.6).
   *
   * @param {string} userId - The staff member's user id.
   * @param {string} campusId - The staff profile's (new) home campus id.
   * @param {string} [previousCampusId] - The profile's campus id before this update, if it changed.
   * @returns {Promise<void>}
   */
  private async syncUserCampusAssignment(
    userId: string,
    campusId: string,
    previousCampusId?: string,
  ) {
    if (previousCampusId && previousCampusId !== campusId) {
      await this.requestContext.runWith({ allowHardDelete: true }, () =>
        this.prisma.userCampus.deleteMany({
          where: { userId, campusId: previousCampusId },
        }),
      );
    }
    await this.prisma.userCampus.upsert({
      where: {
        userId_campusId_activeScopeKey: {
          userId,
          campusId,
          activeScopeKey: 'ACTIVE',
        },
      },
      create: { userId, campusId },
      update: {},
    });
  }

  private assertSameCampus(
    expectedCampusId: string,
    actualCampusId: string,
    entityLabel: string,
  ) {
    if (expectedCampusId !== actualCampusId) {
      throw new ForbiddenException(
        `${entityLabel} must belong to the same campus as the selected record.`,
      );
    }
  }

  private rethrowUniqueConflict(error: unknown, entityLabel: string): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        `Cannot restore or create this ${entityLabel} because an active record with the same unique values already exists.`,
      );
    }

    throw error;
  }
}
