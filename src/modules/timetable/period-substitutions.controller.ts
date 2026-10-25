import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
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
import {
  CancelSubstitutionDto,
  CreatePeriodSubstitutionDto,
  ListPeriodSubstitutionsQueryDto,
} from './dto/timetable.dto';
import { PeriodSubstitutionsService } from './period-substitutions.service';

@ApiTags('Timetable')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('timetable/substitutions')
export class PeriodSubstitutionsController {
  constructor(private readonly substitutions: PeriodSubstitutionsService) {}

  @Post()
  @Version('1')
  @RequirePermission('period_substitutions', 'create')
  @ApiOperation({
    summary: 'Arrange cover for a period on a date',
    description:
      "A teacher covers one period on one date; the weekly timetable is not changed. Refused if the date is not the period's weekday or the covering teacher is teaching or covering something else then.",
  })
  create(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Body() dto: CreatePeriodSubstitutionDto,
  ) {
    return this.substitutions.create(currentUser, dto);
  }

  @Get()
  @Version('1')
  @RequirePermission('period_substitutions', 'read')
  @ApiOperation({ summary: 'List substitutions on a campus between two dates' })
  list(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Query() query: ListPeriodSubstitutionsQueryDto,
  ) {
    return this.substitutions.list(currentUser, query);
  }

  @Delete(':id')
  @Version('1')
  @RequirePermission('period_substitutions', 'delete')
  @ApiOperation({
    summary: 'Cancel a substitution',
    description: 'The period goes back to its usual teacher.',
  })
  cancel(
    @CurrentUserDecorator() currentUser: CurrentUser,
    @Param('id') id: string,
    @Body() dto: CancelSubstitutionDto,
  ) {
    return this.substitutions.cancel(currentUser, id, dto);
  }
}
