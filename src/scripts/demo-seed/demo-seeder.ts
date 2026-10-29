import {
  InstitutionStatus,
  ModuleKey,
  SubscriptionStatus,
  UserRole,
} from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../../modules/platform/platform.service';
import { seedActivity } from './demo-seeder-activity';
import {
  buildDemoPlan,
  DEFAULT_NAMESPACE,
  DEMO_SCHOOL_NAME,
  DemoAccessRole,
  DemoNamespace,
  DemoPlan,
} from './demo-data';
import {
  ClassRecord,
  DemoContext,
  StaffRecord,
  StudentRecord,
} from './demo-context';

export interface DemoSeedOptions {
  /** The one password every demo account signs in with. */
  passwordHash: string;
  /** The day the demo is built for; defaults to now. */
  today?: Date;
  /** Names that keep this demo apart from another; defaults suit the real demo. */
  namespace?: DemoNamespace;
}

export interface DemoSeedSummary {
  institutionId: string;
  slug: string;
  adminEmail: string;
  counts: Record<string, number>;
}

/** What each access role may do, by feature, using the catalog's keys. */
const ACCESS_ROLES: Record<
  DemoAccessRole,
  { description: string; permissions: Record<string, Record<string, boolean>> }
> = {
  Accountant: {
    description: 'Fees, vouchers and payments',
    permissions: {
      students: { read: true },
      guardians: { read: true },
      fee_structures: { read: true, create: true, update: true },
      fee_vouchers: { read: true, create: true, update: true },
      fee_payments: { read: true, create: true },
      student_discounts: { read: true, create: true, update: true },
      student_fines: { read: true, create: true, update: true },
    },
  },
  'Front Desk': {
    description: 'Admissions, contacts and daily attendance',
    permissions: {
      students: { read: true, create: true, update: true },
      guardians: { read: true, create: true, update: true },
      student_guardians: { read: true, create: true },
      contacts: { read: true, create: true, update: true },
      student_enrollments: { read: true, create: true },
      attendance: { read: true, create: true, update: true },
      notices: { read: true, create: true },
    },
  },
};

const DEMO_PLAN_KEY = 'growth';

const slugOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');

/**
 * Builds a complete demo school in an empty slot: the institution with every
 * module on, two campuses, classes, students and guardians, staff, and then a
 * month of attendance, three months of fees, an exam per class and payroll.
 * It only ever adds a new institution; it never changes or removes anything
 * that is already there.
 */
