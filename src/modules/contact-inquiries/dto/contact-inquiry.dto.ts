import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ContactInquiryStatus } from '../../../prisma/client';
import { CONTACT_INQUIRY_TYPES } from '../contact-inquiry.constants';

// Control characters except tab (0x09), LF (0x0A) and CR (0x0D).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Strips control characters (keeping tab/newline for messages) and trims.
 * @param {unknown} value Raw incoming value.
 * @returns {unknown} Sanitised string, or the original non-string value.
 */
export const sanitizeText = (value: unknown): unknown =>
  typeof value === 'string' ? value.replace(CONTROL_CHARS, '').trim() : value;

export class CreateContactInquiryDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ maxLength: 254 })
  @Transform(({ value }) => sanitizeText(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MaxLength(160)
  organisation?: string;

  @ApiProperty({ enum: CONTACT_INQUIRY_TYPES })
  @IsIn(CONTACT_INQUIRY_TYPES)
  inquiryType!: string;

  @ApiProperty({ maxLength: 5000 })
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message!: string;
}

export class ListContactInquiriesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({ enum: ContactInquiryStatus })
  @IsOptional()
  @IsEnum(ContactInquiryStatus)
  status?: ContactInquiryStatus;
}

export class UpdateContactInquiryStatusDto {
  @ApiProperty({ enum: ContactInquiryStatus })
  @IsEnum(ContactInquiryStatus)
  status!: ContactInquiryStatus;
}
