import {
  pickCustomFieldEmail,
  pickCustomFieldPairs,
  pickCustomFieldPhone,
  pickCustomFieldUrl,
  pickCustomFieldValue,
} from './custom-field-lookup.util';

describe('custom-field-lookup util', () => {
  it('matches canonical values using aliases', () => {
    const customFields = {
      'Phone Number': '+92 300 1234567',
      'E-mail': 'admin@nexus.test',
      Website: 'https://nexus.test',
    };

    expect(pickCustomFieldEmail(customFields)).toBe('admin@nexus.test');
    expect(pickCustomFieldPhone(customFields)).toBe('+92 300 1234567');
    expect(pickCustomFieldUrl(customFields)).toBe('https://nexus.test');
  });

  it('handles nested payloads that include customFields', () => {
    expect(
      pickCustomFieldValue(
        {
          customFields: {
            'Transport Route': 'Route 5',
          },
        },
        'transportroute',
        ['transport route'],
      ),
    ).toBe('Route 5');
  });

  it('returns trimmed non-empty pairs only', () => {
    expect(
      pickCustomFieldPairs({
        blood_group: ' A+ ',
        notes: '',
        nullable: null,
      }),
    ).toEqual([{ label: 'blood_group', value: 'A+' }]);
  });
});
