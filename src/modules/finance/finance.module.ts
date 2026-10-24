import { Module } from '@nestjs/common';
import { FeeVoucherGenerationService } from './fee-voucher-generation.service';
import { FamilyPaymentService } from './family-payment.service';
import { FeeReportsService } from './fee-reports.service';
import { FeeVoucherPrintablesService } from './fee-voucher-printables.service';
import { StudentFineGenerationService } from './student-fine-generation.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  controllers: [FinanceController],
  providers: [
    FinanceService,
    FeeVoucherGenerationService,
    StudentFineGenerationService,
    FeeVoucherPrintablesService,
    FeeReportsService,
    FamilyPaymentService,
  ],
})
export class FinanceModule {}
