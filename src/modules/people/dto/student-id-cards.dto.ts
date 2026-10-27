import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class IdCardsQueryDto {
  @ApiProperty({ description: 'The campus whose students get cards.' })
  @IsUUID()
  campusId!: string;

  @ApiPropertyOptional({ description: 'Only this class.' })
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional({ description: 'Only this section.' })
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @ApiPropertyOptional({ description: 'Only this student.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}
