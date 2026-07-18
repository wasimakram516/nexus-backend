import { SetMetadata } from '@nestjs/common';
import { PermissionAction } from '../constants/permission-catalog.constant';

export const REQUIRE_PERMISSION_KEY = 'require_permission';

export interface RequiredPermission {
  feature: string;
  action: PermissionAction;
}

/**
 * Declares the (feature, action) pair a route requires from the caller's
 * effective permission map (assigned Role, overridden per-user). Routes
 * without this decorator are not permission-gated — used for self-service
 * endpoints (e.g. viewing one's own attendance) whose services already
 * scope data to the requesting user. SUPERADMIN and institution ADMIN
 * bypass this check entirely.
 */
export const RequirePermission = (feature: string, action: PermissionAction) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, {
    feature,
    action,
  } satisfies RequiredPermission);
