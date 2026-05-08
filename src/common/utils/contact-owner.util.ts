import { ContactPersonType } from '../enums/domain.enums';

type NullableString = string | null | undefined;

export type ContactOwnerFields = {
  studentId?: string;
  guardianId?: string;
  teacherId?: string;
};

export type ResolvedContactOwner = {
  personType: ContactPersonType;
  personId: string;
};

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

  if (normalized === 'teacher') {
    return ContactPersonType.TEACHER;
  }

  return null;
}

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
    ownerFields: { teacherId: personId },
  };
}

export function resolveContactOwner(input: {
  studentId?: NullableString;
  guardianId?: NullableString;
  teacherId?: NullableString;
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

  if (input.teacherId) {
    return {
      personType: ContactPersonType.TEACHER,
      personId: input.teacherId,
    };
  }

  return null;
}
