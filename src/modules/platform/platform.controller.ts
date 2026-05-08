import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DeleteRecordDto } from '../../common/dto/delete-record.dto';
import { UserRole } from '../../common/enums/domain.enums';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  CreatePlanDto,
  CreateInstitutionDto,
  CreatePermissionTemplateDto,
  ListInstitutionsQueryDto,
  UpdateInstitutionAccessDto,
  UpdatePermissionTemplateDto,
  UpdatePlanDto,
  UpdateBrandingDto,
  UpdateSubscriptionAccessDto,
  UpsertEntitlementsDto,
  UpsertInstitutionSettingsDto,
} from './dto/platform.dto';
import { PlatformService } from './platform.service';

@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
@Controller('platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Post('plans')
  @Version('1')
  @ApiOperation({
    summary: 'Create a subscription plan',
    description:
      'Creates a new platform subscription plan for pricing, entitlements, and institution onboarding flows.',
  })
  createPlan(
    @Body() dto: CreatePlanDto,
    @CurrentUserDecorator() currentUser: CurrentUser,
  ) {
    return this.platformService.createPlan(dto, currentUser);
  }

  @Patch('plans/:planId')
  @Version('1')
  @ApiOperation({
    summary: 'Update a subscription plan',
    description:
      'Updates plan metadata, limits, or pricing-related fields used by institution subscription management.',
  })
  updatePlan(
    @Param('planId') planId: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUserDecorator() currentUser: CurrentUser,
  ) {
    return this.platformService.updatePlan(planId, dto, currentUser);
  }

  @Post('institutions')
  @Version('1')
  @ApiOperation({
    summary: 'Create an institution',
    description:
      'Creates a new institution tenant and prepares it for branding, settings, entitlements, and permission-template setup.',
  })
  createInstitution(
    @Body() dto: CreateInstitutionDto,
    @CurrentUserDecorator() currentUser: CurrentUser,
  ) {
    return this.platformService.createInstitution(dto, currentUser);
  }

  @Get('institutions')
  @Version('1')
  @ApiOperation({
    summary: 'List institutions',
    description:
      'Returns paginated institutions for superadmin administration and tenant management screens.',
  })
  listInstitutions(@Query() query: ListInstitutionsQueryDto) {
    return this.platformService.listInstitutions(query);
  }

  @Get('institutions/:institutionId')
  @Version('1')
  @ApiOperation({
    summary: 'Get an institution',
    description:
      'Returns one institution record for superadmin detail and edit screens.',
  })
  getInstitution(@Param('institutionId') institutionId: string) {
    return this.platformService.getInstitution(institutionId);
  }

  @Get('institutions/:institutionId/runtime-config')
  @Version('1')
  @ApiOperation({
    summary: 'Get institution runtime config',
    description:
      'Returns the resolved runtime configuration for a specific institution from the superadmin scope.',
  })
  getInstitutionRuntimeConfig(@Param('institutionId') institutionId: string) {
    return this.platformService.getInstitutionRuntimeConfig(institutionId);
  }

  @Patch('institutions/:institutionId')
  @Version('1')
  @ApiOperation({
    summary: 'Update institution settings or status',
    description:
      'Use this endpoint to edit institution profile fields or change institution status such as ACTIVE, INACTIVE, or SUSPENDED.',
  })
  updateInstitution(
    @Param('institutionId') institutionId: string,
    @Body() dto: UpdateInstitutionAccessDto,
    @CurrentUserDecorator() currentUser: CurrentUser,
  ) {
    return this.platformService.updateInstitution(
      institutionId,
      dto,
      currentUser,
    );
  }

  @Put('institutions/:institutionId/branding')
  @Version('1')
  @ApiOperation({
    summary: 'Update institution branding',
    description:
      'Updates institution branding fields used by white-label and tenant-facing frontend surfaces.',
  })
  updateBranding(
    @Param('institutionId') institutionId: string,
    @Body() dto: UpdateBrandingDto,
    @CurrentUserDecorator() currentUser: CurrentUser,
  ) {
    return this.platformService.updateBranding(institutionId, dto, currentUser);
  }

  @Put('institutions/:institutionId/settings')
  @Version('1')
  @ApiOperation({
    summary: 'Upsert institution settings',
    description:
      'Creates or updates institution settings such as defaults, policies, and configuration values.',
  })
  upsertSettings(
    @Param('institutionId') institutionId: string,
    @Body() dto: UpsertInstitutionSettingsDto,
    @CurrentUserDecorator() currentUser: CurrentUser,
  ) {
    return this.platformService.upsertSettings(institutionId, dto, currentUser);
  }

  @Put('institutions/:institutionId/entitlements')
  @Version('1')
  @ApiOperation({
    summary: 'Upsert institution entitlements',
    description:
      'Creates or updates institution module and feature entitlements used by runtime access checks.',
  })
  upsertEntitlements(
    @Param('institutionId') institutionId: string,
    @Body() dto: UpsertEntitlementsDto,
    @CurrentUserDecorator() currentUser: CurrentUser,
  ) {
    return this.platformService.upsertEntitlements(
      institutionId,
      dto,
      currentUser,
    );
  }

  @Put('institutions/:institutionId/subscription')
  @Version('1')
  @ApiOperation({
    summary: 'Update institution subscription or status',
    description:
      'Use this endpoint to change the assigned plan, billing details, or subscription status such as TRIAL, ACTIVE, SUSPENDED, or CANCELLED.',
  })
  updateSubscription(
    @Param('institutionId') institutionId: string,
    @Body() dto: UpdateSubscriptionAccessDto,
    @CurrentUserDecorator() currentUser: CurrentUser,
  ) {
    return this.platformService.updateSubscription(
      institutionId,
      dto,
      currentUser,
    );
  }

  @Post('institutions/:institutionId/permission-templates')
  @Version('1')
  @ApiOperation({
    summary: 'Create a permission template',
    description:
      'Creates a reusable permission template for an institution so admins can apply consistent access presets.',
  })
  createPermissionTemplate(
    @Param('institutionId') institutionId: string,
    @Body() dto: CreatePermissionTemplateDto,
    @CurrentUserDecorator() currentUser: CurrentUser,
  ) {
    return this.platformService.createPermissionTemplate(
      institutionId,
      dto,
      currentUser,
    );
  }

  @Get('institutions/:institutionId/permission-templates')
  @Version('1')
  @ApiOperation({
    summary: 'List permission templates',
    description:
      'Returns permission templates for an institution to power role and access-management screens.',
  })
  listPermissionTemplates(@Param('institutionId') institutionId: string) {
    return this.platformService.listPermissionTemplates(institutionId);
  }

  @Get('institutions/:institutionId/permission-templates/:templateId')
  @Version('1')
  @ApiOperation({
    summary: 'Get a permission template',
    description:
      'Returns one permission template for inspection, editing, or assignment workflows.',
  })
  getPermissionTemplate(
    @Param('institutionId') institutionId: string,
    @Param('templateId') templateId: string,
  ) {
    return this.platformService.getPermissionTemplate(
      institutionId,
      templateId,
    );
  }

  @Patch('institutions/:institutionId/permission-templates/:templateId')
  @Version('1')
  @ApiOperation({
    summary: 'Update a permission template',
    description:
      'Updates an existing permission template while preserving the institution scope.',
  })
  updatePermissionTemplate(
    @Param('institutionId') institutionId: string,
    @Param('templateId') templateId: string,
    @Body() dto: UpdatePermissionTemplateDto,
    @CurrentUserDecorator() currentUser: CurrentUser,
  ) {
    return this.platformService.updatePermissionTemplate(
      institutionId,
      templateId,
      dto,
      currentUser,
    );
  }

  @Delete('institutions/:institutionId/permission-templates/:templateId')
  @Version('1')
  @ApiOperation({
    summary: 'Soft-delete a permission template',
    description:
      'Moves a permission template to the recycle bin instead of permanently removing it immediately.',
  })
  deletePermissionTemplate(
    @Param('institutionId') institutionId: string,
    @Param('templateId') templateId: string,
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.platformService.deletePermissionTemplate(
      institutionId,
      templateId,
      currentUser,
      dto.reason,
    );
  }
}
