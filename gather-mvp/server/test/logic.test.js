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
