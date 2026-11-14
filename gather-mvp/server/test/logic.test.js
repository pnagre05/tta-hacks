const test = require('node:test');
const assert = require('node:assert');
const { equalSplit, netBalances, settle } = require('../src/lib/settle');
const { rankSlots } = require('../src/lib/slots');
const { zonedToUtc, localParts } = require('../src/lib/time');

test('equalSplit gives leftover cents to the first people', () => {
  assert.deepStrictEqual(equalSplit(1000, [1, 2, 3]), [
    { userId: 1, shareCents: 334 }, { userId: 2, shareCents: 333 }, { userId: 3, shareCents: 333 },
  ]);
});

test('settle: A $120, B $42, C $18 split three ways', () => {
  const ids = [1, 2, 3];
  const expenses = [
    { paidBy: 1, amountCents: 12000, splits: equalSplit(12000, ids) },
    { paidBy: 2, amountCents: 4200, splits: equalSplit(4200, ids) },
    { paidBy: 3, amountCents: 1800, splits: equalSplit(1800, ids) },
  ];
  const net = netBalances(ids, expenses, []);
  assert.deepStrictEqual([...net.values()], [6000, -1800, -4200]);
  const payments = settle(net);
  assert.deepStrictEqual(payments, [
    { fromUser: 3, toUser: 1, amountCents: 4200 },
    { fromUser: 2, toUser: 1, amountCents: 1800 },
  ]);
  // After recording those payments, everyone is at zero.
  const after = netBalances(ids, expenses, payments);
  assert.ok([...after.values()].every((v) => v === 0));
});

test('settle uses at most n-1 payments', () => {
  const net = new Map([[1, 500], [2, 300], [3, -100], [4, -200], [5, -500]]);
  assert.ok(settle(net).length <= 4);
});

test('zonedToUtc round-trips Chicago wall time', () => {
  const d = zonedToUtc(2026, 11, 21, 14, 0, 'America/Chicago');
  assert.strictEqual(d.toISOString(), '2026-11-21T20:00:00.000Z');
  const p = localParts(d, 'America/Chicago');
  assert.deepStrictEqual([p.hour, p.minute, p.weekday], [14, 0, 'Sat']);
});

test('rankSlots puts the all-free slot first', () => {
  const tz = 'America/Chicago';
  const members = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];
  const at = (h) => zonedToUtc(2026, 11, 21, h, 0, tz); // Saturday
  const busy = [
    { userId: 1, start: at(9), end: at(14) },
    { userId: 2, start: at(17), end: at(23) },
    { userId: 3, start: at(9), end: at(12) },
  ];
  const slots = rankSlots({ members, busy, windowStart: at(9), windowEnd: at(23), timeZone: tz, minMinutes: 120 });
  assert.strictEqual(slots[0].freeCount, 3);
  assert.strictEqual(slots[0].start.toISOString(), at(14).toISOString());
  assert.strictEqual(slots[0].end.toISOString(), at(17).toISOString());
  // Everything after is sorted by free count.
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i - 1].freeCount >= slots[i].freeCount);
});

const TZ = 'America/Chicago';
const dayAt = (day, h) => zonedToUtc(2026, 11, day, h, 0, TZ);

test('rankSlots: a day this week outranks a longer, fully free day next week', () => {
  // Both people are busy 9-11 on Sat Nov 21 (this week), and free all day on Sat Nov 28 (next week).
  const members = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
  const busy = [
    { userId: 1, start: dayAt(21, 9), end: dayAt(21, 11) },
    { userId: 2, start: dayAt(21, 9), end: dayAt(21, 11) },
  ];
  const slots = rankSlots({
    members, busy, windowStart: dayAt(21, 0), windowEnd: dayAt(29, 0), timeZone: TZ, minMinutes: 120,
  });
  const days = slots.map((s) => localParts(s.start, TZ).day);
  assert.strictEqual(days[0], 21, 'this week comes first even though next week is free for longer');
  assert.ok(days.includes(28));
  assert.strictEqual(slots[0].start.toISOString(), dayAt(21, 11).toISOString());
});

test('rankSlots returns at most one slot per day', () => {
  const members = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
  // Person A is busy 12-14 each day, which splits each day into two free blocks.
  const busy = [21, 22, 23].map((d) => ({ userId: 1, start: dayAt(d, 12), end: dayAt(d, 14) }));
  const slots = rankSlots({
    members, busy, windowStart: dayAt(21, 0), windowEnd: dayAt(24, 0), timeZone: TZ, minMinutes: 120,
  });
  const days = slots.map((s) => localParts(s.start, TZ).day);
  assert.strictEqual(new Set(days).size, days.length, 'no day appears twice');
  assert.strictEqual(slots.length, 3);
});

test('rankSlots: within a day, more people free beats a longer slot', () => {
  const members = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];
  // C is busy from 12 on, so 9-12 has all three free and 12-23 has only two.
  const busy = [{ userId: 3, start: dayAt(21, 12), end: dayAt(21, 23) }];
  const slots = rankSlots({
    members, busy, windowStart: dayAt(21, 0), windowEnd: dayAt(22, 0), timeZone: TZ, minMinutes: 120,
  });
  assert.strictEqual(slots.length, 1);
  assert.strictEqual(slots[0].freeCount, 3);
  assert.strictEqual(slots[0].start.toISOString(), dayAt(21, 9).toISOString());
});

test('rankSlots: a day with more people free comes before an earlier day with fewer', () => {
  const members = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];
  // On the 21st, person C is busy all day. On the 22nd, everyone is free.
  const busy = [{ userId: 3, start: dayAt(21, 9), end: dayAt(21, 23) }];
  const slots = rankSlots({
    members, busy, windowStart: dayAt(21, 0), windowEnd: dayAt(23, 0), timeZone: TZ, minMinutes: 120,
  });
  assert.strictEqual(slots[0].freeCount, 3);
  assert.strictEqual(localParts(slots[0].start, TZ).day, 22);
  assert.strictEqual(localParts(slots[1].start, TZ).day, 21);
});
