import test from 'node:test';
import assert from 'node:assert';
import {
  addDays, bestFreeCount, busyByUser, daysBetween, monthDays, nextHour, startOfDay, toLocalInput, weekDays, weekOf,
} from '../src/lib/calendar.js';

// Dates are built with the local constructor, so these tests pass in any time zone.
const d = (y, m, day, h = 0, min = 0) => new Date(y, m - 1, day, h, min);

test('daysBetween counts calendar days, including across daylight saving changes', () => {
  assert.strictEqual(daysBetween(d(2026, 10, 30), d(2026, 11, 3)), 4);
  assert.strictEqual(daysBetween(d(2026, 3, 7), d(2026, 3, 9)), 2);
  assert.strictEqual(daysBetween(d(2026, 11, 14, 23, 59), d(2026, 11, 14, 0, 1)), 0);
  assert.strictEqual(daysBetween(d(2026, 11, 14), d(2026, 11, 13)), -1);
});

test('weekDays returns 7 consecutive days starting at the week offset', () => {
  const base = d(2026, 11, 14);
  const w1 = weekDays(base, 1);
  assert.strictEqual(w1.length, 7);
  assert.strictEqual(daysBetween(base, w1[0]), 7);
  assert.strictEqual(daysBetween(w1[0], w1[6]), 6);
});

test('weekOf puts each moment in the right week', () => {
  const base = d(2026, 11, 14);
  assert.strictEqual(weekOf(d(2026, 11, 14, 9), base), 0);
  assert.strictEqual(weekOf(d(2026, 11, 20, 22, 30), base), 0);
  assert.strictEqual(weekOf(d(2026, 11, 21, 9), base), 1);
  assert.strictEqual(weekOf(d(2026, 11, 13, 9), base), -1);
});

test('monthDays covers whole Sunday-to-Saturday weeks', () => {
  const nov = monthDays(2026, 10); // November 2026 starts on a Sunday and ends on a Monday
  assert.strictEqual(nov.length % 7, 0);
  assert.strictEqual(nov[0].getDay(), 0);
  assert.strictEqual(nov[nov.length - 1].getDay(), 6);
  assert.strictEqual(nov[0].getDate(), 1);
  assert.strictEqual(nov[nov.length - 1].getMonth(), 11); // runs into early December
  assert.ok(nov.some((x) => x.getMonth() === 10 && x.getDate() === 30));

  const feb = monthDays(2027, 1); // February 2027 starts on a Monday
  assert.strictEqual(feb[0].getMonth(), 0); // begins in January
  assert.strictEqual(feb[0].getDay(), 0);
  for (let i = 1; i < feb.length; i++) assert.strictEqual(daysBetween(feb[i - 1], feb[i]), 1);
});

test('bestFreeCount finds the most people free together for 2+ hours', () => {
  const day = d(2026, 11, 20);
  const iso = (h) => d(2026, 11, 20, h).toISOString();
  const ids = [1, 2];

  // Nobody busy: everyone is free.
  assert.strictEqual(bestFreeCount(day, ids, busyByUser(ids, [])), 2);

  // User 1 is busy 9-17, so both are free together 17-23.
  let busy = busyByUser(ids, [{ userId: 1, start: iso(9), end: iso(17) }]);
  assert.strictEqual(bestFreeCount(day, ids, busy), 2);

  // User 1 is busy all day: only user 2 can be free.
  busy = busyByUser(ids, [{ userId: 1, start: iso(9), end: iso(23) }]);
  assert.strictEqual(bestFreeCount(day, ids, busy), 1);

  // A free gap shorter than 2 hours doesn't count for user 1.
  busy = busyByUser(ids, [
    { userId: 1, start: iso(9), end: iso(12) },
    { userId: 1, start: iso(13), end: iso(23) },
  ]);
  assert.strictEqual(bestFreeCount(day, ids, busy), 1);

  // Everyone busy all day: nobody.
  busy = busyByUser(ids, [
    { userId: 1, start: iso(9), end: iso(23) },
    { userId: 2, start: iso(9), end: iso(23) },
  ]);
  assert.strictEqual(bestFreeCount(day, ids, busy), 0);
});

test('toLocalInput round-trips through a datetime-local value', () => {
  const when = d(2026, 11, 20, 19, 30);
  assert.strictEqual(toLocalInput(when), '2026-11-20T19:30');
  assert.strictEqual(new Date(toLocalInput(when)).getTime(), when.getTime());
});

test('nextHour rounds up to the next whole hour', () => {
  assert.strictEqual(nextHour(d(2026, 11, 14, 15, 20)).getTime(), d(2026, 11, 14, 16, 0).getTime());
  assert.strictEqual(nextHour(d(2026, 11, 14, 23, 59)).getTime(), d(2026, 11, 15, 0, 0).getTime());
});

test('startOfDay and addDays stay on calendar days', () => {
  assert.strictEqual(startOfDay(d(2026, 11, 14, 17, 45)).getTime(), d(2026, 11, 14).getTime());
  assert.strictEqual(addDays(d(2026, 10, 31), 1).getTime(), d(2026, 11, 1).getTime());
});
