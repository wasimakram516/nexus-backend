import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { DayOfWeek, ModuleKey, Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CancelSubstitutionDto,
  CreatePeriodSubstitutionDto,
  ListPeriodSubstitutionsQueryDto,
} from './dto/timetable.dto';
import { timesOverlap } from './timetable-clash.util';
import { formatClockTime } from '../../common/utils/date-format.util';

const WEEKDAYS: DayOfWeek[] = [
  DayOfWeek.SUNDAY,
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

/** A `YYYY-MM-DD` date as a UTC midnight, the way a date-only column is stored. */
export function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** The day of the week a `YYYY-MM-DD` date falls on. */
export function weekdayOf(value: string): DayOfWeek {
  return WEEKDAYS[dateOnly(value).getUTCDay()];
}

const slotInclude = {
  class: { select: { name: true } },
  section: { select: { name: true } },
  subject: { select: { name: true } },
  staffProfile: { select: { user: { select: { name: true } } } },
} satisfies Prisma.PeriodSlotInclude;

const substitutionInclude = {
  periodSlot: { include: slotInclude },
  substitute: { select: { user: { select: { name: true } } } },
} satisfies Prisma.PeriodSubstitutionInclude;

/**
 * A teacher covering one period on one date, without touching the weekly
 * timetable. The cover is refused if it would send the substitute to two
 * places at once, and cancelling it simply returns the period to its usual
 * teacher.
 */
@Injectable()
export class PeriodSubstitutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly campusAccessService: CampusAccessService,
    private readonly moduleAccessService: ModuleAccessService,
  ) {}

  /**
   * Arrange cover for a period on a date.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {CreatePeriodSubstitutionDto} dto - The period, the date and the covering teacher.
   * @returns {Promise<{message: string, data: object}>} The substitution with its period and teachers.
   * @throws {NotFoundException} If the period or the teacher does not exist.
   * @throws {BadRequestException} If the date is not the period's weekday, or the cover is the usual teacher.
   * @throws {ForbiddenException} If the caller lacks access to the campus.
   * @throws {ConflictException} If the period is already covered that day, or the substitute is busy then.
   */
  async create(currentUser: CurrentUser, dto: CreatePeriodSubstitutionDto) {
    await this.assertModule(currentUser);
    const slot = await this.prisma.periodSlot.findFirst({
      where: { id: dto.periodSlotId, deletedAt: null },
    });
    if (!slot) throw new NotFoundException('Period slot not found.');
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      slot.campusId,
    );

    if (weekdayOf(dto.date) !== slot.dayOfWeek) {
      throw new BadRequestException(
        `This period is on ${slot.dayOfWeek.toLowerCase()}s, so the cover must be on a ${slot.dayOfWeek.toLowerCase()}.`,
      );
    }
    if (dto.substituteStaffProfileId === slot.staffProfileId) {
      throw new BadRequestException(
        "The covering teacher is already this period's teacher.",
      );
    }
    const substitute = await this.prisma.staffProfile.findFirst({
      where: {
        id: dto.substituteStaffProfileId,
        deletedAt: null,
        campus: { institutionId: await this.institutionOf(slot.campusId) },
      },
      select: { id: true },
    });
    if (!substitute) throw new NotFoundException('Teacher not found.');

    await this.assertSubstituteFree({
      substituteId: dto.substituteStaffProfileId,
      campusId: slot.campusId,
      date: dto.date,
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      excludeSlotId: slot.id,
    });

    try {
      const created = await this.prisma.periodSubstitution.create({
        data: {
          campusId: slot.campusId,
          periodSlotId: slot.id,
          date: dateOnly(dto.date),
          substituteStaffProfileId: dto.substituteStaffProfileId,
          reason: dto.reason?.trim() || null,
          createdBy: currentUser.sub,
        },
        include: substitutionInclude,
      });
      await this.auditLogService.log(currentUser, {
        action: 'PERIOD_SUBSTITUTION_CREATED',
        entity: 'PeriodSubstitution',
        entityId: created.id,
        institutionId: currentUser.institutionId ?? null,
        metadata: {
          periodSlotId: slot.id,
          date: dto.date,
          substituteStaffProfileId: dto.substituteStaffProfileId,
        },
      });
      return {
        message: 'Substitution arranged successfully',
        data: this.present(created),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This period already has cover arranged for that date. Cancel it first to choose someone else.',
        );
      }
      throw error;
    }
  }

  /**
   * The substitutions on a campus between two dates, newest day last.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {ListPeriodSubstitutionsQueryDto} query - Campus, a date range, and optional section or teacher.
   * @returns {Promise<{message: string, data: object[]}>} The substitutions with their period and teachers.
   * @throws {ForbiddenException} If the caller lacks access to the campus.
   */
  async list(currentUser: CurrentUser, query: ListPeriodSubstitutionsQueryDto) {
    await this.assertModule(currentUser);
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      query.campusId,
    );
    const items = await this.prisma.periodSubstitution.findMany({
      where: {
        campusId: query.campusId,
        deletedAt: null,
        periodSlot: {
          deletedAt: null,
          ...(query.sectionId ? { sectionId: query.sectionId } : {}),
        },
        date: {
          ...(query.from ? { gte: dateOnly(query.from) } : {}),
          ...(query.to ? { lte: dateOnly(query.to) } : {}),
        },
        ...(query.staffProfileId
          ? {
              OR: [
                { substituteStaffProfileId: query.staffProfileId },
                { periodSlot: { staffProfileId: query.staffProfileId } },
              ],
            }
          : {}),
      },
      include: substitutionInclude,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      message: 'Substitutions retrieved successfully',
      data: items.map((item) => this.present(item)),
    };
  }

  /**
   * Cancel a substitution; the period goes back to its usual teacher.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {string} id - The substitution.
   * @param {CancelSubstitutionDto} dto - An optional reason.
   * @returns {Promise<{message: string, data: {id: string}}>} The cancelled substitution's id.
   * @throws {NotFoundException} If the substitution does not exist.
   * @throws {ForbiddenException} If the caller lacks access to the campus.
   */
  async cancel(
    currentUser: CurrentUser,
    id: string,
    dto: CancelSubstitutionDto,
  ) {
    await this.assertModule(currentUser);
    const existing = await this.prisma.periodSubstitution.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, campusId: true },
    });
    if (!existing) throw new NotFoundException('Substitution not found.');
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      existing.campusId,
    );
    await this.prisma.periodSubstitution.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: dto.reason?.trim() || null,
      },
    });
    await this.auditLogService.log(currentUser, {
      action: 'PERIOD_SUBSTITUTION_CANCELLED',
      entity: 'PeriodSubstitution',
      entityId: id,
      institutionId: currentUser.institutionId ?? null,
    });
    return { message: 'Substitution cancelled', data: { id } };
  }

  /**
   * The substitute must not be teaching, or covering something else, at that
   * time on that date. A usual period of theirs does not count if somebody
   * else is covering it that day.
   */
  private async assertSubstituteFree(params: {
    substituteId: string;
    campusId: string;
    date: string;
    dayOfWeek: DayOfWeek;
    startTime: string;
    endTime: string;
    excludeSlotId: string;
  }) {
    const own = await this.prisma.periodSlot.findMany({
      where: {
        campusId: params.campusId,
        staffProfileId: params.substituteId,
        dayOfWeek: params.dayOfWeek,
        deletedAt: null,
        id: { not: params.excludeSlotId },
      },
      include: {
        ...slotInclude,
        substitutions: {
          where: { date: dateOnly(params.date), deletedAt: null },
          select: { id: true },
        },
      },
    });
    for (const slot of own) {
      if (slot.substitutions.length > 0) continue; // someone else covers it that day
      if (
        timesOverlap(
          params.startTime,
          params.endTime,
          slot.startTime,
          slot.endTime,
        )
      ) {
        throw new ConflictException(
          `This teacher is teaching ${slot.class.name}, section ${slot.section.name}, ${formatClockTime(slot.startTime)} to ${formatClockTime(slot.endTime)} then.`,
        );
      }
    }

    const covering = await this.prisma.periodSubstitution.findMany({
      where: {
        substituteStaffProfileId: params.substituteId,
        date: dateOnly(params.date),
        deletedAt: null,
        periodSlot: { deletedAt: null, id: { not: params.excludeSlotId } },
      },
      include: { periodSlot: { include: slotInclude } },
    });
    for (const cover of covering) {
      if (
        timesOverlap(
          params.startTime,
          params.endTime,
          cover.periodSlot.startTime,
          cover.periodSlot.endTime,
        )
      ) {
        throw new ConflictException(
          `This teacher is already covering ${cover.periodSlot.class.name}, section ${cover.periodSlot.section.name}, ${formatClockTime(cover.periodSlot.startTime)} to ${formatClockTime(cover.periodSlot.endTime)} then.`,
        );
      }
    }
  }

  private async institutionOf(campusId: string): Promise<string> {
    const campus = await this.prisma.campus.findUnique({
      where: { id: campusId },
      select: { institutionId: true },
    });
    if (!campus?.institutionId) {
      throw new NotFoundException('Campus not found.');
    }
    return campus.institutionId;
  }

  private async assertModule(currentUser: CurrentUser) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.TIMETABLE,
    );
  }

  private present(
    item: Prisma.PeriodSubstitutionGetPayload<{
      include: typeof substitutionInclude;
    }>,
  ) {
    return {
      id: item.id,
      date: item.date.toISOString().slice(0, 10),
      reason: item.reason,
      periodSlotId: item.periodSlotId,
      substituteStaffProfileId: item.substituteStaffProfileId,
      substituteName: item.substitute.user.name,
      originalStaffProfileId: item.periodSlot.staffProfileId,
      originalName: item.periodSlot.staffProfile?.user.name ?? null,
      sectionId: item.periodSlot.sectionId,
      className: item.periodSlot.class.name,
      sectionName: item.periodSlot.section.name,
      subjectName: item.periodSlot.subject?.name ?? null,
      periodName: item.periodSlot.name,
      dayOfWeek: item.periodSlot.dayOfWeek,
      startTime: item.periodSlot.startTime,
      endTime: item.periodSlot.endTime,
    };
  }
}
