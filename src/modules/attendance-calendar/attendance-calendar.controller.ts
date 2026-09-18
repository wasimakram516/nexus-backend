import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { DeleteRecordDto } from '../../common/dto/delete-record.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AttendanceCalendarService } from './attendance-calendar.service';
import {
  CreateClosureDateDto,
  ListClosureDatesQueryDto,
  UpdateClosureDateDto,
  UpsertWorkingCalendarDto,
} from './dto/attendance-calendar.dto';

@ApiTags('Attendance Calendar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('attendance-calendar')
export class AttendanceCalendarController {
  constructor(
    private readonly attendanceCalendarService: AttendanceCalendarService,
  ) {}

  @Get('working-days')
  @Version('1')
  @RequirePermission('attendance_calendar', 'read')
  @ApiOperation({
    summary: 'Get the working-days calendar',
    description:
      'Returns the current institution weekly working-days pattern, or null if not configured yet (P0-6 fail-closed default applies until this is set).',
  })
  getWorkingCalendar(@CurrentUserDecorator() currentUser: CurrentUser) {
    return this.attendanceCalendarService.getWorkingCalendar(
      this.requireInstitutionId(currentUser),
      currentUser,
    );
  }

  @Put('working-days')
  @Version('1')
  @RequirePermission('attendance_calendar', 'update')
  @ApiOperation({
    summary: 'Save the working-days calendar',
    description:
      'Creates or replaces the institution weekly working-days pattern used by the auto-absent sweep.',
  })
  upsertWorkingCalendar(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: UpsertWorkingCalendarDto,
  ) {
    return this.attendanceCalendarService.upsertWorkingCalendar(
      this.requireInstitutionId(currentUser),
      currentUser,
      dto,
    );
  }

  @Get('closures')
  @Version('1')
  @RequirePermission('attendance_calendar', 'read')
  @ApiOperation({
    summary: 'List closure dates',
    description:
      'Returns institution-wide and (optionally) campus-specific declared closure dates.',
  })
  listClosureDates(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ListClosureDatesQueryDto,
  ) {
    return this.attendanceCalendarService.listClosureDates(
      this.requireInstitutionId(currentUser),
      currentUser,
      query,
    );
  }

  @Post('closures')
  @Version('1')
  @RequirePermission('attendance_calendar', 'create')
  @ApiOperation({
    summary: 'Create a closure date',
    description:
      'Declares a one-off closure (e.g. a holiday), institution-wide or scoped to one campus.',
  })
  createClosureDate(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreateClosureDateDto,
  ) {
    return this.attendanceCalendarService.createClosureDate(
      this.requireInstitutionId(currentUser),
      currentUser,
      dto,
    );
  }

  @Patch('closures/:id')
  @Version('1')
  @RequirePermission('attendance_calendar', 'update')
  @ApiOperation({
    summary: 'Update a closure date',
    description: 'Partially updates a declared closure date.',
  })
  updateClosureDate(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateClosureDateDto,
  ) {
    return this.attendanceCalendarService.updateClosureDate(
      this.requireInstitutionId(currentUser),
      currentUser,
      id,
      dto,
    );
  }

  @Delete('closures/:id')
  @Version('1')
  @RequirePermission('attendance_calendar', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a closure date',
    description:
      'Moves a closure date to the recycle bin instead of permanently removing it immediately.',
  })
  deleteClosureDate(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('id') id: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.attendanceCalendarService.deleteClosureDate(
      this.requireInstitutionId(currentUser),
      currentUser,
      id,
      dto.reason,
    );
  }

  /** Mirrors NoticesController.requireInstitutionId — the superadmin
   *  platform mirror (/platform/institutions/:institutionId/attendance-calendar/...)
   *  takes its institution id from the path param instead. */
  private requireInstitutionId(currentUser: CurrentUser): string {
    if (!currentUser.institutionId) {
      throw new ForbiddenException(
        'Your account is not scoped to an institution.',
      );
    }
    return currentUser.institutionId;
  }
}
