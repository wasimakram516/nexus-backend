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
import { CreateRoleDto, UpdateRoleDto } from '../roles/dto/roles.dto';
import { RolesService } from '../roles/roles.service';
import {
  CreatePlanDto,
  CreateInstitutionDto,
  ListInstitutionsQueryDto,
  UpdateInstitutionAccessDto,
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
  constructor(
    private readonly platformService: PlatformService,
    private readonly rolesService: RolesService,
  ) {}

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

  @Post('institutions/:institutionId/roles')
  @Version('1')
  @ApiOperation({
    summary: 'Create a role',
    description:
      'Superadmin escape hatch to create a role for any institution. Institution admins use POST /roles instead.',
  })
  createRole(
    @Param('institutionId') institutionId: string,
    @Body() dto: CreateRoleDto,
    @CurrentUserDecorator() currentUser: CurrentUser,
  ) {
    return this.rolesService.createRole(institutionId, dto, currentUser);
  }

  @Get('institutions/:institutionId/roles')
  @Version('1')
  @ApiOperation({
    summary: 'List roles',
    description: 'Returns roles for an institution from the platform scope.',
  })
  listRoles(@Param('institutionId') institutionId: string) {
    return this.rolesService.listRoles(institutionId);
  }

  @Get('institutions/:institutionId/roles/:roleId')
  @Version('1')
  @ApiOperation({
    summary: 'Get a role',
    description: 'Returns one role for inspection or editing.',
  })
  getRole(
    @Param('institutionId') institutionId: string,
    @Param('roleId') roleId: string,
  ) {
    return this.rolesService.getRole(institutionId, roleId);
  }

  @Patch('institutions/:institutionId/roles/:roleId')
  @Version('1')
  @ApiOperation({
    summary: 'Update a role',
    description:
      'Updates an existing role while preserving the institution scope.',
  })
  updateRole(
    @Param('institutionId') institutionId: string,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUserDecorator() currentUser: CurrentUser,
  ) {
    return this.rolesService.updateRole(
      institutionId,
      roleId,
      dto,
      currentUser,
    );
  }

  @Delete('institutions/:institutionId/roles/:roleId')
  @Version('1')
  @ApiOperation({
    summary: 'Soft-delete a role',
    description:
      'Moves a role to the recycle bin instead of permanently removing it immediately.',
  })
  deleteRole(
    @Param('institutionId') institutionId: string,
    @Param('roleId') roleId: string,
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.rolesService.deleteRole(
      institutionId,
      roleId,
      currentUser,
      dto.reason,
    );
  }
}
