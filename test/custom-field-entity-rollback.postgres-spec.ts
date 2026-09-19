import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { AuditLogService } from '../src/common/services/audit-log.service';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { EntityCustomFieldsService } from '../src/common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { TimezoneResolverService } from '../src/common/services/timezone-resolver.service';
import { AcademicsService } from '../src/modules/academics/academics.service';
import { CampusesService } from '../src/modules/campuses/campuses.service';
import { FinanceService } from '../src/modules/finance/finance.service';
import { PeopleService } from '../src/modules/people/people.service';
import {
  AdjustmentType,
  DiscountType,
  UserRole,
} from '../src/common/enums/domain.enums';
import type { CurrentUser } from '../src/common/interfaces/current-user.interface';

/** Result shape shared by every service create/update call under test. */
type ServiceResult = Promise<{ data?: { id: string } | null }>;

/** One entity's rollback scenario, driven by the table below. */
interface EntityCase {
  /** Custom-field entity type, e.g. `class`. */
  entity: string;
  /** Custom-field module key of the definitions. */
  moduleKey: string;
  /** Prisma model name, which is the `entity` column of its audit rows. */
  model: string;
  /** Counts the entity's rows inside the fixture institution. */
  count: () => Promise<number>;
  /** Runs the real service create with the given custom values. */
  create: (customFields?: Record<string, unknown>) => ServiceResult;
  /** Optional real service update path, seeded with a directly created row. */
  update?: {
    seed: () => Promise<string>;
    run: (id: string, customFields: Record<string, unknown>) => ServiceResult;
    read: (id: string) => Promise<unknown>;
    changed: Record<string, unknown>;
    original: Record<string, unknown>;
  };
}

/**
 * Per-entity PostgreSQL rollback proof for the 14 custom-field entities that
 * previously had none (project-tracking/CUSTOM-FIELDS-ACCEPTANCE.md, PostgreSQL
 * proof summary). Each entity is driven through its real service so the record,
 * its custom values and its automatic audit row share one real transaction.
 *
 * Run via `npm run test:postgres` (see test/POSTGRES-TESTS.md).
 */
