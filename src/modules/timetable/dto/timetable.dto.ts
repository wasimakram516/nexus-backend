import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import { DayOfWeek } from '../../../prisma/client';

/** "HH:mm", 24-hour clock — same convention as Campus.studentStartTime, just
 *  enforced at the DTO layer here since Timetable is a brand-new resource
 *  (no pre-existing loosely-formatted rows to stay compatible with). */
const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreatePeriodSlotDto {
  @ApiProperty({
    description:
      "Must match sectionId's own class (400 on mismatch) — stored denormalized on PeriodSlot purely so class-wide list queries skip a join.",
  })
  @IsUUID()
  classId!: string;

  @ApiProperty({
    description:
      'The authoritative scheduling unit (§ 4 of M3-SCHEDULING-COMMUNICATION-DESIGN.md) — campusId is resolved server-side from this, never client-supplied.',
  })
  @IsUUID()
  sectionId!: string;

  @ApiPropertyOptional({
    description: 'Omit for recess/assembly/study-hall slots with no subject.',
  })
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({
    description:
      'Omit for an unassigned/TBD slot. When both subjectId and staffProfileId are given, an active TeacherSubject allocation for (staffProfileId, classId, subjectId, sectionId) must already exist (409 otherwise).',
  })
  @IsOptional()
  @IsUUID()
  staffProfileId?: string;

  @ApiProperty({
    example: 'Period 1',
    description: 'e.g. "Period 1", "Recess", "Assembly".',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Sequence position within the day; also the natural sort key.',
  })
  @IsInt()
  @Min(1)
  periodNumber!: number;

  @ApiProperty({ enum: DayOfWeek })
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @ApiProperty({ example: '08:00', description: '24-hour "HH:mm".' })
  @IsString()
  @Matches(TIME_FORMAT_REGEX, {
    message: 'startTime must be in HH:mm format.',
  })
  startTime!: string;

  @ApiProperty({ example: '08:40', description: '24-hour "HH:mm".' })
  @IsString()
  @Matches(TIME_FORMAT_REGEX, { message: 'endTime must be in HH:mm format.' })
  endTime!: string;
}

export class UpdatePeriodSlotDto extends PartialType(CreatePeriodSlotDto) {}

export class ListPeriodSlotsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campusId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @ApiPropertyOptional({ enum: DayOfWeek })
  @IsOptional()
  @IsEnum(DayOfWeek)
  dayOfWeek?: DayOfWeek;
}
