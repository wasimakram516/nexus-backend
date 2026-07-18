import { PermissionAction } from '../constants/permission-catalog.constant';

/** Effective per-feature permission state, keyed by feature key. */
export type FeaturePermissionMap = Record<
  string,
  Partial<Record<PermissionAction, boolean>>
>;

export type PermissionOverrideEffect = 'allow' | 'deny';

/**
 * Per-user overrides layered on top of the base (assigned Role, else empty).
 * An entry replaces the base value for that feature/action only.
 */
export type PermissionOverrides = Record<
  string,
  Partial<Record<PermissionAction, PermissionOverrideEffect>>
>;
