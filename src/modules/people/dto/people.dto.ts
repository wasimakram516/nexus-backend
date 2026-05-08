import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import {
  ContactPersonType,
  Gender,
  GuardianRelation,
  Religion,
} from '../../../common/enums/domain.enums';
import { CustomFieldPayloadDto } from '../../../common/dto/custom-field-payload.dto';

export class CreateStudentDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsString() regNo!: string;
  @ApiProperty() @IsDateString() dob!: string;
  @ApiProperty({ enum: Gender }) @IsEnum(Gender) gender!: Gender;
  @ApiPropertyOptional() @IsOptional() @IsString() cnic?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() picture?: string;
  @ApiPropertyOptional({ enum: Religion })
  @IsOptional()
  @IsEnum(Religion)
  religion?: Religion;
  @ApiProperty() @IsDateString() admissionDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() prevSchool?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
}

export class UpdateStudentDto extends PartialType(CreateStudentDto) {}

export class CreateGuardianDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() picture?: string;
  @ApiProperty({ enum: GuardianRelation })
  @IsEnum(GuardianRelation)
  relation!: GuardianRelation;
  @ApiProperty() @IsUUID() campusId!: string;
}

export class UpdateGuardianDto extends PartialType(CreateGuardianDto) {}

export class CreateTeacherDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cnic?: string;
  @ApiProperty({ enum: Gender }) @IsEnum(Gender) gender!: Gender;
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() picture?: string;
}

export class UpdateTeacherDto extends PartialType(CreateTeacherDto) {}

export class LinkGuardianDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty() @IsUUID() guardianId!: string;
}

export class StudentPromotionDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() previousClassId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() previousSectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() newClassId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() newSectionId?: string;
  @ApiProperty() @IsDateString() promotionDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() promotionReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class AssignTeacherSubjectDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() teacherId!: string;
  @ApiProperty() @IsUUID() classId!: string;
  @ApiProperty() @IsUUID() subjectId!: string;
  @ApiProperty() @IsUUID() campusId!: string;
}

export class CreateContactDto extends CustomFieldPayloadDto {
  @ApiProperty() @IsUUID() personId!: string;
  @ApiProperty({ enum: ContactPersonType })
  @IsString()
  personType!: string;
  @ApiProperty() @IsString() phone1!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone2?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() whatsapp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
}
