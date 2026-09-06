import {
  Body,
  Controller,
  Delete,
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
import { TimetableService } from './timetable.service';
import {
  CreatePeriodSlotDto,
  ListPeriodSlotsQueryDto,
  UpdatePeriodSlotDto,
} from './dto/timetable.dto';

@ApiTags('Timetable')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('timetable/period-slots')
export class TimetableController {
  constructor(private readonly timetableService: TimetableService) {}

  @Post()
  @Version('1')
  @RequirePermission('period_slots', 'create')
  @ApiOperation({
    summary: 'Create a period slot',
    description:
      "Adds one entry to a section's weekly-recurring schedule template. campusId is resolved server-side from sectionId.",
  })
  createPeriodSlot(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreatePeriodSlotDto,
  ) {
    return this.timetableService.createPeriodSlot(currentUser, dto);
  }

  @Get()
  @Version('1')
  @RequirePermission('period_slots', 'read')
  @ApiOperation({
    summary: 'List period slots',
    description:
      'Returns the admin/staff management list of period slots, optionally filtered by campus, class, section, or day of week.',
  })
  listPeriodSlots(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ListPeriodSlotsQueryDto,
  ) {
    return this.timetableService.listPeriodSlots(currentUser, query);
  }

  // Must be declared before 'period-slots/:id' below — 3 path segments vs.
  // :id's 1 means there's no actual Nest route-collision risk here (see
  // M3-SCHEDULING-COMMUNICATION-DESIGN.md § 7.1), but this ordering is kept
  // anyway as the same defensive habit as every other current/:id-style
  // route pairing in this codebase (academic years' 'current', notices'
  // 'for-me').
  @Get('section/:sectionId/week')
  @Version('1')
  @RequirePermission('period_slots', 'read')
  @ApiOperation({
    summary: "Get one section's full weekly timetable",
    description:
      'Returns every period slot for one section, ordered by day of week then period number — the grid shape a timetable view or datesheet builder would consume directly.',
  })
  getWeeklyGrid(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('sectionId') sectionId: string,
  ) {
    return this.timetableService.getWeeklyGrid(currentUser, sectionId);
  }

  @Get(':id')
  @Version('1')
  @RequirePermission('period_slots', 'read')
  @ApiOperation({
    summary: 'Get a period slot',
    description:
      'Returns one period slot for the admin/staff detail and edit screens with access checks applied.',
  })
  getPeriodSlot(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('id') id: string,
  ) {
    return this.timetableService.getPeriodSlot(currentUser, id);
  }

  @Patch(':id')
  @Version('1')
  @RequirePermission('period_slots', 'update')
  @ApiOperation({
    summary: 'Update a period slot',
    description:
      'Partially updates a period slot, re-validating the TeacherSubject cross-check when subjectId/staffProfileId change.',
  })
  updatePeriodSlot(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdatePeriodSlotDto,
  ) {
    return this.timetableService.updatePeriodSlot(currentUser, id, dto);
  }

  @Delete(':id')
  @Version('1')
  @RequirePermission('period_slots', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a period slot',
    description:
      'Moves a period slot to the recycle bin instead of permanently removing it immediately.',
  })
  deletePeriodSlot(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('id') id: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.timetableService.deletePeriodSlot(currentUser, id, dto.reason);
  }
}
