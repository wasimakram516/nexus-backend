import { PrismaService } from '../../prisma/prisma.service';

type NameDelegate = {
  findMany(args: {
    where: { id: { in: string[] } };
    select: { id: true; name: true };
  }): Promise<Array<{ id: string; name: string | null }>>;
};

/** Which model holds the name for each reference field found in a snapshot. */
const USER_KEYS = new Set(['userId']);
const MODEL_BY_KEY: Record<string, string> = {
  campusId: 'campus',
  classId: 'academicClass',
  previousClassId: 'academicClass',
  newClassId: 'academicClass',
  sectionId: 'section',
  previousSectionId: 'section',
  newSectionId: 'section',
  levelId: 'level',
  subjectId: 'subject',
  academicYearId: 'academicYear',
  currentAcademicYearId: 'academicYear',
  gradingScaleId: 'gradingScale',
  currentGradingScaleId: 'gradingScale',
  roleId: 'role',
  planId: 'planDefinition',
  periodSlotId: 'periodSlot',
  examTermId: 'examTerm',
  examId: 'exam',
  originalExamId: 'exam',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Snapshot = Record<string, unknown> | null | undefined;

const isUserKey = (key: string) => key.endsWith('By') || USER_KEYS.has(key);

/**
 * Collects the reference ids a set of before/after snapshots point to, grouped
 * by the model that holds their name.
 *
 * @param {Snapshot[]} snapshots - The snapshots of the listed log rows.
 * @returns {Map<string, Set<string>>} Ids to look up, keyed by model name.
 */
export function collectReferenceIds(
  snapshots: Snapshot[],
): Map<string, Set<string>> {
  const wanted = new Map<string, Set<string>>();
  for (const snapshot of snapshots) {
    for (const [key, value] of Object.entries(snapshot ?? {})) {
      if (typeof value !== 'string' || !UUID.test(value)) continue;
      const model = isUserKey(key) ? 'user' : MODEL_BY_KEY[key];
      if (!model) continue;
      if (!wanted.has(model)) wanted.set(model, new Set());
      wanted.get(model)!.add(value);
    }
  }
  return wanted;
}

/**
 * Looks up the display name of every record the snapshots reference, so the
 * Activity screen can show "Naeem Akhtar" instead of a UUID. A record that no
 * longer exists simply has no entry, and the screen falls back to a short
 * reference.
 *
 * @param {PrismaService} prisma - The database client.
 * @param {Snapshot[]} snapshots - The snapshots of the listed log rows.
 * @returns {Promise<Record<string, string>>} Names by id.
 */
export async function resolveReferenceNames(
  prisma: PrismaService,
  snapshots: Snapshot[],
): Promise<Record<string, string>> {
  const wanted = collectReferenceIds(snapshots);
  const names: Record<string, string> = {};
  await Promise.all(
    Array.from(wanted).map(async ([model, ids]) => {
      const delegate = (prisma as unknown as Record<string, NameDelegate>)[
        model
      ];
      if (!delegate) return;
      const rows = await delegate.findMany({
        where: { id: { in: Array.from(ids) } },
        select: { id: true, name: true },
      });
      for (const row of rows) if (row.name) names[row.id] = row.name;
    }),
  );
  return names;
}
