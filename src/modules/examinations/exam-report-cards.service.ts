import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { PrintableMetaService } from '../../common/services/printable-meta.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import {
  EnrollmentStatus,
  ExamStatus,
  ExamType,
  ModuleKey,
  UserRole,
} from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeExamOutcome,
  evaluateAnnualPass,
  ExamOutcome,
  GradeBandLite,
  PaperLite,
  parsePassPolicy,
  PassPolicy,
  rankStudents,
  ResultLite,
  resolveGrade,
  round2,
  SubjectOutcome,
  weightedAverage,
} from './exam-computation';
import { ExamResultsViewService } from './exam-results-view.service';

interface TermExam {
  examId: string;
  name: string;
  termId: string;
  termName: string;
  termWeight: number;
  termOrder: number;
  papers: PaperLite[];
  bands: GradeBandLite[];
}

interface RetakeExam {
  examId: string;
  name: string;
  examType: ExamType;
  rootExamId: string;
  createdAt: Date;
  papers: PaperLite[];
}

interface ClassData {
  institutionId: string;
  campusId: string;
  policy: PassPolicy;
  academicYearName: string;
  className: string;
  terms: TermExam[];
  retakes: RetakeExam[];
  enrollments: Array<{
    studentId: string;
    name: string;
    regNo: string;
    picture: string | null;
    sectionId: string | null;
    sectionName: string | null;
  }>;
  /** studentId -> exam paper id -> result. */
  results: Map<string, Map<string, ResultLite>>;
  /** examId -> studentId -> literal position data from that exam alone. */
  literal: Map<string, Map<string, LiteralPosition>>;
}

interface LiteralPosition {
  positionInClass: number | null;
  classSize: number;
  positionInSection: number | null;
  sectionSize: number;
}

export interface ReportCardSubject extends SubjectOutcome {
  isRetake: boolean;
  retakeExamId: string | null;
  retakeExamType: ExamType | null;
  originalMarksObtained: number | null;
  originalPercentage: number | null;
  originalGrade: string | null;
}

/**
 * Report cards: every published regular exam of a student's class in an
 * academic year, term by term, plus an annual block weighted by term.
 *
 * A published retake, improvement or supplementary exam supersedes the
 * original for that subject on the card, and the original mark stays visible
 * beside it. Positions, however, come from each exam's own literal results:
 * ranking a mix of first attempts and retakes would compare different
 * sittings with each other.
 */
