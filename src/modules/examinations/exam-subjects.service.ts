import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomFieldEntity } from '../../common/constants/custom-field-entities.constants';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { ExamStatus, ModuleKey, Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateExamSubjectDto,
  ListExamSubjectsQueryDto,
  UpdateExamSubjectDto,
} from './dto/examinations.dto';

/** Include that adds the subject's name to every returned paper. */
const WITH_SUBJECT = {
  subject: { select: { id: true, name: true } },
} satisfies Prisma.ExamSubjectInclude;

interface ExamState {
  id: string;
  campusId: string;
  classId: string;
  status: ExamStatus;
  unlockedForEditing: boolean;
  examType: string;
  originalExamId: string | null;
}

/**
 * The papers of an exam: which subject, when and where it is sat, and out
 * of how many marks. Structure (adding or removing a paper) is allowed only
 * while the exam is a draft; pure logistics can change at any time; the
 * marks fields follow the same lock as marks entry (draft, or published and
 * unlocked).
 */
@Injectable()
export class ExamSubjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly campusAccessService: CampusAccessService,
    private readonly entityCustomFieldsService: EntityCustomFieldsService,
  ) {}

  /**
   * Add a paper to a draft exam.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {CreateExamSubjectDto} dto - Exam, subject, marks and optional schedule.
   * @returns {Promise<{message: string, data: object}>} The created paper with its subject name.
   * @throws {NotFoundException} If the exam or subject does not exist.
   * @throws {ConflictException} If the exam is not a draft, or the subject is already on it.
   * @throws {BadRequestException} If the subject is from another class, the marks or times are inconsistent, or a retake paper is not on the original exam.
   */
  async createExamSubject(currentUser: CurrentUser, dto: CreateExamSubjectDto) {
    await this.assertModule(currentUser);
    const exam = await this.findAccessibleExam(currentUser, dto.examId);
    if (exam.status !== ExamStatus.DRAFT) {
      throw new ConflictException(
        'Papers can only be added to an exam while it is a draft.',
      );
    }
    this.assertMarks(dto.maxMarks, dto.passingMarks);
    this.assertTimes(dto.startTime, dto.endTime);

    const subject = await this.prisma.subject.findUnique({
      where: { id: dto.subjectId },
      select: { id: true, classId: true },
    });
    if (!subject) {
      throw new NotFoundException('Subject not found.');
    }
    if (subject.classId !== exam.classId) {
      throw new BadRequestException(
        "This subject does not belong to the exam's class.",
      );
    }
    await this.assertOnOriginalExam(exam, subject.id);

    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        exam.campusId,
      );

    try {
      const created = await this.entityCustomFieldsService.saveRecord(
        {
          institutionId,
          moduleKey: ModuleKey.EXAMINATIONS,
          entityType: CustomFieldEntity.EXAM_SUBJECT,
          values: dto.customFields,
          create: true,
        },
        (transaction) =>
          transaction.examSubject.create({
            data: {
              examId: exam.id,
              subjectId: subject.id,
              maxMarks: dto.maxMarks,
              passingMarks: dto.passingMarks,
              examDate: dto.examDate ? new Date(dto.examDate) : null,
              startTime: dto.startTime ?? null,
              endTime: dto.endTime ?? null,
              room: dto.room ?? null,
              createdBy: currentUser.sub,
            },
            include: WITH_SUBJECT,
          }),
      );
      const data = await this.entityCustomFieldsService.attachToItem(
        created,
        CustomFieldEntity.EXAM_SUBJECT,
      );
      return { message: 'Exam paper added successfully', data };
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  /**
   * List the papers the caller can see, optionally for one exam, in date order.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {ListExamSubjectsQueryDto} query - Optional exam filter.
   * @returns {Promise<{message: string, data: object[]}>} Papers with subject names.
   */
  async listExamSubjects(
    currentUser: CurrentUser,
    query: ListExamSubjectsQueryDto,
  ) {
    await this.assertModule(currentUser);
    if (query.examId) {
      await this.findAccessibleExam(currentUser, query.examId);
    }
    const campusIds =
      await this.campusAccessService.getCampusIdsForUser(currentUser);

    const items = await this.prisma.examSubject.findMany({
      where: {
        exam: { campusId: { in: campusIds } },
        ...(query.examId ? { examId: query.examId } : {}),
      },
      include: WITH_SUBJECT,
      orderBy: [{ examDate: 'asc' }, { createdAt: 'asc' }],
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.EXAM_SUBJECT,
    );
    return { message: 'Exam papers fetched successfully', data };
  }

  /**
   * Fetch one paper.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} id - Paper id.
   * @returns {Promise<{message: string, data: object}>} The paper with its subject name.
   * @throws {NotFoundException} If the paper does not exist.
   */
  async getExamSubject(currentUser: CurrentUser, id: string) {
    await this.assertModule(currentUser);
    const { item } = await this.findAccessibleItem(currentUser, id);
    const data = await this.entityCustomFieldsService.attachToItem(
      item,
      CustomFieldEntity.EXAM_SUBJECT,
    );
    return { message: 'Exam paper fetched successfully', data };
  }

  /**
   * Update a paper. Date, times and room are editable at any time. Maximum
   * and passing marks follow the marks-entry lock: a draft, or a published
   * exam that an admin has unlocked.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} id - Paper id.
   * @param {UpdateExamSubjectDto} dto - Fields to change.
   * @returns {Promise<{message: string, data: object}>} The updated paper.
   * @throws {ConflictException} If the marks fields are changed on a locked exam.
   * @throws {BadRequestException} If the resulting marks or times are inconsistent.
   */
  async updateExamSubject(
    currentUser: CurrentUser,
    id: string,
    dto: UpdateExamSubjectDto,
  ) {
    await this.assertModule(currentUser);
    const { item, exam } = await this.findAccessibleItem(currentUser, id);

    // Edit forms resend every field, so only a value that actually differs
    // from what is stored counts as a marks change.
    const changesMarks =
      (dto.maxMarks !== undefined && dto.maxMarks !== Number(item.maxMarks)) ||
      (dto.passingMarks !== undefined &&
        dto.passingMarks !== Number(item.passingMarks));
    if (changesMarks && !this.marksEditable(exam)) {
      throw new ConflictException(
        'The marks of a published exam are locked. Ask an admin to unlock the exam first.',
      );
    }
    this.assertMarks(
      dto.maxMarks ?? Number(item.maxMarks),
      dto.passingMarks ?? Number(item.passingMarks),
    );
    this.assertTimes(
      dto.startTime ?? item.startTime ?? undefined,
      dto.endTime ?? item.endTime ?? undefined,
    );

    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        exam.campusId,
      );
    const updated = await this.entityCustomFieldsService.saveRecord(
      {
        institutionId,
        moduleKey: ModuleKey.EXAMINATIONS,
        entityType: CustomFieldEntity.EXAM_SUBJECT,
        values: dto.customFields,
        create: false,
      },
      (transaction) =>
        transaction.examSubject.update({
          where: { id },
          data: {
            maxMarks: dto.maxMarks,
            passingMarks: dto.passingMarks,
            examDate: dto.examDate ? new Date(dto.examDate) : undefined,
            startTime: dto.startTime,
            endTime: dto.endTime,
            room: dto.room,
            updatedBy: currentUser.sub,
          },
          include: WITH_SUBJECT,
        }),
    );
    const data = await this.entityCustomFieldsService.attachToItem(
      updated,
      CustomFieldEntity.EXAM_SUBJECT,
    );
    return { message: 'Exam paper updated successfully', data };
  }

  /**
   * Remove a paper from a draft exam (soft delete).
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} id - Paper id.
   * @param {string} [reason] - Optional recycle-bin delete reason.
   * @returns {Promise<{message: string, data: object}>} The deleted record's identifying fields.
   * @throws {ConflictException} If the exam is no longer a draft.
   */
  async deleteExamSubject(
    currentUser: CurrentUser,
    id: string,
    reason?: string,
  ) {
    await this.assertModule(currentUser);
    const { item, exam } = await this.findAccessibleItem(currentUser, id);
    if (exam.status !== ExamStatus.DRAFT) {
      throw new ConflictException(
        'Papers can only be removed from an exam while it is a draft.',
      );
    }

    await this.prisma.examSubject.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });
    return {
      message: 'Exam paper moved to recycle bin successfully',
      data: { id: item.id, subjectId: item.subjectId },
    };
  }

  /** Marks may change on a draft, or on a published exam an admin unlocked. */
  private marksEditable(exam: ExamState): boolean {
    return (
      exam.status === ExamStatus.DRAFT ||
      (exam.status === ExamStatus.PUBLISHED && exam.unlockedForEditing)
    );
  }

  private assertMarks(maxMarks: number, passingMarks: number): void {
    if (passingMarks > maxMarks) {
      throw new BadRequestException(
        'The passing marks cannot be greater than the maximum marks.',
      );
    }
  }

  private assertTimes(startTime?: string, endTime?: string): void {
    if (startTime && endTime && startTime >= endTime) {
      throw new BadRequestException(
        'The end time must be after the start time.',
      );
    }
  }

  /**
   * A retake, improvement or supplementary exam may only include subjects
   * that were on the exam it retakes.
   *
   * @param {ExamState} exam - The exam the paper is being added to.
   * @param {string} subjectId - The subject being added.
   * @throws {BadRequestException} If the subject is not on the original exam.
   */
  private async assertOnOriginalExam(
    exam: ExamState,
    subjectId: string,
  ): Promise<void> {
    if (exam.examType === 'REGULAR' || !exam.originalExamId) {
      return;
    }
    const onOriginal = await this.prisma.examSubject.count({
      where: { examId: exam.originalExamId, subjectId },
    });
    if (onOriginal === 0) {
      throw new BadRequestException(
        'This subject was not part of the original exam.',
      );
    }
  }

  private async findAccessibleExam(
    currentUser: CurrentUser,
    examId: string,
  ): Promise<ExamState> {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        campusId: true,
        classId: true,
        status: true,
        unlockedForEditing: true,
        examType: true,
        originalExamId: true,
      },
    });
    if (!exam) {
      throw new NotFoundException('Exam not found.');
    }
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      exam.campusId,
    );
    return exam;
  }

  private async findAccessibleItem(currentUser: CurrentUser, id: string) {
    const item = await this.prisma.examSubject.findUnique({
      where: { id },
      include: WITH_SUBJECT,
    });
    if (!item) {
      throw new NotFoundException('Exam paper not found.');
    }
    const exam = await this.findAccessibleExam(currentUser, item.examId);
    return { item, exam };
  }

  private async assertModule(currentUser: CurrentUser): Promise<void> {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
  }

  private rethrowUniqueConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('This subject is already on the exam.');
    }
    throw error;
  }
}
