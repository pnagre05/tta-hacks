import test from 'node:test';
import assert from 'node:assert';
import {
  MAX_WEEKS, addDays, bestFreeCount, busyByUser, cellTime, cellsFromBlocks, dateInZone, daysBetween, fromLocalInput,
  monthDays, nextHour, repeatCells, startOfDay, toLocalInput, weekDays, weekOf,
} from '../src/lib/calendar.js';
import { validZone, zoneChoices, zonedToUtc } from '../src/lib/zone.js';

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

test('cellsFromBlocks turns saved busy blocks into half-hour cells', () => {
  const day = d(2026, 11, 20);
  const cells = cellsFromBlocks(
    [{ start: d(2026, 11, 20, 9).toISOString(), end: d(2026, 11, 20, 10, 30).toISOString() }],
    [day, d(2026, 11, 21)]
  );
  assert.deepStrictEqual([...cells].sort((a, b) => a - b), [
    d(2026, 11, 20, 9).getTime(), d(2026, 11, 20, 9, 30).getTime(), d(2026, 11, 20, 10).getTime(),
  ]);
  // A block on a day that isn't in the list produces nothing.
  assert.strictEqual(cellsFromBlocks([{ start: d(2026, 11, 25, 9).toISOString(), end: d(2026, 11, 25, 10).toISOString() }], [day]).size, 0);
});

test('repeatCells copies a week onto the next weeks at the same weekday and time', () => {
  const base = d(2026, 11, 14);
  const selected = new Set([
    d(2026, 11, 14, 9).getTime(), // week 0, Saturday
    d(2026, 11, 15, 9, 30).getTime(), // week 0, Sunday
    d(2026, 11, 22, 10).getTime(), // week 1: not a source when copying week 0
  ]);
  const copies = repeatCells(selected, 0, 2, base);
  assert.strictEqual(copies.size, 4);
  for (const t of [d(2026, 11, 21, 9), d(2026, 11, 28, 9), d(2026, 11, 22, 9, 30), d(2026, 11, 29, 9, 30)]) {
    assert.ok(copies.has(t.getTime()), `missing ${t.toString()}`);
  }
  assert.ok(!copies.has(d(2026, 11, 29, 10).getTime()), 'week 1 cells are not copied when copying week 0');
});

test('repeatCells keeps the local time across a daylight saving change', () => {
  const base = d(2026, 10, 30);
  const selected = new Set([d(2026, 10, 30, 9).getTime()]);
  const copies = repeatCells(selected, 0, 1, base);
  assert.ok(copies.has(d(2026, 11, 6, 9).getTime()));
});

test('repeatCells never goes past the last plannable week', () => {
  const base = d(2026, 11, 14);
  const lastWeek = MAX_WEEKS - 1;
  const selected = new Set([addDays(base, lastWeek * 7).getTime()]);
  assert.strictEqual(repeatCells(selected, lastWeek, 4, base).size, 0);
  const nearEnd = new Set([addDays(base, (lastWeek - 1) * 7).getTime()]);
  assert.strictEqual(repeatCells(nearEnd, lastWeek - 1, 4, base).size, 1);
});

const CHI = 'America/Chicago';
const TOKYO = 'Asia/Tokyo';

test('zonedToUtc turns a wall-clock time in a zone into the right instant', () => {
  assert.strictEqual(zonedToUtc(2026, 11, 21, 14, 0, CHI).toISOString(), '2026-11-21T20:00:00.000Z');
  assert.strictEqual(zonedToUtc(2026, 7, 21, 14, 0, CHI).toISOString(), '2026-07-21T19:00:00.000Z'); // daylight time
  assert.strictEqual(zonedToUtc(2026, 11, 21, 14, 0, TOKYO).toISOString(), '2026-11-21T05:00:00.000Z');
});

test('dateInZone gives the calendar date an instant falls on in that zone', () => {
  const instant = Date.parse('2026-11-21T02:00:00Z'); // 8 PM on the 20th in Chicago, 11 AM on the 21st in Tokyo
  assert.strictEqual(dateInZone(instant, CHI).getDate(), 20);
  assert.strictEqual(dateInZone(instant, TOKYO).getDate(), 21);
});

