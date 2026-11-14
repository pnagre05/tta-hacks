import { useState } from 'react';
import { api, CATEGORIES, categoryLabel, fmtRange, money, STATUS_LABELS } from '../api.js';
import { useGroupData } from '../live.js';
import { CATEGORY_STYLE } from '../components/ui.jsx';

const DEADLINES = [[15, '15 minutes'], [60, '1 hour'], [180, '3 hours'], [1440, '1 day']];

function AddIdea({ ctx, onDone }) {
  const [f, setF] = useState({ title: '', category: 'entertainment', description: '', location: '', budget: '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api(`/groups/${ctx.groupId}/ideas`, {
        method: 'POST',
        body: {
          title: f.title, category: f.category, description: f.description, location: f.location,
          budgetCents: f.budget === '' ? null : Math.round(Number(f.budget) * 100),
        },
      });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h3>New idea</h3>
      <input value={f.title} onChange={set('title')} placeholder="Pottery class, road trip, that ramen place…" maxLength={80} required />
      <div className="row gap">
        <select value={f.category} onChange={set('category')}>
          {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="number" min="0" step="1" value={f.budget} onChange={set('budget')} placeholder="$ per person" />
      </div>
      <input value={f.location} onChange={set('location')} placeholder="Location (optional)" maxLength={120} />
      <textarea value={f.description} onChange={set('description')} placeholder="Details (optional)" maxLength={500} rows={2} />
      {error && <div className="error">{error}</div>}
      <div className="row gap">
        <button className="primary">Save idea</button>
        <button type="button" className="link" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function CreatePoll({ ctx, ideas, onDone }) {
  const slots = useGroupData(`/groups/${ctx.groupId}/slots`, ['availability']).data?.slots || [];
  const [question, setQuestion] = useState('What should we do?');
  const [minutes, setMinutes] = useState(60);
  const [slotIndex, setSlotIndex] = useState('0');
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const slot = slotIndex === 'none' ? null : slots[Number(slotIndex)];
    try {
      await api(`/groups/${ctx.groupId}/polls`, {
        method: 'POST',
        body: {
          question,
          deadline: new Date(Date.now() + minutes * 60000).toISOString(),
          options: ideas.map((i) => ({ ideaId: i.id })),
          eventStart: slot?.start ?? null,
          eventEnd: slot?.end ?? null,
        },
      });
      onDone(true);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="card stack sticky-bottom" onSubmit={submit}>
      <h3>Poll with {ideas.length} ideas</h3>
      <div className="small muted">{ideas.map((i) => i.title).join(' · ')}</div>
      <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={120} required />
      <label>Voting closes in
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {DEADLINES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
        </select>
      </label>
      <label>When (the winner becomes a proposed plan)
        <select value={slotIndex} onChange={(e) => setSlotIndex(e.target.value)}>
          {slots.slice(0, 5).map((s, i) => <option key={s.start} value={i}>{fmtRange(s.start, s.end)} · {s.freeCount}/{s.total} free</option>)}
          <option value="none">Decide the time later</option>
        </select>
      </label>
      {error && <div className="error">{error}</div>}
      <div className="row gap">
        <button className="primary">Start poll</button>
        <button type="button" className="link" onClick={() => onDone(false)}>Cancel</button>
      </div>
    </form>
  );
}

export default function Ideas({ ctx, go }) {
  const { data } = useGroupData(`/groups/${ctx.groupId}/ideas`, ['idea']);
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState([]);
  const [polling, setPolling] = useState(false);
  const ideas = data?.ideas || [];
  const shown = ideas.filter((i) => filter === 'all' || i.category === filter);
  const mostWanted = ideas.filter((i) => i.status !== 'completed').slice(0, 3);

  const toggleInterest = (id) => api(`/ideas/${id}/interest`, { method: 'POST' }).catch(() => {});
  const setStatus = (id, status) => api(`/ideas/${id}/status`, { method: 'PATCH', body: { status } }).catch(() => {});
  const togglePick = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(0, 8)));

  return (
    <div className="stack">
      <div className="row between">
        <h2>Idea board<span className="ital">someday, together.</span></h2>
        {!adding && <button className="primary small-btn" onClick={() => setAdding(true)}>+ Add idea</button>}
      </div>
      {adding && <AddIdea ctx={ctx} onDone={() => setAdding(false)} />}

      {mostWanted.length > 0 && (
        <section>
          <h4 className="section">Most wanted</h4>
          <div className="row gap scroll-x wanted">
            {mostWanted.map((i) => (
              <div key={i.id} className="card mini">
                <div style={{ fontSize: '1.600rem' }}>{CATEGORY_STYLE[i.category][0]}</div>
                <div className="strong">{i.title}</div>
                <div className="small muted">♥ {i.interestCount} want this</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="row gap scroll-x">
        {[['all', 'All'], ...CATEGORIES].map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      <p className="small muted">Tap the circle on 2 or more ideas to turn them into a poll.</p>

      <div className="masonry">
        {shown.map((i) => (
          <div key={i.id} className={`card idea ${CATEGORY_STYLE[i.category][1]} ${picked.includes(i.id) ? 'picked' : ''}`}>
            {i.status !== 'completed' && (
              <label className="pick" title="Add to a poll">
                <input type="checkbox" aria-label={`Add ${i.title} to a poll`} checked={picked.includes(i.id)} onChange={() => togglePick(i.id)} />
              </label>
            )}
            <div className="emoji">{CATEGORY_STYLE[i.category][0]}</div>
            <div className="title">{i.title}</div>
            {i.description && <div className="small">{i.description}</div>}
            <div className="small muted">
              {categoryLabel(i.category)}
              {i.budgetCents != null && <>, {money(i.budgetCents)} each</>}
              {i.location && <>, {i.location}</>}
            </div>
            {i.status !== 'saved' && (
              <div><span className={`badge ${i.status === 'planned' ? 'green' : i.status === 'under_consideration' ? 'amber' : ''}`}>{STATUS_LABELS[i.status]}</span></div>
            )}
            <div className="row gap wrap">
              <button className={`chip heart ${i.iAmInterested ? 'on' : ''}`} onClick={() => toggleInterest(i.id)} aria-label={`${i.interestCount} interested`}>
                ♥ {i.interestCount}
              </button>
              {i.status === 'planned' && <button className="chip" onClick={() => setStatus(i.id, 'completed')}>We did it</button>}
              {i.status === 'completed' && <button className="chip" onClick={() => setStatus(i.id, 'saved')}>Again</button>}
            </div>
          </div>
        ))}
        {data && shown.length === 0 && <div className="card muted">No ideas here yet.</div>}
      </div>

      {picked.length >= 2 && !polling && (
        <button className="primary floating" onClick={() => setPolling(true)}>Create poll from {picked.length} ideas</button>
      )}
      {polling && (
        <CreatePoll
          ctx={ctx}
          ideas={ideas.filter((i) => picked.includes(i.id))}
          onDone={(created) => {
            setPolling(false);
            if (created) {
              setPicked([]);
              go('polls');
            }
          }}
        />
      )}
    </div>
  );
}
