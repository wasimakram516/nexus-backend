import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PERMISSION_CATALOG } from '../../common/constants/permission-catalog.constant';
import { MODULE_CATALOG } from '../../common/constants/module-catalog.constant';
import { DeleteRecordDto } from '../../common/dto/delete-record.dto';
import { UserRole } from '../../common/enums/domain.enums';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CreateRoleDto, UpdateRoleDto } from './dto/roles.dto';
import { RolesService } from './roles.service';

/**
 * Institution-scoped Role management. Deliberately ADMIN-only per the
 * locked design: custom roles can be assigned to STAFF/STUDENT/GUARDIAN
 * users, but creating/editing the roles themselves stays with the
 * institution ADMIN (no delegation, no "roles" entry in the permission
 * catalog) — a "Campus Admin" is a full-permission Role, not a user who can
 * edit other roles.
 */
@ApiTags('Roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @Version('1')
  @ApiOperation({
    summary: 'Create a role',
    description:
      'Creates an institution-scoped role with a feature x action permission matrix, assignable to STAFF/STUDENT/GUARDIAN users.',
  })
  createRole(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateRoleDto,
  ) {
    return this.rolesService.createRole(
      this.requireInstitutionId(currentUser),
      dto,
      currentUser,
    );
  }

  @Get('catalog')
  @Version('1')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Get the permission catalog',
    description:
      'Returns the static feature x action reference list every Role and per-user override is validated against. Institution-independent — also reachable by SUPERADMIN for the institution-creation wizard, which renders outside institution runtime-config.',
  })
  getCatalog() {
    return {
      message: 'Permission catalog retrieved successfully',
      data: PERMISSION_CATALOG,
    };
  }

  @Get('module-catalog')
  @Version('1')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Get the module catalog',
    description:
      'Returns the static list of every ModuleKey with its display label and description — the single source of truth the institution-creation wizard, entitlements editor, and plan blueprint editor all render from, so a new module never has to be hand-added to multiple hardcoded frontend lists again.',
  })
  getModuleCatalog() {
    return {
      message: 'Module catalog retrieved successfully',
      data: MODULE_CATALOG,
    };
  }

  @Get()
  @Version('1')
  @ApiOperation({
    summary: 'List roles',
    description: 'Returns roles defined within the current institution.',
  })
  listRoles(@CurrentUserDecorator() currentUser: CurrentUser) {
    return this.rolesService.listRoles(this.requireInstitutionId(currentUser));
  }

  @Get(':roleId')
  @Version('1')
  @ApiOperation({
    summary: 'Get a role',
    description: 'Returns one role for detail and edit screens.',
  })
  getRole(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('roleId') roleId: string,
  ) {
    return this.rolesService.getRole(
      this.requireInstitutionId(currentUser),
      roleId,
    );
  }

  @Patch(':roleId')
  @Version('1')
  @ApiOperation({
    summary: 'Update a role',
    description: 'Updates a role name, description, or permission matrix.',
  })
  updateRole(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rolesService.updateRole(
      this.requireInstitutionId(currentUser),
      roleId,
      dto,
      currentUser,
    );
  }

  @Delete(':roleId')
  @Version('1')
  @ApiOperation({
    summary: 'Soft-delete a role',
    description:
      'Moves a role to the recycle bin. Users assigned to it fall back to no access until reassigned.',
  })
  deleteRole(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('roleId') roleId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.rolesService.deleteRole(
      this.requireInstitutionId(currentUser),
      roleId,
      currentUser,
      dto.reason,
    );
  }

  private requireInstitutionId(currentUser: CurrentUser): string {
    if (!currentUser.institutionId) {
      throw new ForbiddenException(
        'Your account is not scoped to an institution.',
      );
    }
    return currentUser.institutionId;
  }
}
