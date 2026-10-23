import {
  computeExamOutcome,
  DEFAULT_PASS_POLICY,
  evaluateAnnualPass,
  GradeBandLite,
  PaperLite,
  parsePassPolicy,
  PassPolicy,
  rankStudents,
  ResultLite,
  resolveGrade,
  weightedAverage,
} from './exam-computation';

const bands: GradeBandLite[] = [
  { grade: 'A', minPercentage: 80, maxPercentage: 100, remarks: 'Excellent' },
  { grade: 'B', minPercentage: 60, maxPercentage: 79.99, remarks: 'Good' },
  { grade: 'C', minPercentage: 40, maxPercentage: 59.99, remarks: 'Pass' },
  // Deliberate gap between 33 and 40 and nothing below 33.
  { grade: 'D', minPercentage: 33, maxPercentage: 39.99, remarks: 'Weak' },
];

const paper = (id: string, max: number, pass: number): PaperLite => ({
  examSubjectId: id,
  subjectId: `subject-${id}`,
  subjectName: id.toUpperCase(),
  maxMarks: max,
  passingMarks: pass,
});

const results = (entries: Record<string, ResultLite>) =>
  new Map(Object.entries(entries));
const marks = (value: number): ResultLite => ({
  marksObtained: value,
  isAbsent: false,
});
const absent: ResultLite = { marksObtained: null, isAbsent: true };

const policy = (overrides: Partial<PassPolicy> = {}): PassPolicy => ({
  ...DEFAULT_PASS_POLICY,
  ...overrides,
});

describe('resolveGrade', () => {
  it('finds the band including both of its edges', () => {
    expect(resolveGrade(80, bands).grade).toBe('A');
    expect(resolveGrade(100, bands).grade).toBe('A');
    expect(resolveGrade(79.99, bands).grade).toBe('B');
    expect(resolveGrade(60, bands).grade).toBe('B');
  });

  it('rounds to two decimals before matching, so 79.995 is not lost in the gap', () => {
    expect(resolveGrade(79.995, bands).grade).toBe('A');
    expect(resolveGrade(79.994, bands).grade).toBe('B');
  });

  it('returns remarks with the grade', () => {
    expect(resolveGrade(85, bands)).toEqual({
      grade: 'A',
      remarks: 'Excellent',
    });
  });

  it('is ungraded for a percentage in a gap, below every band, or null', () => {
    expect(resolveGrade(10, bands)).toEqual({ grade: null, remarks: null });
    expect(resolveGrade(null, bands)).toEqual({ grade: null, remarks: null });
    expect(resolveGrade(50, [])).toEqual({ grade: null, remarks: null });
  });
});

describe('parsePassPolicy', () => {
  it('defaults to PER_SUBJECT with a 40 percent aggregate when unset or malformed', () => {
    expect(parsePassPolicy(undefined)).toEqual(DEFAULT_PASS_POLICY);
    expect(parsePassPolicy('nonsense')).toEqual(DEFAULT_PASS_POLICY);
    expect(parsePassPolicy({ passPolicy: 'MADE_UP' })).toEqual(
      DEFAULT_PASS_POLICY,
    );
  });

  it('reads valid values and ignores out-of-range percentages', () => {
    expect(
      parsePassPolicy({
        passPolicy: 'AGGREGATE_WITH_MINIMUM',
        aggregatePassPercentage: 50,
        minimumSubjectPercentage: 33,
      }),
    ).toEqual({
      passPolicy: 'AGGREGATE_WITH_MINIMUM',
      aggregatePassPercentage: 50,
      minimumSubjectPercentage: 33,
    });
    expect(
      parsePassPolicy({
        passPolicy: 'AGGREGATE',
        aggregatePassPercentage: 150,
        minimumSubjectPercentage: -5,
      }),
    ).toEqual({
      passPolicy: 'AGGREGATE',
      aggregatePassPercentage: 40,
      minimumSubjectPercentage: null,
    });
  });
});

