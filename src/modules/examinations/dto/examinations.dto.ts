import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CustomFieldPayloadDto } from '../../../common/dto/custom-field-payload.dto';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class GradeBandInputDto {
  @ApiProperty({ description: 'e.g. "A+", "B", "F"' })
  @IsString()
  @MaxLength(20)
  grade!: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  minPercentage!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  maxPercentage!: number;

  @ApiPropertyOptional({ description: 'e.g. "Excellent", "Fail"' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  remarks?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateGradingScaleDto {
  @ApiProperty({ description: 'e.g. "Standard Percentage Scale"' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ type: [GradeBandInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GradeBandInputDto)
  bands!: GradeBandInputDto[];
}

export class UpdateGradingScaleDto extends PartialType(CreateGradingScaleDto) {}

export class CreateExamTermDto extends CustomFieldPayloadDto {
  @ApiProperty()
  @IsUUID()
  academicYearId!: string;

  @ApiProperty({ description: 'e.g. "First Term", "Annual"' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    description: 'Weight in the annual aggregate. Defaults to 1.00.',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  weight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateExamTermDto extends PartialType(CreateExamTermDto) {}

export class CreateExamDto extends CustomFieldPayloadDto {
  @ApiProperty()
  @IsUUID()
  classId!: string;

  @ApiProperty()
  @IsUUID()
  examTermId!: string;

  @ApiProperty({ description: 'e.g. "First Term Examination"' })
  @IsString()
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({
    description:
      "Defaults to the institution's current grading scale when omitted.",
  })
  @IsOptional()
  @IsUUID()
  gradingScaleId?: string;
}

/** classId, examTermId and the retake fields are immutable after creation. */
export class UpdateExamDto extends CustomFieldPayloadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({
    description: 'Only editable while the exam is DRAFT.',
  })
  @IsOptional()
  @IsUUID()
  gradingScaleId?: string;
}

export enum RetakeExamType {
  RETAKE = 'RETAKE',
  IMPROVEMENT = 'IMPROVEMENT',
  SUPPLEMENTARY = 'SUPPLEMENTARY',
}

export class CreateRetakeExamDto extends CustomFieldPayloadDto {
  @ApiProperty({ enum: RetakeExamType })
  @IsEnum(RetakeExamType)
  examType!: RetakeExamType;

  @ApiProperty()
  @IsString()
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({
    description:
      "Defaults to the original exam's term. Must belong to the same academic year.",
  })
  @IsOptional()
  @IsUUID()
  examTermId?: string;

  @ApiPropertyOptional({
    description: "Defaults to the original exam's grading scale.",
  })
  @IsOptional()
  @IsUUID()
  gradingScaleId?: string;
}

export class ListExamsQueryDto {
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
  examTermId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED'])
  status?: 'DRAFT' | 'PUBLISHED';

  @ApiPropertyOptional({
    enum: ['REGULAR', 'RETAKE', 'IMPROVEMENT', 'SUPPLEMENTARY'],
  })
  @IsOptional()
  @IsIn(['REGULAR', 'RETAKE', 'IMPROVEMENT', 'SUPPLEMENTARY'])
  examType?: 'REGULAR' | 'RETAKE' | 'IMPROVEMENT' | 'SUPPLEMENTARY';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  originalExamId?: string;
}

const TIME_FORMAT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateExamSubjectDto extends CustomFieldPayloadDto {
  @ApiProperty()
  @IsUUID()
  examId!: string;

  @ApiProperty()
  @IsUUID()
  subjectId!: string;

  @ApiProperty({ minimum: 0.01, maximum: 9999.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999.99)
  maxMarks!: number;

  @ApiProperty({ minimum: 0, maximum: 9999.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999.99)
  passingMarks!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  examDate?: string;

  @ApiPropertyOptional({ example: '09:00', description: '24-hour "HH:mm".' })
  @IsOptional()
  @Matches(TIME_FORMAT_REGEX, { message: 'startTime must be in HH:mm format.' })
  startTime?: string;

  @ApiPropertyOptional({ example: '11:00', description: '24-hour "HH:mm".' })
  @IsOptional()
  @Matches(TIME_FORMAT_REGEX, { message: 'endTime must be in HH:mm format.' })
  endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  room?: string;
}

/** The exam and subject of a paper are immutable after creation. */
export class UpdateExamSubjectDto extends OmitType(
  PartialType(CreateExamSubjectDto),
  ['examId', 'subjectId'] as const,
) {}

export class ListExamSubjectsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  examId?: string;
}
