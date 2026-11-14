import { useState } from 'react';
import { api, fmtRange, money, timeLeft } from '../api.js';
import { useGroupData } from '../live.js';
import EventCard from '../components/EventCard.jsx';
import { AvatarStack, Sticker } from '../components/ui.jsx';

function NextPlan({ event }) {
  const start = new Date(event.start);
  const going = event.responses.filter((r) => r.response === 'yes').map((r) => r.name);
  const respond = (response) => api(`/events/${event.id}/respond`, { method: 'POST', body: { response } }).catch(() => {});
  return (
    <div className="card hero c-mint">
      <Sticker color="#ffe27a" size={84} tilt={10}>
        <small>{start.toLocaleDateString(undefined, { weekday: 'short' })}</small>
        {start.getDate()}
      </Sticker>
      <div className="small strong">Next up, confirmed</div>
      <div className="display">{event.title}</div>
      <div className="when strong">{fmtRange(event.start, event.end)}</div>
      <div className="row gap">
        <AvatarStack names={going} size={30} />
        <span className="small muted">{going.length} going</span>
      </div>
      <div className="row gap">
        {[['yes', "I'm in"], ['maybe', 'Maybe'], ['no', "Can't"]].map(([k, label]) => (
          <button key={k} className={`chip ${event.myResponse === k ? 'on' : ''}`} onClick={() => respond(k)}>{label}</button>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard({ ctx, go }) {
  const g = ctx.groupId;
  const events = useGroupData(`/groups/${g}/events`, ['event']).data?.events || [];
  const polls = useGroupData(`/groups/${g}/polls`, ['poll']).data?.polls || [];
  const balances = useGroupData(`/groups/${g}/balances`, ['expense']).data;
  const slots = useGroupData(`/groups/${g}/slots`, ['availability']).data?.slots || [];
  const [q, setQ] = useState('');

  const upcoming = events.filter((e) => new Date(e.end) > new Date());
  const nextConfirmed = upcoming.find((e) => e.status === 'confirmed');
  const needsMe = upcoming.filter((e) => e.status === 'proposed' && !e.myResponse);
  const openPolls = polls.filter((p) => !p.closed);
  const best = slots[0];
  const my = balances?.myNetCents ?? 0;

  const ask = (e) => {
    e.preventDefault();
    try {
      sessionStorage.setItem('gather.ask', q);
    } catch {
      /* ignore */
    }
    go('ai');
  };

  return (
    <div className="stack">
      <h2>Hey {ctx.user.name},<span className="ital">{nextConfirmed ? "you've got plans." : "let's make a plan."}</span></h2>

      {nextConfirmed ? (
        <NextPlan event={nextConfirmed} />
      ) : best ? (
        <button className="card hero c-butter" onClick={() => go('schedule')}>
          <Sticker color="#ffb3d1" size={84} tilt={10}>{best.freeCount}/{best.total}<br /><small>free</small></Sticker>
          <div className="small strong">Best time to hang out</div>
          <div className="display">{fmtRange(best.start, best.end)}</div>
          <div className="small muted">Nothing's confirmed yet. Tap to propose a plan.</div>
        </button>
      ) : (
        <div className="card muted">Nothing planned yet. Add your busy times on the Schedule tab to find a time.</div>
      )}

      {needsMe.length > 0 && (
        <section>
          <h4 className="section">Waiting on you</h4>
          <div className="stack">{needsMe.map((e) => <EventCard key={e.id} event={e} />)}</div>
        </section>
      )}

      <div className="grid2">
        <button className="card tile c-lilac" onClick={() => go('polls')}>
          <div className="tile-num">{openPolls.length}</div>
          <div className="strong">open poll{openPolls.length === 1 ? '' : 's'}</div>
          {openPolls[0] && <div className="small muted">{openPolls[0].myOptionId ? 'You voted.' : 'Your vote is missing.'} {timeLeft(openPolls[0].deadline)}</div>}
        </button>
        <button className={`card tile ${my < 0 ? 'c-pink' : 'c-sky'}`} onClick={() => go('money')}>
          <div className="tile-num">{balances ? money(Math.abs(my)) : '–'}</div>
          <div className="strong">{!balances || my === 0 ? 'all settled up' : my > 0 ? 'owed to you' : 'you owe'}</div>
        </button>
      </div>

      {nextConfirmed && best && (
        <button className="card c-butter" onClick={() => go('schedule')}>
          <div className="row between">
            <div>
              <div className="small strong">Next time everyone's free</div>
              <div className="display" style={{ fontSize: '1.250rem' }}>{fmtRange(best.start, best.end)}</div>
            </div>
            <span className="pill green">{best.freeCount}/{best.total}</span>
          </div>
        </button>
      )}

      <div className="card row between">
        <div>
          <div className="strong">{ctx.group.name}</div>
          <div className="small muted">{ctx.members.length} friends in this group</div>
        </div>
        <AvatarStack names={ctx.members.map((m) => m.name)} size={34} />
      </div>

      <form className="ask" onSubmit={ask}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything: what's the plan this week?" aria-label="Ask GATHER AI" />
        <button className="primary">Ask</button>
      </form>
    </div>
  );
}
