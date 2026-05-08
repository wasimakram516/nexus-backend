import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AttendanceStatus } from '../../../common/enums/domain.enums';
import { UserRole } from '../../../prisma/client';

export class CheckInDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsDateString() date!: string;
  @ApiProperty() @IsDateString() checkIn!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class CheckOutDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsDateString() date!: string;
  @ApiProperty() @IsDateString() checkOut!: string;
}

export class MarkLeaveDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsDateString() date!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class AutoAbsentDto {
  @ApiProperty() @IsUUID() campusId!: string;
  @ApiProperty() @IsDateString() date!: string;
}

export class UpdateAttendanceRecordDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() checkIn?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() checkOut?: string;
  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() halfDay?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

export class ListAttendanceQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() campusId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateTo?: string;
}
