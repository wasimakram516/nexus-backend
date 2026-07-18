import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DeleteRecordDto } from '../../common/dto/delete-record.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  ListUsersQueryDto,
  ResolveUsersQueryDto,
  UpdateProfileDto,
  UpdateUserAccessDto,
} from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @Version('1')
  @ApiOperation({
    summary: 'Get the current user profile',
    description:
      'Returns the authenticated user profile that should be used to hydrate account and session-aware frontend views.',
  })
  getProfile(@CurrentUserDecorator() currentUser: CurrentUser) {
    return this.usersService.getProfile(currentUser);
  }

  @Put('me')
  @Version('1')
  @ApiOperation({
    summary: 'Update the current user profile',
    description:
      'Updates editable profile fields for the authenticated user without changing role or access state.',
  })
  updateProfile(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(currentUser, dto);
  }

  @Get()
  @Version('1')
  @RequirePermission('users', 'read')
  @ApiOperation({
    summary: 'List users',
    description:
      'Returns institution-scoped users for user management screens. Superadmins can list across institutions, while everyone else stays within their own institution.',
  })
  listUsers(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ListUsersQueryDto,
  ) {
    return this.usersService.listUsers(currentUser, query);
  }

  @Get('resolve')
  @Version('1')
  @ApiOperation({
    summary: 'Resolve user IDs to display names',
    description:
      'Batch-resolves createdBy/updatedBy-style user IDs to a name/email map for the record-metadata popover. Institution-scoped; no users.read grant required.',
  })
  resolveUsers(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ResolveUsersQueryDto,
  ) {
    const ids = query.ids
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return this.usersService.resolveUsers(currentUser, ids);
  }

  @Put(':userId')
  @Version('1')
  @RequirePermission('users', 'update')
  @ApiOperation({
    summary: 'Update user access state',
    description:
      'Use this endpoint to change a user role, suspend/reactivate an account, or apply both changes in one request. A delegated `users.update` grant (non-admin) can never touch or create admin-level accounts.',
  })
  updateUser(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserAccessDto,
  ) {
    return this.usersService.updateUserRole(currentUser, userId, dto);
  }

  @Delete(':userId')
  @Version('1')
  @RequirePermission('users', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a user',
    description:
      'Moves a user account to the recycle bin. Provide an optional reason so deletion history is visible in audit and restore flows.',
  })
  deleteUser(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('userId') userId: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.usersService.deleteUser(currentUser, userId, dto.reason);
  }
}
