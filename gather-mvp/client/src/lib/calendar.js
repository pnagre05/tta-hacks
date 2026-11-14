// Pure date helpers for the Schedule page (week and month views). No React, so they can be unit tested.
// All dates are in the browser's local time zone, and "days" are calendar days (safe across daylight saving).

export const DAY_MS = 24 * 60 * 60 * 1000;
export const STEP_MS = 30 * 60 * 1000;
export const START_HOUR = 9;
export const END_HOUR = 23;
export const MAX_WEEKS = 13; // how far ahead you can plan (about 3 months)

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Whole calendar days from a to b (negative if b is earlier).
export function daysBetween(a, b) {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

// The 7 days of week number `offset`, where week 0 starts on `base` (today).
export function weekDays(base, offset) {
  return Array.from({ length: 7 }, (_, i) => addDays(base, offset * 7 + i));
}

// Which week (relative to `base`) a moment or day falls in.
export function weekOf(time, base) {
  return Math.floor(daysBetween(base, new Date(time)) / 7);
}

// Timestamp of a half-hour cell on a given day.
export function cellTime(day, hour, minute) {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

// The [hour, minute] rows of the grid: 9:00, 9:30, ... 22:30.
export function gridRows() {
  const rows = [];
  for (let h = START_HOUR; h < END_HOUR; h++) rows.push([h, 0], [h, 30]);
  return rows;
}

// Every day shown in a month calendar: whole weeks, Sunday to Saturday, covering the month.
export function monthDays(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = addDays(first, -first.getDay());
  const end = addDays(last, 6 - last.getDay());
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

// Map of userId -> [[startMs, endMs], ...] from the API's busy list.
export function busyByUser(memberIds, busy) {
  const map = new Map(memberIds.map((id) => [id, []]));
  for (const b of busy) {
    if (map.has(b.userId)) map.get(b.userId).push([new Date(b.start).getTime(), new Date(b.end).getTime()]);
  }
  return map;
}

// The most people who are all free for an uninterrupted `minMinutes` block somewhere in this day's 9-to-11 window.
export function bestFreeCount(day, memberIds, byUser, minMinutes = 120) {
  const steps = Math.max(1, Math.round(minMinutes / 30));
  const rows = gridRows();
  const at = (i) => (i < rows.length ? cellTime(day, rows[i][0], rows[i][1]) : cellTime(day, END_HOUR, 0));
  let best = 0;
  for (let i = 0; i + steps <= rows.length; i++) {
    const wStart = at(i);
    const wEnd = at(i + steps);
    let free = 0;
    for (const id of memberIds) {
      const busy = byUser.get(id) || [];
      if (!busy.some(([s, e]) => s < wEnd && e > wStart)) free++;
    }
    if (free > best) best = free;
    if (best === memberIds.length) break;
  }
  return best;
}

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time.
export function toLocalInput(date) {
  const x = new Date(date);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
}

// The next whole hour from `now`.
export function nextHour(now = new Date()) {
  const x = new Date(now);
  x.setHours(x.getHours() + 1, 0, 0, 0);
  return x;
}
