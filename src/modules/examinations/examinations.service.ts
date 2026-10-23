import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { CustomFieldEntity } from '../../common/constants/custom-field-entities.constants';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { runAuditedTransaction } from '../../common/utils/transaction.util';
import { ExamStatus, ExamType, ModuleKey, Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateExamDto,
  CreateExamTermDto,
  CreateGradingScaleDto,
  CreateRetakeExamDto,
  GradeBandInputDto,
  ListExamsQueryDto,
  UpdateExamDto,
  UpdateExamTermDto,
  UpdateGradingScaleDto,
} from './dto/examinations.dto';

/** Sentinel for the non-nullable half of the exam unique index (see schema). */
const REGULAR_RETAKE_KEY = 'REGULAR';

/**
 * Nested includes are not covered by the Prisma extension's soft-delete
 * filter, so superseded (soft-deleted) bands must be excluded explicitly.
 */
const ACTIVE_BANDS_INCLUDE = {
  bands: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
} as const;

@Injectable()
export class ExaminationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly requestContext: RequestContextService,
    private readonly campusAccessService: CampusAccessService,
    private readonly entityCustomFieldsService: EntityCustomFieldsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------
  // Grading scales
  // ---------------------------------------------------------------------

  /**
   * Create a grading scale with its grade bands in one transaction.
   *
   * `institutionId` is always an explicit parameter (JWT-derived on the
   * institution controller, path-derived on the superadmin platform mirror),
   * same shape as `AcademicsService.createAcademicYear`.
   *
   * @param {string} institutionId - Target institution id.
   * @param {CreateGradingScaleDto} dto - Scale name, description and bands.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<{message: string, data: object}>} The created scale with its ordered bands.
   * @throws {NotFoundException} If the institution does not exist.
   * @throws {BadRequestException} If the bands are invalid or overlap.
   * @throws {ConflictException} If an active scale with the same name exists.
   */
  async createGradingScale(
    institutionId: string,
    dto: CreateGradingScaleDto,
    currentUser: CurrentUser,
  ) {
    await this.assertInstitutionAndModule(institutionId, currentUser);
    this.assertBandsValid(dto.bands);

    try {
      const data = await runAuditedTransaction(
        this.prisma,
        this.requestContext,
        async (tx: Prisma.TransactionClient) => {
          const created = await tx.gradingScale.create({
            data: {
              institutionId,
              name: dto.name,
              description: dto.description ?? null,
            },
          });
          await this.createBands(tx, created.id, dto.bands);
          return tx.gradingScale.findUniqueOrThrow({
            where: { id: created.id },
            include: ACTIVE_BANDS_INCLUDE,
          });
        },
      );

      return {
        message: 'Grading scale created successfully',
        data: { ...data, isCurrent: false },
      };
    } catch (error) {
      this.rethrowUniqueConflict(error, 'grading scale');
    }
  }

  /**
   * List every grading scale of an institution, flagging the current one.
   *
   * @param {string} institutionId - Target institution id.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<{message: string, data: object[]}>} Scales with ordered bands.
   */
  async listGradingScales(institutionId: string, currentUser: CurrentUser) {
    await this.assertInstitutionAndModule(institutionId, currentUser);

    const [scales, institution] = await Promise.all([
      this.prisma.gradingScale.findMany({
        where: { institutionId },
        include: ACTIVE_BANDS_INCLUDE,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.institution.findUnique({
        where: { id: institutionId },
        select: { currentGradingScaleId: true },
      }),
    ]);

    return {
      message: 'Grading scales fetched successfully',
      data: scales.map((scale) => ({
        ...scale,
        isCurrent: scale.id === institution?.currentGradingScaleId,
      })),
    };
  }

  /**
   * Fetch one grading scale.
   *
   * @param {string} institutionId - Target institution id.
   * @param {string} gradingScaleId - Scale id.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<{message: string, data: object}>} The scale with ordered bands.
   * @throws {NotFoundException} If the scale does not exist in this institution.
   */
  async getGradingScale(
    institutionId: string,
    gradingScaleId: string,
    currentUser: CurrentUser,
  ) {
    await this.assertInstitutionAndModule(institutionId, currentUser);
    const scale = await this.findScaleOrThrow(institutionId, gradingScaleId);
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { currentGradingScaleId: true },
    });

    return {
      message: 'Grading scale fetched successfully',
      data: {
        ...scale,
        isCurrent: scale.id === institution?.currentGradingScaleId,
      },
    };
  }

  /**
   * Partially update a grading scale. When `bands` is supplied it replaces
   * the whole set atomically (existing bands are soft-deleted with a rotated
   * `activeScopeKey` so their unique slots are freed).
   *
   * @param {string} institutionId - Target institution id.
   * @param {string} gradingScaleId - Scale id.
   * @param {UpdateGradingScaleDto} dto - Fields to change.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<{message: string, data: object}>} The updated scale.
   * @throws {NotFoundException} If the scale does not exist in this institution.
   * @throws {BadRequestException} If the new bands are invalid or overlap.
   * @throws {ConflictException} If the rename collides with another scale.
   */
  async updateGradingScale(
    institutionId: string,
    gradingScaleId: string,
    dto: UpdateGradingScaleDto,
    currentUser: CurrentUser,
  ) {
    await this.assertInstitutionAndModule(institutionId, currentUser);
    await this.findScaleOrThrow(institutionId, gradingScaleId);
    if (dto.bands !== undefined) {
      this.assertBandsValid(dto.bands);
    }

    try {
      const data = await runAuditedTransaction(
        this.prisma,
        this.requestContext,
        async (tx: Prisma.TransactionClient) => {
          await tx.gradingScale.update({
            where: { id: gradingScaleId },
            data: {
              name: dto.name,
              description: dto.description,
              updatedBy: currentUser.sub,
            },
          });

          if (dto.bands !== undefined) {
            await this.replaceBands(tx, gradingScaleId, currentUser, dto.bands);
          }

          return tx.gradingScale.findUniqueOrThrow({
            where: { id: gradingScaleId },
            include: ACTIVE_BANDS_INCLUDE,
          });
        },
      );

      const institution = await this.prisma.institution.findUnique({
        where: { id: institutionId },
        select: { currentGradingScaleId: true },
      });

      return {
        message: 'Grading scale updated successfully',
        data: {
          ...data,
          isCurrent: data.id === institution?.currentGradingScaleId,
        },
      };
    } catch (error) {
      this.rethrowUniqueConflict(error, 'grading scale');
    }
  }

  /**
   * Flip the institution's current grading scale pointer.
   *
   * @param {string} institutionId - Target institution id.
   * @param {string} gradingScaleId - Scale to become current.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<{message: string, data: {id: string}}>} Confirmation payload.
   * @throws {NotFoundException} If the scale does not exist in this institution.
   */
  async setCurrentGradingScale(
    institutionId: string,
    gradingScaleId: string,
    currentUser: CurrentUser,
  ) {
    await this.assertInstitutionAndModule(institutionId, currentUser);
    await this.findScaleOrThrow(institutionId, gradingScaleId);

    await this.prisma.institution.update({
      where: { id: institutionId },
      data: { currentGradingScaleId: gradingScaleId },
    });

    return {
      message: 'Current grading scale updated successfully',
      data: { id: gradingScaleId },
    };
  }

  /**
   * Soft-delete a grading scale. Blocked while it is the institution's
   * current scale, so new exams always have a resolvable default.
   *
   * @param {string} institutionId - Target institution id.
   * @param {string} gradingScaleId - Scale id.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} [reason] - Optional recycle-bin delete reason.
   * @returns {Promise<{message: string, data: object}>} The deleted record's identifying fields.
   * @throws {NotFoundException} If the scale does not exist in this institution.
   * @throws {ConflictException} If this is the institution's current scale.
   */
  async deleteGradingScale(
    institutionId: string,
    gradingScaleId: string,
    currentUser: CurrentUser,
    reason?: string,
  ) {
    await this.assertInstitutionAndModule(institutionId, currentUser);
    const existing = await this.findScaleOrThrow(institutionId, gradingScaleId);

    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { currentGradingScaleId: true },
    });
    if (institution?.currentGradingScaleId === gradingScaleId) {
      throw new ConflictException(
        "This is the institution's current grading scale. Switch the current grading scale before deleting this one.",
      );
    }

    await this.prisma.gradingScale.update({
      where: { id: gradingScaleId },
      data: this.softDeleteData(gradingScaleId, currentUser, reason),
    });

    return {
      message: 'Grading scale moved to recycle bin successfully',
      data: { id: existing.id, name: existing.name },
    };
  }

  // ---------------------------------------------------------------------
  // Exam terms
  // ---------------------------------------------------------------------

  /**
   * Create an exam term inside one academic year of the institution.
   *
   * @param {string} institutionId - Target institution id.
   * @param {CreateExamTermDto} dto - Term fields.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<{message: string, data: object}>} The created term.
   * @throws {NotFoundException} If the institution or academic year does not exist in it.
   * @throws {BadRequestException} If the date range is inverted.
   * @throws {ConflictException} If the year already has an active term with this name.
   */
  async createExamTerm(
    institutionId: string,
    dto: CreateExamTermDto,
    currentUser: CurrentUser,
  ) {
    await this.assertInstitutionAndModule(institutionId, currentUser);
    await this.assertAcademicYearInInstitution(
      institutionId,
      dto.academicYearId,
    );
    this.assertDateRange(dto.startDate, dto.endDate);

    try {
      const term = await this.entityCustomFieldsService.saveRecord(
        {
          institutionId,
          moduleKey: ModuleKey.EXAMINATIONS,
          entityType: CustomFieldEntity.EXAM_TERM,
          values: dto.customFields,
          create: true,
        },
        (transaction) =>
          transaction.examTerm.create({
            data: {
              institutionId,
              academicYearId: dto.academicYearId,
              name: dto.name,
              weight: dto.weight,
              sortOrder: dto.sortOrder,
              startDate: dto.startDate ? new Date(dto.startDate) : null,
              endDate: dto.endDate ? new Date(dto.endDate) : null,
              createdBy: currentUser.sub,
            },
          }),
      );
      const data = await this.entityCustomFieldsService.attachToItem(
        term,
        CustomFieldEntity.EXAM_TERM,
      );
      return { message: 'Exam term created successfully', data };
    } catch (error) {
      this.rethrowUniqueConflict(error, 'exam term');
    }
  }

  /**
   * List an institution's exam terms, optionally for one academic year.
   *
   * @param {string} institutionId - Target institution id.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} [academicYearId] - Optional academic year filter.
   * @returns {Promise<{message: string, data: object[]}>} Terms ordered by sort order then name.
   */
  async listExamTerms(
    institutionId: string,
    currentUser: CurrentUser,
    academicYearId?: string,
  ) {
    await this.assertInstitutionAndModule(institutionId, currentUser);

    const terms = await this.prisma.examTerm.findMany({
      where: { institutionId, ...(academicYearId ? { academicYearId } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      terms,
      CustomFieldEntity.EXAM_TERM,
    );
    return { message: 'Exam terms fetched successfully', data };
  }

  /**
   * Fetch one exam term.
   *
   * @param {string} institutionId - Target institution id.
   * @param {string} examTermId - Term id.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<{message: string, data: object}>} The term.
   * @throws {NotFoundException} If the term does not exist in this institution.
   */
  async getExamTerm(
    institutionId: string,
    examTermId: string,
    currentUser: CurrentUser,
  ) {
    await this.assertInstitutionAndModule(institutionId, currentUser);
    const term = await this.findTermOrThrow(institutionId, examTermId);
    const data = await this.entityCustomFieldsService.attachToItem(
      term,
      CustomFieldEntity.EXAM_TERM,
    );
    return { message: 'Exam term fetched successfully', data };
  }

  /**
   * Partially update an exam term. The academic year cannot be changed
   * once created, since exams and results hang off the (year, term) pair.
   *
   * @param {string} institutionId - Target institution id.
   * @param {string} examTermId - Term id.
   * @param {UpdateExamTermDto} dto - Fields to change.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<{message: string, data: object}>} The updated term.
   * @throws {NotFoundException} If the term does not exist in this institution.
   * @throws {BadRequestException} If the academic year is changed or the date range is inverted.
   * @throws {ConflictException} If the rename collides with another term in the year.
   */
  async updateExamTerm(
    institutionId: string,
    examTermId: string,
    dto: UpdateExamTermDto,
    currentUser: CurrentUser,
  ) {
    await this.assertInstitutionAndModule(institutionId, currentUser);
    const existing = await this.findTermOrThrow(institutionId, examTermId);

    if (dto.academicYearId && dto.academicYearId !== existing.academicYearId) {
      throw new BadRequestException(
        "An exam term's academic year cannot be changed. Create a new term in the other year instead.",
      );
    }
    this.assertDateRange(
      dto.startDate ?? existing.startDate?.toISOString(),
      dto.endDate ?? existing.endDate?.toISOString(),
    );

    try {
      const term = await this.entityCustomFieldsService.saveRecord(
        {
          institutionId,
          moduleKey: ModuleKey.EXAMINATIONS,
          entityType: CustomFieldEntity.EXAM_TERM,
          values: dto.customFields,
          create: false,
        },
        (transaction) =>
          transaction.examTerm.update({
            where: { id: examTermId },
            data: {
              name: dto.name,
              weight: dto.weight,
              sortOrder: dto.sortOrder,
              startDate: dto.startDate ? new Date(dto.startDate) : undefined,
              endDate: dto.endDate ? new Date(dto.endDate) : undefined,
              updatedBy: currentUser.sub,
            },
          }),
      );
      const data = await this.entityCustomFieldsService.attachToItem(
        term,
        CustomFieldEntity.EXAM_TERM,
      );
      return { message: 'Exam term updated successfully', data };
    } catch (error) {
      this.rethrowUniqueConflict(error, 'exam term');
    }
  }

  /**
   * Soft-delete an exam term.
   *
   * @param {string} institutionId - Target institution id.
   * @param {string} examTermId - Term id.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} [reason] - Optional recycle-bin delete reason.
   * @returns {Promise<{message: string, data: object}>} The deleted record's identifying fields.
   * @throws {NotFoundException} If the term does not exist in this institution.
   */
  async deleteExamTerm(
    institutionId: string,
    examTermId: string,
    currentUser: CurrentUser,
    reason?: string,
  ) {
    await this.assertInstitutionAndModule(institutionId, currentUser);
    const existing = await this.findTermOrThrow(institutionId, examTermId);

    await this.prisma.examTerm.update({
      where: { id: examTermId },
      data: this.softDeleteData(examTermId, currentUser, reason),
    });

    return {
      message: 'Exam term moved to recycle bin successfully',
      data: { id: existing.id, name: existing.name },
    };
  }

  // ---------------------------------------------------------------------
  // Exams (class-scoped; campus access resolves through the class)
  // ---------------------------------------------------------------------

  /**
   * Create a REGULAR exam for one class in one term. Retake-type exams can
   * only be created through `createRetakeExam`.
   *
   * `campusId` and `academicYearId` are resolved server-side from the class
   * and term, never taken from the client.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {CreateExamDto} dto - Class, term, name and optional grading scale.
   * @returns {Promise<{message: string, data: object}>} The created exam.
   * @throws {ForbiddenException} If the caller has no access to the class's campus.
   * @throws {NotFoundException} If the class, term or grading scale is not found in the class's institution.
   * @throws {ConflictException} If no grading scale can be resolved, or the class already has a regular exam for the term.
   */
  async createExam(currentUser: CurrentUser, dto: CreateExamDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
    await this.campusAccessService.assertClassAccess(currentUser, dto.classId);
    const scope = await this.resolveClassScope(dto.classId);
    const term = await this.findTermOrThrow(
      scope.institutionId,
      dto.examTermId,
    );
    const gradingScaleId = await this.resolveGradingScaleId(
      scope.institutionId,
      dto.gradingScaleId,
    );

    try {
      const created = await this.entityCustomFieldsService.saveRecord(
        {
          institutionId: scope.institutionId,
          moduleKey: ModuleKey.EXAMINATIONS,
          entityType: CustomFieldEntity.EXAM,
          values: dto.customFields,
          create: true,
        },
        (transaction) =>
          transaction.exam.create({
            data: {
              examTermId: term.id,
              academicYearId: term.academicYearId,
              campusId: scope.campusId,
              classId: dto.classId,
              name: dto.name,
              gradingScaleId,
              examType: ExamType.REGULAR,
              retakeKey: REGULAR_RETAKE_KEY,
              createdBy: currentUser.sub,
            },
          }),
      );
      const data = await this.entityCustomFieldsService.attachToItem(
        created,
        CustomFieldEntity.EXAM,
      );
      return { message: 'Exam created successfully', data };
    } catch (error) {
      this.rethrowExamConflict(error);
    }
  }

  /**
   * List the exams the caller can see, with optional filters.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {ListExamsQueryDto} query - Optional filters.
   * @returns {Promise<{message: string, data: object[]}>} Exams, newest term first.
   * @throws {ForbiddenException} If a requested campus or class is out of the caller's scope.
   */
  async listExams(currentUser: CurrentUser, query: ListExamsQueryDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
    if (query.classId) {
      await this.campusAccessService.assertClassAccess(
        currentUser,
        query.classId,
      );
    }
    const campusIds = await this.campusAccessService.getScopedCampusIds(
      currentUser,
      query.campusId,
    );

    const exams = await this.prisma.exam.findMany({
      where: {
        campusId: { in: campusIds },
        ...(query.classId ? { classId: query.classId } : {}),
        ...(query.examTermId ? { examTermId: query.examTermId } : {}),
        ...(query.academicYearId
          ? { academicYearId: query.academicYearId }
          : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.examType ? { examType: query.examType } : {}),
        ...(query.originalExamId
          ? { originalExamId: query.originalExamId }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      exams,
      CustomFieldEntity.EXAM,
    );
    return { message: 'Exams fetched successfully', data };
  }

  /**
   * Fetch one exam.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} examId - Exam id.
   * @returns {Promise<{message: string, data: object}>} The exam.
   * @throws {NotFoundException} If the exam does not exist.
   * @throws {ForbiddenException} If the caller has no access to the exam's campus.
   */
  async getExam(currentUser: CurrentUser, examId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
    const exam = await this.findAccessibleExam(currentUser, examId);
    const range = await this.prisma.examSubject.aggregate({
      where: { examId },
      _min: { examDate: true },
      _max: { examDate: true },
    });
    const withFields = await this.entityCustomFieldsService.attachToItem(
      exam,
      CustomFieldEntity.EXAM,
    );
    // Computed on read from the papers, so editing a paper's date never
    // leaves a stale stored value behind.
    const data = {
      ...withFields,
      datesheetStart: range._min.examDate,
      datesheetEnd: range._max.examDate,
    };
    return { message: 'Exam fetched successfully', data };
  }

  /**
   * Rename an exam or change its grading scale. The class, term and retake
   * links are immutable. The grading scale is frozen once the exam is
   * PUBLISHED so published grades cannot shift under a family.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} examId - Exam id.
   * @param {UpdateExamDto} dto - Fields to change.
   * @returns {Promise<{message: string, data: object}>} The updated exam.
   * @throws {NotFoundException} If the exam or grading scale is not found.
   * @throws {ConflictException} If the grading scale is changed on a published exam.
   */
  async updateExam(
    currentUser: CurrentUser,
    examId: string,
    dto: UpdateExamDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
    const existing = await this.findAccessibleExam(currentUser, examId);

    let gradingScaleId: string | undefined;
    if (
      dto.gradingScaleId !== undefined &&
      dto.gradingScaleId !== existing.gradingScaleId
    ) {
      if (existing.status === ExamStatus.PUBLISHED) {
        throw new ConflictException(
          'The grading scale cannot be changed once the exam is published.',
        );
      }
      const scope = await this.resolveClassScope(existing.classId);
      gradingScaleId = await this.resolveGradingScaleId(
        scope.institutionId,
        dto.gradingScaleId,
      );
    }

    const scope = await this.resolveClassScope(existing.classId);
    const updated = await this.entityCustomFieldsService.saveRecord(
      {
        institutionId: scope.institutionId,
        moduleKey: ModuleKey.EXAMINATIONS,
        entityType: CustomFieldEntity.EXAM,
        values: dto.customFields,
        create: false,
      },
      (transaction) =>
        transaction.exam.update({
          where: { id: examId },
          data: { name: dto.name, gradingScaleId, updatedBy: currentUser.sub },
        }),
    );
    const data = await this.entityCustomFieldsService.attachToItem(
      updated,
      CustomFieldEntity.EXAM,
    );
    return { message: 'Exam updated successfully', data };
  }

  /**
   * Soft-delete an exam.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} examId - Exam id.
   * @param {string} [reason] - Optional recycle-bin delete reason.
   * @returns {Promise<{message: string, data: object}>} The deleted record's identifying fields.
   * @throws {ConflictException} If active retake-type exams still point at this exam.
   */
  async deleteExam(currentUser: CurrentUser, examId: string, reason?: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
    const existing = await this.findAccessibleExam(currentUser, examId);

    const activeRetakes = await this.prisma.exam.count({
      where: { originalExamId: examId },
    });
    if (activeRetakes > 0) {
      throw new ConflictException(
        "Delete this exam's retake, improvement or supplementary exams first.",
      );
    }

    await this.prisma.exam.update({
      where: { id: examId },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });
    return {
      message: 'Exam moved to recycle bin successfully',
      data: { id: existing.id, name: existing.name },
    };
  }

  /**
   * Create a retake, improvement or supplementary exam from a published
   * exam. The class and the link to the original are server-set. A retake of
   * a retake is allowed as long as the exam being retaken is published.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} originalExamId - Exam being retaken.
   * @param {CreateRetakeExamDto} dto - Type, name and optional term / grading scale.
   * @returns {Promise<{message: string, data: object}>} The created exam.
   * @throws {ConflictException} If the original is not published, or this type of retake already exists for it.
   * @throws {BadRequestException} If the chosen term is in a different academic year.
   */
  async createRetakeExam(
    currentUser: CurrentUser,
    originalExamId: string,
    dto: CreateRetakeExamDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
    const original = await this.findAccessibleExam(currentUser, originalExamId);
    if (original.status !== ExamStatus.PUBLISHED) {
      throw new ConflictException(
        'Publish the original exam before creating a retake.',
      );
    }

    const scope = await this.resolveClassScope(original.classId);
    const term = await this.findTermOrThrow(
      scope.institutionId,
      dto.examTermId ?? original.examTermId,
    );
    if (term.academicYearId !== original.academicYearId) {
      throw new BadRequestException(
        "A retake must be in the original exam's academic year.",
      );
    }
    const gradingScaleId = dto.gradingScaleId
      ? await this.resolveGradingScaleId(
          scope.institutionId,
          dto.gradingScaleId,
        )
      : original.gradingScaleId;

    try {
      const created = await this.entityCustomFieldsService.saveRecord(
        {
          institutionId: scope.institutionId,
          moduleKey: ModuleKey.EXAMINATIONS,
          entityType: CustomFieldEntity.EXAM,
          values: dto.customFields,
          create: true,
        },
        (transaction) =>
          transaction.exam.create({
            data: {
              examTermId: term.id,
              academicYearId: original.academicYearId,
              campusId: original.campusId,
              classId: original.classId,
              name: dto.name,
              gradingScaleId,
              examType: dto.examType,
              originalExamId: original.id,
              retakeKey: `${dto.examType}:${original.id}`,
              createdBy: currentUser.sub,
            },
          }),
      );
      const data = await this.entityCustomFieldsService.attachToItem(
        created,
        CustomFieldEntity.EXAM,
      );
      return { message: 'Retake exam created successfully', data };
    } catch (error) {
      this.rethrowExamConflict(error);
    }
  }

  /**
   * List the retake-type exams created from one exam.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} examId - The original exam.
   * @returns {Promise<{message: string, data: object[]}>} Exams whose original is this one.
   */
  async listRetakeExams(currentUser: CurrentUser, examId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
    await this.findAccessibleExam(currentUser, examId);
    const retakes = await this.prisma.exam.findMany({
      where: { originalExamId: examId },
      orderBy: [{ createdAt: 'asc' }],
    });
    const data = await this.entityCustomFieldsService.attachToItems(
      retakes,
      CustomFieldEntity.EXAM,
    );
    return { message: 'Retake exams fetched successfully', data };
  }

  // ---------------------------------------------------------------------
  // Publish / unlock / relock (decision #27)
  // ---------------------------------------------------------------------

  /**
   * Publish a DRAFT exam so its results become visible. Applies to regular
   * and retake-type exams alike.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} examId - Exam id.
   * @returns {Promise<{message: string, data: object}>} The published exam.
   * @throws {ConflictException} If the exam is already published.
   */
  async publishExam(currentUser: CurrentUser, examId: string) {
    return this.transitionExam(currentUser, examId, {
      action: 'EXAM_PUBLISHED',
      message: 'Exam published successfully',
      assert: (exam) => {
        if (exam.status === ExamStatus.PUBLISHED) {
          throw new ConflictException('This exam is already published.');
        }
      },
      data: (currentUserId) => ({
        status: ExamStatus.PUBLISHED,
        unlockedForEditing: false,
        publishedAt: new Date(),
        publishedBy: currentUserId,
      }),
    });
  }

  /**
   * Open a PUBLISHED exam for correction. The unlock is a temporary edit
   * window, not a third lifecycle state, and is audited separately from the
   * mark edits made while it is open.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} examId - Exam id.
   * @returns {Promise<{message: string, data: object}>} The unlocked exam.
   * @throws {ConflictException} If the exam is still a draft or is already unlocked.
   */
  async unlockExam(currentUser: CurrentUser, examId: string) {
    return this.transitionExam(currentUser, examId, {
      action: 'EXAM_UNLOCKED',
      message: 'Exam unlocked for editing',
      assert: (exam) => {
        if (exam.status !== ExamStatus.PUBLISHED) {
          throw new ConflictException(
            'Only a published exam can be unlocked. Draft exams are already editable.',
          );
        }
        if (exam.unlockedForEditing) {
          throw new ConflictException('This exam is already unlocked.');
        }
      },
      data: () => ({ unlockedForEditing: true }),
    });
  }

  /**
   * Close the correction window opened by `unlockExam`.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} examId - Exam id.
   * @returns {Promise<{message: string, data: object}>} The relocked exam.
   * @throws {ConflictException} If the exam is not currently unlocked.
   */
  async relockExam(currentUser: CurrentUser, examId: string) {
    return this.transitionExam(currentUser, examId, {
      action: 'EXAM_RELOCKED',
      message: 'Exam locked again',
      assert: (exam) => {
        if (exam.status !== ExamStatus.PUBLISHED || !exam.unlockedForEditing) {
          throw new ConflictException('This exam is not currently unlocked.');
        }
      },
      data: () => ({ unlockedForEditing: false }),
    });
  }

  /**
   * Shared body of the three workflow actions: check access, validate the
   * state change against the freshly read exam, then write the change and
   * its dedicated audit entry in one transaction.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} examId - Exam id.
   * @param {object} transition - Audit action, response message, state guard and the data to write.
   * @returns {Promise<{message: string, data: object}>} The updated exam.
   */
  private async transitionExam(
    currentUser: CurrentUser,
    examId: string,
    transition: {
      action: string;
      message: string;
      assert: (exam: {
        status: ExamStatus;
        unlockedForEditing: boolean;
      }) => void;
      data: (currentUserId: string) => Prisma.ExamUncheckedUpdateInput;
    },
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
    const exam = await this.findAccessibleExam(currentUser, examId);
    transition.assert(exam);
    const scope = await this.resolveClassScope(exam.classId);

    const data = await runAuditedTransaction(
      this.prisma,
      this.requestContext,
      async (transaction) => {
        // The state is re-checked in the same write, so two admins acting at
        // once cannot both succeed.
        const updated = await transaction.exam.updateMany({
          where: {
            id: examId,
            status: exam.status,
            unlockedForEditing: exam.unlockedForEditing,
          },
          data: {
            ...transition.data(currentUser.sub),
            updatedBy: currentUser.sub,
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            'This exam changed while you were working. Reload it and try again.',
          );
        }
        await this.auditLogService.log(
          currentUser,
          {
            action: transition.action,
            entity: 'Exam',
            entityId: examId,
            institutionId: scope.institutionId,
            metadata: { name: exam.name, examType: exam.examType },
          },
          transaction,
        );
        return transaction.exam.findUniqueOrThrow({ where: { id: examId } });
      },
    );
    return { message: transition.message, data };
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /**
   * Validate a band set: each band must have min <= max, grades must be
   * unique, and no two percentage ranges may overlap. Gaps are allowed (a
   * percentage in a gap resolves to "Ungraded" at read time). Done at the
   * service layer because the schema does not use range-exclusion
   * constraints (no btree_gist extension).
   *
   * @param {GradeBandInputDto[]} bands - Incoming bands.
   * @returns {void}
   * @throws {BadRequestException} Naming the offending band(s).
   */
  private assertBandsValid(bands: GradeBandInputDto[]): void {
    const seen = new Set<string>();
    for (const band of bands) {
      if (band.minPercentage > band.maxPercentage) {
        throw new BadRequestException(
          `Grade "${band.grade}": the minimum percentage cannot be greater than the maximum.`,
        );
      }
      const key = band.grade.trim().toLowerCase();
      if (seen.has(key)) {
        throw new BadRequestException(
          `Grade "${band.grade}" appears more than once in this scale.`,
        );
      }
      seen.add(key);
    }

    const ordered = [...bands].sort(
      (a, b) => a.minPercentage - b.minPercentage,
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (current.minPercentage <= previous.maxPercentage) {
        throw new BadRequestException(
          `Grades "${previous.grade}" and "${current.grade}" have overlapping percentage ranges.`,
        );
      }
    }
  }

  /**
   * Map validated band inputs to insertable rows, defaulting the display
   * order to the input order.
   *
   * @param {string} gradingScaleId - Parent scale id.
   * @param {GradeBandInputDto[]} bands - Validated bands.
   * @returns {Prisma.GradeBandUncheckedCreateInput[]} Rows ready for create.
   */
  private toBandRows(
    gradingScaleId: string,
    bands: GradeBandInputDto[],
  ): Prisma.GradeBandUncheckedCreateInput[] {
    return bands.map((band, index) => ({
      gradingScaleId,
      grade: band.grade.trim(),
      minPercentage: band.minPercentage,
      maxPercentage: band.maxPercentage,
      remarks: band.remarks ?? null,
      sortOrder: band.sortOrder ?? index,
    }));
  }

  /**
   * Replace all bands of a scale: existing rows are soft-deleted with a
   * rotated `activeScopeKey` (freeing the `[scale, grade]` unique slot),
   * then the incoming set is inserted. Same approach as
   * `AcademicsService.replaceCampusOverrides`.
   *
   * @param {Prisma.TransactionClient} tx - Active transaction client.
   * @param {string} gradingScaleId - Parent scale id.
   * @param {CurrentUser} currentUser - Recorded as the deleter of superseded rows.
   * @param {GradeBandInputDto[]} bands - Full replacement set.
   * @returns {Promise<void>}
   */
  private async replaceBands(
    tx: Prisma.TransactionClient,
    gradingScaleId: string,
    currentUser: CurrentUser,
    bands: GradeBandInputDto[],
  ): Promise<void> {
    const existing = await tx.gradeBand.findMany({
      where: { gradingScaleId },
      select: { id: true },
    });

    await Promise.all(
      existing.map((row) =>
        tx.gradeBand.update({
          where: { id: row.id },
          data: {
            deletedAt: new Date(),
            deletedBy: currentUser.sub,
            deleteReason: 'Superseded by grading scale update',
            updatedBy: currentUser.sub,
            activeScopeKey: `REPLACED-${row.id}`,
          },
        }),
      ),
    );

    await this.createBands(tx, gradingScaleId, bands);
  }

  /**
   * Insert bands one row at a time. `createMany` is not audited by the
   * Prisma audit extension, and a scale holds only a handful of bands, so
   * per-row `create` keeps every band in the audit trail at negligible cost.
   *
   * @param {Prisma.TransactionClient} tx - Active transaction client.
   * @param {string} gradingScaleId - Parent scale id.
   * @param {GradeBandInputDto[]} bands - Validated bands.
   * @returns {Promise<void>}
   */
  private async createBands(
    tx: Prisma.TransactionClient,
    gradingScaleId: string,
    bands: GradeBandInputDto[],
  ): Promise<void> {
    for (const data of this.toBandRows(gradingScaleId, bands)) {
      await tx.gradeBand.create({ data });
    }
  }

  /**
   * Build the data for a soft delete. The `activeScopeKey` is rotated to
   * `DELETED:{id}` so the record's name stops occupying the unique index; a
   * plain `deletedAt` update would leave the key as `ACTIVE` and block reuse
   * of the name forever. Restoring resets the key (see the Prisma
   * extension's update stamping).
   *
   * @param {string} id - Record being deleted.
   * @param {CurrentUser} currentUser - Recorded as the deleter.
   * @param {string} [reason] - Optional delete reason.
   * @returns {{deletedAt: Date, deletedBy: string, deleteReason: string | null, updatedBy: string, activeScopeKey: string}}
   */
  private softDeleteData(
    id: string,
    currentUser: CurrentUser,
    reason?: string,
  ) {
    return {
      deletedAt: new Date(),
      deletedBy: currentUser.sub,
      deleteReason: reason ?? null,
      updatedBy: currentUser.sub,
      activeScopeKey: `DELETED:${id}`,
    };
  }

  /**
   * Load a class and walk to its campus and institution.
   *
   * @param {string} classId - Class id.
   * @returns {Promise<{campusId: string, institutionId: string}>} The class's scope.
   * @throws {NotFoundException} If the class does not exist.
   */
  private async resolveClassScope(classId: string) {
    const academicClass = await this.prisma.academicClass.findUnique({
      where: { id: classId },
      select: {
        level: {
          select: {
            campusId: true,
            campus: { select: { institutionId: true } },
          },
        },
      },
    });
    const institutionId = academicClass?.level.campus.institutionId;
    if (!academicClass || !institutionId) {
      throw new NotFoundException('Class not found.');
    }
    return { campusId: academicClass.level.campusId, institutionId };
  }

  /**
   * Resolve the grading scale for a new exam: the explicit one (which must
   * belong to the institution), else the institution's current scale.
   *
   * @param {string} institutionId - Institution the exam belongs to.
   * @param {string} [explicitId] - Grading scale chosen by the caller.
   * @returns {Promise<string>} The grading scale id to pin on the exam.
   * @throws {NotFoundException} If the explicit scale is not in this institution.
   * @throws {ConflictException} If there is no explicit and no current scale.
   */
  private async resolveGradingScaleId(
    institutionId: string,
    explicitId?: string,
  ): Promise<string> {
    if (explicitId) {
      const scale = await this.prisma.gradingScale.findUnique({
        where: { id: explicitId },
        select: { institutionId: true },
      });
      if (!scale || scale.institutionId !== institutionId) {
        throw new NotFoundException('Grading scale not found.');
      }
      return explicitId;
    }

    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { currentGradingScaleId: true },
    });
    if (!institution?.currentGradingScaleId) {
      throw new ConflictException(
        'Set up a grading scale before creating exams.',
      );
    }
    return institution.currentGradingScaleId;
  }

  private async findAccessibleExam(currentUser: CurrentUser, examId: string) {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new NotFoundException('Exam not found.');
    }
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      exam.campusId,
    );
    return exam;
  }

  private rethrowExamConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'This class already has an exam of this type for the term.',
      );
    }
    throw error;
  }

  private assertDateRange(startDate?: string, endDate?: string): void {
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      throw new BadRequestException(
        'The start date must not be after the end date.',
      );
    }
  }

  private async assertAcademicYearInInstitution(
    institutionId: string,
    academicYearId: string,
  ): Promise<void> {
    const year = await this.prisma.academicYear.findUnique({
      where: { id: academicYearId },
      select: { institutionId: true },
    });
    if (!year || year.institutionId !== institutionId) {
      throw new NotFoundException('Academic year not found.');
    }
  }

  private async findScaleOrThrow(
    institutionId: string,
    gradingScaleId: string,
  ) {
    const scale = await this.prisma.gradingScale.findUnique({
      where: { id: gradingScaleId },
      include: ACTIVE_BANDS_INCLUDE,
    });
    if (!scale || scale.institutionId !== institutionId) {
      throw new NotFoundException('Grading scale not found.');
    }
    return scale;
  }

  private async findTermOrThrow(institutionId: string, examTermId: string) {
    const term = await this.prisma.examTerm.findUnique({
      where: { id: examTermId },
    });
    if (!term || term.institutionId !== institutionId) {
      throw new NotFoundException('Exam term not found.');
    }
    return term;
  }

  /**
   * Verify the institution exists and the Examinations module is enabled
   * for the caller, before any other work.
   *
   * @param {string} institutionId - Institution id to verify.
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<void>}
   * @throws {NotFoundException} If the institution does not exist.
   */
  private async assertInstitutionAndModule(
    institutionId: string,
    currentUser: CurrentUser,
  ): Promise<void> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true },
    });
    if (!institution) {
      throw new NotFoundException('Institution not found.');
    }
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.EXAMINATIONS,
    );
  }

  private rethrowUniqueConflict(error: unknown, label: string): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        `An active ${label} with this name already exists.`,
      );
    }
    throw error;
  }
}
