import { EnrollmentStatus, Prisma } from '../../prisma/client';

export interface StudentPlacement {
  className: string;
  sectionName: string | null;
}

export interface StudentScope {
  campusId: string;
  classId?: string;
  sectionId?: string;
}

/**
 * The students a finance report covers: everyone at the campus, or only those
 * with a current enrollment in the chosen class or section.
 *
 * @param {Prisma.TransactionClient} client - Database client.
 * @param {StudentScope} scope - Campus and optional class or section.
 * @returns {Promise<string[]>} Student ids.
 */
export async function studentIdsInScope(
  client: Prisma.TransactionClient,
  scope: StudentScope,
): Promise<string[]> {
  if (!scope.classId && !scope.sectionId) {
    const students = await client.student.findMany({
      where: { campusId: scope.campusId, deletedAt: null },
      select: { id: true },
    });
    return students.map((row) => row.id);
  }
  const enrollments = await client.studentEnrollment.findMany({
    where: {
      campusId: scope.campusId,
      status: { not: EnrollmentStatus.LEFT },
      deletedAt: null,
      ...(scope.classId ? { classId: scope.classId } : {}),
      ...(scope.sectionId ? { sectionId: scope.sectionId } : {}),
    },
    select: { studentId: true },
  });
  return [...new Set(enrollments.map((row) => row.studentId))];
}

/**
 * Each student's latest non-withdrawn class and section, for documents that
 * name where a student is placed.
 *
 * @param {Prisma.TransactionClient} client - Database client.
 * @param {string[]} studentIds - Students to look up.
 * @returns {Promise<Map<string, StudentPlacement>>} Placement by student id; absent when none.
 */
export async function loadStudentPlacements(
  client: Prisma.TransactionClient,
  studentIds: string[],
): Promise<Map<string, StudentPlacement>> {
  const enrollments = await client.studentEnrollment.findMany({
    where: {
      studentId: { in: studentIds },
      status: { not: EnrollmentStatus.LEFT },
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      studentId: true,
      class: { select: { name: true } },
      section: { select: { name: true } },
    },
  });
  const byStudent = new Map<string, StudentPlacement>();
  for (const row of enrollments) {
    if (!byStudent.has(row.studentId)) {
      byStudent.set(row.studentId, {
        className: row.class.name,
        sectionName: row.section?.name ?? null,
      });
    }
  }
  return byStudent;
}
