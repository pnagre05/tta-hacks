import { useMemo, useState } from 'react';
import { useGroupData } from '../live.js';
import { useZone } from '../timezone.jsx';
import {
  MAX_WEEKS, addDays, bestFreeCount, busyByUser, cellTime, daysBetween, monthDays, startOfDay,
} from '../lib/calendar.js';

const MAX_MONTH_OFFSET = 3;
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// A month at a glance: each day shows the most people who are free together for 2+ hours.
// Click a day to jump the weekly grid to it.
export default function MonthCalendar({ ctx, base, onPickDay }) {
  const { zone } = useZone();
  const [offset, setOffset] = useState(0);
  const month = useMemo(() => new Date(base.getFullYear(), base.getMonth() + offset, 1), [base, offset]);
  const days = useMemo(() => monthDays(month.getFullYear(), month.getMonth()), [month]);

  const from = new Date(cellTime(days[0], 0, 0, zone)).toISOString();
  const to = new Date(cellTime(addDays(days[days.length - 1], 1), 0, 0, zone)).toISOString();
  const { data, error } = useGroupData(
    `/groups/${ctx.groupId}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ['availability']
  );

  const total = data?.members?.length || 0;
  const counts = useMemo(() => {
    if (!data) return null;
    const ids = data.members.map((m) => m.id);
    const byUser = busyByUser(ids, data.busy);
    return new Map(days.map((d) => [d.getTime(), bestFreeCount(d, ids, byUser, 120, zone)]));
  }, [data, days, zone]);

  const lastPickable = addDays(base, MAX_WEEKS * 7 - 1);

  return (
    <div className="card">
      <div className="row between week-nav">
        <button className="small-btn" onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0} aria-label="Previous month">‹</button>
        <div className="strong">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
        <button className="small-btn" onClick={() => setOffset((o) => Math.min(MAX_MONTH_OFFSET, o + 1))} disabled={offset >= MAX_MONTH_OFFSET} aria-label="Next month">›</button>
      </div>
      <p className="small muted">The number is how many people are free together for 2 hours or more that day. Tap a day to edit it below.</p>
      {error && <div className="error">{error}</div>}
      <div className="month">
        {DOW.map((d, i) => <div key={i} className="dow">{d}</div>)}
        {days.map((d) => {
          const inMonth = d.getMonth() === month.getMonth();
          const past = d < startOfDay(base);
          const tooFar = d > lastPickable;
          const count = counts?.get(d.getTime());
          let tone = '';
          if (!past && counts && total > 0) tone = count === total ? 'all' : count > 0 ? 'some' : 'none';
          const disabled = past || tooFar;
          return (
            <button
              key={d.getTime()}
              type="button"
              className={`day ${tone} ${inMonth ? '' : 'dim'} ${past ? 'past' : ''}`}
              disabled={disabled}
              onClick={() => onPickDay(d)}
              title={counts && !past ? `${count} of ${total} free together` : undefined}
            >
              <span className="num">{d.getDate()}</span>
              {counts && !past && total > 0 && <span className="cnt">{count}/{total}</span>}
            </button>
          );
        })}
      </div>
      <p className="small muted">
        <span className="legend swatch-all" />everyone free <span className="legend swatch-some" />some free <span className="legend swatch-none" />nobody
      </p>
    </div>
  );
}

// Which week of the weekly grid contains this day (clamped to the range you can plan in).
export function weekForDay(day, base) {
  const w = Math.floor(daysBetween(base, day) / 7);
  return Math.min(MAX_WEEKS - 1, Math.max(0, w));
}