export class DemoSeeder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
  ) {}

  /**
   * @param {DemoSeedOptions} options - The shared password hash and the day to build for.
   * @returns {Promise<DemoSeedSummary>} Where the demo is and how much was created.
   * @throws {Error} If a demo school already exists.
   */
  async run(options: DemoSeedOptions): Promise<DemoSeedSummary> {
    const today = options.today ?? new Date();
    const namespace = options.namespace ?? DEFAULT_NAMESPACE;
    const existing = await this.prisma.institution.findFirst({
      where: { slug: namespace.slug },
      select: { id: true },
    });
    if (existing) {
      throw new Error(
        `A school with the slug "${namespace.slug}" already exists (${existing.id}). Nothing was changed. Remove it from the platform console first if you want a fresh demo.`,
      );
    }

    const plan = buildDemoPlan(namespace);
    const institutionId = await this.createInstitution(today, namespace);
    const admin = await this.createUser({
      institutionId,
      name: 'Demo Admin',
      email: `admin@${namespace.emailDomain}`,
      role: UserRole.ADMIN,
      passwordHash: options.passwordHash,
    });
    const year = await this.createAcademicYear(institutionId, today);
    const roles = await this.createAccessRoles(institutionId);

    const context: DemoContext = {
      prisma: this.prisma,
      namespace,
      institutionId,
      adminId: admin.id,
      academicYearId: year.id,
      today,
      passwordHash: options.passwordHash,
      classes: [],
      students: [],
      staff: [],
    };
    await this.createCampuses(context, plan, roles);
    await this.createFamilies(context, plan);
    await seedActivity(context);

    return {
      institutionId,
      slug: namespace.slug,
      adminEmail: admin.email,
      counts: {
        campuses: plan.campuses.length,
        classes: context.classes.length,
        students: context.students.length,
        guardians: plan.families.length,
        staff: context.staff.length,
      },
    };
  }

  private async createInstitution(
    today: Date,
    namespace: DemoNamespace,
  ): Promise<string> {
    // Two campuses need a plan that allows them, so the demo sits on Growth rather than the one-campus Starter.
    const growth = (await this.platform.listPlans()).data.find(
      (plan) => plan.key === DEMO_PLAN_KEY,
    );
    const created = await this.platform.createInstitution({
      name: DEMO_SCHOOL_NAME,
      planId: growth?.id,
      slug: namespace.slug,
      status: InstitutionStatus.ACTIVE,
      timezone: 'Asia/Karachi',
      defaultCountry: 'PK',
      contactEmail: `hello@${namespace.emailDomain}`,
      notes: 'Demo school with sample data, created by the demo seed.',
    });
    const institution = created.data;

    // A demo is shown to prospects, so it should not be in a trial that ends.
    const subscription = institution.subscriptions[0];
    if (subscription) {
      const oneYear = new Date(today);
      oneYear.setFullYear(oneYear.getFullYear() + 1);
      await this.prisma.institutionSubscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.ACTIVE, endsAt: oneYear },
      });
    }
    // Every module on, so the whole product can be shown.
    for (const moduleKey of Object.values(ModuleKey)) {
      await this.prisma.institutionEntitlement.upsert({
        where: {
          institutionId_moduleKey_activeScopeKey: {
            institutionId: institution.id,
            moduleKey,
            activeScopeKey: 'ACTIVE',
          },
        },
        update: { isEnabled: true },
        create: { institutionId: institution.id, moduleKey, isEnabled: true },
      });
    }
    await this.prisma.institutionSetting.create({
      data: {
        institutionId: institution.id,
        key: 'finance',
        value: { currencyLabel: 'PKR' },
      },
    });
    return institution.id;
  }

  private async createAcademicYear(institutionId: string, today: Date) {
    // The school year starts in April.
    const start =
      today.getUTCMonth() >= 3
        ? today.getUTCFullYear()
        : today.getUTCFullYear() - 1;
    const year = await this.prisma.academicYear.create({
      data: {
        institutionId,
        name: `${start}-${String(start + 1).slice(2)}`,
        startDate: new Date(`${start}-04-01T00:00:00.000Z`),
        endDate: new Date(`${start + 1}-03-31T00:00:00.000Z`),
      },
    });
    await this.prisma.institution.update({
      where: { id: institutionId },
      data: { currentAcademicYearId: year.id },
    });
    return year;
  }

  private async createAccessRoles(institutionId: string) {
    const ids = new Map<DemoAccessRole, string>();
    for (const [name, role] of Object.entries(ACCESS_ROLES)) {
      const created = await this.prisma.role.create({
        data: {
          institutionId,
          name,
          description: role.description,
          permissions: role.permissions,
        },
      });
      ids.set(name as DemoAccessRole, created.id);
    }
    return ids;
  }

  private createUser(data: {
    institutionId: string;
    name: string;
    email: string;
    role: UserRole;
    passwordHash: string;
    identifier?: string;
    roleId?: string;
  }) {
    return this.prisma.user.create({
      data: { ...data, mustChangePassword: false },
    });
  }

  private async createCampuses(
    context: DemoContext,
    plan: DemoPlan,
    roles: Map<DemoAccessRole, string>,
  ) {
    for (const campusPlan of plan.campuses) {
      const campus = await this.prisma.campus.create({
        data: {
          institutionId: context.institutionId,
          name: campusPlan.name,
          location: campusPlan.location,
          studentStartTime: '08:00',
          studentEndTime: '14:00',
          staffStartTime: '07:45',
          staffEndTime: '14:30',
          lateThreshold: 10,
          earlyLeaveThreshold: 10,
        },
      });
      const level = await this.prisma.level.create({
        data: { name: 'Primary', campusId: campus.id },
      });

      for (const classPlan of campusPlan.classes) {
        const academicClass = await this.prisma.academicClass.create({
          data: { name: classPlan.name, levelId: level.id },
        });
        const subjectIds = new Map<string, string>();
        for (const subject of plan.subjects) {
          const created = await this.prisma.subject.create({
            data: { name: subject, classId: academicClass.id },
          });
          subjectIds.set(subject, created.id);
        }
        const feeStructure = await this.prisma.feeStructure.create({
          data: {
            classId: academicClass.id,
            campusId: campus.id,
            feeBreakdown: { tuition: classPlan.tuition },
          },
        });
        const record: ClassRecord = {
          campusId: campus.id,
          classId: academicClass.id,
          className: classPlan.name,
          campusName: campusPlan.name,
          tuition: classPlan.tuition,
          feeStructureId: feeStructure.id,
          subjectIds,
          sectionIds: [],
        };
        context.classes.push(record);

        for (const sectionPlan of classPlan.sections) {
          const section = await this.prisma.section.create({
            data: { name: sectionPlan.name, classId: academicClass.id },
          });
          record.sectionIds.push(section.id);
          for (const student of sectionPlan.students) {
            context.students.push(
              await this.createStudent(context, {
                student,
                campusId: campus.id,
                classId: academicClass.id,
                sectionId: section.id,
                tuition: classPlan.tuition,
                classRecord: record,
              }),
            );
          }
        }
      }

      for (const staffPlan of campusPlan.staff) {
        context.staff.push(
          await this.createStaff(
            context,
            campus.id,
            staffPlan,
            context.staff.length,
            staffPlan.accessRole ? roles.get(staffPlan.accessRole) : undefined,
          ),
        );
      }
    }
  }

  private async createStudent(
    context: DemoContext,
    input: {
      student: DemoPlan['campuses'][number]['classes'][number]['sections'][number]['students'][number];
      campusId: string;
      classId: string;
      sectionId: string;
      tuition: number;
      classRecord: ClassRecord;
    },
  ): Promise<StudentRecord> {
    const { student } = input;
    const user = await this.createUser({
      institutionId: context.institutionId,
      name: student.name,
      email: `${student.regNo.toLowerCase()}@${context.namespace.emailDomain}`,
      role: UserRole.STUDENT,
      passwordHash: context.passwordHash,
      identifier: student.regNo,
    });
    const record = await this.prisma.student.create({
      data: {
        userId: user.id,
        institutionId: context.institutionId,
        regNo: student.regNo,
        dob: new Date(
          `${2016 - (input.classRecord.className === 'Grade 5' ? 1 : 0)}-0${(student.index % 9) + 1}-15T00:00:00.000Z`,
        ),
        gender: student.gender,
        campusId: input.campusId,
        admissionDate: new Date('2025-04-01T00:00:00.000Z'),
      },
    });
    await this.prisma.studentEnrollment.create({
      data: {
        studentId: record.id,
        academicYearId: context.academicYearId,
        campusId: input.campusId,
        classId: input.classId,
        sectionId: input.sectionId,
      },
    });
    return {
      studentId: record.id,
      userId: user.id,
      regNo: student.regNo,
      index: student.index,
      campusId: input.campusId,
      classId: input.classId,
      sectionId: input.sectionId,
      tuition: input.tuition,
      feeStructureId: input.classRecord.feeStructureId,
      isSecondSibling: false,
    };
  }

  private async createStaff(
    context: DemoContext,
    campusId: string,
    staffPlan: DemoPlan['campuses'][number]['staff'][number],
    index: number,
    roleId?: string,
  ): Promise<StaffRecord> {
    const user = await this.createUser({
      institutionId: context.institutionId,
      name: staffPlan.name,
      email: `${slugOf(staffPlan.name)}@${context.namespace.emailDomain}`,
      role: UserRole.STAFF,
      passwordHash: context.passwordHash,
      ...(roleId && { roleId }),
    });
    await this.prisma.staffProfile.create({
      data: {
        userId: user.id,
        employmentType: staffPlan.teaching ? 'TEACHING' : 'NON_TEACHING',
        designation: staffPlan.designation,
        gender: staffPlan.gender,
        campusId,
        joiningDate: new Date('2025-04-01T00:00:00.000Z'),
      },
    });
    await this.prisma.userCampus.create({
      data: { userId: user.id, campusId },
    });
    return {
      userId: user.id,
      campusId,
      index,
      baseSalary: staffPlan.baseSalary,
      name: staffPlan.name,
    };
  }

  private async createFamilies(context: DemoContext, plan: DemoPlan) {
    const byRegNo = new Map(
      context.students.map((student) => [student.regNo, student]),
    );
    for (const [position, family] of plan.families.entries()) {
      const children = family.studentRegNos
        .map((regNo) => byRegNo.get(regNo))
        .filter((child): child is StudentRecord => child !== undefined);
      if (children.length === 0) continue;
      const user = await this.createUser({
        institutionId: context.institutionId,
        name: family.guardianName,
        email: `guardian.${String(position + 1).padStart(3, '0')}@${context.namespace.emailDomain}`,
        role: UserRole.GUARDIAN,
        passwordHash: context.passwordHash,
        identifier: family.phone,
      });
      const guardian = await this.prisma.guardian.create({
        data: {
          userId: user.id,
          relation: family.relation,
          campusId: children[0].campusId,
        },
      });
      await this.prisma.contact.create({
        data: {
          guardianId: guardian.id,
          personType: 'GUARDIAN',
          phone1: family.phone,
          phone1Country: 'PK',
        },
      });
      for (const child of children) {
        await this.prisma.studentGuardian.create({
          data: { studentId: child.studentId, guardianId: guardian.id },
        });
      }
      // The second child of a family gets the usual sibling discount on fees.
      if (children[1]) children[1].isSecondSibling = true;
    }
  }
}
