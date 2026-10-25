import {
  ClashSlot,
  clashKindsBetween,
  findClashes,
  normalizeRoom,
  timesOverlap,
  toMinutes,
} from './timetable-clash.util';

const slot = (overrides: Partial<ClashSlot> = {}): ClashSlot => ({
  id: 'a',
  sectionId: 'sec-1',
  dayOfWeek: 'MONDAY',
  startTime: '08:00',
  endTime: '08:40',
  staffProfileId: null,
  room: null,
  ...overrides,
});

describe('toMinutes', () => {
  it.each([
    ['00:00', 0],
    ['08:40', 520],
    ['23:59', 1439],
  ])('reads %s as %i', (time, minutes) => {
    expect(toMinutes(time)).toBe(minutes);
  });
});

describe('timesOverlap', () => {
  it.each([
    ['08:00', '08:40', '08:30', '09:10', true],
    ['08:30', '09:10', '08:00', '08:40', true],
    ['08:00', '09:00', '08:10', '08:20', true],
    ['08:00', '08:40', '08:00', '08:40', true],
    ['08:00', '08:40', '08:40', '09:20', false],
    ['08:40', '09:20', '08:00', '08:40', false],
    ['08:00', '08:40', '10:00', '10:40', false],
  ])('%s-%s against %s-%s overlaps: %s', (a, b, c, d, expected) => {
    expect(timesOverlap(a, b, c, d)).toBe(expected);
  });
});

describe('normalizeRoom', () => {
  it.each([
    ['Lab 1', 'lab 1'],
    ['  Lab 1 ', 'lab 1'],
    ['LAB 1', 'lab 1'],
    ['', null],
    ['   ', null],
    [null, null],
    [undefined, null],
  ])('reads %p as %p', (room, normalized) => {
    expect(normalizeRoom(room)).toBe(normalized);
  });
});

describe('clashKindsBetween', () => {
  it('finds the same teacher at overlapping times on the same day', () => {
    expect(
      clashKindsBetween(
        slot({ id: 'a', staffProfileId: 't1' }),
        slot({
          id: 'b',
          sectionId: 'sec-2',
          startTime: '08:20',
          endTime: '09:00',
          staffProfileId: 't1',
        }),
      ),
    ).toEqual(['TEACHER']);
  });

  it('finds the same room, ignoring case and spaces', () => {
    expect(
      clashKindsBetween(
        slot({ id: 'a', room: 'Lab 1' }),
        slot({ id: 'b', sectionId: 'sec-2', room: ' lab 1 ' }),
      ),
    ).toEqual(['ROOM']);
  });

  it('reports both when the teacher and the room clash', () => {
    expect(
      clashKindsBetween(
        slot({ id: 'a', staffProfileId: 't1', room: 'R1' }),
        slot({ id: 'b', sectionId: 'sec-2', staffProfileId: 't1', room: 'R1' }),
      ),
    ).toEqual(['TEACHER', 'ROOM']);
  });

  it.each([
    [
      'different teachers',
      slot({ staffProfileId: 't1' }),
      slot({ id: 'b', staffProfileId: 't2' }),
    ],
    ['no teacher at all', slot(), slot({ id: 'b' })],
    [
      'different days',
      slot({ staffProfileId: 't1' }),
      slot({ id: 'b', dayOfWeek: 'TUESDAY', staffProfileId: 't1' }),
    ],
    [
      'back to back',
      slot({ staffProfileId: 't1' }),
      slot({
        id: 'b',
        startTime: '08:40',
        endTime: '09:20',
        staffProfileId: 't1',
      }),
    ],
    ['different rooms', slot({ room: 'R1' }), slot({ id: 'b', room: 'R2' })],
    ['no room', slot({ room: '' }), slot({ id: 'b', room: null })],
    [
      'the same period',
      slot({ staffProfileId: 't1' }),
      slot({ staffProfileId: 't1' }),
    ],
  ])('finds nothing for %s', (_name, first, second) => {
    expect(clashKindsBetween(first, second)).toEqual([]);
  });
});

describe('findClashes', () => {
  it('lists each clashing pair once, in time order', () => {
    const slots = [
      slot({
        id: 'c',
        sectionId: 'sec-3',
        startTime: '09:00',
        endTime: '09:40',
        staffProfileId: 't1',
      }),
      slot({
        id: 'a',
        staffProfileId: 't1',
        startTime: '08:30',
        endTime: '09:10',
      }),
      slot({
        id: 'b',
        sectionId: 'sec-2',
        staffProfileId: 't1',
        startTime: '08:00',
        endTime: '08:40',
      }),
    ];

    const clashes = findClashes(slots);

    expect(clashes.map((c) => [c.kind, c.first.id, c.second.id])).toEqual([
      ['TEACHER', 'b', 'a'],
      ['TEACHER', 'a', 'c'],
    ]);
  });

  it('finds nothing in a clean timetable, and in an empty one', () => {
    expect(
      findClashes([
        slot({ id: 'a', staffProfileId: 't1' }),
        slot({ id: 'b', sectionId: 'sec-2', staffProfileId: 't2' }),
        slot({
          id: 'c',
          sectionId: 'sec-3',
          startTime: '08:40',
          endTime: '09:20',
          staffProfileId: 't1',
        }),
      ]),
    ).toEqual([]);
    expect(findClashes([])).toEqual([]);
  });

  it('keeps days apart', () => {
    expect(
      findClashes([
        slot({ id: 'a', staffProfileId: 't1' }),
        slot({
          id: 'b',
          sectionId: 'sec-2',
          dayOfWeek: 'TUESDAY',
          staffProfileId: 't1',
        }),
      ]),
    ).toEqual([]);
  });

  it('reports a teacher clash and a room clash separately', () => {
    const clashes = findClashes([
      slot({ id: 'a', staffProfileId: 't1', room: 'R1' }),
      slot({ id: 'b', sectionId: 'sec-2', staffProfileId: 't1', room: 'R1' }),
    ]);

    expect(clashes.map((c) => c.kind)).toEqual(['TEACHER', 'ROOM']);
  });
});
