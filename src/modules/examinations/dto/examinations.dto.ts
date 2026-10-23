import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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

export class CreateExamTermDto {
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
