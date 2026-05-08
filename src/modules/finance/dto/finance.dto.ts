import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
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
  @ApiProperty() @IsNumber() baseSalary!: number;
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
  @ApiProperty() @IsNumber() allowedAbsences!: number;
  @ApiProperty() @IsNumber() absenceDeductionPercent!: number;
  @ApiProperty() @IsNumber() allowedLates!: number;
  @ApiProperty() @IsNumber() lateDeductionPercent!: number;
  @ApiProperty() @IsNumber() allowedHalfDays!: number;
  @ApiProperty() @IsNumber() halfDayDeductionPercent!: number;
  @ApiProperty() @IsNumber() allowedLeaves!: number;
  @ApiProperty() @IsNumber() leaveDeductionPercent!: number;
}

export class SalaryAdjustmentDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsUUID() salaryId!: string;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty({ enum: AdjustmentType })
  @IsEnum(AdjustmentType)
  adjustmentType!: AdjustmentType;
  @ApiProperty() @IsNumber() amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class SalaryPaymentDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsUUID() salaryId!: string;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty() @IsNumber() month!: number;
  @ApiProperty() @IsNumber() year!: number;
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
  @ApiProperty() @IsNumber() discountAmount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class CreateStudentFineRuleDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() classId?: string;
  @ApiProperty() @IsNumber() allowedAbsences!: number;
  @ApiProperty() @IsNumber() absenceFineAmount!: number;
  @ApiProperty() @IsNumber() allowedLates!: number;
  @ApiProperty() @IsNumber() lateFineAmount!: number;
  @ApiProperty() @IsNumber() allowedHalfDays!: number;
  @ApiProperty() @IsNumber() halfDayFineAmount!: number;
  @ApiProperty() @IsNumber() allowedLeaves!: number;
  @ApiProperty() @IsNumber() leaveFineAmount!: number;
}

export class CreateStudentFineDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty() @IsNumber() month!: number;
  @ApiProperty() @IsNumber() year!: number;
  @ApiProperty() @IsNumber() totalFineAmount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() fineReason?: string;
}

export class CreateFeeVoucherDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty() @IsUUID() feeStructureId!: string;
  @ApiProperty() @IsNumber() month!: number;
  @ApiProperty() @IsNumber() year!: number;
  @ApiProperty() @IsDateString() dueDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() bankId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() lateFeeFine?: number;
}

export class UpdateFeeVoucherDto extends PartialType(CreateFeeVoucherDto) {}

export class CreateFeePaymentDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() voucherId!: string;
  @ApiProperty() @IsNumber() month!: number;
  @ApiProperty() @IsNumber() year!: number;
  @ApiProperty() @IsNumber() paidAmount!: number;
  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;
  @ApiProperty() @IsDateString() paymentDate!: string;
}
