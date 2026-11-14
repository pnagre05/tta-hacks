import { useEffect, useRef, useState } from 'react';
import { api, fmtRange } from '../api.js';
import { AvatarStack, Confetti } from './ui.jsx';

const LABELS = { yes: "I'm in", maybe: 'Maybe', no: "Can't" };

export default function EventCard({ event, compact = false }) {
  const [error, setError] = useState(null);
  const [burst, setBurst] = useState(0);
  const confirmed = event.status === 'confirmed';

  // Confetti on every phone the moment a plan flips from proposed to confirmed.
  const before = useRef(event.status);
  useEffect(() => {
    if (before.current === 'proposed' && event.status === 'confirmed') setBurst((n) => n + 1);
    before.current = event.status;
  }, [event.status]);

  const act = async (path, body) => {
    setError(null);
    try {
      await api(path, { method: 'POST', body });
    } catch (e) {
      setError(e.message);
    }
  };
  const going = event.responses.filter((r) => r.response === 'yes').map((r) => r.name);

  return (
    <div className={`card event ${confirmed ? 'confirmed' : 'proposed'}`}>
      <Confetti fire={burst} />
      <div className="row between top">
        <div className="display">{event.title}</div>
        <span className={`badge ${confirmed ? 'green' : 'amber'}`}>{confirmed ? 'Confirmed' : 'Proposed'}</span>
      </div>
      <div className="when">{fmtRange(event.start, event.end)}</div>
      <div className="row gap">
        {going.length > 0 && <AvatarStack names={going} size={26} />}
        <span className="small muted">
          {going.length} in{event.counts.maybe > 0 && `, ${event.counts.maybe} maybe`}{event.counts.no > 0 && `, ${event.counts.no} out`}
          {event.notResponded.length > 0 && !compact && `. Waiting on ${event.notResponded.join(', ')}`}
        </span>
      </div>
      <div className="row gap wrap">
        {Object.entries(LABELS).map(([k, label]) => (
          <button key={k} className={`chip ${event.myResponse === k ? 'on' : ''}`}
            onClick={() => act(`/events/${event.id}/respond`, { response: k })}>
            {label}
          </button>
        ))}
        {!confirmed && !compact && (
          <button className="primary small-btn push" onClick={() => act(`/events/${event.id}/confirm`)}>Confirm plan</button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
