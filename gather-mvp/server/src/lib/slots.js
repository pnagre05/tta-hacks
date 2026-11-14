// Find the times when the most group members are free.
const { localParts } = require('./time');

const STEP_MS = 30 * 60 * 1000;

/**
 * @param {object} opts
 * @param {{id:number,name:string}[]} opts.members
 * @param {{userId:number,start:Date,end:Date}[]} opts.busy  busy intervals (Google + manual)
 * @param {Date} opts.windowStart
 * @param {Date} opts.windowEnd
 * @param {string} opts.timeZone        group time zone, for the daily hours filter
 * @param {number} [opts.dayStartHour=9] earliest local hour to suggest
 * @param {number} [opts.dayEndHour=23]  latest local hour a slot may run until
 * @param {number} [opts.minMinutes=120] shortest slot worth suggesting
 * @param {number} [opts.minFree=2]      fewest free members worth suggesting
 * @param {number} [opts.limit=10]
 * @returns {{start:Date,end:Date,freeCount:number,total:number,freeMemberIds:number[]}[]}
 */
function rankSlots({
  members, busy, windowStart, windowEnd, timeZone,
  dayStartHour = 9, dayEndHour = 23, minMinutes = 120, minFree = 2, limit = 10,
}) {
  const total = members.length;
  const busyByUser = new Map(members.map((m) => [m.id, []]));
  for (const b of busy) {
    if (busyByUser.has(b.userId)) busyByUser.get(b.userId).push([b.start.getTime(), b.end.getTime()]);
  }

  // Align the first block to the next half hour.
  let t = Math.ceil(windowStart.getTime() / STEP_MS) * STEP_MS;
  const endMs = windowEnd.getTime();

  const slots = [];
  let current = null; // { start, end, key, free }

  const closeCurrent = () => {
    if (current) slots.push(current);
    current = null;
  };

  for (; t + STEP_MS <= endMs; t += STEP_MS) {
    const p = localParts(new Date(t), timeZone);
    const minutesOfDay = p.hour * 60 + p.minute;
    const inHours = minutesOfDay >= dayStartHour * 60 && minutesOfDay + 30 <= dayEndHour * 60;
    if (!inHours) { closeCurrent(); continue; }

    const free = [];
    for (const m of members) {
      const overlaps = busyByUser.get(m.id).some(([s, e]) => s < t + STEP_MS && e > t);
      if (!overlaps) free.push(m.id);
    }
    const key = free.join(',');

    if (current && current.key === key && current.end === t) {
      current.end = t + STEP_MS;
    } else {
      closeCurrent();
      current = { start: t, end: t + STEP_MS, key, free };
    }
  }
  closeCurrent();

  return slots
    .filter((s) => s.free.length >= Math.min(minFree, total) && s.end - s.start >= minMinutes * 60000)
    .sort((a, b) =>
      b.free.length - a.free.length || // most people free
      (b.end - b.start) - (a.end - a.start) || // longest
      a.start - b.start // soonest
    )
    .slice(0, limit)
    .map((s) => ({
      start: new Date(s.start),
      end: new Date(s.end),
      freeCount: s.free.length,
      total,
      freeMemberIds: s.free,
    }));
}

module.exports = { rankSlots };
