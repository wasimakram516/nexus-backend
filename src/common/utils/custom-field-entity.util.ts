import { BadRequestException } from '@nestjs/common';
import { ModuleKey } from '../../prisma/client';
import {
  CustomFieldEntity,
  CustomFieldEntityType,
} from '../constants/custom-field-entities.constants';

export const CUSTOM_FIELD_ENTITY_MODULES: Record<
  CustomFieldEntityType,
  ModuleKey
> = {
  campus: ModuleKey.ACADEMICS,
  level: ModuleKey.ACADEMICS,
  class: ModuleKey.ACADEMICS,
  section: ModuleKey.ACADEMICS,
  subject: ModuleKey.ACADEMICS,
  student: ModuleKey.PEOPLE,
  guardian: ModuleKey.PEOPLE,
  staff_profile: ModuleKey.PEOPLE,
  student_guardian: ModuleKey.PEOPLE,
  student_history: ModuleKey.PEOPLE,
  teacher_subject: ModuleKey.PEOPLE,
  contact: ModuleKey.PEOPLE,
  staff_salary: ModuleKey.FINANCE,
  salary_deduction_rule: ModuleKey.FINANCE,
  salary_adjustment: ModuleKey.FINANCE,
  salary_payment: ModuleKey.FINANCE,
  bank_account: ModuleKey.FINANCE,
  fee_structure: ModuleKey.FINANCE,
  student_discount: ModuleKey.FINANCE,
  student_fine_rule: ModuleKey.FINANCE,
  student_fine: ModuleKey.FINANCE,
  fee_voucher: ModuleKey.FINANCE,
  fee_payment: ModuleKey.FINANCE,
  // M4.5 / P1-2a corrective milestone.
  notice: ModuleKey.NOTICES,
  period_slot: ModuleKey.TIMETABLE,
  attendance: ModuleKey.ATTENDANCE,
  // Judgment call: User has no dedicated ModuleKey (the 'users' permission
  // feature below is module: null — always available core config, see
  // permission-catalog.constant.ts). PEOPLE is the closest fit since every
  // other person-shaped entity (Student/Guardian/StaffProfile) already
  // gates on it, and any institution managing user-level custom fields
  // already has PEOPLE enabled in practice. Flagged for Wasim to confirm
  // rather than adding a new ModuleKey enum value (a schema migration) for
  // a single entity.
  user: ModuleKey.PEOPLE,
};

export const CUSTOM_FIELD_ENTITY_FEATURES: Record<
  CustomFieldEntityType,
  string
> = {
  campus: 'campuses',
  level: 'levels',
  class: 'classes',
  section: 'sections',
  subject: 'subjects',
  student: 'students',
  guardian: 'guardians',
  staff_profile: 'staff_profiles',
  student_guardian: 'student_guardians',
  student_history: 'student_history',
  teacher_subject: 'teacher_subjects',
  contact: 'contacts',
  staff_salary: 'salaries',
  salary_deduction_rule: 'salary_deduction_rules',
  salary_adjustment: 'salary_adjustments',
  salary_payment: 'salary_payments',
  bank_account: 'bank_accounts',
  fee_structure: 'fee_structures',
  student_discount: 'student_discounts',
  student_fine_rule: 'student_fine_rules',
  student_fine: 'student_fines',
  fee_voucher: 'fee_vouchers',
  fee_payment: 'fee_payments',
  // M4.5 / P1-2a corrective milestone.
  notice: 'notices',
  period_slot: 'period_slots',
  attendance: 'attendance',
  user: 'users',
};

/** Prevents definitions from being assigned to modules their record services never load. */
export function assertCustomFieldEntityModule(
  entityType: string,
  moduleKey: ModuleKey,
): CustomFieldEntityType {
  const entity = normalizeCustomFieldEntity(entityType);
  if (CUSTOM_FIELD_ENTITY_MODULES[entity] !== moduleKey) {
    throw new BadRequestException(
      `${entity} custom fields belong to ${CUSTOM_FIELD_ENTITY_MODULES[entity]}.`,
    );
  }
  return entity;
}

/** Resolves both legacy uppercase names and canonical entity identifiers. */
export function normalizeCustomFieldEntity(
  value: string,
): CustomFieldEntityType {
  const normalized = value.trim().toLowerCase();
  const entity = Object.values(CustomFieldEntity).find(
    (candidate) => candidate === normalized,
  );
  if (!entity)
    throw new BadRequestException(`Unsupported custom field entity: ${value}`);
  return entity;
}