describe('computeExamOutcome', () => {
  const papers = [paper('maths', 100, 40), paper('science', 50, 20)];

  it('totals marks and computes the percentage and grade over every marked paper', () => {
    const outcome = computeExamOutcome(
      papers,
      results({ maths: marks(80), science: marks(40) }),
      bands,
      policy(),
    );

    expect(outcome.totalMarks).toBe(120);
    expect(outcome.totalMaxMarks).toBe(150);
    expect(outcome.percentage).toBe(80);
    expect(outcome.grade).toBe('A');
    expect(outcome.subjects[1]).toMatchObject({
      percentage: 80,
      grade: 'A',
      passed: true,
    });
    expect(outcome.status).toBe('PASS');
  });

  it('leaves an absent paper out of both sides of the ratio instead of scoring it zero', () => {
    const outcome = computeExamOutcome(
      papers,
      results({ maths: marks(90), science: absent }),
      bands,
      policy(),
    );

    expect(outcome.percentage).toBe(90);
    expect(outcome.totalMaxMarks).toBe(100);
    expect(outcome.subjectsAppeared).toBe(1);
    expect(outcome.subjectsTotal).toBe(2);
    expect(outcome.subjects[1]).toMatchObject({
      state: 'ABSENT',
      marksObtained: null,
      passed: null,
    });
    expect(outcome.status).toBe('PASS');
  });

  it('has no percentage, grade or pass for a student absent from everything', () => {
    const outcome = computeExamOutcome(
      papers,
      results({ maths: absent, science: absent }),
      bands,
      policy(),
    );

    expect(outcome).toMatchObject({
      percentage: null,
      grade: null,
      status: 'ABSENT',
      isOverallPass: null,
      subjectsAppeared: 0,
    });
    expect(Number.isNaN(outcome.totalMarks)).toBe(false);
  });

  it('is incomplete, with no pass or fail, while a paper they sat has no marks yet', () => {
    const outcome = computeExamOutcome(
      papers,
      results({ maths: marks(10) }),
      bands,
      policy(),
    );

    expect(outcome.status).toBe('INCOMPLETE');
    expect(outcome.isOverallPass).toBeNull();
    expect(outcome.percentage).toBe(10);
    expect(outcome.subjects[1].state).toBe('UNMARKED');
    expect(outcome.subjectsAppeared).toBe(2);
  });

  it('is incomplete for an exam with no papers', () => {
    expect(computeExamOutcome([], results({}), bands, policy())).toMatchObject({
      status: 'INCOMPLETE',
      percentage: null,
      subjectsTotal: 0,
    });
  });

  it('treats marks of zero as marked, not missing', () => {
    const outcome = computeExamOutcome(
      [paper('maths', 100, 40)],
      results({ maths: marks(0) }),
      bands,
      policy(),
    );

    expect(outcome.subjects[0].state).toBe('MARKED');
    expect(outcome.percentage).toBe(0);
    expect(outcome.status).toBe('FAIL');
  });

  describe('pass policies', () => {
    // 45/100 maths (passes at 40), 10/50 science (fails at 20): 55 of 150 = 36.67%.
    const mixed = results({ maths: marks(45), science: marks(10) });
    // 90/100 and 21/50: aggregate 74%, science at 42%.
    const strongOverall = results({ maths: marks(90), science: marks(15) });

    it('PER_SUBJECT fails the exam if any attempted paper is below its own passing marks', () => {
      expect(computeExamOutcome(papers, mixed, bands, policy()).status).toBe(
        'FAIL',
      );
      expect(
        computeExamOutcome(papers, strongOverall, bands, policy()).status,
      ).toBe('FAIL');
      expect(
        computeExamOutcome(
          papers,
          results({ maths: marks(40), science: marks(20) }),
          bands,
          policy(),
        ).status,
      ).toBe('PASS');
    });

    it('PER_SUBJECT ignores an absent paper when judging the rest', () => {
      expect(
        computeExamOutcome(
          papers,
          results({ maths: marks(50), science: absent }),
          bands,
          policy(),
        ).status,
      ).toBe('PASS');
    });

    it('AGGREGATE passes on the overall percentage alone', () => {
      const aggregate = policy({
        passPolicy: 'AGGREGATE',
        aggregatePassPercentage: 50,
      });

      expect(
        computeExamOutcome(papers, strongOverall, bands, aggregate).status,
      ).toBe('PASS');
      expect(computeExamOutcome(papers, mixed, bands, aggregate).status).toBe(
        'FAIL',
      );
    });

    it('AGGREGATE treats the threshold as inclusive', () => {
      const exactly = results({ maths: marks(40), science: marks(20) });

      expect(
        computeExamOutcome(
          papers,
          exactly,
          bands,
          policy({ passPolicy: 'AGGREGATE', aggregatePassPercentage: 40 }),
        ).status,
      ).toBe('PASS');
    });

    it('AGGREGATE_WITH_MINIMUM needs both the aggregate and a floor in every paper', () => {
      const hybrid = policy({
        passPolicy: 'AGGREGATE_WITH_MINIMUM',
        aggregatePassPercentage: 50,
        minimumSubjectPercentage: 33,
      });

      // Science at 30% is under the floor even though the aggregate is 70%.
      const weakOne = results({ maths: marks(95), science: marks(15) });
      expect(computeExamOutcome(papers, weakOne, bands, hybrid).status).toBe(
        'FAIL',
      );
      // Both papers clear the floor and the aggregate clears 50%.
      const balanced = results({ maths: marks(60), science: marks(30) });
      expect(computeExamOutcome(papers, balanced, bands, hybrid).status).toBe(
        'PASS',
      );
      // Floors cleared but aggregate too low.
      const low = results({ maths: marks(34), science: marks(17) });
      expect(computeExamOutcome(papers, low, bands, hybrid).status).toBe(
        'FAIL',
      );
    });

    it('AGGREGATE_WITH_MINIMUM without a floor behaves like plain AGGREGATE', () => {
      const noFloor = policy({
        passPolicy: 'AGGREGATE_WITH_MINIMUM',
        aggregatePassPercentage: 50,
      });

      expect(
        computeExamOutcome(papers, strongOverall, bands, noFloor).status,
      ).toBe('PASS');
    });
  });
});

