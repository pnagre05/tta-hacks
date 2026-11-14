import { useEffect, useState } from 'react';
import { api, fmtRange, timeLeft } from '../api.js';
import { useGroupData } from '../live.js';

function NewPoll({ ctx, onDone }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const labels = options.split('\n').map((s) => s.trim()).filter(Boolean);
    try {
      await api(`/groups/${ctx.groupId}/polls`, {
        method: 'POST',
        body: { question, deadline: new Date(Date.now() + minutes * 60000).toISOString(), options: labels.map((label) => ({ label })) },
      });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h3>New poll</h3>
      <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Question" maxLength={120} required />
      <textarea value={options} onChange={(e) => setOptions(e.target.value)} placeholder={'One option per line\nBowling\nMovie night'} rows={4} required />
      <label>Closes in
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          <option value={15}>15 minutes</option><option value={60}>1 hour</option>
          <option value={180}>3 hours</option><option value={1440}>1 day</option>
        </select>
      </label>
      <p className="small muted">Tip: start polls from the Idea Bank to reuse saved ideas.</p>
      {error && <div className="error">{error}</div>}
      <div className="row gap">
        <button className="primary">Start poll</button>
        <button type="button" className="link" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function PollCard({ poll, ctx }) {
  const [error, setError] = useState(null);
  const vote = async (optionId) => {
    setError(null);
    try {
      await api(`/polls/${poll.id}/vote`, { method: 'POST', body: { optionId } });
    } catch (e) {
      setError(e.message);
    }
  };
  const close = async () => {
    try {
      await api(`/polls/${poll.id}/close`, { method: 'POST' });
    } catch (e) {
      setError(e.message);
    }
  };
  const max = Math.max(1, ...poll.options.map((o) => o.votes));

  return (
    <div className={`card poll ${poll.closed ? 'closed' : ''}`}>
      <div className="row between">
        <h3>{poll.question}</h3>
        <span className={`badge ${poll.closed ? '' : 'amber'}`}>{poll.closed ? 'Closed' : timeLeft(poll.deadline)}</span>
      </div>
      {poll.eventStart && <div className="small muted">For {fmtRange(poll.eventStart, poll.eventEnd)}</div>}
      <div className="stack tight">
        {poll.options.map((o) => {
          const winner = poll.closed && o.id === poll.winnerOptionId;
          const mine = poll.myOptionId === o.id;
          return (
            <button key={o.id} className={`option ${mine ? 'mine' : ''} ${winner ? 'winner' : ''}`}
              disabled={poll.closed} onClick={() => vote(o.id)}>
              <span className="bar" style={{ width: `${(o.votes / max) * 100}%` }} />
              <span className="label">{winner && '👑 '}{o.label}{mine && ' ✓'}</span>
              <span className="count">{o.votes}</span>
            </button>
          );
        })}
      </div>
      <div className="row between small muted">
        <span>{poll.totalVotes} of {ctx.members.length || '?'} voted, started by {poll.createdByName}</span>
        {!poll.closed && poll.createdBy === ctx.user.id && <button className="link" onClick={close}>Close now</button>}
      </div>
      {poll.closed && !poll.winnerOptionId && <div className="small">No votes were cast.</div>}
      {poll.closed && poll.winnerOptionId && poll.eventStart && <div className="small">The winner is now a proposed plan on the Schedule tab.</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export default function Polls({ ctx }) {
  const { data } = useGroupData(`/groups/${ctx.groupId}/polls`, ['poll']);
  const [creating, setCreating] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const polls = data?.polls || [];
  const open = polls.filter((p) => !p.closed);
  const closed = polls.filter((p) => p.closed);

  return (
    <div className="stack">
      <div className="row between">
        <h2>Polls<span className="ital">settle it.</span></h2>
        {!creating && <button className="small-btn" onClick={() => setCreating(true)}>+ New poll</button>}
      </div>
      {creating && <NewPoll ctx={ctx} onDone={() => setCreating(false)} />}
      <h4 className="section">Open</h4>
      {open.length === 0 && <div className="card muted">No open polls. Start one from the Idea Bank.</div>}
      {open.map((p) => <PollCard key={p.id} poll={p} ctx={ctx} />)}
      {closed.length > 0 && <h4 className="section">Decided</h4>}
      {closed.map((p) => <PollCard key={p.id} poll={p} ctx={ctx} />)}
    </div>
  );
}
