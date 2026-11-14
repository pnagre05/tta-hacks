// Time zone helpers built on the browser's Intl API (the same approach as server/src/lib/time.js).
// Times are always stored as UTC instants; a zone only decides how a wall-clock time maps to one.

const cache = new Map();
function formatter(timeZone) {
  if (!cache.has(timeZone)) {
    cache.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
        weekday: 'short', hourCycle: 'h23',
      })
    );
  }
  return cache.get(timeZone);
}

// Wall-clock parts of an instant in a zone: { year, month (1-12), day, hour, minute, weekday }.
export function localParts(date, timeZone) {
  const out = {};
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type === 'weekday') out.weekday = p.value;
    else if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

// Zone offset from UTC in minutes at an instant (for example -360 for US Central standard time).
export function offsetMinutes(timeZone, date) {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

// Convert a wall-clock time in a zone to the UTC instant it names. Hours and minutes may overflow (hour 24 = next day).
export function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const first = new Date(guess.getTime() - offsetMinutes(timeZone, guess) * 60000);
  return new Date(guess.getTime() - offsetMinutes(timeZone, first) * 60000); // second pass handles DST edges
}

export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function validZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const FALLBACK = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage',
  'Pacific/Honolulu', 'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris',
  'Europe/Berlin', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo',
  'Australia/Sydney', 'Pacific/Auckland',
];

// Every zone the browser knows, plus any extras (for example the group's zone), sorted.
export function zoneChoices(extra = []) {
  let list;
  try {
    list = Intl.supportedValuesOf('timeZone');
  } catch {
    list = FALLBACK;
  }
  return [...new Set([...list, 'UTC', ...extra.filter(Boolean)])].sort();
}
