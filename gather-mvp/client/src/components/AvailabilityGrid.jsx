import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useGroupData } from '../live.js';
import { useZone } from '../timezone.jsx';
import MonthCalendar, { weekForDay } from './MonthCalendar.jsx';
import {
  MAX_WEEKS, STEP_MS, addDays, cellTime, cellsFromBlocks, gridRows, repeatCells, todayIn, weekDays, weekOf,
} from '../lib/calendar.js';

// Tap half-hour cells to mark yourself busy. Browse weeks with the arrows or jump from the month calendar.
// Edits stay in memory while you move between weeks; Save writes every week you changed.
// Everything is read and written in the chosen time zone, so "9 AM" means 9 AM there.
export default function AvailabilityGrid({ ctx }) {
  const { zone } = useZone();
  const base = useMemo(() => todayIn(zone), [zone]);
  const [week, setWeek] = useState(0);
  const days = useMemo(() => weekDays(base, week), [base, week]);
  const rows = useMemo(() => gridRows(), []);
  const from = cellTime(days[0], 0, 0, zone);
  const to = cellTime(addDays(days[6], 1), 0, 0, zone);

  const { data } = useGroupData(
    `/groups/${ctx.groupId}/availability?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`,
    ['availability']
  );

  const [selected, setSelected] = useState(new Set()); // timestamps of cells I marked busy, across all weeks
  const [dirtyWeeks, setDirtyWeeks] = useState(new Set());
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [painting, setPainting] = useState(null); // true = marking busy, false = clearing
  const [repeatWeeks, setRepeatWeeks] = useState(4);
  const [repeating, setRepeating] = useState(false);

  const mine = (data?.busy || []).filter((b) => b.userId === ctx.user.id && b.source === 'manual');

  // When this week's saved data arrives, load it into the grid (unless I have unsaved edits to this week).
  useEffect(() => {
    if (!data || dirtyWeeks.has(week)) return;
    const saved = cellsFromBlocks(mine, days, zone);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const day of days) for (const r of rows) next.delete(cellTime(day, r[0], r[1], zone));
      saved.forEach((t) => next.add(t));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const apply = (t, value) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (value) next.add(t); else next.delete(t);
      return next;
    });
    setDirtyWeeks((prev) => new Set(prev).add(weekOf(t, base, zone)));
    setStatus(null);
  };

  const saveWeek = async (w) => {
    const wd = weekDays(base, w);
    const times = [...selected].filter((t) => weekOf(t, base, zone) === w).sort((a, b) => a - b);
    const busy = [];
    for (const t of times) {
      const last = busy[busy.length - 1];
      if (last && last.end === t) last.end = t + STEP_MS; // merge back-to-back cells into one block
      else busy.push({ start: t, end: t + STEP_MS });
    }
    await api(`/groups/${ctx.groupId}/availability/me`, {
      method: 'PUT',
      body: {
        windowStart: new Date(cellTime(wd[0], 0, 0, zone)).toISOString(),
        windowEnd: new Date(cellTime(addDays(wd[6], 1), 0, 0, zone)).toISOString(),
        busy: busy.map((b) => ({ start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString() })),
      },
    });
  };

  const save = async () => {
    const weeks = [...dirtyWeeks].sort((a, b) => a - b);
    setSaving(true);
    try {
      for (const w of weeks) {
        await saveWeek(w);
        setDirtyWeeks((prev) => {
          const next = new Set(prev);
          next.delete(w);
          return next;
        });
      }
      setStatus("Saved. Everyone's suggestions just updated.");
    } catch (e) {
      setStatus(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Copy this week's busy times onto the next few weeks. Nothing is saved until you click Save.
  const weekHasMarks = [...selected].some((t) => weekOf(t, base, zone) === week);
  const repeatForward = async () => {
    const copies = repeatCells(selected, week, repeatWeeks, base, zone);
    if (copies.size === 0) return;
    const targets = [];
    for (let k = 1; k <= repeatWeeks && week + k < MAX_WEEKS; k++) targets.push(week + k);
    setRepeating(true);
    setStatus(null);
    try {
      // Load what's already saved in those weeks first, so saving later doesn't wipe it.
      const alreadySaved = new Set();
      for (const w of targets) {
        if (dirtyWeeks.has(w)) continue; // already in memory, with edits
        const wd = weekDays(base, w);
        const wFrom = new Date(cellTime(wd[0], 0, 0, zone)).toISOString();
        const wTo = new Date(cellTime(addDays(wd[6], 1), 0, 0, zone)).toISOString();
        const res = await api(`/groups/${ctx.groupId}/availability?from=${encodeURIComponent(wFrom)}&to=${encodeURIComponent(wTo)}`);
        const mineThatWeek = res.busy.filter((b) => b.userId === ctx.user.id && b.source === 'manual');
        cellsFromBlocks(mineThatWeek, wd, zone).forEach((t) => alreadySaved.add(t));
      }
      setSelected((prev) => {
        const next = new Set(prev);
        alreadySaved.forEach((t) => next.add(t));
        copies.forEach((t) => next.add(t));
        return next;
      });
      setDirtyWeeks((prev) => {
        const next = new Set(prev);
        targets.forEach((w) => next.add(w));
        return next;
      });
      setStatus(`Copied to the next ${targets.length} week${targets.length > 1 ? 's' : ''}. Click Save to keep it.`);
    } catch (e) {
      setStatus(e.message);
    } finally {
      setRepeating(false);
    }
  };

  const rangeLabel = `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  const otherDirty = [...dirtyWeeks].filter((w) => w !== week).length;

  return (
    <>
      <MonthCalendar ctx={ctx} base={base} onPickDay={(d) => setWeek(weekForDay(d, base))} />

      <div className="card">
        <div className="row between">
          <h3>When are you busy?</h3>
          <button className="primary small-btn" onClick={save} disabled={dirtyWeeks.size === 0 || saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>

        <div className="row between week-nav">
          <button className="small-btn" onClick={() => setWeek((w) => Math.max(0, w - 1))} disabled={week === 0} aria-label="Previous week">‹</button>
          <div className="strong">{rangeLabel}</div>
          <button className="small-btn" onClick={() => setWeek((w) => Math.min(MAX_WEEKS - 1, w + 1))} disabled={week >= MAX_WEEKS - 1} aria-label="Next week">›</button>
        </div>
        <div className="row between">
          <button className="link" onClick={() => setWeek(0)} disabled={week === 0}>This week</button>
          {otherDirty > 0 && <span className="small muted">Unsaved changes in {otherDirty} other week{otherDirty > 1 ? 's' : ''}</span>}
        </div>

        <div className="row gap wrap">
          <button className="small-btn" onClick={repeatForward} disabled={!weekHasMarks || saving || repeating || week >= MAX_WEEKS - 1}>
            {repeating ? 'Copying…' : 'Repeat this week for the next'}
          </button>
          <select value={repeatWeeks} onChange={(e) => setRepeatWeeks(Number(e.target.value))} aria-label="Number of weeks to repeat" id="repeat-weeks">
            {[1, 2, 4, 8].map((n) => <option key={n} value={n}>{n} week{n > 1 ? 's' : ''}</option>)}
          </select>
        </div>

        <p className="small muted">
          Tap or drag over times you're busy. <span className="legend busy" /> you. Times are in {zone.replaceAll('_', ' ')}.
        </p>
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
                    const t = cellTime(day, r[0], r[1], zone);
                    const past = t + STEP_MS <= Date.now();
                    const on = selected.has(t);
                    return (
                      <td
                        key={t}
                        className={`cell ${on ? 'busy' : ''} ${past ? 'past' : ''}`}
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
    </>
  );
}
