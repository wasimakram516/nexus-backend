import { PrismaService } from '../../prisma/prisma.service';
import { DemoNamespace } from './demo-data';

/** One class at one campus, with what the later steps need to find it. */
export interface ClassRecord {
  campusId: string;
  campusName: string;
  classId: string;
  className: string;
  tuition: number;
  feeStructureId: string;
  /** Subject id by subject name. */
  subjectIds: Map<string, string>;
  sectionIds: string[];
}

export interface StudentRecord {
  studentId: string;
  userId: string;
  regNo: string;
  /** Position across the whole school, as in the plan. */
  index: number;
  campusId: string;
  classId: string;
  sectionId: string;
  tuition: number;
  feeStructureId: string;
  /** Second child of a family, who gets the sibling discount. */
  isSecondSibling: boolean;
}

export interface StaffRecord {
  userId: string;
  campusId: string;
  index: number;
  baseSalary: number;
  name: string;
}

/** What the seeding steps share as the demo school is built. */
export interface DemoContext {
  prisma: PrismaService;
  namespace: DemoNamespace;
  institutionId: string;
  adminId: string;
  academicYearId: string;
  today: Date;
  passwordHash: string;
  classes: ClassRecord[];
  students: StudentRecord[];
  staff: StaffRecord[];
}
