import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  ContactInquiriesAdminController,
  ContactInquiriesPublicController,
} from './contact-inquiries.controller';
import { ContactInquiriesService } from './contact-inquiries.service';

@Module({
  imports: [AuthModule],
  controllers: [
    ContactInquiriesPublicController,
    ContactInquiriesAdminController,
  ],
  providers: [ContactInquiriesService],
})
export class ContactInquiriesModule {}
