export function normalizeCustomFieldValues(
  input: unknown,
): Record<string, unknown> {
  if (!input) {
    return {};
  }

  if (input instanceof Map) {
    const values: Record<string, unknown> = {};

    for (const [key, value] of input.entries()) {
      if (typeof key === 'string') {
        values[key] = value;
      }
    }

    return values;
  }

  if (
    Array.isArray(input) &&
    input.every(
      (item) =>
        Array.isArray(item) && item.length === 2 && typeof item[0] === 'string',
    )
  ) {
    const values: Record<string, unknown> = {};

    for (const [key, value] of input as [string, unknown][]) {
      values[key] = value;
    }

    return values;
  }

  if (typeof input === 'object') {
    const source = input as Record<string, unknown>;
    if (
      'customFields' in source &&
      source.customFields &&
      typeof source.customFields === 'object'
    ) {
      return normalizeCustomFieldValues(source.customFields);
    }

    return source;
  }

  return {};
}
