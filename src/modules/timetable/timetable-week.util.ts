import { DayOfWeek } from '../../prisma/client';

const DAYS_FROM_MONDAY: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
  DayOfWeek.SUNDAY,
];

/** The period of a weekly timetable, with the names a view needs. */
export interface WeekSlot {
  id: string;
  dayOfWeek: DayOfWeek;
  periodNumber: number;
  name: string;
  startTime: string;
  endTime: string;
  room: string | null;
  sectionId: string;
  className: string;
  sectionName: string;
  subjectName: string | null;
  staffProfileId: string | null;
  teacherName: string | null;
}

/** A cover arranged for one period on one date. */
export interface WeekCover {
  id: string;
  periodSlotId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  substituteStaffProfileId: string;
  substituteName: string;
  reason: string | null;
}

export interface WeekEntry extends WeekSlot {
  /** The calendar date this period falls on in the week shown. */
  date: string;
  /** Who is actually teaching it that day: the cover when there is one. */
  effectiveTeacherName: string | null;
  /** Someone else covers this period on this date. */
  isCovered: boolean;
  coverSubstituteName: string | null;
  coverReason: string | null;
  /** This period is the teacher's only because they are covering it. */
  isCoverDuty: boolean;
}

/**
 * The seven dates of the Monday-to-Sunday week containing a date.
 *
 * @param {string} date - Any `YYYY-MM-DD` date.
 * @returns {Record<DayOfWeek, string>} Each day of the week and its date.
 */
export function weekDatesOf(date: string): Record<DayOfWeek, string> {
  const day = new Date(`${date}T00:00:00.000Z`);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  const monday = new Date(day.getTime() - sinceMonday * 86_400_000);
  const entries = DAYS_FROM_MONDAY.map((name, index) => [
    name,
    new Date(monday.getTime() + index * 86_400_000).toISOString().slice(0, 10),
  ]);
  return Object.fromEntries(entries) as Record<DayOfWeek, string>;
}

/**
 * Lays periods onto the dates of one week and applies the cover arranged for
 * those dates, ordered by date then period.
 *
 * @param {WeekSlot[]} slots - The periods to show.
 * @param {WeekCover[]} covers - Cover arranged during the week, for any period.
 * @param {Record<DayOfWeek, string>} dates - The week's dates by day.
 * @param {string | null} [coveringTeacherId] - When showing one teacher, the periods they only teach by covering are marked as cover duty.
 * @returns {WeekEntry[]} One entry per period per date.
 */
export function decorateWeek(
  slots: WeekSlot[],
  covers: WeekCover[],
  dates: Record<DayOfWeek, string>,
  coveringTeacherId: string | null = null,
): WeekEntry[] {
  const coverByKey = new Map(
    covers.map((cover) => [`${cover.periodSlotId}|${cover.date}`, cover]),
  );
  return slots
    .map((slot): WeekEntry => {
      const date = dates[slot.dayOfWeek];
      const cover = coverByKey.get(`${slot.id}|${date}`);
      return {
        ...slot,
        date,
        effectiveTeacherName: cover ? cover.substituteName : slot.teacherName,
        isCovered: Boolean(cover),
        coverSubstituteName: cover?.substituteName ?? null,
        coverReason: cover?.reason ?? null,
        isCoverDuty: Boolean(
          cover &&
          coveringTeacherId &&
          cover.substituteStaffProfileId === coveringTeacherId &&
          slot.staffProfileId !== coveringTeacherId,
        ),
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.periodNumber - b.periodNumber ||
        a.startTime.localeCompare(b.startTime),
    );
}
