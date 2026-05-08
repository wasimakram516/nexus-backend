import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';
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
  lateThreshold!: number;

  @ApiProperty()
  earlyLeaveThreshold!: number;
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
