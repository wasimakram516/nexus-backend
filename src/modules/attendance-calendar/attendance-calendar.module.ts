import { Module } from '@nestjs/common';
import { AttendanceCalendarController } from './attendance-calendar.controller';
import { AttendanceCalendarService } from './attendance-calendar.service';

@Module({
  controllers: [AttendanceCalendarController],
  providers: [AttendanceCalendarService],
  exports: [AttendanceCalendarService],
})
export class AttendanceCalendarModule {}
