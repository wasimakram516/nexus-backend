import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeleteRecordDto {
  @ApiPropertyOptional({
    description:
      'Optional reason captured in the record lifecycle metadata when the item is moved to the recycle bin.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
