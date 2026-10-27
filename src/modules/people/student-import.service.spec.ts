/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- jest mock calls and asymmetric matchers are typed any */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { PeopleService } from './people.service';
import { StudentImportService } from './student-import.service';
import { ImportRow } from './student-import.util';

describe('StudentImportService', () => {
  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'a@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const prismaMock = {
    institution: { findUnique: jest.fn() },
    academicClass: { findMany: jest.fn() },
    student: { findMany: jest.fn() },
    contact: { findMany: jest.fn(), findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const moduleAccess = { assertModuleEnabledForUser: jest.fn() };
  const campusAccess = { assertCampusAccess: jest.fn() };
  const customFields = { resolveInstitutionIdByCampus: jest.fn() };
  const people = {
    createStudent: jest.fn(),
    createGuardian: jest.fn(),
    createContact: jest.fn(),
    linkGuardian: jest.fn(),
  };
  const auth = { register: jest.fn() };
  const service = new StudentImportService(
    prismaMock as unknown as PrismaService,
    moduleAccess as unknown as ModuleAccessService,
    campusAccess as unknown as CampusAccessService,
    customFields as unknown as EntityCustomFieldsService,
    people as unknown as PeopleService,
    auth as unknown as AuthService,
  );

  const good: ImportRow = {
    name: 'Ayesha Khan',
    dob: '12/06/2016',
    gender: 'Female',
    className: 'Grade 5',
    sectionName: 'A',
  };
  const preview = (...rows: ImportRow[]) =>
    service.preview(admin, { campusId: 'campus-1', rows });
  const only = async (row: ImportRow) => (await preview(row)).data.rows[0];

  beforeEach(() => {
    jest.resetAllMocks();
    moduleAccess.assertModuleEnabledForUser.mockResolvedValue(undefined);
    campusAccess.assertCampusAccess.mockResolvedValue(undefined);
    customFields.resolveInstitutionIdByCampus.mockResolvedValue('inst-1');
    prismaMock.institution.findUnique.mockResolvedValue({
      currentAcademicYearId: 'year-1',
    });
    prismaMock.academicClass.findMany.mockResolvedValue([
      {
        id: 'class-5',
        name: 'Grade 5',
        sections: [
          { id: 'sec-a', name: 'A' },
          { id: 'sec-b', name: 'B' },
        ],
      },
      { id: 'class-6', name: 'Grade 6', sections: [] },
    ]);
    prismaMock.student.findMany.mockResolvedValue([]);
    prismaMock.contact.findMany.mockResolvedValue([]);
    prismaMock.auditLog.create.mockResolvedValue({});
  });

  describe('preview', () => {
    it('reads a good line into the class and section it names, ignoring case and spacing, and counts it', async () => {
      const result = await preview({
        ...good,
        className: '  grade  5 ',
        sectionName: 'a',
      });

      expect(result.data.rows[0].errors).toEqual([]);
      expect(result.data.rows[0].student).toMatchObject({
        classId: 'class-5',
        sectionId: 'sec-a',
        dob: '2016-06-12',
        gender: 'FEMALE',
        regNo: null,
      });
      expect(result.data.summary).toEqual({
        total: 1,
        valid: 1,
        invalid: 0,
        newGuardians: 0,
        existingGuardians: 0,
      });
      expect(result.data.rows[0].line).toBe(2);
    });

    it('checks the module and the campus, and refuses when no academic year is current', async () => {
      await preview(good);
      expect(moduleAccess.assertModuleEnabledForUser).toHaveBeenCalled();
      expect(campusAccess.assertCampusAccess).toHaveBeenCalledWith(
        admin,
        'campus-1',
      );

      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: null,
      });
      await expect(preview(good)).rejects.toBeInstanceOf(ConflictException);

      campusAccess.assertCampusAccess.mockRejectedValue(
        new ForbiddenException('no'),
      );
      await expect(preview(good)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each<[string, Partial<ImportRow>, string]>([
      ['a missing name', { name: ' ' }, 'Name is missing.'],
      ['a missing date of birth', { dob: '' }, 'Date of birth is missing.'],
      [
        'an unreal date of birth',
        { dob: '31/04/2016' },
        'Date of birth "31/04/2016" is not a real date.',
      ],
      [
        'a date of birth in the future',
        { dob: '2099-01-01' },
        'Date of birth is in the future.',
      ],
      ['an age that cannot be right', { dob: '1950-01-01' }, 'looks wrong'],
      ['a missing gender', { gender: '' }, 'Gender is missing.'],
      [
        'an unknown gender',
        { gender: 'x' },
        'Gender "x" is not male, female or other.',
      ],
      ['a missing class', { className: '' }, 'Class is missing.'],
      [
        'an unknown class',
        { className: 'Grade 9' },
        'There is no class called "Grade 9" at this campus.',
      ],
      [
        'a section the class lacks',
        { sectionName: 'Z' },
        'Class "Grade 5" has no section called "Z".',
      ],
      [
        'an unreal admission date',
        { admissionDate: '99/99/2020' },
        'Admission date "99/99/2020" is not a real date.',
      ],
      [
        'admission before birth',
        { admissionDate: '2010-01-01' },
        'Admission date is before the date of birth.',
      ],
      [
        'an unknown religion',
        { religion: 'Sikh' },
        'Religion "Sikh" is not recognised.',
      ],
      [
        'a bad email',
        { email: 'not-an-email' },
        'Email "not-an-email" is not a valid address.',
      ],
      [
        'a bad guardian phone',
        { guardianName: 'Dad', guardianPhone: '123' },
        'Guardian phone "123" is not a valid number.',
      ],
      [
        'a guardian with no phone',
        { guardianName: 'Dad' },
        'Guardian phone is missing',
      ],
      [
        'a guardian with no name',
        { guardianPhone: '0300 1234567' },
        'Guardian name is missing.',
      ],
      [
        'an unknown relation',
        {
          guardianName: 'Dad',
          guardianPhone: '03001234567',
          guardianRelation: 'neighbour',
        },
        'Guardian relation "neighbour"',
      ],
    ])('reports %s', async (_label, change, message) => {
      const row = await only({ ...good, ...change });

      expect(row.errors.join(' ')).toContain(message);
      expect(row.student).toBeNull();
    });

    it('reports a class name used twice at the campus rather than guessing', async () => {
      prismaMock.academicClass.findMany.mockResolvedValue([
        { id: 'a', name: 'Grade 5', sections: [] },
        { id: 'b', name: 'Grade 5', sections: [] },
      ]);

      const row = await only(good);

      expect(row.errors.join(' ')).toContain(
        'More than one class at this campus is called "Grade 5".',
      );
    });

    it('reports registration numbers used twice in the file or already given to a student', async () => {
      prismaMock.student.findMany
        .mockResolvedValueOnce([{ regNo: 'R-9' }])
        .mockResolvedValueOnce([]);

      const rows = (
        await preview(
          { ...good, regNo: 'R-1' },
          { ...good, name: 'Bilal', regNo: 'R-1' },
          { ...good, name: 'Cyrus', regNo: 'R-9' },
        )
      ).data.rows;

      expect(rows[0].errors).toEqual([]);
      expect(rows[1].errors).toEqual([
        'Registration number R-1 is already used on line 2 of this file.',
      ]);
      expect(rows[2].errors).toEqual([
        'Registration number R-9 already belongs to a student.',
      ]);
    });

    it('defaults the admission date to today and keeps a given one', async () => {
      const today = new Date().toISOString().slice(0, 10);

      expect((await only(good)).student?.admissionDate).toBe(today);
      expect(
        (await only({ ...good, admissionDate: '1/4/2026' })).student
          ?.admissionDate,
      ).toBe('2026-04-01');
    });

    it('plans a new guardian, or reuses the one who already has that phone number', async () => {
      prismaMock.contact.findMany.mockResolvedValue([
        {
          phone1: '03009999999',
          guardianId: 'g-1',
          guardian: {
            user: { name: 'Mr Existing' },
            campus: { institutionId: 'inst-1' },
          },
        },
      ]);

      const rows = (
        await preview(
          {
            ...good,
            guardianName: 'Mr Khan',
            guardianPhone: '0300-1234567',
            guardianRelation: 'father',
          },
          {
            ...good,
            name: 'Bilal',
            guardianName: 'whoever',
            guardianPhone: '0300 9999999',
          },
        )
      ).data;

      expect(rows.rows[0].guardian).toEqual({
        mode: 'NEW',
        name: 'Mr Khan',
        phone: '03001234567',
        relation: 'FATHER',
      });
      expect(rows.rows[1].guardian).toEqual({
        mode: 'EXISTING',
        guardianId: 'g-1',
        name: 'Mr Existing',
        phone: '03009999999',
      });
      expect(rows.summary).toMatchObject({
        newGuardians: 1,
        existingGuardians: 1,
      });
    });

    it('lets brothers and sisters in one file share a guardian, counting that guardian once', async () => {
      const result = await preview(
        { ...good, guardianName: 'Mr Khan', guardianPhone: '03001234567' },
        {
          ...good,
          name: 'Bilal',
          guardianName: 'Mr Khan',
          guardianPhone: '0300 1234567',
        },
      );

      expect(result.data.rows[0].guardian).toMatchObject({ mode: 'NEW' });
      expect(result.data.rows[0].guardian).not.toHaveProperty('sharedWithLine');
      expect(result.data.rows[1].guardian).toMatchObject({
        mode: 'NEW',
        sharedWithLine: 2,
      });
      expect(result.data.summary.newGuardians).toBe(1);
    });

    it('refuses a guardian phone number that already belongs to someone at another institution', async () => {
      prismaMock.contact.findMany.mockResolvedValue([
        {
          phone1: '03001234567',
          guardianId: 'g-9',
          guardian: {
            user: { name: 'Mr Elsewhere' },
            campus: { institutionId: 'inst-other' },
          },
        },
      ]);

      const row = await only({
        ...good,
        guardianName: 'Mr Khan',
        guardianPhone: '03001234567',
      });

      expect(row.errors).toEqual([
        'Guardian phone 03001234567 is already registered to someone at another institution.',
      ]);
      expect(row.guardian).toEqual({ mode: 'NONE' });
    });

    it('warns, without refusing, about a student who may already be there and a phone shared by different names', async () => {
      // No registration numbers are given, so the only student query is for birthdays.
      prismaMock.student.findMany.mockResolvedValueOnce([
        {
          dob: new Date('2016-06-12T00:00:00.000Z'),
          user: { name: 'ayesha  khan' },
        },
      ]);

      const rows = (
        await preview(
          { ...good, guardianName: 'Mr Khan', guardianPhone: '03001234567' },
          {
            ...good,
            name: 'Bilal',
            guardianName: 'Mr Ali',
            guardianPhone: '0300 1234567',
          },
          { ...good, name: 'Bilal' },
        )
      ).data.rows;

      expect(rows[0].errors).toEqual([]);
      expect(rows[0].warnings).toEqual([
        'A student with this name and date of birth is already at this campus.',
      ]);
      expect(rows[1].warnings.join(' ')).toContain('also given for Mr Khan');
      expect(rows[2].warnings.join(' ')).toContain(
        'Same name and date of birth as line 3 of this file',
      );
    });

    it('numbers lines from 2, as a spreadsheet does with its heading as line 1', async () => {
      const rows = (await preview(good, { ...good, name: '' })).data.rows;

      expect(rows.map((row) => row.line)).toEqual([2, 3]);
      expect(rows[1].errors).toContain('Name is missing.');
    });
  });

  describe('commit', () => {
    const accountFor = (id: string) => ({ data: { id } });

    beforeEach(() => {
      auth.register.mockImplementation((dto: { name: string }) =>
        Promise.resolve(accountFor(`user-${dto.name}`)),
      );
      people.createStudent.mockResolvedValue({
        data: { id: 'student-1', regNo: '2026-0001' },
      });
    });

    const commit = (
      rows: ImportRow[],
      user: CurrentUser = admin,
      rowOffset?: number,
    ) => service.commit(user, { campusId: 'campus-1', rows, rowOffset });

    it('makes the account with a first password, then admits the student with what the line said', async () => {
      const result = await commit([good]);

      const accountArgs = auth.register.mock.calls[0];
      expect(accountArgs[0]).toMatchObject({
        name: 'Ayesha Khan',
        role: 'STUDENT',
      });
      expect(accountArgs[0].email).toMatch(/@import\.nexus\.invalid$/);
      expect(accountArgs[0].password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{10}$/);
      expect(accountArgs[0]).not.toHaveProperty('institutionId');
      expect(accountArgs[1]).toBe(admin);
      expect(people.createStudent).toHaveBeenCalledWith(
        admin,
        expect.objectContaining({
          userId: 'user-Ayesha Khan',
          dob: '2016-06-12',
          gender: 'FEMALE',
          classId: 'class-5',
          sectionId: 'sec-a',
          campusId: 'campus-1',
          regNo: undefined,
        }),
      );
      expect(result.data.results).toEqual([
        {
          line: 2,
          name: 'Ayesha Khan',
          status: 'IMPORTED',
          regNo: '2026-0001',
          studentPassword: accountArgs[0].password,
          guardianPhone: null,
          guardianPassword: null,
          error: null,
        },
      ]);
      expect(result.message).toBe('1 of 1 students imported');
    });

    it('uses the email the line gives, and the registration number it gives', async () => {
      await commit([{ ...good, email: 'Ayesha@Home.test', regNo: 'R-7' }]);

      expect(auth.register.mock.calls[0][0].email).toBe('ayesha@home.test');
      expect(people.createStudent.mock.calls[0][1].regNo).toBe('R-7');
    });

    it('creates a guardian with a first password and links them, once per new phone number', async () => {
      people.createGuardian.mockResolvedValue({ data: { id: 'guardian-1' } });
      people.createContact.mockResolvedValue({});
      people.linkGuardian.mockResolvedValue({});

      const result = await commit([
        {
          ...good,
          guardianName: 'Mr Khan',
          guardianPhone: '0300-1234567',
          guardianRelation: 'father',
        },
      ]);

      expect(auth.register.mock.calls[1][0]).toMatchObject({
        name: 'Mr Khan',
        role: 'GUARDIAN',
      });
      expect(people.createGuardian).toHaveBeenCalledWith(admin, {
        userId: 'user-Mr Khan',
        relation: 'FATHER',
        campusId: 'campus-1',
      });
      expect(people.createContact).toHaveBeenCalledWith(admin, {
        personId: 'guardian-1',
        personType: 'GUARDIAN',
        phone1: '03001234567',
      });
      expect(people.linkGuardian).toHaveBeenCalledWith(admin, {
        studentId: 'student-1',
        guardianId: 'guardian-1',
      });
      expect(result.data.results[0]).toMatchObject({
        status: 'IMPORTED',
        guardianPhone: '03001234567',
        guardianPassword: auth.register.mock.calls[1][0].password,
      });
    });

    it('links a guardian who already exists without making an account or a password', async () => {
      prismaMock.contact.findMany.mockResolvedValue([
        {
          phone1: '03001234567',
          guardianId: 'g-1',
          guardian: {
            user: { name: 'Mr Khan' },
            campus: { institutionId: 'inst-1' },
          },
        },
      ]);
      people.linkGuardian.mockResolvedValue({});

      const result = await commit([
        { ...good, guardianName: 'Mr Khan', guardianPhone: '03001234567' },
      ]);

      expect(auth.register).toHaveBeenCalledTimes(1);
      expect(people.createGuardian).not.toHaveBeenCalled();
      expect(people.linkGuardian).toHaveBeenCalledWith(admin, {
        studentId: 'student-1',
        guardianId: 'g-1',
      });
      expect(result.data.results[0]).toMatchObject({
        status: 'IMPORTED',
        guardianPassword: null,
      });
    });

    it('links the second of two siblings to the guardian the first line just created', async () => {
      people.createGuardian.mockResolvedValue({ data: { id: 'guardian-1' } });
      people.createContact.mockResolvedValue({});
      people.linkGuardian.mockResolvedValue({});
      prismaMock.contact.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ guardianId: 'guardian-1' });

      const result = await commit([
        { ...good, guardianName: 'Mr Khan', guardianPhone: '03001234567' },
        {
          ...good,
          name: 'Bilal',
          guardianName: 'Mr Khan',
          guardianPhone: '03001234567',
        },
      ]);

      expect(people.createGuardian).toHaveBeenCalledTimes(1);
      expect(people.linkGuardian).toHaveBeenCalledTimes(2);
      expect(people.linkGuardian).toHaveBeenLastCalledWith(admin, {
        studentId: 'student-1',
        guardianId: 'guardian-1',
      });
      expect(result.data.results[0].guardianPassword).not.toBeNull();
      expect(result.data.results[1]).toMatchObject({
        status: 'IMPORTED',
        guardianPassword: null,
      });
    });

    it('skips a line with a problem without touching anything, and saves the rest', async () => {
      const result = await commit(
        [
          { ...good, name: '' },
          { ...good, name: 'Bilal' },
        ],
        admin,
        10,
      );

      expect(result.data.results.map((r) => [r.line, r.status])).toEqual([
        [12, 'FAILED'],
        [13, 'IMPORTED'],
      ]);
      expect(result.data.results[0].error).toBe('Name is missing.');
      expect(auth.register).toHaveBeenCalledTimes(1);
      expect(result.message).toBe('1 of 2 students imported');
    });

    it('reports the real reason when the account or the admission is refused', async () => {
      auth.register.mockRejectedValueOnce(
        new ConflictException('That email is already in use.'),
      );
      people.createStudent.mockRejectedValueOnce(
        new ConflictException('Required field "Blood group" is missing.'),
      );

      const result = await commit([
        { ...good, email: 'taken@x.test' },
        { ...good, name: 'Bilal' },
      ]);

      expect(result.data.results[0]).toMatchObject({
        status: 'FAILED',
        error: 'That email is already in use.',
      });
      expect(result.data.results[1]).toMatchObject({
        status: 'FAILED',
        error: 'Required field "Blood group" is missing.',
      });
    });

    it('does not show an unexpected error, only that the line could not be imported', async () => {
      people.createStudent.mockRejectedValue(
        new Error('connection to server lost at 10.0.0.5'),
      );

      const result = await commit([good]);

      expect(result.data.results[0]).toMatchObject({
        status: 'FAILED',
        error: 'This line could not be imported.',
      });
    });

    it('keeps the student and says so when only the guardian failed', async () => {
      people.createGuardian.mockRejectedValue(
        new ConflictException('That phone number is in use.'),
      );

      const result = await commit([
        { ...good, guardianName: 'Mr Khan', guardianPhone: '03001234567' },
      ]);

      expect(result.data.results[0]).toMatchObject({
        status: 'IMPORTED_GUARDIAN_FAILED',
        regNo: '2026-0001',
        error:
          'The student was imported but the guardian was not: That phone number is in use.',
      });
      expect(result.message).toBe('1 of 1 students imported');
    });

    it('names the school when a superadmin imports, and never otherwise', async () => {
      await commit([good], {
        ...admin,
        role: UserRole.SUPERADMIN,
        institutionId: null,
      });

      expect(auth.register.mock.calls[0][0].institutionId).toBe('inst-1');
    });

    it('records the import in the audit trail with the counts', async () => {
      await commit([good, { ...good, name: '' }]);

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'admin-1',
          institutionId: 'inst-1',
          action: 'STUDENT_IMPORT',
          entity: 'Student',
          metadata: { campusId: 'campus-1', lines: 2, imported: 1, failed: 1 },
        },
      });
    });
  });
});
