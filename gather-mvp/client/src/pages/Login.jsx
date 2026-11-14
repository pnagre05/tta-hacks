import { useState } from 'react';
import { api } from '../api.js';
import { Sticker } from '../components/ui.jsx';

export default function Login({ onDone }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/${mode}`, { method: 'POST', body: mode === 'login' ? { email: form.email, password: form.password } : form });
      await onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-stickers" aria-hidden="true">
        <span style={{ position: 'absolute', top: '5%', right: '7%' }}><Sticker color="#ffb3d1" size={92} tilt={12}><small>sat</small>2pm</Sticker></span>
        <span style={{ position: 'absolute', bottom: '6%', left: '6%' }}><Sticker color="#b5ecc9" size={84} tilt={-10}>6/6<br /><small>free</small></Sticker></span>
        <span style={{ position: 'absolute', bottom: '10%', right: '9%' }}><Sticker color="#cdb9ff" size={62} tilt={8}>$</Sticker></span>
      </div>
      <div className="auth-card">
        <div className="brand big">gather</div>
        <h1>Plans that<span className="ital">actually happen.</span></h1>
        <p className="muted">Find a time everyone's free, vote on what to do, and split the bill after.</p>
        <div className="segmented">
          <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Log in</button>
          <button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Sign up</button>
        </div>
        <form onSubmit={submit} className="stack">
          {mode === 'register' && (
            <label>Name<input value={form.name} onChange={set('name')} required maxLength={50} autoComplete="name" /></label>
          )}
          <label>Email<input type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
          <label>
            Password
            <input type="password" value={form.password} onChange={set('password')} required minLength={mode === 'register' ? 8 : 1}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
        </form>
      </div>
    </div>
  );
}
