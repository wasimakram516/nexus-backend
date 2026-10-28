import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { UserRole, UserStatus } from '../../../common/enums/domain.enums';
import { CustomFieldPayloadDto } from '../../../common/dto/custom-field-payload.dto';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PermissionOverrides } from '../../../common/interfaces/permission.interface';

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;

  @ApiPropertyOptional({
    description: 'Required when setting a new password.',
  })
  @IsOptional()
  @IsString()
  currentPassword?: string;
}

export class UpdateUserRoleDto extends CustomFieldPayloadDto {
  @ApiPropertyOptional({
    enum: UserRole,
    description: 'Optional role change for the target user.',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    enum: UserStatus,
    description:
      'Optional account status change. Use this to suspend or reactivate a user without deleting the account.',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class UpdateUserAccessDto extends UpdateUserRoleDto {
  @ApiPropertyOptional({ description: 'The person’s display name.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Sign-in email. Only an administrator can change it, and it must be unused.',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description:
      'A new password set by an administrator. The person must replace it at their next sign-in and every device is signed out.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Role assigned as the user base permissions. Pass null to clear (STAFF users then have zero access until reassigned; STUDENT/GUARDIAN fall back to self-service defaults). Not assignable to admin-level users.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  roleId?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'Per-user permission overrides keyed by feature: { fee_vouchers: { create: "allow", delete: "deny" } }. Overrides replace the base value per feature/action. Pass null to clear.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsObject()
  permissionOverrides?: PermissionOverrides | null;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Superadmin-only filter to scope results to one institution. Ignored for institution admins, who are always scoped to their own institution.',
  })
  @IsOptional()
  @IsUUID()
  institutionId?: string;

  @ApiPropertyOptional({
    enum: UserRole,
    description: 'Optional role filter.',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class ResolveUsersQueryDto {
  @ApiProperty({
    description:
      'Comma-separated user IDs to resolve to display names, e.g. for a record-metadata popover showing createdBy/updatedBy.',
  })
  @IsString()
  @IsNotEmpty()
  ids!: string;
}