describe('PostgreSQL per-entity custom-field rollback', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let institutionId: string;
  let campusId: string;
  let levelId: string;
  let classId: string;
  let sectionId: string;
  let subjectId: string;
  let staffUserId: string;
  let staffProfileId: string;
  let studentId: string;
  let salaryId: string;
  let feeStructureClassId: string;
  let actor: CurrentUser;
  let academics: AcademicsService;
  let campuses: CampusesService;
  let finance: FinanceService;
  let people: PeopleService;
  const cases: EntityCase[] = [];

  /** Counts audit rows for a Prisma model. Suites run in band, so this is stable. */
  const auditCount = (model: string): Promise<number> =>
    prisma.auditLog.count({ where: { entity: model } });

  /** Counts committed custom values for an entity type in the fixture institution. */
  const valueCount = (entity: string): Promise<number> =>
    prisma.customFieldValue.count({
      where: { institutionId, definition: { entityType: entity } },
    });

  /** Creates a fresh class in the fixture level for entities needing a unique class. */
  const freshClass = async (): Promise<string> =>
    (
      await prisma.academicClass.create({
        data: { name: `Class ${randomUUID()}`, levelId },
      })
    ).id;

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
    const fields = new EntityCustomFieldsService(prisma, context);
    const campusAccess = new CampusAccessService(prisma);
    const moduleAccess = new ModuleAccessService(prisma);
    academics = new AcademicsService(
      prisma,
      campusAccess,
      fields,
      moduleAccess,
      context,
    );
    campuses = new CampusesService(
      prisma,
      new AuditLogService(prisma),
      campusAccess,
      fields,
      moduleAccess,
      context,
      new TimezoneResolverService(prisma),
    );
    finance = new FinanceService(
      prisma,
      campusAccess,
      fields,
      moduleAccess,
      context,
    );
    people = new PeopleService(
      prisma,
      campusAccess,
      fields,
      moduleAccess,
      context,
    );

    const institution = await prisma.institution.create({
      data: { name: 'Entity rollback test', slug: randomUUID() },
    });
    institutionId = institution.id;
    const campus = await prisma.campus.create({
      data: {
        institutionId,
        name: 'Rollback campus',
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
    // The default plan caps campuses at 1; the campus scenario creates more.
    await prisma.institutionSetting.create({
      data: { institutionId, key: 'limits', value: { maxCampuses: 100 } },
    });
    levelId = (
      await prisma.level.create({ data: { name: 'Rollback level', campusId } })
    ).id;
    classId = await freshClass();
    sectionId = (
      await prisma.section.create({ data: { name: 'Sec', classId } })
    ).id;
    subjectId = (
      await prisma.subject.create({ data: { name: 'Subj', classId } })
    ).id;
    const admin = await prisma.user.create({
      data: {
        institutionId,
        name: 'Rollback actor',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'SUPERADMIN',
      },
    });
    actor = {
      sub: admin.id,
      email: admin.email,
      role: UserRole.SUPERADMIN,
      institutionId,
    };
    const staff = await prisma.user.create({
      data: {
        institutionId,
        name: 'Rollback staff',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'STAFF',
        status: 'ACTIVE',
      },
    });
    staffUserId = staff.id;
    staffProfileId = (
      await prisma.staffProfile.create({
        data: {
          userId: staffUserId,
          employmentType: 'TEACHING',
          designation: 'Teacher',
          gender: 'MALE',
          campusId,
          joiningDate: new Date('2026-01-01'),
        },
      })
    ).id;
    studentId = (
      await prisma.student.create({
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
              name: 'Rollback student',
              email: `${randomUUID()}@example.test`,
              passwordHash: 'unused-test-value',
              role: 'STUDENT',
            },
          },
        },
      })
    ).id;
    salaryId = (
      await prisma.staffSalary.create({
        data: {
          userId: staffUserId,
          campusId,
          role: 'STAFF',
          joiningDate: new Date('2026-01-01'),
          baseSalary: 1000,
          effectiveDate: new Date('2026-01-01'),
        },
      })
    ).id;

    const seedBank = async (): Promise<string> =>
      (
        await prisma.bankAccount.create({
          data: {
            campusId,
            bankName: 'Original bank',
            accountTitle: 'Title',
            accountNumber: randomUUID(),
          },
        })
      ).id;
    const seedSalary = async (): Promise<string> =>
      (
        await prisma.staffSalary.create({
          data: {
            userId: staffUserId,
            campusId,
            role: 'STAFF',
            joiningDate: new Date('2026-01-01'),
            baseSalary: 1000,
            effectiveDate: new Date('2026-01-01'),
          },
        })
      ).id;

    cases.push(
      {
        entity: 'campus',
        moduleKey: 'ACADEMICS',
        model: 'Campus',
        count: () => prisma.campus.count({ where: { institutionId } }),
        create: (customFields) =>
          campuses.createCampus(actor, {
            institutionId,
            name: 'New campus',
            location: 'Test',
            studentStartTime: '08:00',
            studentEndTime: '14:00',
            staffStartTime: '08:00',
            staffEndTime: '14:00',
            lateThreshold: 10,
            earlyLeaveThreshold: 10,
            customFields,
          }),
        update: {
          seed: async () =>
            (
              await prisma.campus.create({
                data: {
                  institutionId,
                  name: 'Original campus',
                  location: 'Test',
                  studentStartTime: '08:00',
                  studentEndTime: '14:00',
                  staffStartTime: '08:00',
                  staffEndTime: '14:00',
                  lateThreshold: 10,
                  earlyLeaveThreshold: 10,
                },
              })
            ).id,
          run: (id, customFields) =>
            campuses.updateCampus(actor, id, {
              name: 'Renamed campus',
              customFields,
            }),
          read: (id) => prisma.campus.findUnique({ where: { id } }),
          original: { name: 'Original campus' },
          changed: { name: 'Renamed campus' },
        },
      },
      {
        entity: 'class',
        moduleKey: 'ACADEMICS',
        model: 'AcademicClass',
        count: () =>
          prisma.academicClass.count({ where: { level: { campusId } } }),
        create: (customFields) =>
          academics.createClass(actor, {
            name: 'New class',
            levelId,
            customFields,
          }),
        update: {
          seed: async () =>
            (
              await prisma.academicClass.create({
                data: { name: 'Original class', levelId },
              })
            ).id,
          run: (id, customFields) =>
            academics.updateClass(actor, id, {
              name: 'Renamed class',
              customFields,
            }),
          read: (id) => prisma.academicClass.findUnique({ where: { id } }),
          original: { name: 'Original class' },
          changed: { name: 'Renamed class' },
        },
      },
      {
        entity: 'section',
        moduleKey: 'ACADEMICS',
        model: 'Section',
        count: () => prisma.section.count({ where: { class: { levelId } } }),
        create: (customFields) =>
          academics.createSection(actor, {
            name: 'New section',
            classId,
            customFields,
          }),
        update: {
          seed: async () =>
            (
              await prisma.section.create({
                data: { name: 'Original section', classId },
              })
            ).id,
          run: (id, customFields) =>
            academics.updateSection(actor, id, {
              name: 'Renamed section',
              customFields,
            }),
          read: (id) => prisma.section.findUnique({ where: { id } }),
          original: { name: 'Original section' },
          changed: { name: 'Renamed section' },
        },
      },
      {
        entity: 'subject',
        moduleKey: 'ACADEMICS',
        model: 'Subject',
        count: () => prisma.subject.count({ where: { class: { levelId } } }),
        create: (customFields) =>
          academics.createSubject(actor, {
            name: 'New subject',
            classId,
            customFields,
          }),
        update: {
          seed: async () =>
            (
              await prisma.subject.create({
                data: { name: 'Original subject', classId },
              })
            ).id,
          run: (id, customFields) =>
            academics.updateSubject(actor, id, {
              name: 'Renamed subject',
              customFields,
            }),
          read: (id) => prisma.subject.findUnique({ where: { id } }),
          original: { name: 'Original subject' },
          changed: { name: 'Renamed subject' },
        },
      },
      {
        entity: 'teacher_subject',
        moduleKey: 'PEOPLE',
        model: 'TeacherSubject',
        count: () => prisma.teacherSubject.count({ where: { campusId } }),
        create: (customFields) =>
          people.assignTeacherSubject(actor, {
            staffProfileId,
            classId,
            subjectId,
            sectionId,
            campusId,
            customFields,
          }),
      },
      {
        entity: 'staff_salary',
        moduleKey: 'FINANCE',
        model: 'StaffSalary',
        count: () => prisma.staffSalary.count({ where: { campusId } }),
        create: (customFields) =>
          finance.createSalary(actor, {
            userId: staffUserId,
            campusId,
            role: UserRole.STAFF,
            joiningDate: '2026-02-01',
            baseSalary: 2000,
            effectiveDate: '2026-02-01',
            customFields,
          }),
        update: {
          seed: seedSalary,
          run: (id, customFields) =>
            finance.updateSalary(actor, id, { baseSalary: 3000, customFields }),
          read: async (id) => {
            const row = await prisma.staffSalary.findUnique({ where: { id } });
            return { baseSalary: Number(row?.baseSalary) };
          },
          original: { baseSalary: 1000 },
          changed: { baseSalary: 3000 },
        },
      },
      {
        entity: 'salary_deduction_rule',
        moduleKey: 'FINANCE',
        model: 'SalaryDeductionRule',
        count: () => prisma.salaryDeductionRule.count({ where: { campusId } }),
        create: (customFields) =>
          finance.createDeductionRule(actor, {
            campusId,
            role: UserRole.STAFF,
            allowedAbsences: 1,
            absenceDeductionPercent: 5,
            allowedLates: 1,
            lateDeductionPercent: 5,
            allowedHalfDays: 1,
            halfDayDeductionPercent: 5,
            allowedLeaves: 1,
            leaveDeductionPercent: 5,
            customFields,
          }),
      },
      {
        entity: 'salary_adjustment',
        moduleKey: 'FINANCE',
        model: 'SalaryAdjustment',
        count: () => prisma.salaryAdjustment.count({ where: { campusId } }),
        create: (customFields) =>
          finance.applyAdjustment(
            {
              userId: staffUserId,
              salaryId,
              campusId,
              adjustmentType: AdjustmentType.BONUS,
              amount: 50,
              month: 3,
              year: 2026,
              customFields,
            },
            actor,
          ),
      },
      {
        entity: 'salary_payment',
        moduleKey: 'FINANCE',
        model: 'SalaryPayment',
        count: () => prisma.salaryPayment.count({ where: { campusId } }),
        create: (customFields) =>
          finance.paySalary(
            {
              userId: staffUserId,
              salaryId,
              campusId,
              month: 4,
              year: 2026,
              customFields,
            },
            actor,
          ),
      },
      {
        entity: 'bank_account',
        moduleKey: 'FINANCE',
        model: 'BankAccount',
        count: () => prisma.bankAccount.count({ where: { campusId } }),
        create: (customFields) =>
          finance.createBankAccount(actor, {
            campusId,
            bankName: 'New bank',
            accountTitle: 'Title',
            accountNumber: '123456',
            customFields,
          }),
        update: {
          seed: seedBank,
          run: (id, customFields) =>
            finance.updateBankAccount(actor, id, {
              bankName: 'Renamed bank',
              customFields,
            }),
          read: (id) => prisma.bankAccount.findUnique({ where: { id } }),
          original: { bankName: 'Original bank' },
          changed: { bankName: 'Renamed bank' },
        },
      },
      {
        entity: 'fee_structure',
        moduleKey: 'FINANCE',
        model: 'FeeStructure',
        count: () => prisma.feeStructure.count({ where: { campusId } }),
        create: async (customFields) =>
          finance.createFeeStructure(actor, {
            classId: feeStructureClassId,
            campusId,
            feeBreakdown: { tuition: 100 },
            customFields,
          }),
        update: {
          seed: async () =>
            (
              await prisma.feeStructure.create({
                data: {
                  campusId,
                  classId: await freshClass(),
                  feeBreakdown: { tuition: 100 },
                },
              })
            ).id,
          run: (id, customFields) =>
            finance.updateFeeStructure(actor, id, {
              feeBreakdown: { tuition: 250 },
              customFields,
            }),
          read: async (id) => {
            const row = await prisma.feeStructure.findUnique({ where: { id } });
            return { feeBreakdown: row?.feeBreakdown };
          },
          original: { feeBreakdown: { tuition: 100 } },
          changed: { feeBreakdown: { tuition: 250 } },
        },
      },
      {
        entity: 'student_discount',
        moduleKey: 'FINANCE',
        model: 'StudentDiscount',
        count: () => prisma.studentDiscount.count({ where: { studentId } }),
        create: (customFields) =>
          finance.createStudentDiscount(
            {
              studentId,
              discountType: DiscountType.MERIT,
              discountAmount: 10,
              customFields,
            },
            actor,
          ),
      },
      {
        entity: 'student_fine_rule',
        moduleKey: 'FINANCE',
        model: 'StudentFineRule',
        count: () => prisma.studentFineRule.count({ where: { campusId } }),
        create: (customFields) =>
          finance.createStudentFineRule(actor, {
            campusId,
            allowedAbsences: 1,
            absenceFineAmount: 5,
            allowedLates: 1,
            lateFineAmount: 5,
            allowedHalfDays: 1,
            halfDayFineAmount: 5,
            allowedLeaves: 1,
            leaveFineAmount: 5,
            customFields,
          }),
      },
      {
        entity: 'student_fine',
        moduleKey: 'FINANCE',
        model: 'StudentFine',
        count: () => prisma.studentFine.count({ where: { studentId } }),
        create: (customFields) =>
          finance.createStudentFine(actor, {
            studentId,
            campusId,
            month: 5,
            year: 2026,
            totalFineAmount: 25,
            customFields,
          }),
      },
    );
    feeStructureClassId = await freshClass();
    await prisma.customFieldDefinition.createMany({
      data: cases.flatMap((entry) => [
        {
          institutionId,
          moduleKey: entry.moduleKey as never,
          entityType: entry.entity,
          fieldKey: 'proof',
          label: 'Proof',
          inputType: 'TEXT' as never,
          isRequired: true,
        },
        {
          institutionId,
          moduleKey: entry.moduleKey as never,
          entityType: entry.entity,
          fieldKey: 'score',
          label: 'Score',
          inputType: 'NUMBER' as never,
        },
      ]),
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const entities = [
    'campus',
    'class',
    'section',
    'subject',
    'teacher_subject',
    'staff_salary',
    'salary_deduction_rule',
    'salary_adjustment',
    'salary_payment',
    'bank_account',
    'fee_structure',
    'student_discount',
    'student_fine_rule',
    'student_fine',
  ];

  it.each(entities)(
    'rolls back the %s record, values and audit on invalid values, then commits valid ones',
    async (entity) => {
      const entry = cases.find((candidate) => candidate.entity === entity);
      if (!entry) throw new Error(`No scenario registered for ${entity}`);
      const rows = await entry.count();
      const audits = await auditCount(entry.model);
      const values = await valueCount(entity);
      const assertUntouched = async (): Promise<void> => {
        expect(await entry.count()).toBe(rows);
        expect(await auditCount(entry.model)).toBe(audits);
        expect(await valueCount(entity)).toBe(values);
      };

      // Missing required value: the record write has already run when the
      // value check rejects, so the rollback is real.
      await expect(entry.create()).rejects.toThrow('Proof');
      await assertUntouched();
      // Wrongly typed optional value alongside a valid required one.
      await expect(
        entry.create({ proof: 'ok', score: 'not-a-number' }),
      ).rejects.toThrow('Score');
      await assertUntouched();

      // The same payload then commits: nothing left over blocks a retry.
      const created = await entry.create({ proof: 'ok', score: 5 });
      const id = created.data?.id;
      if (!id) throw new Error(`Missing ${entity} id`);
      expect(await entry.count()).toBe(rows + 1);
      expect(await valueCount(entity)).toBe(values + 2);
      expect(await auditCount(entry.model)).toBe(audits + 1);
      expect(
        await prisma.auditLog.findFirst({
          where: { entity: entry.model, entityId: id },
        }),
      ).toMatchObject({ institutionId });
      expect(
        await prisma.customFieldValue.findMany({
          where: { entityId: id },
          orderBy: { createdAt: 'asc' },
          select: { value: true },
        }),
      ).toEqual(expect.arrayContaining([{ value: 'ok' }, { value: 5 }]));
    },
  );

  it.each([
    'campus',
    'class',
    'section',
    'subject',
    'staff_salary',
    'bank_account',
    'fee_structure',
  ])(
    'keeps %s update atomic when a submitted value is invalid',
    async (entity) => {
      const entry = cases.find((candidate) => candidate.entity === entity);
      if (!entry?.update) throw new Error(`No update path for ${entity}`);
      const { update } = entry;
      const id = await update.seed();
      const audits = await auditCount(entry.model);
      const values = await valueCount(entity);

      await expect(update.run(id, { score: 'not-a-number' })).rejects.toThrow(
        'Score',
      );
      expect(await update.read(id)).toMatchObject(update.original);
      expect(await auditCount(entry.model)).toBe(audits);
      expect(await valueCount(entity)).toBe(values);

      await update.run(id, { score: 9 });
      expect(await update.read(id)).toMatchObject(update.changed);
      expect(await valueCount(entity)).toBe(values + 1);
      expect(await auditCount(entry.model)).toBe(audits + 1);
    },
  );
});
