import { ModuleKey } from '../../prisma/client';

export type PermissionAction = 'create' | 'read' | 'update' | 'delete';

export const ALL_ACTIONS: readonly PermissionAction[] = [
  'create',
  'read',
  'update',
  'delete',
];

export interface PermissionFeatureDef {
  key: string;
  label: string;
  /** Plan module this feature is gated behind, or null for administrative
   *  features (users, custom fields, recycle bin, audit logs) that every
   *  institution has regardless of which content modules it purchased. */
  module: ModuleKey | null;
  /** The subset of CRUD actions meaningful for this feature — the frontend
   *  checkbox grid only renders these columns for the row. */
  actions: readonly PermissionAction[];
}

/**
 * Single source of truth for the feature x action permission matrix:
 * institution-created Roles and per-user overrides are validated against
 * this list, and every gated route declares a (feature, action) pair via
 * @RequirePermission that must appear here.
 *
 * Role management itself is deliberately NOT a catalog feature — per the
 * locked design, role CRUD stays with the institution ADMIN archetype only
 * (see roles.controller.ts), not delegable through the matrix.
 */
export const PERMISSION_CATALOG: readonly PermissionFeatureDef[] = [
  // Academics
  {
    key: 'campuses',
    label: 'Campuses',
    module: ModuleKey.ACADEMICS,
    actions: ALL_ACTIONS,
  },
  {
    key: 'levels',
    label: 'Levels',
    module: ModuleKey.ACADEMICS,
    actions: ALL_ACTIONS,
  },
  {
    key: 'classes',
    label: 'Classes',
    module: ModuleKey.ACADEMICS,
    actions: ALL_ACTIONS,
  },
  {
    key: 'sections',
    label: 'Sections',
    module: ModuleKey.ACADEMICS,
    actions: ALL_ACTIONS,
  },
  {
    key: 'subjects',
    label: 'Subjects',
    module: ModuleKey.ACADEMICS,
    actions: ALL_ACTIONS,
  },
  {
    key: 'academic_years',
    label: 'Academic Years',
    module: ModuleKey.ACADEMICS,
    actions: ALL_ACTIONS,
  },

  // People
  {
    key: 'students',
    label: 'Students',
    module: ModuleKey.PEOPLE,
    actions: ALL_ACTIONS,
  },
  {
    key: 'guardians',
    label: 'Guardians',
    module: ModuleKey.PEOPLE,
    actions: ALL_ACTIONS,
  },
  {
    key: 'staff_profiles',
    label: 'Staff Profiles',
    module: ModuleKey.PEOPLE,
    actions: ALL_ACTIONS,
  },
  {
    key: 'student_guardians',
    label: 'Student-Guardian Links',
    module: ModuleKey.PEOPLE,
    actions: ['create', 'delete'],
  },
  {
    key: 'teacher_subjects',
    label: 'Teaching Assignments',
    module: ModuleKey.PEOPLE,
    actions: ['create', 'read', 'delete'],
  },
  {
    key: 'student_history',
    label: 'Student Promotions',
    module: ModuleKey.PEOPLE,
    actions: ['create', 'read'],
  },
  {
    key: 'student_enrollments',
    label: 'Student Enrollments',
    module: ModuleKey.PEOPLE,
    // Also gates the bulk promotion wizard (preview/commit) and the
    // withdrawal action — no separate catalog keys for those, per
    // M2-PEOPLE-ACADEMIC-DESIGN.md § 5: they're specialized writes against
    // this same resource.
    actions: ALL_ACTIONS,
  },
  {
    key: 'contacts',
    label: 'Contacts',
    module: ModuleKey.PEOPLE,
    actions: ['create', 'read'],
  },

  // Attendance
  {
    key: 'attendance',
    label: 'Attendance',
    module: ModuleKey.ATTENDANCE,
    actions: ['read', 'update'],
  },

  // Finance
  {
    key: 'salaries',
    label: 'Salaries',
    module: ModuleKey.FINANCE,
    actions: ALL_ACTIONS,
  },
  {
    key: 'salary_deduction_rules',
    label: 'Salary Deduction Rules',
    module: ModuleKey.FINANCE,
    actions: ['create', 'read', 'delete'],
  },
  {
    key: 'salary_adjustments',
    label: 'Salary Adjustments',
    module: ModuleKey.FINANCE,
    actions: ['create', 'read', 'delete'],
  },
  {
    key: 'salary_payments',
    label: 'Salary Payments',
    module: ModuleKey.FINANCE,
    actions: ['create', 'read', 'delete'],
  },
  {
    key: 'bank_accounts',
    label: 'Bank Accounts',
    module: ModuleKey.FINANCE,
    actions: ALL_ACTIONS,
  },
  {
    key: 'fee_structures',
    label: 'Fee Structures',
    module: ModuleKey.FINANCE,
    actions: ALL_ACTIONS,
  },
  {
    key: 'student_discounts',
    label: 'Student Discounts',
    module: ModuleKey.FINANCE,
    actions: ['create', 'read', 'delete'],
  },
  {
    key: 'student_fine_rules',
    label: 'Student Fine Rules',
    module: ModuleKey.FINANCE,
    actions: ['create', 'read', 'delete'],
  },
  {
    key: 'student_fines',
    label: 'Student Fines',
    module: ModuleKey.FINANCE,
    actions: ['create', 'read', 'delete'],
  },
  {
    key: 'fee_vouchers',
    label: 'Fee Vouchers',
    module: ModuleKey.FINANCE,
    actions: ALL_ACTIONS,
  },
  {
    key: 'fee_payments',
    label: 'Fee Payments',
    module: ModuleKey.FINANCE,
    actions: ['create', 'read', 'delete'],
  },

  // Notices (M3, decision #24)
  {
    key: 'notices',
    label: 'Notices',
    module: ModuleKey.NOTICES,
    actions: ALL_ACTIONS,
  },

  // Timetable M1 (M3, decision #26). Catalog key names the resource
  // (PeriodSlot), not the module, matching this catalog's own dominant
  // convention (see M3-SCHEDULING-COMMUNICATION-DESIGN.md § 6).
  {
    key: 'period_slots',
    label: 'Period Slots',
    module: ModuleKey.TIMETABLE,
    actions: ALL_ACTIONS,
  },

  // Administrative — not gated by a plan module
  { key: 'users', label: 'Users', module: null, actions: ALL_ACTIONS },
  {
    key: 'custom_fields',
    label: 'Custom Fields',
    module: null,
    actions: ALL_ACTIONS,
  },
  {
    key: 'recycle_bin',
    label: 'Recycle Bin',
    module: null,
    actions: ['read', 'update', 'delete'],
  },
  { key: 'audit_logs', label: 'Audit Logs', module: null, actions: ['read'] },
] as const;

const CATALOG_BY_KEY = new Map(
  PERMISSION_CATALOG.map((feature) => [feature.key, feature]),
);

export function getPermissionFeature(
  key: string,
): PermissionFeatureDef | undefined {
  return CATALOG_BY_KEY.get(key);
}

export function isKnownFeatureAction(key: string, action: string): boolean {
  const feature = CATALOG_BY_KEY.get(key);
  return Boolean(
    feature && (feature.actions as readonly string[]).includes(action),
  );
}

/** Feature keys gated behind the given plan module (used to filter the
 *  checkbox grid down to modules the institution has actually purchased). */
export function getFeaturesForModule(
  module: ModuleKey,
): PermissionFeatureDef[] {
  return PERMISSION_CATALOG.filter((feature) => feature.module === module);
}
