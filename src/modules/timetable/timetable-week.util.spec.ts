import { DayOfWeek } from '../../prisma/client';
import {
  decorateWeek,
  WeekCover,
  weekDatesOf,
  WeekSlot,
} from './timetable-week.util';

const slot = (overrides: Partial<WeekSlot> = {}): WeekSlot => ({
  id: 's1',
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
  ...overrides,
});

const cover = (overrides: Partial<WeekCover> = {}): WeekCover => ({
  id: 'c1',
  periodSlotId: 's1',
  date: '2026-11-02',
  substituteStaffProfileId: 't2',
  substituteName: 'Teacher Two',
  reason: 'Sick leave',
  ...overrides,
});

describe('weekDatesOf', () => {
  it('gives the Monday to Sunday week of any date in it', () => {
    for (const date of ['2026-11-02', '2026-11-04', '2026-11-08']) {
      expect(weekDatesOf(date)).toEqual({
        MONDAY: '2026-11-02',
        TUESDAY: '2026-11-03',
        WEDNESDAY: '2026-11-04',
        THURSDAY: '2026-11-05',
        FRIDAY: '2026-11-06',
        SATURDAY: '2026-11-07',
        SUNDAY: '2026-11-08',
      });
    }
  });

  it('crosses month and year ends', () => {
    expect(weekDatesOf('2026-12-31')).toMatchObject({
      MONDAY: '2026-12-28',
      FRIDAY: '2027-01-01',
      SUNDAY: '2027-01-03',
    });
  });

  it('starts the next week on Monday', () => {
    expect(weekDatesOf('2026-11-09').MONDAY).toBe('2026-11-09');
  });
});

describe('decorateWeek', () => {
  const dates = weekDatesOf('2026-11-02');

  it('puts each period on its date with its usual teacher when there is no cover', () => {
    const [entry] = decorateWeek([slot()], [], dates);

    expect(entry).toMatchObject({
      date: '2026-11-02',
      effectiveTeacherName: 'Teacher One',
      isCovered: false,
      coverSubstituteName: null,
      coverReason: null,
      isCoverDuty: false,
    });
  });

  it('shows the cover as the teacher on the covered date only', () => {
    const slots = [slot()];
    const covers = [cover()];

    const thisWeek = decorateWeek(slots, covers, dates)[0];
    const nextWeek = decorateWeek(slots, covers, weekDatesOf('2026-11-09'))[0];

    expect(thisWeek).toMatchObject({
      isCovered: true,
      effectiveTeacherName: 'Teacher Two',
      coverSubstituteName: 'Teacher Two',
      coverReason: 'Sick leave',
    });
    expect(nextWeek.isCovered).toBe(false);
    expect(nextWeek.effectiveTeacherName).toBe('Teacher One');
  });

  it('marks a period as cover duty only for the teacher who covers it', () => {
    const covers = [cover()];

    expect(decorateWeek([slot()], covers, dates, 't2')[0].isCoverDuty).toBe(
      true,
    );
    expect(decorateWeek([slot()], covers, dates, 't1')[0].isCoverDuty).toBe(
      false,
    );
    expect(decorateWeek([slot()], covers, dates, null)[0].isCoverDuty).toBe(
      false,
    );
  });

  it('is not cover duty for a teacher covering their own period', () => {
    const entry = decorateWeek(
      [slot({ staffProfileId: 't2' })],
      [cover()],
      dates,
      't2',
    )[0];

    expect(entry.isCoverDuty).toBe(false);
  });

  it('orders by date, then period, then start time', () => {
    const entries = decorateWeek(
      [
        slot({ id: 'c', dayOfWeek: DayOfWeek.TUESDAY, periodNumber: 1 }),
        slot({
          id: 'b',
          periodNumber: 2,
          startTime: '08:40',
          endTime: '09:20',
        }),
        slot({ id: 'a', periodNumber: 1 }),
      ],
      [],
      dates,
    );

    expect(entries.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('gives nothing for no periods', () => {
    expect(decorateWeek([], [cover()], dates)).toEqual([]);
  });
});
