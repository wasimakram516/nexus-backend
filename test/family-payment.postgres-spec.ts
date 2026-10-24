import { randomUUID } from 'node:crypto';
import { AuditLogService } from '../src/common/services/audit-log.service';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { EntityCustomFieldsService } from '../src/common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { OwnedStudentsService } from '../src/common/services/owned-students.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { FamilyPaymentService } from '../src/modules/finance/family-payment.service';
import { FinanceService } from '../src/modules/finance/finance.service';
import { UserRole } from '../src/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-database proof for paying several of a family's vouchers in one sitting:
 * each voucher gets an ordinary payment and the right status, a retried sitting
 * never pays twice, a refused voucher does not stop the others, and a voucher
 * outside the family is never paid. Run via `npm run test:postgres`.
 */
describe('PostgreSQL family payment', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let service: FamilyPaymentService;
  let institutionId: string;
  let campusId: string;
  let guardianId: string;
  let ayeshaVoucher: string;
  let bilalVoucher: string;
  let strangerVoucher: string;

  const superadmin: CurrentUser = {
    sub: randomUUID(),
    email: 'super@nexus.test',
    role: UserRole.SUPERADMIN,
    institutionId: null,
  };

  const newStudent = async (name: string, regNo: string) => {
    const user = await prisma.user.create({
      data: {
        institutionId,
        name,
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'STUDENT',
      },
    });
    return (
      await prisma.student.create({
        data: {
          userId: user.id,
          institutionId,
          regNo,
          dob: new Date('2012-01-01'),
          gender: 'FEMALE',
          campusId,
          admissionDate: new Date('2026-04-01'),
        },
      })
    ).id;
  };

  const voucher = async (
    studentId: string,
    structureId: string,
    amount: number,
  ) =>
    (
      await prisma.feeVoucher.create({
        data: {
          studentId,
          feeStructureId: structureId,
          month: 9,
          year: 2026,
          feeBreakdown: { tuition: amount },
          finalAmountDue: amount,
          dueDate: new Date('2026-09-10'),
        },
      })
    ).id;

  const statusOf = async (voucherId: string) =>
    (await prisma.feeVoucher.findUniqueOrThrow({ where: { id: voucherId } }))
      .status;
  const paymentsOf = (voucherId: string) =>
    prisma.feePayment.findMany({ where: { voucherId, deletedAt: null } });

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
    const campusAccess = new CampusAccessService(prisma);
    const finance = new FinanceService(
      prisma,
      campusAccess,
      new EntityCustomFieldsService(prisma, context),
      allowModule,
      context,
    );
    service = new FamilyPaymentService(
      prisma,
      allowModule,
      campusAccess,
      new OwnedStudentsService(prisma),
      new AuditLogService(prisma),
      finance,
    );

    institutionId = (
      await prisma.institution.create({
        data: { name: 'Family payment test', slug: randomUUID() },
      })
    ).id;
    await prisma.user.create({
      data: {
        id: superadmin.sub,
        name: 'Family payment superadmin',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'SUPERADMIN',
      },
    });
    campusId = (
      await prisma.campus.create({
        data: {
          institutionId,
          name: 'Family campus',
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
    const level = await prisma.level.create({
      data: { name: 'Family level', campusId },
    });
    const classId = (
      await prisma.academicClass.create({
        data: { name: 'Family class', levelId: level.id },
      })
    ).id;
    const structureId = (
      await prisma.feeStructure.create({
        data: { classId, campusId, feeBreakdown: { tuition: 5000 } },
      })
    ).id;

    const ayeshaId = await newStudent('Ayesha', 'P-1');
    const bilalId = await newStudent('Bilal', 'P-2');
    const strangerId = await newStudent('Stranger', 'P-3');
    ayeshaVoucher = await voucher(ayeshaId, structureId, 5000);
    bilalVoucher = await voucher(bilalId, structureId, 3000);
    strangerVoucher = await voucher(strangerId, structureId, 4000);

    const guardianAccount = await prisma.user.create({
      data: {
        institutionId,
        name: 'Mr Khan',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'GUARDIAN',
      },
    });
    guardianId = (
      await prisma.guardian.create({
        data: { userId: guardianAccount.id, relation: 'FATHER', campusId },
      })
    ).id;
    await prisma.studentGuardian.createMany({
      data: [
        { studentId: ayeshaId, guardianId },
        { studentId: bilalId, guardianId },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const sitting = (
    requestKey: string,
    payments: Array<{ voucherId: string; paidAmount: number }>,
  ) => ({
    requestKey,
    guardianId,
    paymentMethod: 'CASH' as never,
    paymentDate: '2026-10-25',
    payments,
  });
  const key = randomUUID();

  it('records a payment on each voucher and settles them according to the amount', async () => {
    const { data } = await service.record(
      superadmin,
      sitting(key, [
        { voucherId: ayeshaVoucher, paidAmount: 2000 },
        { voucherId: bilalVoucher, paidAmount: 3000 },
      ]),
    );

    expect(data.totals).toEqual({
      recorded: 2,
      failed: 0,
      totalRecorded: '5000.00',
    });
    expect(await statusOf(ayeshaVoucher)).toBe('OVERDUE');
    expect(await statusOf(bilalVoucher)).toBe('PAID');
    expect(await paymentsOf(ayeshaVoucher)).toHaveLength(1);
  });

  it('does not pay twice when the same sitting is sent again', async () => {
    const { data } = await service.record(
      superadmin,
      sitting(key, [
        { voucherId: ayeshaVoucher, paidAmount: 2000 },
        { voucherId: bilalVoucher, paidAmount: 3000 },
      ]),
    );

    expect(data.results.map((row) => row.status)).toEqual([
      'ALREADY_RECORDED',
      'ALREADY_RECORDED',
    ]);
    expect(await paymentsOf(ayeshaVoucher)).toHaveLength(1);
    expect(await paymentsOf(bilalVoucher)).toHaveLength(1);
  });

  it('keeps recording the others when one is refused for paying more than is owed', async () => {
    const { message, data } = await service.record(
      superadmin,
      sitting(randomUUID(), [
        { voucherId: bilalVoucher, paidAmount: 100 },
        { voucherId: ayeshaVoucher, paidAmount: 1000 },
      ]),
    );

    // Bilal is already fully paid, so the extra 100 is refused; Ayesha's 1000 goes through.
    expect(message).toBe('Some payments could not be recorded');
    expect(data.results[0]).toMatchObject({
      studentName: 'Bilal',
      status: 'FAILED',
    });
    expect(data.results[1]).toMatchObject({
      studentName: 'Ayesha',
      status: 'RECORDED',
    });
    const paid = (await paymentsOf(ayeshaVoucher)).reduce(
      (sum, row) => sum + Number(row.paidAmount),
      0,
    );
    expect(paid).toBe(3000);
    expect(await paymentsOf(bilalVoucher)).toHaveLength(1);
  });

  it("never pays a voucher outside the guardian's family", async () => {
    const { data } = await service.record(
      superadmin,
      sitting(randomUUID(), [{ voucherId: strangerVoucher, paidAmount: 500 }]),
    );

    expect(data.results[0]).toMatchObject({
      status: 'FAILED',
      message: "This voucher is not one of this guardian's children's.",
    });
    expect(await paymentsOf(strangerVoucher)).toHaveLength(0);
  });

  it('records one summary audit entry per sitting', async () => {
    const audit = await prisma.auditLog.findMany({
      where: { institutionId, action: 'FAMILY_PAYMENT_RECORDED' },
    });

    expect(audit.length).toBeGreaterThanOrEqual(4);
  });
});
