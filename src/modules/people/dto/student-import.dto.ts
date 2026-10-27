import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** The most lines one file may have. */
export const IMPORT_MAX_ROWS = 1000;
/** The most lines saved in one request, so a request stays well inside a server's time limit. */
export const IMPORT_CHUNK_ROWS = 15;

/** An optional piece of text from the file. */
const Text = () =>
  applyDecorators(
    ApiPropertyOptional(),
    IsOptional(),
    IsString(),
    MaxLength(200),
  );

/** One line of the file. Every column is optional here; the checks say which are needed. */
export class ImportRowDto {
  @Text() name?: string;
  @Text() regNo?: string;
  @Text() email?: string;
  @Text() dob?: string;
  @Text() gender?: string;
  @Text() className?: string;
  @Text() sectionName?: string;
  @Text() admissionDate?: string;
  @Text() religion?: string;
  @Text() cnic?: string;
  @Text() prevSchool?: string;
  @Text() guardianName?: string;
  @Text() guardianPhone?: string;
  @Text() guardianRelation?: string;
}

export class ImportPreviewDto {
  @ApiProperty({ description: 'The campus the students are admitted to.' })
  @IsUUID()
  campusId!: string;

  @ApiProperty({ type: [ImportRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORT_MAX_ROWS)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];
}

export class ImportCommitDto {
  @ApiProperty() @IsUUID() campusId!: string;

  @ApiProperty({ type: [ImportRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORT_CHUNK_ROWS)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];

  @ApiPropertyOptional({
    description:
      'How many lines of the file came before these, so a message names the line in the file.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  rowOffset?: number;
}
