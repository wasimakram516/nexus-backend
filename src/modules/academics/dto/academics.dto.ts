import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CustomFieldPayloadDto } from '../../../common/dto/custom-field-payload.dto';

export class CreateLevelDto extends CustomFieldPayloadDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsUUID()
  campusId!: string;
}

export class UpdateLevelDto extends PartialType(CreateLevelDto) {}

export class CreateClassDto extends CustomFieldPayloadDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsUUID()
  levelId!: string;
}

export class UpdateClassDto extends PartialType(CreateClassDto) {}

export class CreateSectionDto extends CustomFieldPayloadDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsUUID()
  classId!: string;
}

export class UpdateSectionDto extends PartialType(CreateSectionDto) {}

export class CreateSubjectDto extends CustomFieldPayloadDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsUUID()
  classId!: string;
}

export class UpdateSubjectDto extends PartialType(CreateSubjectDto) {}

/**
 * One entry of `CreateAcademicYearDto.campusOverrides` / `UpdateAcademicYearDto.campusOverrides`.
 * `startDate`/`endDate` are independently optional — a campus can override
 * just one of the two, per design doc § 4.2/§ 7.1.
 */
export class AcademicYearCampusOverrideInputDto {
  @ApiProperty()
  @IsUUID()
  campusId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CreateAcademicYearDto {
  @ApiProperty({ description: 'e.g. "2026-27"' })
  @IsString()
  name!: string;

  @ApiProperty()
  @IsDateString()
  startDate!: string;

  @ApiProperty()
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ type: [AcademicYearCampusOverrideInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademicYearCampusOverrideInputDto)
  campusOverrides?: AcademicYearCampusOverrideInputDto[];
}

export class UpdateAcademicYearDto extends PartialType(CreateAcademicYearDto) {}
