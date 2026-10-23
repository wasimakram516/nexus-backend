import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import {
  PrintableMeta,
  PrintableMetaService,
} from '../../common/services/printable-meta.service';
import { UserPermissionsService } from '../../common/services/user-permissions.service';
import {
  EnrollmentStatus,
  ExamStatus,
  ModuleKey,
  UserRole,
} from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamResultsViewService } from './exam-results-view.service';

interface DatesheetExam {
  id: string;
  name: string;
  status: string;
  examType: string;
  campusId: string;
  classId: string;
  academicYearId: string;
  institutionId: string;
  className: string;
  termName: string;
  academicYearName: string;
  papers: Array<{
    examSubjectId: string;
    subjectName: string;
    maxMarks: number;
    passingMarks: number;
    examDate: Date | null;
    startTime: string | null;
    endTime: string | null;
    room: string | null;
  }>;
}

/**
 * Datesheets and admit cards. A datesheet is visible whether or not the exam
 * is published: its purpose is to tell students when to turn up, so hiding it
 * until results are out would defeat it.
 */
@Injectable()
export class ExamPrintablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly campusAccessService: CampusAccessService,
    private readonly userPermissionsService: UserPermissionsService,
    private readonly printableMetaService: PrintableMetaService,
    private readonly viewService: ExamResultsViewService,
  ) {}

  /**
   * The schedule of an exam's papers, in date order, with the shared print header.
   *
   * @param {CurrentUser} currentUser - Staff with exam read access, or a student or guardian of the exam's class.
   * @param {string} examId - The exam.
   * @returns {Promise<{message: string, data: object}>} The datesheet and print header.
   * @throws {ForbiddenException} If the caller may not see this exam.
   */
  async getDatesheet(currentUser: CurrentUser, examId: string) {
    await this.assertModule(currentUser);
    const exam = await this.loadDatesheetExam(examId);
    await this.assertCanViewDatesheet(currentUser, exam);

    return {
      message: 'Datesheet fetched successfully',
      data: {
        ...this.datesheetPayload(exam),
        printMeta: await this.printMeta('DATESHEET', exam),
      },
    };
  }

  /**
   * One student's admit card: who they are, which class and section, and the
   * datesheet.
   *
   * @param {CurrentUser} currentUser - Staff with exam read access, or the student or their guardian.
   * @param {string} examId - The exam.
   * @param {string} studentId - The student.
   * @returns {Promise<{message: string, data: object}>} The admit card and print header.
   * @throws {ForbiddenException} If the caller may not see this student's card.
   * @throws {NotFoundException} If the student is not enrolled in the exam's class for its year.
   */
  async getAdmitCard(
    currentUser: CurrentUser,
    examId: string,
    studentId: string,
  ) {
    await this.assertModule(currentUser);
    const exam = await this.loadDatesheetExam(examId);
    await this.assertCanViewStudentCard(currentUser, exam, studentId);

    const [card] = await this.buildCards(exam, { studentId });
    if (!card) {
      throw new NotFoundException(
        "This student is not enrolled in the exam's class.",
      );
    }
    return {
      message: 'Admit card fetched successfully',
      data: {
        ...card,
        printMeta: await this.printMeta('ADMIT_CARD', exam),
      },
    };
  }

  /**
   * Admit cards for a whole class, or one section of it, ready to print.
   *
   * @param {CurrentUser} currentUser - Staff with exam read access.
   * @param {string} examId - The exam.
   * @param {string} [sectionId] - Limit to one section.
   * @returns {Promise<{message: string, data: object}>} One card per student, plus one shared print header.
   */
  async getAdmitCards(
    currentUser: CurrentUser,
    examId: string,
    sectionId?: string,
  ) {
    await this.assertModule(currentUser);
    const exam = await this.loadDatesheetExam(examId);
    await this.assertStaffRead(currentUser, exam);

    const cards = await this.buildCards(exam, { sectionId });
    return {
      message: 'Admit cards fetched successfully',
      data: {
        cards,
        printMeta: await this.printMeta('ADMIT_CARD', exam),
      },
    };
  }

  /**
   * The exams of the caller's own class (a student), or of every ward's class
   * (a guardian), each with its datesheet and whether results are published.
   * Retake-type exams appear too, tagged, so a family can see one was
   * scheduled. Anyone who is not a student or guardian gets an empty list.
   *
   * @param {CurrentUser} currentUser - The signed-in student or guardian.
   * @param {string} [academicYearId] - A year; defaults to the institution's current year.
   * @returns {Promise<{message: string, data: object[]}>} One entry per exam per child.
   */
  async getExamsForMe(currentUser: CurrentUser, academicYearId?: string) {
    await this.assertModule(currentUser);
    const ownedIds = await this.viewService.resolveOwnedStudentIds(currentUser);
    if (ownedIds.length === 0) {
      return { message: 'Exams fetched successfully', data: [] };
    }

    const students = await this.prisma.student.findMany({
      where: { id: { in: ownedIds }, deletedAt: null },
      select: {
        id: true,
        institutionId: true,
        user: { select: { name: true } },
      },
    });
    const institutionId = students[0]?.institutionId;
    let yearId = academicYearId;
    if (!yearId && institutionId) {
      const institution = await this.prisma.institution.findUnique({
        where: { id: institutionId },
        select: { currentAcademicYearId: true },
      });
      yearId = institution?.currentAcademicYearId ?? undefined;
    }
    if (!yearId) {
      return { message: 'Exams fetched successfully', data: [] };
    }

    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        studentId: { in: ownedIds },
        academicYearId: yearId,
        status: { not: EnrollmentStatus.LEFT },
        deletedAt: null,
      },
      select: { studentId: true, classId: true },
    });
    if (enrollments.length === 0) {
      return { message: 'Exams fetched successfully', data: [] };
    }

    const exams = await this.prisma.exam.findMany({
      where: {
        academicYearId: yearId,
        classId: { in: [...new Set(enrollments.map((row) => row.classId))] },
      },
      include: {
        examTerm: { select: { name: true, sortOrder: true } },
        subjects: { include: { subject: { select: { name: true } } } },
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    const nameOf = new Map(students.map((s) => [s.id, s.user.name]));
    const data = enrollments.flatMap((enrollment) =>
      exams
        .filter((exam) => exam.classId === enrollment.classId)
        .map((exam) => ({
          id: exam.id,
          name: exam.name,
          examTermName: exam.examTerm.name,
          examType: exam.examType,
          originalExamId: exam.originalExamId,
          status: exam.status,
          resultsPublished: exam.status === ExamStatus.PUBLISHED,
          studentId: enrollment.studentId,
          studentName: nameOf.get(enrollment.studentId) ?? '',
          datesheet: exam.subjects
            .map((paper) => ({
              subjectName: paper.subject.name,
              examDate: paper.examDate,
              startTime: paper.startTime,
              endTime: paper.endTime,
              room: paper.room,
            }))
            .sort(
              (a, b) =>
                (a.examDate?.getTime() ?? Infinity) -
                  (b.examDate?.getTime() ?? Infinity) ||
                (a.startTime ?? '').localeCompare(b.startTime ?? ''),
            ),
        })),
    );
    return { message: 'Exams fetched successfully', data };
  }

  private datesheetPayload(exam: DatesheetExam) {
    return {
      exam: {
        id: exam.id,
        name: exam.name,
        examType: exam.examType,
        className: exam.className,
        termName: exam.termName,
        academicYearName: exam.academicYearName,
      },
      papers: exam.papers,
    };
  }

  private async buildCards(
    exam: DatesheetExam,
    filter: { studentId?: string; sectionId?: string },
  ) {
    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        classId: exam.classId,
        academicYearId: exam.academicYearId,
        status: { not: EnrollmentStatus.LEFT },
        deletedAt: null,
        ...(filter.studentId ? { studentId: filter.studentId } : {}),
        ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
      },
      select: {
        section: { select: { name: true } },
        student: {
          select: {
            id: true,
            regNo: true,
            picture: true,
            user: { select: { name: true } },
          },
        },
      },
    });

    const datesheet = this.datesheetPayload(exam);
    return enrollments
      .map((enrollment) => ({
        student: {
          id: enrollment.student.id,
          name: enrollment.student.user.name,
          regNo: enrollment.student.regNo,
          picture: enrollment.student.picture,
          className: exam.className,
          sectionName: enrollment.section?.name ?? null,
        },
        ...datesheet,
      }))
      .sort((a, b) => a.student.name.localeCompare(b.student.name));
  }

  private async printMeta(
    documentType: string,
    exam: DatesheetExam,
  ): Promise<PrintableMeta> {
    return this.printableMetaService.build(
      documentType,
      exam.institutionId,
      exam.campusId,
    );
  }

  private async loadDatesheetExam(examId: string): Promise<DatesheetExam> {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        campus: { select: { institutionId: true } },
        class: { select: { name: true } },
        examTerm: { select: { name: true } },
        academicYear: { select: { name: true } },
        subjects: { include: { subject: { select: { name: true } } } },
      },
    });
    const institutionId = exam?.campus.institutionId;
    if (!exam || !institutionId) {
      throw new NotFoundException('Exam not found.');
    }

    // Undated papers go last; within a day, by start time.
    const papers = exam.subjects
      .map((paper) => ({
        examSubjectId: paper.id,
        subjectName: paper.subject.name,
        maxMarks: Number(paper.maxMarks),
        passingMarks: Number(paper.passingMarks),
        examDate: paper.examDate,
        startTime: paper.startTime,
        endTime: paper.endTime,
        room: paper.room,
      }))
      .sort((a, b) => {
        if (a.examDate && b.examDate) {
          const byDate = a.examDate.getTime() - b.examDate.getTime();
          if (byDate !== 0) return byDate;
        } else if (a.examDate || b.examDate) {
          return a.examDate ? -1 : 1;
        }
        return (
          (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
          a.subjectName.localeCompare(b.subjectName)
        );
      });

    return {
      id: exam.id,
      name: exam.name,
      status: exam.status,
      examType: exam.examType,
      campusId: exam.campusId,
      classId: exam.classId,
      academicYearId: exam.academicYearId,
      institutionId,
      className: exam.class.name,
      termName: exam.examTerm.name,
      academicYearName: exam.academicYear.name,
      papers,
    };
  }

  /** Staff: campus access plus the exams read permission. */
  private async assertStaffRead(
    currentUser: CurrentUser,
    exam: DatesheetExam,
  ): Promise<void> {
    if (
      currentUser.role === UserRole.STUDENT ||
      currentUser.role === UserRole.GUARDIAN
    ) {
      throw new ForbiddenException(
        'Only staff can view this for a whole class.',
      );
    }
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      exam.campusId,
    );
    const allowed = await this.userPermissionsService.can(
      currentUser,
      'exams',
      'read',
    );
    if (!allowed) {
      throw new ForbiddenException(
        'You do not have read permission for exams. Ask your administrator for access.',
      );
    }
  }

  /** Staff with read access, or a student or guardian with someone in the exam's class. */
  private async assertCanViewDatesheet(
    currentUser: CurrentUser,
    exam: DatesheetExam,
  ): Promise<void> {
    if (
      currentUser.role !== UserRole.STUDENT &&
      currentUser.role !== UserRole.GUARDIAN
    ) {
      await this.assertStaffRead(currentUser, exam);
      return;
    }
    const owned = await this.viewService.resolveOwnedStudentIds(currentUser);
    const enrolled = owned.length
      ? await this.prisma.studentEnrollment.count({
          where: {
            studentId: { in: owned },
            classId: exam.classId,
            academicYearId: exam.academicYearId,
            status: { not: EnrollmentStatus.LEFT },
            deletedAt: null,
          },
        })
      : 0;
    if (enrolled === 0) {
      throw new ForbiddenException('This exam is not for your class.');
    }
  }

  private async assertCanViewStudentCard(
    currentUser: CurrentUser,
    exam: DatesheetExam,
    studentId: string,
  ): Promise<void> {
    if (
      currentUser.role !== UserRole.STUDENT &&
      currentUser.role !== UserRole.GUARDIAN
    ) {
      await this.assertStaffRead(currentUser, exam);
      return;
    }
    const owned = await this.viewService.resolveOwnedStudentIds(currentUser);
    if (!owned.includes(studentId)) {
      throw new ForbiddenException('You can only view your own admit card.');
    }
  }

  private async assertModule(currentUser: CurrentUser): Promise<void> {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
  }
}
