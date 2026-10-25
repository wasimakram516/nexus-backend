import { DayOfWeek } from '../../prisma/client';
import { WeekEntry } from './timetable-week.util';

const ORDER: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
  DayOfWeek.SUNDAY,
];

/** Monday to Friday always show, even when empty; the weekend shows only when something is on it. */
const ALWAYS_SHOWN: DayOfWeek[] = ORDER.slice(0, 5);

export interface GridRow {
  /** `08:00-08:40`, which identifies the row. */
  key: string;
  startTime: string;
  endTime: string;
  /** The period's name on the first day that has it, such as `Period 1`. */
  label: string;
  cells: Map<DayOfWeek, WeekEntry[]>;
}

export interface TimetableGrid {
  days: DayOfWeek[];
  /** The date of each shown day in the week. */
  dates: Map<DayOfWeek, string>;
  rows: GridRow[];
}

/**
 * Turns a week's periods into the day-by-period table a printed timetable
 * uses: one column per day, one row per time slot, ordered by time.
 *
 * @param {WeekEntry[]} entries - The periods of the week with cover applied.
 * @returns {TimetableGrid} The days to show and the rows with their cells.
 */
export function buildGrid(entries: WeekEntry[]): TimetableGrid {
  const used = new Set(entries.map((entry) => entry.dayOfWeek));
  const days = ORDER.filter(
    (day) => ALWAYS_SHOWN.includes(day) || used.has(day),
  );
  const dates = new Map<DayOfWeek, string>(
    entries.map((entry) => [entry.dayOfWeek, entry.date]),
  );

  const rows = new Map<string, GridRow>();
  for (const entry of entries) {
    const key = `${entry.startTime}-${entry.endTime}`;
    const row = rows.get(key) ?? {
      key,
      startTime: entry.startTime,
      endTime: entry.endTime,
      label: entry.name,
      cells: new Map<DayOfWeek, WeekEntry[]>(),
    };
    row.cells.set(entry.dayOfWeek, [
      ...(row.cells.get(entry.dayOfWeek) ?? []),
      entry,
    ]);
    rows.set(key, row);
  }
  return {
    days,
    dates,
    rows: [...rows.values()].sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) ||
        a.endTime.localeCompare(b.endTime),
    ),
  };
}

/**
 * The lines to print in one cell: what is taught and by whom, noting cover.
 * A section's or student's timetable names the teacher; a teacher's names the
 * class instead.
 *
 * @param {WeekEntry} entry - The period.
 * @param {boolean} forTeacher - True when the table is a teacher's own.
 * @returns {string[]} The lines, most important first.
 */
export function cellLines(entry: WeekEntry, forTeacher: boolean): string[] {
  const what = entry.subjectName ?? entry.name;
  const lines = [what];
  if (forTeacher) {
    lines.push(`${entry.className} ${entry.sectionName}`);
    if (entry.isCoverDuty) lines.push('Covering');
    else if (entry.isCovered) {
      lines.push(`Covered by ${entry.coverSubstituteName ?? 'a substitute'}`);
    }
  } else {
    if (entry.effectiveTeacherName) lines.push(entry.effectiveTeacherName);
    if (entry.isCovered) lines.push('(cover)');
  }
  if (entry.room) lines.push(entry.room);
  return lines;
}
