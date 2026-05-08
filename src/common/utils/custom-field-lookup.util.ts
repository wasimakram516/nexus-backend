import { normalizeCustomFieldValues } from './custom-field-values.util';

function normalizeFieldKey(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function pickCustomFieldValue(
  fields: unknown,
  matchKey: string,
  aliases: string[] = [],
): unknown {
  const source = normalizeCustomFieldValues(fields);
  const targets = new Set(
    [matchKey, ...aliases].map((value) => normalizeFieldKey(value)),
  );

  for (const [key, value] of Object.entries(source)) {
    if (!targets.has(normalizeFieldKey(key))) {
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'string' && value.trim() === '') {
      continue;
    }

    return value;
  }

  return null;
}

export function pickCustomFieldEmail(fields: unknown) {
  return pickCustomFieldValue(fields, 'email', ['e-mail', 'email address']);
}

export function pickCustomFieldPhone(fields: unknown) {
  return pickCustomFieldValue(fields, 'phone', [
    'phone number',
    'mobile',
    'contact',
    'whatsapp',
  ]);
}

export function pickCustomFieldUrl(fields: unknown) {
  return pickCustomFieldValue(fields, 'url', [
    'website',
    'web site',
    'link',
    'profile url',
  ]);
}

export function pickCustomFieldPairs(fields: unknown) {
  return Object.entries(normalizeCustomFieldValues(fields))
    .filter(([, value]) => {
      if (value === undefined || value === null) {
        return false;
      }

      return typeof value !== 'string' || value.trim() !== '';
    })
    .map(([label, value]) => ({
      label,
      value: typeof value === 'string' ? value.trim() : String(value),
    }));
}
