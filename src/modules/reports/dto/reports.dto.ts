import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What every report accepts: which institution (superadmin only) and what to return. */
export class ReportQueryDto {
  @ApiPropertyOptional({
    description:
      'The institution a superadmin is viewing. Ignored for an institution administrator, who always sees their own.',
  })
  @IsOptional()
  @IsUUID()
  institutionId?: string;

  @ApiPropertyOptional({
    enum: ['json', 'csv', 'pdf'],
    description: 'The table as JSON (default), or a CSV or PDF download.',
  })
  @IsOptional()
  @IsIn(['json', 'csv', 'pdf'])
  format?: 'json' | 'csv' | 'pdf';
}

export class CampusComparisonQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-25',
    description:
      "The day to report on; defaults to today at each campus. Fees are for that day's month.",
  })
  @IsOptional()
  @Matches(DATE, { message: 'date must be YYYY-MM-DD.' })
  date?: string;
}

export class CampusPeriodQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({
    description:
      'Limit to one campus; default every campus the caller can see.',
  })
  @IsOptional()
  @IsUUID()
  campusId?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'First day; defaults to the start of this month.',
  })
  @IsOptional()
  @Matches(DATE, { message: 'from must be YYYY-MM-DD.' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Last day; defaults to today.',
  })
  @IsOptional()
  @Matches(DATE, { message: 'to must be YYYY-MM-DD.' })
  to?: string;
}

export class MonthlyRegisterQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ description: 'The section whose register is wanted.' })
  @IsUUID()
  sectionId!: string;

  @ApiPropertyOptional({
    example: '2026-10',
    description: 'The month, YYYY-MM; defaults to this month.',
  })
  @IsOptional()
  @Matches(MONTH, { message: 'month must be YYYY-MM.' })
  month?: string;
}

export class ChronicAbsenteesQueryDto extends CampusPeriodQueryDto {
  @ApiPropertyOptional({
    example: 20,
    description:
      'List students absent on at least this percentage of the days marked; default 20.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  thresholdPercent?: number;
}

export class ExamReportQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ description: 'The exam whose results are wanted.' })
  @IsUUID()
  examId!: string;
}

export class PayrollRegisterQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({
    description:
      'Limit to one campus; default every campus the caller can see.',
  })
  @IsOptional()
  @IsUUID()
  campusId?: string;

  @ApiPropertyOptional({
    example: '2026-10',
    description: 'The payroll month, YYYY-MM; defaults to this month.',
  })
  @IsOptional()
  @Matches(MONTH, { message: 'month must be YYYY-MM.' })
  month?: string;
}

export class FeeCollectionQueryDto extends CampusPeriodQueryDto {
  @ApiPropertyOptional({
    enum: ['DAY', 'MONTH', 'CAMPUS'],
    description: 'How to group the payments; default DAY.',
  })
  @IsOptional()
  @IsIn(['DAY', 'MONTH', 'CAMPUS'])
  groupBy?: 'DAY' | 'MONTH' | 'CAMPUS';
}
