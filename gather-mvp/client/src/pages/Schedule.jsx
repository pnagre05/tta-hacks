import { useState } from 'react';
import { api, fmtRange } from '../api.js';
import { useGroupData } from '../live.js';
import AvailabilityGrid from '../components/AvailabilityGrid.jsx';
import CalendarConnect from '../components/CalendarConnect.jsx';
import EventCard from '../components/EventCard.jsx';
import { AvatarStack } from '../components/ui.jsx';

function ProposeForm({ ctx, slot, ideas, onDone }) {
  const [title, setTitle] = useState('');
  const [ideaId, setIdeaId] = useState('');
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const idea = ideas.find((i) => i.id === Number(ideaId));
    try {
      await api(`/groups/${ctx.groupId}/events`, {
        method: 'POST',
        body: { title: title || idea?.title || 'Hang out', start: slot.start, end: slot.end, ideaId: idea?.id ?? null },
      });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="stack propose" onSubmit={submit}>
      <select value={ideaId} onChange={(e) => setIdeaId(e.target.value)}>
        <option value="">Pick from the Idea Bank (optional)</option>
        {ideas.map((i) => <option key={i.id} value={i.id}>{i.title} ({i.interestCount} interested)</option>)}
      </select>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="…or type a plan" maxLength={100} />
      <div className="row gap">
        <button className="primary">Propose this time</button>
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
        <h4 className="section">Plans</h4>
        {upcoming.length === 0 && <div className="card muted">No plans yet.</div>}
        <div className="stack">{upcoming.map((e) => <EventCard key={e.id} event={e} />)}</div>
      </section>

      <CalendarConnect />
      <AvailabilityGrid ctx={ctx} />
    </div>
  );
}
