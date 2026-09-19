import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  ContactInquiriesAdminController,
  ContactInquiriesPublicController,
} from './contact-inquiries.controller';
import { RealtimeModule } from '../realtime/realtime.module';
import { ContactInquiriesService } from './contact-inquiries.service';

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [
    ContactInquiriesPublicController,
    ContactInquiriesAdminController,
  ],
  providers: [ContactInquiriesService],
})
export class ContactInquiriesModule {}
