import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { DayOfWeek } from '../../../prisma/client';

/**
 * P0-6 (§ 5.1, § 10 step 7): institution-wide weekly working-days pattern.
 * An empty array is rejected here — an institution with zero working days
 * is a data-entry error, not a valid state (§ 5.1 of the design doc).
 */
export class UpsertWorkingCalendarDto {
  @ApiProperty({ enum: DayOfWeek, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(DayOfWeek, { each: true })
  workingDays!: DayOfWeek[];
}

export class CreateClosureDateDto {
  @ApiPropertyOptional({
    description:
      'Optional campus id to scope this closure to a single campus instead of the whole institution.',
  })
  @IsOptional()
  @IsUUID()
  campusId?: string;

  @ApiProperty({ description: 'Date-only ("YYYY-MM-DD") of the closure.' })
  @IsDateString()
  date!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;
}

export class UpdateClosureDateDto extends PartialType(CreateClosureDateDto) {}

export class ListClosureDatesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campusId?: string;
}
