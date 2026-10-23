import { Module } from '@nestjs/common';
import { ExamSubjectsController } from './exam-subjects.controller';
import { ExamSubjectsService } from './exam-subjects.service';
import { ExaminationsController } from './examinations.controller';
import { ExaminationsService } from './examinations.service';

@Module({
  controllers: [ExaminationsController, ExamSubjectsController],
  providers: [ExaminationsService, ExamSubjectsService],
  exports: [ExaminationsService, ExamSubjectsService],
})
export class ExaminationsModule {}
