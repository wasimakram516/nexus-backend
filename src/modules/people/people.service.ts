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
import {
  EnrollmentStatus,
  ModuleKey,
  Prisma,
  UserRole,
  VoucherStatus,
} from '../../prisma/client';
import {
  AssignTeacherSubjectDto,
  CreateContactDto,
  CreateGuardianDto,
  CreateStaffProfileDto,
  CreateStudentDto,
  CreateStudentEnrollmentDto,
  LinkGuardianDto,
  PromotionClassMappingDto,
  PromotionOverrideAction,
  PromotionWizardDto,
  StudentPromotionDto,
  UpdateGuardianDto,
  UpdateStaffProfileDto,
  UpdateStudentDto,
  UpdateStudentEnrollmentDto,
  WithdrawStudentDto,
} from './dto/people.dto';

/** § 7.2 default regNo pattern/settings when no `student_admission`
 *  InstitutionSetting has been configured yet. */
const DEFAULT_REG_NO_PATTERN = '{CAMPUS}-{YEAR}-{SEQ}';
const DEFAULT_REG_NO_SEQ_PADDING = 4;
const DEFAULT_REG_NO_SEQ_SCOPE: 'ALL_TIME' | 'PER_ACADEMIC_YEAR' =
  'PER_ACADEMIC_YEAR';
/** Bounded retry count for a generated regNo that collides on create (§ 7.2). */
const MAX_REG_NO_GENERATION_ATTEMPTS = 5;

/** Computed "current placement" view attached to Student list/detail
 *  responses now that classId/sectionId no longer live on Student itself
 *  (§ 7.5 read-side change). */
export interface CurrentEnrollmentSummary {
  academicYearId: string;
  classId: string;
  className: string;
  sectionId: string | null;
  sectionName: string | null;
  status: EnrollmentStatus;
}

/** One resolved outcome for a single student in a bulk promotion run,
 *  shared between previewPromotion() and commitPromotion() so the two can
 *  never drift apart — same pattern as
 *  FinanceService.buildPayrollBreakdown() being shared by paySalary()/
 *  previewSalary(). */
type PromotionSourceEnrollment = {
  id: string;
  studentId: string;
  classId: string;
  sectionId: string | null;
  student: { id: string; regNo: string };
};

