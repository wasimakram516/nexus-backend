/**
 * The shape and content of the demo school. Everything here is plain data
 * built the same way every time, so the demo looks identical on every run and
 * the figures it produces can be checked by hand.
 */

export const DEMO_SLUG = 'demo-school';
export const DEMO_SCHOOL_NAME = 'Demo Public School';
export const DEMO_EMAIL_DOMAIN = 'demo-school.test';
/** Registration numbers share this prefix so they cannot clash with a real school's. */
export const DEMO_REG_PREFIX = 'DEMO-';

/**
 * What makes one demo school's records different from another's, so a second
 * demo can sit beside the first in the same database. The command uses the
 * defaults; only tests give their own.
 */
export interface DemoNamespace {
  slug: string;
  emailDomain: string;
  regPrefix: string;
  /** Added to every guardian phone so two demos never share a number. */
  phoneBase: number;
}

export const DEFAULT_NAMESPACE: DemoNamespace = {
  slug: DEMO_SLUG,
  emailDomain: DEMO_EMAIL_DOMAIN,
  regPrefix: DEMO_REG_PREFIX,
  phoneBase: 0,
};

export type DemoGender = 'MALE' | 'FEMALE';

export interface DemoStudent {
  regNo: string;
  name: string;
  gender: DemoGender;
  /** Position across the whole school, used to vary attendance and marks. */
  index: number;
}

export interface DemoSection {
  name: string;
  students: DemoStudent[];
}

export interface DemoClass {
  name: string;
  /** Monthly tuition in rupees. */
  tuition: number;
  sections: DemoSection[];
}

export type DemoAccessRole = 'Accountant' | 'Front Desk';

export interface DemoStaff {
  name: string;
  gender: DemoGender;
  designation: string;
  teaching: boolean;
  baseSalary: number;
  /** The access role they are given, if any. */
  accessRole: DemoAccessRole | null;
}

export interface DemoCampus {
  name: string;
  location: string;
  classes: DemoClass[];
  staff: DemoStaff[];
}

export interface DemoFamily {
  guardianName: string;
  relation: 'FATHER' | 'MOTHER';
  /** International form, valid for Pakistan. */
  phone: string;
  studentRegNos: string[];
}

export interface DemoPlan {
  campuses: DemoCampus[];
  subjects: string[];
  families: DemoFamily[];
}

const BOYS = [
  'Ahmed',
  'Bilal',
  'Hamza',
  'Usman',
  'Zain',
  'Hassan',
  'Ali',
  'Daniyal',
  'Faizan',
  'Haris',
  'Ibrahim',
  'Junaid',
  'Kamran',
  'Laiba',
  'Moiz',
  'Noman',
];
const GIRLS = [
  'Ayesha',
  'Fatima',
  'Zainab',
  'Maryam',
  'Hira',
  'Sana',
  'Areeba',
  'Iqra',
  'Khadija',
  'Mahnoor',
  'Noor',
  'Rabia',
  'Sidra',
  'Tooba',
  'Uzma',
  'Warda',
];
const FAMILY_NAMES = [
  'Khan',
  'Malik',
  'Sheikh',
  'Butt',
  'Qureshi',
  'Chaudhry',
  'Raza',
  'Siddiqui',
  'Ansari',
  'Mirza',
  'Baig',
  'Hashmi',
  'Javed',
  'Nawaz',
  'Rashid',
  'Tariq',
];

/** Students in each section. */
export const STUDENTS_PER_SECTION = 6;

/**
 * A repeatable stream of numbers between 0 and 1.
 *
 * @param {number} seed - Same seed, same stream.
 * @returns {() => number} The next number each call.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A guardian's login phone: a Pakistani mobile number in a range no real line uses. */
export const demoPhone = (index: number, base = 0): string =>
  `+92300${String(base + index + 1).padStart(7, '0')}`;

const personName = (index: number, gender: DemoGender) =>
  `${(gender === 'MALE' ? BOYS : GIRLS)[index % 16]} ${FAMILY_NAMES[(index * 7 + 3) % 16]}`;

/**
 * Builds the whole demo school: two campuses, a few classes each, students
 * grouped into families, and staff.
 *
 * @returns {DemoPlan} The people and structure to create.
 */
