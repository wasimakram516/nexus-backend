import { randomUUID } from 'node:crypto';
import { AuditLogService } from '../src/common/services/audit-log.service';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { StudentFineGenerationService } from '../src/modules/finance/student-fine-generation.service';
import { UserRole } from '../src/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-database proof for attendance fines: the month's marks are counted per
 * student, only the marks beyond the allowance are charged, a re-run refreshes
 * its own fines, and manual fines, paid fines and other months are untouched.
 * Run via `npm run test:postgres`; see test/POSTGRES-TESTS.md.
 */
describe('PostgreSQL attendance fine generation', () => {
  const context = new RequestContextService();
  let prisma: PrismaService;
  let service: StudentFineGenerationService;
  let institutionId: string;
  let campusId: string;
  let classId: string;
  let sectionId: string;
  let ayeshaId: string;
  let bilalId: string;
  let ayeshaUserId: string;
  let bilalUserId: string;

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
        status: 'ACTIVE',
      },
    });
    return { studentId: student.id, userId: user.id };
  };

  const mark = (
    userId: string,
    day: number,
    status: 'ABSENT' | 'LATE' | 'LEAVE' | 'PRESENT',
    options: { halfDay?: boolean; month?: number } = {},
  ) =>
    prisma.attendance.create({
      data: {
        userId,
        role: 'STUDENT',
        campusId,
        date: new Date(Date.UTC(2026, (options.month ?? 9) - 1, day)),
        status,
        halfDay: options.halfDay ?? false,
      },
    });

  const fineOf = (studentId: string, month = 9) =>
    prisma.studentFine.findFirst({
      where: { studentId, campusId, month, year: 2026 },
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
    service = new StudentFineGenerationService(
      prisma,
      new ModuleAccessService(prisma),
      new CampusAccessService(prisma),
      new AuditLogService(prisma),
    );

    institutionId = (
      await prisma.institution.create({
        data: { name: 'Fine generation test', slug: randomUUID() },
      })
    ).id;
    await prisma.user.create({
      data: {
        id: superadmin.sub,
        name: 'Fine test superadmin',
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
          name: 'Fine campus',
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
      data: { name: 'Fine level', campusId },
    });
    classId = (
      await prisma.academicClass.create({
        data: { name: 'Fine class', levelId: level.id },
      })
    ).id;
    sectionId = (await prisma.section.create({ data: { name: 'A', classId } }))
      .id;
    await prisma.studentFineRule.create({
      data: {
        campusId,
        allowedAbsences: 2,
        absenceFineAmount: 100,
        allowedLates: 1,
        lateFineAmount: 25,
        allowedHalfDays: 0,
        halfDayFineAmount: 40,
        allowedLeaves: 5,
        leaveFineAmount: 10,
      },
    });

    ({ studentId: ayeshaId, userId: ayeshaUserId } = await newStudent(
      'Ayesha',
      'F-1',
    ));
    ({ studentId: bilalId, userId: bilalUserId } = await newStudent(
      'Bilal',
      'F-2',
    ));

    // Ayesha, September: 4 absent, 3 late, 1 half day, 2 leave (inside 5),
    // plus an August absence that must not count.
    for (const day of [1, 2, 3, 4]) await mark(ayeshaUserId, day, 'ABSENT');
    for (const day of [5, 8, 9]) await mark(ayeshaUserId, day, 'LATE');
    await mark(ayeshaUserId, 10, 'PRESENT', { halfDay: true });
    for (const day of [11, 12]) await mark(ayeshaUserId, day, 'LEAVE');
    await mark(ayeshaUserId, 20, 'ABSENT', { month: 8 });
    // Bilal stays within every allowance.
    for (const day of [1, 2]) await mark(bilalUserId, day, 'ABSENT');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('previews without saving anything', async () => {
    const { data } = await service.generate(superadmin, {
      campusId,
      month: 9,
      year: 2026,
      preview: true,
    });

    expect(data.totals.fined).toBe(1);
    expect(await fineOf(ayeshaId)).toBeNull();
  });

  it('charges only the marks beyond the allowance and counts only that month', async () => {
    const { data } = await service.generate(superadmin, {
      campusId,
      month: 9,
      year: 2026,
    });

    // 2 absences over (200) + 2 lates over (50) + 1 half day (40) + leaves within.
    const fine = await fineOf(ayeshaId);
    expect(Number(fine?.totalFineAmount)).toBe(290);
    expect(fine).toMatchObject({
      absentCount: 4,
      lateCount: 3,
      halfDayCount: 1,
      leaveCount: 2,
      fineStatus: 'PENDING',
    });
    expect(data.totals).toMatchObject({ fined: 1, totalAmount: '290.00' });
    expect(data.unchanged.map((row) => row.name)).toEqual(['Bilal']);
    expect(await fineOf(bilalId)).toBeNull();
  });

  it('refreshes its own fine when the attendance changes, without duplicating it', async () => {
    await mark(ayeshaUserId, 15, 'ABSENT');

    await service.generate(superadmin, { campusId, month: 9, year: 2026 });

    expect(
      await prisma.studentFine.count({
        where: { studentId: ayeshaId, month: 9, year: 2026 },
      }),
    ).toBe(1);
    // A fifth absence adds one more 100.
    expect(Number((await fineOf(ayeshaId))?.totalFineAmount)).toBe(390);
  });

  it('leaves a fine entered by hand alone', async () => {
    await prisma.studentFine.create({
      data: {
        studentId: bilalId,
        campusId,
        month: 9,
        year: 2026,
        totalFineAmount: 75,
        fineReason: 'Damaged a desk',
      },
    });
    await mark(bilalUserId, 3, 'ABSENT');
    await mark(bilalUserId, 4, 'ABSENT');

    const { data } = await service.generate(superadmin, {
      campusId,
      month: 9,
      year: 2026,
    });

    const manual = await fineOf(bilalId);
    expect(Number(manual?.totalFineAmount)).toBe(75);
    expect(manual?.fineReason).toBe('Damaged a desk');
    expect(data.unchanged.find((row) => row.name === 'Bilal')?.reason).toMatch(
      /entered by hand/,
    );
  });

  it('does not touch a paid fine or a month whose voucher was issued', async () => {
    await prisma.studentFine.update({
      where: { id: (await fineOf(ayeshaId))?.id as string },
      data: { fineStatus: 'PAID' },
    });
    await mark(ayeshaUserId, 16, 'ABSENT');

    const paid = await service.generate(superadmin, {
      campusId,
      month: 9,
      year: 2026,
    });

    expect(Number((await fineOf(ayeshaId))?.totalFineAmount)).toBe(390);
    expect(
      paid.data.unchanged.find((row) => row.name === 'Ayesha')?.reason,
    ).toBe('This fine is already paid.');

    // October: the voucher exists, so a fine could no longer reach it.
    for (const day of [1, 2, 3, 4]) {
      await mark(bilalUserId, day, 'ABSENT', { month: 10 });
    }
    const structure = await prisma.feeStructure.create({
      data: { classId, campusId, feeBreakdown: { tuition: 1000 } },
    });
    await prisma.feeVoucher.create({
      data: {
        studentId: bilalId,
        feeStructureId: structure.id,
        month: 10,
        year: 2026,
        finalAmountDue: 1000,
        dueDate: new Date('2026-10-10'),
        feeBreakdown: { tuition: 1000 },
      },
    });
    const october = await service.generate(superadmin, {
      campusId,
      month: 10,
      year: 2026,
    });

    expect(await fineOf(bilalId, 10)).toBeNull();
    expect(
      october.data.unchanged.find((row) => row.name === 'Bilal')?.reason,
    ).toBe('The voucher for this month was already issued.');
  });

  it('ignores period-by-period rows, which are about periods and not days', async () => {
    await prisma.attendance.create({
      data: {
        userId: ayeshaUserId,
        role: 'STUDENT',
        campusId,
        date: new Date(Date.UTC(2026, 10, 2)),
        status: 'ABSENT',
        periodKey: 'PERIOD:test-period',
      },
    });

    const { data } = await service.generate(superadmin, {
      campusId,
      month: 11,
      year: 2026,
    });

    expect(data.totals.fined).toBe(0);
  });

  it('lets the scheduler calculate a month with no user, and records it as automatic', async () => {
    await mark(ayeshaUserId, 3, 'ABSENT', { month: 12 });
    await mark(ayeshaUserId, 4, 'ABSENT', { month: 12 });
    await mark(ayeshaUserId, 5, 'ABSENT', { month: 12 });

    const { data } = await service.generateAutomatically({
      campusId,
      month: 12,
      year: 2026,
    });

    expect(data.totals.fined).toBe(1);
    const fine = await fineOf(ayeshaId, 12);
    expect(Number(fine?.totalFineAmount)).toBe(100);
    expect(fine?.createdBy).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: {
        institutionId,
        action: 'STUDENT_FINES_GENERATED',
        metadata: { path: ['automatic'], equals: true },
      },
    });
    expect(audit?.userId).toBeNull();
  });

  it('records one summary audit entry per real run', async () => {
    const audit = await prisma.auditLog.findMany({
      where: { institutionId, action: 'STUDENT_FINES_GENERATED' },
    });

    expect(audit.length).toBeGreaterThanOrEqual(4);
  });
});
