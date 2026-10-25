import { Injectable } from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { OwnedStudentsService } from '../../common/services/owned-students.service';
import {
  EnrollmentStatus,
  ModuleKey,
  Prisma,
  UserRole,
} from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { dateOnly } from './period-substitutions.service';
import {
  decorateWeek,
  WeekCover,
  weekDatesOf,
  WeekEntry,
  WeekSlot,
} from './timetable-week.util';

const slotInclude = {
  class: { select: { name: true } },
  section: { select: { name: true } },
  subject: { select: { name: true } },
  staffProfile: { select: { user: { select: { name: true } } } },
} satisfies Prisma.PeriodSlotInclude;

type SlotRow = Prisma.PeriodSlotGetPayload<{ include: typeof slotInclude }>;

const toWeekSlot = (row: SlotRow): WeekSlot => ({
  id: row.id,
  dayOfWeek: row.dayOfWeek,
  periodNumber: row.periodNumber,
  name: row.name,
  startTime: row.startTime,
  endTime: row.endTime,
  room: row.room,
  sectionId: row.sectionId,
  className: row.class.name,
  sectionName: row.section.name,
  subjectName: row.subject?.name ?? null,
  staffProfileId: row.staffProfileId,
  teacherName: row.staffProfile?.user.name ?? null,
});

export interface TimetableGroup {
  kind: 'SECTION' | 'STUDENT' | 'TEACHER';
  id: string;
  title: string;
  subtitle: string | null;
  entries: WeekEntry[];
}

export interface TimetableWeek {
  from: string;
  to: string;
  dates: ReturnType<typeof weekDatesOf>;
}

/**
 * Weekly timetables as people read them: one section, one teacher, or "mine"
 * (a student's or guardian's children, or a teacher's own). Every period is
 * laid on its date in the chosen week with that date's cover applied, so a
 * covered period shows who is really teaching it.
 */
