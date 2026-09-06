import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { ModuleKey, Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePeriodSlotDto,
  ListPeriodSlotsQueryDto,
  UpdatePeriodSlotDto,
} from './dto/timetable.dto';

/** Section's resolved scheduling scope (§ 4 of
 *  M3-SCHEDULING-COMMUNICATION-DESIGN.md: section -> class -> level ->
 *  campus is the authoritative hop chain — campusId is never client-supplied). */
type SectionScope = { campusId: string; classId: string };

/** Minimal shape the soft TeacherSubject cross-check needs (§ 5.2's own
 *  commentary) — subjectId/staffProfileId are optional because the check is
 *  a no-op unless both are present on the final (post-merge) state. */
type TeacherSubjectCheckScope = {
  staffProfileId?: string | null;
  subjectId?: string | null;
  classId: string;
  sectionId: string;
};

@Injectable()
export class TimetableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly campusAccessService: CampusAccessService,
    private readonly moduleAccessService: ModuleAccessService,
  ) {}

  /**
   * Creates a period slot on a section's weekly schedule template (§ 5.2,
   * § 7.1). campusId is always resolved server-side from sectionId, never
   * trusted from the client.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {CreatePeriodSlotDto} dto - Period slot payload.
   * @returns {Promise<{message: string, data: object}>}
   * @throws {NotFoundException} If sectionId does not exist.
   * @throws {BadRequestException} If classId does not match sectionId's own class.
   * @throws {ForbiddenException} If the caller lacks access to the resolved campus.
   * @throws {ConflictException} If (sectionId, dayOfWeek, periodNumber) already has a slot, or the subject/teacher cross-check fails.
   */
  async createPeriodSlot(currentUser: CurrentUser, dto: CreatePeriodSlotDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.TIMETABLE,
    );

    const scope = await this.resolveSectionScope(dto.sectionId);
    this.assertClassMatchesSection(dto.classId, scope);
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      scope.campusId,
    );
    await this.assertTeacherSubjectAllocation({
      staffProfileId: dto.staffProfileId,
      subjectId: dto.subjectId,
      classId: dto.classId,
      sectionId: dto.sectionId,
    });

    try {
      const periodSlot = await this.prisma.periodSlot.create({
        data: {
          campusId: scope.campusId,
          classId: dto.classId,
          sectionId: dto.sectionId,
          subjectId: dto.subjectId ?? null,
          staffProfileId: dto.staffProfileId ?? null,
          name: dto.name,
          periodNumber: dto.periodNumber,
          dayOfWeek: dto.dayOfWeek,
          startTime: dto.startTime,
          endTime: dto.endTime,
          createdBy: currentUser.sub,
        },
      });

      await this.auditLogService.log(currentUser, {
        action: 'PERIOD_SLOT_CREATED',
        entity: 'PeriodSlot',
        entityId: periodSlot.id,
        institutionId: currentUser.institutionId ?? null,
        metadata: {
          name: periodSlot.name,
          sectionId: periodSlot.sectionId,
          dayOfWeek: periodSlot.dayOfWeek,
          periodNumber: periodSlot.periodNumber,
        },
      });

      return { message: 'Period slot created successfully', data: periodSlot };
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  /**
   * Admin/staff management list — unpaginated, matching this codebase's
   * other admin config lists (e.g. student_enrollments).
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {ListPeriodSlotsQueryDto} query - Optional campus/class/section/dayOfWeek filters.
   * @returns {Promise<{message: string, data: object[]}>}
   */
  async listPeriodSlots(
    currentUser: CurrentUser,
    query: ListPeriodSlotsQueryDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.TIMETABLE,
    );

    if (query.campusId) {
      await this.campusAccessService.assertCampusAccess(
        currentUser,
        query.campusId,
      );
    }
    if (query.classId) {
      await this.campusAccessService.assertClassAccess(
        currentUser,
        query.classId,
      );
    }
    if (query.sectionId) {
      await this.campusAccessService.assertSectionAccess(
        currentUser,
        query.sectionId,
      );
    }

    const campusIds = query.campusId
      ? [query.campusId]
      : currentUser.role === UserRole.SUPERADMIN
        ? undefined
        : await this.campusAccessService.getCampusIdsForUser(currentUser);

    const items = await this.prisma.periodSlot.findMany({
      where: {
        deletedAt: null,
        ...(campusIds ? { campusId: { in: campusIds } } : {}),
        ...(query.classId ? { classId: query.classId } : {}),
        ...(query.sectionId ? { sectionId: query.sectionId } : {}),
        ...(query.dayOfWeek ? { dayOfWeek: query.dayOfWeek } : {}),
      },
      orderBy: [{ dayOfWeek: 'asc' }, { periodNumber: 'asc' }],
    });

    return { message: 'Period slots retrieved successfully', data: items };
  }

  /**
   * Full weekly grid for one section (§ 7.1), ordered by dayOfWeek then
   * periodNumber — the shape a (future, not built here) student timetable
   * view or datesheet builder would consume directly.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} sectionId - Section to fetch the weekly schedule for.
   * @returns {Promise<{message: string, data: object[]}>}
   * @throws {ForbiddenException} If the caller lacks access to this section's campus, or the section doesn't exist.
   */
  async getWeeklyGrid(currentUser: CurrentUser, sectionId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.TIMETABLE,
    );
    await this.campusAccessService.assertSectionAccess(currentUser, sectionId);

    const items = await this.prisma.periodSlot.findMany({
      where: { sectionId, deletedAt: null },
      orderBy: [{ dayOfWeek: 'asc' }, { periodNumber: 'asc' }],
    });

    return { message: 'Weekly timetable retrieved successfully', data: items };
  }

  /**
   * Detail read for the admin/staff management screen.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} id - Period slot id.
   * @returns {Promise<{message: string, data: object}>}
   * @throws {NotFoundException} If the period slot doesn't exist.
   * @throws {ForbiddenException} If the caller lacks access to its campus.
   */
  async getPeriodSlot(currentUser: CurrentUser, id: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.TIMETABLE,
    );
    const periodSlot = await this.findPeriodSlotOrThrow(id);
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      periodSlot.campusId,
    );

    return { message: 'Period slot retrieved successfully', data: periodSlot };
  }

  /**
   * Partial update of any field (§ 7.1). Re-resolves campusId from
   * sectionId whenever sectionId or classId change, and re-runs the
   * TeacherSubject cross-check whenever the final (post-merge) subject,
   * teacher, class, or section differ from what's stored.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} id - Period slot id.
   * @param {UpdatePeriodSlotDto} dto - Partial period slot payload.
   * @returns {Promise<{message: string, data: object}>}
   * @throws {NotFoundException} If the period slot or a newly given sectionId doesn't exist.
   * @throws {BadRequestException} If the resulting classId/sectionId pair is inconsistent.
   * @throws {ForbiddenException} If the caller lacks access to the (existing or newly resolved) campus.
   * @throws {ConflictException} If the update collides with another slot's (sectionId, dayOfWeek, periodNumber), or the subject/teacher cross-check fails.
   */
  async updatePeriodSlot(
    currentUser: CurrentUser,
    id: string,
    dto: UpdatePeriodSlotDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.TIMETABLE,
    );
    const existing = await this.findPeriodSlotOrThrow(id);
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );

    const finalSectionId = dto.sectionId ?? existing.sectionId;
    const finalClassId = dto.classId ?? existing.classId;
    const scopeChanged =
      dto.sectionId !== undefined || dto.classId !== undefined;

    let campusId = existing.campusId;
    if (scopeChanged) {
      const scope = await this.resolveSectionScope(finalSectionId);
      this.assertClassMatchesSection(finalClassId, scope);
      campusId = scope.campusId;
      if (campusId !== existing.campusId) {
        await this.campusAccessService.assertCampusAccess(
          currentUser,
          campusId,
        );
      }
    }

    const finalSubjectId =
      dto.subjectId !== undefined ? dto.subjectId : existing.subjectId;
    const finalStaffProfileId =
      dto.staffProfileId !== undefined
        ? dto.staffProfileId
        : existing.staffProfileId;

    if (
      scopeChanged ||
      dto.subjectId !== undefined ||
      dto.staffProfileId !== undefined
    ) {
      await this.assertTeacherSubjectAllocation({
        staffProfileId: finalStaffProfileId,
        subjectId: finalSubjectId,
        classId: finalClassId,
        sectionId: finalSectionId,
      });
    }

    try {
      const periodSlot = await this.prisma.periodSlot.update({
        where: { id },
        data: {
          ...(dto.classId !== undefined ? { classId: dto.classId } : {}),
          ...(dto.sectionId !== undefined ? { sectionId: dto.sectionId } : {}),
          ...(scopeChanged ? { campusId } : {}),
          ...(dto.subjectId !== undefined ? { subjectId: dto.subjectId } : {}),
          ...(dto.staffProfileId !== undefined
            ? { staffProfileId: dto.staffProfileId }
            : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.periodNumber !== undefined
            ? { periodNumber: dto.periodNumber }
            : {}),
          ...(dto.dayOfWeek !== undefined ? { dayOfWeek: dto.dayOfWeek } : {}),
          ...(dto.startTime !== undefined ? { startTime: dto.startTime } : {}),
          ...(dto.endTime !== undefined ? { endTime: dto.endTime } : {}),
          updatedBy: currentUser.sub,
        },
      });

      await this.auditLogService.log(currentUser, {
        action: 'PERIOD_SLOT_UPDATED',
        entity: 'PeriodSlot',
        entityId: id,
        institutionId: currentUser.institutionId ?? null,
        metadata: { updatedFields: Object.keys(dto) },
      });

      return { message: 'Period slot updated successfully', data: periodSlot };
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  /**
   * Soft-deletes a period slot (moves it to the recycle bin).
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} id - Period slot id.
   * @param {string} [reason] - Optional recycle-bin deletion reason.
   * @returns {Promise<{message: string, data: {id: string}}>}
   * @throws {NotFoundException} If the period slot doesn't exist.
   * @throws {ForbiddenException} If the caller lacks access to its campus.
   */
  async deletePeriodSlot(
    currentUser: CurrentUser,
    id: string,
    reason?: string,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.TIMETABLE,
    );
    const existing = await this.findPeriodSlotOrThrow(id);
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );

    await this.prisma.periodSlot.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'PERIOD_SLOT_DELETED',
      entity: 'PeriodSlot',
      entityId: id,
      institutionId: currentUser.institutionId ?? null,
      metadata: { name: existing.name, reason: reason ?? null },
    });

    return {
      message: 'Period slot moved to recycle bin successfully',
      data: { id },
    };
  }

  // ---------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------

  private async findPeriodSlotOrThrow(id: string) {
    const periodSlot = await this.prisma.periodSlot.findFirst({
      where: { id, deletedAt: null },
    });

    if (!periodSlot) {
      throw new NotFoundException('Period slot not found.');
    }

    return periodSlot;
  }

  /**
   * Resolves a section's authoritative scheduling scope by walking
   * section -> class -> level -> campus (§ 4 of the design doc) — the same
   * hop chain TeacherSubject's own section-level allocation relies on.
   * campusId from this method is what gets persisted onto PeriodSlot,
   * never a client-supplied value.
   *
   * @param {string} sectionId - Section to resolve.
   * @returns {Promise<SectionScope>}
   * @throws {NotFoundException} If sectionId doesn't exist.
   */
  private async resolveSectionScope(sectionId: string): Promise<SectionScope> {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      select: {
        classId: true,
        class: { select: { level: { select: { campusId: true } } } },
      },
    });

    if (!section) {
      throw new NotFoundException('Section not found.');
    }

    return { campusId: section.class.level.campusId, classId: section.classId };
  }

  private assertClassMatchesSection(classId: string, scope: SectionScope) {
    if (classId !== scope.classId) {
      throw new BadRequestException(
        "classId does not match sectionId's own class.",
      );
    }
  }

  /**
   * Soft cross-validation (§ 5.2's own commentary) — not a hard FK. A no-op
   * unless both subjectId and staffProfileId are present on the final
   * (post-merge) state, so recess/assembly slots with only one (or
   * neither) of the two never trigger a TeacherSubject lookup at all.
   *
   * @param {TeacherSubjectCheckScope} scope - The final subject/teacher/class/section combination to validate.
   * @throws {ConflictException} If no active TeacherSubject allocation exists for this exact combination.
   */
  private async assertTeacherSubjectAllocation(
    scope: TeacherSubjectCheckScope,
  ) {
    if (!scope.staffProfileId || !scope.subjectId) {
      return;
    }

    const allocation = await this.prisma.teacherSubject.findFirst({
      where: {
        staffProfileId: scope.staffProfileId,
        subjectId: scope.subjectId,
        classId: scope.classId,
        sectionId: scope.sectionId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!allocation) {
      throw new ConflictException(
        'No active teaching allocation exists for this teacher, subject, class, and section combination.',
      );
    }
  }

  /**
   * Converts a Prisma unique-constraint violation on
   * (sectionId, dayOfWeek, periodNumber) into a friendly 409, matching the
   * `rethrowUniqueConflict` pattern used in academics.service.ts and
   * people.service.ts.
   *
   * @param {unknown} error - The caught error.
   * @returns {never}
   * @throws {ConflictException} If the error is a Prisma P2002 unique violation.
   */
  private rethrowUniqueConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'A period slot already exists for this section, day, and period number.',
      );
    }

    throw error;
  }
}
