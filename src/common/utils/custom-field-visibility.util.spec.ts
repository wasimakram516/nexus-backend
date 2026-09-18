import { UserRole } from '../../prisma/client';
import { isCustomFieldDefinitionVisibleToRole } from './custom-field-visibility.util';

describe('isCustomFieldDefinitionVisibleToRole', () => {
  it('is visible to every role when visibilityRules is unset (ungated, preserves pre-existing definitions)', () => {
    expect(isCustomFieldDefinitionVisibleToRole(null, UserRole.GUARDIAN)).toBe(
      true,
    );
    expect(
      isCustomFieldDefinitionVisibleToRole(undefined, UserRole.STUDENT),
    ).toBe(true);
  });

  it('is visible to every role when the roles list is empty', () => {
    expect(
      isCustomFieldDefinitionVisibleToRole({ roles: [] }, UserRole.GUARDIAN),
    ).toBe(true);
  });

  it('is visible to every role when visibilityRules is malformed (not an object with a roles array)', () => {
    expect(
      isCustomFieldDefinitionVisibleToRole('not-an-object', UserRole.GUARDIAN),
    ).toBe(true);
    expect(
      isCustomFieldDefinitionVisibleToRole([UserRole.STAFF], UserRole.STAFF),
    ).toBe(true);
    expect(
      isCustomFieldDefinitionVisibleToRole(
        { roles: 'not-an-array' },
        UserRole.STAFF,
      ),
    ).toBe(true);
  });

  it('allows a role explicitly included in the allow-list', () => {
    expect(
      isCustomFieldDefinitionVisibleToRole(
        { roles: [UserRole.STAFF, UserRole.ADMIN] },
        UserRole.STAFF,
      ),
    ).toBe(true);
  });

  it('denies a role not included in the allow-list — the internal-HR-note-hidden-from-guardian case', () => {
    expect(
      isCustomFieldDefinitionVisibleToRole(
        { roles: [UserRole.STAFF, UserRole.ADMIN] },
        UserRole.GUARDIAN,
      ),
    ).toBe(false);
  });

  it('denies a missing/unresolvable role against an explicitly role-gated field (fails closed)', () => {
    expect(
      isCustomFieldDefinitionVisibleToRole({ roles: [UserRole.ADMIN] }, null),
    ).toBe(false);
    expect(
      isCustomFieldDefinitionVisibleToRole(
        { roles: [UserRole.ADMIN] },
        undefined,
      ),
    ).toBe(false);
  });

  it('ignores unknown/invalid role strings in the list and still fails closed if nothing valid remains', () => {
    expect(
      isCustomFieldDefinitionVisibleToRole(
        { roles: ['NOT_A_REAL_ROLE'] },
        UserRole.ADMIN,
      ),
    ).toBe(true); // no valid roles left => treated as ungated
  });
});
