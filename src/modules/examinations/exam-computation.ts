/**
 * Pure result computation for exams: grades, percentages, pass or fail under
 * the institution's policy, ranking and weighted averages. No database access
 * and no side effects, so every consumer (one exam's summary, a report card,
 * the annual aggregate) shares one implementation.
 */

export interface GradeBandLite {
  grade: string;
  minPercentage: number;
  maxPercentage: number;
  remarks: string | null;
}

export type PassPolicyKind =
  | 'PER_SUBJECT'
  | 'AGGREGATE'
  | 'AGGREGATE_WITH_MINIMUM';

export interface PassPolicy {
  passPolicy: PassPolicyKind;
  /** Overall percentage needed under AGGREGATE and AGGREGATE_WITH_MINIMUM. */
  aggregatePassPercentage: number;
  /** Per-subject floor for AGGREGATE_WITH_MINIMUM; null means no floor. */
  minimumSubjectPercentage: number | null;
}

export const DEFAULT_PASS_POLICY: PassPolicy = {
  passPolicy: 'PER_SUBJECT',
  aggregatePassPercentage: 40,
  minimumSubjectPercentage: null,
};

export interface PaperLite {
  examSubjectId: string;
  subjectId: string;
  subjectName: string;
  maxMarks: number;
  passingMarks: number;
}

export interface ResultLite {
  marksObtained: number | null;
  isAbsent: boolean;
}

/** MARKED: has marks. ABSENT: did not sit. UNMARKED: sat, but no marks entered yet. */
export type SubjectState = 'MARKED' | 'ABSENT' | 'UNMARKED';

export interface SubjectOutcome extends PaperLite {
  marksObtained: number | null;
  state: SubjectState;
  percentage: number | null;
  grade: string | null;
  gradeRemarks: string | null;
  /** Whether the paper's own passing marks were met; null unless marked. */
  passed: boolean | null;
}

export type ExamStatus = 'PASS' | 'FAIL' | 'ABSENT' | 'INCOMPLETE';

export interface ExamOutcome {
  subjects: SubjectOutcome[];
  totalMarks: number;
  totalMaxMarks: number;
  /** Over marked papers only; null when nothing is marked. */
  percentage: number | null;
  grade: string | null;
  gradeRemarks: string | null;
  /** Papers the student sat (marked or still awaiting marks), excluding absences. */
  subjectsAppeared: number;
  subjectsTotal: number;
  /** PASS or FAIL once every paper they sat is marked; INCOMPLETE until then. */
  status: ExamStatus;
  isOverallPass: boolean | null;
}

export const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Reads the stored `exams` institution setting, falling back to defaults for
 * anything missing or invalid so a bad value can never block result display.
 *
 * @param {unknown} value - The raw JSON value of the setting.
 * @returns {PassPolicy} A complete, valid policy.
 */
export function parsePassPolicy(value: unknown): PassPolicy {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PASS_POLICY };
  const raw = value as Record<string, unknown>;
  const kinds: PassPolicyKind[] = [
    'PER_SUBJECT',
    'AGGREGATE',
    'AGGREGATE_WITH_MINIMUM',
  ];
  const passPolicy = kinds.includes(raw.passPolicy as PassPolicyKind)
    ? (raw.passPolicy as PassPolicyKind)
    : DEFAULT_PASS_POLICY.passPolicy;
  const percent = (candidate: unknown): number | null =>
    typeof candidate === 'number' && candidate >= 0 && candidate <= 100
      ? candidate
      : null;

  return {
    passPolicy,
    aggregatePassPercentage:
      percent(raw.aggregatePassPercentage) ??
      DEFAULT_PASS_POLICY.aggregatePassPercentage,
    minimumSubjectPercentage: percent(raw.minimumSubjectPercentage),
  };
}

/**
 * Finds the band a percentage falls in. Bands need not cover 0 to 100, so a
 * percentage in a gap is ungraded rather than an error.
 *
 * @param {number | null} percentage - The percentage, or null when there is none.
 * @param {GradeBandLite[]} bands - The grading scale's bands.
 * @returns {{grade: string | null, remarks: string | null}} The grade, or nulls when ungraded.
 */
