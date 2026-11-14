import { getZone } from './lib/zoneState.js';

// Every request goes through here. The session lives in an httpOnly cookie the browser sends automatically.
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---- formatting helpers ----
export const money = (cents) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;

// Times are shown in the zone chosen on the Schedule or Group page (see timezone.jsx).
export function fmtRange(start, end) {
  const timeZone = getZone();
  const s = new Date(start);
  const e = new Date(end);
  const day = s.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone });
  const t = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone });
  return `${day}, ${t(s)} – ${t(e)}`;
}

export function fmtWhen(date) {
  return new Date(date).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: getZone(),
  });
}

export function timeLeft(date) {
  const ms = new Date(date) - Date.now();
  if (ms <= 0) return 'closing…';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min left`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min left`;
  return `${Math.round(h / 24)} days left`;
}

export const CATEGORIES = [
  ['restaurants', 'Restaurants'],
  ['outdoor', 'Outdoor'],
  ['entertainment', 'Entertainment'],
  ['at_home', 'At home'],
  ['travel', 'Travel'],
  ['events', 'Events'],
  ['other', 'Other'],
];
export const categoryLabel = (c) => CATEGORIES.find(([k]) => k === c)?.[1] || c;

export const STATUS_LABELS = {
  saved: 'Saved',
  under_consideration: 'In a poll',
  planned: 'Planned',
  completed: 'Completed',
  archived: 'Archived',
};

export const CATEGORY_EMOJI = {
  restaurants: '🍜', outdoor: '🌿', entertainment: '🎳', at_home: '🛋️', travel: '🚗', events: '🎟️', other: '✨',
};
export const CATEGORY_COLOR = {
  restaurants: 'peach', outdoor: 'mint', entertainment: 'lilac', at_home: 'butter', travel: 'sky', events: 'pink', other: 'lilac',
};
