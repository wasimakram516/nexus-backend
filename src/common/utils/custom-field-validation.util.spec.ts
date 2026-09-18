import { BadRequestException } from '@nestjs/common';
import { CustomFieldInputType } from '../../prisma/client';
import {
  validateCustomFieldValue,
  ValueDefinition,
} from './custom-field-validation.util';

describe('custom field value validation', () => {
  const definition: ValueDefinition = {
    fieldKey: 'field',
    label: 'Field',
    inputType: CustomFieldInputType.TEXT,
    isRequired: false,
  };
  it.each([
    ['NUMBER', '12'],
    ['NUMBER', Infinity],
    ['BOOLEAN', 'false'],
    ['EMAIL', 'invalid'],
    ['URL', 'javascript:alert(1)'],
    ['FILE', 'data:text/html,unsafe'],
    ['IMAGE', 'file:///secret'],
    ['DATE', '2026-02-30'],
    ['DATETIME', 'not a date'],
    ['TEXT', {}],
    ['PHONE', '<script>'],
    ['SELECT', 'unlisted'],
    ['RADIO', 'unlisted'],
    ['MULTI_SELECT', ['unlisted']],
    ['CHECKBOX', true],
  ] as const)('rejects invalid %s values', (inputType, value) => {
    expect(() =>
      validateCustomFieldValue({ ...definition, inputType }, value),
    ).toThrow(BadRequestException);
  });
  it.each([
    ['TEXT', 'value'],
    ['TEXTAREA', 'multiple\nlines'],
    ['NUMBER', 0],
    ['BOOLEAN', false],
    ['DATE', '2026-09-14'],
    ['DATETIME', '2026-09-14T10:00:00Z'],
    ['EMAIL', 'person@example.com'],
    ['PHONE', '+923001234567'],
    ['URL', 'https://example.com'],
    ['FILE', 'https://example.com/file.pdf'],
    ['IMAGE', 'https://example.com/image.png'],
    ['SELECT', 'one'],
    ['RADIO', 'one'],
    ['MULTI_SELECT', ['one']],
    ['CHECKBOX', ['one']],
  ] as const)('accepts valid %s values', (inputType, value) => {
    expect(() =>
      validateCustomFieldValue(
        { ...definition, inputType, options: [{ label: 'One', value: 'one' }] },
        value,
      ),
    ).not.toThrow();
  });
  it('allows clearing an optional field but rejects clearing a required field', () => {
    expect(() => validateCustomFieldValue(definition, null)).not.toThrow();
    expect(() =>
      validateCustomFieldValue({ ...definition, isRequired: true }, null),
    ).toThrow('required');
  });
  it('enforces configured numeric and text bounds', () => {
    expect(() =>
      validateCustomFieldValue(
        { ...definition, validation: { maxLength: 2 } },
        'long',
      ),
    ).toThrow();
    expect(() =>
      validateCustomFieldValue(
        { ...definition, inputType: 'NUMBER', validation: { min: 1 } },
        0,
      ),
    ).toThrow();
  });

  describe('FILE/IMAGE — existing upload contract (§ M4.5 shared blocker #4)', () => {
    const uploadResult = {
      url: 'https://res.cloudinary.com/demo/raw/upload/doc.pdf',
      publicId: 'nexus/students/doc',
      resourceType: 'raw',
      format: 'pdf',
      folder: 'nexus/students',
      bytes: 1024,
    };

    it.each(['FILE', 'IMAGE'] as const)(
      'accepts a full UploadResult-shaped object for %s',
      (inputType) => {
        expect(() =>
          validateCustomFieldValue({ ...definition, inputType }, uploadResult),
        ).not.toThrow();
      },
    );

    it.each([
      { ...uploadResult, url: 'not-a-url' },
      { ...uploadResult, publicId: '' },
      { ...uploadResult, resourceType: undefined },
      { ...uploadResult, format: undefined },
      { ...uploadResult, folder: '' },
      { ...uploadResult, bytes: 'big' },
      { ...uploadResult, bytes: -1 },
    ])('rejects an UploadResult object missing/invalid metadata: %j', (bad) => {
      expect(() =>
        validateCustomFieldValue({ ...definition, inputType: 'FILE' }, bad),
      ).toThrow('invalid value');
    });

    it('rejects an allowed-format violation', () => {
      expect(() =>
        validateCustomFieldValue(
          {
            ...definition,
            inputType: 'FILE',
            validation: { allowedFormats: ['pdf', 'docx'] },
          },
          { ...uploadResult, format: 'exe' },
        ),
      ).toThrow('invalid value');
    });

    it('rejects a file exceeding the configured max size', () => {
      expect(() =>
        validateCustomFieldValue(
          { ...definition, inputType: 'IMAGE', validation: { maxBytes: 500 } },
          uploadResult,
        ),
      ).toThrow('invalid value');
    });

    it('allows a file within the configured format and size limits', () => {
      expect(() =>
        validateCustomFieldValue(
          {
            ...definition,
            inputType: 'FILE',
            validation: { allowedFormats: ['pdf'], maxBytes: 2048 },
          },
          uploadResult,
        ),
      ).not.toThrow();
    });
  });
});