export function resolveGrade(
  percentage: number | null,
  bands: GradeBandLite[],
): { grade: string | null; remarks: string | null } {
  if (percentage === null) return { grade: null, remarks: null };
  const rounded = round2(percentage);
  const band = bands.find(
    (b) => rounded >= b.minPercentage && rounded <= b.maxPercentage,
  );
  return band
    ? { grade: band.grade, remarks: band.remarks }
    : { grade: null, remarks: null };
}

/**
 * One student's outcome for one exam.
 *
 * The percentage is total marks over total maximum across marked papers only:
 * an absence is left out of both sides, so a missed paper is not scored as
 * zero. Papers the student sat that are still awaiting marks keep the result
 * INCOMPLETE rather than letting a partial total decide pass or fail.
 *
 * @param {PaperLite[]} papers - The exam's papers.
 * @param {Map<string, ResultLite>} results - This student's results by exam paper id.
 * @param {GradeBandLite[]} bands - The exam's grading scale bands.
 * @param {PassPolicy} policy - The institution's pass policy.
 * @returns {ExamOutcome} Per-paper outcomes and the overall result.
 */
export function computeExamOutcome(
  papers: PaperLite[],
  results: Map<string, ResultLite>,
  bands: GradeBandLite[],
  policy: PassPolicy,
): ExamOutcome {
  const subjects: SubjectOutcome[] = papers.map((paper) => {
    const result = results.get(paper.examSubjectId);
    const state: SubjectState = result?.isAbsent
      ? 'ABSENT'
      : result && result.marksObtained !== null
        ? 'MARKED'
        : 'UNMARKED';
    const marks = state === 'MARKED' ? (result?.marksObtained ?? null) : null;
    const percentage =
      marks !== null && paper.maxMarks > 0
        ? round2((marks / paper.maxMarks) * 100)
        : null;
    const { grade, remarks } = resolveGrade(percentage, bands);
    return {
      ...paper,
      marksObtained: marks,
      state,
      percentage,
      grade,
      gradeRemarks: remarks,
      passed: marks === null ? null : marks >= paper.passingMarks,
    };
  });

  const marked = subjects.filter((s) => s.state === 'MARKED');
  const totalMarks = marked.reduce((sum, s) => sum + (s.marksObtained ?? 0), 0);
  const totalMaxMarks = marked.reduce((sum, s) => sum + s.maxMarks, 0);
  const percentage =
    totalMaxMarks > 0 ? round2((totalMarks / totalMaxMarks) * 100) : null;
  const { grade, remarks } = resolveGrade(percentage, bands);
  const unmarked = subjects.filter((s) => s.state === 'UNMARKED').length;

  let status: ExamStatus;
  let isOverallPass: boolean | null = null;
  if (subjects.length === 0 || unmarked > 0) {
    status = 'INCOMPLETE';
  } else if (marked.length === 0) {
    status = 'ABSENT';
  } else {
    isOverallPass = evaluatePass(marked, percentage, policy);
    status = isOverallPass ? 'PASS' : 'FAIL';
  }

  return {
    subjects,
    totalMarks: round2(totalMarks),
    totalMaxMarks: round2(totalMaxMarks),
    percentage,
    grade,
    gradeRemarks: remarks,
    subjectsAppeared: marked.length + unmarked,
    subjectsTotal: subjects.length,
    status,
    isOverallPass,
  };
}

/**
 * Applies the pass policy to a student's marked papers.
 *
 * @param {SubjectOutcome[]} marked - The marked papers (at least one).
 * @param {number | null} percentage - The overall percentage.
 * @param {PassPolicy} policy - The institution's pass policy.
 * @returns {boolean} Whether the student passes overall.
 */
