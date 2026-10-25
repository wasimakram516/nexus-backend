import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CustomFieldEntity } from '../../common/constants/custom-field-entities.constants';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { runAuditedTransaction } from '../../common/utils/transaction.util';
import { DayOfWeek, ModuleKey, Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePeriodSlotDto,
  DuplicatePeriodSlotsDto,
  ListPeriodSlotsQueryDto,
  SwapPeriodSlotsDto,
  UpdatePeriodSlotDto,
} from './dto/timetable.dto';
import {
  ClashSlot,
  clashKindsBetween,
  findClashes,
  normalizeRoom,
} from './timetable-clash.util';
import { formatClockTime } from '../../common/utils/date-format.util';

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
    private readonly entityCustomFieldsService: EntityCustomFieldsService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly requestContext: RequestContextService,
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

    await this.assertNoClash({
      campusId: scope.campusId,
      dayOfWeek: dto.dayOfWeek,
      startTime: dto.startTime,
      endTime: dto.endTime,
      staffProfileId: dto.staffProfileId,
      room: dto.room,
      excludeIds: [],
    });

    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        scope.campusId,
      );
    const { customFields, ...periodSlotFields } = dto;

    try {
      const periodSlot = await this.entityCustomFieldsService.saveRecord(
        {
          institutionId,
          moduleKey: ModuleKey.TIMETABLE,
          entityType: CustomFieldEntity.PERIOD_SLOT,
          values: customFields,
          create: true,
        },
        async (transaction) => {
          const record = await transaction.periodSlot.create({
            data: {
              campusId: scope.campusId,
              classId: periodSlotFields.classId,
              sectionId: periodSlotFields.sectionId,
              subjectId: periodSlotFields.subjectId ?? null,
              staffProfileId: periodSlotFields.staffProfileId ?? null,
              name: periodSlotFields.name,
              periodNumber: periodSlotFields.periodNumber,
              dayOfWeek: periodSlotFields.dayOfWeek,
              startTime: periodSlotFields.startTime,
              endTime: periodSlotFields.endTime,
              room: periodSlotFields.room?.trim() || null,
              createdBy: currentUser.sub,
            },
          });

          await this.auditLogService.log(
            currentUser,
            {
              action: 'PERIOD_SLOT_CREATED',
              entity: 'PeriodSlot',
              entityId: record.id,
              institutionId: currentUser.institutionId ?? null,
              metadata: {
                name: record.name,
                sectionId: record.sectionId,
                dayOfWeek: record.dayOfWeek,
                periodNumber: record.periodNumber,
              },
            },
            transaction,
          );

          return record;
        },
      );

      const data = await this.entityCustomFieldsService.attachToItem(
        periodSlot,
        CustomFieldEntity.PERIOD_SLOT,
      );
      return { message: 'Period slot created successfully', data };
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

    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.PERIOD_SLOT,
    );
    return { message: 'Period slots retrieved successfully', data };
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

    const data = await this.entityCustomFieldsService.attachToItems(
      items,
      CustomFieldEntity.PERIOD_SLOT,
    );
    return { message: 'Weekly timetable retrieved successfully', data };
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

    const data = await this.entityCustomFieldsService.attachToItem(
      periodSlot,
      CustomFieldEntity.PERIOD_SLOT,
    );
    return { message: 'Period slot retrieved successfully', data };
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

    const timingChanged =
      dto.dayOfWeek !== undefined ||
      dto.startTime !== undefined ||
      dto.endTime !== undefined ||
      dto.staffProfileId !== undefined ||
      dto.room !== undefined;
    if (timingChanged) {
      await this.assertNoClash({
        campusId,
        dayOfWeek: dto.dayOfWeek ?? existing.dayOfWeek,
        startTime: dto.startTime ?? existing.startTime,
        endTime: dto.endTime ?? existing.endTime,
        staffProfileId: finalStaffProfileId,
        room: dto.room !== undefined ? dto.room : existing.room,
        excludeIds: [id],
      });
    }

    const institutionId =
      await this.entityCustomFieldsService.resolveInstitutionIdByCampus(
        campusId,
      );
    const { customFields, ...periodSlotFields } = dto;

    try {
      const periodSlot = await this.entityCustomFieldsService.saveRecord(
        {
          institutionId,
          moduleKey: ModuleKey.TIMETABLE,
          entityType: CustomFieldEntity.PERIOD_SLOT,
          values: customFields,
          create: false,
        },
        async (transaction) => {
          const record = await transaction.periodSlot.update({
            where: { id },
            data: {
              ...(periodSlotFields.classId !== undefined
                ? { classId: periodSlotFields.classId }
                : {}),
              ...(periodSlotFields.sectionId !== undefined
                ? { sectionId: periodSlotFields.sectionId }
                : {}),
              ...(scopeChanged ? { campusId } : {}),
              ...(periodSlotFields.subjectId !== undefined
                ? { subjectId: periodSlotFields.subjectId }
                : {}),
              ...(periodSlotFields.staffProfileId !== undefined
                ? { staffProfileId: periodSlotFields.staffProfileId }
                : {}),
              ...(periodSlotFields.name !== undefined
                ? { name: periodSlotFields.name }
                : {}),
              ...(periodSlotFields.periodNumber !== undefined
                ? { periodNumber: periodSlotFields.periodNumber }
                : {}),
              ...(periodSlotFields.dayOfWeek !== undefined
                ? { dayOfWeek: periodSlotFields.dayOfWeek }
                : {}),
              ...(periodSlotFields.startTime !== undefined
                ? { startTime: periodSlotFields.startTime }
                : {}),
              ...(periodSlotFields.endTime !== undefined
                ? { endTime: periodSlotFields.endTime }
                : {}),
              ...(periodSlotFields.room !== undefined
                ? { room: periodSlotFields.room?.trim() || null }
                : {}),
              updatedBy: currentUser.sub,
            },
          });

          await this.auditLogService.log(
            currentUser,
            {
              action: 'PERIOD_SLOT_UPDATED',
              entity: 'PeriodSlot',
              entityId: id,
              institutionId: currentUser.institutionId ?? null,
              metadata: { updatedFields: Object.keys(dto) },
            },
            transaction,
          );

          return record;
        },
      );

      const data = await this.entityCustomFieldsService.attachToItem(
        periodSlot,
        CustomFieldEntity.PERIOD_SLOT,
      );
      return { message: 'Period slot updated successfully', data };
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  /**
   * Copies periods onto other days of the week in one step, so a day that
   * repeats does not have to be typed in again. Every copy goes through the
   * same checks as a period added by hand; a copy that cannot be made (the
   * day already has that period number, a teacher or room is busy) is skipped
   * and reported, and the rest are still made.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {DuplicatePeriodSlotsDto} dto - The periods and the days to copy onto.
   * @returns {Promise<{message: string, data: {created: number, skipped: object[]}}>} How many were made and which were not, with the reason.
   * @throws {NotFoundException} If none of the periods exist.
   * @throws {ForbiddenException} If the caller lacks access to a period's campus.
   */
  async duplicatePeriodSlots(
    currentUser: CurrentUser,
    dto: DuplicatePeriodSlotsDto,
  ) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.TIMETABLE,
    );
    const rows = await this.prisma.periodSlot.findMany({
      where: { id: { in: dto.sourceIds }, deletedAt: null },
      orderBy: [{ dayOfWeek: 'asc' }, { periodNumber: 'asc' }],
    });
    if (rows.length === 0)
      throw new NotFoundException('Period slot not found.');
    for (const campusId of new Set(rows.map((row) => row.campusId))) {
      await this.campusAccessService.assertCampusAccess(currentUser, campusId);
    }
    const sources = await this.entityCustomFieldsService.attachToItems(
      rows,
      CustomFieldEntity.PERIOD_SLOT,
    );

    let created = 0;
    const skipped: {
      sourceId: string;
      name: string;
      dayOfWeek: DayOfWeek;
      reason: string;
    }[] = [];
    for (const source of sources) {
      for (const dayOfWeek of dto.targetDays) {
        if (dayOfWeek === source.dayOfWeek) continue;
        try {
          await this.createPeriodSlot(currentUser, {
            classId: source.classId,
            sectionId: source.sectionId,
            subjectId: source.subjectId ?? undefined,
            staffProfileId: source.staffProfileId ?? undefined,
            name: source.name,
            periodNumber: source.periodNumber,
            dayOfWeek,
            startTime: source.startTime,
            endTime: source.endTime,
            room: source.room,
            customFields: source.customFields,
          });
          created += 1;
        } catch (error) {
          if (!(error instanceof HttpException) || error.getStatus() >= 500)
            throw error;
          skipped.push({
            sourceId: source.id,
            name: source.name,
            dayOfWeek,
            reason: error.message,
          });
        }
      }
    }
    return {
      message:
        skipped.length === 0
          ? `${created} period slot${created === 1 ? '' : 's'} copied.`
          : `${created} copied, ${skipped.length} skipped.`,
      data: { created, skipped },
    };
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

  /**
   * Exchanges the day and period of two periods of one section, as one
   * change: dragging a period onto an occupied cell in the builder. Doing it
   * as two separate updates would trip the one-period-per-cell rule midway.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {SwapPeriodSlotsDto} dto - The two periods.
   * @returns {Promise<{message: string, data: object[]}>} The two periods in their new places.
   * @throws {NotFoundException} If either period does not exist.
   * @throws {BadRequestException} If they are the same period or belong to different sections.
   * @throws {ForbiddenException} If the caller lacks access to the campus.
   * @throws {ConflictException} If a teacher or room would then be in two places at once.
   */
  async swapPeriodSlots(currentUser: CurrentUser, dto: SwapPeriodSlotsDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.TIMETABLE,
    );
    if (dto.firstId === dto.secondId) {
      throw new BadRequestException('Choose two different periods to swap.');
    }
    const first = await this.findPeriodSlotOrThrow(dto.firstId);
    const second = await this.findPeriodSlotOrThrow(dto.secondId);
    if (first.sectionId !== second.sectionId) {
      throw new BadRequestException(
        'Only periods of the same section can be swapped.',
      );
    }
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      first.campusId,
    );

    const place = (slot: typeof first) => ({
      dayOfWeek: slot.dayOfWeek,
      periodNumber: slot.periodNumber,
      startTime: slot.startTime,
      endTime: slot.endTime,
    });
    const intoFirst = place(second);
    const intoSecond = place(first);
    const excludeIds = [first.id, second.id];
    await this.assertNoClash({
      campusId: first.campusId,
      ...intoFirst,
      staffProfileId: first.staffProfileId,
      room: first.room,
      excludeIds,
    });
    await this.assertNoClash({
      campusId: second.campusId,
      ...intoSecond,
      staffProfileId: second.staffProfileId,
      room: second.room,
      excludeIds,
    });

    const data = await runAuditedTransaction(
      this.prisma,
      this.requestContext,
      async (transaction) => {
        // Park one period off the grid so the two never share a cell mid-swap.
        await transaction.periodSlot.update({
          where: { id: first.id },
          data: { periodNumber: 0, updatedBy: currentUser.sub },
        });
        const movedSecond = await transaction.periodSlot.update({
          where: { id: second.id },
          data: { ...intoSecond, updatedBy: currentUser.sub },
        });
        const movedFirst = await transaction.periodSlot.update({
          where: { id: first.id },
          data: { ...intoFirst, updatedBy: currentUser.sub },
        });
        await this.auditLogService.log(
          currentUser,
          {
            action: 'PERIOD_SLOTS_SWAPPED',
            entity: 'PeriodSlot',
            institutionId: currentUser.institutionId ?? null,
            metadata: { firstId: first.id, secondId: second.id },
          },
          transaction,
        );
        return [movedFirst, movedSecond];
      },
    );
    return { message: 'Periods swapped successfully', data };
  }

  /**
   * Every clash in a campus's timetable: a teacher in two places at once, or
   * a room used twice at once. The saves refuse to create these, so this
   * finds ones that already existed before the checks, or came from outside.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} campusId - The campus.
   * @returns {Promise<{message: string, data: object[]}>} The clashes with who and where.
   * @throws {ForbiddenException} If the caller lacks access to the campus.
   */
  async listClashes(currentUser: CurrentUser, campusId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.TIMETABLE,
    );
    await this.campusAccessService.assertCampusAccess(currentUser, campusId);
    const slots = await this.prisma.periodSlot.findMany({
      where: { campusId, deletedAt: null },
      include: {
        section: { select: { name: true } },
        class: { select: { name: true } },
        staffProfile: { select: { user: { select: { name: true } } } },
      },
    });
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const describe = (id: string) => {
      const slot = byId.get(id);
      return {
        id,
        className: slot?.class.name ?? null,
        sectionName: slot?.section.name ?? null,
        teacherName: slot?.staffProfile?.user.name ?? null,
        room: slot?.room ?? null,
        dayOfWeek: slot?.dayOfWeek ?? null,
        startTime: slot?.startTime ?? null,
        endTime: slot?.endTime ?? null,
      };
    };
    const data = findClashes(slots).map((clash) => ({
      kind: clash.kind,
      first: describe(clash.first.id),
      second: describe(clash.second.id),
    }));
    return { message: 'Timetable clashes retrieved successfully', data };
  }

  /**
   * The rooms already used on a campus, so the builder can offer them back
   * instead of every period being typed from scratch.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} campusId - The campus.
   * @returns {Promise<{message: string, data: string[]}>} The distinct rooms, alphabetically.
   * @throws {ForbiddenException} If the caller lacks access to the campus.
   */
  async listRooms(currentUser: CurrentUser, campusId: string) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.TIMETABLE,
    );
    await this.campusAccessService.assertCampusAccess(currentUser, campusId);
    const rows = await this.prisma.periodSlot.findMany({
      where: { campusId, deletedAt: null, room: { not: null } },
      select: { room: true },
      distinct: ['room'],
    });
    const rooms = rows
      .map((row) => row.room)
      .filter((room): room is string => Boolean(room))
      .sort((a, b) => a.localeCompare(b));
    return { message: 'Rooms retrieved successfully', data: rooms };
  }

  /**
   * Refuses a period that would put a teacher in two places, or two periods
   * in one room, at the same time on the same day of the campus.
   *
   * @param {object} candidate - The period as it would be saved.
   * @throws {ConflictException} Naming who and where the clash is with.
   */
  private async assertNoClash(candidate: {
    campusId: string;
    dayOfWeek: string;
    startTime: string;
    endTime: string;
    staffProfileId?: string | null;
    room?: string | null;
    excludeIds: string[];
  }) {
    const room = normalizeRoom(candidate.room);
    if (!candidate.staffProfileId && !room) return;

    const others = await this.prisma.periodSlot.findMany({
      where: {
        campusId: candidate.campusId,
        dayOfWeek: candidate.dayOfWeek as DayOfWeek,
        deletedAt: null,
        id: { notIn: candidate.excludeIds },
        OR: [
          ...(candidate.staffProfileId
            ? [{ staffProfileId: candidate.staffProfileId }]
            : []),
          ...(room
            ? [{ room: { equals: room, mode: 'insensitive' as const } }]
            : []),
        ],
      },
      include: {
        section: { select: { name: true } },
        class: { select: { name: true } },
      },
    });

    const incoming: ClashSlot = {
      id: 'incoming',
      sectionId: 'incoming',
      dayOfWeek: candidate.dayOfWeek,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      staffProfileId: candidate.staffProfileId ?? null,
      room: candidate.room ?? null,
    };
    for (const other of others) {
      const kinds = clashKindsBetween(incoming, other);
      if (kinds.length === 0) continue;
      const where = `${other.class.name}, section ${other.section.name}, ${formatClockTime(other.startTime)} to ${formatClockTime(other.endTime)}`;
      throw new ConflictException(
        kinds.includes('TEACHER')
          ? `This teacher is already teaching ${where} at that time.`
          : `${other.room ?? 'That room'} is already used by ${where} at that time.`,
      );
    }
  }

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
