import { ForbiddenException, Injectable } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class InstitutionConfigService {
  constructor(
    private readonly moduleAccessService: ModuleAccessService,
    private readonly userPermissionsService: UserPermissionsService,
    private readonly prisma: PrismaService,
  ) {}

  async getMyRuntimeConfig(currentUser: CurrentUser) {
    if (!currentUser.institutionId) {
      throw new ForbiddenException(
        'Your account is not linked to an institution.',
      );
    }

    const data = await this.moduleAccessService.getInstitutionRuntimeConfig(
      currentUser.institutionId,
    );

    // null = full access (admin-level roles); otherwise the effective
    // base+override map the frontend uses to gate navigation and actions.
    const permissions =
      await this.userPermissionsService.getEffectivePermissionsForUser(
        currentUser.sub,
      );

    return {
      message: 'Runtime configuration retrieved successfully',
      data: { ...data, permissions },
    };
  }

  async getMyPermissionTemplates(currentUser: CurrentUser) {
    if (!currentUser.institutionId) {
      throw new ForbiddenException(
        'Your account is not linked to an institution.',
      );
    }

    const data = await this.prisma.permissionTemplate.findMany({
      where: { institutionId: currentUser.institutionId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        createdAt: true,
      },
    });

    return {
      message: 'Permission templates retrieved successfully',
      data,
    };
  }
}
