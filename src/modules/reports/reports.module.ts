import { Module } from '@nestjs/common';
import { ExaminationsModule } from '../examinations/examinations.module';
import { AttendanceReportsService } from './attendance-reports.service';
import { CampusComparisonService } from './campus-comparison.service';
import { ExamReportsService } from './exam-reports.service';
import { FinanceReportsService } from './finance-reports.service';
import { PayrollReportsService } from './payroll-reports.service';
import { ReportsAccessService } from './reports-access.service';
import { ReportsController } from './reports.controller';
import { ReportsExportService } from './reports-export.service';

@Module({
  imports: [ExaminationsModule],
  controllers: [ReportsController],
  providers: [
    ReportsAccessService,
    ReportsExportService,
    CampusComparisonService,
    AttendanceReportsService,
    FinanceReportsService,
    ExamReportsService,
    PayrollReportsService,
  ],
})
export class ReportsModule {}
