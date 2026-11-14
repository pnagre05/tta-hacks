import { useState } from 'react';
import { api, fmtRange } from '../api.js';
import { useGroupData } from '../live.js';
import AvailabilityGrid from '../components/AvailabilityGrid.jsx';
import { nextHour, toLocalInput } from '../lib/calendar.js';
import EventCard from '../components/EventCard.jsx';
import { AvatarStack } from '../components/ui.jsx';

const TWO_HOURS = 2 * 60 * 60 * 1000;

// Propose a plan. With a `slot`, the time must stay inside that free window (default: its first 2 hours).
// Without a slot ("Add a plan"), any future time works.
function ProposeForm({ ctx, slot, ideas, onDone }) {
  const initialStart = slot ? new Date(slot.start) : nextHour();
  const initialEnd = slot
    ? new Date(Math.min(new Date(slot.end).getTime(), initialStart.getTime() + TWO_HOURS))
    : new Date(initialStart.getTime() + TWO_HOURS);

  const [title, setTitle] = useState('');
  const [ideaId, setIdeaId] = useState('');
  const [start, setStart] = useState(toLocalInput(initialStart));
  const [end, setEnd] = useState(toLocalInput(initialEnd));
  const [error, setError] = useState(null);

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const groupTz = ctx.group?.timezone;
  const tzNote = !groupTz || groupTz === browserTz
    ? `Time zone: ${browserTz}`
    : `Your time zone: ${browserTz}. The group's time zone is ${groupTz}.`;

  const submit = async (e) => {
    e.preventDefault();
    const s = new Date(start);
    const en = new Date(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(en.getTime())) return setError('Pick a start and an end time');
    if (en <= s) return setError('The end must be after the start');
    if (en <= new Date()) return setError('That time has already passed');
    if (slot && (s < new Date(slot.start) || en > new Date(slot.end))) {
      return setError('Pick a time inside the free window shown above');
    }
    const idea = ideas.find((i) => i.id === Number(ideaId));
    try {
      await api(`/groups/${ctx.groupId}/events`, {
        method: 'POST',
        body: { title: title || idea?.title || 'Hang out', start: s.toISOString(), end: en.toISOString(), ideaId: idea?.id ?? null },
      });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };

  const min = slot ? toLocalInput(slot.start) : toLocalInput(new Date());
  const max = slot ? toLocalInput(slot.end) : undefined;

  return (
    <form className="stack propose" onSubmit={submit}>
      <select value={ideaId} onChange={(e) => setIdeaId(e.target.value)}>
        <option value="">Pick from the Idea Bank (optional)</option>
        {ideas.map((i) => <option key={i.id} value={i.id}>{i.title} ({i.interestCount} interested)</option>)}
      </select>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="…or type a plan" maxLength={100} />
      <div className="time-pick">
        <label>
          <span className="small muted">Starts</span>
          <input type="datetime-local" value={start} min={min} max={max} step={900} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label>
          <span className="small muted">Ends</span>
          <input type="datetime-local" value={end} min={min} max={max} step={900} onChange={(e) => setEnd(e.target.value)} required />
        </label>
      </div>
      <div className="small muted">{tzNote}</div>
      <div className="row gap">
        <button className="primary">{slot ? 'Propose this time' : 'Add this plan'}</button>
        <button type="button" className="link" onClick={onDone}>Cancel</button>
      </div>
      {error && <div className="error">{error}</div>}
    </form>
  );
}

export default function Schedule({ ctx }) {
  const g = ctx.groupId;
  const slotsData = useGroupData(`/groups/${g}/slots`, ['availability']).data;
  const events = useGroupData(`/groups/${g}/events`, ['event']).data?.events || [];
  const ideas = (useGroupData(`/groups/${g}/ideas`, ['idea']).data?.ideas || []).filter((i) => i.status !== 'completed');
  const [proposing, setProposing] = useState(null);
  const [adding, setAdding] = useState(false);
  const slots = slotsData?.slots || [];
  const upcoming = events.filter((e) => new Date(e.end) > new Date());

  return (
    <div className="stack">
      <h2>When's everyone<span className="ital">actually free?</span></h2>

      <section>
        <h4 className="section">Best times (next 2 weeks)</h4>
        {!slotsData && <div className="card muted">Finding times…</div>}
        {slotsData && slots.length === 0 && <div className="card muted">No shared free time found. Ask people to update their availability.</div>}
        <div className="stack">
          {slots.slice(0, 5).map((s, i) => (
            <div key={s.start} className={`card slot ${i === 0 ? 'top' : ''}`}>
              <div className="row between">
                <div className="grow">
                  <div className={i === 0 ? 'display' : 'strong'}>{fmtRange(s.start, s.end)}</div>
                  <div className="small muted">
                    {s.freeCount === s.total ? 'Everyone is free' : `Busy: ${s.busyMembers.join(', ')}`}
                  </div>
                </div>
                <div className={`pill ${s.freeCount === s.total ? 'green' : ''}`}>{s.freeCount}/{s.total}</div>
              </div>
              {proposing === s.start ? (
                <ProposeForm ctx={ctx} slot={s} ideas={ideas} onDone={() => setProposing(null)} />
              ) : (
                <div className="row between">
                  <AvatarStack names={s.freeMembers} size={26} />
                  <button className={`small-btn ${i === 0 ? 'primary' : ''}`} onClick={() => setProposing(s.start)}>Propose a plan</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="row between">
          <h4 className="section">Plans</h4>
          {!adding && <button className="small-btn" onClick={() => setAdding(true)}>Add a plan</button>}
        </div>
        {adding && (
          <div className="card">
            <ProposeForm ctx={ctx} slot={null} ideas={ideas} onDone={() => setAdding(false)} />
          </div>
        )}
        {upcoming.length === 0 && <div className="card muted">No plans yet.</div>}
        <div className="stack">{upcoming.map((e) => <EventCard key={e.id} event={e} />)}</div>
      </section>

      <AvailabilityGrid ctx={ctx} />
    </div>
  );
}
