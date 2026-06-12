import { Injectable } from '@nestjs/common';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import { CurrentUser } from '../interfaces/current-user.interface';
import {
  ModulePermissionMap,
  PermissionAction,
  PermissionOverrides,
} from '../interfaces/module-permissions.interface';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Base permissions applied when a user has NO permission template assigned.
 * Mirrors the pre-permission-system role gates so shipping this is behavior-neutral:
 * staff roles previously had no access to admin-gated module routes, accountants
 * could work the finance module, and everyone could see their own attendance.
 */
const ROLE_DEFAULT_PERMISSIONS: Partial<
  Record<UserRole, Partial<Record<ModuleKey, { view?: boolean; manage?: boolean }>>>
> = {
  [UserRole.TEACHER]: {
    [ModuleKey.ATTENDANCE]: { view: true },
  },
  [UserRole.STUDENT]: {
    [ModuleKey.ATTENDANCE]: { view: true },
  },
  [UserRole.GUARDIAN]: {
    [ModuleKey.ATTENDANCE]: { view: true },
  },
  [UserRole.ACCOUNTANT]: {
    [ModuleKey.FINANCE]: { view: true, manage: true },
    [ModuleKey.ATTENDANCE]: { view: true },
  },
};

@Injectable()
export class UserPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Computes the effective module permission map:
   * base (assigned template, else role defaults) overlaid with per-user
   * overrides (allow/deny per module/action). Manage implies view.
   */
  resolveEffectivePermissions(
    role: UserRole,
    templatePermissions: Prisma.JsonValue | null | undefined,
    overrides: Prisma.JsonValue | null | undefined,
  ): ModulePermissionMap {
    const base = this.readPermissionMap(templatePermissions);
    const roleDefaults = ROLE_DEFAULT_PERMISSIONS[role] ?? {};
    const parsedOverrides = this.readOverrides(overrides);
    const map: ModulePermissionMap = {};

    for (const moduleKey of Object.values(ModuleKey)) {
      const fromBase = base
        ? (base[moduleKey] ?? { view: false, manage: false })
        : {
            view: roleDefaults[moduleKey]?.view ?? false,
            manage: roleDefaults[moduleKey]?.manage ?? false,
          };

      const override = parsedOverrides[moduleKey];
      const view =
        override?.view !== undefined ? override.view === 'allow' : fromBase.view;
      const manage =
        override?.manage !== undefined
          ? override.manage === 'allow'
          : fromBase.manage;

      map[moduleKey] = { view: view || manage, manage };
    }

    return map;
  }

  /**
   * Effective permissions for a user, or null when the role is exempt
   * (SUPERADMIN and institution ADMIN have full access).
   */
  async getEffectivePermissionsForUser(
    userId: string,
  ): Promise<ModulePermissionMap | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        permissionOverrides: true,
        permissionTemplate: {
          select: { permissions: true, deletedAt: true },
        },
      },
    });

    if (!user) {
      return this.resolveEffectivePermissions(UserRole.STUDENT, null, null);
    }

    if (user.role === UserRole.SUPERADMIN || user.role === UserRole.ADMIN) {
      return null;
    }

    const templatePermissions =
      user.permissionTemplate && !user.permissionTemplate.deletedAt
        ? user.permissionTemplate.permissions
        : null;

    return this.resolveEffectivePermissions(
      user.role,
      templatePermissions,
      user.permissionOverrides,
    );
  }

  async can(
    currentUser: CurrentUser,
    moduleKey: ModuleKey,
    action: PermissionAction,
  ): Promise<boolean> {
    if (
      currentUser.role === UserRole.SUPERADMIN ||
      currentUser.role === UserRole.ADMIN
    ) {
      return true;
    }

    const map = await this.getEffectivePermissionsForUser(currentUser.sub);
    if (!map) {
      return true;
    }

    return Boolean(map[moduleKey]?.[action]);
  }

  /** Sanitizes arbitrary JSON into the override shape, dropping unknown keys. */
  sanitizeOverrides(value: unknown): PermissionOverrides {
    const sanitized: PermissionOverrides = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return sanitized;
    }

    const moduleKeys = new Set<string>(Object.values(ModuleKey));
    for (const [key, entry] of Object.entries(value)) {
      if (!moduleKeys.has(key) || !entry || typeof entry !== 'object') {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      const cleaned: PermissionOverrides[string] = {};
      if (candidate.view === 'allow' || candidate.view === 'deny') {
        cleaned.view = candidate.view;
      }
      if (candidate.manage === 'allow' || candidate.manage === 'deny') {
        cleaned.manage = candidate.manage;
      }
      if (cleaned.view !== undefined || cleaned.manage !== undefined) {
        sanitized[key] = cleaned;
      }
    }

    return sanitized;
  }

  private readPermissionMap(
    value: Prisma.JsonValue | null | undefined,
  ): Record<string, { view: boolean; manage: boolean }> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const map: Record<string, { view: boolean; manage: boolean }> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      map[key] = {
        view: candidate.view === true,
        manage: candidate.manage === true,
      };
    }

    return map;
  }

  private readOverrides(
    value: Prisma.JsonValue | null | undefined,
  ): PermissionOverrides {
    return this.sanitizeOverrides(value);
  }
}
