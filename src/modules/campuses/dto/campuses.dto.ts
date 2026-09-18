import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { CustomFieldPayloadDto } from '../../../common/dto/custom-field-payload.dto';

export class CreateCampusDto extends CustomFieldPayloadDto {
  @ApiProperty()
  @IsUUID()
  institutionId!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsString()
  location!: string;

  @ApiProperty()
  @IsString()
  studentStartTime!: string;

  @ApiProperty()
  @IsString()
  studentEndTime!: string;

  @ApiProperty()
  @IsString()
  staffStartTime!: string;

  @ApiProperty()
  @IsString()
  staffEndTime!: string;

  @ApiProperty()
  @IsNumber()
  lateThreshold!: number;

  @ApiProperty()
  @IsNumber()
  earlyLeaveThreshold!: number;

  @ApiPropertyOptional({
    description:
      'Optional per-campus IANA timezone override (e.g. "Asia/Dubai"). Null/omitted falls back to the parent Institution.timezone. Validated against a real IANA zone by TimezoneResolverService.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  timezone?: string;
}

export class UpdateCampusDto extends PartialType(CreateCampusDto) {}

export class AssignUserCampusDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiProperty()
  @IsUUID()
  campusId!: string;
}

export class CampusUsersQueryDto {
  @ApiPropertyOptional()
  @IsUUID()
  campusId?: string;
}

export class RemoveUserCampusDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiProperty()
  @IsUUID()
  campusId!: string;
}
