import { DeploymentMode, ModuleKey, Prisma } from '../../prisma/client';

/**
 * A plan keeps its modules, deployment modes and price in loose columns, so
 * these read each one safely, dropping anything that is not a known value.
 */

/**
 * @param {Prisma.JsonValue} value - The stored list of modules.
 * @returns {ModuleKey[]} The modules in it that exist.
 */
export function readModuleKeys(value: Prisma.JsonValue): ModuleKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ModuleKey =>
    Object.values(ModuleKey).includes(item as ModuleKey),
  );
}

/**
 * @param {Prisma.JsonValue} value - The stored list of deployment modes.
 * @returns {DeploymentMode[]} The deployment modes in it that exist.
 */
export function readDeploymentModes(value: Prisma.JsonValue): DeploymentMode[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DeploymentMode =>
    Object.values(DeploymentMode).includes(item as DeploymentMode),
  );
}

/**
 * @param {Prisma.Decimal | Prisma.JsonValue | number | null | undefined} value - A stored price.
 * @returns {number | null} The price as a number, or null when there is none.
 */
export function readPrice(
  value: Prisma.Decimal | Prisma.JsonValue | number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
