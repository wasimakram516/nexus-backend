import {
  DeploymentMode,
  InstitutionStatus,
  ModuleKey,
  SubscriptionStatus,
} from '../../../prisma/client';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEmail,
  IsEnum,
  IsNumber,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BillingCycle } from '../../../common/enums/domain.enums';

export class CreateInstitutionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  slug!: string;

  @ApiPropertyOptional({ enum: InstitutionStatus })
  @IsOptional()
  @IsEnum(InstitutionStatus)
  status?: InstitutionStatus;

  @ApiPropertyOptional({ enum: DeploymentMode })
  @IsOptional()
  @IsEnum(DeploymentMode)
  deploymentMode?: DeploymentMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  primaryDomain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateInstitutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must be lowercase, alphanumeric and hyphens only',
  })
  slug?: string;

  @ApiPropertyOptional({
    enum: InstitutionStatus,
    description:
      'Optional institution lifecycle change. Use this to activate, inactivate, or suspend an institution without deleting it.',
  })
  @IsOptional()
  @IsEnum(InstitutionStatus)
  status?: InstitutionStatus;

  @ApiPropertyOptional({ enum: DeploymentMode })
  @IsOptional()
  @IsEnum(DeploymentMode)
  deploymentMode?: DeploymentMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  primaryDomain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateBrandingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  primaryColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accentColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  theme?: string;
}

export class UpsertInstitutionSettingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  key!: string;

  // Deliberately untyped — settings are arbitrary per-institution JSON
  // (primitives, objects, or arrays). @IsDefined() only rejects
  // undefined; its real job here is giving class-validator's global
  // ValidationPipe({ whitelist: true }) a recognized decorator so it
  // doesn't strip/reject this property as unknown.
  @ApiProperty()
  @IsDefined()
  value!: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpsertInstitutionSettingsDto {
  @ApiProperty({ type: [UpsertInstitutionSettingDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertInstitutionSettingDto)
  settings!: UpsertInstitutionSettingDto[];
}

export class UpsertEntitlementDto {
  @ApiProperty({ enum: ModuleKey })
  @IsEnum(ModuleKey)
  moduleKey!: ModuleKey;

  @ApiProperty()
  @IsBoolean()
  isEnabled!: boolean;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}

export class UpsertEntitlementsDto {
  @ApiProperty({ type: [UpsertEntitlementDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertEntitlementDto)
  entitlements!: UpsertEntitlementDto[];
}

export class UpdateSubscriptionDto {
  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiPropertyOptional({
    enum: SubscriptionStatus,
    description:
      'Optional subscription lifecycle change. Use this to suspend, cancel, reactivate, or move the subscription through billing states.',
  })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;

  @ApiPropertyOptional({
    description: 'Subscription/trial start date (ISO).',
  })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({
    description:
      'Subscription/trial end date (ISO). Expired TRIAL subscriptions lose module access.',
  })
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  agreedPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ enum: BillingCycle })
  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  setupFee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pricingNotes?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateInstitutionAccessDto extends UpdateInstitutionDto {}

export class UpdateSubscriptionAccessDto extends UpdateSubscriptionDto {}

export class ListInstitutionsQueryDto {
  @ApiPropertyOptional({ enum: InstitutionStatus })
  @IsOptional()
  @IsEnum(InstitutionStatus)
  status?: InstitutionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  planId?: string;
}

export class InstitutionParamDto {
  @ApiProperty()
  @IsUUID()
  institutionId!: string;
}

export class CreatePlanDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  basePrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ enum: BillingCycle })
  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  setupFee?: number;

  @ApiProperty({ enum: DeploymentMode, isArray: true })
  @IsArray()
  @IsEnum(DeploymentMode, { each: true })
  deploymentModes!: DeploymentMode[];

  @ApiProperty({ enum: ModuleKey, isArray: true })
  @IsArray()
  @IsEnum(ModuleKey, { each: true })
  defaultModules!: ModuleKey[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  limits!: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}
