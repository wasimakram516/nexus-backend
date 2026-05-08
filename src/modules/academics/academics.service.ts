import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomFieldEntity } from '../../common/constants/custom-field-entities.constants';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ModuleKey, UserRole } from '../../prisma/client';
import {
  CreateClassDto,
  CreateLevelDto,
  CreateSectionDto,
  CreateSubjectDto,
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
    await this.requestContext.runWith({ deleteReason: reason ?? null }, () =>
      this.prisma.level.delete({ where: { id: levelId } }),
    );
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
    await this.requestContext.runWith({ deleteReason: reason ?? null }, () =>
      this.prisma.academicClass.delete({ where: { id: classId } }),
    );
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
    await this.requestContext.runWith({ deleteReason: reason ?? null }, () =>
      this.prisma.section.delete({ where: { id: sectionId } }),
    );
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
    await this.requestContext.runWith({ deleteReason: reason ?? null }, () =>
      this.prisma.subject.delete({ where: { id: subjectId } }),
    );
    return {
      message: 'Subject moved to recycle bin successfully',
      data: existing,
    };
  }
}
