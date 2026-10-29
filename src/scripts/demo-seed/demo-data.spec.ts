import {
  buildDemoPlan,
  CHRONIC_ABSENTEE_INDEX,
  DEFAULT_NAMESPACE,
  DEMO_PAPERS,
  demoMarks,
  demoPhone,
  recentWeekdays,
  seededRandom,
  STUDENTS_PER_SECTION,
  studentDayStatus,
} from './demo-data';

describe('demo data', () => {
  const plan = buildDemoPlan();
  const students = plan.campuses.flatMap((campus) =>
    campus.classes.flatMap((item) =>
      item.sections.flatMap((section) => section.students),
    ),
  );

  it('builds two campuses with the same students every time', () => {
    expect(plan.campuses.map((campus) => campus.name)).toEqual([
      'Main Campus',
      'North Campus',
    ]);
    expect(students).toHaveLength(4 * STUDENTS_PER_SECTION);
    expect(buildDemoPlan()).toEqual(plan);
  });

  it('gives every student a distinct registration number under the namespace prefix', () => {
    const numbers = students.map((student) => student.regNo);

    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers[0]).toBe('DEMO-0001');
    expect(
      buildDemoPlan({ ...DEFAULT_NAMESPACE, regPrefix: 'X-' }).campuses[0]
        .classes[0].sections[0].students[0].regNo,
    ).toBe('X-0001');
  });

  it('puts every student in exactly one family, with some siblings sharing a guardian', () => {
    const covered = plan.families.flatMap((family) => family.studentRegNos);

    expect([...covered].sort()).toEqual(
      students.map((student) => student.regNo).sort(),
    );
    expect(
      plan.families.some((family) => family.studentRegNos.length === 2),
    ).toBe(true);
    expect(
      plan.families.every((family) => family.studentRegNos.length <= 2),
    ).toBe(true);
  });

  it('gives each guardian a distinct Pakistani mobile number, shifted by the namespace', () => {
    const phones = plan.families.map((family) => family.phone);

    expect(new Set(phones).size).toBe(phones.length);
    expect(phones.every((phone) => /^\+923\d{9}$/.test(phone))).toBe(true);
    expect(demoPhone(0)).toBe('+923000000001');
    expect(demoPhone(0, 5_000_000)).toBe('+923005000001');
  });

  it('lists school days only, ending on the last weekday', () => {
    // 1 Nov 2026 is a Sunday.
    const days = recentWeekdays(new Date('2026-11-01T10:00:00Z'), 7);

    expect(days).toEqual([
      '2026-10-22',
      '2026-10-23',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
    ]);
    expect(
      days.every((day) => ![0, 6].includes(new Date(day).getUTCDay())),
    ).toBe(true);
  });

  it('repeats the same stream for the same seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);

    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('makes one student often absent and no one else', () => {
    const absentShare = (index: number) =>
      Array.from({ length: 20 }, (_, day) =>
        studentDayStatus(index, day),
      ).filter((status) => status === 'ABSENT').length / 20;

    expect(absentShare(CHRONIC_ABSENTEE_INDEX)).toBeGreaterThanOrEqual(0.2);
    for (const student of students) {
      if (student.index !== CHRONIC_ABSENTEE_INDEX) {
        expect(absentShare(student.index)).toBeLessThan(0.2);
      }
    }
  });

  it('keeps marks within each paper, with some students failing and some scoring top marks', () => {
    const all = students.flatMap((student) =>
      DEMO_PAPERS.map((paper, paperIndex) => ({
        paper,
        marks: demoMarks(student.index, paperIndex, paper),
      })),
    );
    const marked = all.filter(
      (
        entry,
      ): entry is { paper: (typeof DEMO_PAPERS)[number]; marks: number } =>
        entry.marks !== null,
    );

    expect(
      marked.every(
        (entry) => entry.marks >= 0 && entry.marks <= entry.paper.maxMarks,
      ),
    ).toBe(true);
    expect(marked.some((entry) => entry.marks < entry.paper.passingMarks)).toBe(
      true,
    );
    expect(
      marked.some((entry) => entry.marks >= entry.paper.maxMarks * 0.9),
    ).toBe(true);
  });
});
