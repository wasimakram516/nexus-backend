import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateBrandingDto } from '../../modules/platform/dto/platform.dto';
import {
  BRANDING_COLOR_TOKENS,
  describeInvalidColorOverrides,
} from './branding-color-overrides.validator';

describe('describeInvalidColorOverrides', () => {
  it('accepts per-mode overrides of known tokens with hex colors', () => {
    expect(
      describeInvalidColorOverrides({
        light: { 'primary.main': '#1E3A8A', divider: '#CBD5E1' },
        dark: { 'text.primary': '#eaf0ff' },
      }),
    ).toBeNull();
  });

  it('accepts an empty object and a single mode', () => {
    expect(describeInvalidColorOverrides({})).toBeNull();
    expect(describeInvalidColorOverrides({ dark: {} })).toBeNull();
  });

  it('accepts every catalogued token', () => {
    const all = Object.fromEntries(
      BRANDING_COLOR_TOKENS.map((token) => [token, '#112233']),
    );
    expect(describeInvalidColorOverrides({ light: all, dark: all })).toBeNull();
  });

  it.each([
    ['a non-object', 'red'],
    ['an array', []],
    ['an unknown mode', { sepia: { 'primary.main': '#112233' } }],
    ['a non-object mode', { light: 'x' }],
    ['an unknown token', { light: { 'primary.hover': '#112233' } }],
    ['a short hex', { light: { 'primary.main': '#123' } }],
    ['an rgba string', { light: { divider: 'rgba(0,0,0,0.1)' } }],
    ['a css color name', { light: { 'primary.main': 'navy' } }],
    ['a non-string value', { light: { 'primary.main': 123 } }],
    ['script injection', { light: { 'primary.main': '#112233;}</style>' } }],
  ])('rejects %s', (_label, value) => {
    expect(describeInvalidColorOverrides(value)).not.toBeNull();
  });
});

describe('UpdateBrandingDto.colorOverrides', () => {
  const run = (colorOverrides: unknown) =>
    validate(plainToInstance(UpdateBrandingDto, { colorOverrides }));

  it('passes for valid overrides, null (clear all) and omitted', async () => {
    expect(await run({ light: { 'primary.main': '#1E3A8A' } })).toHaveLength(0);
    expect(await run(null)).toHaveLength(0);
    expect(await run(undefined)).toHaveLength(0);
  });

  it('fails with a readable message for a bad color', async () => {
    const errors = await run({ light: { 'primary.main': 'blue' } });
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})[0]).toContain(
      'light.primary.main must be a hex color',
    );
  });
});
