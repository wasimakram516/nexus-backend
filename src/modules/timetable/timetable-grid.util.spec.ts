import { DayOfWeek } from '../../prisma/client';
import { buildGrid, cellLines } from './timetable-grid.util';
import { WeekEntry } from './timetable-week.util';

const entry = (overrides: Partial<WeekEntry> = {}): WeekEntry => ({
  id: 'e1',
  dayOfWeek: DayOfWeek.MONDAY,
  periodNumber: 1,
  name: 'Period 1',
  startTime: '08:00',
  endTime: '08:40',
  room: null,
  sectionId: 'sec-1',
  className: 'Grade 5',
  sectionName: 'A',
  subjectName: 'Maths',
  staffProfileId: 't1',
  teacherName: 'Teacher One',
  date: '2026-11-02',
  effectiveTeacherName: 'Teacher One',
  isCovered: false,
  coverSubstituteName: null,
  coverReason: null,
  isCoverDuty: false,
  ...overrides,
});

describe('buildGrid', () => {
  it('always shows Monday to Friday, even for an empty week', () => {
    expect(buildGrid([]).days).toEqual([
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
    ]);
    expect(buildGrid([]).rows).toEqual([]);
  });

  it('adds Saturday and Sunday only when something is on them', () => {
    const grid = buildGrid([
      entry({ dayOfWeek: DayOfWeek.SATURDAY, date: '2026-11-07' }),
    ]);

    expect(grid.days).toEqual([
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
    ]);
    expect(grid.days).not.toContain('SUNDAY');
  });

  it('makes one row per time slot, in time order, with each day in its column', () => {
    const grid = buildGrid([
      entry({
        id: 'late',
        startTime: '09:20',
        endTime: '10:00',
        name: 'Period 3',
      }),
      entry({ id: 'mon', dayOfWeek: DayOfWeek.MONDAY }),
      entry({ id: 'tue', dayOfWeek: DayOfWeek.TUESDAY, date: '2026-11-03' }),
    ]);

    expect(grid.rows.map((row) => row.key)).toEqual([
      '08:00-08:40',
      '09:20-10:00',
    ]);
    expect(grid.rows[0].label).toBe('Period 1');
    expect(grid.rows[0].cells.get(DayOfWeek.MONDAY)?.[0].id).toBe('mon');
    expect(grid.rows[0].cells.get(DayOfWeek.TUESDAY)?.[0].id).toBe('tue');
    expect(grid.rows[0].cells.get(DayOfWeek.WEDNESDAY)).toBeUndefined();
    expect(grid.dates.get(DayOfWeek.TUESDAY)).toBe('2026-11-03');
  });

  it('keeps two periods that share a cell together', () => {
    const grid = buildGrid([entry({ id: 'a' }), entry({ id: 'b' })]);

    expect(grid.rows[0].cells.get(DayOfWeek.MONDAY)?.map((e) => e.id)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('cellLines', () => {
  it("shows the subject, the teacher and the room on a section's timetable", () => {
    expect(cellLines(entry({ room: 'Lab 1' }), false)).toEqual([
      'Maths',
      'Teacher One',
      'Lab 1',
    ]);
  });

  it('names the covering teacher and says it is cover', () => {
    expect(
      cellLines(
        entry({
          isCovered: true,
          effectiveTeacherName: 'Teacher Two',
        }),
        false,
      ),
    ).toEqual(['Maths', 'Teacher Two', '(cover)']);
  });

  it('falls back to the period name when there is no subject, and omits a missing teacher', () => {
    expect(
      cellLines(
        entry({
          subjectName: null,
          name: 'Recess',
          effectiveTeacherName: null,
        }),
        false,
      ),
    ).toEqual(['Recess']);
  });

  it("shows the class on a teacher's timetable, and who covers or whom they cover", () => {
    expect(cellLines(entry(), true)).toEqual(['Maths', 'Grade 5 A']);
    expect(
      cellLines(
        entry({ isCovered: true, coverSubstituteName: 'Teacher Two' }),
        true,
      ),
    ).toEqual(['Maths', 'Grade 5 A', 'Covered by Teacher Two']);
    expect(
      cellLines(entry({ isCoverDuty: true, isCovered: true }), true),
    ).toEqual(['Maths', 'Grade 5 A', 'Covering']);
  });
});
