import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomFieldEntity } from '../../common/constants/custom-field-entities.constants';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import {
  AcademicYearCampusOverrideInputDto,
  CreateAcademicYearDto,
  CreateClassDto,
  CreateLevelDto,
  CreateSectionDto,
  CreateSubjectDto,
  UpdateAcademicYearDto,
  UpdateClassDto,
  UpdateLevelDto,
  UpdateSectionDto,
  UpdateSubjectDto,
} from './dto/academics.dto';

@Injectable()
export class AcademicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campusAccessService: CampusAccessService,
    private readonly entityCustomFieldsService: EntityCustomFieldsService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly requestContext: RequestContextService,
  ) {}

  async createLevel(currentUser: CurrentUser, dto: CreateLevelDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    const { customFields, ...levelData } = dto;
    const level = await this.prisma.level.create({ data: levelData });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        dto.campusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.ACADEMICS,
      entityType: CustomFieldEntity.LEVEL,
      entityId: level.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      level,
      CustomFieldEntity.LEVEL,
    );
    return { message: 'Level created successfully', data };
  }

  async listLevels(currentUser: CurrentUser, campusId?: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      campusId,
    );
    const levels = await this.prisma.level.findMany({
      where:
        currentUser.role === UserRole.SUPERADMIN && !campusId
          ? undefined
          : { campusId: { in: campusIds } },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      levels,
      CustomFieldEntity.LEVEL,
    );
    return { message: 'Levels retrieved successfully', data };
  }

  async getLevel(currentUser: CurrentUser, levelId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertLevelAccess(currentUser, levelId);

    const level = await this.prisma.level.findUnique({
      where: { id: levelId },
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      level,
      CustomFieldEntity.LEVEL,
    );

    if (!data) {
      throw new NotFoundException('Level not found.');
    }

    return { message: 'Level retrieved successfully', data };
  }

  async updateLevel(
    currentUser: CurrentUser,
    levelId: string,
    dto: UpdateLevelDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );

    const existing = await this.prisma.level.findUnique({
      where: { id: levelId },
    });

    if (!existing) {
      throw new NotFoundException('Level not found.');
    }

    await this.campusAccessService.assertLevelAccess(currentUser, levelId);
    const targetCampusId = dto.campusId ?? existing.campusId;
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      targetCampusId,
    );

    const { customFields, ...levelData } = dto;
    const level = await this.prisma.level.update({
      where: { id: levelId },
      data: levelData,
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        targetCampusId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.ACADEMICS,
      entityType: CustomFieldEntity.LEVEL,
      entityId: level.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      level,
      CustomFieldEntity.LEVEL,
    );
    return { message: 'Level updated successfully', data };
  }

  async deleteLevel(
    currentUser: CurrentUser,
    levelId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertLevelAccess(currentUser, levelId);
    const existing = await this.prisma.level.findUnique({
      where: { id: levelId },
      select: { id: true, campusId: true, name: true },
    });
    if (!existing) throw new NotFoundException('Level not found.');
    await this.prisma.level.update({
      where: { id: levelId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });
    return {
      message: 'Level moved to recycle bin successfully',
      data: existing,
    };
  }

  async createClass(currentUser: CurrentUser, dto: CreateClassDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertLevelAccess(currentUser, dto.levelId);
    const { customFields, ...classData } = dto;
    const item = await this.prisma.academicClass.create({ data: classData });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByLevel(
        dto.levelId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.ACADEMICS,
      entityType: CustomFieldEntity.CLASS,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.CLASS,
    );
    return { message: 'Class created successfully', data };
  }

  async listClasses(currentUser: CurrentUser, levelId?: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    if (levelId) {
      await this.campusAccessService.assertLevelAccess(currentUser, levelId);
    }

    const campusIds =
      currentUser.role === UserRole.SUPERADMIN
        ? undefined
        : await this.campusAccessService.getCampusIdsForUser(currentUser);
    const items = await this.prisma.academicClass.findMany({
      where: {
        ...(levelId ? { levelId } : {}),
        ...(campusIds ? { level: { campusId: { in: campusIds } } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.CLASS,
    );
    return { message: 'Classes retrieved successfully', data };
  }

  async getClass(currentUser: CurrentUser, classId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertClassAccess(currentUser, classId);

    const item = await this.prisma.academicClass.findUnique({
      where: { id: classId },
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.CLASS,
    );

    if (!data) {
      throw new NotFoundException('Class not found.');
    }

    return { message: 'Class retrieved successfully', data };
  }

  async updateClass(
    currentUser: CurrentUser,
    classId: string,
    dto: UpdateClassDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );

    const existing = await this.prisma.academicClass.findUnique({
      where: { id: classId },
    });

    if (!existing) {
      throw new NotFoundException('Class not found.');
    }

    await this.campusAccessService.assertClassAccess(currentUser, classId);
    const targetLevelId = dto.levelId ?? existing.levelId;
    await this.campusAccessService.assertLevelAccess(
      currentUser,
      targetLevelId,
    );

    const { customFields, ...classData } = dto;
    const item = await this.prisma.academicClass.update({
      where: { id: classId },
      data: classData,
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByLevel(
        targetLevelId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.ACADEMICS,
      entityType: CustomFieldEntity.CLASS,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.CLASS,
    );
    return { message: 'Class updated successfully', data };
  }

  async deleteClass(
    currentUser: CurrentUser,
    classId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertClassAccess(currentUser, classId);
    const existing = await this.prisma.academicClass.findUnique({
      where: { id: classId },
      select: { id: true, levelId: true, name: true },
    });
    if (!existing) throw new NotFoundException('Class not found.');
    await this.prisma.academicClass.update({
      where: { id: classId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });
    return {
      message: 'Class moved to recycle bin successfully',
      data: existing,
    };
  }

  async createSection(currentUser: CurrentUser, dto: CreateSectionDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertClassAccess(currentUser, dto.classId);
    const { customFields, ...sectionData } = dto;
    const item = await this.prisma.section.create({ data: sectionData });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByClass(
        dto.classId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.ACADEMICS,
      entityType: CustomFieldEntity.SECTION,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.SECTION,
    );
    return { message: 'Section created successfully', data };
  }

  async listSections(currentUser: CurrentUser, classId?: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    if (classId) {
      await this.campusAccessService.assertClassAccess(currentUser, classId);
    }

    const campusIds =
      currentUser.role === UserRole.SUPERADMIN
        ? undefined
        : await this.campusAccessService.getCampusIdsForUser(currentUser);
    const items = await this.prisma.section.findMany({
      where: {
        ...(classId ? { classId } : {}),
        ...(campusIds
          ? { class: { level: { campusId: { in: campusIds } } } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.SECTION,
    );
    return { message: 'Sections retrieved successfully', data };
  }

  async getSection(currentUser: CurrentUser, sectionId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertSectionAccess(currentUser, sectionId);

    const item = await this.prisma.section.findUnique({
      where: { id: sectionId },
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.SECTION,
    );

    if (!data) {
      throw new NotFoundException('Section not found.');
    }

    return { message: 'Section retrieved successfully', data };
  }

  async updateSection(
    currentUser: CurrentUser,
    sectionId: string,
    dto: UpdateSectionDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );

    const existing = await this.prisma.section.findUnique({
      where: { id: sectionId },
    });

    if (!existing) {
      throw new NotFoundException('Section not found.');
    }

    await this.campusAccessService.assertSectionAccess(currentUser, sectionId);
    const targetClassId = dto.classId ?? existing.classId;
    await this.campusAccessService.assertClassAccess(
      currentUser,
      targetClassId,
    );

    const { customFields, ...sectionData } = dto;
    const item = await this.prisma.section.update({
      where: { id: sectionId },
      data: sectionData,
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByClass(
        targetClassId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.ACADEMICS,
      entityType: CustomFieldEntity.SECTION,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.SECTION,
    );
    return { message: 'Section updated successfully', data };
  }

  async deleteSection(
    currentUser: CurrentUser,
    sectionId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertSectionAccess(currentUser, sectionId);
    const existing = await this.prisma.section.findUnique({
      where: { id: sectionId },
      select: { id: true, classId: true, name: true },
    });
    if (!existing) throw new NotFoundException('Section not found.');
    await this.prisma.section.update({
      where: { id: sectionId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });
    return {
      message: 'Section moved to recycle bin successfully',
      data: existing,
    };
  }

  async createSubject(currentUser: CurrentUser, dto: CreateSubjectDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertClassAccess(currentUser, dto.classId);
    const { customFields, ...subjectData } = dto;
    const item = await this.prisma.subject.create({ data: subjectData });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByClass(
        dto.classId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.ACADEMICS,
      entityType: CustomFieldEntity.SUBJECT,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.SUBJECT,
    );
    return { message: 'Subject created successfully', data };
  }

  async listSubjects(currentUser: CurrentUser, classId?: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    if (classId) {
      await this.campusAccessService.assertClassAccess(currentUser, classId);
    }

    const campusIds =
      currentUser.role === UserRole.SUPERADMIN
        ? undefined
        : await this.campusAccessService.getCampusIdsForUser(currentUser);
    const items = await this.prisma.subject.findMany({
      where: {
        ...(classId ? { classId } : {}),
        ...(campusIds
          ? { class: { level: { campusId: { in: campusIds } } } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.SUBJECT,
    );
    return { message: 'Subjects retrieved successfully', data };
  }

  async getSubject(currentUser: CurrentUser, subjectId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertSubjectAccess(currentUser, subjectId);

    const item = await this.prisma.subject.findUnique({
      where: { id: subjectId },
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.SUBJECT,
    );

    if (!data) {
      throw new NotFoundException('Subject not found.');
    }

    return { message: 'Subject retrieved successfully', data };
  }

  async updateSubject(
    currentUser: CurrentUser,
    subjectId: string,
    dto: UpdateSubjectDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );

    const existing = await this.prisma.subject.findUnique({
      where: { id: subjectId },
    });

    if (!existing) {
      throw new NotFoundException('Subject not found.');
    }

    await this.campusAccessService.assertSubjectAccess(currentUser, subjectId);
    const targetClassId = dto.classId ?? existing.classId;
    await this.campusAccessService.assertClassAccess(
      currentUser,
      targetClassId,
    );

    const { customFields, ...subjectData } = dto;
    const item = await this.prisma.subject.update({
      where: { id: subjectId },
      data: subjectData,
    });
    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByClass(
        targetClassId,
      );
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.ACADEMICS,
      entityType: CustomFieldEntity.SUBJECT,
      entityId: item.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.SUBJECT,
    );
    return { message: 'Subject updated successfully', data };
  }

  async deleteSubject(
    currentUser: CurrentUser,
    subjectId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertSubjectAccess(currentUser, subjectId);
    const existing = await this.prisma.subject.findUnique({
      where: { id: subjectId },
      select: { id: true, classId: true, name: true },
    });
    if (!existing) throw new NotFoundException('Subject not found.');
    await this.prisma.subject.update({
      where: { id: subjectId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });
    return {
      message: 'Subject moved to recycle bin successfully',
      data: existing,
    };
  }

  /**
   * Create an institution-wide academic year, optionally with per-campus
   * date overrides created in the same transaction.
   *
   * `institutionId` is always an explicit caller-supplied parameter, never
   * derived from `currentUser` inside this service — same shape as
   * `RolesService`, shared by the institution-scoped `/academics/academic-years`
   * controller (which resolves it from the JWT) and the superadmin
   * `/platform/institutions/:institutionId/academic-years` mirror (which
   * takes it straight from the path param).
   *
   * @param {string} institutionId - Target institution id.
   * @param {CreateAcademicYearDto} dto - Name, start/end dates, optional campus overrides.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<{message: string, data: object}>} The created academic year with its overrides.
   * @throws {NotFoundException} If the institution does not exist.
   * @throws {ForbiddenException} If the caller lacks campus access for an override, or a campus belongs to a different institution.
   * @throws {ConflictException} If an active academic year with the same name already exists for the institution.
   */
  async createAcademicYear(
    institutionId: string,
    dto: CreateAcademicYearDto,
    currentUser: CurrentUser,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.assertCampusOverridesAccess(
      currentUser,
      institutionId,
      dto.campusOverrides,
    );

    try {
      const data = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const created = await tx.academicYear.create({
            data: {
              institutionId,
              name: dto.name,
              startDate: new Date(dto.startDate),
              endDate: new Date(dto.endDate),
            },
          });

          if (dto.campusOverrides?.length) {
            await tx.academicYearCampusOverride.createMany({
              data: dto.campusOverrides.map((override) => ({
                academicYearId: created.id,
                campusId: override.campusId,
                startDate: override.startDate
                  ? new Date(override.startDate)
                  : null,
                endDate: override.endDate ? new Date(override.endDate) : null,
              })),
            });
          }

          return tx.academicYear.findUnique({
            where: { id: created.id },
            include: { campusOverrides: true },
          });
        },
      );

      return {
        message: 'Academic year created successfully',
        data: { ...data, isCurrent: false },
      };
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  /**
   * List every academic year for an institution, flagging which one is
   * currently active.
   *
   * @param {string} institutionId - Target institution id.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<{message: string, data: object[]}>} Academic years with `isCurrent` and `campusOverrides`.
   * @throws {NotFoundException} If the institution does not exist.
   */
  async listAcademicYears(institutionId: string, currentUser: CurrentUser) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );

    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { currentAcademicYearId: true },
    });

    const years = await this.prisma.academicYear.findMany({
      where: { institutionId },
      include: { campusOverrides: true },
      orderBy: { startDate: 'desc' },
    });

    const data = years.map((year) => ({
      ...year,
      isCurrent: year.id === institution?.currentAcademicYearId,
    }));

    return { message: 'Academic years retrieved successfully', data };
  }

  /**
   * Resolve an institution's current academic year, applying a per-campus
   * date override when one exists and a campus is given. Implements the
   * single resolver described in design doc § 7.1.
   *
   * @param {string} institutionId - Target institution id.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} [campusId] - Optional campus to resolve effective dates for.
   * @returns {Promise<{message: string, data: object}>} `{ academicYear, effectiveStartDate, effectiveEndDate, isOverridden }`.
   * @throws {NotFoundException} If the institution does not exist, or has not set a current academic year yet.
   * @throws {ForbiddenException} If a non-admin caller requests a campus they cannot act at.
   */
  async getCurrentAcademicYear(
    institutionId: string,
    currentUser: CurrentUser,
    campusId?: string,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );

    if (
      campusId &&
      currentUser.role !== UserRole.SUPERADMIN &&
      currentUser.role !== UserRole.ADMIN
    ) {
      await this.campusAccessService.assertCampusAccess(currentUser, campusId);
    }

    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { currentAcademicYearId: true },
    });

    if (!institution?.currentAcademicYearId) {
      throw new NotFoundException(
        'This institution has not set a current academic year yet.',
      );
    }

    const academicYear = await this.prisma.academicYear.findUnique({
      where: { id: institution.currentAcademicYearId },
    });

    if (!academicYear) {
      throw new NotFoundException(
        'This institution has not set a current academic year yet.',
      );
    }

    let effectiveStartDate = academicYear.startDate;
    let effectiveEndDate = academicYear.endDate;
    let isOverridden = false;

    if (campusId) {
      const override = await this.prisma.academicYearCampusOverride.findFirst({
        where: { academicYearId: academicYear.id, campusId },
      });

      if (override?.startDate) {
        effectiveStartDate = override.startDate;
        isOverridden = true;
      }
      if (override?.endDate) {
        effectiveEndDate = override.endDate;
        isOverridden = true;
      }
    }

    return {
      message: 'Current academic year retrieved successfully',
      data: {
        academicYear,
        effectiveStartDate,
        effectiveEndDate,
        isOverridden,
      },
    };
  }

  /**
   * Get one academic year belonging to a given institution.
   *
   * @param {string} institutionId - Target institution id.
   * @param {string} academicYearId - Target academic year id.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<{message: string, data: object}>} The academic year with `isCurrent` and `campusOverrides`.
   * @throws {NotFoundException} If the institution does not exist, or the year doesn't exist or belongs to another institution.
   */
  async getAcademicYear(
    institutionId: string,
    academicYearId: string,
    currentUser: CurrentUser,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );

    const year = await this.prisma.academicYear.findUnique({
      where: { id: academicYearId },
      include: { campusOverrides: true },
    });

    if (!year || year.institutionId !== institutionId) {
      throw new NotFoundException('Academic year not found.');
    }

    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { currentAcademicYearId: true },
    });

    return {
      message: 'Academic year retrieved successfully',
      data: {
        ...year,
        isCurrent: year.id === institution?.currentAcademicYearId,
      },
    };
  }

  /**
   * Update an academic year's name/dates and, when `campusOverrides` is
   * provided, replace all of its campus date overrides in one transaction.
   * `campusOverrides` left `undefined` leaves existing overrides untouched.
   *
   * @param {string} institutionId - Target institution id.
   * @param {string} academicYearId - Target academic year id.
   * @param {UpdateAcademicYearDto} dto - Partial update payload.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<{message: string, data: object}>} The updated academic year with its overrides.
   * @throws {NotFoundException} If the institution does not exist, or the year doesn't exist or belongs to another institution.
   * @throws {ForbiddenException} If the caller lacks campus access for an override, or a campus belongs to a different institution.
   * @throws {ConflictException} If the rename collides with another active academic year name.
   */
  async updateAcademicYear(
    institutionId: string,
    academicYearId: string,
    dto: UpdateAcademicYearDto,
    currentUser: CurrentUser,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );

    const existing = await this.prisma.academicYear.findUnique({
      where: { id: academicYearId },
    });

    if (!existing || existing.institutionId !== institutionId) {
      throw new NotFoundException('Academic year not found.');
    }

    await this.assertCampusOverridesAccess(
      currentUser,
      institutionId,
      dto.campusOverrides,
    );

    try {
      const data = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          await tx.academicYear.update({
            where: { id: academicYearId },
            data: {
              name: dto.name,
              startDate: dto.startDate ? new Date(dto.startDate) : undefined,
              endDate: dto.endDate ? new Date(dto.endDate) : undefined,
            },
          });

          if (dto.campusOverrides !== undefined) {
            await this.replaceCampusOverrides(
              tx,
              academicYearId,
              currentUser,
              dto.campusOverrides,
            );
          }

          return tx.academicYear.findUnique({
            where: { id: academicYearId },
            include: { campusOverrides: true },
          });
        },
      );

      const institution = await this.prisma.institution.findUnique({
        where: { id: institutionId },
        select: { currentAcademicYearId: true },
      });

      return {
        message: 'Academic year updated successfully',
        data: {
          ...data,
          isCurrent: data?.id === institution?.currentAcademicYearId,
        },
      };
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  /**
   * Flip an institution's current academic year pointer.
   *
   * @param {string} institutionId - Target institution id.
   * @param {string} academicYearId - Academic year to become current.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<{message: string, data: {id: string}}>} Confirmation payload.
   * @throws {NotFoundException} If the institution or the academic year does not exist.
   * @throws {ForbiddenException} If the year belongs to another institution.
   */
  async setCurrentAcademicYear(
    institutionId: string,
    academicYearId: string,
    currentUser: CurrentUser,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );

    const year = await this.prisma.academicYear.findUnique({
      where: { id: academicYearId },
      select: { id: true, institutionId: true },
    });

    if (!year) {
      throw new NotFoundException('Academic year not found.');
    }

    if (year.institutionId !== institutionId) {
      throw new ForbiddenException(
        'You cannot set the current academic year for another institution.',
      );
    }

    await this.prisma.institution.update({
      where: { id: institutionId },
      data: { currentAcademicYearId: academicYearId },
    });

    return {
      message: 'Current academic year updated successfully',
      data: { id: academicYearId },
    };
  }

  /**
   * Soft-delete an academic year. Blocked while it is the institution's
   * current academic year to avoid orphaning the "current session" selector.
   *
   * @param {string} institutionId - Target institution id.
   * @param {string} academicYearId - Target academic year id.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} [reason] - Optional recycle-bin delete reason.
   * @returns {Promise<{message: string, data: object}>} The deleted record's identifying fields.
   * @throws {NotFoundException} If the institution or the academic year does not exist (or belongs to another institution).
   * @throws {ConflictException} If this is the institution's current academic year.
   */
  async deleteAcademicYear(
    institutionId: string,
    academicYearId: string,
    currentUser: CurrentUser,
    reason?: string,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );

    const existing = await this.prisma.academicYear.findUnique({
      where: { id: academicYearId },
      select: { id: true, institutionId: true, name: true },
    });

    if (!existing || existing.institutionId !== institutionId) {
      throw new NotFoundException('Academic year not found.');
    }

    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { currentAcademicYearId: true },
    });

    if (institution?.currentAcademicYearId === academicYearId) {
      throw new ConflictException(
        "This is the institution's current academic year. Switch the current academic year before deleting this one.",
      );
    }

    await this.prisma.academicYear.update({
      where: { id: academicYearId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return {
      message: 'Academic year moved to recycle bin successfully',
      data: existing,
    };
  }

  /**
   * Verify the caller may act at every campus referenced by a set of
   * campus-override inputs, before any writes happen, and that each
   * referenced campus actually belongs to the target institution.
   *
   * The institution-match check matters specifically for the superadmin
   * platform-mirror path (`/platform/institutions/:institutionId/academic-years`):
   * `CampusAccessService.getCampusIdsForUser` grants SUPERADMIN every campus
   * across every institution, so without this explicit check a SUPERADMIN
   * acting on Institution B's academic year could accidentally attach a
   * campus override that belongs to Institution C. A non-superadmin's own
   * accessible-campus list is already institution-scoped by
   * `CampusAccessService`, so this check is a no-op on that path.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} institutionId - The target institution id (the academic year being created/updated).
   * @param {AcademicYearCampusOverrideInputDto[]} [overrides] - Override inputs to validate.
   * @returns {Promise<void>}
   * @throws {ForbiddenException} If the caller cannot act at one of the referenced campuses, or a campus belongs to a different institution.
   */
  private async assertCampusOverridesAccess(
    currentUser: CurrentUser,
    institutionId: string,
    overrides?: AcademicYearCampusOverrideInputDto[],
  ): Promise<void> {
    for (const override of overrides ?? []) {
      await this.campusAccessService.assertCampusAccess(
        currentUser,
        override.campusId,
      );

      const campus = await this.prisma.campus.findUnique({
        where: { id: override.campusId },
        select: { institutionId: true },
      });

      if (!campus || campus.institutionId !== institutionId) {
        throw new ForbiddenException(
          "Campus override targets a campus outside the academic year's institution.",
        );
      }
    }
  }

  /**
   * Replace all campus date overrides for one academic year: existing rows
   * are soft-deleted with a rotated `activeScopeKey` (freeing the
   * `[academicYearId, campusId, activeScopeKey]` unique slot for reuse —
   * there is no existing "replace child rows" precedent elsewhere in this
   * codebase to mirror, so this delete-then-recreate is written fresh for
   * this relation only), then the incoming overrides are created fresh.
   *
   * @param {Prisma.TransactionClient} tx - Active transaction client.
   * @param {string} academicYearId - Parent academic year id.
   * @param {CurrentUser} currentUser - Authenticated caller, recorded as the deleter of superseded rows.
   * @param {AcademicYearCampusOverrideInputDto[]} overrides - The full replacement set (may be empty to clear all overrides).
   * @returns {Promise<void>}
   */
  private async replaceCampusOverrides(
    tx: Prisma.TransactionClient,
    academicYearId: string,
    currentUser: CurrentUser,
    overrides: AcademicYearCampusOverrideInputDto[],
  ): Promise<void> {
    const existingOverrides = await tx.academicYearCampusOverride.findMany({
      where: { academicYearId },
      select: { id: true },
    });

    await Promise.all(
      existingOverrides.map((row) =>
        tx.academicYearCampusOverride.update({
          where: { id: row.id },
          data: {
            deletedAt: new Date(),
            deletedBy: currentUser.sub,
            deleteReason: 'Superseded by academic year update',
            updatedBy: currentUser.sub,
            activeScopeKey: `REPLACED-${row.id}`,
          },
        }),
      ),
    );

    if (overrides.length) {
      await tx.academicYearCampusOverride.createMany({
        data: overrides.map((override) => ({
          academicYearId,
          campusId: override.campusId,
          startDate: override.startDate ? new Date(override.startDate) : null,
          endDate: override.endDate ? new Date(override.endDate) : null,
        })),
      });
    }
  }

  /**
   * Guard every AcademicYear method against acting on a nonexistent
   * institution — `institutionId` always arrives as an explicit parameter
   * now (from the JWT via the regular controller, or from the path param on
   * the superadmin platform mirror), so this is the one place that verifies
   * it actually resolves to a real row. Mirrors
   * `RolesService.ensureInstitutionExists`.
   *
   * @param {string} institutionId - Institution id to verify.
   * @returns {Promise<void>}
   * @throws {NotFoundException} If the institution does not exist.
   */
  private async ensureInstitutionExists(institutionId: string): Promise<void> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true },
    });

    if (!institution) {
      throw new NotFoundException('Institution not found.');
    }
  }

  /**
   * Convert a Prisma unique-constraint violation on academic year writes
   * into a friendly 409, matching the `rethrowUniqueConflict` pattern used
   * in `people.service.ts` and the inline P2002 handling in `roles.service.ts`.
   *
   * @param {unknown} error - The caught error.
   * @returns {never}
   * @throws {ConflictException} If the error is a Prisma P2002 unique violation.
   */
  private rethrowUniqueConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'An academic year with this name already exists for your institution.',
      );
    }

    throw error;
  }
}
