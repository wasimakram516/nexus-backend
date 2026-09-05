import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export enum RecycleBinEntity {
  USER = 'user',
  CAMPUS = 'campus',
  STUDENT = 'student',
  GUARDIAN = 'guardian',
  STAFF_PROFILE = 'staff-profile',
  LEVEL = 'level',
  CLASS = 'class',
  SECTION = 'section',
  SUBJECT = 'subject',
  SALARY = 'salary',
  SALARY_DEDUCTION_RULE = 'salary-deduction-rule',
  SALARY_ADJUSTMENT = 'salary-adjustment',
  SALARY_PAYMENT = 'salary-payment',
  BANK_ACCOUNT = 'bank-account',
  FEE_STRUCTURE = 'fee-structure',
  STUDENT_DISCOUNT = 'student-discount',
  STUDENT_FINE_RULE = 'student-fine-rule',
  STUDENT_FINE = 'student-fine',
  FEE_VOUCHER = 'fee-voucher',
  FEE_PAYMENT = 'fee-payment',
  ROLE = 'role',
  ACADEMIC_YEAR = 'academic-year',
  STUDENT_ENROLLMENT = 'student-enrollment',
}

export class ListRecycleBinQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: RecycleBinEntity,
    description: 'Limit the recycle bin results to a single entity type.',
  })
  @IsOptional()
  @IsEnum(RecycleBinEntity)
  entity?: RecycleBinEntity;

  @ApiPropertyOptional({
    description:
      'Optional institution filter. Admins are always restricted to their own institution.',
  })
  @IsOptional()
  @IsUUID()
  institutionId?: string;
}

export class RecycleBinRecordParamsDto {
  @IsEnum(RecycleBinEntity)
  entity!: RecycleBinEntity;

  @IsUUID()
  recordId!: string;
}
