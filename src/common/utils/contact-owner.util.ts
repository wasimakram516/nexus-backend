import { ContactPersonType } from '../enums/domain.enums';

type NullableString = string | null | undefined;

export type ContactOwnerFields = {
  studentId?: string;
  guardianId?: string;
  staffProfileId?: string;
};

export type ResolvedContactOwner = {
  personType: ContactPersonType;
  personId: string;
};

/**
 * Normalizes a public-facing contact person type string into the internal
 * ContactPersonType enum value.
 *
 * @param {string} value - Raw person type from a request payload (e.g. "student").
 * @returns {ContactPersonType | null} The matching enum value, or null if unsupported.
 */
export function normalizeContactPersonType(
  value: string,
): ContactPersonType | null {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'student') {
    return ContactPersonType.STUDENT;
  }

  if (normalized === 'guardian') {
    return ContactPersonType.GUARDIAN;
  }

  if (normalized === 'staff') {
    return ContactPersonType.STAFF;
  }

  return null;
}

/**
 * Builds the FK-backed owner fields for a Contact row from the public
 * (personType, personId) pair used by the API.
 *
 * @param {string} personType - Raw person type from a request payload.
 * @param {string} personId - The id of the student/guardian/staff profile.
 * @returns {(ResolvedContactOwner & { ownerFields: ContactOwnerFields }) | null}
 *   The resolved owner plus the FK field to set, or null if unsupported.
 */
export function buildContactOwnerFields(
  personType: string,
  personId: string,
):
  | (ResolvedContactOwner & {
      ownerFields: ContactOwnerFields;
    })
  | null {
  const normalizedType = normalizeContactPersonType(personType);

  if (!normalizedType) {
    return null;
  }

  if (normalizedType === ContactPersonType.STUDENT) {
    return {
      personType: normalizedType,
      personId,
      ownerFields: { studentId: personId },
    };
  }

  if (normalizedType === ContactPersonType.GUARDIAN) {
    return {
      personType: normalizedType,
      personId,
      ownerFields: { guardianId: personId },
    };
  }

  return {
    personType: normalizedType,
    personId,
    ownerFields: { staffProfileId: personId },
  };
}

/**
 * Resolves the (personType, personId) pair from a Contact row's stored
 * relation ids.
 *
 * @param {object} input - The Contact row's owner FK fields.
 * @param {NullableString} input.studentId - The student FK, if set.
 * @param {NullableString} input.guardianId - The guardian FK, if set.
 * @param {NullableString} input.staffProfileId - The staff profile FK, if set.
 * @returns {ResolvedContactOwner | null} The resolved owner, or null if none is set.
 */
export function resolveContactOwner(input: {
  studentId?: NullableString;
  guardianId?: NullableString;
  staffProfileId?: NullableString;
}): ResolvedContactOwner | null {
  if (input.studentId) {
    return {
      personType: ContactPersonType.STUDENT,
      personId: input.studentId,
    };
  }

  if (input.guardianId) {
    return {
      personType: ContactPersonType.GUARDIAN,
      personId: input.guardianId,
    };
  }

  if (input.staffProfileId) {
    return {
      personType: ContactPersonType.STAFF,
      personId: input.staffProfileId,
    };
  }

  return null;
}
