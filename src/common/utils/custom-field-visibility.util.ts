import { UserRole } from '../../prisma/client';

/**
 * Extracts a validated list of allowed roles from a definition's raw
 * `visibilityRules` JSON value.
 *
 * Scope decision (§ M4.5 / P1-2a follow-up — "plan and visibility rules are
 * enforced consistently on read and write"): `visibilityRules` was stored on
 * `CustomFieldDefinition` but never had a real shape decided, and nothing in
 * the codebase reads it yet. Of the two plausible real-world needs for a
 * school ERP — role-based visibility, or conditional-on-another-field
 * visibility — only role-based visibility is built here. It is the more
 * common real need for multi-archetype forms like Student/Guardian/Staff
 * (e.g. an internal HR note that shouldn't be visible to a self-service
 * GUARDIAN read view), and nothing anywhere references the conditional-field
 * variant, so that scope is intentionally left out rather than built
 * speculatively.
 *
 * Shape: `{ roles?: UserRole[] }`. An unset, empty, or malformed `roles`
 * list means the field is ungated and visible to every role — identical
 * behavior to an unset `planKeys` on `isCustomFieldDefinitionPlanAllowed`,
 * which preserves current behavior for every definition created before this
 * gate existed (none of them set visibilityRules).
 *
 * @param {unknown} visibilityRules - The definition's raw `visibilityRules` JSON value.
 * @returns {UserRole[] | null} The configured allow-list, or null when the field is ungated.
 */
function extractAllowedRoles(visibilityRules: unknown): UserRole[] | null {
  if (
    !visibilityRules ||
    typeof visibilityRules !== 'object' ||
    Array.isArray(visibilityRules)
  ) {
    return null;
  }

  const roles = (visibilityRules as Record<string, unknown>).roles;
  if (!Array.isArray(roles) || roles.length === 0) {
    return null;
  }

  const knownRoles = new Set<string>(Object.values(UserRole));
  const validated = roles.filter(
    (role): role is UserRole =>
      typeof role === 'string' && knownRoles.has(role),
  );

  return validated.length > 0 ? validated : null;
}

/**
 * Evaluates whether a custom field definition is visible to the given
 * actor's role (§ M4.5 / P1-2a follow-up "visibilityRules enforcement").
 *
 * Mirrors `isCustomFieldDefinitionPlanAllowed`'s shape exactly: an unset or
 * empty rule means "visible to everyone", and a missing/unresolvable role
 * against an explicitly role-gated field fails closed rather than silently
 * allowing it.
 *
 * This is a plain allow-list check with no implicit bypass for any role
 * (including SUPERADMIN/ADMIN) — a definition intended to also be visible
 * to admins must explicitly include that role in the list. Definition
 * *management* surfaces (listing/editing definitions themselves) are not
 * gated by this function at all; only form-rendering and value read/write
 * paths are, matching the same asymmetry `planKeys` already established
 * between `listDefinitions` (ungated) and `listFormDefinitions` (gated).
 *
 * @param {unknown} visibilityRules - The definition's raw `visibilityRules` JSON value.
 * @param {UserRole | null | undefined} role - The acting user's role, or null/undefined when unresolvable.
 * @returns {boolean} Whether the field is visible to this role.
 */
export function isCustomFieldDefinitionVisibleToRole(
  visibilityRules: unknown,
  role: UserRole | null | undefined,
): boolean {
  const allowedRoles = extractAllowedRoles(visibilityRules);
  if (!allowedRoles) {
    return true;
  }

  if (!role) {
    return false;
  }

  return allowedRoles.includes(role);
}
