import {
  buildContactOwnerFields,
  normalizeContactPersonType,
  resolveContactOwner,
} from './contact-owner.util';

describe('contact-owner util', () => {
  it('normalizes supported person types', () => {
    expect(normalizeContactPersonType(' student ')).toBe('STUDENT');
    expect(normalizeContactPersonType('GUARDIAN')).toBe('GUARDIAN');
    expect(normalizeContactPersonType('Staff')).toBe('STAFF');
  });

  it('builds FK-backed owner fields from the public contact payload', () => {
    expect(buildContactOwnerFields('guardian', 'guardian-1')).toEqual({
      personType: 'GUARDIAN',
      personId: 'guardian-1',
      ownerFields: { guardianId: 'guardian-1' },
    });
  });

  it('builds FK-backed owner fields for a staff profile contact', () => {
    expect(buildContactOwnerFields('staff', 'staff-profile-1')).toEqual({
      personType: 'STAFF',
      personId: 'staff-profile-1',
      ownerFields: { staffProfileId: 'staff-profile-1' },
    });
  });

  it('resolves a contact owner from stored relation ids', () => {
    expect(
      resolveContactOwner({
        studentId: null,
        guardianId: null,
        staffProfileId: 'staff-profile-1',
      }),
    ).toEqual({
      personType: 'STAFF',
      personId: 'staff-profile-1',
    });
  });
});
