export type PermissionAction = 'view' | 'manage';

export interface ModulePermissionState {
  view: boolean;
  manage: boolean;
}

/** Effective per-module permissions, keyed by ModuleKey. */
export type ModulePermissionMap = Record<string, ModulePermissionState>;

export type PermissionOverrideEffect = 'allow' | 'deny';

/**
 * Per-user overrides layered on top of the base (template or role defaults).
 * An entry replaces the base value for that module/action only.
 */
export type PermissionOverrides = Record<
  string,
  {
    view?: PermissionOverrideEffect;
    manage?: PermissionOverrideEffect;
  }
>;
