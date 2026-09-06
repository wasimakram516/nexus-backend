import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { DeleteRecordDto } from '../../common/dto/delete-record.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { NoticesService } from './notices.service';
import {
  CreateNoticeDto,
  ListNoticesForMeQueryDto,
  ListNoticesQueryDto,
  UpdateNoticeDto,
} from './dto/notices.dto';

@ApiTags('Notices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('notices')
export class NoticesController {
  constructor(private readonly noticesService: NoticesService) {}

  @Post()
  @Version('1')
  @RequirePermission('notices', 'create')
  @ApiOperation({
    summary: 'Create a notice',
    description:
      'Creates a notice within the current institution, optionally narrowed to a campus/class/section/role audience.',
  })
  createNotice(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateNoticeDto,
  ) {
    return this.noticesService.createNotice(
      this.requireInstitutionId(currentUser),
      currentUser,
      dto,
    );
  }

  @Get()
  @Version('1')
  @RequirePermission('notices', 'read')
  @ApiOperation({
    summary: 'List notices',
    description:
      'Returns the admin/staff management list of notices visible to the authenticated user, optionally filtered by campus, class, section, or role.',
  })
  listNotices(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ListNoticesQueryDto,
  ) {
    return this.noticesService.listNotices(
      this.requireInstitutionId(currentUser),
      currentUser,
      query,
    );
  }

  // Must be declared before 'notices/:id' below, or Nest matches "for-me" as
  // the :id param (same gotcha as the academic years module's 'current'
  // route ordering, and the people module's 'next-reg-no' route ordering).
  @Get('for-me')
  @Version('1')
  @ApiOperation({
    summary: 'List notices for the current user',
    description:
      'Returns the paginated, audience-matched, publish-window-filtered feed of notices for the authenticated user’s dashboard/portal display. Module-gated only — no notices.read permission required, same as other self-service reads.',
  })
  listNoticesForMe(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ListNoticesForMeQueryDto,
  ) {
    return this.noticesService.listNoticesForMe(currentUser, query);
  }

  @Get(':id')
  @Version('1')
  @RequirePermission('notices', 'read')
  @ApiOperation({
    summary: 'Get a notice',
    description:
      'Returns one notice for the admin/staff detail and edit screens with access checks applied.',
  })
  getNotice(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('id') id: string,
  ) {
    return this.noticesService.getNotice(
      this.requireInstitutionId(currentUser),
      currentUser,
      id,
    );
  }

  @Patch(':id')
  @Version('1')
  @RequirePermission('notices', 'update')
  @ApiOperation({
    summary: 'Update a notice',
    description:
      'Partially updates a notice, re-validating campus/class/section hierarchy consistency.',
  })
  updateNotice(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateNoticeDto,
  ) {
    return this.noticesService.updateNotice(
      this.requireInstitutionId(currentUser),
      currentUser,
      id,
      dto,
    );
  }

  @Delete(':id')
  @Version('1')
  @RequirePermission('notices', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a notice',
    description:
      'Moves a notice to the recycle bin instead of permanently removing it immediately.',
  })
  deleteNotice(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('id') id: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.noticesService.deleteNotice(
      this.requireInstitutionId(currentUser),
      currentUser,
      id,
      dto.reason,
    );
  }

  /**
   * Resolves the caller's own institution id for the institution-scoped
   * Notices routes, mirroring RolesController.requireInstitutionId. The
   * superadmin platform mirror
   * (/platform/institutions/:institutionId/notices) takes its institution
   * id from the path param instead.
   */
  private requireInstitutionId(currentUser: CurrentUser): string {
    if (!currentUser.institutionId) {
      throw new ForbiddenException(
        'Your account is not scoped to an institution.',
      );
    }
    return currentUser.institutionId;
  }
}
