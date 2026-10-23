import { Module } from '@nestjs/common';
import { ExamPrintablesController } from './exam-printables.controller';
import { ExamPrintablesService } from './exam-printables.service';
import { ExamReportCardsController } from './exam-report-cards.controller';
import { ExamReportCardsService } from './exam-report-cards.service';
import { ExamResultsController } from './exam-results.controller';
import { ExamResultsViewController } from './exam-results-view.controller';
import { ExamResultsViewService } from './exam-results-view.service';
import { ExamResultsService } from './exam-results.service';
import { ExamSubjectsController } from './exam-subjects.controller';
import { ExamSubjectsService } from './exam-subjects.service';
import { ExaminationsController } from './examinations.controller';
import { ExaminationsService } from './examinations.service';

@Module({
  controllers: [
    ExaminationsController,
    ExamSubjectsController,
    ExamResultsController,
    ExamResultsViewController,
    ExamPrintablesController,
    ExamReportCardsController,
  ],
  providers: [
    ExaminationsService,
    ExamSubjectsService,
    ExamResultsService,
    ExamResultsViewService,
    ExamPrintablesService,
    ExamReportCardsService,
  ],
  exports: [
    ExaminationsService,
    ExamSubjectsService,
    ExamResultsService,
    ExamResultsViewService,
    ExamPrintablesService,
    ExamReportCardsService,
  ],
})
export class ExaminationsModule {}
