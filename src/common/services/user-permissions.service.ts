import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '../../prisma/client';
import { CurrentUser } from '../interfaces/current-user.interface';
import {
  FeaturePermissionMap,
  PermissionOverrides,
} from '../interfaces/permission.interface';
import {
  PERMISSION_CATALOG,
  PermissionAction,
  isKnownFeatureAction,
} from '../constants/permission-catalog.constant';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Base feature access applied when a STUDENT/GUARDIAN has no Role assigned —
 * mirrors the pre-redesign behavior where every self-service archetype could
 * see their own attendance with no configuration required. STAFF gets no
 * such default: a roleless staff user has zero access until an institution
 * ADMIN assigns them a Role, which is the entire point of the redesign.
 */
const SELF_SERVICE_DEFAULTS: Partial<
  Record<
    UserRole,
    Partial<Record<string, Partial<Record<PermissionAction, boolean>>>>
  >
> = {
  [UserRole.STUDENT]: { attendance: { read: true } },
  [UserRole.GUARDIAN]: { attendance: { read: true } },
};

@Injectable()
export class UserPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Computes the effective feature x action permission map: base (assigned
   * Role, else the self-service defaults for STUDENT/GUARDIAN) overlaid with
   * per-user overrides (allow/deny per feature/action).
   */
  resolveEffectivePermissions(
    role: UserRole,
    rolePermissions: Prisma.JsonValue | null | undefined,
    overrides: Prisma.JsonValue | null | undefined,
  ): FeaturePermissionMap {
    const base = this.readPermissionMap(rolePermissions);
    const defaults = SELF_SERVICE_DEFAULTS[role] ?? {};
    const parsedOverrides = this.readOverrides(overrides);
    const map: FeaturePermissionMap = {};

    for (const feature of PERMISSION_CATALOG) {
      const fromBase = base?.[feature.key];
      const fromDefaults = defaults[feature.key];
      const override = parsedOverrides[feature.key];
      const state: Partial<Record<PermissionAction, boolean>> = {};

      for (const action of feature.actions) {
        const baseValue = fromBase
          ? Boolean(fromBase[action])
          : Boolean(fromDefaults?.[action]);
        const overrideValue = override?.[action];
        state[action] =
          overrideValue !== undefined ? overrideValue === 'allow' : baseValue;
      }

      map[feature.key] = state;
    }

    return map;
  }

  /**
   * Effective permissions for a user, or null when the role is exempt
   * (SUPERADMIN and institution ADMIN have full access).
   */
  async getEffectivePermissionsForUser(
    userId: string,
  ): Promise<FeaturePermissionMap | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        permissionOverrides: true,
        assignedRole: {
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

    const rolePermissions =
      user.assignedRole && !user.assignedRole.deletedAt
        ? user.assignedRole.permissions
        : null;

    return this.resolveEffectivePermissions(
      user.role,
      rolePermissions,
      user.permissionOverrides,
    );
  }

  async can(
    currentUser: CurrentUser,
    featureKey: string,
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

    return Boolean(map[featureKey]?.[action]);
  }

  /** Sanitizes arbitrary JSON into the override shape, dropping unknown
   *  feature keys and actions not defined in the catalog. */
  sanitizeOverrides(value: unknown): PermissionOverrides {
    const sanitized: PermissionOverrides = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return sanitized;
    }

    for (const [featureKey, entry] of Object.entries(value)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      const cleaned: PermissionOverrides[string] = {};
      for (const [action, effect] of Object.entries(candidate)) {
        if (
          (effect === 'allow' || effect === 'deny') &&
          isKnownFeatureAction(featureKey, action)
        ) {
          cleaned[action as PermissionAction] = effect;
        }
      }
      if (Object.keys(cleaned).length > 0) {
        sanitized[featureKey] = cleaned;
      }
    }

    return sanitized;
  }

  /** Sanitizes arbitrary JSON into a Role's permissions shape, dropping
   *  unknown feature keys and actions not defined in the catalog. */
  sanitizeRolePermissions(value: unknown): FeaturePermissionMap {
    const sanitized: FeaturePermissionMap = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return sanitized;
    }

    for (const [featureKey, entry] of Object.entries(value)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      const cleaned: Partial<Record<PermissionAction, boolean>> = {};
      for (const [action, allowed] of Object.entries(candidate)) {
        if (
          typeof allowed === 'boolean' &&
          isKnownFeatureAction(featureKey, action)
        ) {
          cleaned[action as PermissionAction] = allowed;
        }
      }
      if (Object.keys(cleaned).length > 0) {
        sanitized[featureKey] = cleaned;
      }
    }

    return sanitized;
  }

  private readPermissionMap(
    value: Prisma.JsonValue | null | undefined,
  ): FeaturePermissionMap | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return this.sanitizeRolePermissions(value);
  }

  private readOverrides(
    value: Prisma.JsonValue | null | undefined,
  ): PermissionOverrides {
    return this.sanitizeOverrides(value);
  }
}
