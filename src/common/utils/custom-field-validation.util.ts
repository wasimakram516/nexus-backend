import { BadRequestException } from '@nestjs/common';
import { isEmail, isURL } from 'class-validator';
import { CustomFieldInputType } from '../../prisma/client';

export interface ValueDefinition {
  fieldKey: string;
  label: string;
  inputType: CustomFieldInputType;
  isRequired: boolean;
  options?: unknown;
  validation?: unknown;
}

/** Reads only plain object configuration, never arrays or arbitrary primitives. */
export function customFieldObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Extracts configured choice values from the persisted option contract. */
export function customFieldOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options.flatMap((option: unknown) => {
    const value = customFieldObject(option).value;
    return typeof value === 'string' ? [value] : [];
  });
}

/**
 * Validates a FILE/IMAGE value against the existing upload contract
 * (`UploadResult` — `src/modules/upload/upload.service.ts` on the backend,
 * mirrored 1:1 by the frontend's `uploadFile()`, the same shape Notices'
 * attachments already use). Accepts either the full uploaded-object shape
 * or a bare external URL string, so a field can point at either an
 * uploaded file or a plain external link.
 */
function isValidUploadValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return isURL(value, {
      protocols: ['http', 'https'],
      require_protocol: true,
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const upload = value as Record<string, unknown>;
  return (
    typeof upload.url === 'string' &&
    isURL(upload.url, {
      protocols: ['http', 'https'],
      require_protocol: true,
    }) &&
    typeof upload.publicId === 'string' &&
    upload.publicId.length > 0 &&
    typeof upload.resourceType === 'string' &&
    upload.resourceType.length > 0 &&
    typeof upload.format === 'string' &&
    upload.format.length > 0 &&
    typeof upload.folder === 'string' &&
    upload.folder.length > 0 &&
    typeof upload.bytes === 'number' &&
    Number.isFinite(upload.bytes) &&
    upload.bytes >= 0
  );
}

/** Validates a value on both entity writes and the standalone value endpoint. */
export function validateCustomFieldValue(
  definition: ValueDefinition,
  value: unknown,
): void {
  const empty =
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);
  if (empty) {
    if (definition.isRequired)
      throw new BadRequestException(`${definition.label} is required.`);
    return;
  }
  const invalid = (): never => {
    throw new BadRequestException(`${definition.label} has an invalid value.`);
  };
  const options = customFieldOptions(definition.options);
  switch (definition.inputType) {
    case CustomFieldInputType.NUMBER:
      if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
      break;
    case CustomFieldInputType.BOOLEAN:
      if (typeof value !== 'boolean') invalid();
      break;
    case CustomFieldInputType.MULTI_SELECT:
    case CustomFieldInputType.CHECKBOX:
      if (
        !Array.isArray(value) ||
        value.some(
          (entry: unknown) =>
            typeof entry !== 'string' || !options.includes(entry),
        ) ||
        new Set(value).size !== value.length
      )
        invalid();
      break;
    case CustomFieldInputType.SELECT:
    case CustomFieldInputType.RADIO:
      if (typeof value !== 'string' || !options.includes(value)) invalid();
      break;
    case CustomFieldInputType.FILE:
    case CustomFieldInputType.IMAGE: {
      if (!isValidUploadValue(value)) invalid();
      const uploadRules = customFieldObject(definition.validation);
      // External URLs cannot prove size or format. Restricted fields require
      // uploaded metadata rather than silently bypassing the configured rules.
      if (
        typeof value === 'string' &&
        ((Array.isArray(uploadRules.allowedFormats) &&
          uploadRules.allowedFormats.length > 0) ||
          typeof uploadRules.maxBytes === 'number')
      )
        invalid();
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const upload = value as { format?: unknown; bytes?: unknown };
        if (
          Array.isArray(uploadRules.allowedFormats) &&
          uploadRules.allowedFormats.length > 0 &&
          typeof upload.format === 'string' &&
          !uploadRules.allowedFormats.includes(upload.format.toLowerCase())
        )
          invalid();
        if (
          typeof uploadRules.maxBytes === 'number' &&
          typeof upload.bytes === 'number' &&
          upload.bytes > uploadRules.maxBytes
        )
          invalid();
      }
      break;
    }
    default:
      if (typeof value !== 'string') invalid();
      if (typeof value === 'string') {
        if (value.length > 10000) invalid();
        if (
          definition.inputType === CustomFieldInputType.EMAIL &&
          !isEmail(value)
        )
          invalid();
        if (
          definition.inputType === CustomFieldInputType.PHONE &&
          !/^\+?[\d ()-]{6,25}$/.test(value)
        )
          invalid();
        if (
          definition.inputType === CustomFieldInputType.URL &&
          !isURL(value, {
            protocols: ['http', 'https'],
            require_protocol: true,
          })
        )
          invalid();
        if (
          definition.inputType === CustomFieldInputType.DATE &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            Number.isNaN(Date.parse(value)) ||
            new Date(value).toISOString().slice(0, 10) !== value)
        )
          invalid();
        if (
          definition.inputType === CustomFieldInputType.DATETIME &&
          (!/^\d{4}-\d{2}-\d{2}T/.test(value) ||
            Number.isNaN(Date.parse(value)))
        )
          invalid();
      }
  }
  const rules = customFieldObject(definition.validation);
  if (
    typeof value === 'number' &&
    ((typeof rules.min === 'number' && value < rules.min) ||
      (typeof rules.max === 'number' && value > rules.max))
  )
    invalid();
  if (
    typeof value === 'string' &&
    ((typeof rules.minLength === 'number' && value.length < rules.minLength) ||
      (typeof rules.maxLength === 'number' && value.length > rules.maxLength))
  )
    invalid();
}