export function buildDemoPlan(
  namespace: DemoNamespace = DEFAULT_NAMESPACE,
): DemoPlan {
  let counter = 0;
  const students = (): DemoStudent[] =>
    Array.from({ length: STUDENTS_PER_SECTION }, () => {
      const index = counter;
      counter += 1;
      const gender: DemoGender = index % 2 === 0 ? 'MALE' : 'FEMALE';
      return {
        regNo: `${namespace.regPrefix}${String(index + 1).padStart(4, '0')}`,
        name: personName(index, gender),
        gender,
        index,
      };
    });

  const campuses: DemoCampus[] = [
    {
      name: 'Main Campus',
      location: 'Lahore',
      classes: [
        {
          name: 'Grade 4',
          tuition: 4500,
          sections: [
            { name: 'A', students: students() },
            { name: 'B', students: students() },
          ],
        },
        {
          name: 'Grade 5',
          tuition: 5000,
          sections: [{ name: 'A', students: students() }],
        },
      ],
      staff: [
        {
          name: 'Sadia Rehman',
          gender: 'FEMALE',
          designation: 'Class Teacher',
          teaching: true,
          baseSalary: 55000,
          accessRole: null,
        },
        {
          name: 'Imran Aslam',
          gender: 'MALE',
          designation: 'Maths Teacher',
          teaching: true,
          baseSalary: 60000,
          accessRole: null,
        },
        {
          name: 'Nadia Hussain',
          gender: 'FEMALE',
          designation: 'Accountant',
          teaching: false,
          baseSalary: 70000,
          accessRole: 'Accountant',
        },
        {
          name: 'Waqar Ahmed',
          gender: 'MALE',
          designation: 'Front Desk Officer',
          teaching: false,
          baseSalary: 40000,
          accessRole: 'Front Desk',
        },
      ],
    },
    {
      name: 'North Campus',
      location: 'Islamabad',
      classes: [
        {
          name: 'Grade 4',
          tuition: 4000,
          sections: [{ name: 'A', students: students() }],
        },
      ],
      staff: [
        {
          name: 'Farah Naz',
          gender: 'FEMALE',
          designation: 'Class Teacher',
          teaching: true,
          baseSalary: 50000,
          accessRole: null,
        },
        {
          name: 'Tahir Mehmood',
          gender: 'MALE',
          designation: 'Science Teacher',
          teaching: true,
          baseSalary: 52000,
          accessRole: null,
        },
      ],
    },
  ];

  // Every fifth student has a sibling right after them who shares the guardian.
  const everyone = campuses.flatMap((campus) =>
    campus.classes.flatMap((item) =>
      item.sections.flatMap((section) => section.students),
    ),
  );
  const families: DemoFamily[] = [];
  for (let at = 0; at < everyone.length; at += 1) {
    const student = everyone[at];
    const sibling = at % 5 === 0 ? everyone[at + 1] : undefined;
    const familyIndex = families.length;
    families.push({
      guardianName: `${familyIndex % 2 === 0 ? 'Mr.' : 'Mrs.'} ${student.name.split(' ')[1]}`,
      relation: familyIndex % 2 === 0 ? 'FATHER' : 'MOTHER',
      phone: demoPhone(familyIndex, namespace.phoneBase),
      studentRegNos: sibling ? [student.regNo, sibling.regNo] : [student.regNo],
    });
    if (sibling) at += 1;
  }

  return {
    campuses,
    subjects: ['Maths', 'English', 'Science', 'Urdu'],
    families,
  };
}

/** The weekdays (Monday to Friday) ending at `today`, oldest first. */
export function recentWeekdays(today: Date, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  while (days.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6)
      days.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days;
}

export type DemoAttendance = 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE';

/**
 * What a student's day looked like. Most days are present; one student in the
 * demo is absent often enough to appear in the chronic absentees report.
 *
 * @param {number} studentIndex - The student's position in the school.
 * @param {number} dayIndex - Which school day, counting from the oldest.
 * @returns {DemoAttendance} The status for that day.
 */
export function studentDayStatus(
  studentIndex: number,
  dayIndex: number,
): DemoAttendance {
  const roll = seededRandom(studentIndex * 1009 + dayIndex * 31 + 7)();
  if (studentIndex === CHRONIC_ABSENTEE_INDEX)
    return roll < 0.4 ? 'ABSENT' : 'PRESENT';
  if (roll < 0.03) return 'ABSENT';
  if (roll < 0.07) return 'LATE';
  if (roll < 0.08) return 'LEAVE';
  return 'PRESENT';
}

/** The student who is often absent, for the chronic absentees report. */
export const CHRONIC_ABSENTEE_INDEX = 3;

/** A teacher's or other staff member's day: nearly always present. */
export function staffDayStatus(
  staffIndex: number,
  dayIndex: number,
): DemoAttendance {
  const roll = seededRandom(staffIndex * 7919 + dayIndex * 17 + 3)();
  if (roll < 0.02) return 'ABSENT';
  if (roll < 0.06) return 'LATE';
  return 'PRESENT';
}

export interface DemoPaper {
  subject: string;
  maxMarks: number;
  passingMarks: number;
}

export const DEMO_PAPERS: DemoPaper[] = [
  { subject: 'Maths', maxMarks: 100, passingMarks: 40 },
  { subject: 'English', maxMarks: 100, passingMarks: 40 },
  { subject: 'Science', maxMarks: 50, passingMarks: 20 },
];

/**
 * A student's marks in a paper, or null when they did not sit it. The spread
 * is wide enough that the exam reports show top grades and a few failures.
 *
 * @param {number} studentIndex - The student's position in the school.
 * @param {number} paperIndex - Which paper of the exam.
 * @param {DemoPaper} paper - The paper.
 * @returns {number | null} Marks out of the paper's maximum, or null for an absence.
 */
export function demoMarks(
  studentIndex: number,
  paperIndex: number,
  paper: DemoPaper,
): number | null {
  const roll = seededRandom(studentIndex * 104729 + paperIndex * 13 + 1)();
  if (roll < 0.04) return null;
  const share = 0.25 + roll * 0.72;
  return Math.round(share * paper.maxMarks);
}

export interface DemoGradeBand {
  grade: string;
  min: number;
  max: number;
  remarks: string;
}

export const DEMO_GRADE_BANDS: DemoGradeBand[] = [
  { grade: 'A+', min: 90, max: 100, remarks: 'Outstanding' },
  { grade: 'A', min: 80, max: 89.99, remarks: 'Excellent' },
  { grade: 'B', min: 70, max: 79.99, remarks: 'Very good' },
  { grade: 'C', min: 60, max: 69.99, remarks: 'Good' },
  { grade: 'D', min: 40, max: 59.99, remarks: 'Satisfactory' },
  { grade: 'F', min: 0, max: 39.99, remarks: 'Needs improvement' },
];
