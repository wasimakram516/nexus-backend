import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';
import { CustomFieldPayloadDto } from '../../../common/dto/custom-field-payload.dto';

export class CreateLevelDto extends CustomFieldPayloadDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsUUID()
  campusId!: string;
}

export class UpdateLevelDto extends PartialType(CreateLevelDto) {}

export class CreateClassDto extends CustomFieldPayloadDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsUUID()
  levelId!: string;
}

export class UpdateClassDto extends PartialType(CreateClassDto) {}

export class CreateSectionDto extends CustomFieldPayloadDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsUUID()
  classId!: string;
}

export class UpdateSectionDto extends PartialType(CreateSectionDto) {}

export class CreateSubjectDto extends CustomFieldPayloadDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsUUID()
  classId!: string;
}

export class UpdateSubjectDto extends PartialType(CreateSubjectDto) {}
