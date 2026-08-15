import type { AgendaEvent } from '@/stores/app';

// Takes a single "H:mm" time-of-day, not a full "H:mm - H:mm" range --
// deliberately not named the same as the range-taking helpers of the same
// shape below, since a caller that mixed them up would silently get NaN
// back rather than a type error.
function minutesSinceMidnight(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// Parses "YYYY-MM-DD" + "H:mm - H:mm" into a Date for either the start or
// end of that range. Two things need handling beyond a plain `new Date(...)`:
// - `Date`'s ISO parsing requires zero-padded components (`new
//   Date("2026-01-01T9:00:00")` is Invalid Date), but agenda times are
//   authored as "9:00", not "09:00" -- pad before constructing.
// - An event's time range can cross midnight (e.g. "20:00 - 08:00" for an
//   overnight segment) -- when the end time-of-day is not after the start
//   time-of-day, the end is on the *next* calendar date, so advance it by a
//   day. Without this, an overnight event would look like it ended twelve
//   hours before it starts.
export function parseAgendaDateTime(date: string, time: string, isEnd = false): Date {
  const [start, end] = time.split(' - ');
  const t = isEnd ? end : start;
  const result = new Date(`${date}T${t.padStart(5, '0')}:00`);
  if (isEnd && minutesSinceMidnight(end) <= minutesSinceMidnight(start)) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

export function isCurrentAgendaEvent(event: AgendaEvent, now: Date = new Date()): boolean {
  const start = parseAgendaDateTime(event.date, event.time);
  const end = parseAgendaDateTime(event.date, event.time, true);
  return now >= start && now < end;
}

// The single event covering now, if any -- there should only ever be at
// most one (the agenda isn't meant to double-book a segment), but if it
// ever were, the first match is at least a deterministic answer rather
// than an arbitrary one.
export function currentAgendaEvent(events: AgendaEvent[], now: Date = new Date()): AgendaEvent | null {
  return events.find((event) => isCurrentAgendaEvent(event, now)) ?? null;
}
