import { randomInt, randomUUID } from 'node:crypto';
import { Prisma } from '../src/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { EntityCustomFieldsService } from '../src/common/services/entity-custom-fields.service';
import { runAuditedTransaction } from '../src/common/utils/transaction.util';
import { reconcileFeeVoucher } from '../src/common/utils/fee-settlement.util';
import { FinanceService } from '../src/modules/finance/finance.service';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import {
  PaymentMethod,
  GuardianRelation,
  EmploymentType,
  Gender,
} from '../src/common/enums/domain.enums';
import { PeopleService } from '../src/modules/people/people.service';
import { RecycleBinService } from '../src/modules/recycle-bin/recycle-bin.service';
import { RecycleBinEntity } from '../src/modules/recycle-bin/dto/recycle-bin.dto';
import { AuditLogService } from '../src/common/services/audit-log.service';

describe('PostgreSQL audited transactions', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let fields: EntityCustomFieldsService;
  let institutionId: string;
  let campusId: string;
  let voucherId: string;

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
    fields = new EntityCustomFieldsService(prisma, context);
    const institution = await prisma.institution.create({
      data: { name: 'Transaction test', slug: randomUUID() },
    });
    institutionId = institution.id;
    const campus = await prisma.campus.create({
      data: {
        institutionId,
        name: 'Test campus',
        location: 'Test',
        studentStartTime: '08:00',
        studentEndTime: '14:00',
        staffStartTime: '08:00',
        staffEndTime: '14:00',
        lateThreshold: 10,
        earlyLeaveThreshold: 10,
      },
    });
    campusId = campus.id;
    const student = await prisma.student.create({
      data: {
        institution: { connect: { id: institutionId } },
        campus: { connect: { id: campusId } },
        regNo: randomUUID(),
        gender: 'MALE',
        dob: new Date('2010-01-01'),
        admissionDate: new Date('2026-01-01'),
        user: {
          create: {
            institutionId,
            name: 'Test student',
            email: `${randomUUID()}@example.test`,
            passwordHash: 'unused-test-value',
            role: 'STUDENT',
          },
        },
      },
    });
    const structure = await prisma.feeStructure.create({
      data: {
        campus: { connect: { id: campusId } },
        feeBreakdown: {},
        class: {
          create: {
            name: 'Test class',
            level: { create: { name: 'Test level', campusId } },
          },
        },
      },
    });
    const voucher = await prisma.feeVoucher.create({
      data: {
        studentId: student.id,
        feeStructureId: structure.id,
        month: 1,
        year: 2026,
        feeBreakdown: {},
        finalAmountDue: 100,
        dueDate: new Date('2099-01-01'),
      },
    });
    voucherId = voucher.id;
    await prisma.customFieldDefinition.create({
      data: {
        institutionId,
        moduleKey: 'ACADEMICS',
        entityType: 'level',
        fieldKey: 'shift',
        label: 'Shift',
        inputType: 'TEXT',
        isRequired: true,
      },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('rolls back admission, enrollment and login identifier when student custom values fail', async () => {
    const people = new PeopleService(
      prisma,
      new CampusAccessService(prisma),
      fields,
      new ModuleAccessService(prisma),
      context,
    );
    const account = await prisma.user.create({
      data: {
        institutionId,
        name: 'Admission test',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'STUDENT',
      },
    });
    const actor = {
      sub: account.id,
      email: account.email,
      role: 'SUPERADMIN' as const,
      institutionId,
    };
    const year = await prisma.academicYear.create({
      data: {
        institutionId,
        name: 'Admission year',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
    });
    await prisma.institution.update({
      where: { id: institutionId },
      data: { currentAcademicYearId: year.id },
    });
    const classroom = await prisma.academicClass.findFirstOrThrow({
      where: { level: { campusId } },
    });
    await prisma.customFieldDefinition.create({
      data: {
        institutionId,
        moduleKey: 'PEOPLE',
        entityType: 'student',
        fieldKey: 'transport',
        label: 'Transport',
        inputType: 'TEXT',
        isRequired: true,
      },
    });
    const request = {
      userId: account.id,
      campusId,
      regNo: randomUUID(),
      gender: Gender.MALE,
      dob: '2010-01-01',
      admissionDate: '2026-01-01',
      classId: classroom.id,
    };
    await expect(people.createStudent(actor, request)).rejects.toThrow(
      'Transport',
    );
    expect(await prisma.student.count({ where: { userId: account.id } })).toBe(
      0,
    );
    expect(
      await prisma.studentEnrollment.count({
        where: { academicYearId: year.id },
      }),
    ).toBe(0);
    expect(
      await prisma.user.findUnique({ where: { id: account.id } }),
    ).toMatchObject({ identifier: null });
    const created = await people.createStudent(actor, {
      ...request,
      customFields: { transport: 'Bus' },
    });
    expect(created.data).toMatchObject({
      regNo: request.regNo,
      customFields: { transport: 'Bus' },
    });
    if (!created.data) throw new Error('Missing admission response');
    await expect(
      people.updateStudent(actor, created.data.id, {
        regNo: randomUUID(),
        customFields: { transport: 42 },
      }),
    ).rejects.toThrow('Transport');
    expect(
      await prisma.student.findUnique({ where: { id: created.data.id } }),
    ).toMatchObject({ regNo: request.regNo });
    expect(
      await prisma.studentEnrollment.count({
        where: { academicYearId: year.id },
      }),
    ).toBe(1);
    expect(
      await prisma.user.findUnique({ where: { id: account.id } }),
    ).toMatchObject({ identifier: request.regNo });
    const nextClass = await prisma.academicClass.create({
      data: { name: 'Next class', levelId: classroom.levelId },
    });
    await prisma.customFieldDefinition.create({
      data: {
        institutionId,
        moduleKey: 'PEOPLE',
        entityType: 'student_history',
        fieldKey: 'approval',
        label: 'Approval',
        inputType: 'TEXT',
        isRequired: true,
      },
    });
    const promotion = {
      studentId: created.data.id,
      academicYearId: year.id,
      previousClassId: classroom.id,
      newClassId: nextClass.id,
      promotionDate: '2026-09-16',
    };
    await expect(people.recordPromotion(actor, promotion)).rejects.toThrow(
      'Approval',
    );
    expect(
      await prisma.studentEnrollment.findFirst({
        where: { studentId: created.data.id, academicYearId: year.id },
      }),
    ).toMatchObject({ classId: classroom.id });
    expect(
      await prisma.studentHistory.count({
        where: { studentId: created.data.id },
      }),
    ).toBe(0);
    await people.recordPromotion(actor, {
      ...promotion,
      customFields: { approval: 'Approved' },
    });
    expect(
      await prisma.studentEnrollment.findFirst({
        where: { studentId: created.data.id, academicYearId: year.id },
      }),
    ).toMatchObject({ classId: nextClass.id });
    expect(
      await prisma.studentHistory.count({
        where: { studentId: created.data.id },
      }),
    ).toBe(1);
  });

  it('rolls back staff profiles and campus access together on invalid custom values', async () => {
    const people = new PeopleService(
      prisma,
      new CampusAccessService(prisma),
      fields,
      new ModuleAccessService(prisma),
      context,
    );
    const account = await prisma.user.create({
      data: {
        institutionId,
        name: 'Staff test',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'STAFF',
      },
    });
    const actor = {
      sub: account.id,
      email: account.email,
      role: 'SUPERADMIN' as const,
      institutionId,
    };
    await prisma.customFieldDefinition.create({
      data: {
        institutionId,
        moduleKey: 'PEOPLE',
        entityType: 'staff_profile',
        fieldKey: 'qualification',
        label: 'Qualification',
        inputType: 'TEXT',
        isRequired: true,
      },
    });
    const request = {
      userId: account.id,
      campusId,
      designation: 'Teacher',
      employmentType: EmploymentType.TEACHING,
      gender: Gender.MALE,
      joiningDate: '2026-01-01',
    };
    await expect(people.createStaffProfile(actor, request)).rejects.toThrow(
      'Qualification',
    );
    expect(
      await prisma.staffProfile.count({ where: { userId: account.id } }),
    ).toBe(0);
    expect(
      await prisma.userCampus.count({ where: { userId: account.id } }),
    ).toBe(0);
    const created = await people.createStaffProfile(actor, {
      ...request,
      customFields: { qualification: 'Degree' },
    });
    if (!created.data) throw new Error('Missing staff response');
    expect(
      await prisma.userCampus.count({
        where: { userId: account.id, campusId },
      }),
    ).toBe(1);
    await expect(
      people.updateStaffProfile(actor, created.data.id, {
        designation: 'Changed',
        customFields: { qualification: 5 },
      }),
    ).rejects.toThrow('Qualification');
    expect(
      await prisma.staffProfile.findUnique({ where: { id: created.data.id } }),
    ).toMatchObject({ designation: 'Teacher' });
  });

  it('rolls back guardian records and contact login changes when custom values fail', async () => {
    const people = new PeopleService(
      prisma,
      new CampusAccessService(prisma),
      fields,
      new ModuleAccessService(prisma),
      context,
    );
    const account = await prisma.user.create({
      data: {
        institutionId,
        name: 'Guardian test',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'GUARDIAN',
      },
    });
    const phone = `03${randomInt(100000000, 1000000000)}`;
    const actor = {
      sub: account.id,
      email: account.email,
      role: 'SUPERADMIN' as const,
      institutionId,
    };
    await prisma.customFieldDefinition.create({
      data: {
        institutionId,
        moduleKey: 'PEOPLE',
        entityType: 'guardian',
        fieldKey: 'occupation',
        label: 'Occupation',
        inputType: 'TEXT',
        isRequired: true,
      },
    });
    const request = {
      userId: account.id,
      campusId,
      relation: GuardianRelation.FATHER,
    };
    const auditsBefore = await prisma.auditLog.count({
      where: { institutionId },
    });
    await expect(people.createGuardian(actor, request)).rejects.toThrow(
      'Occupation',
    );
    expect(await prisma.guardian.count({ where: { userId: account.id } })).toBe(
      0,
    );
    expect(await prisma.auditLog.count({ where: { institutionId } })).toBe(
      auditsBefore,
    );
    const created = await people.createGuardian(actor, {
      ...request,
      customFields: { occupation: 'Teacher' },
    });
    if (!created.data) throw new Error('Missing guardian response');
    const student = await prisma.feeVoucher.findUniqueOrThrow({
      where: { id: voucherId },
      select: { studentId: true },
    });
    await prisma.customFieldDefinition.create({
      data: {
        institutionId,
        moduleKey: 'PEOPLE',
        entityType: 'student_guardian',
        fieldKey: 'note',
        label: 'Relationship note',
        inputType: 'TEXT',
        isRequired: true,
      },
    });
    const link = { studentId: student.studentId, guardianId: created.data.id };
    await expect(people.linkGuardian(actor, link)).rejects.toThrow(
      'Relationship note',
    );
    expect(await prisma.studentGuardian.count({ where: link })).toBe(0);
    const linked = await people.linkGuardian(actor, {
      ...link,
      customFields: { note: 'Primary contact' },
    });
    expect(linked.data).toMatchObject({
      id: `${link.studentId}:${link.guardianId}`,
      customFields: { note: 'Primary contact' },
    });
    expect((await people.linkGuardian(actor, link)).data).toMatchObject({
      customFields: { note: 'Primary contact' },
    });
    expect(await prisma.studentGuardian.count({ where: link })).toBe(1);
    await expect(
      people.updateGuardian(actor, created.data.id, {
        picture: 'changed',
        customFields: { occupation: 42 },
      }),
    ).rejects.toThrow('Occupation');
    expect(
      await prisma.guardian.findUnique({ where: { id: created.data.id } }),
    ).toMatchObject({ picture: null });
    await prisma.customFieldDefinition.create({
      data: {
        institutionId,
        moduleKey: 'PEOPLE',
        entityType: 'contact',
        fieldKey: 'label',
        label: 'Contact label',
        inputType: 'TEXT',
        isRequired: true,
      },
    });
    await expect(
      people.createContact(actor, {
        personId: created.data.id,
        personType: 'guardian',
        phone1: phone,
      }),
    ).rejects.toThrow('Contact label');
    expect(
      await prisma.contact.count({ where: { guardianId: created.data.id } }),
    ).toBe(0);
    expect(
      await prisma.user.findUnique({ where: { id: account.id } }),
    ).toMatchObject({ identifier: null });
    await people.createContact(actor, {
      personId: created.data.id,
      personType: 'guardian',
      phone1: phone,
      customFields: { label: 'Home' },
    });
    expect(
      await prisma.user.findUnique({ where: { id: account.id } }),
    ).toMatchObject({ identifier: phone });
  });

  it('replays concurrent service requests once and rejects changed or deleted receipts', async () => {
    const finance = new FinanceService(
      prisma,
      new CampusAccessService(prisma),
      fields,
      new ModuleAccessService(prisma),
      context,
    );
    const actor = await prisma.user.create({
      data: {
        name: 'Test admin',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'SUPERADMIN',
      },
    });
    const user = {
      sub: actor.id,
      email: actor.email,
      role: actor.role,
      institutionId,
    };
    const original = await prisma.feeVoucher.findUniqueOrThrow({
      where: { id: voucherId },
    });
    const voucher = await prisma.feeVoucher.create({
      data: {
        studentId: original.studentId,
        feeStructureId: original.feeStructureId,
        month: 2,
        year: 2026,
        feeBreakdown: {},
        finalAmountDue: 100,
        dueDate: new Date('2099-01-01'),
      },
    });
    const request = {
      requestKey: randomUUID(),
      voucherId: voucher.id,
      month: 2,
      year: 2026,
      paidAmount: 25,
      paymentMethod: PaymentMethod.CASH,
      paymentDate: '2026-02-01',
    };
    const results = await Promise.all([
      finance.createFeePayment(request, user),
      finance.createFeePayment(request, user),
    ]);
    if (!results[0].data || !results[1].data)
      throw new Error('Missing payment response');
    expect(results[0].data.id).toBe(results[1].data.id);
    await expect(
      finance.updateFeeVoucher(user, voucher.id, { month: 3 }),
    ).rejects.toThrow('payment history');
    expect(
      await prisma.feePayment.count({ where: { voucherId: voucher.id } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entity: 'FeePayment', entityId: results[0].data.id },
      }),
    ).toBe(1);
    await expect(
      finance.createFeePayment({ ...request, paidAmount: 30 }, user),
    ).rejects.toThrow('already used');
    await finance.deleteFeePayment(user, results[0].data.id, 'Test correction');
    await expect(
      finance.updateFeeVoucher(user, voucher.id, { year: 2027 }),
    ).rejects.toThrow('payment history');
    await expect(finance.createFeePayment(request, user)).rejects.toThrow(
      'already used',
    );
    expect(
      await prisma.feeVoucher.findUnique({ where: { id: voucher.id } }),
    ).toMatchObject({ status: 'PENDING' });
    const recycle = new RecycleBinService(
      prisma,
      new AuditLogService(prisma),
      context,
    );
    await recycle.restoreRecord(
      user,
      RecycleBinEntity.FEE_PAYMENT,
      results[0].data.id,
    );
    expect(
      await prisma.feeVoucher.findUnique({ where: { id: voucher.id } }),
    ).toMatchObject({ status: 'PARTIAL' });
    await finance.deleteFeePayment(user, results[0].data.id, 'Test correction');
    await finance.createFeePayment(
      { ...request, requestKey: randomUUID(), paidAmount: 100 },
      user,
    );
    const auditCount = await prisma.auditLog.count({
      where: { entityId: results[0].data.id },
    });
    await expect(
      recycle.restoreRecord(
        user,
        RecycleBinEntity.FEE_PAYMENT,
        results[0].data.id,
      ),
    ).rejects.toThrow('exceeds');
    expect(
      await prisma.feePayment.findFirst({
        where: { id: results[0].data.id, deletedAt: { not: null } },
      }),
    ).not.toBeNull();
    expect(
      await prisma.auditLog.count({ where: { entityId: results[0].data.id } }),
    ).toBe(auditCount);
    expect(
      await prisma.feeVoucher.findUnique({ where: { id: voucher.id } }),
    ).toMatchObject({ status: 'PAID' });
    await expect(
      finance.updateFeeStructure(user, original.feeStructureId, {
        feeBreakdown: { tuition: -1 },
      }),
    ).rejects.toThrow('nonnegative');
    await prisma.feeStructure.update({
      where: { id: original.feeStructureId },
      data: { feeBreakdown: { tuition: 100 } },
    });
    await prisma.studentDiscount.create({
      data: {
        studentId: original.studentId,
        discountType: 'MERIT',
        discountAmount: 30,
      },
    });
    await prisma.studentDiscount.create({
      data: {
        studentId: original.studentId,
        discountType: 'MERIT',
        discountAmount: 20,
      },
    });
    const calculated = await finance.createFeeVoucher(user, {
      studentId: original.studentId,
      feeStructureId: original.feeStructureId,
      month: 4,
      year: 2026,
      dueDate: '2099-01-01',
    });
    if (!calculated.data) throw new Error('Missing voucher response');
    expect(calculated.data.discountAmount.toFixed(2)).toBe('50.00');
    expect(calculated.data.finalAmountDue.toFixed(2)).toBe('50.00');
    await prisma.studentDiscount.create({
      data: {
        studentId: original.studentId,
        discountType: 'MERIT',
        discountAmount: 100,
      },
    });
    const capped = await finance.updateFeeVoucher(user, calculated.data.id, {
      lateFeeFine: 5,
    });
    expect(capped.data?.discountAmount.toFixed(2)).toBe('100.00');
    expect(capped.data?.finalAmountDue.toFixed(2)).toBe('5.00');
    const otherCampus = await prisma.campus.create({
      data: {
        institutionId,
        name: 'Other campus',
        location: 'Test',
        studentStartTime: '08:00',
        studentEndTime: '14:00',
        staffStartTime: '08:00',
        staffEndTime: '14:00',
        lateThreshold: 10,
        earlyLeaveThreshold: 10,
      },
    });
    const bank = await prisma.bankAccount.create({
      data: {
        campusId: otherCampus.id,
        bankName: 'Test bank',
        accountTitle: 'Test',
        accountNumber: randomUUID(),
      },
    });
    await expect(
      finance.updateFeeVoucher(user, calculated.data.id, { bankId: bank.id }),
    ).rejects.toThrow('voucher campus');
    expect(
      await prisma.feeVoucher.findUnique({ where: { id: calculated.data.id } }),
    ).toMatchObject({ bankId: null });
    await expect(
      finance.createFeeVoucher(user, {
        studentId: original.studentId,
        feeStructureId: original.feeStructureId,
        month: 5,
        year: 2026,
        dueDate: '2099-01-01',
        bankId: bank.id,
      }),
    ).rejects.toThrow('voucher campus');
  });

  it('rejects concurrent overpayment and duplicate receipt keys without stray audit entries', async () => {
    const ids = [randomUUID(), randomUUID()];
    const keys = [randomUUID(), randomUUID()];
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    /** Creates competing receipts against the same voucher snapshot. */
    const pay = (id: string, requestKey: string): Promise<unknown> =>
      runAuditedTransaction(
        prisma,
        context,
        async (tx) => {
          await tx.feeVoucher.findUniqueOrThrow({ where: { id: voucherId } });
          arrivals += 1;
          if (arrivals === 2) release();
          await barrier;
          await tx.feePayment.create({
            data: {
              id,
              requestKey,
              voucherId,
              month: 1,
              year: 2026,
              paidAmount: 60,
              paymentMethod: 'CASH',
              paymentDate: new Date('2026-01-01'),
            },
          });
          return reconcileFeeVoucher(tx, voucherId);
        },
        Prisma.TransactionIsolationLevel.Serializable,
      );
    const results = await Promise.allSettled(
      ids.map((id, index) => pay(id, keys[index])),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const receipts = await prisma.feePayment.findMany({ where: { voucherId } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].paidAmount.toFixed(2)).toBe('60.00');
    expect(
      await prisma.feeVoucher.findUnique({ where: { id: voucherId } }),
    ).toMatchObject({ status: 'PARTIAL' });
    expect(
      await prisma.auditLog.count({
        where: { entity: 'FeePayment', entityId: { in: ids } },
      }),
    ).toBe(1);
    await expect(
      prisma.feePayment.create({
        data: {
          requestKey: receipts[0].requestKey,
          voucherId,
          month: 1,
          year: 2026,
          paidAmount: 1,
          paymentMethod: 'CASH',
          paymentDate: new Date('2026-01-01'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.feePayment.count({ where: { voucherId } })).toBe(1);
  });

  it('rolls back the record and automatic audit when required values fail', async () => {
    const id = randomUUID();
    await expect(
      fields.saveRecord(
        {
          institutionId,
          moduleKey: 'ACADEMICS',
          entityType: 'level',
          create: true,
        },
        (tx) => tx.level.create({ data: { id, name: 'Rejected', campusId } }),
      ),
    ).rejects.toThrow('Shift');
    expect(await prisma.level.count({ where: { id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: id } })).toBe(0);
    expect(
      await prisma.customFieldValue.count({ where: { entityId: id } }),
    ).toBe(0);
  });

  it('commits values and audits and captures an uncommitted pre-image', async () => {
    const record = await fields.saveRecord(
      {
        institutionId,
        moduleKey: 'ACADEMICS',
        entityType: 'level',
        create: true,
        values: { shift: 'Morning' },
      },
      async (tx) => {
        const created = await tx.level.create({
          data: { name: 'Before', campusId },
        });
        return tx.level.update({
          where: { id: created.id },
          data: { name: 'After' },
        });
      },
    );
    expect(
      await prisma.customFieldValue.findFirst({
        where: { entityId: record.id },
      }),
    ).toMatchObject({ value: 'Morning' });
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: record.id, action: 'LEVEL_UPDATED' },
    });
    expect(audit).toMatchObject({
      institutionId,
      before: { name: 'Before' },
      after: { name: 'After' },
    });
  });

  it('retries a real serialization conflict without losing either update or duplicating audits', async () => {
    const level = await prisma.level.create({ data: { name: '0', campusId } });
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let attempts = 0;
    /** Forces both first attempts to read the same version before updating. */
    const increment = (): Promise<unknown> =>
      runAuditedTransaction(
        prisma,
        context,
        async (tx) => {
          attempts += 1;
          const current = await tx.level.findUniqueOrThrow({
            where: { id: level.id },
          });
          arrivals += 1;
          if (arrivals === 2) release();
          await barrier;
          return tx.level.update({
            where: { id: level.id },
            data: { name: String(Number(current.name) + 1) },
          });
        },
        Prisma.TransactionIsolationLevel.Serializable,
      );
    await Promise.all([increment(), increment()]);
    expect(attempts).toBe(3);
    expect(
      await prisma.level.findUnique({ where: { id: level.id } }),
    ).toMatchObject({ name: '2' });
    expect(
      await prisma.auditLog.count({
        where: { entityId: level.id, action: 'LEVEL_UPDATED' },
      }),
    ).toBe(2);
  });
});
