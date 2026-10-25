import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserDecorator } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { WeekQueryDto } from './dto/timetable.dto';
import { TimetableViewsService } from './timetable-views.service';

@ApiTags('Timetable')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('timetable')
export class TimetableViewsController {
  constructor(private readonly views: TimetableViewsService) {}

  // No permission decorator: every student, guardian and teacher needs it,
  // and it only ever returns the caller's own (or their children's) timetable.
  @Get('for-me')
  @Version('1')
  @ApiOperation({
    summary: 'Get my timetable for a week',
    description:
      "A student's section, each of a guardian's children's sections, or a teacher's own periods, with cover applied to the dates of the week.",
  })
  getMine(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: WeekQueryDto,
  ) {
    return this.views.mySchedule(currentUser, query.date);
  }

  @Get('section/:sectionId/schedule')
  @Version('1')
  @RequirePermission('period_slots', 'read')
  @ApiOperation({
    summary: "Get a section's timetable for a week, with cover applied",
  })
  getSectionSchedule(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('sectionId') sectionId: string,
    @Query() query: WeekQueryDto,
  ) {
    return this.views.sectionSchedule(currentUser, sectionId, query.date);
  }

  @Get('teacher/:staffProfileId/schedule')
  @Version('1')
  @RequirePermission('period_slots', 'read')
  @ApiOperation({
    summary: "Get a teacher's timetable for a week, with cover applied",
    description:
      'The periods they teach (marked when someone else covers them) and the periods they are covering.',
  })
  getTeacherSchedule(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('staffProfileId') staffProfileId: string,
    @Query() query: WeekQueryDto,
  ) {
    return this.views.teacherSchedule(currentUser, staffProfileId, query.date);
  }
}
