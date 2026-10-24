import { randomUUID } from 'node:crypto';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { FeeReportsService } from '../src/modules/finance/fee-reports.service';
import { UserRole } from '../src/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-database proof for the fee ledger and the defaulters list: payments
 * reduce what is owed, only unpaid vouchers past their due date count, and a
 * student in another campus never appears. Run via `npm run test:postgres`;
 * see test/POSTGRES-TESTS.md.
 */
describe('PostgreSQL fee ledger and defaulters', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let service: FeeReportsService;
  let institutionId: string;
  let campusId: string;
  let otherCampusId: string;
  let classId: string;
  let structureId: string;
  let ayeshaId: string;
  let bilalId: string;
  let outsiderId: string;

  const superadmin: CurrentUser = {
    sub: randomUUID(),
    email: 'super@nexus.test',
    role: UserRole.SUPERADMIN,
    institutionId: null,
  };

  const newStudent = async (name: string, regNo: string, forCampus: string) => {
    const user = await prisma.user.create({
      data: {
        institutionId,
        name,
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'STUDENT',
      },
    });
    const student = await prisma.student.create({
      data: {
        userId: user.id,
        institutionId,
        regNo,
        dob: new Date('2012-01-01'),
        gender: 'FEMALE',
        campusId: forCampus,
        admissionDate: new Date('2026-04-01'),
      },
    });
    return student.id;
  };

  const voucher = (
    studentId: string,
    month: number,
    due: string,
    amount = 5000,
  ) =>
    prisma.feeVoucher.create({
      data: {
        studentId,
        feeStructureId: structureId,
        month,
        year: 2026,
        feeBreakdown: { tuition: amount },
        finalAmountDue: amount,
        dueDate: new Date(due),
      },
    });

  const pay = (voucherId: string, month: number, amount: number) =>
    prisma.feePayment.create({
      data: {
        voucherId,
        month,
        year: 2026,
        paidAmount: amount,
        paymentMethod: 'CASH',
        paymentDate: new Date('2026-09-20'),
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
    service = new FeeReportsService(
      prisma,
      new ModuleAccessService(prisma),
      new CampusAccessService(prisma),
    );

    institutionId = (
      await prisma.institution.create({
        data: { name: 'Fee reports test', slug: randomUUID() },
      })
    ).id;
    await prisma.user.create({
      data: {
        id: superadmin.sub,
        name: 'Fee reports superadmin',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'SUPERADMIN',
      },
    });
    const campusData = {
      institutionId,
      location: 'Test',
      studentStartTime: '08:00',
      studentEndTime: '14:00',
      staffStartTime: '08:00',
      staffEndTime: '14:00',
      lateThreshold: 10,
      earlyLeaveThreshold: 10,
    };
    campusId = (
      await prisma.campus.create({ data: { ...campusData, name: 'Reports' } })
    ).id;
    otherCampusId = (
      await prisma.campus.create({ data: { ...campusData, name: 'Other' } })
    ).id;
    const level = await prisma.level.create({
      data: { name: 'Reports level', campusId },
    });
    classId = (
      await prisma.academicClass.create({
        data: { name: 'Reports class', levelId: level.id },
      })
    ).id;
    structureId = (
      await prisma.feeStructure.create({
        data: { classId, campusId, feeBreakdown: { tuition: 5000 } },
      })
    ).id;

    ayeshaId = await newStudent('Ayesha', 'L-1', campusId);
    bilalId = await newStudent('Bilal', 'L-2', campusId);
    outsiderId = await newStudent('Outsider', 'L-3', otherCampusId);

    // Ayesha: August paid in full, September part paid, far-future month not yet due.
    const august = await voucher(ayeshaId, 8, '2026-08-10');
    await pay(august.id, 8, 5000);
    const september = await voucher(ayeshaId, 9, '2026-09-10');
    await pay(september.id, 9, 2000);
    await voucher(ayeshaId, 12, '2099-12-10');
    // Bilal: two months unpaid, the larger debt.
    await voucher(bilalId, 8, '2026-08-10', 6000);
    await voucher(bilalId, 9, '2026-09-10', 6000);
    // Someone at another campus owes too, but must not be listed.
    await voucher(outsiderId, 9, '2026-09-10');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("builds a student's ledger with payments and a running balance", async () => {
    const { data } = await service.getStudentLedger(superadmin, ayeshaId);

    expect(data.entries.map((entry) => entry.month)).toEqual([8, 9, 12]);
    expect(data.entries.map((entry) => entry.status)).toEqual([
      'PAID',
      'OVERDUE',
      'PENDING',
    ]);
    expect(data.entries.map((entry) => entry.runningBalance)).toEqual([
      '0.00',
      '3000.00',
      '8000.00',
    ]);
    expect(data.entries[1].payments).toHaveLength(1);
    expect(data.totals).toEqual({
      charged: '15000.00',
      paid: '7000.00',
      outstanding: '8000.00',
      overdue: '3000.00',
    });
  });

  it('lists only students who owe past a due date, largest debt first', async () => {
    const { data } = await service.getDefaulters(superadmin, { campusId });

    expect(data.defaulters.map((row) => row.name)).toEqual(['Bilal', 'Ayesha']);
    expect(data.defaulters[0]).toMatchObject({
      monthsOutstanding: 2,
      totalOutstanding: '12000.00',
    });
    // Ayesha's paid August and not-yet-due December are not counted.
    expect(data.defaulters[1]).toMatchObject({
      monthsOutstanding: 1,
      totalOutstanding: '3000.00',
    });
    expect(data.totals).toEqual({ students: 2, outstanding: '15000.00' });
  });

  it('keeps students from another campus out of the list', async () => {
    const { data } = await service.getDefaulters(superadmin, { campusId });

    expect(data.defaulters.map((row) => row.studentId)).not.toContain(
      outsiderId,
    );
  });

  it('filters by the minimum number of overdue months', async () => {
    const { data } = await service.getDefaulters(superadmin, {
      campusId,
      minMonths: 2,
    });

    expect(data.defaulters.map((row) => row.name)).toEqual(['Bilal']);
  });

  it('drops a student from the list once they pay in full', async () => {
    const owed = await prisma.feeVoucher.findFirstOrThrow({
      where: { studentId: ayeshaId, month: 9 },
    });
    await pay(owed.id, 9, 3000);

    const { data } = await service.getDefaulters(superadmin, { campusId });

    expect(data.defaulters.map((row) => row.name)).toEqual(['Bilal']);
  });
});
