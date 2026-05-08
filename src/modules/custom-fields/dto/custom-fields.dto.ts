import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CustomFieldInputType, ModuleKey } from '../../../prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CustomFieldOptionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  value!: string;
}

export class CreateCustomFieldDefinitionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  institutionId?: string;

  @ApiProperty({ enum: ModuleKey })
  @IsEnum(ModuleKey)
  moduleKey!: ModuleKey;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  entityType!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fieldKey!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({ enum: CustomFieldInputType })
  @IsEnum(CustomFieldInputType)
  inputType!: CustomFieldInputType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  placeholder?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  helpText?: string;

  @ApiPropertyOptional({
    type: [CustomFieldOptionDto],
    description:
      'Required for SELECT, MULTI_SELECT, CHECKBOX, and RADIO fields.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomFieldOptionDto)
  options?: CustomFieldOptionDto[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Optional rules like accepted mime types, max file size, regex, min/max values, or URL/email/phone hints.',
  })
  @IsOptional()
  @IsObject()
  defaultValue?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  validation?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  visibilityRules?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  planKeys?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateCustomFieldDefinitionDto extends PartialType(
  CreateCustomFieldDefinitionDto,
) {}

export class ListCustomFieldDefinitionsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  institutionId?: string;

  @ApiPropertyOptional({ enum: ModuleKey })
  @IsOptional()
  @IsEnum(ModuleKey)
  moduleKey?: ModuleKey;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpsertCustomFieldValueDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  institutionId?: string;

  @ApiProperty()
  @IsUUID()
  definitionId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  entityId!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsDefined()
  value!: unknown;
}

export class ListCustomFieldValuesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  institutionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  definitionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityId?: string;
}
