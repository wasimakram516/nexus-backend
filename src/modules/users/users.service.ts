import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
// UpdateUserAccessDto.role is typed against this hand-maintained mirror;
// everything else here (CurrentUser, DB rows) is Prisma-typed — same values,
// nominally distinct TS enums, so comparisons against dto.role need this alias.
import { UserRole as DtoUserRole } from '../../common/enums/domain.enums';
import { CustomFieldEntity } from '../../common/constants/custom-field-entities.constants';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  ListUsersQueryDto,
  UpdateProfileDto,
  UpdateUserAccessDto,
} from './dto/users.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entityCustomFieldsService: EntityCustomFieldsService,
    private readonly requestContext: RequestContextService,
    private readonly userPermissionsService: UserPermissionsService,
  ) {}

  async getProfile(currentUser: CurrentUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: currentUser.sub },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        deletedAt: true,
        institutionId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found.');
    }
    const data = await this.entityCustomFieldsService.attachToItem(
      user,
      CustomFieldEntity.USER,
    );
    return { message: 'Profile retrieved successfully', data };
  }

  async updateProfile(currentUser: CurrentUser, dto: UpdateProfileDto) {
    const payload: { name?: string; email?: string; passwordHash?: string } =
      {};
    if (dto.name) payload.name = dto.name;
    if (dto.email) payload.email = dto.email.toLowerCase();
    if (dto.password)
      payload.passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.update({
      where: { id: currentUser.sub },
      data: payload,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        deletedAt: true,
        institutionId: true,
        updatedAt: true,
      },
    });

    // Audited automatically by PrismaService (real before/after snapshot,
    // with passwordHash redacted) — no bespoke AuditLogService call needed.
    return { message: 'Profile updated successfully', data: user };
  }

  async listUsers(currentUser: CurrentUser, query: ListUsersQueryDto) {
    const skip = (query.page! - 1) * query.limit!;
    const where = {
      deletedAt: null,
      ...(query.search
        ? {
            OR: [
              {
                name: { contains: query.search, mode: 'insensitive' as const },
              },
              {
                email: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
      ...(query.role ? { role: query.role } : {}),
      // Every non-SUPERADMIN caller — institution ADMIN or a STAFF user
      // holding a `users.read` grant — is locked to their own institution.
      // Only SUPERADMIN can cross institutions (and only via an explicit filter).
      ...(currentUser.role !== UserRole.SUPERADMIN && currentUser.institutionId
        ? { institutionId: currentUser.institutionId }
        : currentUser.role === UserRole.SUPERADMIN && query.institutionId
          ? { institutionId: query.institutionId }
          : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          institutionId: true,
          roleId: true,
          permissionOverrides: true,
          assignedRole: { select: { name: true } },
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const attachedItems = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.USER,
    );
    return {
      message: 'Users retrieved successfully',
      data: {
        items: attachedItems,
        total,
        page: query.page,
        limit: query.limit,
      },
    };
  }

  /**
   * Resolves user IDs to display names for the record-metadata popover
   * (createdBy/updatedBy on any entity). No `users.read` grant required —
   * unlike listUsers, this only ever returns a name/email for IDs the
   * caller already legitimately encountered on a record they can see, not
   * a browsable directory. Still institution-scoped so it can't be used to
   * probe for user existence in other institutions.
   */
  async resolveUsers(currentUser: CurrentUser, ids: string[]) {
    const uniqueIds = Array.from(new Set(ids)).slice(0, 100);
    if (uniqueIds.length === 0) {
      return { message: 'Users resolved successfully', data: {} };
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: uniqueIds },
        ...(currentUser.role !== UserRole.SUPERADMIN &&
        currentUser.institutionId
          ? { institutionId: currentUser.institutionId }
          : {}),
      },
      select: { id: true, name: true, email: true },
    });

    const data = Object.fromEntries(
      users.map((user) => [user.id, { name: user.name, email: user.email }]),
    );

    return { message: 'Users resolved successfully', data };
  }

  async updateUserRole(
    currentUser: CurrentUser,
    userId: string,
    dto: UpdateUserAccessDto,
  ) {
    if (currentUser.sub === userId) {
      throw new ForbiddenException('You cannot update your own role.');
    }

    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.deletedAt) {
      throw new NotFoundException('User not found.');
    }
    if (
      currentUser.role === UserRole.ADMIN &&
      target.role === UserRole.SUPERADMIN
    ) {
      throw new ForbiddenException('Admins cannot update superadmin users.');
    }
    if (
      currentUser.role === UserRole.ADMIN &&
      currentUser.institutionId &&
      target.institutionId !== currentUser.institutionId
    ) {
      throw new ForbiddenException(
        'Admins can only manage users within their institution.',
      );
    }

    // A caller reaching this point without being ADMIN/SUPERADMIN got here
    // via an explicit `users.update` grant on a delegated Role (see
    // UsersController). That grant is never trusted with admin-adjacent
    // accounts or cross-institution reach the way institution ADMIN is.
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.SUPERADMIN
    ) {
      if (target.institutionId !== currentUser.institutionId) {
        throw new ForbiddenException(
          'You can only manage users within your institution.',
        );
      }
      if (
        target.role === UserRole.ADMIN ||
        target.role === UserRole.SUPERADMIN
      ) {
        throw new ForbiddenException('You cannot modify admin-level users.');
      }
      if (
        dto.role === DtoUserRole.ADMIN ||
        dto.role === DtoUserRole.SUPERADMIN
      ) {
        throw new ForbiddenException('You cannot assign admin-level roles.');
      }
    }

    const { customFields } = dto;
    const updateData: Prisma.UserUncheckedUpdateInput = {};
    if (dto.role !== undefined) updateData.role = dto.role;
    if (dto.status !== undefined) updateData.status = dto.status;

    const touchesPermissions =
      dto.roleId !== undefined || dto.permissionOverrides !== undefined;
    if (touchesPermissions) {
      const resultingRole = dto.role ?? target.role;
      if (
        resultingRole === UserRole.ADMIN ||
        resultingRole === UserRole.SUPERADMIN
      ) {
        throw new BadRequestException(
          'Roles and overrides cannot be applied to admin-level users — they already have full institution access.',
        );
      }
    }

    if (dto.roleId !== undefined) {
      if (dto.roleId === null) {
        updateData.roleId = null;
      } else {
        const role = await this.prisma.role.findFirst({
          where: {
            id: dto.roleId,
            deletedAt: null,
            ...(target.institutionId
              ? { institutionId: target.institutionId }
              : {}),
          },
          select: { id: true },
        });
        if (!role) {
          throw new BadRequestException('Role not found for this institution.');
        }
        updateData.roleId = role.id;
      }
    }

    if (dto.permissionOverrides !== undefined) {
      updateData.permissionOverrides =
        dto.permissionOverrides === null
          ? Prisma.DbNull
          : this.userPermissionsService.sanitizeOverrides(
              dto.permissionOverrides,
            );
    }

    // A user profile is institution-wide, not campus-scoped (§ M4.5 / P1-2a
    // corrective milestone) — unlike every other custom-field entity, a
    // target with no institutionId (e.g. a SUPERADMIN account) simply has
    // no institution context to attach custom field values under, so
    // custom fields are silently skipped for that case rather than wired
    // through EntityCustomFieldsService.saveRecord (which requires one).
    const selectShape = {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      deletedAt: true,
      institutionId: true,
      roleId: true,
      permissionOverrides: true,
      assignedRole: { select: { name: true } },
    } as const;

    const user = target.institutionId
      ? await this.entityCustomFieldsService.saveRecord(
          {
            institutionId: target.institutionId,
            moduleKey: ModuleKey.PEOPLE,
            entityType: CustomFieldEntity.USER,
            values: customFields,
            create: false,
          },
          (transaction) =>
            transaction.user.update({
              where: { id: userId },
              data: updateData,
              select: selectShape,
            }),
        )
      : await this.prisma.user.update({
          where: { id: userId },
          data: updateData,
          select: selectShape,
        });

    // Audited automatically by PrismaService (real before/after snapshot)
    // — no bespoke AuditLogService call needed here.
    const data = await this.entityCustomFieldsService.attachToItem(
      user,
      CustomFieldEntity.USER,
    );
    return { message: 'User updated successfully', data };
  }

  async deleteUser(currentUser: CurrentUser, userId: string, reason?: string) {
    if (currentUser.sub === userId) {
      throw new ForbiddenException('You cannot delete your own account.');
    }

    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.deletedAt) {
      throw new NotFoundException('User not found.');
    }
    if (
      currentUser.role === UserRole.ADMIN &&
      (target.role === UserRole.SUPERADMIN ||
        target.institutionId !== currentUser.institutionId)
    ) {
      throw new ForbiddenException(
        'Admins can only delete users within their institution.',
      );
    }

    // Same delegated-role rail as updateUserRole: a `users.delete` grant on
    // a custom Role can only reach STAFF/STUDENT/GUARDIAN accounts in the
    // caller's own institution — never admin-level accounts.
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.SUPERADMIN &&
      (target.role === UserRole.ADMIN ||
        target.role === UserRole.SUPERADMIN ||
        target.institutionId !== currentUser.institutionId)
    ) {
      throw new ForbiddenException(
        'You can only delete users within your institution, excluding admin-level accounts.',
      );
    }

    // A single update (previously two — the first set `status` to its own
    // current value, a no-op) so the soft delete produces exactly one
    // audit entry, not a spurious extra UPDATED one ahead of it. Audited
    // automatically by PrismaService (real before/after snapshot) — no
    // bespoke AuditLogService call needed here.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: target.status,
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    return { message: 'User moved to recycle bin successfully', data: null };
  }
}
