import { Module } from '@nestjs/common';
import { AttendanceReportsService } from './attendance-reports.service';
import { CampusComparisonService } from './campus-comparison.service';
import { FinanceReportsService } from './finance-reports.service';
import { ReportsAccessService } from './reports-access.service';
import { ReportsController } from './reports.controller';
import { ReportsExportService } from './reports-export.service';

@Module({
  controllers: [ReportsController],
  providers: [
    ReportsAccessService,
    ReportsExportService,
    CampusComparisonService,
    AttendanceReportsService,
    FinanceReportsService,
  ],
})
export class ReportsModule {}
