import { SetMetadata } from '@nestjs/common';
import { ModuleKey } from '../../prisma/client';

export const MODULE_PERMISSION_KEY = 'module_permission';
export const SKIP_MODULE_PERMISSION_KEY = 'skip_module_permission';

/**
 * Declares which module a controller (or route) belongs to for
 * permission checks: GET requests require `view`, mutations require `manage`.
 * SUPERADMIN and institution ADMIN bypass the check.
 */
export const ModulePermission = (moduleKey: ModuleKey) =>
  SetMetadata(MODULE_PERMISSION_KEY, moduleKey);

/**
 * Exempts a route from the module permission check — for self-service
 * routes whose services already scope data to the requesting user.
 */
export const SkipModulePermission = () =>
  SetMetadata(SKIP_MODULE_PERMISSION_KEY, true);