test('cellTime builds cells in the chosen zone', () => {
  const day = d(2026, 11, 21);
  assert.strictEqual(cellTime(day, 9, 0, CHI), Date.UTC(2026, 10, 21, 15, 0));
  assert.strictEqual(cellTime(day, 9, 0, TOKYO), Date.UTC(2026, 10, 21, 0, 0));
  assert.strictEqual(cellTime(day, 9, 30, TOKYO), Date.UTC(2026, 10, 21, 0, 30));
});

test('weekOf depends on the zone near a day boundary', () => {
  const base = d(2026, 11, 14);
  const instant = Date.parse('2026-11-21T05:30:00Z'); // 11:30 PM on the 20th in Chicago, 2:30 PM on the 21st in Tokyo
  assert.strictEqual(weekOf(instant, base, CHI), 0);
  assert.strictEqual(weekOf(instant, base, TOKYO), 1);
});

test('toLocalInput and fromLocalInput round-trip in a zone', () => {
  const instant = fromLocalInput('2026-11-21T14:00', CHI);
  assert.strictEqual(instant.toISOString(), '2026-11-21T20:00:00.000Z');
  assert.strictEqual(toLocalInput(instant, CHI), '2026-11-21T14:00');
  assert.strictEqual(toLocalInput(instant, TOKYO), '2026-11-22T05:00');
  assert.ok(Number.isNaN(fromLocalInput('', CHI).getTime()));
});

test('nextHour works for zones with half-hour offsets', () => {
  const now = new Date('2026-11-14T15:20:00Z'); // 8:50 PM in India (UTC+5:30)
  assert.strictEqual(nextHour(now, 'Asia/Kolkata').getTime(), Date.UTC(2026, 10, 14, 15, 30));
});

test('repeatCells keeps the wall-clock time in a zone across a daylight saving change', () => {
  const base = d(2026, 10, 30); // US daylight time ends on Sunday Nov 1
  const friday9am = zonedToUtc(2026, 10, 30, 9, 0, CHI).getTime();
  const copies = repeatCells(new Set([friday9am]), 0, 1, base, CHI);
  assert.ok(copies.has(zonedToUtc(2026, 11, 6, 9, 0, CHI).getTime()), 'still 9 AM in Chicago a week later');
});

test('cellsFromBlocks and bestFreeCount read blocks in the chosen zone', () => {
  const day = d(2026, 11, 20);
  const block = { start: zonedToUtc(2026, 11, 20, 9, 0, TOKYO).toISOString(), end: zonedToUtc(2026, 11, 20, 10, 0, TOKYO).toISOString() };
  const cells = cellsFromBlocks([block], [day], TOKYO);
  assert.deepStrictEqual([...cells].sort((a, b) => a - b), [cellTime(day, 9, 0, TOKYO), cellTime(day, 9, 30, TOKYO)]);
  // The same instants fall outside the 9-to-11 PM window when read in Chicago, so nothing matches that day there.
  assert.strictEqual(cellsFromBlocks([block], [day], CHI).size, 0);

  const ids = [1, 2];
  const busy = busyByUser(ids, [{ userId: 1, start: zonedToUtc(2026, 11, 20, 9, 0, TOKYO).toISOString(), end: zonedToUtc(2026, 11, 20, 23, 0, TOKYO).toISOString() }]);
  assert.strictEqual(bestFreeCount(day, ids, busy, 120, TOKYO), 1);
  assert.strictEqual(bestFreeCount(day, ids, busy, 120, CHI), 2, 'in Chicago that Tokyo day is mostly before the window');
});

test('zone helpers recognise real zones and offer a list to pick from', () => {
  assert.ok(validZone('Europe/London'));
  assert.ok(!validZone('Mars/Olympus'));
  const list = zoneChoices(['Custom/Zone']);
  assert.ok(list.includes('America/Chicago') && list.includes('UTC') && list.includes('Custom/Zone'));
  assert.deepStrictEqual(list, [...list].sort());
});

test('startOfDay and addDays stay on calendar days', () => {
  assert.strictEqual(startOfDay(d(2026, 11, 14, 17, 45)).getTime(), d(2026, 11, 14).getTime());
  assert.strictEqual(addDays(d(2026, 10, 31), 1).getTime(), d(2026, 11, 1).getTime());
});
