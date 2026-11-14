import { useState } from 'react';
import CalendarConnect from '../components/CalendarConnect.jsx';
import { GroupForms } from './GroupSetup.jsx';
import { Avatar } from '../components/ui.jsx';

export default function Group({ ctx, groups, reloadMe, switchGroup, logout }) {
  const [copied, setCopied] = useState(false);
  const [showForms, setShowForms] = useState(false);
  const code = ctx.group.invite_code;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard needs https; the code is visible anyway */
    }
  };

  return (
    <div className="stack">
      <h2>{ctx.group.name}</h2>

      {code && (
        <div className="card c-butter">
          <div className="small muted">Invite code. Only share it with friends you want in this group.</div>
          <div className="row between">
            <div className="code">{code}</div>
            <button className="small-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Members ({ctx.members.length})</h3>
        <div className="stack tight">
          {ctx.members.map((m) => (
            <div key={m.id} className="row between">
              <span className="row gap"><Avatar name={m.name} size={34} /><span className="strong">{m.name}{m.id === ctx.user.id && ' (you)'}</span>{m.role === 'owner' && <span className="small muted">owner</span>}</span>
              <span className={`badge ${m.calendar_connected ? 'green' : ''}`}>{m.calendar_connected ? 'Calendar' : 'Manual'}</span>
            </div>
          ))}
        </div>
      </div>

      <CalendarConnect />

      <div className="card stack">
        <h3>Your groups</h3>
        {groups.map((gr) => (
          <button key={gr.id} className={`row between option-row ${gr.id === ctx.groupId ? 'on' : ''}`} onClick={() => switchGroup(gr.id)}>
            <span>{gr.name}</span>{gr.id === ctx.groupId && <span className="small">current</span>}
          </button>
        ))}
        {!showForms && <button onClick={() => setShowForms(true)}>Join or create another group</button>}
        {showForms && (
          <GroupForms onDone={async (g) => { await reloadMe(); setShowForms(false); switchGroup(g.id); }} />
        )}
      </div>

      <div className="card stack">
        <h3>Privacy</h3>
        <p className="small muted">
          Only members of this group can see its plans, ideas, polls, and expenses. From Google Calendar, GATHER
          stores only when you're busy, never what you're doing. Disconnecting deletes those busy times.
        </p>
        <p className="small muted">Signed in as {ctx.user.email}</p>
        <button className="danger" onClick={logout}>Log out</button>
      </div>
    </div>
  );
}
