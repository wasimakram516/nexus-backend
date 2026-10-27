import { BadRequestException, Injectable } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import {
  PrintableCustomValue,
  PrintableCustomValuesService,
} from '../../common/services/printable-custom-values.service';
import { PrintableMetaService } from '../../common/services/printable-meta.service';
import { EnrollmentStatus, ModuleKey } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IdCardsQueryDto } from './dto/student-id-cards.dto';

/** The most cards one request makes, so printing a whole campus is done a class at a time. */
export const MAX_ID_CARDS = 500;

export interface StudentIdCard {
  studentId: string;
  name: string;
  regNo: string;
  className: string;
  sectionName: string | null;
  picture: string | null;
  /** `YYYY-MM-DD`. */
  dob: string;
  /** The end of the academic year the card is for, `YYYY-MM-DD`; null when the year is unknown. */
  validUntil: string | null;
  /** A number to call, taken from a linked guardian; null when none is recorded. */
  guardianPhone: string | null;
  /** Fields the school chose to show on a printed document. */
  customValues: PrintableCustomValue[];
}

/**
 * Student identity cards for printing: one per enrolled student of the
 * current academic year at a campus, or of one class or section, or just one
 * student. The data is the same however it is printed, so the screen and a
 * later PDF always agree.
 */
@Injectable()
export class StudentIdCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccess: ModuleAccessService,
    private readonly campusAccess: CampusAccessService,
    private readonly customFields: EntityCustomFieldsService,
    private readonly printableValues: PrintableCustomValuesService,
    private readonly printableMeta: PrintableMetaService,
  ) {}

  /**
   * @param {CurrentUser} currentUser - Staff allowed to read students.
   * @param {IdCardsQueryDto} query - The campus, and optionally a class, section or one student.
   * @returns {Promise<{message: string, data: object}>} The cards, and the shared print header.
   * @throws {BadRequestException} If more than the limit would be printed at once.
   * @throws {ForbiddenException} If the caller cannot see the campus.
   */
  async getCards(currentUser: CurrentUser, query: IdCardsQueryDto) {
    await this.moduleAccess.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.PEOPLE,
    );
    await this.campusAccess.assertCampusAccess(currentUser, query.campusId);
    const institutionId = await this.customFields.resolveInstitutionIdByCampus(
      query.campusId,
    );
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { currentAcademicYearId: true },
    });
    const yearId = institution?.currentAcademicYearId;
    const printMeta = await this.printableMeta.build(
      'ID_CARD',
      institutionId,
      query.campusId,
    );
    if (!yearId) {
      return {
        message: 'ID cards fetched successfully',
        data: { cards: [] as StudentIdCard[], printMeta },
      };
    }

    const [year, enrollments] = await Promise.all([
      this.prisma.academicYear.findUnique({
        where: { id: yearId },
        select: { endDate: true },
      }),
      this.prisma.studentEnrollment.findMany({
        where: {
          academicYearId: yearId,
          campusId: query.campusId,
          status: EnrollmentStatus.ACTIVE,
          deletedAt: null,
          ...(query.classId ? { classId: query.classId } : {}),
          ...(query.sectionId ? { sectionId: query.sectionId } : {}),
          ...(query.studentId ? { studentId: query.studentId } : {}),
        },
        take: MAX_ID_CARDS + 1,
        select: {
          class: { select: { name: true } },
          section: { select: { name: true } },
          student: {
            select: {
              id: true,
              regNo: true,
              picture: true,
              dob: true,
              user: { select: { name: true } },
              guardians: {
                where: { deletedAt: null },
                select: {
                  guardian: {
                    select: {
                      contacts: {
                        where: { deletedAt: null },
                        select: { phone1: true },
                        take: 1,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);
    if (enrollments.length > MAX_ID_CARDS) {
      throw new BadRequestException(
        `Choose a class or section: more than ${MAX_ID_CARDS} cards cannot be made at once.`,
      );
    }

    const values = await this.printableValues.forRecords(
      institutionId,
      'student',
      enrollments.map((row) => row.student.id),
    );
    const cards: StudentIdCard[] = enrollments
      .map((row) => ({
        studentId: row.student.id,
        name: row.student.user.name,
        regNo: row.student.regNo,
        className: row.class.name,
        sectionName: row.section?.name ?? null,
        picture: row.student.picture,
        dob: row.student.dob.toISOString().slice(0, 10),
        validUntil: year?.endDate.toISOString().slice(0, 10) ?? null,
        guardianPhone:
          row.student.guardians
            .flatMap((link) => link.guardian.contacts)
            .map((contact) => contact.phone1)[0] ?? null,
        customValues: values.get(row.student.id) ?? [],
      }))
      .sort(
        (a, b) =>
          a.className.localeCompare(b.className, undefined, {
            numeric: true,
          }) ||
          // A student with no section is listed after the sections.
          (a.sectionName ?? '￿').localeCompare(b.sectionName ?? '￿') ||
          a.name.localeCompare(b.name),
      );
    return {
      message: 'ID cards fetched successfully',
      data: { cards, printMeta },
    };
  }
}
