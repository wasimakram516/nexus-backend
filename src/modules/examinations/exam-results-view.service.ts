import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import {
  EnrollmentStatus,
  ExamStatus,
  ModuleKey,
  UserRole,
} from '../../prisma/client';
import { OwnedStudentsService } from '../../common/services/owned-students.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeExamOutcome,
  ExamOutcome,
  GradeBandLite,
  PaperLite,
  parsePassPolicy,
  PassPolicy,
  rankStudents,
  ResultLite,
} from './exam-computation';

/** Everything needed to compute one exam's results, loaded once. */
export interface ExamContext {
  id: string;
  name: string;
  classId: string;
  campusId: string;
  institutionId: string;
  academicYearId: string;
  examTermId: string;
  status: ExamStatus;
  examType: string;
  originalExamId: string | null;
  papers: PaperLite[];
  bands: GradeBandLite[];
  policy: PassPolicy;
}

export interface StudentOutcome {
  studentId: string;
  name: string;
  regNo: string;
  sectionId: string | null;
  sectionName: string | null;
  outcome: ExamOutcome;
  positionInClass: number | null;
  classSize: number;
  positionInSection: number | null;
  sectionSize: number;
}

/**
 * Reads of one exam's computed results. Results are computed on read from the
 * raw marks, never stored, so a correction shows up everywhere immediately.
 * Staff need the results permission; a student or guardian can read only their
 * own (or their ward's) result, and only once the exam is published.
 */
