import { useState } from 'react';
import { api } from '../api.js';

// Create a group or join one with an invite code. Used on first login and from the Group page.
export function GroupForms({ onDone }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);

  const create = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { group } = await api('/groups', { method: 'POST', body: { name, timezone: tz } });
      await onDone(group);
    } catch (err) {
      setError(err.message);
    }
  };

  const join = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const { group } = await api('/groups/join', { method: 'POST', body: { inviteCode: code } });
      await onDone(group);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="stack">
      <form className="card stack c-butter" onSubmit={join}>
        <h3>Join your friends</h3>
        <label>Invite code<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="e.g. DEMO42" required /></label>
        <button className="primary">Join group</button>
      </form>
      <form className="card stack" onSubmit={create}>
        <h3>Start a new group</h3>
        <label>Group name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Weekend Crew" required /></label>
        <button>Create group</button>
      </form>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export default function GroupSetup({ onDone, onLogout }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand big">gather</div>
        <h1>Find<span className="ital">your people.</span></h1>
        <p className="muted">Groups are private. You need an invite code to get in.</p>
        <GroupForms onDone={onDone} />
        <button className="link" onClick={onLogout}>Log out</button>
      </div>
    </div>
  );
}
