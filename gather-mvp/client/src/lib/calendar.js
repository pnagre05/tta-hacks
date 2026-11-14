// Pure date helpers for the Schedule page (week and month views). No React, so they can be unit tested.
//
// A "day" here is a calendar date carried by a Date at local midnight, so adding days is plain calendar arithmetic.
// Anything that needs a real moment in time takes an optional `tz` (an IANA zone such as 'America/Chicago').
// With a `tz`, wall-clock times are read and built in that zone; without one they use the browser's zone.
import { localParts as zoneParts, zonedToUtc } from './zone.js';

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

// The calendar date (a local-midnight Date) that an instant falls on in `tz`.
export function dateInZone(time, tz) {
  const p = zoneParts(new Date(time), tz);
  return new Date(p.year, p.month - 1, p.day);
}

// Today's calendar date in `tz` (or in the browser's zone).
export function todayIn(tz) {
  return tz ? dateInZone(Date.now(), tz) : startOfDay(new Date());
}

// Wall-clock parts of an instant, in `tz` or the browser's zone.
export function wallParts(time, tz) {
  if (tz) return zoneParts(new Date(time), tz);
  const d = new Date(time);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() };
}

// Which week (relative to `base`) a moment falls in.
export function weekOf(time, base, tz) {
  const day = tz ? dateInZone(time, tz) : new Date(time);
  return Math.floor(daysBetween(base, day) / 7);
}

// Timestamp of a half-hour cell on a given day, in `tz` or the browser's zone.
export function cellTime(day, hour, minute, tz) {
  if (tz) return zonedToUtc(day.getFullYear(), day.getMonth() + 1, day.getDate(), hour, minute, tz).getTime();
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

// Half-hour cells (timestamps) covered by saved busy blocks, for the given days.
export function cellsFromBlocks(blocks, days, tz) {
  const out = new Set();
  const rows = gridRows();
  for (const b of blocks) {
    const s = new Date(b.start).getTime();
    const e = new Date(b.end).getTime();
    for (const day of days) {
      for (const [h, m] of rows) {
        const t = cellTime(day, h, m, tz);
        if (s < t + STEP_MS && e > t) out.add(t);
      }
    }
  }
  return out;
}

// Copy the marked cells of week `week` onto each of the next `count` weeks (same weekday and wall-clock time).
// Returns only the new timestamps; it never goes past the last week you can plan in.
export function repeatCells(selected, week, count, base, tz) {
  const out = new Set();
  for (const t of selected) {
    if (weekOf(t, base, tz) !== week) continue;
    const p = wallParts(t, tz);
    const day = new Date(p.year, p.month - 1, p.day);
    for (let k = 1; k <= count; k++) {
      if (week + k >= MAX_WEEKS) break;
      out.add(cellTime(addDays(day, 7 * k), p.hour, p.minute, tz));
    }
  }
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
export function bestFreeCount(day, memberIds, byUser, minMinutes = 120, tz) {
  const steps = Math.max(1, Math.round(minMinutes / 30));
  const rows = gridRows();
  const at = (i) => (i < rows.length ? cellTime(day, rows[i][0], rows[i][1], tz) : cellTime(day, END_HOUR, 0, tz));
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

const pad = (n) => String(n).padStart(2, '0');

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" as wall-clock time, in `tz` or the browser's zone.
export function toLocalInput(date, tz) {
  const p = wallParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// The instant a datetime-local value names, read in `tz` or the browser's zone. Invalid input gives an invalid Date.
export function fromLocalInput(value, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!m) return new Date(NaN);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  return tz ? zonedToUtc(y, mo, d, h, mi, tz) : new Date(y, mo - 1, d, h, mi);
}

// The next whole hour on the wall clock of `tz` (or the browser's zone).
export function nextHour(now = new Date(), tz) {
  if (!tz) {
    const x = new Date(now);
    x.setHours(x.getHours() + 1, 0, 0, 0);
    return x;
  }
  const p = zoneParts(new Date(now), tz);
  return zonedToUtc(p.year, p.month, p.day, p.hour + 1, 0, tz);
}
