export function slugify(value: string): string {
  return value
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function generateUniqueSlug(
  baseValue: string,
  exists: (slug: string) => Promise<boolean>,
  fallbackBase = 'item',
): Promise<string> {
  const baseSlug = slugify(baseValue) || slugify(fallbackBase) || 'item';

  let slug = baseSlug;
  let counter = 1;

  while (await exists(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  return slug;
}
