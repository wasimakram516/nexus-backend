import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Theme color tokens an institution may override, as dot paths into the frontend
 * theme palette. Keep in sync with the frontend catalog (src/theme/branding-tokens.ts).
 */
export const BRANDING_COLOR_TOKENS = [
  'primary.main',
  'primary.light',
  'primary.dark',
  'primary.contrastText',
  'secondary.main',
  'secondary.light',
  'secondary.dark',
  'secondary.contrastText',
  'background.default',
  'background.paper',
  'text.primary',
  'text.secondary',
  'divider',
  'status.error',
  'status.warning',
  'status.success',
  'status.info',
] as const;

export type BrandingColorToken = (typeof BRANDING_COLOR_TOKENS)[number];
export type BrandingColorMode = 'light' | 'dark';
export type BrandingColorOverrides = Partial<
  Record<BrandingColorMode, Partial<Record<BrandingColorToken, string>>>
>;

const MODES: readonly string[] = ['light', 'dark'];
const TOKENS: ReadonlySet<string> = new Set(BRANDING_COLOR_TOKENS);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns a human-readable reason the value is not valid color overrides, or null when it is.
 * Accepted shape: { light?: { [token]: "#RRGGBB" }, dark?: { [token]: "#RRGGBB" } }.
 */
export function describeInvalidColorOverrides(value: unknown): string | null {
  if (!isPlainObject(value)) return 'colorOverrides must be an object';
  for (const [mode, tokens] of Object.entries(value)) {
    if (!MODES.includes(mode)) return `unknown mode "${mode}" (use light or dark)`;
    if (!isPlainObject(tokens)) return `${mode} must be an object of token colors`;
    for (const [token, color] of Object.entries(tokens)) {
      if (!TOKENS.has(token)) return `unknown color token "${mode}.${token}"`;
      if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
        return `${mode}.${token} must be a hex color like #1E3A8A`;
      }
    }
  }
  return null;
}

/**
 * Validates per-institution theme color overrides: known modes and tokens only,
 * every value a 6-digit hex color. null and undefined are left to @IsOptional().
 */
export function IsBrandingColorOverrides(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isBrandingColorOverrides',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => describeInvalidColorOverrides(value) === null,
        defaultMessage: (args) =>
          `${args?.property}: ${describeInvalidColorOverrides(args?.value) ?? 'invalid'}`,
      },
    });
  };
}
