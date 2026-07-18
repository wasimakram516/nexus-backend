import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AttendanceModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
