import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../../common/services/audit-log.service';
import { Prisma, SubscriptionStatus, UserRole } from '../../prisma/client';
import {
  DEFAULT_PLAN_KEY,
  getPlanBlueprint,
} from '../../common/constants/plan.constants';
import { CustomFieldEntity } from '../../common/constants/custom-field-entities.constants';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { ModuleKey } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  AssignUserCampusDto,
  CreateCampusDto,
  RemoveUserCampusDto,
  UpdateCampusDto,
} from './dto/campuses.dto';

@Injectable()
export class CampusesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly campusAccessService: CampusAccessService,
    private readonly entityCustomFieldsService: EntityCustomFieldsService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly requestContext: RequestContextService,
  ) {}

  async createCampus(currentUser: CurrentUser, dto: CreateCampusDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    const institutionId = this.resolveInstitutionId(
      currentUser,
      dto.institutionId,
    );
    await this.ensureInstitutionExists(institutionId);
    await this.assertCampusLimit(institutionId);
    const { customFields, ...campusData } = dto;
    const campus = await this.prisma.campus.create({
      data: {
        ...campusData,
        institutionId,
      },
    });
    await this.entityCustomFieldsService.saveValues({
      institutionId,
      moduleKey: ModuleKey.ACADEMICS,
      entityType: CustomFieldEntity.CAMPUS,
      entityId: campus.id,
      values: customFields,
    });
    const data = await this.entityCustomFieldsService.attachToItem(
      campus,
      CustomFieldEntity.CAMPUS,
    );

    await this.auditLogService.log(currentUser, {
      action: 'CAMPUS_CREATED',
      entity: 'Campus',
      entityId: campus.id,
      institutionId,
      metadata: {
        name: campus.name,
      },
    });

    return { message: 'Campus created successfully', data };
  }

  async listCampuses(currentUser: CurrentUser, query: PaginationQueryDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    const campusIds =
      await this.campusAccessService.getCampusIdsForUser(currentUser);
    const skip = (query.page! - 1) * query.limit!;
    const where =
      currentUser.role === UserRole.SUPERADMIN
        ? { deletedAt: null }
        : currentUser.role === UserRole.ADMIN && currentUser.institutionId
          ? {
              deletedAt: null,
              institutionId: currentUser.institutionId,
            }
          : {
              deletedAt: null,
              id: { in: campusIds },
            };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.campus.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.campus.count({ where }),
    ]);

    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.CAMPUS,
    );

    return {
      message: 'Campuses retrieved successfully',
      data: { items: data, total, page: query.page, limit: query.limit },
    };
  }

  async updateCampus(
    currentUser: CurrentUser,
    campusId: string,
    dto: UpdateCampusDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertCampusAccess(currentUser, campusId);
    const { customFields, ...campusData } = dto;
    const campus = await this.prisma.campus.update({
      where: { id: campusId },
      data: campusData,
    });
    if (customFields) {
      const institutionId =
        await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
          campusId,
        );
      await this.entityCustomFieldsService.saveValues({
        institutionId,
        moduleKey: ModuleKey.ACADEMICS,
        entityType: CustomFieldEntity.CAMPUS,
        entityId: campusId,
        values: customFields,
      });
    }
    const data = await this.entityCustomFieldsService.attachToItem(
      campus,
      CustomFieldEntity.CAMPUS,
    );

    await this.auditLogService.log(currentUser, {
      action: 'CAMPUS_UPDATED',
      entity: 'Campus',
      entityId: campusId,
      institutionId: campus.institutionId,
      metadata: {
        updatedFields: Object.keys(dto),
      },
    });

    return { message: 'Campus updated successfully', data };
  }

  async deleteCampus(
    currentUser: CurrentUser,
    campusId: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertCampusAccess(currentUser, campusId);
    const campus = await this.prisma.campus.findUnique({
      where: { id: campusId },
      select: { id: true, name: true, institutionId: true, deletedAt: true },
    });

    if (!campus || campus.deletedAt) {
      throw new NotFoundException('Campus not found.');
    }

    await this.prisma.campus.update({
      where: { id: campusId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'CAMPUS_DELETED',
      entity: 'Campus',
      entityId: campusId,
      institutionId: campus.institutionId,
      metadata: {
        name: campus.name,
        reason: reason ?? null,
      },
    });

    return {
      message: 'Campus moved to recycle bin successfully',
      data: campus,
    };
  }

  async assignUser(currentUser: CurrentUser, dto: AssignUserCampusDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    const campus = await this.prisma.campus.findUnique({
      where: { id: dto.campusId },
    });
    if (!user || user.deletedAt || !campus || campus.deletedAt) {
      throw new NotFoundException('User or campus not found.');
    }
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    this.assertInstitutionAlignment(currentUser, campus.institutionId);

    if (user.institutionId && user.institutionId !== campus.institutionId) {
      throw new ConflictException(
        'User and campus must belong to the same institution.',
      );
    }

    const record = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        if (!user.institutionId && campus.institutionId) {
          await tx.user.update({
            where: { id: dto.userId },
            data: {
              institutionId: campus.institutionId,
            },
          });
        }

        const deletedAssignment = await tx.userCampus.findFirst({
          where: {
            userId: dto.userId,
            campusId: dto.campusId,
            deletedAt: {
              not: null,
            },
          },
        });

        if (deletedAssignment) {
          return tx.userCampus.update({
            where: { id: deletedAssignment.id },
            data: {
              deletedAt: null,
              deletedBy: null,
              deleteReason: null,
            },
          });
        }

        const existingAssignment = await tx.userCampus.findFirst({
          where: {
            userId: dto.userId,
            campusId: dto.campusId,
          },
        });

        if (existingAssignment) {
          return existingAssignment;
        }

        return tx.userCampus.create({
          data: dto,
        });
      },
    );

    await this.auditLogService.log(currentUser, {
      action: 'CAMPUS_USER_ASSIGNED',
      entity: 'UserCampus',
      entityId: `${dto.userId}:${dto.campusId}`,
      institutionId: campus.institutionId,
      metadata: {
        userId: dto.userId,
        campusId: dto.campusId,
      },
    });

    return { message: 'User assigned to campus successfully', data: record };
  }

  async getCampusUsers(currentUser: CurrentUser, campusId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertCampusAccess(currentUser, campusId);
    const users = await this.prisma.userCampus.findMany({
      where: {
        campusId,
        user: {
          deletedAt: null,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
          },
        },
      },
    });

    return { message: 'Campus users retrieved successfully', data: users };
  }

  async removeUser(currentUser: CurrentUser, dto: RemoveUserCampusDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ACADEMICS,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    const assignment = await this.prisma.userCampus.findFirst({
      where: {
        userId: dto.userId,
        campusId: dto.campusId,
      },
    });

    if (!assignment) {
      throw new NotFoundException('User-campus assignment not found.');
    }

    await this.prisma.userCampus.delete({
      where: {
        id: assignment.id,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'CAMPUS_USER_REMOVED',
      entity: 'UserCampus',
      entityId: `${dto.userId}:${dto.campusId}`,
      institutionId: currentUser.institutionId ?? null,
      metadata: {
        userId: dto.userId,
        campusId: dto.campusId,
      },
    });

    return {
      message: 'User removed from campus successfully',
      data: assignment,
    };
  }

  private resolveInstitutionId(
    currentUser: CurrentUser,
    requestedInstitutionId: string,
  ) {
    if (currentUser.role === UserRole.SUPERADMIN) {
      return requestedInstitutionId;
    }

    if (!currentUser.institutionId) {
      throw new ForbiddenException(
        'Your account is not linked to an institution.',
      );
    }

    if (requestedInstitutionId !== currentUser.institutionId) {
      throw new ForbiddenException(
        'You can only manage campuses for your own institution.',
      );
    }

    return currentUser.institutionId;
  }

  private async assertCampusLimit(institutionId: string) {
    const subscription = await this.prisma.institutionSubscription.findFirst({
      where: {
        institutionId,
        status: {
          in: [
            SubscriptionStatus.TRIAL,
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PAST_DUE,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        plan: {
          select: {
            key: true,
            limits: true,
          },
        },
      },
    });
    const setting = await this.prisma.institutionSetting.findUnique({
      where: {
        institutionId_key_activeScopeKey: {
          institutionId,
          key: 'limits',
          activeScopeKey: 'ACTIVE',
        },
      },
      select: {
        value: true,
      },
    });

    const maxCampuses =
      this.readMaxCampusesOverride(setting?.value) ??
      this.readMaxCampusesOverride(subscription?.metadata) ??
      this.readMaxCampusesOverride(subscription?.plan?.limits) ??
      getPlanBlueprint(subscription?.plan?.key ?? DEFAULT_PLAN_KEY)?.limits
        .maxCampuses;

    if (maxCampuses === undefined || maxCampuses === null) {
      return;
    }

    const campusCount = await this.prisma.campus.count({
      where: { institutionId, deletedAt: null },
    });

    if (campusCount >= maxCampuses) {
      throw new ForbiddenException(
        `Campus limit reached for this institution. Current limit: ${maxCampuses}.`,
      );
    }
  }

  private async ensureInstitutionExists(institutionId: string) {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true },
    });

    if (!institution) {
      throw new NotFoundException('Institution not found.');
    }
  }

  private assertInstitutionAlignment(
    currentUser: CurrentUser,
    campusInstitutionId: string | null,
  ) {
    if (
      currentUser.role !== UserRole.SUPERADMIN &&
      currentUser.institutionId !== campusInstitutionId
    ) {
      throw new ForbiddenException(
        'You can only manage campuses within your own institution.',
      );
    }
  }

  private readMaxCampusesOverride(
    value: Prisma.JsonValue | null | undefined,
  ): number | null | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, Prisma.JsonValue>;

    const directLimit = record.maxCampuses;
    if (directLimit === null) {
      return null;
    }
    if (typeof directLimit === 'number' && Number.isFinite(directLimit)) {
      return directLimit;
    }

    const limits = record.limits;
    if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
      return undefined;
    }

    const nestedRecord = limits as Record<string, Prisma.JsonValue>;
    const nestedLimit = nestedRecord.maxCampuses;
    if (nestedLimit === null) {
      return null;
    }
    if (typeof nestedLimit === 'number' && Number.isFinite(nestedLimit)) {
      return nestedLimit;
    }

    return undefined;
  }
}
