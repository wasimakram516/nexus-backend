import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { AttendanceStatus } from '../../../common/enums/domain.enums';
import { UserRole } from '../../../prisma/client';

export class CheckInDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsDateString() date!: string;
  @ApiProperty() @IsDateString() checkIn!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class CheckOutDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsDateString() date!: string;
  @ApiProperty() @IsDateString() checkOut!: string;
}

export class MarkLeaveDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsDateString() date!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class AutoAbsentDto {
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty() @IsDateString() date!: string;

  @ApiPropertyOptional({
    description:
      "PERIOD-mode only: when given, sweeps this period slot's roster instead of the whole campus for the given date (see AttendanceService.markPeriodAbsentees).",
  })
  @IsOptional()
  @IsUUID()
  periodId?: string;
}

export class BulkMarkEntryDto {
  @ApiProperty() @IsUUID() userId!: string;

  @ApiProperty({ enum: AttendanceStatus })
  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() halfDay?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class BulkMarkAttendanceDto {
  @ApiProperty() @IsUUID() campusId!: string;

  @ApiProperty({
    example: '2026-06-12',
    description:
      'Date-only string. Full ISO datetimes are rejected because attendance rows key on the calendar day.',
  })
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiPropertyOptional({
    description:
      'Attendance dual mode (§ 5.3): forbidden when the institution is in DAILY mode, required whenever this batch includes STUDENT entries in PERIOD mode. Applies only to the STUDENT entries in `entries` — STAFF/ADMIN entries always stay DAILY-keyed regardless of this value.',
  })
  @IsOptional()
  @IsUUID()
  periodId?: string;

  @ApiProperty({ type: [BulkMarkEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkMarkEntryDto)
  entries!: BulkMarkEntryDto[];
}

export class UpdateAttendanceRecordDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() checkIn?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() checkOut?: string;
  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() halfDay?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class ListAttendanceQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() campusId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateTo?: string;
  @ApiPropertyOptional({
    description:
      'Filters to attendance rows scoped to this period slot (§ 5.3).',
  })
  @IsOptional()
  @IsUUID()
  periodId?: string;
}

export class PeriodRosterQueryDto {
  @ApiProperty() @IsUUID() periodId!: string;
  @ApiProperty({
    example: '2026-06-12',
    description:
      "Date-only string, matching BulkMarkAttendanceDto.date's convention.",
  })
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;
}