@Injectable()
export class ExamReportCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly campusAccessService: CampusAccessService,
    private readonly userPermissionsService: UserPermissionsService,
    private readonly printableMetaService: PrintableMetaService,
    private readonly viewService: ExamResultsViewService,
  ) {}

  /**
   * One student's report card for an academic year.
   *
   * @param {CurrentUser} currentUser - Staff with results access, or the student or their guardian.
   * @param {string} studentId - The student.
   * @param {string} academicYearId - The academic year.
   * @returns {Promise<{message: string, data: object}>} The card with its print header.
   * @throws {ForbiddenException} If the caller may not see this student's card.
   * @throws {NotFoundException} If the student was not enrolled that year.
   */
  async getReportCard(
    currentUser: CurrentUser,
    studentId: string,
    academicYearId: string,
  ) {
    await this.assertModule(currentUser);
    const enrollment = await this.prisma.studentEnrollment.findFirst({
      where: {
        studentId,
        academicYearId,
        status: { not: EnrollmentStatus.LEFT },
        deletedAt: null,
      },
      select: { classId: true, campusId: true },
    });
    if (!enrollment) {
      throw new NotFoundException(
        'This student was not enrolled in that academic year.',
      );
    }
    await this.assertCanView(currentUser, studentId, enrollment.campusId);

    const data = await this.loadClassData(enrollment.classId, academicYearId);
    const [card] = this.buildCards(data, { studentId });
    if (!card) {
      throw new NotFoundException(
        'This student has no report card for that year.',
      );
    }
    return {
      message: 'Report card fetched successfully',
      data: {
        ...card,
        printMeta: await this.printableMetaService.build(
          'REPORT_CARD',
          data.institutionId,
          data.campusId,
        ),
      },
    };
  }

  /**
   * Report cards for a whole class or one section, computed once for the class.
   *
   * @param {CurrentUser} currentUser - Staff with results access.
   * @param {string} academicYearId - The academic year.
   * @param {string} classId - The class.
   * @param {string} [sectionId] - Limit to one section.
   * @returns {Promise<{message: string, data: object}>} The cards and one shared print header.
   * @throws {ForbiddenException} If the caller is not staff with results access.
   */
  async getReportCards(
    currentUser: CurrentUser,
    academicYearId: string,
    classId: string,
    sectionId?: string,
  ) {
    await this.assertModule(currentUser);
    const academicClass = await this.prisma.academicClass.findUnique({
      where: { id: classId },
      select: { level: { select: { campusId: true } } },
    });
    if (!academicClass) {
      throw new NotFoundException('Class not found.');
    }
    await this.assertStaff(currentUser, academicClass.level.campusId);

    const data = await this.loadClassData(classId, academicYearId);
    const cards = this.buildCards(data, { sectionId });
    return {
      message: 'Report cards fetched successfully',
      data: {
        cards,
        printMeta: await this.printableMetaService.build(
          'REPORT_CARD',
          data.institutionId,
          data.campusId,
        ),
      },
    };
  }

  /**
   * Builds the cards for the filtered students from already-loaded class
   * data, so the class is read once however many cards are printed.
   */
  private buildCards(
    data: ClassData,
    filter: { studentId?: string; sectionId?: string },
  ) {
    return data.enrollments
      .filter(
        (row) =>
          (!filter.studentId || row.studentId === filter.studentId) &&
          (!filter.sectionId || row.sectionId === filter.sectionId),
      )
      .map((student) => {
        const terms = data.terms.map((term) =>
          this.buildTerm(data, term, student.studentId),
        );
        return {
          student: {
            id: student.studentId,
            name: student.name,
            regNo: student.regNo,
            picture: student.picture,
            className: data.className,
            sectionName: student.sectionName,
          },
          academicYear: { name: data.academicYearName },
          passPolicy: data.policy.passPolicy,
          terms,
          annual: this.buildAnnual(data, terms),
        };
      })
      .sort((a, b) => a.student.name.localeCompare(b.student.name));
  }

  private buildTerm(data: ClassData, term: TermExam, studentId: string) {
    const results =
      data.results.get(studentId) ?? new Map<string, ResultLite>();
    const retakes = data.retakes
      .filter((retake) => retake.rootExamId === term.examId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const effectivePapers: PaperLite[] = [];
    const effectiveResults = new Map<string, ResultLite>();
    const substitution = new Map<
      string,
      {
        retake: RetakeExam;
        original: ResultLite | undefined;
        originalPaper: PaperLite;
      }
    >();

    for (const paper of term.papers) {
      let chosenPaper = paper;
      for (const retake of retakes) {
        const retakePaper = retake.papers.find(
          (p) => p.subjectId === paper.subjectId,
        );
        const retakeResult = retakePaper
          ? results.get(retakePaper.examSubjectId)
          : undefined;
        if (
          retakePaper &&
          retakeResult &&
          !retakeResult.isAbsent &&
          retakeResult.marksObtained !== null
        ) {
          chosenPaper = retakePaper;
          effectiveResults.set(retakePaper.examSubjectId, retakeResult);
          substitution.set(retakePaper.examSubjectId, {
            retake,
            original: results.get(paper.examSubjectId),
            originalPaper: paper,
          });
          break;
        }
      }
      if (chosenPaper === paper) {
        const own = results.get(paper.examSubjectId);
        if (own) effectiveResults.set(paper.examSubjectId, own);
      }
      effectivePapers.push(chosenPaper);
    }

    const outcome = computeExamOutcome(
      effectivePapers,
      effectiveResults,
      term.bands,
      data.policy,
    );
    const subjects: ReportCardSubject[] = outcome.subjects.map((subject) => {
      const swapped = substitution.get(subject.examSubjectId);
      const originalMarks =
        swapped?.original && !swapped.original.isAbsent
          ? swapped.original.marksObtained
          : null;
      const originalPercentage =
        swapped && originalMarks !== null && swapped.originalPaper.maxMarks > 0
          ? round2((originalMarks / swapped.originalPaper.maxMarks) * 100)
          : null;
      return {
        ...subject,
        isRetake: Boolean(swapped),
        retakeExamId: swapped?.retake.examId ?? null,
        retakeExamType: swapped?.retake.examType ?? null,
        originalMarksObtained: originalMarks,
        originalPercentage,
        originalGrade: resolveGrade(originalPercentage, term.bands).grade,
      };
    });

    const position = data.literal.get(term.examId)?.get(studentId);
    return {
      term: { id: term.termId, name: term.termName, weight: term.termWeight },
      exam: { id: term.examId, name: term.name },
      outcome: { ...outcome, subjects },
      positionInClass: position?.positionInClass ?? null,
      classSize: position?.classSize ?? 0,
      positionInSection: position?.positionInSection ?? null,
      sectionSize: position?.sectionSize ?? 0,
    };
  }

  /**
   * The year's figures: each subject's and the overall percentage as a
   * weighted average across terms (a term's weight is its `ExamTerm.weight`),
   * judged by the same pass policy as a single exam. Null when no term has a
   * mark yet.
   */
  private buildAnnual(
    data: ClassData,
    terms: Array<ReturnType<ExamReportCardsService['buildTerm']>>,
  ) {
    const lastBands = data.terms[data.terms.length - 1]?.bands ?? [];
    const subjects = new Map<
      string,
      {
        subjectName: string;
        percentages: Array<{ value: number | null; weight: number }>;
        passing: Array<{ value: number | null; weight: number }>;
      }
    >();
    for (const term of terms) {
      for (const subject of term.outcome.subjects) {
        const entry = subjects.get(subject.subjectId) ?? {
          subjectName: subject.subjectName,
          percentages: [],
          passing: [],
        };
        entry.percentages.push({
          value: subject.percentage,
          weight: term.term.weight,
        });
        entry.passing.push({
          value:
            subject.state === 'MARKED' && subject.maxMarks > 0
              ? (subject.passingMarks / subject.maxMarks) * 100
              : null,
          weight: term.term.weight,
        });
        subjects.set(subject.subjectId, entry);
      }
    }

    const figures = [...subjects.entries()].flatMap(([subjectId, entry]) => {
      const percentage = weightedAverage(entry.percentages);
      const passingPercentage = weightedAverage(entry.passing);
      return percentage === null || passingPercentage === null
        ? []
        : [
            {
              subjectId,
              subjectName: entry.subjectName,
              percentage,
              passingPercentage,
            },
          ];
    });
    const overall = weightedAverage(
      terms.map((term) => ({
        value: term.outcome.percentage,
        weight: term.term.weight,
      })),
    );
    if (overall === null) return null;

    const complete = terms.every(
      (term) => term.outcome.status !== 'INCOMPLETE',
    );
    const isOverallPass = complete
      ? evaluateAnnualPass(figures, overall, data.policy)
      : null;
    return {
      percentage: overall,
      ...(() => {
        const { grade, remarks } = resolveGrade(overall, lastBands);
        return { grade, gradeRemarks: remarks };
      })(),
      isOverallPass,
      status:
        isOverallPass === null ? 'INCOMPLETE' : isOverallPass ? 'PASS' : 'FAIL',
      subjects: figures,
    };
  }

  /**
   * Loads everything needed for a class's report cards in a few queries:
   * the published regular exams, every retake that could supersede them, the
   * enrolled students, all their results, and each exam's literal positions.
   */
  private async loadClassData(
    classId: string,
    academicYearId: string,
  ): Promise<ClassData> {
    const [academicYear, academicClass, exams, enrollments] = await Promise.all(
      [
        this.prisma.academicYear.findUnique({
          where: { id: academicYearId },
          select: { name: true, institutionId: true },
        }),
        this.prisma.academicClass.findUnique({
          where: { id: classId },
          select: { name: true, level: { select: { campusId: true } } },
        }),
        this.prisma.exam.findMany({
          where: { classId, academicYearId },
          include: {
            examTerm: {
              select: { id: true, name: true, weight: true, sortOrder: true },
            },
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
              orderBy: { createdAt: 'asc' },
            },
          },
        }),
        this.prisma.studentEnrollment.findMany({
          where: {
            classId,
            academicYearId,
            status: { not: EnrollmentStatus.LEFT },
            deletedAt: null,
          },
          select: {
            sectionId: true,
            section: { select: { name: true } },
            student: {
              select: {
                id: true,
                regNo: true,
                picture: true,
                user: { select: { name: true } },
              },
            },
          },
        }),
      ],
    );
    if (!academicYear || !academicClass) {
      throw new NotFoundException('Academic year or class not found.');
    }

    const setting = await this.prisma.institutionSetting.findUnique({
      where: {
        institutionId_key_activeScopeKey: {
          institutionId: academicYear.institutionId,
          key: 'exams',
          activeScopeKey: 'ACTIVE',
        },
      },
      select: { value: true },
    });

    const papersOf = (exam: (typeof exams)[number]): PaperLite[] =>
      exam.subjects.map((paper) => ({
        examSubjectId: paper.id,
        subjectId: paper.subjectId,
        subjectName: paper.subject.name,
        maxMarks: Number(paper.maxMarks),
        passingMarks: Number(paper.passingMarks),
      }));

    const byId = new Map(exams.map((exam) => [exam.id, exam]));
    const rootOf = (exam: (typeof exams)[number]): string => {
      let current = exam;
      const seen = new Set<string>();
      while (
        current.originalExamId &&
        byId.has(current.originalExamId) &&
        !seen.has(current.id)
      ) {
        seen.add(current.id);
        current = byId.get(current.originalExamId)!;
      }
      return current.id;
    };

    const terms: TermExam[] = exams
      .filter(
        (exam) =>
          exam.examType === ExamType.REGULAR &&
          exam.status === ExamStatus.PUBLISHED,
      )
      .map((exam) => ({
        examId: exam.id,
        name: exam.name,
        termId: exam.examTerm.id,
        termName: exam.examTerm.name,
        termWeight: Number(exam.examTerm.weight),
        termOrder: exam.examTerm.sortOrder,
        papers: papersOf(exam),
        bands: exam.gradingScale.bands.map((band) => ({
          grade: band.grade,
          minPercentage: Number(band.minPercentage),
          maxPercentage: Number(band.maxPercentage),
          remarks: band.remarks,
        })),
      }))
      .sort(
        (a, b) =>
          a.termOrder - b.termOrder || a.termName.localeCompare(b.termName),
      );

    const termIds = new Set(terms.map((term) => term.examId));
    const retakes: RetakeExam[] = exams
      .filter(
        (exam) =>
          exam.examType !== ExamType.REGULAR &&
          exam.status === ExamStatus.PUBLISHED,
      )
      .map((exam) => ({
        examId: exam.id,
        name: exam.name,
        examType: exam.examType,
        rootExamId: rootOf(exam),
        createdAt: exam.createdAt,
        papers: papersOf(exam),
      }))
      .filter((retake) => termIds.has(retake.rootExamId));

    const paperIds = [...terms, ...retakes].flatMap((exam) =>
      exam.papers.map((p) => p.examSubjectId),
    );
    const rows = paperIds.length
      ? await this.prisma.examResult.findMany({
          where: {
            examSubjectId: { in: paperIds },
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
    const results = new Map<string, Map<string, ResultLite>>();
    for (const row of rows) {
      const forStudent =
        results.get(row.studentId) ?? new Map<string, ResultLite>();
      forStudent.set(row.examSubjectId, {
        marksObtained:
          row.marksObtained === null ? null : Number(row.marksObtained),
        isAbsent: row.isAbsent,
      });
      results.set(row.studentId, forStudent);
    }

    const people = enrollments.map((row) => ({
      studentId: row.student.id,
      name: row.student.user.name,
      regNo: row.student.regNo,
      picture: row.student.picture,
      sectionId: row.sectionId,
      sectionName: row.section?.name ?? null,
    }));
    const policy = parsePassPolicy(setting?.value);

    return {
      institutionId: academicYear.institutionId,
      campusId: academicClass.level.campusId,
      policy,
      academicYearName: academicYear.name,
      className: academicClass.name,
      terms,
      retakes,
      enrollments: people,
      results,
      literal: this.computeLiteralPositions(terms, people, results, policy),
    };
  }

  /**
   * Position per regular exam from that exam's own literal marks, in the
   * whole class and within each section.
   */
  private computeLiteralPositions(
    terms: TermExam[],
    people: ClassData['enrollments'],
    results: ClassData['results'],
    policy: PassPolicy,
  ): ClassData['literal'] {
    const literal: ClassData['literal'] = new Map();
    for (const term of terms) {
      const outcomes = people.map((person) => {
        const own = new Map<string, ResultLite>();
        for (const paper of term.papers) {
          const result = results
            .get(person.studentId)
            ?.get(paper.examSubjectId);
          if (result) own.set(paper.examSubjectId, result);
        }
        const outcome: ExamOutcome = computeExamOutcome(
          term.papers,
          own,
          term.bands,
          policy,
        );
        return {
          id: person.studentId,
          sectionId: person.sectionId,
          percentage: outcome.percentage,
          status: outcome.status,
        };
      });

      const classRanks = rankStudents(outcomes);
      const sectionRanks = new Map<string, ReturnType<typeof rankStudents>>();
      for (const sectionKey of new Set(outcomes.map((o) => o.sectionId))) {
        sectionRanks.set(
          sectionKey ?? '',
          rankStudents(outcomes.filter((o) => o.sectionId === sectionKey)),
        );
      }
      literal.set(
        term.examId,
        new Map(
          outcomes.map((o) => {
            const inClass = classRanks.get(o.id);
            const inSection = sectionRanks.get(o.sectionId ?? '')?.get(o.id);
            return [
              o.id,
              {
                positionInClass: inClass?.position ?? null,
                classSize: inClass?.rankedCount ?? 0,
                positionInSection: inSection?.position ?? null,
                sectionSize: inSection?.rankedCount ?? 0,
              },
            ];
          }),
        ),
      );
    }
    return literal;
  }

  /** Staff need campus access and the results permission. */
  private async assertStaff(
    currentUser: CurrentUser,
    campusId: string,
  ): Promise<void> {
    if (
      currentUser.role === UserRole.STUDENT ||
      currentUser.role === UserRole.GUARDIAN
    ) {
      throw new ForbiddenException(
        'Only staff can view report cards for a whole class.',
      );
    }
    await this.campusAccessService.assertCampusAccess(currentUser, campusId);
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

  /** Staff with access, or the student themselves, or their guardian. */
  private async assertCanView(
    currentUser: CurrentUser,
    studentId: string,
    campusId: string,
  ): Promise<void> {
    if (
      currentUser.role !== UserRole.STUDENT &&
      currentUser.role !== UserRole.GUARDIAN
    ) {
      await this.assertStaff(currentUser, campusId);
      return;
    }
    const owned = await this.viewService.resolveOwnedStudentIds(currentUser);
    if (!owned.includes(studentId)) {
      throw new ForbiddenException('You can only view your own report card.');
    }
  }

  private async assertModule(currentUser: CurrentUser): Promise<void> {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
  }
}
