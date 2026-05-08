import { generateUniqueSlug, slugify } from './slug.util';

describe('slug.util', () => {
  it('slugifies mixed text consistently', () => {
    expect(slugify('  Nexus Academy!  ')).toBe('nexus-academy');
  });

  it('appends a numeric suffix until the slug is unique', async () => {
    const takenSlugs = new Set(['nexus-academy', 'nexus-academy-1']);

    await expect(
      generateUniqueSlug('Nexus Academy', (slug) =>
        Promise.resolve(takenSlugs.has(slug)),
      ),
    ).resolves.toBe('nexus-academy-2');
  });

  it('uses the fallback base when the input slug becomes empty', async () => {
    await expect(
      generateUniqueSlug('!!!', () => Promise.resolve(false), 'institution'),
    ).resolves.toBe('institution');
  });
});
