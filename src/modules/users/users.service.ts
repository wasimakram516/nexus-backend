import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { UpdateProfileDto, UpdateUserRoleDto } from './dto/users.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly requestContext: RequestContextService,
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
    return { message: 'Profile retrieved successfully', data: user };
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

    await this.auditLogService.log(currentUser, {
      action: 'USER_PROFILE_UPDATED',
      entity: 'User',
      entityId: currentUser.sub,
      institutionId: user.institutionId,
      metadata: {
        updatedFields: Object.keys(dto),
      },
    });

    return { message: 'Profile updated successfully', data: user };
  }

  async listUsers(currentUser: CurrentUser, query: PaginationQueryDto) {
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
      ...(currentUser.role === UserRole.ADMIN && currentUser.institutionId
        ? { institutionId: currentUser.institutionId }
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
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      message: 'Users retrieved successfully',
      data: { items, total, page: query.page, limit: query.limit },
    };
  }

  async updateUserRole(
    currentUser: CurrentUser,
    userId: string,
    dto: UpdateUserRoleDto,
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

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        deletedAt: true,
        institutionId: true,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'USER_ACCESS_UPDATED',
      entity: 'User',
      entityId: userId,
      institutionId: user.institutionId,
      metadata: {
        role: dto.role,
        status: dto.status,
      },
    });

    return { message: 'User updated successfully', data: user };
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

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: target.status,
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), deletedBy: currentUser.sub, deleteReason: reason ?? null, updatedBy: currentUser.sub },
    });

    await this.auditLogService.log(currentUser, {
      action: 'USER_DELETED',
      entity: 'User',
      entityId: userId,
      institutionId: target.institutionId,
      metadata: {
        email: target.email,
        role: target.role,
        status: target.status,
        reason: reason ?? null,
      },
    });

    return { message: 'User moved to recycle bin successfully', data: null };
  }
}
