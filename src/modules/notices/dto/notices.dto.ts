import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { UserRole } from '../../../prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Maximum attachments a single notice may carry (§ 7.3 of
 *  M3-SCHEDULING-COMMUNICATION-DESIGN.md — same house pattern as
 *  BulkMarkAttendanceDto.entries's @ArrayMaxSize(200)). */
const MAX_NOTICE_ATTACHMENTS = 5;

/**
 * Mirrors UploadService's `UploadResult` interface (src/modules/upload/upload.service.ts)
 * field-for-field. The frontend calls POST /upload once per file first, then
 * submits the resulting array as-is here — kept as a separate DTO rather
 * than importing UploadResult directly so the wire-validation contract
 * (class-validator decorators) doesn't depend on an internal service
 * interface's shape changing silently.
 */
export class NoticeAttachmentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  url!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  publicId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  resourceType!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  format!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  folder!: string;

  @ApiProperty()
  @IsNumber()
  bytes!: number;
}

export class CreateNoticeDto {
  @ApiPropertyOptional({
    description: 'Omit for an institution-wide notice.',
  })
  @IsOptional()
  @IsUUID()
  campusId?: string;

  @ApiPropertyOptional({
    description:
      'Must belong to campusId when both are given (400 on mismatch).',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional({
    description:
      'Must belong to classId when both are given (400 on mismatch).',
  })
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  targetRole?: UserRole;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  body!: string;

  @ApiPropertyOptional({ type: [NoticeAttachmentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_NOTICE_ATTACHMENTS)
  @ValidateNested({ each: true })
  @Type(() => NoticeAttachmentDto)
  attachments?: NoticeAttachmentDto[];

  @ApiPropertyOptional({
    description: 'Defaults to now() when omitted.',
  })
  @IsOptional()
  @IsDateString()
  publishAt?: string;

  @ApiPropertyOptional({
    description: 'Omit for a notice that never expires.',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateNoticeDto extends PartialType(CreateNoticeDto) {}

export class ListNoticesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campusId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  targetRole?: UserRole;

  @ApiPropertyOptional({
    description:
      'When false (default), notices whose publish window has already ended are excluded.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeExpired?: boolean;
}

export class ListNoticesForMeQueryDto extends PaginationQueryDto {}
