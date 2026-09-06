import { ModuleKey } from '../../prisma/client';

export interface ModuleCatalogEntry {
  key: ModuleKey;
  label: string;
  description: string;
}

/**
 * Single source of truth for every purchasable/toggleable module's display
 * metadata (label + description). Institution entitlements, plan
 * blueprints, and the institution-creation wizard all render "which modules
 * can this institution/plan use" from this list instead of each hand-typing
 * their own copy of every ModuleKey — the exact gap that let the Timetable
 * and Notices modules (M3) go missing from several frontend screens after
 * being added to the ModuleKey enum, since nothing forced those screens to
 * notice a new value existed.
 *
 * Keep this in the same order as the `ModuleKey` enum in schema.prisma so a
 * diff here stays easy to eyeball against a diff there.
 */
export const MODULE_CATALOG: readonly ModuleCatalogEntry[] = [
  {
    key: ModuleKey.ACADEMICS,
    label: 'Academics',
    description:
      'Levels, classes, sections, subjects, and teacher assignments.',
  },
  {
    key: ModuleKey.ATTENDANCE,
    label: 'Attendance',
    description:
      'Daily check-in/out, leave management, and auto-absent marking.',
  },
  {
    key: ModuleKey.FINANCE,
    label: 'Finance',
    description:
      'Fee structures, vouchers, payroll, deductions, and bank accounts.',
  },
  {
    key: ModuleKey.PEOPLE,
    label: 'People',
    description: 'Student, teacher, and guardian profile management.',
  },
  {
    key: ModuleKey.REPORTING,
    label: 'Reporting',
    description: 'Analytics, reports, and data exports.',
  },
  {
    key: ModuleKey.EXAMINATIONS,
    label: 'Examinations',
    description: 'Exam scheduling, results, and grading.',
  },
  {
    key: ModuleKey.DOCUMENTS,
    label: 'Documents',
    description: 'Document management and storage.',
  },
  {
    key: ModuleKey.REALTIME,
    label: 'Real-time',
    description: 'Real-time notifications and live updates via WebSocket.',
  },
  {
    key: ModuleKey.TIMETABLE,
    label: 'Timetable',
    description:
      'Weekly period slots — class/section schedules, subjects and teachers.',
  },
  {
    key: ModuleKey.NOTICES,
    label: 'Notices',
    description:
      'Announcements with audience targeting, publish windows, and attachments.',
  },
] as const;
