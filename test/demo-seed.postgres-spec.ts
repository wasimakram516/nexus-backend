import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { OwnedStudentsService } from '../src/common/services/owned-students.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { TimezoneResolverService } from '../src/common/services/timezone-resolver.service';
import { UserPermissionsService } from '../src/common/services/user-permissions.service';
import { ExamResultsViewService } from '../src/modules/examinations/exam-results-view.service';
import { PlatformService } from '../src/modules/platform/platform.service';
import { AttendanceReportsService } from '../src/modules/reports/attendance-reports.service';
import { CampusComparisonService } from '../src/modules/reports/campus-comparison.service';
import { ExamReportsService } from '../src/modules/reports/exam-reports.service';
import { FinanceReportsService } from '../src/modules/reports/finance-reports.service';
import { PayrollReportsService } from '../src/modules/reports/payroll-reports.service';
import { ReportsAccessService } from '../src/modules/reports/reports-access.service';
import {
  buildDemoPlan,
  DemoNamespace,
} from '../src/scripts/demo-seed/demo-data';
import { DemoSeeder } from '../src/scripts/demo-seed/demo-seeder';
import { UserRole } from '../src/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-database proof that the demo seed builds a school that actually works:
 * it is seeded into an isolated database under names of its own, and then read
 * back through the same report services the product uses. Run via
 * `npm run test:postgres`.
 */
