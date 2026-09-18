import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  AdjustmentType,
  DiscountType,
  PaymentMethod,
  SalaryStatus,
  UserRole,
} from '../../../common/enums/domain.enums';
import { CustomFieldPayloadDto } from '../../../common/dto/custom-field-payload.dto';

export class CreateSalaryDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty({ enum: UserRole }) @IsEnum(UserRole) role!: UserRole;
  @ApiProperty() @IsDateString() joiningDate!: string;
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  baseSalary!: number;
  @ApiProperty() @IsDateString() effectiveDate!: string;
  @ApiPropertyOptional({ enum: SalaryStatus })
  @IsOptional()
  @IsEnum(SalaryStatus)
  status?: SalaryStatus;
}

export class UpdateSalaryDto extends PartialType(CreateSalaryDto) {}

export class CreateDeductionRuleDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty({ enum: UserRole }) @IsEnum(UserRole) role!: UserRole;
  @ApiProperty() @IsInt() @Min(0) allowedAbsences!: number;
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  absenceDeductionPercent!: number;
  @ApiProperty() @IsInt() @Min(0) allowedLates!: number;
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  lateDeductionPercent!: number;
  @ApiProperty() @IsInt() @Min(0) allowedHalfDays!: number;
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  halfDayDeductionPercent!: number;
  @ApiProperty() @IsInt() @Min(0) allowedLeaves!: number;
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  leaveDeductionPercent!: number;
}

export class SalaryAdjustmentDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsUUID() salaryId!: string;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty({ enum: AdjustmentType })
  @IsEnum(AdjustmentType)
  adjustmentType!: AdjustmentType;
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  amount!: number;
  @ApiProperty({
    description: 'Payroll month (1-12) this adjustment applies to.',
  })
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
  @ApiProperty({ description: 'Payroll year this adjustment applies to.' })
  @IsInt()
  @Min(2000)
  year!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class SalaryPayrollPreviewQueryDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsUUID() salaryId!: string;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(12) month!: number;
  @ApiProperty() @IsInt() @Min(2000) year!: number;
}

export class SalaryPaymentDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsUUID() salaryId!: string;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(12) month!: number;
  @ApiProperty() @IsInt() @Min(2000) year!: number;
}

export class CreateBankAccountDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty() @IsString() bankName!: string;
  @ApiProperty() @IsString() accountTitle!: string;
  @ApiProperty() @IsString() accountNumber!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() iban?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() branchCode?: string;
}

export class UpdateBankAccountDto extends PartialType(CreateBankAccountDto) {}

export class CreateFeeStructureDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() classId!: string;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty() @IsObject() feeBreakdown!: Record<string, number>;
}

export class UpdateFeeStructureDto extends PartialType(CreateFeeStructureDto) {}

export class CreateStudentDiscountDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty({ enum: DiscountType })
  @IsEnum(DiscountType)
  discountType!: DiscountType;
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  discountAmount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class CreateStudentFineRuleDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() classId?: string;
  @ApiProperty() @IsInt() @Min(0) allowedAbsences!: number;
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  absenceFineAmount!: number;
  @ApiProperty() @IsInt() @Min(0) allowedLates!: number;
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  lateFineAmount!: number;
  @ApiProperty() @IsInt() @Min(0) allowedHalfDays!: number;
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  halfDayFineAmount!: number;
  @ApiProperty() @IsInt() @Min(0) allowedLeaves!: number;
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  leaveFineAmount!: number;
}

export class CreateStudentFineDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(12) month!: number;
  @ApiProperty() @IsInt() @Min(2000) year!: number;
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  totalFineAmount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() fineReason?: string;
}

export class CreateFeeVoucherDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty() @IsUUID() feeStructureId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(12) month!: number;
  @ApiProperty() @IsInt() @Min(2000) year!: number;
  @ApiProperty() @IsDateString() dueDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() bankId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  lateFeeFine?: number;
}

export class UpdateFeeVoucherDto extends PartialType(CreateFeeVoucherDto) {}

export class CreateFeePaymentDto extends CustomFieldPayloadDto {
  @ApiProperty({
    description:
      'Stable UUID retained across retries of the same payment request.',
  })
  @IsUUID()
  requestKey!: string;
  @ApiProperty() @IsUUID() voucherId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(12) month!: number;
  @ApiProperty() @IsInt() @Min(2000) year!: number;
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999.99)
  paidAmount!: number;
  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;
  @ApiProperty() @IsDateString() paymentDate!: string;
}