// Each member carries a single literal `outcome` value (rather than e.g.
// 'LEFT' | 'CONFLICT' sharing one shape) so this is a proper discriminated
// union — TypeScript can only narrow on `outcome` (including through
// `Exclude<PromotionResolution, {outcome: 'CONFLICT'}>` in commitPromotion)
// when every member's discriminant is a single literal.
type PromotionResolution =
  | {
      outcome: 'PROMOTED';
      enrollment: PromotionSourceEnrollment;
      toClassId: string;
      toSectionId: string | null;
    }
  | {
      outcome: 'REPEATED';
      enrollment: PromotionSourceEnrollment;
      toClassId: string;
      toSectionId: string | null;
    }
  | { outcome: 'LEFT'; enrollment: PromotionSourceEnrollment }
  | { outcome: 'CONFLICT'; enrollment: PromotionSourceEnrollment };

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

    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    // § 7.5: a deliberate forcing function — you cannot meaningfully admit a
    // student without a session to enroll them into.
    const academicYearId =
      await this.resolveCurrentAcademicYearId(institutionId);
    if (!academicYearId) {
      throw new ConflictException(
        'Set up an academic year before admitting students.',
      );
    }

    const { customFields, classId, sectionId, regNo, ...studentRest } = dto;
    // Prisma DateTime columns reject date-only strings like "2016-06-12".
    const studentData = {
      ...studentRest,
      institutionId,
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

    const persist = (resolvedRegNo: string) => {
      const data = { ...studentData, regNo: resolvedRegNo };
      return deletedStudent
        ? this.prisma.student.update({
            where: { id: deletedStudent.id },
            data: {
              ...data,
              deletedAt: null,
              deletedBy: null,
              deleteReason: null,
            },
          })
        : this.prisma.student.create({ data });
    };

    let item;
    if (regNo) {
      try {
        item = await persist(regNo);
      } catch (error) {
        this.rethrowUniqueConflict(error, 'student');
      }
    } else {
      // § 7.2: regNo omitted -> generate it, retrying on a live collision.
      item = await this.createStudentWithGeneratedRegNo(
        institutionId,
        dto.campusId,
        academicYearId,
        persist,
      );
    }

    // § 7.5: createStudent() only creates the *first* StudentEnrollment row
    // — there's no "previous" state, so no StudentHistory row is written
    // here (matches today's behavior, where admission doesn't write one
    // either). Only created when a class was actually given, preserving the
    // existing optionality of classId/sectionId at admission time — the
    // schema's StudentEnrollment.classId is NOT NULL, so a classless
    // admission simply has no enrollment row yet (currentEnrollment: null)
    // until one is added via POST /people/student-enrollments.
    if (classId) {
      await this.prisma.studentEnrollment.create({
        data: {
          studentId: item.id,
          academicYearId,
          campusId: dto.campusId,
          classId,
          sectionId: sectionId ?? null,
          createdBy: currentUser.sub,
        },
      });
    }

    // Students log in with their registration number (see AuthService.login).
    await this.prisma.user.update({
      where: { id: dto.userId },
      data: { identifier: item.regNo },
    });
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

  /**
   * Advisory, read-only preview of the regNo the next admission at this
   * campus would receive (§ 7.2). The real create path still goes through
   * the unique constraint with retry-on-conflict — this is purely so the
   * frontend can pre-fill the admission form before submit.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} campusId - Campus the student would be admitted at.
   * @returns {Promise<{message: string, data: {suggestedRegNo: string}}>}
   * @throws {ConflictException} If the institution has no current academic year set yet.
   */
  async resolveNextRegNo(currentUser: CurrentUser, campusId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertCampusAccess(currentUser, campusId);
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        campusId,
      );
    const academicYearId =
      await this.resolveCurrentAcademicYearId(institutionId);
    if (!academicYearId) {
      throw new ConflictException(
        'Set up an academic year before admitting students.',
      );
    }
    const suggestedRegNo = await this.generateRegNo(
      institutionId,
      campusId,
      academicYearId,
      0,
    );
    return {
      message: 'Suggested registration number generated successfully',
      data: { suggestedRegNo },
    };
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
    const withEnrollment = await this.attachCurrentEnrollment(items);
    const data = await this.entityCustomFieldsService.attachToItems(
      withEnrollment,
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

    if (!item) {
      throw new NotFoundException('Student not found.');
    }

    const [withEnrollment] = await this.attachCurrentEnrollment([item]);
    const data = await this.entityCustomFieldsService.attachToItem(
      withEnrollment,
      CustomFieldEntity.STUDENT,
    );

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

    // § 7.5, § 10 item 5: class/section changes no longer go through this
    // route at all — UpdateStudentDto has no classId/sectionId (they must
    // go through PATCH /people/student-enrollments/:id instead, which pairs
    // the change with a StudentHistory row).
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

  /**
   * Manual, single-student class/section transfer (§ 7.5). Rewritten in M2
   * Phase 3 to route through `applyEnrollmentTransition` instead of
   * directly patching the now-removed `Student.classId`/`sectionId` — it
   * updates (or, for a student with no enrollment row in the target year
   * yet, creates) the appropriate `StudentEnrollment` row and writes the
   * paired `StudentHistory` row in one transaction. The DTO/route shape is
   * otherwise unchanged from before this phase, plus one new optional
   * `academicYearId` field.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {StudentPromotionDto} dto - Promotion/transfer details.
   * @returns {Promise<{message: string, data: object}>} The created StudentHistory row with attached custom fields.
   * @throws {NotFoundException} If the student doesn't exist, or no academic year can be resolved.
   */
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

    const student = await this.prisma.student.findUnique({
      where: { id: dto.studentId },
      select: { institutionId: true },
    });
    if (!student) {
      throw new NotFoundException('Student not found.');
    }

    const academicYearId =
      dto.academicYearId ??
      (await this.resolveCurrentAcademicYearId(student.institutionId));
    if (!academicYearId) {
      throw new ConflictException(
        'Set up an academic year before recording a promotion.',
      );
    }

    const existingEnrollment = await this.prisma.studentEnrollment.findUnique({
      where: {
        studentId_academicYearId_activeScopeKey: {
          studentId: dto.studentId,
          academicYearId,
          activeScopeKey: 'ACTIVE',
        },
      },
    });

    const { customFields } = dto;
    const promotionDate = new Date(dto.promotionDate);

    const result = await this.prisma.$transaction((tx) =>
      this.applyEnrollmentTransition(tx, {
        studentId: dto.studentId,
        previous: existingEnrollment
          ? {
              enrollmentId: existingEnrollment.id,
              update: {
                classId: dto.newClassId ?? existingEnrollment.classId,
                sectionId: dto.newSectionId ?? existingEnrollment.sectionId,
                updatedBy: currentUser.sub,
              },
            }
          : null,
        // No enrollment row exists yet for this year — create one directly
        // rather than updating, but only if we actually have a class to put
        // the student in (StudentEnrollment.classId is NOT NULL).
        next:
          !existingEnrollment && dto.newClassId
            ? {
                studentId: dto.studentId,
                academicYearId,
                campusId: studentCampusId,
                classId: dto.newClassId,
                sectionId: dto.newSectionId ?? null,
                createdBy: currentUser.sub,
              }
            : null,
        historySnapshot: {
          previousClassId: dto.previousClassId ?? null,
          previousSectionId: dto.previousSectionId ?? null,
          newClassId: dto.newClassId ?? null,
          newSectionId: dto.newSectionId ?? null,
        },
        academicYearId,
        promotionDate,
        promotionReason: dto.promotionReason,
        remarks: dto.remarks,
        createdBy: currentUser.sub,
      }),
    );

    await this.entityCustomFieldsService.saveValues({
      institutionId: student.institutionId,
      moduleKey: ModuleKey.PEOPLE,
      entityType: CustomFieldEntity.STUDENT_HISTORY,
      entityId: result.history.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      result.history,
      CustomFieldEntity.STUDENT_HISTORY,
    );
    return { message: 'Student promotion recorded successfully', data };
  }

  // ---------------------------------------------------------------------
  // M2 Phase 3 — StudentEnrollment CRUD (§ 6.2). Deliberately no custom
  // fields wiring here (§ 8) — that's an explicit fast-follow.
  // ---------------------------------------------------------------------

  async createStudentEnrollment(
    currentUser: CurrentUser,
    dto: CreateStudentEnrollmentDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    const studentCampusId = await this.campusAccessService.assertStudentAccess(
      currentUser,
      dto.studentId,
    );
    const classCampusId = await this.campusAccessService.assertClassAccess(
      currentUser,
      dto.classId,
    );
    this.assertSameCampus(studentCampusId, classCampusId, 'class');

    if (dto.sectionId) {
      const sectionCampusId =
        await this.campusAccessService.assertSectionAccess(
          currentUser,
          dto.sectionId,
        );
      this.assertSameCampus(studentCampusId, sectionCampusId, 'section');
    }

    const [student, academicYear] = await Promise.all([
      this.prisma.student.findUnique({
        where: { id: dto.studentId },
        select: { institutionId: true },
      }),
      this.prisma.academicYear.findUnique({
        where: { id: dto.academicYearId },
        select: { institutionId: true },
      }),
    ]);
    if (!student) {
      throw new NotFoundException('Student not found.');
    }
    if (!academicYear) {
      throw new NotFoundException('Academic year not found.');
    }
    if (academicYear.institutionId !== student.institutionId) {
      throw new ForbiddenException(
        'Academic year must belong to the same institution as the student.',
      );
    }

    let item;
    try {
      item = await this.prisma.studentEnrollment.create({
        data: {
          studentId: dto.studentId,
          academicYearId: dto.academicYearId,
          campusId: studentCampusId,
          classId: dto.classId,
          sectionId: dto.sectionId,
          createdBy: currentUser.sub,
        },
      });
    } catch (error) {
      this.rethrowUniqueConflict(error, 'student enrollment');
    }

    return { message: 'Student enrollment created successfully', data: item };
  }

  async listStudentEnrollments(
    currentUser: CurrentUser,
    filters: {
      studentId?: string;
      academicYearId?: string;
      campusId?: string;
      classId?: string;
      sectionId?: string;
      status?: EnrollmentStatus;
    },
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      filters.campusId,
    );
    const items = await this.prisma.studentEnrollment.findMany({
      where: {
        ...(currentUser.role === UserRole.SUPERADMIN && !filters.campusId
          ? {}
          : { campusId: { in: campusIds } }),
        ...(filters.studentId ? { studentId: filters.studentId } : {}),
        ...(filters.academicYearId
          ? { academicYearId: filters.academicYearId }
          : {}),
        ...(filters.classId ? { classId: filters.classId } : {}),
        ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      message: 'Student enrollments retrieved successfully',
      data: items,
    };
  }

  async getStudentEnrollment(currentUser: CurrentUser, enrollmentId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertEnrollmentAccess(
      currentUser,
      enrollmentId,
    );
    const item = await this.prisma.studentEnrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!item) {
      throw new NotFoundException('Student enrollment not found.');
    }
    return { message: 'Student enrollment retrieved successfully', data: item };
  }

  /**
   * Manual class/section correction or mid-year transfer for one enrollment
   * row (§ 6.2, § 7.5's "Manual mid-year transfer" write path). Updates the
   * same row in place and writes a paired StudentHistory row in one
   * transaction — a no-op call (neither classId nor sectionId given) skips
   * the transaction/history write entirely rather than writing a
   * meaningless "nothing changed" log entry.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} enrollmentId - Enrollment row to update.
   * @param {UpdateStudentEnrollmentDto} dto - New class/section plus an optional reason/remarks for the history row.
   * @returns {Promise<{message: string, data: object}>} The updated enrollment row.
   * @throws {NotFoundException} If the enrollment doesn't exist.
   */
  async updateStudentEnrollment(
    currentUser: CurrentUser,
    enrollmentId: string,
    dto: UpdateStudentEnrollmentDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    const campusId = await this.campusAccessService.assertEnrollmentAccess(
      currentUser,
      enrollmentId,
    );
    const existing = await this.prisma.studentEnrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!existing) {
      throw new NotFoundException('Student enrollment not found.');
    }

    if (dto.classId) {
      const classCampusId = await this.campusAccessService.assertClassAccess(
        currentUser,
        dto.classId,
      );
      this.assertSameCampus(campusId, classCampusId, 'class');
    }

    if (dto.sectionId) {
      const sectionCampusId =
        await this.campusAccessService.assertSectionAccess(
          currentUser,
          dto.sectionId,
        );
      this.assertSameCampus(campusId, sectionCampusId, 'section');
    }

    if (!dto.classId && dto.sectionId === undefined) {
      return {
        message: 'Student enrollment updated successfully',
        data: existing,
      };
    }

    const newClassId = dto.classId ?? existing.classId;
    const newSectionId =
      dto.sectionId !== undefined ? dto.sectionId : existing.sectionId;

    const result = await this.prisma.$transaction((tx) =>
      this.applyEnrollmentTransition(tx, {
        studentId: existing.studentId,
        previous: {
          enrollmentId: existing.id,
          update: {
            classId: newClassId,
            sectionId: newSectionId,
            updatedBy: currentUser.sub,
          },
        },
        next: null,
        historySnapshot: {
          previousClassId: existing.classId,
          previousSectionId: existing.sectionId,
          newClassId,
          newSectionId,
        },
        academicYearId: existing.academicYearId,
        promotionDate: new Date(),
        promotionReason: dto.reason ?? 'Manual transfer',
        remarks: dto.remarks,
        createdBy: currentUser.sub,
      }),
    );

    return {
      message: 'Student enrollment updated successfully',
      data: result.previousEnrollment,
    };
  }

  async deleteStudentEnrollment(
    currentUser: CurrentUser,
    enrollmentId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertEnrollmentAccess(
      currentUser,
      enrollmentId,
    );
    const existing = await this.prisma.studentEnrollment.findUnique({
      where: { id: enrollmentId },
      select: {
        id: true,
        studentId: true,
        academicYearId: true,
        campusId: true,
      },
    });
    if (!existing) {
      throw new NotFoundException('Student enrollment not found.');
    }
    await this.prisma.studentEnrollment.update({
      where: { id: enrollmentId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });
    return {
      message: 'Student enrollment moved to recycle bin successfully',
      data: existing,
    };
  }

  /**
   * Formal withdrawal flow (§ 7.4): a soft gate on outstanding dues, not an
   * unconditional hard block. First call without acknowledgement surfaces
   * the exact outstanding amount as a 409 so the frontend can show it and
   * ask for confirmation; a second call with `acknowledgeOutstandingDues:
   * true` proceeds regardless (the debt itself isn't erased — it just stops
   * accruing new vouchers, enforced separately in
   * FinanceService.createFeeVoucher()).
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} enrollmentId - The current-year enrollment being closed out.
   * @param {WithdrawStudentDto} dto - Withdrawal date/reason and the dues-acknowledgement flag.
   * @returns {Promise<{message: string, data: object}>} The updated (LEFT) enrollment row.
   * @throws {NotFoundException} If the enrollment doesn't exist.
   * @throws {ConflictException} If already LEFT, or dues are outstanding and unacknowledged (with `error.details.outstandingAmount`).
   */
  async withdrawStudent(
    currentUser: CurrentUser,
    enrollmentId: string,
    dto: WithdrawStudentDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertEnrollmentAccess(
      currentUser,
      enrollmentId,
    );

    const enrollment = await this.prisma.studentEnrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment) {
      throw new NotFoundException('Student enrollment not found.');
    }
    if (enrollment.status === EnrollmentStatus.LEFT) {
      throw new ConflictException(
        'This student enrollment has already been marked as left.',
      );
    }

    const outstandingAmount = await this.computeOutstandingDues(
      enrollment.studentId,
    );
    if (outstandingAmount > 0 && !dto.acknowledgeOutstandingDues) {
      throw new ConflictException({
        message: `This student has ${outstandingAmount} in outstanding dues. Resubmit with acknowledgeOutstandingDues: true to withdraw anyway.`,
        outstandingAmount,
      });
    }

    const leftDate = new Date(dto.leftDate);
    const result = await this.prisma.$transaction((tx) =>
      this.applyEnrollmentTransition(tx, {
        studentId: enrollment.studentId,
        previous: {
          enrollmentId: enrollment.id,
          update: {
            status: EnrollmentStatus.LEFT,
            leftDate,
            leftReason: dto.leftReason,
            updatedBy: currentUser.sub,
          },
        },
        next: null,
        historySnapshot: {
          previousClassId: enrollment.classId,
          previousSectionId: enrollment.sectionId,
          newClassId: null,
          newSectionId: null,
        },
        academicYearId: enrollment.academicYearId,
        promotionDate: leftDate,
        promotionReason: 'Withdrawal',
        remarks: dto.leftReason,
        createdBy: currentUser.sub,
      }),
    );

    return {
      message: 'Student withdrawn successfully',
      data: result.previousEnrollment,
    };
  }

  /**
   * Dry-run resolution of a bulk promotion for a single campus/source year
   * against the caller's classMappings + studentOverrides (§ 7.3). No
   * writes — shares `resolvePromotionOutcomes` with `commitPromotion` so
   * preview and commit can never disagree about who ends up where.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {PromotionWizardDto} dto - Campus/year scope, class mappings, and per-student overrides.
   * @returns {Promise<{message: string, data: object}>} `{ totalStudents, byOutcome, perClassBreakdown, conflicts }`.
   */
  async previewPromotion(currentUser: CurrentUser, dto: PromotionWizardDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    await this.assertPromotionYearsAccess(dto);

    const sourceEnrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        campusId: dto.campusId,
        academicYearId: dto.sourceAcademicYearId,
        status: EnrollmentStatus.ACTIVE,
      },
      include: { student: { select: { id: true, regNo: true } } },
    });

    const resolutions = this.resolvePromotionOutcomes(dto, sourceEnrollments);

    const byOutcome = { promoted: 0, repeated: 0, left: 0 };
    const conflicts: Array<{
      studentId: string;
      regNo: string;
      classId: string;
    }> = [];
    const perClassBreakdownMap = new Map<
      string,
      {
        classId: string;
        promoted: number;
        repeated: number;
        left: number;
        conflicts: number;
      }
    >();

    for (const resolution of resolutions) {
      const bucket = perClassBreakdownMap.get(
        resolution.enrollment.classId,
      ) ?? {
        classId: resolution.enrollment.classId,
        promoted: 0,
        repeated: 0,
        left: 0,
        conflicts: 0,
      };

      if (resolution.outcome === 'CONFLICT') {
        bucket.conflicts += 1;
        conflicts.push({
          studentId: resolution.enrollment.studentId,
          regNo: resolution.enrollment.student.regNo,
          classId: resolution.enrollment.classId,
        });
      } else if (resolution.outcome === 'PROMOTED') {
        byOutcome.promoted += 1;
        bucket.promoted += 1;
      } else if (resolution.outcome === 'REPEATED') {
        byOutcome.repeated += 1;
        bucket.repeated += 1;
      } else {
        byOutcome.left += 1;
        bucket.left += 1;
      }

      perClassBreakdownMap.set(resolution.enrollment.classId, bucket);
    }

    return {
      message: 'Promotion preview generated successfully',
      data: {
        totalStudents: sourceEnrollments.length,
        byOutcome,
        perClassBreakdown: Array.from(perClassBreakdownMap.values()),
        conflicts,
      },
    };
  }

  /**
   * Executes the bulk promotion wizard in one transaction (§ 7.3). Every
   * resolvable student (i.e. not a CONFLICT) is transitioned: the
   * source-year enrollment is marked PROMOTED (repeaters included — the
   * repeat semantic lives only in the paired StudentHistory row, per
   * decision #21) or LEFT for leavers, and a target-year ACTIVE enrollment
   * is created unless the outcome is LEFT. Idempotent: a student who
   * already has a targetAcademicYearId enrollment row is skipped, not
   * errored, so an accidental double-submit or a retry after a partial
   * failure is safe to resubmit as-is.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {PromotionWizardDto} dto - Same shape as previewPromotion.
   * @returns {Promise<{message: string, data: object}>} `{ promoted, repeated, left, skippedAlreadyProcessed, conflicts }`.
   */
  async commitPromotion(currentUser: CurrentUser, dto: PromotionWizardDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    await this.assertPromotionYearsAccess(dto);

    const sourceEnrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        campusId: dto.campusId,
        academicYearId: dto.sourceAcademicYearId,
        status: EnrollmentStatus.ACTIVE,
      },
      include: { student: { select: { id: true, regNo: true } } },
    });

    const resolutions = this.resolvePromotionOutcomes(dto, sourceEnrollments);
    const conflicts = resolutions.filter(
      (resolution) => resolution.outcome === 'CONFLICT',
    );
    const processable = resolutions.filter(
      (
        resolution,
      ): resolution is Exclude<PromotionResolution, { outcome: 'CONFLICT' }> =>
        resolution.outcome !== 'CONFLICT',
    );

    const existingTargetEnrollments =
      processable.length > 0
        ? await this.prisma.studentEnrollment.findMany({
            where: {
              academicYearId: dto.targetAcademicYearId,
              studentId: {
                in: processable.map(
                  (resolution) => resolution.enrollment.studentId,
                ),
              },
            },
            select: { studentId: true },
          })
        : [];
    const alreadyProcessedStudentIds = new Set(
      existingTargetEnrollments.map((row) => row.studentId),
    );

    const counts = {
      promoted: 0,
      repeated: 0,
      left: 0,
      skippedAlreadyProcessed: 0,
    };
    const promotionDate = new Date();

    // One transaction for the whole run — either every resolvable student
    // transitions together, or none do (§ 7.3's "commit transaction
    // atomicity" requirement).
    await this.prisma.$transaction(async (tx) => {
      for (const resolution of processable) {
        if (alreadyProcessedStudentIds.has(resolution.enrollment.studentId)) {
          counts.skippedAlreadyProcessed += 1;
          continue;
        }

        if (resolution.outcome === 'LEFT') {
          await this.applyEnrollmentTransition(tx, {
            studentId: resolution.enrollment.studentId,
            previous: {
              enrollmentId: resolution.enrollment.id,
              update: {
                status: EnrollmentStatus.LEFT,
                leftDate: promotionDate,
                leftReason: 'Not promoted to the next academic year',
                updatedBy: currentUser.sub,
              },
            },
            next: null,
            historySnapshot: {
              previousClassId: resolution.enrollment.classId,
              previousSectionId: resolution.enrollment.sectionId,
              newClassId: null,
              newSectionId: null,
            },
            academicYearId: dto.targetAcademicYearId,
            promotionDate,
            promotionReason: 'Not promoted (bulk promotion run)',
            createdBy: currentUser.sub,
          });
          counts.left += 1;
          continue;
        }

        await this.applyEnrollmentTransition(tx, {
          studentId: resolution.enrollment.studentId,
          previous: {
            enrollmentId: resolution.enrollment.id,
            update: {
              status: EnrollmentStatus.PROMOTED,
              updatedBy: currentUser.sub,
            },
          },
          next: {
            studentId: resolution.enrollment.studentId,
            academicYearId: dto.targetAcademicYearId,
            campusId: dto.campusId,
            classId: resolution.toClassId,
            sectionId: resolution.toSectionId,
            status: EnrollmentStatus.ACTIVE,
            createdBy: currentUser.sub,
          },
          historySnapshot: {
            previousClassId: resolution.enrollment.classId,
            previousSectionId: resolution.enrollment.sectionId,
            newClassId: resolution.toClassId,
            newSectionId: resolution.toSectionId,
          },
          academicYearId: dto.targetAcademicYearId,
          promotionDate,
          promotionReason:
            resolution.outcome === 'REPEATED' ? 'Repeated' : 'Promoted',
          createdBy: currentUser.sub,
        });

        if (resolution.outcome === 'REPEATED') {
          counts.repeated += 1;
        } else {
          counts.promoted += 1;
        }
      }
    });

    return {
      message: 'Promotion committed successfully',
      data: {
        ...counts,
        conflicts: conflicts.map((resolution) => ({
          studentId: resolution.enrollment.studentId,
          regNo: resolution.enrollment.student.regNo,
          classId: resolution.enrollment.classId,
        })),
      },
    };
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

  // ---------------------------------------------------------------------
  // M2 Phase 3 private helpers
  // ---------------------------------------------------------------------

  /**
   * Single shared write-path for every StudentEnrollment <-> StudentHistory
   * transition (§ 7.5) — manual transfer, promotion commit, and withdrawal
   * all funnel through this, so "always update StudentEnrollment and write
   * StudentHistory together" lives in one place, not three. `createStudent`
   * is the fourth writer but does NOT call this: there's no "previous"
   * state at admission, so it only creates the first enrollment row
   * directly.
   *
   * @param {Prisma.TransactionClient} tx - Active transaction client.
   * @param {object} params
   * @param {string} params.studentId
   * @param {{enrollmentId: string, update: Prisma.StudentEnrollmentUpdateInput} | null} [params.previous] - The enrollment row being transitioned away from, and how to update it. Omitted only when no prior enrollment row exists yet for the relevant year (a rare manual-transfer edge case).
   * @param {Prisma.StudentEnrollmentUncheckedCreateInput | null} [params.next] - A fresh enrollment row to create, or null when nothing new is created (a transfer that updates one row in place, or a withdrawal/leaver).
   * @param {object} params.historySnapshot - previous/new classId+sectionId recorded verbatim on the StudentHistory row.
   * @param {string | null} params.academicYearId - Recorded on the StudentHistory row.
   * @param {Date} params.promotionDate
   * @param {string | null} [params.promotionReason]
   * @param {string | null} [params.remarks]
   * @param {string | null} [params.createdBy]
   * @returns {Promise<{previousEnrollment: object | null, nextEnrollment: object | null, history: object}>}
   */
  private async applyEnrollmentTransition(
    tx: Prisma.TransactionClient,
    params: {
      studentId: string;
      previous?: {
        enrollmentId: string;
        update: Prisma.StudentEnrollmentUncheckedUpdateInput;
      } | null;
      next?: Prisma.StudentEnrollmentUncheckedCreateInput | null;
      historySnapshot: {
        previousClassId: string | null;
        previousSectionId: string | null;
        newClassId: string | null;
        newSectionId: string | null;
      };
      academicYearId: string | null;
      promotionDate: Date;
      promotionReason?: string | null;
      remarks?: string | null;
      createdBy?: string | null;
    },
  ) {
    const previousEnrollment = params.previous
      ? await tx.studentEnrollment.update({
          where: { id: params.previous.enrollmentId },
          data: params.previous.update,
        })
      : null;

    const nextEnrollment = params.next
      ? await tx.studentEnrollment.create({ data: params.next })
      : null;

    const history = await tx.studentHistory.create({
      data: {
        studentId: params.studentId,
        previousClassId: params.historySnapshot.previousClassId,
        previousSectionId: params.historySnapshot.previousSectionId,
        newClassId: params.historySnapshot.newClassId,
        newSectionId: params.historySnapshot.newSectionId,
        academicYearId: params.academicYearId,
        promotionDate: params.promotionDate,
        promotionReason: params.promotionReason ?? null,
        remarks: params.remarks ?? null,
        createdBy: params.createdBy ?? null,
      },
    });

    return { previousEnrollment, nextEnrollment, history };
  }

  /**
   * Resolves an institution's current academic year id, or null if it
   * hasn't set one yet. Shared by createStudent (a hard precondition),
   * recordPromotion (a soft default), and resolveNextRegNo.
   *
   * @param {string} institutionId - Target institution id.
   * @returns {Promise<string | null>}
   */
  private async resolveCurrentAcademicYearId(
    institutionId: string,
  ): Promise<string | null> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { currentAcademicYearId: true },
    });
    return institution?.currentAcademicYearId ?? null;
  }

  /**
   * Attempts to persist a student with a server-generated regNo, retrying
   * with the next sequence value on a live unique-constraint collision (§
   * 7.2's advisory-preview-vs-real-constraint design) up to a small bounded
   * number of attempts before surfacing a conflict.
   *
   * @param {string} institutionId
   * @param {string} campusId
   * @param {string} academicYearId
   * @param {(regNo: string) => Promise<T>} persist - Creates or reactivates the student with the given regNo.
   * @returns {Promise<T>}
   * @throws {ConflictException} If every attempt collides.
   */
  private async createStudentWithGeneratedRegNo<
    T extends { id: string; regNo: string },
  >(
    institutionId: string,
    campusId: string,
    academicYearId: string,
    persist: (regNo: string) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (
      let attempt = 0;
      attempt < MAX_REG_NO_GENERATION_ATTEMPTS;
      attempt += 1
    ) {
      const regNo = await this.generateRegNo(
        institutionId,
        campusId,
        academicYearId,
        attempt,
      );
      try {
        return await persist(regNo);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    this.rethrowUniqueConflict(lastError, 'student');
  }

  /**
   * Reads the `student_admission` InstitutionSetting (§ 7.2), following the
   * exact existing convention of `recycle_bin.retentionDays` /
   * `payroll.perDayBasis` — same generic settings table, defaults applied
   * when unset or malformed.
   *
   * @param {string} institutionId
   * @returns {Promise<{regNoPattern: string, seqPadding: number, seqScope: 'ALL_TIME' | 'PER_ACADEMIC_YEAR'}>}
   */
  private async resolveRegNoSettings(institutionId: string) {
    const setting = await this.prisma.institutionSetting.findUnique({
      where: {
        institutionId_key_activeScopeKey: {
          institutionId,
          key: 'student_admission',
          activeScopeKey: 'ACTIVE',
        },
      },
      select: { value: true },
    });

    const value = setting?.value as
      | { regNoPattern?: unknown; seqPadding?: unknown; seqScope?: unknown }
      | undefined;

    const regNoPattern =
      typeof value?.regNoPattern === 'string'
        ? value.regNoPattern
        : DEFAULT_REG_NO_PATTERN;
    const seqPadding =
      typeof value?.seqPadding === 'number' && value.seqPadding > 0
        ? value.seqPadding
        : DEFAULT_REG_NO_SEQ_PADDING;
    const seqScope =
      value?.seqScope === 'ALL_TIME'
        ? ('ALL_TIME' as const)
        : DEFAULT_REG_NO_SEQ_SCOPE;

    return { regNoPattern, seqPadding, seqScope };
  }

  /**
   * Resolves the next regNo for a campus/academic year (§ 7.2). Token
   * resolution: `{CAMPUS}` -> Campus.code if set, else the first 3
   * uppercase letters of Campus.name; `{YEAR}` -> the starting year of the
   * given academic year (not calendar year); `{SEQ}` -> a live count of
   * matching students + 1 (+ attemptOffset, for retry-on-conflict),
   * zero-padded. `seqScope: PER_ACADEMIC_YEAR` counts students with an
   * enrollment in `academicYearId`; `ALL_TIME` counts every student in the
   * institution.
   *
   * @param {string} institutionId
   * @param {string} campusId
   * @param {string} academicYearId
   * @param {number} attemptOffset - Added to the live sequence count so a retry after a collision advances past it.
   * @returns {Promise<string>}
   */
  private async generateRegNo(
    institutionId: string,
    campusId: string,
    academicYearId: string,
    attemptOffset: number,
  ): Promise<string> {
    const [{ regNoPattern, seqPadding, seqScope }, campus, academicYear] =
      await Promise.all([
        this.resolveRegNoSettings(institutionId),
        this.prisma.campus.findUnique({
          where: { id: campusId },
          select: { code: true, name: true },
        }),
        this.prisma.academicYear.findUnique({
          where: { id: academicYearId },
          select: { startDate: true },
        }),
      ]);

    const campusToken =
      campus?.code?.trim() ||
      (campus?.name ?? '')
        .replace(/[^a-zA-Z]/g, '')
        .slice(0, 3)
        .toUpperCase() ||
      'CMP';
    const yearToken = academicYear
      ? String(academicYear.startDate.getUTCFullYear()).slice(-2)
      : String(new Date().getUTCFullYear()).slice(-2);

    const seqCount = await this.prisma.student.count({
      where: {
        institutionId,
        ...(seqScope === 'PER_ACADEMIC_YEAR'
          ? { enrollments: { some: { academicYearId } } }
          : {}),
      },
    });
    const seqToken = String(seqCount + 1 + attemptOffset).padStart(
      seqPadding,
      '0',
    );

    return regNoPattern
      .replace('{CAMPUS}', campusToken)
      .replace('{YEAR}', yearToken)
      .replace('{SEQ}', seqToken);
  }

  /**
   * Attaches a computed `currentEnrollment` view to Student rows now that
   * classId/sectionId no longer live on Student itself (§ 7.5 read-side
   * change). Resolved against each student's own institution's current
   * academic year; a student with no matching (non-LEFT) enrollment row —
   * including one whose institution hasn't set a current year yet — gets
   * `currentEnrollment: null`.
   *
   * @template T
   * @param {T[]} items - Student rows, each with at least `id` and `institutionId`.
   * @returns {Promise<Array<T & {currentEnrollment: CurrentEnrollmentSummary | null}>>}
   */
  private async attachCurrentEnrollment<
    T extends { id: string; institutionId: string },
  >(
    items: T[],
  ): Promise<
    Array<T & { currentEnrollment: CurrentEnrollmentSummary | null }>
  > {
    if (!items.length) {
      return [];
    }

    const institutionIds = Array.from(
      new Set(items.map((item) => item.institutionId)),
    );
    const institutions = await this.prisma.institution.findMany({
      where: { id: { in: institutionIds } },
      select: { id: true, currentAcademicYearId: true },
    });
    const currentYearIds = institutions
      .map((institution) => institution.currentAcademicYearId)
      .filter((value): value is string => Boolean(value));

    if (!currentYearIds.length) {
      return items.map((item) => ({ ...item, currentEnrollment: null }));
    }

    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        studentId: { in: items.map((item) => item.id) },
        academicYearId: { in: currentYearIds },
        status: { not: EnrollmentStatus.LEFT },
      },
      include: {
        class: { select: { name: true } },
        section: { select: { name: true } },
      },
    });
    const enrollmentByStudentId = new Map(
      enrollments.map((enrollment) => [enrollment.studentId, enrollment]),
    );

    return items.map((item) => {
      const enrollment = enrollmentByStudentId.get(item.id);
      return {
        ...item,
        currentEnrollment: enrollment
          ? {
              academicYearId: enrollment.academicYearId,
              classId: enrollment.classId,
              className: enrollment.class.name,
              sectionId: enrollment.sectionId,
              sectionName: enrollment.section?.name ?? null,
              status: enrollment.status,
            }
          : null,
      };
    });
  }

  /**
   * Sums outstanding dues across a student's unsettled fee vouchers (§ 7.4):
   * `finalAmountDue - sum(FeePayment.paidAmount)` for every voucher with
   * status PENDING or OVERDUE. `VoucherStatus` has no `PARTIAL` value in
   * this schema yet (that's a P1-3 fast-follow per FOCUS-AREAS.md — partial
   * payments aren't built), so a partially-paid voucher today just stays
   * PENDING/OVERDUE with a smaller remaining balance, which this sum
   * already accounts for.
   *
   * @param {string} studentId
   * @returns {Promise<number>}
   */
  private async computeOutstandingDues(studentId: string): Promise<number> {
    const vouchers = await this.prisma.feeVoucher.findMany({
      where: {
        studentId,
        status: { in: [VoucherStatus.PENDING, VoucherStatus.OVERDUE] },
      },
      include: { payments: { select: { paidAmount: true } } },
    });

    return vouchers.reduce((total, voucher) => {
      const paid = voucher.payments.reduce(
        (sum, payment) => sum + Number(payment.paidAmount),
        0,
      );
      const outstanding = Number(voucher.finalAmountDue) - paid;
      return total + Math.max(0, outstanding);
    }, 0);
  }

  /**
   * Validates that a promotion wizard's campusId/sourceAcademicYearId/
   * targetAcademicYearId all belong to the same institution before any
   * resolution logic runs.
   *
   * @param {PromotionWizardDto} dto
   * @returns {Promise<void>}
   * @throws {NotFoundException} If the campus or either academic year doesn't exist, or a year belongs to a different institution than the campus.
   */
  private async assertPromotionYearsAccess(
    dto: PromotionWizardDto,
  ): Promise<void> {
    const campus = await this.prisma.campus.findUnique({
      where: { id: dto.campusId },
      select: { institutionId: true },
    });
    if (!campus?.institutionId) {
      throw new NotFoundException('Campus not found.');
    }

    const [sourceYear, targetYear] = await Promise.all([
      this.prisma.academicYear.findUnique({
        where: { id: dto.sourceAcademicYearId },
        select: { institutionId: true },
      }),
      this.prisma.academicYear.findUnique({
        where: { id: dto.targetAcademicYearId },
        select: { institutionId: true },
      }),
    ]);

    if (!sourceYear || sourceYear.institutionId !== campus.institutionId) {
      throw new NotFoundException(
        'Source academic year not found for this campus.',
      );
    }
    if (!targetYear || targetYear.institutionId !== campus.institutionId) {
      throw new NotFoundException(
        'Target academic year not found for this campus.',
      );
    }
  }

  /**
   * Resolves every source-year enrollment's promotion outcome against a
   * wizard's classMappings + studentOverrides (§ 7.3). Pure/no writes —
   * shared by previewPromotion and commitPromotion so the two can never
   * disagree, mirroring FinanceService.buildPayrollBreakdown()'s reuse
   * between paySalary/previewSalary.
   *
   * @param {PromotionWizardDto} dto
   * @param {PromotionSourceEnrollment[]} sourceEnrollments
   * @returns {PromotionResolution[]}
   */
  private resolvePromotionOutcomes(
    dto: PromotionWizardDto,
    sourceEnrollments: PromotionSourceEnrollment[],
  ): PromotionResolution[] {
    const classMappingByFromClassId = new Map(
      dto.classMappings.map((mapping) => [mapping.fromClassId, mapping]),
    );
    const overrideByStudentId = new Map(
      (dto.studentOverrides ?? []).map((override) => [
        override.studentId,
        override,
      ]),
    );

    return sourceEnrollments.map((enrollment) => {
      const override = overrideByStudentId.get(enrollment.studentId);

      if (override) {
        if (override.action === PromotionOverrideAction.LEAVE) {
          return { outcome: 'LEFT' as const, enrollment };
        }

        if (override.action === PromotionOverrideAction.REPEAT) {
          return {
            outcome: 'REPEATED' as const,
            enrollment,
            toClassId: override.toClassId ?? enrollment.classId,
            toSectionId: override.toSectionId ?? enrollment.sectionId,
          };
        }

        // PROMOTE override: still falls back to the class mapping's target
        // class if the override itself doesn't specify one.
        const mapping = classMappingByFromClassId.get(enrollment.classId);
        const toClassId = override.toClassId ?? mapping?.toClassId;
        if (!toClassId) {
          return { outcome: 'CONFLICT' as const, enrollment };
        }
        return {
          outcome: 'PROMOTED' as const,
          enrollment,
          toClassId,
          toSectionId:
            override.toSectionId ??
            this.resolveSectionMapping(mapping, enrollment.sectionId),
        };
      }

      const mapping = classMappingByFromClassId.get(enrollment.classId);
      if (!mapping) {
        return { outcome: 'CONFLICT' as const, enrollment };
      }
      if (!mapping.toClassId) {
        return { outcome: 'LEFT' as const, enrollment };
      }
      return {
        outcome: 'PROMOTED' as const,
        enrollment,
        toClassId: mapping.toClassId,
        toSectionId: this.resolveSectionMapping(mapping, enrollment.sectionId),
      };
    });
  }

  /**
   * Resolves a source section into its mapped target section, per a class
   * mapping's `sectionMapping` list. Returns null when there's no section
   * to map (un-sectioned enrollment) or no matching rule.
   *
   * @param {PromotionClassMappingDto} [mapping]
   * @param {string | null} fromSectionId
   * @returns {string | null}
   */
  private resolveSectionMapping(
    mapping: PromotionClassMappingDto | undefined,
    fromSectionId: string | null,
  ): string | null {
    if (!mapping || !fromSectionId) {
      return null;
    }
    const match = mapping.sectionMapping?.find(
      (section) => section.fromSectionId === fromSectionId,
    );
    return match?.toSectionId ?? null;
  }
}