describe('PostgreSQL demo seed', () => {
  const context = new RequestContextService();
  const today = new Date('2026-10-28T09:00:00.000Z');
  const tag = randomUUID().slice(0, 8);
  const namespace: DemoNamespace = {
    slug: `demo-${tag}`,
    emailDomain: `${tag}.test`,
    regPrefix: `D${tag.toUpperCase()}-`,
    // Far from any other test's numbers; 7 digits wide.
    phoneBase: 1_000_000 + (parseInt(tag.slice(0, 5), 16) % 7_000_000),
  };
  const plan = buildDemoPlan(namespace);

  let prisma: PrismaService;
  let seeder: DemoSeeder;
  let institutionId: string;
  let admin: CurrentUser;
  let comparison: CampusComparisonService;
  let attendance: AttendanceReportsService;
  let finance: FinanceReportsService;
  let exams: ExamReportsService;
  let payroll: PayrollReportsService;

  beforeAll(async () => {
    const connection = process.env.TEST_DATABASE_URL;
    if (!connection) throw new Error('TEST_DATABASE_URL is required');
    const url = new URL(connection);
    if (
      url.hostname !== '127.0.0.1' ||
      !/^\/nexus_audit_test(?:_[a-z0-9]+)?$/.test(url.pathname)
    )
      throw new Error('Use an isolated loopback nexus_audit_test database');
    process.env.DATABASE_URL = connection;
    prisma = new PrismaService(context);

    const allowModule = {
      assertModuleEnabledForUser: () => Promise.resolve(),
    } as unknown as ModuleAccessService;
    const timezones = new TimezoneResolverService(prisma);
    const platform = new PlatformService(
      prisma,
      allowModule,
      context,
      { get: () => undefined } as unknown as ConfigService,
      timezones,
    );
    seeder = new DemoSeeder(prisma, platform);

    const summary = await seeder.run({
      passwordHash: 'not-a-real-hash-for-tests',
      today,
      namespace,
    });
    institutionId = summary.institutionId;
    admin = {
      sub: randomUUID(),
      email: summary.adminEmail,
      role: UserRole.ADMIN,
      institutionId,
    };

    const campusAccess = new CampusAccessService(prisma);
    const access = new ReportsAccessService(prisma, allowModule, campusAccess);
    comparison = new CampusComparisonService(prisma, access, timezones);
    attendance = new AttendanceReportsService(prisma, access, timezones);
    finance = new FinanceReportsService(prisma, access, timezones);
    payroll = new PayrollReportsService(prisma, access, timezones);
    exams = new ExamReportsService(
      prisma,
      access,
      new ExamResultsViewService(
        prisma,
        allowModule,
        campusAccess,
        new UserPermissionsService(prisma),
        new OwnedStudentsService(prisma),
      ),
    );
  }, 180_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an active school with every module on, a current year and a grading scale', async () => {
    const institution = await prisma.institution.findUniqueOrThrow({
      where: { id: institutionId },
      include: {
        subscriptions: true,
        entitlements: true,
        currentAcademicYear: true,
      },
    });

    expect(institution.status).toBe('ACTIVE');
    expect(institution.subscriptions[0].status).toBe('ACTIVE');
    expect(institution.entitlements.every((item) => item.isEnabled)).toBe(true);
    expect(institution.entitlements).toHaveLength(10);
    expect(institution.currentAcademicYear?.name).toBe('2026-27');
    expect(institution.currentGradingScaleId).not.toBeNull();
  });

  it('creates the people with the sign-ins the demo tells you to use', async () => {
    const students = await prisma.student.findMany({
      where: { institutionId },
    });
    expect(students).toHaveLength(24);

    const guardian = await prisma.user.findFirst({
      where: { identifier: plan.families[0].phone },
      include: { guardian: { include: { students: true } } },
    });
    expect(guardian?.role).toBe('GUARDIAN');
    expect(guardian?.guardian?.students.length).toBeGreaterThan(0);

    const student = await prisma.user.findFirst({
      where: { identifier: `${namespace.regPrefix}0001` },
    });
    expect(student?.role).toBe('STUDENT');

    const accountant = await prisma.user.findFirst({
      where: { institutionId, email: `nadia.hussain@${namespace.emailDomain}` },
      include: { assignedRole: true },
    });
    expect(accountant?.assignedRole?.name).toBe('Accountant');
  });

  it('shows both campuses side by side in the comparison', async () => {
    const table = await comparison.build(admin, { date: '2026-10-28' });

    expect(table.rows.map((row) => [row.campus, row.students])).toEqual([
      ['Main Campus', 18],
      ['North Campus', 6],
    ]);
    expect(table.totals).toMatchObject({ students: 24 });
    expect(Number(table.totals?.attendance)).toBeGreaterThan(80);
  });

  it('has a student who is absent often enough to be reported, and fees in every month', async () => {
    const absentees = await attendance.chronicAbsentees(admin, {
      from: '2026-10-01',
      to: '2026-10-28',
    });
    expect(absentees.rows.length).toBeGreaterThan(0);

    const collection = await finance.collection(admin, {
      from: '2026-08-01',
      to: '2026-10-28',
      groupBy: 'MONTH',
    });
    expect(collection.rows.map((row) => row.group)).toEqual([
      'Aug 2026',
      'Sep 2026',
      'Oct 2026',
    ]);
    expect(Number(collection.totals?.total)).toBeGreaterThan(0);

    const dues = await finance.outstandingDues(admin, {});
    expect(dues.rows.length).toBeGreaterThan(0);

    const adjustments = await finance.adjustments(admin, {
      from: '2026-08-01',
      to: '2026-10-31',
    });
    expect(Number(adjustments.totals?.discounts)).toBeGreaterThan(0);
  });

  it('has a published exam for every class, with passes and failures to report', async () => {
    const options = await exams.options(admin, {});
    expect(options).toHaveLength(3);

    const failed = await Promise.all(
      options.map((exam) => exams.failedStudents(admin, { examId: exam.id })),
    );
    expect(failed.some((table) => table.rows.length > 0)).toBe(true);

    const grades = await exams.gradeDistribution(admin, {
      examId: options[0].id,
    });
    expect(grades.rows.map((row) => row.grade)).toEqual([
      'A+',
      'A',
      'B',
      'C',
      'D',
      'F',
      'Not graded',
    ]);
  });

  it('has paid the last two months of payroll and none yet for this month', async () => {
    const lastMonth = await payroll.register(admin, { month: '2026-09' });
    expect(lastMonth.rows).toHaveLength(6);
    expect(lastMonth.rows.every((row) => row.status === 'Paid')).toBe(true);
    expect(lastMonth.totals).toMatchObject({
      base: '327000.00',
      bonuses: '6000.00',
      manualDeductions: '1500.00',
      net: '331500.00',
    });

    const thisMonth = await payroll.register(admin, { month: '2026-10' });
    expect(thisMonth.rows.every((row) => row.status === 'Not paid')).toBe(true);
  });

  it('refuses to run again for the same school and leaves the first one untouched', async () => {
    const before = await prisma.student.count({ where: { institutionId } });

    await expect(
      seeder.run({ passwordHash: 'x', today, namespace }),
    ).rejects.toThrow('already exists');

    await expect(
      prisma.student.count({ where: { institutionId } }),
    ).resolves.toBe(before);
  });
});
