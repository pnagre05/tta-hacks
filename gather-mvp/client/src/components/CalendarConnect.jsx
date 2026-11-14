import { useState } from 'react';
import { api, fmtWhen } from '../api.js';
import { useGroupData } from '../live.js';

export default function CalendarConnect() {
  const { data, reload } = useGroupData('/calendar/status', ['availability']);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!data) return null;

  const run = async (fn) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
      reload();
    }
  };

  const connect = () => run(async () => {
    const { url } = await api('/calendar/connect');
    window.location.href = url;
  });
  const sync = () => run(async () => {
    const r = await api('/calendar/sync', { method: 'POST' });
    setMsg(`Synced: ${r.busyBlocks} busy block${r.busyBlocks === 1 ? '' : 's'} in the next 2 weeks.`);
  });
  const disconnect = () => run(async () => {
    await api('/calendar/disconnect', { method: 'POST' });
    setMsg('Disconnected. GATHER no longer has access and your Google busy times were deleted.');
  });

  return (
    <div className="card">
      <div className="row between">
        <h3>Google Calendar</h3>
        {data.connection && <span className="badge green">Connected</span>}
      </div>
      {!data.configured && !data.connection && (
        <p className="small muted">Not set up on the server yet. Mark busy times with the availability grid instead.</p>
      )}
      {data.configured && !data.connection && (
        <>
          <p className="small muted">GATHER only sees when you're busy — never event names or details.</p>
          <button className="primary" onClick={connect} disabled={busy}>Connect Google Calendar</button>
        </>
      )}
      {data.connection && (
        <>
          <p className="small muted">
            Only busy/free times are shared.{' '}
            {data.connection.last_synced_at && <>Last synced {fmtWhen(data.connection.last_synced_at)}.</>}
          </p>
          <div className="row gap">
            <button onClick={sync} disabled={busy}>Resync</button>
            <button className="danger" onClick={disconnect} disabled={busy}>Disconnect</button>
          </div>
        </>
      )}
      {msg && <div className="small">{msg}</div>}
    </div>
  );
}