@Injectable()
export class ExamResultsViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly campusAccessService: CampusAccessService,
    private readonly userPermissionsService: UserPermissionsService,
    private readonly ownedStudents: OwnedStudentsService,
  ) {}

  /**
   * Every student's totals, percentage, grade and position for one exam.
   *
   * @param {CurrentUser} currentUser - Authenticated caller (needs the results permission).
   * @param {string} examId - The exam.
   * @param {string} [sectionId] - Limit the returned rows to one section; positions still use the whole class.
   * @returns {Promise<{message: string, data: object}>} The exam, its papers, per-student outcomes and a tally.
   * @throws {ForbiddenException} If the caller is not staff with access to results.
   */
  async getClassSummary(
    currentUser: CurrentUser,
    examId: string,
    sectionId?: string,
  ) {
    await this.assertModule(currentUser);
    const exam = await this.loadExam(examId);
    await this.assertStaffAccess(currentUser, exam);

    const all = await this.computeStudentOutcomes(exam);
    const students = sectionId
      ? all.filter((row) => row.sectionId === sectionId)
      : all;

    const tally = { pass: 0, fail: 0, incomplete: 0, absent: 0 };
    for (const row of students) {
      tally[row.outcome.status.toLowerCase() as keyof typeof tally] += 1;
    }
    const percentages = students
      .map((row) => row.outcome.percentage)
      .filter((value): value is number => value !== null);
    const average =
      percentages.length > 0
        ? Math.round(
            (percentages.reduce((sum, value) => sum + value, 0) /
              percentages.length) *
              100,
          ) / 100
        : null;

    return {
      message: 'Class result summary fetched successfully',
      data: {
        exam: this.describeExam(exam),
        papers: exam.papers,
        students,
        summary: {
          total: students.length,
          ...tally,
          averagePercentage: average,
        },
      },
    };
  }

  /**
   * One student's per-subject breakdown, totals and position for one exam.
   * A student or guardian gets only their own data, plus the position and
   * class size; nothing about any other student is returned.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} examId - The exam.
   * @param {string} studentId - The student.
   * @returns {Promise<{message: string, data: object}>} The student's outcome.
   * @throws {ForbiddenException} If the caller may not see this student's results.
   * @throws {NotFoundException} If the exam or the student's enrollment is not found.
   */
  async getStudentSummary(
    currentUser: CurrentUser,
    examId: string,
    studentId: string,
  ) {
    await this.assertModule(currentUser);
    const exam = await this.loadExam(examId);
    await this.assertCanViewStudent(currentUser, exam, studentId);

    const all = await this.computeStudentOutcomes(exam);
    const row = all.find((candidate) => candidate.studentId === studentId);
    if (!row) {
      throw new NotFoundException('This student has no result for this exam.');
    }
    return {
      message: 'Student result summary fetched successfully',
      data: { exam: this.describeExam(exam), result: row },
    };
  }

  /**
   * Loads the exam with its papers, grading scale bands and the
   * institution's pass policy.
   *
   * @param {string} examId - The exam.
   * @returns {Promise<ExamContext>} The exam's computation context.
   * @throws {NotFoundException} If the exam does not exist.
   */
  async loadExam(examId: string): Promise<ExamContext> {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        campus: { select: { institutionId: true } },
        gradingScale: {
          include: {
            bands: {
              where: { deletedAt: null },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
        subjects: {
          include: { subject: { select: { name: true } } },
          orderBy: [{ examDate: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    const institutionId = exam?.campus.institutionId;
    if (!exam || !institutionId) {
      throw new NotFoundException('Exam not found.');
    }

    const setting = await this.prisma.institutionSetting.findUnique({
      where: {
        institutionId_key_activeScopeKey: {
          institutionId,
          key: 'exams',
          activeScopeKey: 'ACTIVE',
        },
      },
      select: { value: true },
    });

    return {
      id: exam.id,
      name: exam.name,
      classId: exam.classId,
      campusId: exam.campusId,
      institutionId,
      academicYearId: exam.academicYearId,
      examTermId: exam.examTermId,
      status: exam.status,
      examType: exam.examType,
      originalExamId: exam.originalExamId,
      papers: exam.subjects.map((paper) => ({
        examSubjectId: paper.id,
        subjectId: paper.subjectId,
        subjectName: paper.subject.name,
        maxMarks: Number(paper.maxMarks),
        passingMarks: Number(paper.passingMarks),
      })),
      bands: exam.gradingScale.bands.map((band) => ({
        grade: band.grade,
        minPercentage: Number(band.minPercentage),
        maxPercentage: Number(band.maxPercentage),
        remarks: band.remarks,
      })),
      policy: parsePassPolicy(setting?.value),
    };
  }

  /**
   * Computes every enrolled student's outcome for an exam and ranks them
   * across the class and within each section. A regular exam covers the whole
   * class; a retake-type exam covers only students with at least one result,
   * since only some of the class sat it.
   *
   * @param {ExamContext} exam - The loaded exam.
   * @returns {Promise<StudentOutcome[]>} One row per student, ordered by name.
   */
  async computeStudentOutcomes(exam: ExamContext): Promise<StudentOutcome[]> {
    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        classId: exam.classId,
        academicYearId: exam.academicYearId,
        status: { not: EnrollmentStatus.LEFT },
        deletedAt: null,
      },
      select: {
        sectionId: true,
        section: { select: { name: true } },
        student: {
          select: { id: true, regNo: true, user: { select: { name: true } } },
        },
      },
    });

    const results = exam.papers.length
      ? await this.prisma.examResult.findMany({
          where: {
            examSubjectId: {
              in: exam.papers.map((paper) => paper.examSubjectId),
            },
            studentId: { in: enrollments.map((row) => row.student.id) },
          },
          select: {
            examSubjectId: true,
            studentId: true,
            marksObtained: true,
            isAbsent: true,
          },
        })
      : [];
    const byStudent = new Map<string, Map<string, ResultLite>>();
    for (const result of results) {
      const forStudent =
        byStudent.get(result.studentId) ?? new Map<string, ResultLite>();
      forStudent.set(result.examSubjectId, {
        marksObtained:
          result.marksObtained === null ? null : Number(result.marksObtained),
        isAbsent: result.isAbsent,
      });
      byStudent.set(result.studentId, forStudent);
    }

    const sat =
      exam.examType === 'REGULAR'
        ? enrollments
        : enrollments.filter((row) => byStudent.has(row.student.id));
    const computed = sat.map((row) => ({
      row,
      outcome: computeExamOutcome(
        exam.papers,
        byStudent.get(row.student.id) ?? new Map<string, ResultLite>(),
        exam.bands,
        exam.policy,
      ),
    }));

    const classRanks = rankStudents(
      computed.map(({ row, outcome }) => ({
        id: row.student.id,
        percentage: outcome.percentage,
        status: outcome.status,
      })),
    );
    const sectionRanks = new Map<string, ReturnType<typeof rankStudents>>();
    for (const sectionKey of new Set(
      computed.map(({ row }) => row.sectionId),
    )) {
      sectionRanks.set(
        sectionKey ?? '',
        rankStudents(
          computed
            .filter(({ row }) => row.sectionId === sectionKey)
            .map(({ row, outcome }) => ({
              id: row.student.id,
              percentage: outcome.percentage,
              status: outcome.status,
            })),
        ),
      );
    }

    return computed
      .map(({ row, outcome }) => {
        const inClass = classRanks.get(row.student.id);
        const inSection = sectionRanks
          .get(row.sectionId ?? '')
          ?.get(row.student.id);
        return {
          studentId: row.student.id,
          name: row.student.user.name,
          regNo: row.student.regNo,
          sectionId: row.sectionId,
          sectionName: row.section?.name ?? null,
          outcome,
          positionInClass: inClass?.position ?? null,
          classSize: inClass?.rankedCount ?? 0,
          positionInSection: inSection?.position ?? null,
          sectionSize: inSection?.rankedCount ?? 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Only the fields of the exam a results reader needs. */
  describeExam(exam: ExamContext) {
    return {
      id: exam.id,
      name: exam.name,
      status: exam.status,
      examType: exam.examType,
      originalExamId: exam.originalExamId,
      passPolicy: exam.policy.passPolicy,
    };
  }

  /**
   * Staff-level access: an enabled module, access to the exam's campus, and
   * the results read permission. Students and guardians never use the
   * class-wide views.
   */
  private async assertStaffAccess(
    currentUser: CurrentUser,
    exam: ExamContext,
  ): Promise<void> {
    if (
      currentUser.role === UserRole.STUDENT ||
      currentUser.role === UserRole.GUARDIAN
    ) {
      throw new ForbiddenException(
        'Only staff can view results for a whole class.',
      );
    }
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      exam.campusId,
    );
    const allowed = await this.userPermissionsService.can(
      currentUser,
      'exam_results',
      'read',
    );
    if (!allowed) {
      throw new ForbiddenException(
        'You do not have read permission for exam results. Ask your administrator for access.',
      );
    }
  }

  /**
   * Staff need the results permission and campus access. A student may view
   * only themselves and a guardian only their wards, and only once the exam
   * is published.
   */
  private async assertCanViewStudent(
    currentUser: CurrentUser,
    exam: ExamContext,
    studentId: string,
  ): Promise<void> {
    if (
      currentUser.role !== UserRole.STUDENT &&
      currentUser.role !== UserRole.GUARDIAN
    ) {
      await this.assertStaffAccess(currentUser, exam);
      return;
    }

    const owned = await this.resolveOwnedStudentIds(currentUser);
    if (!owned.includes(studentId)) {
      throw new ForbiddenException('You can only view your own results.');
    }
    if (exam.status !== ExamStatus.PUBLISHED) {
      throw new NotFoundException(
        'Results for this exam are not published yet.',
      );
    }
  }

  /**
   * The students a self-service caller may see: themselves for a student,
   * their linked wards for a guardian.
   *
   * @param {CurrentUser} currentUser - A student or guardian.
   * @returns {Promise<string[]>} Student ids.
   */
  resolveOwnedStudentIds(currentUser: CurrentUser): Promise<string[]> {
    return this.ownedStudents.resolveOwnedStudentIds(currentUser);
  }

  private async assertModule(currentUser: CurrentUser): Promise<void> {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
  }
}
