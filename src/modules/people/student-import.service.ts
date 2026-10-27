import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { UserRole as DtoUserRole } from '../../common/enums/domain.enums';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { ModuleKey, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { ImportCommitDto, ImportPreviewDto } from './dto/student-import.dto';
import { PeopleService } from './people.service';
import {
  generatePassword,
  GuardianRelation,
  Gender,
  ImportRow,
  normalizeLabel,
  normalizePhone,
  parseGender,
  parseImportDate,
  parseReligion,
  parseRelation,
  placeholderEmail,
  Religion,
  yearsBetween,
} from './student-import.util';

const MIN_AGE_YEARS = 1.5;
const MAX_AGE_YEARS = 30;
const NO_YEAR =
  'Set an academic year as current before admitting students (Academics, Academic Years, then Set as current).';

/** What a guardian on a line turns into. */
export type GuardianPlan =
  | { mode: 'NONE' }
  | {
      mode: 'NEW';
      name: string;
      phone: string;
      relation: GuardianRelation;
      /** An earlier line of the same file already gives this phone number, so one guardian serves both. */
      sharedWithLine?: number;
    }
  | {
      mode: 'EXISTING';
      guardianId: string;
      name: string;
      phone: string;
    };

/** A line after it has been read and checked, ready to show or to save. */
export interface PreparedRow {
  /** The line in the file, counting the heading as line 1. */
  line: number;
  name: string;
  errors: string[];
  warnings: string[];
  student: {
    regNo: string | null;
    email: string | null;
    dob: string;
    gender: Gender;
    classId: string;
    className: string;
    sectionId: string | null;
    sectionName: string | null;
    admissionDate: string;
    religion: Religion | null;
    cnic: string | null;
    prevSchool: string | null;
  } | null;
  guardian: GuardianPlan;
}

export type ImportStatus = 'IMPORTED' | 'IMPORTED_GUARDIAN_FAILED' | 'FAILED';

export interface ImportResult {
  line: number;
  name: string;
  status: ImportStatus;
  regNo: string | null;
  /** The first password for the student; shown only now and never stored. */
  studentPassword: string | null;
  guardianPhone: string | null;
  /** The first password for a guardian created by this line; null for a guardian who already existed. */
  guardianPassword: string | null;
  error: string | null;
}

/**
 * Brings a school's students in from a spreadsheet: every line is checked
 * first (and nothing is written), then the good lines are saved a few at a
 * time. Each line goes through exactly the same steps as admitting a student
 * by hand, so the same rules, audit trail and custom fields apply.
 */
@Injectable()
export class StudentImportService {
  private readonly logger = new Logger(StudentImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccess: ModuleAccessService,
    private readonly campusAccess: CampusAccessService,
    private readonly customFields: EntityCustomFieldsService,
    private readonly people: PeopleService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Checks every line of a file and says what saving it would do. Writes nothing.
   *
   * @param {CurrentUser} currentUser - The administrator.
   * @param {ImportPreviewDto} dto - The campus and every line of the file.
   * @returns {Promise<{message: string, data: object}>} Each line with its problems, and the totals.
   */
  async preview(currentUser: CurrentUser, dto: ImportPreviewDto) {
    const rows = await this.prepare(currentUser, dto.campusId, dto.rows, 0);
    const valid = rows.filter((row) => row.errors.length === 0);
    return {
      message: 'Import checked successfully',
      data: {
        rows,
        summary: {
          total: rows.length,
          valid: valid.length,
          invalid: rows.length - valid.length,
          newGuardians: valid.filter(
            (row) =>
              row.guardian.mode === 'NEW' && !row.guardian.sharedWithLine,
          ).length,
          existingGuardians: valid.filter(
            (row) => row.guardian.mode === 'EXISTING',
          ).length,
        },
      },
    };
  }

  /**
   * Saves a few lines. Lines with a problem are skipped and reported, and the
   * rest are saved.
   *
   * @param {CurrentUser} currentUser - The administrator.
   * @param {ImportCommitDto} dto - The campus and the lines to save.
   * @returns {Promise<{message: string, data: {results: ImportResult[]}}>} What happened to each line, with the first passwords.
   */
  async commit(currentUser: CurrentUser, dto: ImportCommitDto) {
    const offset = dto.rowOffset ?? 0;
    const prepared = await this.prepare(
      currentUser,
      dto.campusId,
      dto.rows,
      offset,
    );
    const institutionId = await this.customFields.resolveInstitutionIdByCampus(
      dto.campusId,
    );

    const results: ImportResult[] = [];
    for (const row of prepared) {
      results.push(
        row.errors.length > 0 || !row.student
          ? {
              line: row.line,
              name: row.name,
              status: 'FAILED',
              regNo: null,
              studentPassword: null,
              guardianPhone: null,
              guardianPassword: null,
              error: row.errors.join(' '),
            }
          : await this.save(currentUser, dto.campusId, institutionId, row),
      );
    }

    const imported = results.filter((result) => result.status !== 'FAILED');
    await this.prisma.auditLog.create({
      data: {
        userId: currentUser.sub,
        institutionId,
        action: 'STUDENT_IMPORT',
        entity: 'Student',
        metadata: {
          campusId: dto.campusId,
          lines: results.length,
          imported: imported.length,
          failed: results.length - imported.length,
        },
      },
    });
    return {
      message: `${imported.length} of ${results.length} students imported`,
      data: { results },
    };
  }

  /** Reads and checks lines against the campus's classes and the people already in the school. */
  private async prepare(
    currentUser: CurrentUser,
    campusId: string,
    rows: ImportRow[],
    offset: number,
  ): Promise<PreparedRow[]> {
    await this.moduleAccess.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccess.assertCampusAccess(currentUser, campusId);
    const institutionId =
      await this.customFields.resolveInstitutionIdByCampus(campusId);
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { currentAcademicYearId: true },
    });
    if (!institution?.currentAcademicYearId)
      throw new ConflictException(NO_YEAR);

    const classes = await this.prisma.academicClass.findMany({
      where: { deletedAt: null, level: { campusId } },
      select: {
        id: true,
        name: true,
        sections: {
          where: { deletedAt: null },
          select: { id: true, name: true },
        },
      },
    });
    const regNos = rows.map((row) => (row.regNo ?? '').trim()).filter(Boolean);
    const phones = rows
      .map((row) => normalizePhone(row.guardianPhone))
      .filter((phone): phone is string => Boolean(phone));
    const dobs = rows
      .map((row) => parseImportDate(row.dob))
      .filter((dob): dob is string => Boolean(dob))
      .map((dob) => new Date(`${dob}T00:00:00.000Z`));

    const [takenRegNos, contacts, sameBirthdays] = await Promise.all([
      regNos.length
        ? this.prisma.student.findMany({
            where: { institutionId, regNo: { in: regNos } },
            select: { regNo: true },
          })
        : [],
      phones.length
        ? this.prisma.contact.findMany({
            where: {
              phone1: { in: phones },
              guardianId: { not: null },
              deletedAt: null,
            },
            select: {
              phone1: true,
              guardianId: true,
              guardian: {
                select: {
                  user: { select: { name: true } },
                  campus: { select: { institutionId: true } },
                },
              },
            },
          })
        : [],
      dobs.length
        ? this.prisma.student.findMany({
            where: { campusId, dob: { in: dobs } },
            select: { dob: true, user: { select: { name: true } } },
          })
        : [],
    ]);
    const taken = new Set(takenRegNos.map((student) => student.regNo));
    const guardianByPhone = new Map(
      contacts.map((contact) => [
        contact.phone1,
        {
          guardianId: contact.guardianId as string,
          name: contact.guardian?.user.name ?? '',
          institutionId: contact.guardian?.campus.institutionId ?? null,
        },
      ]),
    );
    const known = new Set(
      sameBirthdays.map(
        (student) =>
          `${normalizeLabel(student.user.name)}|${student.dob.toISOString().slice(0, 10)}`,
      ),
    );

    const today = new Date().toISOString().slice(0, 10);
    const seenRegNos = new Map<string, number>();
    const seenStudents = new Map<string, number>();
    const guardianNamesByPhone = new Map<string, string>();
    const guardianFirstLine = new Map<string, number>();

    return rows.map((raw, index): PreparedRow => {
      const line = offset + index + 2;
      const errors: string[] = [];
      const warnings: string[] = [];
      const name = (raw.name ?? '').trim();
      if (!name) errors.push('Name is missing.');

      const dob = parseImportDate(raw.dob);
      if (!raw.dob?.trim()) errors.push('Date of birth is missing.');
      else if (!dob)
        errors.push(`Date of birth "${raw.dob}" is not a real date.`);
      else if (dob > today) errors.push('Date of birth is in the future.');
      else {
        const age = yearsBetween(dob, today);
        if (age < MIN_AGE_YEARS || age > MAX_AGE_YEARS) {
          errors.push(
            `Date of birth ${dob} gives an age of ${Math.floor(age)}, which looks wrong.`,
          );
        }
      }

      const gender = parseGender(raw.gender);
      if (!gender) {
        errors.push(
          raw.gender?.trim()
            ? `Gender "${raw.gender}" is not male, female or other.`
            : 'Gender is missing.',
        );
      }

      const classMatches = classes.filter(
        (item) => normalizeLabel(item.name) === normalizeLabel(raw.className),
      );
      const found = classMatches.length === 1 ? classMatches[0] : null;
      if (!raw.className?.trim()) errors.push('Class is missing.');
      else if (classMatches.length === 0) {
        errors.push(
          `There is no class called "${raw.className}" at this campus.`,
        );
      } else if (classMatches.length > 1) {
        errors.push(
          `More than one class at this campus is called "${raw.className}".`,
        );
      }

      let section: { id: string; name: string } | null = null;
      if (raw.sectionName?.trim() && found) {
        section =
          found.sections.find(
            (item) =>
              normalizeLabel(item.name) === normalizeLabel(raw.sectionName),
          ) ?? null;
        if (!section) {
          errors.push(
            `Class "${found.name}" has no section called "${raw.sectionName}".`,
          );
        }
      }

      const admissionDate = raw.admissionDate?.trim()
        ? parseImportDate(raw.admissionDate)
        : today;
      if (!admissionDate) {
        errors.push(
          `Admission date "${raw.admissionDate}" is not a real date.`,
        );
      } else if (dob && admissionDate < dob) {
        errors.push('Admission date is before the date of birth.');
      }

      const religion = parseReligion(raw.religion);
      if (religion === null) {
        errors.push(`Religion "${raw.religion}" is not recognised.`);
      }

      const regNo = (raw.regNo ?? '').trim();
      if (regNo) {
        const first = seenRegNos.get(regNo);
        if (first)
          errors.push(
            `Registration number ${regNo} is already used on line ${first} of this file.`,
          );
        else seenRegNos.set(regNo, line);
        if (taken.has(regNo))
          errors.push(
            `Registration number ${regNo} already belongs to a student.`,
          );
      }

      const email = (raw.email ?? '').trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push(`Email "${raw.email}" is not a valid address.`);
      }

      if (name && dob) {
        const key = `${normalizeLabel(name)}|${dob}`;
        const first = seenStudents.get(key);
        if (first)
          warnings.push(
            `Same name and date of birth as line ${first} of this file.`,
          );
        else seenStudents.set(key, line);
        if (known.has(key))
          warnings.push(
            'A student with this name and date of birth is already at this campus.',
          );
      }

      let guardian: GuardianPlan = { mode: 'NONE' };
      const phone = normalizePhone(raw.guardianPhone);
      const guardianName = (raw.guardianName ?? '').trim();
      if (raw.guardianPhone?.trim() || guardianName) {
        if (!phone) {
          errors.push(
            raw.guardianPhone?.trim()
              ? `Guardian phone "${raw.guardianPhone}" is not a valid number.`
              : 'Guardian phone is missing; it is how the guardian signs in.',
          );
        } else {
          const existing = guardianByPhone.get(phone);
          const relation = parseRelation(raw.guardianRelation);
          if (existing && existing.institutionId !== institutionId) {
            // A phone number is one person's sign-in across the whole system.
            errors.push(
              `Guardian phone ${phone} is already registered to someone at another institution.`,
            );
          } else if (existing) {
            guardian = {
              mode: 'EXISTING',
              guardianId: existing.guardianId,
              name: existing.name,
              phone,
            };
          } else if (!guardianName) {
            errors.push('Guardian name is missing.');
          } else if (!relation) {
            errors.push(
              `Guardian relation "${raw.guardianRelation}" is not father, mother, uncle, aunt or guardian.`,
            );
          } else {
            const sharedWithLine = guardianFirstLine.get(phone);
            guardian = {
              mode: 'NEW',
              name: guardianName,
              phone,
              relation,
              ...(sharedWithLine ? { sharedWithLine } : {}),
            };
            if (!sharedWithLine) guardianFirstLine.set(phone, line);
          }
          const earlier = guardianNamesByPhone.get(phone);
          if (
            earlier &&
            guardianName &&
            normalizeLabel(earlier) !== normalizeLabel(guardianName)
          ) {
            warnings.push(
              `The phone number ${phone} is also given for ${earlier}; both will share one guardian.`,
            );
          }
          if (guardianName) guardianNamesByPhone.set(phone, guardianName);
        }
      }

      const ready =
        errors.length === 0 && found && dob && gender && admissionDate;
      return {
        line,
        name,
        errors,
        warnings,
        student: ready
          ? {
              regNo: regNo || null,
              email: email || null,
              dob,
              gender,
              classId: found.id,
              className: found.name,
              sectionId: section?.id ?? null,
              sectionName: section?.name ?? null,
              admissionDate,
              religion: religion ?? null,
              cnic: raw.cnic?.trim() || null,
              prevSchool: raw.prevSchool?.trim() || null,
            }
          : null,
        guardian,
      };
    });
  }

  /** Saves one checked line: the account, the student, and the guardian if there is one. */
  private async save(
    currentUser: CurrentUser,
    campusId: string,
    institutionId: string,
    row: PreparedRow,
  ): Promise<ImportResult> {
    const student = row.student as NonNullable<PreparedRow['student']>;
    const base = {
      line: row.line,
      name: row.name,
      regNo: null as string | null,
      studentPassword: null as string | null,
      guardianPhone: null as string | null,
      guardianPassword: null as string | null,
    };
    const studentPassword = generatePassword();
    let created: { id: string; regNo: string };
    try {
      const account = await this.auth.register(
        {
          name: row.name,
          email: student.email ?? placeholderEmail(),
          password: studentPassword,
          role: DtoUserRole.STUDENT,
          // Only a superadmin names the institution; an administrator's is their own.
          ...(currentUser.role === UserRole.SUPERADMIN
            ? { institutionId }
            : {}),
        },
        currentUser,
      );
      const result = await this.people.createStudent(currentUser, {
        userId: account.data.id,
        regNo: student.regNo ?? undefined,
        dob: student.dob,
        gender: student.gender,
        cnic: student.cnic ?? undefined,
        classId: student.classId,
        sectionId: student.sectionId ?? undefined,
        campusId,
        religion: student.religion ?? undefined,
        admissionDate: student.admissionDate,
        prevSchool: student.prevSchool ?? undefined,
      } as never);
      created = result.data as unknown as { id: string; regNo: string };
    } catch (error) {
      return {
        ...base,
        status: 'FAILED',
        error: this.reasonOf(error),
      };
    }
    const saved = {
      ...base,
      regNo: created.regNo,
      studentPassword,
    };
    if (row.guardian.mode === 'NONE') {
      return { ...saved, status: 'IMPORTED', error: null };
    }

    try {
      const guardianPassword = await this.attachGuardian(
        currentUser,
        campusId,
        institutionId,
        created.id,
        row.guardian,
      );
      return {
        ...saved,
        status: 'IMPORTED',
        guardianPhone: row.guardian.phone,
        guardianPassword,
        error: null,
      };
    } catch (error) {
      return {
        ...saved,
        status: 'IMPORTED_GUARDIAN_FAILED',
        guardianPhone: row.guardian.phone,
        error: `The student was imported but the guardian was not: ${this.reasonOf(error)}`,
      };
    }
  }

  /** Links a guardian who already exists, or creates one with a first password. */
  private async attachGuardian(
    currentUser: CurrentUser,
    campusId: string,
    institutionId: string,
    studentId: string,
    plan: Exclude<GuardianPlan, { mode: 'NONE' }>,
  ): Promise<string | null> {
    if (plan.mode === 'EXISTING') {
      await this.people.linkGuardian(currentUser, {
        studentId,
        guardianId: plan.guardianId,
      });
      return null;
    }
    // Brothers and sisters in one file share a guardian, who may have been created a moment ago by an earlier line.
    const earlier = await this.prisma.contact.findFirst({
      where: {
        phone1: plan.phone,
        guardianId: { not: null },
        deletedAt: null,
      },
      select: { guardianId: true },
    });
    if (earlier?.guardianId) {
      await this.people.linkGuardian(currentUser, {
        studentId,
        guardianId: earlier.guardianId,
      });
      return null;
    }
    const password = generatePassword();
    const account = await this.auth.register(
      {
        name: plan.name,
        email: placeholderEmail(),
        password,
        role: DtoUserRole.GUARDIAN,
        ...(currentUser.role === UserRole.SUPERADMIN ? { institutionId } : {}),
      },
      currentUser,
    );
    const guardian = await this.people.createGuardian(currentUser, {
      userId: account.data.id,
      relation: plan.relation,
      campusId,
    } as never);
    const guardianId = (guardian.data as unknown as { id: string }).id;
    await this.people.createContact(currentUser, {
      personId: guardianId,
      personType: 'GUARDIAN',
      phone1: plan.phone,
    });
    await this.people.linkGuardian(currentUser, {
      studentId,
      guardianId,
    });
    return password;
  }

  /** What went wrong, in words; an unexpected error is logged and not shown. */
  private reasonOf(error: unknown): string {
    if (error instanceof HttpException) return error.message;
    this.logger.error(
      `Import line failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    return 'This line could not be imported.';
  }
}
