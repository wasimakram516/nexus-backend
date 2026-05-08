import {
  buildContactOwnerFields,
  normalizeContactPersonType,
  resolveContactOwner,
} from './contact-owner.util';

describe('contact-owner util', () => {
  it('normalizes supported person types', () => {
    expect(normalizeContactPersonType(' student ')).toBe('STUDENT');
    expect(normalizeContactPersonType('GUARDIAN')).toBe('GUARDIAN');
    expect(normalizeContactPersonType('Teacher')).toBe('TEACHER');
  });

  it('builds FK-backed owner fields from the public contact payload', () => {
    expect(buildContactOwnerFields('guardian', 'guardian-1')).toEqual({
      personType: 'GUARDIAN',
      personId: 'guardian-1',
      ownerFields: { guardianId: 'guardian-1' },
    });
  });

  it('resolves a contact owner from stored relation ids', () => {
    expect(
      resolveContactOwner({
        studentId: null,
        guardianId: null,
        teacherId: 'teacher-1',
      }),
    ).toEqual({
      personType: 'TEACHER',
      personId: 'teacher-1',
    });
  });
});
