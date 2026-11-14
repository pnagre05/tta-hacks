import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const SUGGESTIONS = [
  'Summarize my week',
  "What's the plan this weekend?",
  'Which poll is still open?',
  'Who owes me money?',
  'What have we been wanting to do?',
];

export default function Assistant({ ctx }) {
  const [messages, setMessages] = useState([
    { from: 'ai', text: `Hi ${ctx.user.name}! Ask me about plans, polls, ideas, or money in ${ctx.group.name}.` },
  ]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);

  const ask = async (question) => {
    const text = question.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { from: 'me', text }]);
    setQ('');
    setBusy(true);
    try {
      const r = await api(`/groups/${ctx.groupId}/ai/ask`, { method: 'POST', body: { question: text } });
      setMessages((m) => [...m, { from: 'ai', text: r.answer, offline: r.source === 'offline' }]);
    } catch (e) {
      setMessages((m) => [...m, { from: 'ai', text: e.message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  // A question typed on the dashboard arrives here.
  useEffect(() => {
    let pending = null;
    try {
      pending = sessionStorage.getItem('gather.ask');
      sessionStorage.removeItem('gather.ask');
    } catch {
      /* ignore */
    }
    if (pending) ask(pending);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Braces matter: newer browsers return a Promise from scrollIntoView, which React would treat as a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="stack chat-page">
      <div className="row gap">
        <span className="buddy" aria-hidden="true"><i /></span>
        <h2>Ask me<span className="ital">about the group.</span></h2>
      </div>
      <div className="chat">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.from} ${m.error ? 'err' : ''}`}>
            {m.text}
            {m.offline && <div className="tag">Quick answer (no AI key set)</div>}
          </div>
        ))}
        {busy && <div className="bubble ai muted">Thinking…</div>}
        <div ref={end} />
      </div>
      <div className="row gap scroll-x">
        {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}
      </div>
      <form className="row gap" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your group…" maxLength={500} />
        <button className="primary" disabled={busy}>Send</button>
      </form>
      <p className="small muted">Answers come only from your group's data in GATHER.</p>
    </div>
  );
}
