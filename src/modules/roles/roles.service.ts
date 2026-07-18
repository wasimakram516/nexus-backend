import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/roles.dto';

/**
 * Institution-defined Role CRUD, shared by the institution-scoped `/roles`
 * controller (ADMIN) and the superadmin `/platform/institutions/:id/roles`
 * controller — the underlying data and rules are identical, only who is
 * allowed to call them (and how institutionId is derived) differs.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly userPermissionsService: UserPermissionsService,
  ) {}

  async createRole(
    institutionId: string,
    dto: CreateRoleDto,
    currentUser: CurrentUser,
  ) {
    await this.ensureInstitutionExists(institutionId);
    const permissions = this.userPermissionsService.sanitizeRolePermissions(
      dto.permissions,
    );

    try {
      const role = await this.prisma.role.create({
        data: {
          institutionId,
          name: dto.name,
          description: dto.description,
          permissions: permissions,
        },
      });

      await this.auditLogService.log(currentUser, {
        action: 'ROLE_CREATED',
        entity: 'Role',
        entityId: role.id,
        institutionId,
        metadata: { name: dto.name },
      });

      return { message: 'Role created successfully', data: role };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A role with this name already exists.');
      }
      throw error;
    }
  }

  async listRoles(institutionId: string) {
    await this.ensureInstitutionExists(institutionId);

    const items = await this.prisma.role.findMany({
      where: { institutionId },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });

    return { message: 'Roles retrieved successfully', data: items };
  }

  async getRole(institutionId: string, roleId: string) {
    await this.ensureInstitutionExists(institutionId);
    const role = await this.getRoleOrThrow(institutionId, roleId);
    return { message: 'Role retrieved successfully', data: role };
  }

  async updateRole(
    institutionId: string,
    roleId: string,
    dto: UpdateRoleDto,
    currentUser: CurrentUser,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.getRoleOrThrow(institutionId, roleId);

    const permissions =
      dto.permissions !== undefined
        ? this.userPermissionsService.sanitizeRolePermissions(dto.permissions)
        : undefined;

    try {
      const role = await this.prisma.role.update({
        where: { id: roleId },
        data: {
          name: dto.name,
          description: dto.description,
          permissions: permissions
            ? (permissions as Prisma.InputJsonValue)
            : undefined,
        },
      });

      await this.auditLogService.log(currentUser, {
        action: 'ROLE_UPDATED',
        entity: 'Role',
        entityId: role.id,
        institutionId,
        metadata: { updatedFields: Object.keys(dto) },
      });

      return { message: 'Role updated successfully', data: role };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A role with this name already exists.');
      }
      throw error;
    }
  }

  async deleteRole(
    institutionId: string,
    roleId: string,
    currentUser: CurrentUser,
    reason?: string,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.getRoleOrThrow(institutionId, roleId);

    await this.prisma.role.update({
      where: { id: roleId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'ROLE_DELETED',
      entity: 'Role',
      entityId: roleId,
      institutionId,
      metadata: { reason: reason ?? null },
    });

    return {
      message: 'Role moved to recycle bin successfully',
      data: { id: roleId },
    };
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

  private async getRoleOrThrow(institutionId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, institutionId },
    });
    if (!role) {
      throw new NotFoundException('Role not found.');
    }
    return role;
  }
}
