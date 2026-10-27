import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { CampusAccessService } from '../src/common/services/campus-access.service';
import { CurrentUser } from '../src/common/interfaces/current-user.interface';
import { EntityCustomFieldsService } from '../src/common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../src/common/services/module-access.service';
import { RequestContextService } from '../src/common/services/request-context.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { PeopleService } from '../src/modules/people/people.service';
import { StudentIdCardsService } from '../src/modules/people/student-id-cards.service';
import { StudentImportService } from '../src/modules/people/student-import.service';
import { PrintableCustomValuesService } from '../src/common/services/printable-custom-values.service';
import { PrintableMetaService } from '../src/common/services/printable-meta.service';
import { UserRole } from '../src/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Real-database proof for importing students from a spreadsheet: each line
 * becomes an account, a student with a registration number, an enrollment in
 * the current year, and a guardian who can sign in by phone, with brothers and
 * sisters sharing one guardian. Run via `npm run test:postgres`.
 */
describe('PostgreSQL student import', () => {
  // A phone number is unique across the whole database, so each run uses its own.
  const tail = String(Math.floor(1_000_000 + Math.random() * 8_999_999));
  const phone = `0300${tail}`;
  const phoneWithCountryCode = `+92 300 ${tail}`;
  const context = new RequestContextService();
  let prisma: PrismaService;
  let service: StudentImportService;
  let idCards: StudentIdCardsService;
  let institutionId: string;
  let campusId: string;
  let admin: CurrentUser;

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
    const fields = new EntityCustomFieldsService(prisma, context);
    const people = new PeopleService(
      prisma,
      campusAccess,
      fields,
      allowModule,
      context,
    );
    const auth = new AuthService(prisma, new JwtService({}), {
      get: () => undefined,
      getOrThrow: () => 'x',
    } as unknown as ConfigService);
    service = new StudentImportService(
      prisma,
      allowModule,
      campusAccess,
      fields,
      people,
      auth,
    );

    idCards = new StudentIdCardsService(
      prisma,
      allowModule,
      campusAccess,
      fields,
      new PrintableCustomValuesService(prisma),
      new PrintableMetaService(prisma),
    );

    institutionId = (
      await prisma.institution.create({
        data: { name: 'Import test', slug: randomUUID() },
      })
    ).id;
    const year = await prisma.academicYear.create({
      data: {
        institutionId,
        name: '2026-27',
        startDate: new Date('2026-04-01'),
        endDate: new Date('2027-03-31'),
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
          name: 'Import campus',
          // Registration numbers are also sign-in names, which are unique across every school,
          // so each run gets its own prefix.
          code: `T${tail}`,
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
      data: { name: 'Primary', campusId },
    });
    const grade5 = await prisma.academicClass.create({
      data: { name: 'Grade 5', levelId: level.id },
    });
    await prisma.section.create({ data: { name: 'A', classId: grade5.id } });
    const adminAccount = await prisma.user.create({
      data: {
        institutionId,
        name: 'Import admin',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'ADMIN',
      },
    });
    admin = {
      sub: adminAccount.id,
      email: adminAccount.email,
      role: UserRole.ADMIN,
      institutionId,
    };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const lines = [
    {
      name: 'Ayesha Khan',
      dob: '12/06/2016',
      gender: 'Female',
      className: 'Grade 5',
      sectionName: 'A',
      guardianName: 'Mr Khan',
      guardianPhone: `0300-${tail}`,
      guardianRelation: 'Father',
    },
    {
      name: 'Bilal Khan',
      dob: '03/02/2014',
      gender: 'M',
      className: 'grade 5',
      guardianName: 'Mr Khan',
      guardianPhone: `0300 ${tail}`,
      guardianRelation: 'father',
    },
    {
      name: 'Cyrus Ali',
      dob: '2015-09-30',
      gender: 'male',
      className: 'Grade 5',
      regNo: `IMP-${tail}`,
      email: `Cyrus.${tail}@Home.TEST`,
    },
  ];

  it('checks the file without writing anything', async () => {
    const result = await service.preview(admin, { campusId, rows: lines });

    expect(result.data.summary).toEqual({
      total: 3,
      valid: 3,
      invalid: 0,
      newGuardians: 1,
      existingGuardians: 0,
    });
    expect(await prisma.student.count({ where: { institutionId } })).toBe(0);
    expect(
      await prisma.user.count({ where: { institutionId, role: 'STUDENT' } }),
    ).toBe(0);
  });

  it('imports each line as a student with a way to sign in, and siblings share one guardian', async () => {
    const result = await service.commit(admin, { campusId, rows: lines });

    expect(result.data.results.map((r) => r.status)).toEqual([
      'IMPORTED',
      'IMPORTED',
      'IMPORTED',
    ]);
    const [ayesha, bilal, cyrus] = result.data.results;
    expect(cyrus.regNo).toBe(`IMP-${tail}`);
    expect(ayesha.regNo).toBeTruthy();
    expect(ayesha.regNo).not.toBe(bilal.regNo);

    const students = await prisma.student.findMany({
      where: { institutionId },
      include: { user: true },
    });
    expect(students).toHaveLength(3);
    const ayeshaRecord = students.find((s) => s.user.name === 'Ayesha Khan');
    expect(ayeshaRecord?.dob.toISOString().slice(0, 10)).toBe('2016-06-12');
    // She signs in with her registration number and the first password given.
    expect(ayeshaRecord?.user.identifier).toBe(ayesha.regNo);
    expect(
      await bcrypt.compare(
        ayesha.studentPassword as string,
        ayeshaRecord?.user.passwordHash as string,
      ),
    ).toBe(true);
    expect(ayeshaRecord?.user.mustChangePassword).toBe(true);
    expect(students.find((s) => s.user.name === 'Cyrus Ali')?.user.email).toBe(
      `cyrus.${tail}@home.test`,
    );

    const enrollments = await prisma.studentEnrollment.findMany({
      where: { campusId },
      include: { class: true, section: true },
    });
    expect(enrollments).toHaveLength(3);
    expect(enrollments.every((e) => e.class.name === 'Grade 5')).toBe(true);
    expect(enrollments.filter((e) => e.section?.name === 'A')).toHaveLength(1);

    // One guardian, who signs in by phone, linked to both children.
    const guardians = await prisma.guardian.findMany({
      where: { campusId },
      include: { user: true, students: true },
    });
    expect(guardians).toHaveLength(1);
    expect(guardians[0].user.identifier).toBe(phone);
    expect(guardians[0].relation).toBe('FATHER');
    expect(guardians[0].students).toHaveLength(2);
    expect(ayesha.guardianPassword).toBeTruthy();
    expect(bilal.guardianPassword).toBeNull();
    expect(
      await bcrypt.compare(
        ayesha.guardianPassword as string,
        guardians[0].user.passwordHash,
      ),
    ).toBe(true);
  });

  it('prints ID cards for the imported students, with the guardian number and the end of the year', async () => {
    const result = await idCards.getCards(admin, { campusId });

    const cards = result.data.cards;
    expect(cards.map((card) => card.name)).toEqual([
      'Ayesha Khan',
      'Bilal Khan',
      'Cyrus Ali',
    ]);
    expect(cards[0]).toMatchObject({
      className: 'Grade 5',
      sectionName: 'A',
      dob: '2016-06-12',
      validUntil: '2027-03-31',
      guardianPhone: phone,
      customValues: [],
    });
    expect(cards[2].guardianPhone).toBeNull();
    expect(result.data.printMeta.documentType).toBe('ID_CARD');

    const one = await idCards.getCards(admin, {
      campusId,
      studentId: cards[1].studentId,
    });
    expect(one.data.cards.map((card) => card.name)).toEqual(['Bilal Khan']);
  });

  it('refuses a second import of the same people, line by line, and changes nothing', async () => {
    const result = await service.commit(admin, {
      campusId,
      rows: lines.slice(2),
    });

    expect(result.data.results[0]).toMatchObject({
      status: 'FAILED',
      error: `Registration number IMP-${tail} already belongs to a student.`,
    });
    expect(await prisma.student.count({ where: { institutionId } })).toBe(3);
  });

  it('imports the good lines of a file and reports the bad ones, with line numbers', async () => {
    const result = await service.commit(admin, {
      campusId,
      rowOffset: 20,
      rows: [
        {
          name: 'Dina Shah',
          dob: '01/01/2015',
          gender: 'f',
          className: 'Grade 5',
        },
        { name: 'Eman', dob: '31/02/2015', gender: 'f', className: 'Grade 5' },
        {
          name: 'Farid',
          dob: '01/01/2015',
          gender: 'm',
          className: 'Grade 12',
        },
      ],
    });

    expect(result.data.results.map((r) => [r.line, r.status])).toEqual([
      [22, 'IMPORTED'],
      [23, 'FAILED'],
      [24, 'FAILED'],
    ]);
    expect(result.data.results[1].error).toContain('not a real date');
    expect(result.data.results[2].error).toContain(
      'no class called "Grade 12"',
    );
    expect(await prisma.student.count({ where: { institutionId } })).toBe(4);
  });

  it('links a later student to a guardian who is already in the school, however the number is written', async () => {
    const written = [phoneWithCountryCode, phone];
    const results = await Promise.all(
      written.map((phone, index) =>
        service.commit(admin, {
          campusId,
          rows: [
            {
              name: `Later child ${index}`,
              dob: '01/01/2012',
              gender: 'f',
              className: 'Grade 5',
              guardianName: 'Mr Khan',
              guardianPhone: phone,
            },
          ],
        }),
      ),
    );

    for (const result of results) {
      expect(result.data.results[0]).toMatchObject({
        status: 'IMPORTED',
        guardianPassword: null,
      });
    }
    const guardians = await prisma.guardian.findMany({
      where: { campusId },
      include: { students: true },
    });
    expect(guardians).toHaveLength(1);
    expect(guardians[0].students).toHaveLength(4);
  });

  it('gives a student of another school a different registration number when the first school already holds it, since sign-in names are shared by every school', async () => {
    const otherInstitution = (
      await prisma.institution.create({
        data: { name: 'Second school', slug: randomUUID() },
      })
    ).id;
    const otherYear = await prisma.academicYear.create({
      data: {
        institutionId: otherInstitution,
        name: '2026-27',
        startDate: new Date('2026-04-01'),
        endDate: new Date('2027-03-31'),
      },
    });
    await prisma.institution.update({
      where: { id: otherInstitution },
      data: { currentAcademicYearId: otherYear.id },
    });
    // The same campus code as the first school, so the same pattern gives the same numbers.
    const otherCampus = await prisma.campus.create({
      data: {
        institutionId: otherInstitution,
        name: 'Second campus',
        code: `T${tail}`,
        location: 'Test',
        studentStartTime: '08:00',
        studentEndTime: '14:00',
        staffStartTime: '08:00',
        staffEndTime: '14:00',
        lateThreshold: 10,
        earlyLeaveThreshold: 10,
      },
    });
    const otherLevel = await prisma.level.create({
      data: { name: 'Primary', campusId: otherCampus.id },
    });
    await prisma.academicClass.create({
      data: { name: 'Grade 5', levelId: otherLevel.id },
    });
    const otherAdmin = await prisma.user.create({
      data: {
        institutionId: otherInstitution,
        name: 'Second admin',
        email: `${randomUUID()}@example.test`,
        passwordHash: 'unused-test-value',
        role: 'ADMIN',
      },
    });

    const result = await service.commit(
      {
        sub: otherAdmin.id,
        email: otherAdmin.email,
        role: UserRole.ADMIN,
        institutionId: otherInstitution,
      },
      {
        campusId: otherCampus.id,
        rows: [
          {
            name: 'Zain',
            dob: '01/01/2015',
            gender: 'm',
            className: 'Grade 5',
          },
        ],
      },
    );

    expect(result.data.results[0].status).toBe('IMPORTED');
    const firstSchoolNumbers = (
      await prisma.student.findMany({ where: { institutionId } })
    ).map((student) => student.regNo);
    expect(firstSchoolNumbers).not.toContain(result.data.results[0].regNo);
  });

  it('refuses everyone who is not allowed in the campus', async () => {
    const outsider: CurrentUser = {
      sub: randomUUID(),
      email: 'x@x.test',
      role: UserRole.ADMIN,
      institutionId: randomUUID(),
    };

    await expect(
      service.preview(outsider, { campusId, rows: lines }),
    ).rejects.toThrow('You do not have access to this campus.');
  });
});
