import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ModuleAccessService } from '../../common/services/module-access.service';
import {
  EnrollmentStatus,
  ModuleKey,
  Prisma,
  UserRole,
} from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateNoticeDto,
  ListNoticesForMeQueryDto,
  ListNoticesQueryDto,
  UpdateNoticeDto,
} from './dto/notices.dto';

/** One real class/section placement a user (or one of their wards) currently
 *  holds, used to test a notice's class/section scope against. */
type ClassSectionTuple = { classId: string; sectionId: string | null };

/** Minimal notice shape the campus-access check needs. */
type NoticeCampusScope = { campusId: string | null };

/** Minimal scope shape the hierarchy validator needs — shared by create
 *  (fresh values) and update (existing values merged with the patch). */
type NoticeHierarchyScope = {
  campusId?: string | null;
  classId?: string | null;
  sectionId?: string | null;
};

@Injectable()
export class NoticesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly campusAccessService: CampusAccessService,
    private readonly moduleAccessService: ModuleAccessService,
  ) {}

  /**
   * Creates a notice within the caller's institution, optionally narrowed to
   * a campus/class/section/role audience (§ 5.4, § 7.3).
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {CreateNoticeDto} dto - Notice payload.
   * @returns {Promise<{message: string, data: object}>}
   * @throws {ForbiddenException} If the caller has no institution context, or no access to the given campus.
   * @throws {BadRequestException} If classId/sectionId/campusId don't form a consistent hierarchy.
   * @throws {NotFoundException} If a given classId/sectionId doesn't exist.
   */
  async createNotice(
    institutionId: string,
    currentUser: CurrentUser,
    dto: CreateNoticeDto,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.NOTICES,
    );

    if (dto.campusId) {
      await this.campusAccessService.assertCampusAccess(
        currentUser,
        dto.campusId,
      );
    }
    await this.validateHierarchy(dto);

    const notice = await this.prisma.notice.create({
      data: {
        institutionId,
        campusId: dto.campusId ?? null,
        classId: dto.classId ?? null,
        sectionId: dto.sectionId ?? null,
        targetRole: dto.targetRole ?? null,
        title: dto.title,
        body: dto.body,
        attachments: this.toJsonOrUndefined(dto.attachments),
        publishAt: dto.publishAt ? new Date(dto.publishAt) : undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdBy: currentUser.sub,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'NOTICE_CREATED',
      entity: 'Notice',
      entityId: notice.id,
      institutionId,
      metadata: { title: notice.title },
    });

    return { message: 'Notice created successfully', data: notice };
  }

  /**
   * Admin/staff management list — unpaginated, matching this codebase's
   * other admin config lists (§ 9's contrast with the paginated
   * `for-me` feed). Scoped to campuses the caller can access; institution-
   * wide notices (campusId null) always included.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {ListNoticesQueryDto} query - Optional campus/class/section/role/includeExpired filters.
   * @returns {Promise<{message: string, data: object[]}>}
   */
  async listNotices(
    institutionId: string,
    currentUser: CurrentUser,
    query: ListNoticesQueryDto,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.NOTICES,
    );

    if (query.campusId) {
      await this.campusAccessService.assertCampusAccess(
        currentUser,
        query.campusId,
      );
    }
    const campusIds = query.campusId
      ? [query.campusId]
      : await this.campusAccessService.getCampusIdsForUser(currentUser);

    const now = new Date();
    const where: Prisma.NoticeWhereInput = {
      institutionId,
      deletedAt: null,
      OR: [{ campusId: null }, { campusId: { in: campusIds } }],
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.targetRole ? { targetRole: query.targetRole } : {}),
      ...(query.includeExpired
        ? {}
        : {
            AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }],
          }),
    };

    const items = await this.prisma.notice.findMany({
      where,
      orderBy: { publishAt: 'desc' },
    });

    return { message: 'Notices retrieved successfully', data: items };
  }

  /**
   * Self-service feed: notices whose audience scope matches the calling
   * user, restricted to the current publish window (§ 7.6's resolution
   * algorithm — see the class/section design note on
   * `resolveAudienceClassSectionTuples` for the one gap the design doc left
   * unspecified). Paginated by design (§ 9).
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {ListNoticesForMeQueryDto} query - page/limit.
   * @returns {Promise<{message: string, data: {items: object[], total: number, page: number, limit: number}}>}
   */
  async listNoticesForMe(
    currentUser: CurrentUser,
    query: ListNoticesForMeQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    if (!currentUser.institutionId) {
      // SUPERADMIN (or any account with no institution context) simply has
      // no personal notice feed — return an empty page rather than throw,
      // same "no current context = empty result" convention as
      // attachCurrentEnrollment's no-current-academic-year case.
      return {
        message: 'Notices retrieved successfully',
        data: { items: [], total: 0, page, limit },
      };
    }

    const [campusIds, classSectionTuples] = await Promise.all([
      this.campusAccessService.getCampusIdsForUser(currentUser),
      this.resolveAudienceClassSectionTuples(currentUser),
    ]);

    const now = new Date();
    const where: Prisma.NoticeWhereInput = {
      institutionId: currentUser.institutionId,
      deletedAt: null,
      publishAt: { lte: now },
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
        { OR: [{ campusId: null }, { campusId: { in: campusIds } }] },
        { OR: [{ targetRole: null }, { targetRole: currentUser.role }] },
        this.buildClassSectionWhere(classSectionTuples),
      ],
    };

    const skip = (page - 1) * limit;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notice.findMany({
        where,
        orderBy: { publishAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notice.count({ where }),
    ]);

    return {
      message: 'Notices retrieved successfully',
      data: { items, total, page, limit },
    };
  }

  /**
   * Detail read for the admin/staff management screen.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} id - Notice id.
   * @returns {Promise<{message: string, data: object}>}
   * @throws {NotFoundException} If the notice doesn't exist in the caller's institution.
   * @throws {ForbiddenException} If the notice is campus-scoped to a campus the caller can't access.
   */
  async getNotice(institutionId: string, currentUser: CurrentUser, id: string) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.NOTICES,
    );
    const notice = await this.findNoticeOrThrow(id, institutionId);
    await this.assertNoticeCampusAccess(currentUser, notice);

    return { message: 'Notice retrieved successfully', data: notice };
  }

  /**
   * Partial update, re-running the same hierarchy validation as create
   * against the merged (existing + patch) scope.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} id - Notice id.
   * @param {UpdateNoticeDto} dto - Partial notice payload.
   * @returns {Promise<{message: string, data: object}>}
   * @throws {NotFoundException} If the notice doesn't exist in the caller's institution.
   * @throws {ForbiddenException} If the caller lacks access to the (existing or newly requested) campus.
   * @throws {BadRequestException} If the resulting classId/sectionId/campusId hierarchy is inconsistent.
   */
  async updateNotice(
    institutionId: string,
    currentUser: CurrentUser,
    id: string,
    dto: UpdateNoticeDto,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.NOTICES,
    );
    const existing = await this.findNoticeOrThrow(id, institutionId);
    await this.assertNoticeCampusAccess(currentUser, existing);

    if (dto.campusId) {
      await this.campusAccessService.assertCampusAccess(
        currentUser,
        dto.campusId,
      );
    }
    await this.validateHierarchy({
      campusId: dto.campusId !== undefined ? dto.campusId : existing.campusId,
      classId: dto.classId !== undefined ? dto.classId : existing.classId,
      sectionId:
        dto.sectionId !== undefined ? dto.sectionId : existing.sectionId,
    });

    const notice = await this.prisma.notice.update({
      where: { id },
      data: {
        ...(dto.campusId !== undefined ? { campusId: dto.campusId } : {}),
        ...(dto.classId !== undefined ? { classId: dto.classId } : {}),
        ...(dto.sectionId !== undefined ? { sectionId: dto.sectionId } : {}),
        ...(dto.targetRole !== undefined ? { targetRole: dto.targetRole } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.attachments !== undefined
          ? { attachments: this.toJsonOrUndefined(dto.attachments) }
          : {}),
        ...(dto.publishAt !== undefined
          ? { publishAt: new Date(dto.publishAt) }
          : {}),
        ...(dto.expiresAt !== undefined
          ? { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null }
          : {}),
        updatedBy: currentUser.sub,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'NOTICE_UPDATED',
      entity: 'Notice',
      entityId: id,
      institutionId,
      metadata: { updatedFields: Object.keys(dto) },
    });

    return { message: 'Notice updated successfully', data: notice };
  }

  /**
   * Soft-deletes a notice (moves it to the recycle bin).
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} id - Notice id.
   * @param {string} [reason] - Optional recycle-bin deletion reason.
   * @returns {Promise<{message: string, data: {id: string}}>}
   * @throws {NotFoundException} If the notice doesn't exist in the caller's institution.
   * @throws {ForbiddenException} If the notice is campus-scoped to a campus the caller can't access.
   */
  async deleteNotice(
    institutionId: string,
    currentUser: CurrentUser,
    id: string,
    reason?: string,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.NOTICES,
    );
    const existing = await this.findNoticeOrThrow(id, institutionId);
    await this.assertNoticeCampusAccess(currentUser, existing);

    await this.prisma.notice.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'NOTICE_DELETED',
      entity: 'Notice',
      entityId: id,
      institutionId,
      metadata: { title: existing.title, reason: reason ?? null },
    });

    return {
      message: 'Notice moved to recycle bin successfully',
      data: { id },
    };
  }

  // ---------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------

  /**
   * Verifies `institutionId` actually resolves to a real row before any
   * write/read against it — matters specifically for the superadmin
   * platform-mirror path (`/platform/institutions/:institutionId/notices`),
   * where institutionId comes straight from the URL rather than the
   * caller's own JWT. Mirrors RolesService.ensureInstitutionExists.
   */
  private async ensureInstitutionExists(institutionId: string) {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true },
    });
    if (!institution) {
      throw new NotFoundException('Institution not found.');
    }
  }

  private async findNoticeOrThrow(id: string, institutionId: string) {
    const notice = await this.prisma.notice.findFirst({
      where: { id, institutionId, deletedAt: null },
    });

    if (!notice) {
      throw new NotFoundException('Notice not found.');
    }

    return notice;
  }

  private async assertNoticeCampusAccess(
    currentUser: CurrentUser,
    notice: NoticeCampusScope,
  ) {
    if (notice.campusId) {
      await this.campusAccessService.assertCampusAccess(
        currentUser,
        notice.campusId,
      );
    }
  }

  /**
   * Validates that sectionId/classId/campusId form a consistent hierarchy
   * (§ 7.3): a sectionId must belong to the given classId, and a classId
   * must belong to the given campusId, whenever both sides of a check are
   * present. Called with fresh DTO values on create, and with the merged
   * (existing + patch) scope on update.
   *
   * @param {NoticeHierarchyScope} scope - The campusId/classId/sectionId combination to validate.
   * @throws {NotFoundException} If a given classId or sectionId doesn't exist.
   * @throws {BadRequestException} On any hierarchy mismatch.
   */
  private async validateHierarchy(scope: NoticeHierarchyScope) {
    if (scope.classId) {
      const academicClass = await this.prisma.academicClass.findUnique({
        where: { id: scope.classId },
        select: { level: { select: { campusId: true } } },
      });
      if (!academicClass) {
        throw new NotFoundException('Class not found.');
      }
      if (scope.campusId && academicClass.level.campusId !== scope.campusId) {
        throw new BadRequestException(
          'classId does not belong to the selected campusId.',
        );
      }
    }

    if (scope.sectionId) {
      const section = await this.prisma.section.findUnique({
        where: { id: scope.sectionId },
        select: {
          classId: true,
          class: { select: { level: { select: { campusId: true } } } },
        },
      });
      if (!section) {
        throw new NotFoundException('Section not found.');
      }
      if (scope.classId && section.classId !== scope.classId) {
        throw new BadRequestException(
          'sectionId does not belong to the selected classId.',
        );
      }
      if (scope.campusId && section.class.level.campusId !== scope.campusId) {
        throw new BadRequestException(
          'sectionId does not belong to the selected campusId.',
        );
      }
    }
  }

  /**
   * Resolves the calling user's own class/section standing(s) for audience
   * matching in `listNoticesForMe`.
   *
   * Design note (§ 7.6 of the design doc left the exact mechanics
   * unspecified for non-STUDENT roles): ADMIN and STAFF have no personal
   * class/section placement in this schema — a class/section-scoped notice
   * is only ever "for" the students of that class/section and their
   * guardians, never for staff/admin's own personal feed (they still see it
   * on the unpaginated admin `GET /notices` management list, which isn't
   * scoped by personal class/section at all). This is a design call made
   * while implementing this endpoint, not something the design doc itself
   * specified.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @returns {Promise<ClassSectionTuple[]>} Zero, one (STUDENT), or many (GUARDIAN, one per ward) tuples.
   */
  private async resolveAudienceClassSectionTuples(
    currentUser: CurrentUser,
  ): Promise<ClassSectionTuple[]> {
    if (currentUser.role === UserRole.STUDENT) {
      const student = await this.prisma.student.findFirst({
        where: { userId: currentUser.sub, deletedAt: null },
        select: { id: true, institutionId: true },
      });
      if (!student) {
        return [];
      }
      return this.resolveCurrentEnrollmentTuples(student.institutionId, [
        student.id,
      ]);
    }

    if (currentUser.role === UserRole.GUARDIAN) {
      const guardian = await this.prisma.guardian.findFirst({
        where: { userId: currentUser.sub, deletedAt: null },
        select: { id: true },
      });
      if (!guardian) {
        return [];
      }

      const wardLinks = await this.prisma.studentGuardian.findMany({
        where: {
          guardianId: guardian.id,
          deletedAt: null,
          student: { deletedAt: null },
        },
        select: { student: { select: { id: true, institutionId: true } } },
      });
      if (!wardLinks.length) {
        return [];
      }

      // Guardians only ever have wards within their own institution in
      // practice; institutionId is read off the first ward rather than the
      // guardian record itself (Guardian has no direct institutionId field).
      const institutionId = wardLinks[0].student.institutionId;
      const studentIds = wardLinks.map((link) => link.student.id);
      return this.resolveCurrentEnrollmentTuples(institutionId, studentIds);
    }

    // ADMIN/STAFF — see the design note above.
    return [];
  }

  /**
   * Mirrors PeopleService.attachCurrentEnrollment's resolution shape: the
   * institution's `currentAcademicYearId` pointer, then each student's
   * non-LEFT StudentEnrollment row at that year.
   *
   * @param {string} institutionId
   * @param {string[]} studentIds
   * @returns {Promise<ClassSectionTuple[]>} Empty when there's no current academic year (mirrors the "no current context" convention) or no matching enrollment.
   */
  private async resolveCurrentEnrollmentTuples(
    institutionId: string,
    studentIds: string[],
  ): Promise<ClassSectionTuple[]> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { currentAcademicYearId: true },
    });
    if (!institution?.currentAcademicYearId) {
      return [];
    }

    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        studentId: { in: studentIds },
        academicYearId: institution.currentAcademicYearId,
        status: { not: EnrollmentStatus.LEFT },
        deletedAt: null,
      },
      select: { classId: true, sectionId: true },
    });

    return enrollments.map((enrollment) => ({
      classId: enrollment.classId,
      sectionId: enrollment.sectionId,
    }));
  }

  /**
   * Builds the class/section dimension of the `for-me` WHERE clause: a
   * notice unconstrained on this dimension (classId and sectionId both
   * null) always matches; otherwise the notice must match at least one of
   * the caller's real class/section tuples exactly (sectionId, when set on
   * the notice, must match; a null notice.sectionId matches any tuple in
   * that class).
   *
   * @param {ClassSectionTuple[]} tuples - The caller's own (or their wards') current placements.
   * @returns {Prisma.NoticeWhereInput}
   */
  private buildClassSectionWhere(
    tuples: ClassSectionTuple[],
  ): Prisma.NoticeWhereInput {
    const unconstrained: Prisma.NoticeWhereInput = {
      classId: null,
      sectionId: null,
    };

    if (!tuples.length) {
      return unconstrained;
    }

    return {
      OR: [
        unconstrained,
        ...tuples.map(
          (tuple): Prisma.NoticeWhereInput => ({
            AND: [
              { OR: [{ classId: null }, { classId: tuple.classId }] },
              { OR: [{ sectionId: null }, { sectionId: tuple.sectionId }] },
            ],
          }),
        ),
      ],
    };
  }

  private toJsonOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) {
      return undefined;
    }

    return value as Prisma.InputJsonValue;
  }
}
