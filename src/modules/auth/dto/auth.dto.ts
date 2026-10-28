import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../../common/enums/domain.enums';

export class RegisterDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role!: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  institutionId?: string;

  @ApiPropertyOptional({
    description:
      'Role that gives the new account its base permissions. Not allowed for admin-level accounts. Without one, staff have no access until a role is assigned.',
  })
  @IsOptional()
  @IsUUID()
  roleId?: string;
}

export class LoginDto {
  @ApiProperty({
    description:
      'Email (staff/admin), registration number (student), or phone number (guardian).',
  })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}

export class RevokeSessionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sessionId?: string;
}

/** bcrypt only reads the first 72 bytes, so a longer password would be silently cut short. */
const PASSWORD_MAX = 72;

export class ForgotPasswordDto {
  @ApiProperty({
    description:
      'The email address, registration number or phone number the account signs in with.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'The token from the reset link.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string;

  @ApiProperty({ minLength: 8, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ minLength: 8, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX)
  newPassword!: string;
}
