import { Module } from '@nestjs/common';
import { FeeVoucherGenerationService } from './fee-voucher-generation.service';
import { StudentFineGenerationService } from './student-fine-generation.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  controllers: [FinanceController],
  providers: [
    FinanceService,
    FeeVoucherGenerationService,
    StudentFineGenerationService,
  ],
})
export class FinanceModule {}
