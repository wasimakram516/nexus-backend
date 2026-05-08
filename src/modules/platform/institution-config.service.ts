import { ForbiddenException, Injectable } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ModuleAccessService } from '../../common/services/module-access.service';

@Injectable()
export class InstitutionConfigService {
  constructor(private readonly moduleAccessService: ModuleAccessService) {}

  async getMyRuntimeConfig(currentUser: CurrentUser) {
    if (!currentUser.institutionId) {
      throw new ForbiddenException(
        'Your account is not linked to an institution.',
      );
    }

    const data = await this.moduleAccessService.getInstitutionRuntimeConfig(
      currentUser.institutionId,
    );

    return {
      message: 'Runtime configuration retrieved successfully',
      data,
    };
  }
}