@Injectable()
export class TimetableViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly campusAccessService: CampusAccessService,
    private readonly ownedStudents: OwnedStudentsService,
  ) {}

  /**
   * One section's week, for staff.
   *
   * @param {CurrentUser} currentUser - Authenticated staff caller.
   * @param {string} sectionId - The section.
   * @param {string} [date] - Any date in the week wanted; defaults to today.
   * @returns {Promise<{message: string, data: {week: TimetableWeek, group: TimetableGroup}}>} The section's week with cover applied.
   * @throws {ForbiddenException} If the caller lacks access to the section's campus.
   */
  async sectionSchedule(
    currentUser: CurrentUser,
    sectionId: string,
    date?: string,
  ) {
    await this.assertModule(currentUser);
    await this.campusAccessService.assertSectionAccess(currentUser, sectionId);
    const week = this.weekOf(date);
    const group = await this.sectionGroup(sectionId, week, 'SECTION');
    return {
      message: 'Section timetable retrieved successfully',
      data: { week, group },
    };
  }

  /**
   * Every section of a class, one timetable each, for staff.
   *
   * @param {CurrentUser} currentUser - Authenticated staff caller.
   * @param {string} classId - The class.
   * @param {string} [date] - Any date in the week wanted; defaults to today.
   * @returns {Promise<{message: string, data: {week: TimetableWeek, groups: TimetableGroup[]}}>} One group per section, in section order.
   * @throws {ForbiddenException} If the caller lacks access to the class's campus.
   */
  async classSchedule(
    currentUser: CurrentUser,
    classId: string,
    date?: string,
  ) {
    await this.assertModule(currentUser);
    await this.campusAccessService.assertClassAccess(currentUser, classId);
    const week = this.weekOf(date);
    return {
      message: 'Class timetable retrieved successfully',
      data: { week, groups: await this.sectionGroups({ classId }, week) },
    };
  }

  /**
   * Every section of a campus, one timetable each, for staff.
   *
   * @param {CurrentUser} currentUser - Authenticated staff caller.
   * @param {string} campusId - The campus.
   * @param {string} [date] - Any date in the week wanted; defaults to today.
   * @returns {Promise<{message: string, data: {week: TimetableWeek, groups: TimetableGroup[]}}>} One group per section that has periods.
   * @throws {ForbiddenException} If the caller lacks access to the campus.
   */
  async campusSchedule(
    currentUser: CurrentUser,
    campusId: string,
    date?: string,
  ) {
    await this.assertModule(currentUser);
    await this.campusAccessService.assertCampusAccess(currentUser, campusId);
    const week = this.weekOf(date);
    return {
      message: 'Campus timetable retrieved successfully',
      data: { week, groups: await this.sectionGroups({ campusId }, week) },
    };
  }

  /**
   * One teacher's week, for staff: their own periods (marked when someone
   * else covers them) and the periods they are covering.
   *
   * @param {CurrentUser} currentUser - Authenticated staff caller.
   * @param {string} staffProfileId - The teacher.
   * @param {string} [date] - Any date in the week wanted; defaults to today.
   * @returns {Promise<{message: string, data: {week: TimetableWeek, group: TimetableGroup}}>} The teacher's week.
   * @throws {ForbiddenException} If the caller lacks access to the teacher's campus.
   */
  async teacherSchedule(
    currentUser: CurrentUser,
    staffProfileId: string,
    date?: string,
  ) {
    await this.assertModule(currentUser);
    await this.campusAccessService.assertStaffProfileAccess(
      currentUser,
      staffProfileId,
    );
    const week = this.weekOf(date);
    return {
      message: 'Teacher timetable retrieved successfully',
      data: { week, group: await this.teacherGroup(staffProfileId, week) },
    };
  }

  /**
   * The caller's own timetable: for a student, their section's; for a
   * guardian, each child's; for staff with a teaching profile, their own.
   *
   * @param {CurrentUser} currentUser - Any signed-in caller.
   * @param {string} [date] - Any date in the week wanted; defaults to today.
   * @returns {Promise<{message: string, data: {week: TimetableWeek, groups: TimetableGroup[]}}>} The groups to show; empty when there is nothing.
   */
  async mySchedule(currentUser: CurrentUser, date?: string) {
    await this.assertModule(currentUser);
    const week = this.weekOf(date);
    const groups: TimetableGroup[] = [];

    if (
      currentUser.role === UserRole.STUDENT ||
      currentUser.role === UserRole.GUARDIAN
    ) {
      const ownedIds =
        await this.ownedStudents.resolveOwnedStudentIds(currentUser);
      const yearId = await this.currentAcademicYearId(currentUser);
      if (ownedIds.length > 0 && yearId) {
        const enrollments = await this.prisma.studentEnrollment.findMany({
          where: {
            studentId: { in: ownedIds },
            academicYearId: yearId,
            status: { not: EnrollmentStatus.LEFT },
            deletedAt: null,
            sectionId: { not: null },
          },
          select: {
            sectionId: true,
            student: { select: { id: true, user: { select: { name: true } } } },
          },
        });
        for (const enrollment of enrollments) {
          if (!enrollment.sectionId) continue;
          const group = await this.sectionGroup(
            enrollment.sectionId,
            week,
            'STUDENT',
          );
          groups.push({
            ...group,
            id: enrollment.student.id,
            title: enrollment.student.user.name,
            subtitle: group.title,
          });
        }
        groups.sort((a, b) => a.title.localeCompare(b.title));
      }
    } else {
      const profile = await this.prisma.staffProfile.findFirst({
        where: { userId: currentUser.sub, deletedAt: null },
        select: { id: true },
      });
      if (profile) groups.push(await this.teacherGroup(profile.id, week));
    }

    return {
      message: 'Timetable retrieved successfully',
      data: { week, groups },
    };
  }

  private weekOf(date?: string): TimetableWeek {
    const dates = weekDatesOf(date ?? new Date().toISOString().slice(0, 10));
    return { from: dates.MONDAY, to: dates.SUNDAY, dates };
  }

  private async sectionGroup(
    sectionId: string,
    week: TimetableWeek,
    kind: TimetableGroup['kind'],
  ): Promise<TimetableGroup> {
    const slots = await this.prisma.periodSlot.findMany({
      where: { sectionId, deletedAt: null },
      include: slotInclude,
    });
    const covers = await this.coversFor(
      { periodSlotId: { in: slots.map((slot) => slot.id) } },
      week,
    );
    const first = slots[0];
    return {
      kind,
      id: sectionId,
      title: first ? `${first.class.name}, section ${first.section.name}` : '',
      subtitle: null,
      entries: decorateWeek(slots.map(toWeekSlot), covers, week.dates),
    };
  }

  /** A timetable per section for every period matching a filter, in class then section order. */
  private async sectionGroups(
    filter: Prisma.PeriodSlotWhereInput,
    week: TimetableWeek,
  ): Promise<TimetableGroup[]> {
    const slots = await this.prisma.periodSlot.findMany({
      where: { ...filter, deletedAt: null },
      include: slotInclude,
    });
    const covers = await this.coversFor(
      { periodSlotId: { in: slots.map((slot) => slot.id) } },
      week,
    );
    const bySection = new Map<string, SlotRow[]>();
    for (const slot of slots) {
      bySection.set(slot.sectionId, [
        ...(bySection.get(slot.sectionId) ?? []),
        slot,
      ]);
    }
    return [...bySection.entries()]
      .map(([sectionId, rows]): TimetableGroup => {
        const rowIds = new Set(rows.map((row) => row.id));
        return {
          kind: 'SECTION',
          id: sectionId,
          title: `${rows[0].class.name}, section ${rows[0].section.name}`,
          subtitle: null,
          entries: decorateWeek(
            rows.map(toWeekSlot),
            covers.filter((cover) => rowIds.has(cover.periodSlotId)),
            week.dates,
          ),
        };
      })
      .sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { numeric: true }),
      );
  }

  private async teacherGroup(
    staffProfileId: string,
    week: TimetableWeek,
  ): Promise<TimetableGroup> {
    const own = await this.prisma.periodSlot.findMany({
      where: { staffProfileId, deletedAt: null },
      include: slotInclude,
    });
    const ownCovers = await this.coversFor(
      { periodSlotId: { in: own.map((slot) => slot.id) } },
      week,
    );
    const dutyCovers = await this.coversFor(
      { substituteStaffProfileId: staffProfileId },
      week,
    );
    const ownIds = new Set(own.map((slot) => slot.id));
    const dutySlotIds = [
      ...new Set(
        dutyCovers
          .map((cover) => cover.periodSlotId)
          .filter((id) => !ownIds.has(id)),
      ),
    ];
    const dutySlots = dutySlotIds.length
      ? await this.prisma.periodSlot.findMany({
          where: { id: { in: dutySlotIds }, deletedAt: null },
          include: slotInclude,
        })
      : [];

    const profile = await this.prisma.staffProfile.findUnique({
      where: { id: staffProfileId },
      select: { designation: true, user: { select: { name: true } } },
    });
    const entries = [
      ...decorateWeek(
        own.map(toWeekSlot),
        ownCovers,
        week.dates,
        staffProfileId,
      ),
      ...decorateWeek(
        dutySlots.map(toWeekSlot),
        dutyCovers,
        week.dates,
        staffProfileId,
      ),
    ].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.startTime.localeCompare(b.startTime) ||
        a.periodNumber - b.periodNumber,
    );
    return {
      kind: 'TEACHER',
      id: staffProfileId,
      title: profile?.user.name ?? 'Teacher',
      subtitle: profile?.designation ?? null,
      entries,
    };
  }

  /** Active cover arranged during the week that matches a filter. */
  private async coversFor(
    filter: Prisma.PeriodSubstitutionWhereInput,
    week: TimetableWeek,
  ): Promise<WeekCover[]> {
    const rows = await this.prisma.periodSubstitution.findMany({
      where: {
        ...filter,
        deletedAt: null,
        date: { gte: dateOnly(week.from), lte: dateOnly(week.to) },
        periodSlot: { deletedAt: null },
      },
      select: {
        id: true,
        periodSlotId: true,
        date: true,
        reason: true,
        substituteStaffProfileId: true,
        substitute: { select: { user: { select: { name: true } } } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      periodSlotId: row.periodSlotId,
      date: row.date.toISOString().slice(0, 10),
      substituteStaffProfileId: row.substituteStaffProfileId,
      substituteName: row.substitute.user.name,
      reason: row.reason,
    }));
  }

  private async currentAcademicYearId(
    currentUser: CurrentUser,
  ): Promise<string | null> {
    if (!currentUser.institutionId) return null;
    const institution = await this.prisma.institution.findUnique({
      where: { id: currentUser.institutionId },
      select: { currentAcademicYearId: true },
    });
    return institution?.currentAcademicYearId ?? null;
  }

  private async assertModule(currentUser: CurrentUser) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.TIMETABLE,
    );
  }
}
