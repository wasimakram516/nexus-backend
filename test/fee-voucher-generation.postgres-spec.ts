import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { EntityCustomFieldsService } from '../src/common/services/entity-custom-fields.service';
import { FinanceService } from '../src/modules/finance/finance.service';
import { AuditLogService } from '../src/common/services/audit-log.service';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { FeeVoucherGenerationService } from '../src/modules/finance/fee-voucher-generation.service';
import { UserRole } from '../src/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-database proof for bulk voucher generation: stacked discounts and the
 * month's fine are applied, withdrawn students are left out, running twice or
 * at the same time never duplicates a voucher, and one-time charges, the due
 * date setting and the required-field refusal behave as designed. Run via
 * `npm run test:postgres`; see test/POSTGRES-TESTS.md.
 */
/** A service response's data, failing the test clearly when it is missing. */
function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('The response had no data.');
  }
  return value;
}

describe('PostgreSQL bulk voucher generation', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let service: FeeVoucherGenerationService;
  let finance: FinanceService;
  let institutionId: string;
  let campusId: string;
  let classId: string;
  let sectionId: string;
  let bankId: string;
  let ayeshaId: string;
  let bilalId: string;
  let withdrawnId: string;

  // SUPERADMIN skips module entitlement checks and can act at any campus.
  const superadmin: CurrentUser = {
    sub: randomUUID(),
    email: 'super@nexus.test',
    role: UserRole.SUPERADMIN,
    institutionId: null,
  };

  const newStudent = async (
    name: string,
    regNo: string,
    status: 'ACTIVE' | 'LEFT' = 'ACTIVE',
  ) => {
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
        campusId,
        admissionDate: new Date('2026-04-01'),
      },
    });
    await prisma.studentEnrollment.create({
      data: {
        studentId: student.id,
        academicYearId: (
          await prisma.institution.findUniqueOrThrow({
            where: { id: institutionId },
          })
        ).currentAcademicYearId as string,
        campusId,
        classId,
        sectionId,
        status,
      },
    });
    return student.id;
  };

  const vouchersFor = (studentId: string, month = 9, year = 2026) =>
    prisma.feeVoucher.findMany({ where: { studentId, month, year } });

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
    service = new FeeVoucherGenerationService(
      prisma,
      new ModuleAccessService(prisma),
      new CampusAccessService(prisma),
      context,
      new AuditLogService(prisma),
    );

    finance = new FinanceService(
      prisma,
      new CampusAccessService(prisma),
      new EntityCustomFieldsService(prisma, context),
      new ModuleAccessService(prisma),
      context,
    );

    const institution = await prisma.institution.create({
      data: { name: 'Voucher generation test', slug: randomUUID() },
    });
    institutionId = institution.id;
    // Audit entries record the acting user, which must be a real account.
    await prisma.user.create({
      data: {
        id: superadmin.sub,
        name: 'Voucher test superadmin',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'SUPERADMIN',
      },
    });
    const year = await prisma.academicYear.create({
      data: {
        institutionId,
        name: '2026-27',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-06-30'),
      },
    });
    await prisma.institution.update({
      where: { id: institutionId },
      data: { currentAcademicYearId: year.id },
    });
    campusId = (
      await prisma.campus.create({
        data: {
          institutionId,
          name: 'Voucher campus',
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
      data: { name: 'Voucher level', campusId },
    });
    classId = (
      await prisma.academicClass.create({
        data: { name: 'Voucher class', levelId: level.id },
      })
    ).id;
    sectionId = (await prisma.section.create({ data: { name: 'A', classId } }))
      .id;
    await prisma.feeStructure.create({
      data: {
        classId,
        campusId,
        feeBreakdown: { tuition: 5000, transport: 1000 },
      },
    });
    bankId = (
      await prisma.bankAccount.create({
        data: {
          campusId,
          bankName: 'Test Bank',
          accountTitle: 'School',
          accountNumber: '123456',
        },
      })
    ).id;

    ayeshaId = await newStudent('Ayesha', 'V-1');
    bilalId = await newStudent('Bilal', 'V-2');
    withdrawnId = await newStudent('Withdrawn', 'V-3', 'LEFT');

    // Ayesha: two stacked discounts. Bilal: discounts larger than the fee.
    await prisma.studentDiscount.createMany({
      data: [
        { studentId: ayeshaId, discountType: 'SIBLING', discountAmount: 500 },
        { studentId: ayeshaId, discountType: 'MERIT', discountAmount: 300 },
        {
          studentId: bilalId,
          discountType: 'NEED_BASED',
          discountAmount: 5000,
        },
        {
          studentId: bilalId,
          discountType: 'STAFF_CHILD',
          discountAmount: 4000,
        },
      ],
    });
    await prisma.studentFine.create({
      data: {
        studentId: ayeshaId,
        campusId,
        month: 9,
        year: 2026,
        totalFineAmount: 150,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('previews without creating anything', async () => {
    const preview = (
      await service.generate(superadmin, {
        campusId,
        month: 9,
        year: 2026,
        preview: true,
      })
    ).data;

    expect(preview.totals.generated).toBe(2);
    expect(await vouchersFor(ayeshaId)).toHaveLength(0);
    expect(await vouchersFor(bilalId)).toHaveLength(0);
  });

  it('creates vouchers with stacked discounts, capped at the fee, and the month fine', async () => {
    const { data } = await service.generate(superadmin, {
      campusId,
      month: 9,
      year: 2026,
      bankId,
    });

    expect(data.totals).toMatchObject({ generated: 2, skipped: 0, failed: 0 });
    const [ayesha] = await vouchersFor(ayeshaId);
    // 6000 fees - (500 + 300) discounts + 150 fine.
    expect(Number(ayesha.discountAmount)).toBe(800);
    expect(Number(ayesha.fineAmount)).toBe(150);
    expect(Number(ayesha.finalAmountDue)).toBe(5350);
    expect(ayesha.bankId).toBe(bankId);
    // Unpaid, so overdue once its due date has passed and pending until then.
    expect(ayesha.status).toBe(
      ayesha.dueDate < new Date() ? 'OVERDUE' : 'PENDING',
    );
    // Bilal's 9000 of discounts are capped at the 6000 fee, not allowed to go negative.
    const [bilal] = await vouchersFor(bilalId);
    expect(Number(bilal.discountAmount)).toBe(6000);
    expect(Number(bilal.finalAmountDue)).toBe(0);
  });

  it('leaves a withdrawn student out', async () => {
    expect(await vouchersFor(withdrawnId)).toHaveLength(0);
  });

  it('defaults the due date to the 10th of the month', async () => {
    const [ayesha] = await vouchersFor(ayeshaId);

    expect(ayesha.dueDate.toISOString().slice(0, 10)).toBe('2026-09-10');
  });

  it('skips everyone on a second run and creates no duplicates', async () => {
    const { data } = await service.generate(superadmin, {
      campusId,
      month: 9,
      year: 2026,
    });

    expect(data.totals).toMatchObject({ generated: 0, skipped: 2, failed: 0 });
    expect(await vouchersFor(ayeshaId)).toHaveLength(1);
    expect(await vouchersFor(bilalId)).toHaveLength(1);
  });

  it('does not duplicate when two runs happen at the same moment', async () => {
    const outcomes = await Promise.all([
      service.generate(superadmin, { campusId, month: 10, year: 2026 }),
      service.generate(superadmin, { campusId, month: 10, year: 2026 }),
    ]);

    expect(await vouchersFor(ayeshaId, 10)).toHaveLength(1);
    expect(await vouchersFor(bilalId, 10)).toHaveLength(1);
    const created = outcomes.reduce(
      (sum, run) => sum + run.data.totals.generated,
      0,
    );
    const failed = outcomes.reduce(
      (sum, run) => sum + run.data.totals.failed,
      0,
    );
    expect(created).toBe(2);
    expect(failed).toBe(0);
  });

  it('adds one-time charges to that run only, keeping every other voucher unchanged', async () => {
    const { data } = await service.generate(superadmin, {
      campusId,
      month: 11,
      year: 2026,
      oneTimeCharges: [{ label: 'Admission fee', amount: 2000 }],
    });

    expect(data.totals.generated).toBe(2);
    const [ayesha] = await vouchersFor(ayeshaId, 11);
    expect(ayesha.feeBreakdown).toEqual({
      tuition: 5000,
      transport: 1000,
      'Admission fee': 2000,
    });
    // 8000 - 800 discounts (no fine in November).
    expect(Number(ayesha.finalAmountDue)).toBe(7200);
    const [september] = await vouchersFor(ayeshaId, 9);
    expect(september.feeBreakdown).toEqual({ tuition: 5000, transport: 1000 });
  });

  it('uses the institution due day from settings', async () => {
    await prisma.institutionSetting.create({
      data: { institutionId, key: 'finance', value: { dueDayOfMonth: 5 } },
    });

    await service.generate(superadmin, { campusId, month: 12, year: 2026 });

    const [ayesha] = await vouchersFor(ayeshaId, 12);
    expect(ayesha.dueDate.toISOString().slice(0, 10)).toBe('2026-12-05');
  });

  it('records one summary audit entry per real run, and none for a preview', async () => {
    const audit = await prisma.auditLog.findMany({
      where: { institutionId, action: 'FEE_VOUCHERS_BULK_GENERATED' },
    });

    // September, October (two simultaneous runs), November and December.
    expect(audit.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(audit[0].metadata)).toContain('"generated"');
  });

  it('audits each created voucher under the institution', async () => {
    const [ayesha] = await vouchersFor(ayeshaId, 9);
    const entries = await prisma.auditLog.findMany({
      where: { entity: 'FeeVoucher', entityId: ayesha.id },
    });

    expect(entries.length).toBeGreaterThan(0);
    expect(
      entries.every((entry) => entry.institutionId === institutionId),
    ).toBe(true);
  });

  it('adds one-time charges to a single voucher, keeps them when it is edited, and replaces or clears them on request', async () => {
    const structure = await prisma.feeStructure.findFirstOrThrow({
      where: { classId },
    });
    const created = await finance.createFeeVoucher(superadmin, {
      studentId: bilalId,
      feeStructureId: structure.id,
      month: 2,
      year: 2027,
      dueDate: '2027-02-10',
      oneTimeCharges: [{ label: 'Admission fee', amount: 2000 }],
    });
    const id = present(created.data).id;
    // 6000 + 2000 of charges; Bilal's discounts (9000) cap at the 8000 total.
    expect(present(created.data).feeBreakdown).toEqual({
      tuition: 5000,
      transport: 1000,
      'Admission fee': 2000,
    });
    expect(Number(present(created.data).finalAmountDue)).toBe(0);

    // Editing only the due date must not drop the admission fee.
    const edited = await finance.updateFeeVoucher(superadmin, id, {
      dueDate: '2027-02-20',
    });
    expect(present(edited.data).feeBreakdown).toEqual({
      tuition: 5000,
      transport: 1000,
      'Admission fee': 2000,
    });

    const replaced = await finance.updateFeeVoucher(superadmin, id, {
      oneTimeCharges: [{ label: 'Exam fee', amount: 300 }],
    });
    expect(present(replaced.data).feeBreakdown).toEqual({
      tuition: 5000,
      transport: 1000,
      'Exam fee': 300,
    });

    const cleared = await finance.updateFeeVoucher(superadmin, id, {
      oneTimeCharges: [],
    });
    expect(present(cleared.data).feeBreakdown).toEqual({
      tuition: 5000,
      transport: 1000,
    });
  });

  it('refuses to run while vouchers have required custom fields', async () => {
    await prisma.customFieldDefinition.create({
      data: {
        institutionId,
        moduleKey: 'FINANCE',
        entityType: 'fee_voucher',
        fieldKey: 'reference',
        label: 'Reference',
        inputType: 'TEXT',
        isRequired: true,
      },
    });

    await expect(
      service.generate(superadmin, { campusId, month: 1, year: 2027 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await vouchersFor(ayeshaId, 1, 2027)).toHaveLength(0);
  });
});
