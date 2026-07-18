import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Feature x action matrix, e.g. { "students": { "read": true, "update": true } }. Unknown feature keys and actions are dropped against the permission catalog.',
  })
  @IsObject()
  permissions!: Record<string, unknown>;
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}
