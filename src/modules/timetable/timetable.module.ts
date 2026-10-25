import { Module } from '@nestjs/common';
import { TimetableController } from './timetable.controller';
import { PeriodSubstitutionsController } from './period-substitutions.controller';
import { PeriodSubstitutionsService } from './period-substitutions.service';
import { TimetableService } from './timetable.service';
import { TimetablePdfService } from './timetable-pdf.service';
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
    TimetablePdfService,
  ],
})
export class TimetableModule {}
