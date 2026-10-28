import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { FinanceModule } from '../finance/finance.module';
import { SchedulerService } from './scheduler.service';
import { TrialReminderService } from './trial-reminder.service';

@Module({
  imports: [AttendanceModule, FinanceModule],
  providers: [SchedulerService, TrialReminderService],
})
export class SchedulerModule {}
