import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '../../prisma/client';
import { PERMISSION_CATALOG } from '../../common/constants/permission-catalog.constant';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import { UpdateBrandingDto } from './dto/platform.dto';
import { PlatformService } from './platform.service';

@Injectable()
export class InstitutionConfigService {
  constructor(
    private readonly moduleAccessService: ModuleAccessService,
    private readonly userPermissionsService: UserPermissionsService,
    private readonly platformService: PlatformService,
  ) {}

  /**
   * An institution administrator changes their own school's look. It is the
   * platform console's update, checked the same way, for the caller's own
   * institution only.
   *
   * @param {CurrentUser} currentUser - The signed-in administrator.
   * @param {UpdateBrandingDto} dto - The colours, theme, name and logo.
   * @returns {Promise<{message: string, data: object}>} The saved branding.
   * @throws {ForbiddenException} If the caller is not an administrator with an institution.
   */
  async updateMyBranding(currentUser: CurrentUser, dto: UpdateBrandingDto) {
    if (currentUser.role !== UserRole.ADMIN || !currentUser.institutionId) {
      throw new ForbiddenException(
        'Only an institution administrator can change the school’s branding.',
      );
    }
    return this.platformService.updateBranding(currentUser.institutionId, dto);
  }

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
      // permissionCatalog is static reference data (not institution-scoped)
      // so the Roles checkbox grid and permission override UI never need to
      // hardcode a copy that can drift from the backend's enforcement list.
      data: { ...data, permissions, permissionCatalog: PERMISSION_CATALOG },
    };
  }
}
