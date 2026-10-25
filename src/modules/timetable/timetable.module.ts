import { Module } from '@nestjs/common';
import { TimetableController } from './timetable.controller';
import { PeriodSubstitutionsController } from './period-substitutions.controller';
import { PeriodSubstitutionsService } from './period-substitutions.service';
import { TimetableService } from './timetable.service';
import { TimetableViewsController } from './timetable-views.controller';
import { TimetableViewsService } from './timetable-views.service';

@Module({
  controllers: [
    TimetableController,
    PeriodSubstitutionsController,
    TimetableViewsController,
  ],
  providers: [
    TimetableService,
    PeriodSubstitutionsService,
    TimetableViewsService,
  ],
})
export class TimetableModule {}