export function evaluatePass(
  marked: SubjectOutcome[],
  percentage: number | null,
  policy: PassPolicy,
): boolean {
  const overall = percentage ?? 0;
  if (policy.passPolicy === 'PER_SUBJECT') {
    return marked.every((subject) => subject.passed === true);
  }
  const clearsAggregate = overall >= policy.aggregatePassPercentage;
  if (
    policy.passPolicy === 'AGGREGATE' ||
    policy.minimumSubjectPercentage === null
  ) {
    return clearsAggregate;
  }
  const floor = policy.minimumSubjectPercentage;
  return (
    clearsAggregate &&
    marked.every((subject) => (subject.percentage ?? 0) >= floor)
  );
}

export interface RankInput {
  id: string;
  percentage: number | null;
  status: ExamStatus;
}

export interface RankResult {
  /** Competition rank (1, 2, 2, 4), or null when the student is not ranked. */
  position: number | null;
  /** How many students were ranked in this group. */
  rankedCount: number;
}

/**
 * Standard competition ranking by percentage, highest first: students tied
 * share a rank and the next rank skips ahead. Students with no percentage, or
 * with marks still outstanding, are not ranked, because a partial total would
 * be compared unfairly with complete ones.
 *
 * @param {RankInput[]} students - Everyone in the ranking group.
 * @returns {Map<string, RankResult>} Each student's position and the group's ranked count.
 */
export function rankStudents(students: RankInput[]): Map<string, RankResult> {
  const ranked = students
    .filter((s) => s.percentage !== null && s.status !== 'INCOMPLETE')
    .sort((a, b) => (b.percentage as number) - (a.percentage as number));
  const positions = new Map<string, RankResult>();

  ranked.forEach((student, index) => {
    const previous = ranked[index - 1];
    const sameAsPrevious =
      previous && previous.percentage === student.percentage;
    const position = sameAsPrevious
      ? (positions.get(previous.id)?.position ?? index + 1)
      : index + 1;
    positions.set(student.id, { position, rankedCount: ranked.length });
  });
  for (const student of students) {
    if (!positions.has(student.id)) {
      positions.set(student.id, { position: null, rankedCount: ranked.length });
    }
  }
  return positions;
}

/**
 * Weighted average of values, ignoring entries with no value.
 *
 * @param {Array<{value: number | null, weight: number}>} items - Values and their weights.
 * @returns {number | null} The average to two decimals, or null when no weight counts.
 */
export function weightedAverage(
  items: Array<{ value: number | null; weight: number }>,
): number | null {
  const counted = items.filter(
    (item) => item.value !== null && item.weight > 0,
  );
  const totalWeight = counted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) return null;
  const sum = counted.reduce(
    (acc, item) => acc + (item.value as number) * item.weight,
    0,
  );
  return round2(sum / totalWeight);
}

export interface AnnualSubjectFigure {
  /** Weighted average percentage across the terms this subject was marked. */
  percentage: number;
  /** Weighted average of the paper's own passing percentage across those terms. */
  passingPercentage: number;
}

/**
 * Applies the institution's pass policy to annual figures, so a school never
 * has two different pass rules inside one academic year. Per-subject means
 * each subject's annual percentage reaches its own annual passing percentage.
 *
 * @param {AnnualSubjectFigure[]} subjects - Annual per-subject figures (at least one).
 * @param {number | null} overall - The annual overall percentage.
 * @param {PassPolicy} policy - The institution's pass policy.
 * @returns {boolean | null} Whether the student passes the year, or null when there is nothing to judge.
 */
export function evaluateAnnualPass(
  subjects: AnnualSubjectFigure[],
  overall: number | null,
  policy: PassPolicy,
): boolean | null {
  if (overall === null || subjects.length === 0) return null;
  if (policy.passPolicy === 'PER_SUBJECT') {
    return subjects.every(
      (s) => round2(s.percentage) >= round2(s.passingPercentage),
    );
  }
  const clearsAggregate = overall >= policy.aggregatePassPercentage;
  if (
    policy.passPolicy === 'AGGREGATE' ||
    policy.minimumSubjectPercentage === null
  ) {
    return clearsAggregate;
  }
  const floor = policy.minimumSubjectPercentage;
  return clearsAggregate && subjects.every((s) => s.percentage >= floor);
}
