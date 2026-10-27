import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { TimezoneResolverService } from '../src/common/services/timezone-resolver.service';
import { AttendanceReportsService } from '../src/modules/reports/attendance-reports.service';
import { CampusComparisonService } from '../src/modules/reports/campus-comparison.service';
import { FinanceReportsService } from '../src/modules/reports/finance-reports.service';
import { ReportsAccessService } from '../src/modules/reports/reports-access.service';
import { AttendanceStatus, UserRole } from '../src/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-database proof for the reports: the aggregate queries, grouping and
 * campus scoping run against PostgreSQL and give the figures worked out by hand
 * below. Run via `npm run test:postgres`.
 *
 * Campus Main has three students (Ayesha, Bilal, Cyrus); campus North has one
 * (Dina). Money is in whole rupees so every total can be checked by eye.
 */
describe('PostgreSQL reports', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let comparison: CampusComparisonService;
  let attendance: AttendanceReportsService;
  let finance: FinanceReportsService;
  let institutionId: string;
  let mainId: string;
  let northId: string;
  let sectionId: string;
  let admin: CurrentUser;

  const date = (day: string) => new Date(`${day}T00:00:00.000Z`);

  const newUser = (name: string, role: UserRole, inst = institutionId) =>
    prisma.user.create({
      data: {
        institutionId: inst,
        name,
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role,
      },
    });

  const newCampus = async (name: string, inst = institutionId) =>
    (
      await prisma.campus.create({
        data: {
          institutionId: inst,
          name,
          location: 'Test',
          studentStartTime: '08:00',
          studentEndTime: '14:00',
          staffStartTime: '08:00',
          staffEndTime: '14:00',
          lateThreshold: 10,
          earlyLeaveThreshold: 10,
        },
      })
    ).id;

  const newStudent = async (name: string, regNo: string, campusId: string) => {
    const user = await newUser(name, UserRole.STUDENT);
    const student = await prisma.student.create({
      data: {
        userId: user.id,
        institutionId,
        regNo,
        dob: new Date('2012-01-01'),
        gender: 'FEMALE',
        campusId,
        admissionDate: new Date('2026-04-01'),
      },
    });
    return { userId: user.id, studentId: student.id };
  };

  const mark = (
    userId: string,
    campusId: string,
    day: string,
    status: AttendanceStatus,
    extra: { role?: UserRole; halfDay?: boolean } = {},
  ) =>
    prisma.attendance.create({
      data: {
        userId,
        campusId,
        role: extra.role ?? UserRole.STUDENT,
        date: date(day),
        status,
        halfDay: extra.halfDay ?? false,
      },
    });

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

    // Module entitlement is not what these tests prove, so that one check is skipped.
    const allowModule = {
      assertModuleEnabledForUser: () => Promise.resolve(),
    } as unknown as ModuleAccessService;
    const access = new ReportsAccessService(
      prisma,
      allowModule,
      new CampusAccessService(prisma),
    );
    const timezones = new TimezoneResolverService(prisma);
    comparison = new CampusComparisonService(prisma, access, timezones);
    attendance = new AttendanceReportsService(prisma, access, timezones);
    finance = new FinanceReportsService(prisma, access, timezones);

    institutionId = (
      await prisma.institution.create({
        data: { name: 'Reports test', slug: randomUUID() },
      })
    ).id;
    const year = await prisma.academicYear.create({
      data: {
        institutionId,
        name: '2026-27',
        startDate: date('2026-04-01'),
        endDate: date('2027-03-31'),
      },
    });
    await prisma.institution.update({
      where: { id: institutionId },
      data: { currentAcademicYearId: year.id },
    });
    await prisma.institutionSetting.create({
      data: { institutionId, key: 'finance', value: { currencyLabel: 'PKR' } },
    });
    admin = {
      sub: randomUUID(),
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
      institutionId,
    };

    mainId = await newCampus('Main');
    northId = await newCampus('North');
    const mainLevel = await prisma.level.create({
      data: { name: 'Main level', campusId: mainId },
    });
    const northLevel = await prisma.level.create({
      data: { name: 'North level', campusId: northId },
    });
    const mainClass = await prisma.academicClass.create({
      data: { name: 'Grade 5', levelId: mainLevel.id },
    });
    const northClass = await prisma.academicClass.create({
      data: { name: 'Grade 6', levelId: northLevel.id },
    });
    sectionId = (
      await prisma.section.create({
        data: { name: 'A', classId: mainClass.id },
      })
    ).id;
    const northSection = await prisma.section.create({
      data: { name: 'B', classId: northClass.id },
    });
    const mainStructure = await prisma.feeStructure.create({
      data: {
        classId: mainClass.id,
        campusId: mainId,
        feeBreakdown: { tuition: 1000 },
      },
    });
    const northStructure = await prisma.feeStructure.create({
      data: {
        classId: northClass.id,
        campusId: northId,
        feeBreakdown: { tuition: 800 },
      },
    });

    const ayesha = await newStudent('Ayesha', 'R-1', mainId);
    const bilal = await newStudent('Bilal', 'R-2', mainId);
    const cyrus = await newStudent('Cyrus', 'R-3', mainId);
    const dina = await newStudent('Dina', 'R-4', northId);
    for (const [student, campusId, classId, section] of [
      [ayesha, mainId, mainClass.id, sectionId],
      [bilal, mainId, mainClass.id, sectionId],
      [cyrus, mainId, mainClass.id, sectionId],
      [dina, northId, northClass.id, northSection.id],
    ] as const) {
      await prisma.studentEnrollment.create({
        data: {
          studentId: student.studentId,
          academicYearId: year.id,
          campusId,
          classId,
          sectionId: section,
        },
      });
    }

    // Attendance: days 1 to 6 of October, and the 25th.
    const week = (userId: string, campusId: string, codes: string) =>
      Promise.all(
        [...codes].map((code, index) =>
          mark(
            userId,
            campusId,
            `2026-10-0${index + 1}`,
            { P: 'PRESENT', A: 'ABSENT', L: 'LATE' }[code] as AttendanceStatus,
          ),
        ),
      );
    await week(ayesha.userId, mainId, 'PPPPPA');
    await week(bilal.userId, mainId, 'PPLPPP');
    await week(cyrus.userId, mainId, 'AAAAPP');
    await mark(ayesha.userId, mainId, '2026-10-25', 'PRESENT');
    await mark(bilal.userId, mainId, '2026-10-25', 'LATE');
    await mark(cyrus.userId, mainId, '2026-10-25', 'ABSENT');
    await mark(dina.userId, northId, '2026-10-25', 'PRESENT');

    // Staff attendance at Main.
    const teacher = await newUser('Teacher One', UserRole.STAFF);
    await mark(teacher.id, mainId, '2026-10-01', 'PRESENT', {
      role: UserRole.STAFF,
    });
    await mark(teacher.id, mainId, '2026-10-02', 'ABSENT', {
      role: UserRole.STAFF,
    });
    await mark(teacher.id, mainId, '2026-10-03', 'LATE', {
      role: UserRole.STAFF,
      halfDay: true,
    });

    // Fees.
    const voucher = (
      studentId: string,
      feeStructureId: string,
      month: number,
      yearNumber: number,
      amount: number,
      dueDate: string,
      status: 'PENDING' | 'PAID' | 'OVERDUE',
      extra: { discount?: number; fine?: number; late?: number } = {},
    ) =>
      prisma.feeVoucher.create({
        data: {
          studentId,
          feeStructureId,
          month,
          year: yearNumber,
          feeBreakdown: { tuition: amount },
          finalAmountDue: amount,
          discountAmount: extra.discount ?? 0,
          fineAmount: extra.fine ?? 0,
          lateFeeFine: extra.late ?? 0,
          dueDate: date(dueDate),
          status,
        },
      });
    const pay = (
      voucherId: string,
      amount: number,
      paymentDate: string,
      method: 'CASH' | 'BANK_TRANSFER',
    ) =>
      prisma.feePayment.create({
        data: {
          voucherId,
          month: 10,
          year: 2026,
          paidAmount: amount,
          paymentMethod: method,
          paymentDate: new Date(paymentDate),
        },
      });

    const ayeshaOct = await voucher(
      ayesha.studentId,
      mainStructure.id,
      10,
      2026,
      1000,
      '2026-10-10',
      'OVERDUE',
      { discount: 100 },
    );
    await voucher(
      bilal.studentId,
      mainStructure.id,
      9,
      2026,
      2000,
      '2026-09-10',
      'OVERDUE',
    );
    const cyrusOct = await voucher(
      cyrus.studentId,
      mainStructure.id,
      10,
      2026,
      500,
      '2026-10-10',
      'PAID',
      { fine: 30 },
    );
    // Not due for decades, so it is never a default however late the tests run.
    await voucher(
      dina.studentId,
      northStructure.id,
      10,
      2026,
      800,
      '2099-01-10',
      'PENDING',
    );
    // 10:00 in Karachi on the 12th and on the 20th.
    await pay(ayeshaOct.id, 600, '2026-10-12T05:00:00.000Z', 'CASH');
    await pay(cyrusOct.id, 500, '2026-10-20T05:00:00.000Z', 'BANK_TRANSFER');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('compares the campuses side by side with a total', async () => {
    const table = await comparison.build(admin, { date: '2026-10-25' });

    expect(table.rows).toEqual([
      {
        campus: 'Main',
        students: 3,
        present: 2,
        absent: 1,
        leave: 0,
        attendance: 66.7,
        billed: '1500.00',
        collected: '1100.00',
        collection: 73.3,
        outstanding: '2400.00',
        defaulters: 2,
      },
      {
        campus: 'North',
        students: 1,
        present: 1,
        absent: 0,
        leave: 0,
        attendance: 100,
        billed: '800.00',
        collected: '0.00',
        collection: 0,
        outstanding: '800.00',
        defaulters: 0,
      },
    ]);
    expect(table.totals).toMatchObject({
      campus: 'All campuses',
      students: 4,
      present: 3,
      absent: 1,
      attendance: 75,
      billed: '2300.00',
      collected: '1100.00',
      outstanding: '3200.00',
      defaulters: 2,
    });
  });

  it("builds a section's register with a letter for each marked day", async () => {
    const table = await attendance.monthlyRegister(admin, {
      sectionId,
      month: '2026-10',
    });

    expect(table.rows.map((row) => row.name)).toEqual([
      'Ayesha',
      'Bilal',
      'Cyrus',
    ]);
    expect(table.rows[0]).toMatchObject({
      d1: 'P',
      d6: 'A',
      d7: '',
      d25: 'P',
      present: 6,
      absent: 1,
    });
    expect(table.rows[2]).toMatchObject({ d1: 'A', d5: 'P', absent: 5 });
  });

  it('summarises staff attendance with half days', async () => {
    const table = await attendance.staffSummary(admin, {
      from: '2026-10-01',
      to: '2026-10-31',
    });

    expect(table.rows).toEqual([
      {
        name: 'Teacher One',
        role: 'Staff',
        campus: 'Main',
        present: 2,
        late: 1,
        absent: 1,
        leave: 0,
        halfDays: 1,
        attendance: 66.7,
      },
    ]);
  });

  it('finds the student who is absent too often, and nobody else', async () => {
    const table = await attendance.chronicAbsentees(admin, {
      from: '2026-10-01',
      to: '2026-10-31',
    });

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({
      name: 'Cyrus',
      className: 'Grade 5',
      sectionName: 'A',
      campus: 'Main',
      marked: 7,
      absent: 5,
      absentPercent: 71.4,
    });
  });

  it('adds up fees received per day, per month and per campus', async () => {
    const byDay = await finance.collection(admin, {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(byDay.rows).toEqual([
      {
        group: '12 Oct 2026',
        payments: 1,
        cash: '600.00',
        bank: '0.00',
        total: '600.00',
      },
      {
        group: '20 Oct 2026',
        payments: 1,
        cash: '0.00',
        bank: '500.00',
        total: '500.00',
      },
    ]);
    expect(byDay.totals?.total).toBe('1100.00');

    const byMonth = await finance.collection(admin, {
      from: '2026-09-01',
      to: '2026-10-31',
      groupBy: 'MONTH',
    });
    expect(byMonth.rows.map((row) => [row.group, row.total])).toEqual([
      ['Oct 2026', '1100.00'],
    ]);

    const byCampus = await finance.collection(admin, {
      from: '2026-10-01',
      to: '2026-10-31',
      groupBy: 'CAMPUS',
    });
    expect(byCampus.rows.map((row) => [row.group, row.total])).toEqual([
      ['Main', '1100.00'],
    ]);
  });

  it('lists who owes past due dates, after payments, largest first', async () => {
    const table = await finance.outstandingDues(admin, {});

    expect(
      table.rows.map((row) => [row.name, row.months, row.outstanding]),
    ).toEqual([
      ['Bilal', 1, '2000.00'],
      ['Ayesha', 1, '400.00'],
    ]);
    expect(table.rows[1]).toMatchObject({
      className: 'Grade 5',
      sectionName: 'A',
      campus: 'Main',
    });
    expect(table.totals).toEqual({
      name: 'Total, 2 students',
      outstanding: '2400.00',
    });
  });

  it('adds up discounts, attendance fines and late fees by month and campus', async () => {
    const table = await finance.adjustments(admin, {
      from: '2026-10-01',
      to: '2026-10-31',
    });

    expect(table.rows).toEqual([
      {
        month: 'Oct 2026',
        campus: 'Main',
        vouchers: 2,
        billed: '1500.00',
        discounts: '100.00',
        fines: '30.00',
        lateFees: '0.00',
      },
      {
        month: 'Oct 2026',
        campus: 'North',
        vouchers: 1,
        billed: '800.00',
        discounts: '0.00',
        fines: '0.00',
        lateFees: '0.00',
      },
    ]);
  });

  it('narrows to one campus, and keeps every report inside the administrator’s own institution', async () => {
    const north = await finance.collection(admin, {
      campusId: northId,
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(north.rows).toEqual([]);
    expect(north.campusId).toBe(northId);

    const otherInstitution = (
      await prisma.institution.create({
        data: { name: 'Another school', slug: randomUUID() },
      })
    ).id;
    await newCampus('Elsewhere', otherInstitution);
    const outsider: CurrentUser = {
      sub: randomUUID(),
      email: 'other@nexus.test',
      role: UserRole.ADMIN,
      institutionId: otherInstitution,
    };
    await expect(
      comparison
        .build(outsider, { date: '2026-10-25' })
        .then((t) => t.rows.map((row) => row.campus)),
    ).resolves.toEqual(['Elsewhere']);
    await expect(
      finance.collection(outsider, { campusId: mainId }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      attendance.monthlyRegister(outsider, { sectionId, month: '2026-10' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses everyone who is not an administrator', async () => {
    const teacher: CurrentUser = {
      sub: randomUUID(),
      email: 't@nexus.test',
      role: UserRole.STAFF,
      institutionId,
    };

    await expect(
      comparison.build(teacher, { date: '2026-10-25' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
