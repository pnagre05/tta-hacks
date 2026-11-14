import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useGroupData } from '../live.js';

const START_HOUR = 9;
const END_HOUR = 23;
const DAYS = 7;
const STEP = 30 * 60 * 1000;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Tap half-hour cells to mark yourself busy. Google busy times show in grey (read only).
export default function AvailabilityGrid({ ctx }) {
  const { data } = useGroupData(`/groups/${ctx.groupId}/availability?days=8`, ['availability']);
  const [selected, setSelected] = useState(new Set());
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(null);
  const [painting, setPainting] = useState(null); // true = marking busy, false = clearing

  const days = useMemo(() => {
    const base = startOfToday();
    return Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d;
    });
  }, []);

  const rows = useMemo(() => {
    const out = [];
    for (let h = START_HOUR; h < END_HOUR; h++) out.push([h, 0], [h, 30]);
    return out;
  }, []);

  const cellTime = (day, [h, m]) => {
    const d = new Date(day);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };

  const mine = (data?.busy || []).filter((b) => b.userId === ctx.user.id);
  const googleBusy = mine.filter((b) => b.source === 'google').map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()]);
  const isGoogle = (t) => googleBusy.some(([s, e]) => s < t + STEP && e > t);

  // Load my saved manual blocks into the grid (unless I'm mid-edit).
  useEffect(() => {
    if (!data || dirty) return;
    const set = new Set();
    for (const b of mine.filter((x) => x.source === 'manual')) {
      const s = new Date(b.start).getTime();
      const e = new Date(b.end).getTime();
      for (const day of days) for (const r of rows) {
        const t = cellTime(day, r);
        if (s < t + STEP && e > t) set.add(t);
      }
    }
    setSelected(set);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const apply = (t, value) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (value) next.add(t); else next.delete(t);
      return next;
    });
    setDirty(true);
    setStatus(null);
  };

  const save = async () => {
    // Merge back-to-back cells into blocks.
    const times = [...selected].sort((a, b) => a - b);
    const busy = [];
    for (const t of times) {
      const last = busy[busy.length - 1];
      if (last && last.end === t) last.end = t + STEP;
      else busy.push({ start: t, end: t + STEP });
    }
    const windowStart = days[0];
    const windowEnd = new Date(days[DAYS - 1]);
    windowEnd.setDate(windowEnd.getDate() + 1);
    try {
      await api(`/groups/${ctx.groupId}/availability/me`, {
        method: 'PUT',
        body: {
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
          busy: busy.map((b) => ({ start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString() })),
        },
      });
      setDirty(false);
      setStatus('Saved. Everyone\'s suggestions just updated.');
    } catch (e) {
      setStatus(e.message);
    }
  };

  return (
    <div className="card">
      <div className="row between">
        <h3>When are you busy?</h3>
        <button className="primary small-btn" onClick={save} disabled={!dirty}>Save</button>
      </div>
      <p className="small muted">Tap or drag over times you're busy. <span className="legend busy" /> you <span className="legend google" /> Google Calendar</p>
      <div className="grid-wrap" onPointerUp={() => setPainting(null)} onPointerLeave={() => setPainting(null)}>
        <table className="avail">
          <thead>
            <tr>
              <th />
              {days.map((d) => (
                <th key={d.getTime()}>
                  {d.toLocaleDateString(undefined, { weekday: 'short' })}
                  <br />
                  <span className="muted">{d.getDate()}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.join(':')}>
                <td className="time">{r[1] === 0 ? new Date(2000, 0, 1, r[0]).toLocaleTimeString(undefined, { hour: 'numeric' }) : ''}</td>
                {days.map((day) => {
                  const t = cellTime(day, r);
                  const past = t + STEP <= Date.now();
                  const google = isGoogle(t);
                  const on = selected.has(t);
                  return (
                    <td
                      key={t}
                      className={`cell ${on ? 'busy' : ''} ${google ? 'google' : ''} ${past ? 'past' : ''}`}
                      onPointerDown={(e) => {
                        if (past) return;
                        e.preventDefault();
                        setPainting(!on);
                        apply(t, !on);
                      }}
                      onPointerEnter={() => painting !== null && !past && apply(t, painting)}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {status && <div className="small">{status}</div>}
    </div>
  );
}