describe('rankStudents', () => {
  const student = (
    id: string,
    percentage: number | null,
    status: 'PASS' | 'INCOMPLETE' | 'ABSENT' = 'PASS',
  ) => ({
    id,
    percentage,
    status,
  });

  it('ranks highest first with ties sharing a rank and the next rank skipping ahead', () => {
    const ranks = rankStudents([
      student('a', 90),
      student('b', 85),
      student('c', 85),
      student('d', 70),
    ]);

    expect([...'abcd'].map((id) => ranks.get(id)?.position)).toEqual([
      1, 2, 2, 4,
    ]);
    expect(ranks.get('a')?.rankedCount).toBe(4);
  });

  it('does not rank students with no percentage or with marks outstanding', () => {
    const ranks = rankStudents([
      student('a', 90),
      student('b', null, 'ABSENT'),
      student('c', 99, 'INCOMPLETE'),
    ]);

    expect(ranks.get('a')?.position).toBe(1);
    expect(ranks.get('b')?.position).toBeNull();
    expect(ranks.get('c')?.position).toBeNull();
    expect(ranks.get('a')?.rankedCount).toBe(1);
  });

  it('handles an empty group and a single student', () => {
    expect(rankStudents([]).size).toBe(0);
    expect(rankStudents([student('a', 10)]).get('a')).toEqual({
      position: 1,
      rankedCount: 1,
    });
  });

  it('keeps three-way ties together', () => {
    const ranks = rankStudents([
      student('a', 50),
      student('b', 50),
      student('c', 50),
      student('d', 40),
    ]);

    expect([...'abcd'].map((id) => ranks.get(id)?.position)).toEqual([
      1, 1, 1, 4,
    ]);
  });
});

describe('weightedAverage', () => {
  it('weights each value by its weight', () => {
    expect(
      weightedAverage([
        { value: 60, weight: 1 },
        { value: 90, weight: 2 },
      ]),
    ).toBe(80);
  });

  it('is a plain average when weights are equal', () => {
    expect(
      weightedAverage([
        { value: 70, weight: 1 },
        { value: 80, weight: 1 },
      ]),
    ).toBe(75);
  });

  it('ignores missing values and zero weights, and is null when nothing counts', () => {
    expect(
      weightedAverage([
        { value: 80, weight: 1 },
        { value: null, weight: 5 },
        { value: 10, weight: 0 },
      ]),
    ).toBe(80);
    expect(weightedAverage([{ value: null, weight: 1 }])).toBeNull();
    expect(weightedAverage([])).toBeNull();
  });
});

describe('evaluateAnnualPass', () => {
  const subject = (percentage: number, passingPercentage = 40) => ({
    percentage,
    passingPercentage,
  });

  it('PER_SUBJECT needs every subject to reach its own annual passing percentage', () => {
    expect(evaluateAnnualPass([subject(55), subject(45)], 50, policy())).toBe(
      true,
    );
    expect(
      evaluateAnnualPass([subject(80), subject(39.99)], 60, policy()),
    ).toBe(false);
    expect(
      evaluateAnnualPass([subject(30, 30), subject(60)], 45, policy()),
    ).toBe(true);
  });

  it('AGGREGATE looks only at the overall percentage', () => {
    const aggregate = policy({
      passPolicy: 'AGGREGATE',
      aggregatePassPercentage: 50,
    });

    expect(evaluateAnnualPass([subject(90), subject(10)], 50, aggregate)).toBe(
      true,
    );
    expect(
      evaluateAnnualPass([subject(90), subject(10)], 49.99, aggregate),
    ).toBe(false);
  });

  it('AGGREGATE_WITH_MINIMUM needs the aggregate and the floor in every subject', () => {
    const hybrid = policy({
      passPolicy: 'AGGREGATE_WITH_MINIMUM',
      aggregatePassPercentage: 50,
      minimumSubjectPercentage: 33,
    });

    expect(evaluateAnnualPass([subject(90), subject(32)], 61, hybrid)).toBe(
      false,
    );
    expect(evaluateAnnualPass([subject(70), subject(40)], 55, hybrid)).toBe(
      true,
    );
    expect(evaluateAnnualPass([subject(40), subject(40)], 40, hybrid)).toBe(
      false,
    );
  });

  it('is null when there is nothing to judge', () => {
    expect(evaluateAnnualPass([], null, policy())).toBeNull();
    expect(evaluateAnnualPass([subject(50)], null, policy())).toBeNull();
  });
});
