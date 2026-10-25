/** What the clash rules need to know about one period of the weekly timetable. */
export interface ClashSlot {
  id: string;
  sectionId: string;
  dayOfWeek: string;
  /** 24-hour `HH:mm`. */
  startTime: string;
  endTime: string;
  staffProfileId: string | null;
  room: string | null;
}

export type ClashKind = 'TEACHER' | 'ROOM';

export interface Clash {
  kind: ClashKind;
  first: ClashSlot;
  second: ClashSlot;
}

/** `HH:mm` as minutes after midnight. */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Whether two periods overlap in time. A period that ends exactly when the
 * next one starts does not overlap it.
 *
 * @param {string} firstStart - `HH:mm`.
 * @param {string} firstEnd - `HH:mm`.
 * @param {string} secondStart - `HH:mm`.
 * @param {string} secondEnd - `HH:mm`.
 * @returns {boolean} True when the two share any time.
 */
export function timesOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string,
): boolean {
  return (
    toMinutes(firstStart) < toMinutes(secondEnd) &&
    toMinutes(secondStart) < toMinutes(firstEnd)
  );
}

/** A room as it is compared: trimmed and without regard to case, or null when empty. */
export function normalizeRoom(room: string | null | undefined): string | null {
  const trimmed = room?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

/**
 * The clash between two periods, if any: the same teacher in two places at
 * once, or two periods in the same room at once. Periods of the same section
 * are never compared on room or teacher alone, since one section's periods
 * cannot overlap each other by their own unique slot rule.
 *
 * @param {ClashSlot} first - One period.
 * @param {ClashSlot} second - Another period.
 * @returns {ClashKind[]} Every kind of clash between them; empty when there is none.
 */
export function clashKindsBetween(
  first: ClashSlot,
  second: ClashSlot,
): ClashKind[] {
  if (first.id === second.id || first.dayOfWeek !== second.dayOfWeek) return [];
  if (
    !timesOverlap(
      first.startTime,
      first.endTime,
      second.startTime,
      second.endTime,
    )
  ) {
    return [];
  }
  const kinds: ClashKind[] = [];
  if (first.staffProfileId && first.staffProfileId === second.staffProfileId) {
    kinds.push('TEACHER');
  }
  const room = normalizeRoom(first.room);
  if (room && room === normalizeRoom(second.room)) kinds.push('ROOM');
  return kinds;
}

/**
 * Every clash among a set of periods, each pair reported once.
 *
 * @param {ClashSlot[]} slots - The periods to check, typically a whole campus.
 * @returns {Clash[]} The clashes, ordered by day then time.
 */
export function findClashes(slots: ClashSlot[]): Clash[] {
  const clashes: Clash[] = [];
  const byDay = new Map<string, ClashSlot[]>();
  for (const slot of slots) {
    byDay.set(slot.dayOfWeek, [...(byDay.get(slot.dayOfWeek) ?? []), slot]);
  }
  for (const daySlots of byDay.values()) {
    const sorted = [...daySlots].sort(
      (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime),
    );
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        // Sorted by start, so once a later period starts after this one ends, none after it can overlap.
        if (toMinutes(sorted[j].startTime) >= toMinutes(sorted[i].endTime))
          break;
        for (const kind of clashKindsBetween(sorted[i], sorted[j])) {
          clashes.push({ kind, first: sorted[i], second: sorted[j] });
        }
      }
    }
  }
  return clashes;
}
