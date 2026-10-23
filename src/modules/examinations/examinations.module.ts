import { Module } from '@nestjs/common';
import { ExamResultsController } from './exam-results.controller';
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
  ],
  providers: [ExaminationsService, ExamSubjectsService, ExamResultsService],
  exports: [ExaminationsService, ExamSubjectsService, ExamResultsService],
})
export class ExaminationsModule {}
