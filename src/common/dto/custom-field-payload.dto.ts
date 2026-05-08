import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

export class CustomFieldPayloadDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Optional dynamic fields defined through the custom fields module.',
  })
  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}
