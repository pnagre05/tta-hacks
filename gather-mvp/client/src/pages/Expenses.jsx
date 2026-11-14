import { useEffect, useState } from 'react';
import { api, fmtWhen, money } from '../api.js';
import { useGroupData } from '../live.js';
import { Avatar } from '../components/ui.jsx';

function AddExpense({ ctx, events, onDone }) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(ctx.user.id);
  const [who, setWho] = useState([]);
  const [eventId, setEventId] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (who.length === 0 && ctx.members.length) setWho(ctx.members.map((m) => m.id));
  }, [ctx.members]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setWho((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]));
  const cents = Math.round(Number(amount) * 100);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api(`/groups/${ctx.groupId}/expenses`, {
        method: 'POST',
        body: { description: desc, amountCents: cents, paidBy: Number(paidBy), participantIds: who, eventId: eventId ? Number(eventId) : null },
      });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h3>Add expense</h3>
      <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Dinner, parking, tickets…" maxLength={100} required />
      <div className="row gap">
        <input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$0.00" required />
        <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {ctx.members.map((m) => <option key={m.id} value={m.id}>{m.id === ctx.user.id ? 'I paid' : `${m.name} paid`}</option>)}
        </select>
      </div>
      <div className="small muted">Split equally between:</div>
      <div className="row gap wrap">
        {ctx.members.map((m) => (
          <button type="button" key={m.id} className={`chip ${who.includes(m.id) ? 'on' : ''}`} onClick={() => toggle(m.id)}>{m.name}</button>
        ))}
      </div>
      {who.length > 0 && cents > 0 && <div className="small">≈ {money(Math.floor(cents / who.length))} each</div>}
      {events.length > 0 && (
        <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">Not linked to a plan</option>
          {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
        </select>
      )}
      {error && <div className="error">{error}</div>}
      <div className="row gap">
        <button className="primary" disabled={who.length === 0}>Add</button>
        <button type="button" className="link" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export default function Expenses({ ctx }) {
  const g = ctx.groupId;
  const balances = useGroupData(`/groups/${g}/balances`, ['expense']).data;
  const expenses = useGroupData(`/groups/${g}/expenses`, ['expense']).data?.expenses || [];
  const events = useGroupData(`/groups/${g}/events`, ['event']).data?.events || [];
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

  const markPaid = async (p) => {
    setError(null);
    try {
      await api(`/groups/${g}/settlements`, { method: 'POST', body: { fromUserId: p.fromUser, toUserId: p.toUser, amountCents: p.amountCents } });
    } catch (e) {
      setError(e.message);
    }
  };

  const my = balances?.myNetCents ?? 0;

  return (
    <div className="stack">
      <div className="row between">
        <h2>Money<span className="ital">no awkward texts.</span></h2>
        {!adding && <button className="primary small-btn" onClick={() => setAdding(true)}>+ Add expense</button>}
      </div>
      {adding && <AddExpense ctx={ctx} events={events} onDone={() => setAdding(false)} />}

      <div className="grid2">
        <div className={`card tile ${my < 0 ? 'c-pink' : 'c-mint'}`}>
          <div className="tile-num">{money(Math.abs(my))}</div>
          <div>{my === 0 ? 'you\'re settled up' : my > 0 ? 'owed to you' : 'you owe'}</div>
        </div>
        <div className="card tile c-sky">
          <div className="tile-num">{money(balances?.totalSpentCents ?? 0)}</div>
          <div>group total</div>
          <div className="small muted">you paid {money(balances?.mySpentCents ?? 0)}</div>
        </div>
      </div>

      <section>
        <h4 className="section">Who owes whom</h4>
        {balances && balances.payments.length === 0 && <div className="card muted">Everyone is settled up.</div>}
        <div className="stack">
          {balances?.payments.map((p) => {
            const involved = p.fromUser === ctx.user.id || p.toUser === ctx.user.id;
            return (
              <div key={`${p.fromUser}-${p.toUser}`} className={`card row between ${involved ? 'highlight' : ''}`}>
                <div className="row gap grow">
                  <Avatar name={p.fromName} size={38} />
                  <div>
                    <div className="small">
                      <span className="strong">{p.fromUser === ctx.user.id ? 'You' : p.fromName}</span> {p.fromUser === ctx.user.id ? 'pay' : 'pays'} {p.toUser === ctx.user.id ? 'you' : p.toName}
                    </div>
                    <div className="display">{money(p.amountCents)}</div>
                  </div>
                </div>
                {involved && <button className="small-btn" onClick={() => markPaid(p)}>Mark paid</button>}
              </div>
            );
          })}
        </div>
        {error && <div className="error">{error}</div>}
        <p className="small muted">GATHER suggests the fewest payments that settle everyone up.</p>
      </section>

      <section>
        <h4 className="section">History</h4>
        <div className="stack tight">
          {expenses.map((e) => (
            <div key={e.id} className="card row between">
              <div>
                <div className="strong">{e.description}</div>
                <div className="small muted">
                  {e.paidByName} paid, split {e.splits.length} ways{e.eventTitle && <>, for {e.eventTitle}</>}
                </div>
              </div>
              <div className="strong">{money(e.amountCents)}</div>
            </div>
          ))}
          {balances?.settlements.map((s) => (
            <div key={`s${s.id}`} className="card row between muted">
              <div className="small">{s.fromName} paid {s.toName} · {fmtWhen(s.createdAt)}</div>
              <div className="small">{money(s.amountCents)}</div>
            </div>
          ))}
          {expenses.length === 0 && <div className="card muted">No expenses yet.</div>}
        </div>
      </section>
    </div>
  );
}
