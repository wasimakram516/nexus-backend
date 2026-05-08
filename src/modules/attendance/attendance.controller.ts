import {
  Body,
  Controller,
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
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AttendanceService } from './attendance.service';
import {
  AutoAbsentDto,
  CheckInDto,
  CheckOutDto,
  ListAttendanceQueryDto,
  MarkLeaveDto,
  UpdateAttendanceRecordDto,
} from './dto/attendance.dto';

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('check-in')
  @Version('1')
  @Roles(
    UserRole.SUPERADMIN,
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.STUDENT,
  )
  @ApiOperation({
    summary: 'Record a check-in event',
    description:
      'Creates or records the attendance start time for the selected user on a specific date.',
  })
  checkIn(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CheckInDto,
  ) {
    return this.attendanceService.checkIn(currentUser, dto);
  }

  @Post('check-out')
  @Version('1')
  @Roles(
    UserRole.SUPERADMIN,
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.STUDENT,
  )
  @ApiOperation({
    summary: 'Record a check-out event',
    description:
      'Updates the day’s attendance record with check-out time and automatically computes half-day status.',
  })
  checkOut(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CheckOutDto,
  ) {
    return this.attendanceService.checkOut(currentUser, dto);
  }

  @Post('leave')
  @Version('1')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Mark leave for a user',
    description:
      'Admin-level endpoint for creating or updating a leave attendance record for a specific date.',
  })
  markLeave(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: MarkLeaveDto,
  ) {
    return this.attendanceService.markLeave(currentUser, dto);
  }

  @Post('auto-absent')
  @Version('1')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Auto-mark absent users',
    description:
      'Creates absent attendance records for campus users who have no attendance entry for the specified date.',
  })
  autoAbsent(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: AutoAbsentDto,
  ) {
    return this.attendanceService.autoMarkAbsent(currentUser, dto);
  }

  @Get()
  @Version('1')
  @ApiOperation({
    summary: 'List attendance records',
    description:
      'Frontend-facing attendance listing endpoint with campus, user, role, status, and date-range filters.',
  })
  listAttendance(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ListAttendanceQueryDto,
  ) {
    return this.attendanceService.listAttendance(currentUser, query);
  }

  @Get('summary')
  @Version('1')
  @ApiOperation({
    summary: 'Get attendance summary totals',
    description:
      'Returns reporting-style attendance counts for the same scoped filters supported by the attendance list endpoint.',
  })
  getAttendanceSummary(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ListAttendanceQueryDto,
  ) {
    return this.attendanceService.getAttendanceSummary(currentUser, query);
  }

  @Get(':attendanceId')
  @Version('1')
  @ApiOperation({
    summary: 'Get an attendance record',
    description:
      'Returns one attendance record when the authenticated user has access to the related campus and user scope.',
  })
  getAttendanceRecord(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('attendanceId') attendanceId: string,
  ) {
    return this.attendanceService.getAttendanceRecord(
      currentUser,
      attendanceId,
    );
  }

  @Patch(':attendanceId')
  @Version('1')
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update an attendance record',
    description:
      'Admin-level endpoint for correcting attendance dates, times, status, half-day flag, or remarks.',
  })
  updateAttendanceRecord(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('attendanceId') attendanceId: string,
    @Body() dto: UpdateAttendanceRecordDto,
  ) {
    return this.attendanceService.updateAttendanceRecord(
      currentUser,
      attendanceId,
      dto,
    );
  }
}
