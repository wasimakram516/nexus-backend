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
import { Roles } from '../../common/decorators/roles.decorator';
import { DeleteRecordDto } from '../../common/dto/delete-record.dto';
import { UserRole } from '../../common/enums/domain.enums';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  ListUsersQueryDto,
  UpdateProfileDto,
  UpdateUserAccessDto,
} from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
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
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'List users',
    description:
      'Returns institution-scoped users for user management screens. Superadmins can list across institutions, while admins stay within their own institution.',
  })
  listUsers(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ListUsersQueryDto,
  ) {
    return this.usersService.listUsers(currentUser, query);
  }

  @Put(':userId')
  @Version('1')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update user access state',
    description:
      'Use this endpoint to change a user role, suspend/reactivate an account, or apply both changes in one request.',
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
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
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
