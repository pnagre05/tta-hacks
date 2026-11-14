// Time-zone helpers using only the built-in Intl API (no extra libraries).

const partsCache = new Map();
function formatter(timeZone) {
  if (!partsCache.has(timeZone)) {
    partsCache.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'short',
        hourCycle: 'h23',
      })
    );
  }
  return partsCache.get(timeZone);
}

// Wall-clock parts of a Date in a time zone: { year, month (1-12), day, hour, minute, weekday }
function localParts(date, timeZone) {
  const out = {};
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type === 'weekday') out.weekday = p.value;
    else if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

// Offset of the zone from UTC in minutes at a given instant (e.g. -360 for CST).
function offsetMinutes(timeZone, date) {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

// Convert a wall-clock time in a zone to a UTC Date.
function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const first = new Date(guess.getTime() - offsetMinutes(timeZone, guess) * 60000);
  // Second pass handles DST boundaries.
  return new Date(guess.getTime() - offsetMinutes(timeZone, first) * 60000);
}

// "Sat, Nov 21, 2:00 PM – 5:00 PM"
function formatRange(start, end, timeZone) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' });
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  return `${day.format(start)}, ${time.format(start)} – ${time.format(end)}`;
}

function formatDateTime(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

module.exports = { localParts, offsetMinutes, zonedToUtc, formatRange, formatDateTime };
