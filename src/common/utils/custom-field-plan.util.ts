/**
 * Evaluates whether a custom field definition is available under an
 * institution's current plan (§ M4.5 / P1-2a shared blocker "plan and
 * visibility rules are enforced consistently on read and write").
 *
 * `planKeys` is the raw JSON column value on `CustomFieldDefinition` — an
 * optional allowlist of plan keys the field is scoped to. An unset or empty
 * list means the field is ungated and available on every plan, which
 * preserves current behavior for every definition created before this gate
 * existed (none of them set planKeys).
 *
 * @param {unknown} planKeys - The definition's raw `planKeys` JSON value.
 * @param {string | null} currentPlanKey - The institution's resolved plan key, or null when none can be resolved (e.g. a dedicated/self-hosted deployment with no subscription row).
 * @returns {boolean} Whether the field is usable under the current plan.
 */
export function isCustomFieldDefinitionPlanAllowed(
  planKeys: unknown,
  currentPlanKey: string | null,
): boolean {
  if (!Array.isArray(planKeys) || planKeys.length === 0) {
    return true;
  }

  if (!currentPlanKey) {
    return false;
  }

  return planKeys.includes(currentPlanKey);
}
