import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { runAuditedTransaction } from '../../common/utils/transaction.util';
import {
  EnrollmentStatus,
  ExamStatus,
  ModuleKey,
  Prisma,
  UserRole,
} from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BulkExamResultsDto, ExamResultEntryDto } from './dto/examinations.dto';

interface RosterStudent {
  studentId: string;
  name: string;
  regNo: string;
}

interface PaperContext {
  id: string;
  subjectId: string;
  maxMarks: number;
  passingMarks: number;
  exam: {
    id: string;
    classId: string;
    campusId: string;
    academicYearId: string;
    status: ExamStatus;
    unlockedForEditing: boolean;
  };
}

/**
 * Marks entry for one paper. Reads follow ordinary permissions; writes add
 * the workflow lock (draft, or published and unlocked) and, for staff, a
 * hard check that they teach this subject in this section.
 */
@Injectable()
export class ExamResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly campusAccessService: CampusAccessService,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * The marks-entry grid for one paper and section: every enrolled student
   * with their result so far, if any.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} examSubjectId - The paper.
   * @param {string} sectionId - The section being marked.
   * @returns {Promise<{message: string, data: object}>} The paper's limits and one row per student.
   * @throws {NotFoundException} If the paper or section does not exist.
   * @throws {BadRequestException} If the section is not in the exam's class.
   */
  async getResults(
    currentUser: CurrentUser,
    examSubjectId: string,
    sectionId: string,
  ) {
    const paper = await this.loadPaper(currentUser, examSubjectId);
    await this.assertSectionInClass(sectionId, paper.exam.classId);
    const roster = await this.resolveRoster(paper, sectionId);
    const results = await this.prisma.examResult.findMany({
      where: {
        examSubjectId,
        studentId: { in: roster.map((student) => student.studentId) },
      },
    });
    const byStudent = new Map(results.map((row) => [row.studentId, row]));

    return {
      message: 'Exam results fetched successfully',
      data: {
        examSubjectId,
        maxMarks: paper.maxMarks,
        passingMarks: paper.passingMarks,
        locked: !this.writable(paper),
        students: roster.map((student) => {
          const result = byStudent.get(student.studentId);
          return {
            ...student,
            result: result
              ? {
                  id: result.id,
                  marksObtained:
                    result.marksObtained === null
                      ? null
                      : Number(result.marksObtained),
                  isAbsent: result.isAbsent,
                  remarks: result.remarks,
                }
              : null,
          };
        }),
      },
    };
  }

  /**
   * Save marks, absences and remarks for a section's students. Each listed
   * student's marks and absence are replaced by what is sent; remarks are
   * kept when not sent. Unchanged rows are not rewritten, so the audit
   * trail only records real changes.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} examSubjectId - The paper.
   * @param {BulkExamResultsDto} dto - Section and up to 200 entries.
   * @returns {Promise<{message: string, data: {saved: number, unchanged: number}>} Counts of rows written and skipped.
   * @throws {ConflictException} If the exam is published and not unlocked.
   * @throws {ForbiddenException} If a staff caller does not teach this subject in this section.
   * @throws {BadRequestException} If an entry is invalid, duplicated or not in the section.
   */
  async bulkSave(
    currentUser: CurrentUser,
    examSubjectId: string,
    dto: BulkExamResultsDto,
  ) {
    const paper = await this.loadPaper(currentUser, examSubjectId);
    if (!this.writable(paper)) {
      throw new ConflictException(
        'This exam is published and locked. Ask an admin to unlock it before changing marks.',
      );
    }
    await this.assertTeachesSection(currentUser, paper, dto.sectionId);
    await this.assertSectionInClass(dto.sectionId, paper.exam.classId);

    const roster = await this.resolveRoster(paper, dto.sectionId);
    this.validateEntries(dto.entries, roster, paper.maxMarks);

    const saved = await runAuditedTransaction(
      this.prisma,
      this.requestContext,
      async (transaction) => {
        const existing = await transaction.examResult.findMany({
          where: {
            examSubjectId,
            studentId: { in: dto.entries.map((entry) => entry.studentId) },
          },
        });
        const byStudent = new Map(existing.map((row) => [row.studentId, row]));
        let written = 0;

        for (const entry of dto.entries) {
          const isAbsent = entry.isAbsent ?? false;
          const marksObtained = isAbsent ? null : (entry.marksObtained ?? null);
          const current = byStudent.get(entry.studentId);

          if (!current) {
            await transaction.examResult.create({
              data: {
                examSubjectId,
                studentId: entry.studentId,
                sectionId: dto.sectionId,
                marksObtained,
                isAbsent,
                remarks: entry.remarks?.trim() || null,
                createdBy: currentUser.sub,
              },
            });
            written += 1;
            continue;
          }

          // Omitted keeps the saved remark; an empty string clears it.
          const remarks =
            entry.remarks === undefined
              ? current.remarks
              : entry.remarks.trim() || null;
          const unchanged =
            current.isAbsent === isAbsent &&
            (current.marksObtained === null
              ? null
              : Number(current.marksObtained)) === marksObtained &&
            current.remarks === remarks &&
            current.sectionId === dto.sectionId;
          if (unchanged) continue;

          await transaction.examResult.update({
            where: { id: current.id },
            data: {
              marksObtained,
              isAbsent,
              remarks,
              sectionId: dto.sectionId,
              updatedBy: currentUser.sub,
            },
          });
          written += 1;
        }
        return written;
      },
      // Serializable, so two people saving the same new student at once
      // cannot both insert: the loser retries and updates instead.
      Prisma.TransactionIsolationLevel.Serializable,
    );

    return {
      message: 'Exam results saved successfully',
      data: { saved, unchanged: dto.entries.length - saved },
    };
  }

  /**
   * The students confirmed to need a retake for this paper: absent, or with
   * marks below this paper's own passing marks. Students never marked are
   * left out, not assumed to have failed. This is a recommendation for the
   * retake roster, not a restriction on who may sit one.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} examSubjectId - The paper.
   * @param {string} sectionId - The section.
   * @returns {Promise<{message: string, data: object[]}>} Failing or absent students with their marks.
   */
  async getFailingStudents(
    currentUser: CurrentUser,
    examSubjectId: string,
    sectionId: string,
  ) {
    const paper = await this.loadPaper(currentUser, examSubjectId);
    await this.assertSectionInClass(sectionId, paper.exam.classId);
    const roster = await this.resolveRoster(paper, sectionId);
    const results = await this.prisma.examResult.findMany({
      where: {
        examSubjectId,
        studentId: { in: roster.map((student) => student.studentId) },
      },
    });
    const byStudent = new Map(results.map((row) => [row.studentId, row]));

    const data = roster.flatMap((student) => {
      const result = byStudent.get(student.studentId);
      if (!result) return [];
      const marks =
        result.marksObtained === null ? null : Number(result.marksObtained);
      const failed =
        result.isAbsent || (marks !== null && marks < paper.passingMarks);
      return failed
        ? [{ ...student, marksObtained: marks, isAbsent: result.isAbsent }]
        : [];
    });
    return { message: 'Failing students fetched successfully', data };
  }

  /** Marks may be written on a draft, or on a published exam that is unlocked. */
  private writable(paper: PaperContext): boolean {
    return (
      paper.exam.status === ExamStatus.DRAFT || paper.exam.unlockedForEditing
    );
  }

  /**
   * Every problem in the sent entries, checked before anything is written:
   * students outside the section, duplicates, marks outside 0 to the paper
   * maximum, and marks sent together with an absence.
   *
   * @param {ExamResultEntryDto[]} entries - The incoming entries.
   * @param {RosterStudent[]} roster - The section's students.
   * @param {number} maxMarks - The paper's maximum marks.
   * @throws {BadRequestException} Naming the offending students.
   */
  private validateEntries(
    entries: ExamResultEntryDto[],
    roster: RosterStudent[],
    maxMarks: number,
  ): void {
    const byId = new Map(roster.map((student) => [student.studentId, student]));
    const seen = new Set<string>();
    const problems: string[] = [];
    const label = (studentId: string) => {
      const student = byId.get(studentId);
      return student ? `${student.name} (${student.regNo})` : studentId;
    };

    for (const entry of entries) {
      if (!byId.has(entry.studentId)) {
        problems.push(`${entry.studentId} is not enrolled in this section.`);
        continue;
      }
      if (seen.has(entry.studentId)) {
        problems.push(`${label(entry.studentId)} appears more than once.`);
        continue;
      }
      seen.add(entry.studentId);

      const hasMarks =
        entry.marksObtained !== undefined && entry.marksObtained !== null;
      if (entry.isAbsent && hasMarks) {
        problems.push(
          `${label(entry.studentId)}: a student marked absent cannot have marks.`,
        );
      } else if (hasMarks && (entry.marksObtained as number) > maxMarks) {
        problems.push(
          `${label(entry.studentId)}: marks cannot be more than ${maxMarks}.`,
        );
      }
    }

    if (problems.length > 0) {
      throw new BadRequestException(problems.join(' '));
    }
  }

  /**
   * Staff may only write marks for a subject they are allocated to in this
   * section. Admins and superadmins are not subject to the allocation check.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {PaperContext} paper - The paper being marked.
   * @param {string} sectionId - The section being marked.
   * @throws {ForbiddenException} If a staff caller has no matching allocation.
   */
  private async assertTeachesSection(
    currentUser: CurrentUser,
    paper: PaperContext,
    sectionId: string,
  ): Promise<void> {
    if (currentUser.role !== UserRole.STAFF) return;

    const profile = await this.prisma.staffProfile.findUnique({
      where: { userId: currentUser.sub },
      select: { id: true },
    });
    const allocation = profile
      ? await this.prisma.teacherSubject.findFirst({
          where: {
            staffProfileId: profile.id,
            classId: paper.exam.classId,
            subjectId: paper.subjectId,
            sectionId,
            deletedAt: null,
          },
          select: { id: true },
        })
      : null;
    if (!allocation) {
      throw new ForbiddenException(
        'You are not assigned to teach this subject in this section.',
      );
    }
  }

  /**
   * The section's students for the exam's academic year: enrolled in the
   * exam's class and section, and not withdrawn.
   *
   * @param {PaperContext} paper - The paper, for the class and academic year.
   * @param {string} sectionId - The section.
   * @returns {Promise<RosterStudent[]>} Students ordered by name.
   */
  private async resolveRoster(
    paper: PaperContext,
    sectionId: string,
  ): Promise<RosterStudent[]> {
    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        classId: paper.exam.classId,
        sectionId,
        academicYearId: paper.exam.academicYearId,
        status: { not: EnrollmentStatus.LEFT },
        deletedAt: null,
      },
      select: {
        student: {
          select: { id: true, regNo: true, user: { select: { name: true } } },
        },
      },
    });
    return enrollments
      .map((enrollment) => ({
        studentId: enrollment.student.id,
        name: enrollment.student.user.name,
        regNo: enrollment.student.regNo,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async assertSectionInClass(
    sectionId: string,
    classId: string,
  ): Promise<void> {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      select: { classId: true },
    });
    if (!section) {
      throw new NotFoundException('Section not found.');
    }
    if (section.classId !== classId) {
      throw new BadRequestException("This section is not in the exam's class.");
    }
  }

  private async loadPaper(
    currentUser: CurrentUser,
    examSubjectId: string,
  ): Promise<PaperContext> {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
    const paper = await this.prisma.examSubject.findUnique({
      where: { id: examSubjectId },
      select: {
        id: true,
        subjectId: true,
        maxMarks: true,
        passingMarks: true,
        exam: {
          select: {
            id: true,
            classId: true,
            campusId: true,
            academicYearId: true,
            status: true,
            unlockedForEditing: true,
          },
        },
      },
    });
    if (!paper) {
      throw new NotFoundException('Exam paper not found.');
    }
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      paper.exam.campusId,
    );
    return {
      ...paper,
      maxMarks: Number(paper.maxMarks),
      passingMarks: Number(paper.passingMarks),
    };
  }
}
