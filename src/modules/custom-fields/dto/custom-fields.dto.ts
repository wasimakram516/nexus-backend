import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  CustomFieldInputType,
  ModuleKey,
  UserRole,
} from '../../../prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsIn,
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

/**
 * Role-based visibility rule stored on `CustomFieldDefinition.visibilityRules`.
 * An unset or empty `roles` list means the field is visible to every role
 * (see `isCustomFieldDefinitionVisibleToRole` for the enforcement side).
 */
export class CustomFieldVisibilityRulesDto {
  @ApiPropertyOptional({
    enum: UserRole,
    isArray: true,
    description:
      'Roles allowed to see and set this field. Omitted or empty means visible to every role.',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(UserRole, { each: true })
  roles?: UserRole[];
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
    description:
      'Optional typed default matching the selected input type (text, number, boolean, or choice array).',
  })
  @IsOptional()
  defaultValue?: unknown;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  validation?: Record<string, unknown>;

  @ApiPropertyOptional({ type: CustomFieldVisibilityRulesDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CustomFieldVisibilityRulesDto)
  visibilityRules?: CustomFieldVisibilityRulesDto;

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

export class FormCustomFieldDefinitionsQueryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  entityType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  institutionId?: string;

  @ApiProperty({ enum: ['create', 'read', 'update'] })
  @IsIn(['create', 'read', 'update'])
  action!: 'create' | 'read' | 'update';
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
