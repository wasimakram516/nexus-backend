import { Controller, Get, UseGuards, Version } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { InstitutionConfigService } from './institution-config.service';

@ApiTags('Institution Config')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('platform/me')
export class InstitutionConfigController {
  constructor(
    private readonly institutionConfigService: InstitutionConfigService,
  ) {}

  @Get('runtime-config')
  @Version('1')
  @ApiOperation({
    summary: 'Get my institution runtime config',
    description:
      'Returns the authenticated user institution configuration that the frontend can use for feature flags, branding, enabled module decisions, and the current user effective permissions.',
  })
  getMyRuntimeConfig(@CurrentUserDecorator() currentUser: CurrentUser) {
    return this.institutionConfigService.getMyRuntimeConfig(currentUser);
  }

  @Get('permission-templates')
  @Version('1')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'List my institution permission templates',
    description:
      'Returns the permission templates of the admin own institution so they can be assigned to staff users.',
  })
  getMyPermissionTemplates(@CurrentUserDecorator() currentUser: CurrentUser) {
    return this.institutionConfigService.getMyPermissionTemplates(currentUser);
  }
}
