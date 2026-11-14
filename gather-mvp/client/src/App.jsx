import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { connectSocket, disconnectSocket, useGroupData } from './live.js';
import { Icon } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import GroupSetup from './pages/GroupSetup.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Schedule from './pages/Schedule.jsx';
import Ideas from './pages/Ideas.jsx';
import Polls from './pages/Polls.jsx';
import Expenses from './pages/Expenses.jsx';
import Assistant from './pages/Assistant.jsx';
import Group from './pages/Group.jsx';
import { ZoneContext, useZoneChoice } from './timezone.jsx';

const TABS = [
  ['home', 'Home'],
  ['schedule', 'Schedule'],
  ['ideas', 'Ideas'],
  ['polls', 'Polls'],
  ['money', 'Money'],
  ['ai', 'AI'],
];

const CALENDAR_MESSAGES = {
  connected: 'Google Calendar connected. Your busy times are synced.',
  cancelled: 'Google Calendar connection was cancelled.',
  expired: 'That sign-in link expired. Try connecting again.',
  error: 'Could not connect Google Calendar. Try again.',
};

function storedGroup() {
  try {
    return Number(localStorage.getItem('gather.group')) || null;
  } catch {
    return null;
  }
}

export default function App() {
  const [me, setMe] = useState(undefined); // undefined = loading, null = logged out
  const [groupId, setGroupId] = useState(storedGroup);
  const [tab, setTab] = useState(() => window.location.hash.slice(1) || 'home');
  const [toast, setToast] = useState(null);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api('/auth/me'));
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    loadMe();
    const params = new URLSearchParams(window.location.search);
    const cal = params.get('calendar');
    if (cal) {
      setToast(CALENDAR_MESSAGES[cal] || null);
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
    const onHash = () => setTab(window.location.hash.slice(1) || 'home');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [loadMe]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const groups = me?.groups || [];
  const activeGroup = groups.find((g) => g.id === groupId) || groups[0];

  useEffect(() => {
    if (!activeGroup) return;
    connectSocket(activeGroup.id);
    try {
      localStorage.setItem('gather.group', String(activeGroup.id));
    } catch {
      /* storage unavailable */
    }
  }, [activeGroup?.id]);

  const go = (t) => {
    window.location.hash = t;
    setTab(t);
    window.scrollTo(0, 0);
  };

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    disconnectSocket();
    setMe(null);
  };

  if (me === undefined) return <div className="center muted">Loading…</div>;
  if (me === null) return <Login onDone={loadMe} />;
  if (!activeGroup) return <GroupSetup onDone={async (g) => { setGroupId(g.id); await loadMe(); }} onLogout={logout} />;

  return (
    <GroupShell
      key={activeGroup.id}
      me={me}
      group={activeGroup}
      tab={tab}
      go={go}
      toast={toast}
      setToast={setToast}
      reloadMe={loadMe}
      switchGroup={(id) => { setGroupId(id); go('home'); }}
      logout={logout}
    />
  );
}

function GroupShell({ me, group, tab, go, toast, setToast, reloadMe, switchGroup, logout }) {
  const { data } = useGroupData(`/groups/${group.id}`, ['group', 'availability']);
  // Which time zone times are shown in (defaults to the group's). Re-renders the whole shell when it changes.
  const zoneState = useZoneChoice(group.id, (data?.group || group).timezone);
  // Confetti on every phone the moment a plan gets confirmed.
  const events = useGroupData(`/groups/${group.id}/events`, ['event']).data?.events;
  const seenConfirmed = useRef(null);
  useEffect(() => {
    if (!events) return;
    const confirmed = events.filter((e) => e.status === 'confirmed');
    if (seenConfirmed.current) {
      const fresh = confirmed.find((e) => !seenConfirmed.current.has(e.id));
      if (fresh) {
        setToast(`${fresh.title} is confirmed 🎉`);
      }
    }
    seenConfirmed.current = new Set(confirmed.map((e) => e.id));
  }, [events]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = {
    user: me.user,
    groupId: group.id,
    group: data?.group || group,
    members: data?.members || [],
    toast: setToast,
  };

  let page;
  switch (tab) {
    case 'schedule': page = <Schedule ctx={ctx} go={go} />; break;
    case 'ideas': page = <Ideas ctx={ctx} go={go} />; break;
    case 'polls': page = <Polls ctx={ctx} go={go} />; break;
    case 'money': page = <Expenses ctx={ctx} />; break;
    case 'ai': page = <Assistant ctx={ctx} />; break;
    case 'group': page = <Group ctx={ctx} groups={me.groups} reloadMe={reloadMe} switchGroup={switchGroup} logout={logout} />; break;
    default: page = <Dashboard ctx={ctx} go={go} />;
  }

  return (
    <ZoneContext.Provider value={zoneState}>
    <div className="app">
      <header className="topbar">
        <div>
          <div className="brand">gather</div>
          <div className="group-name">{ctx.group.name}</div>
        </div>
        <button className="avatar" onClick={() => go('group')} title="Group and settings" aria-label="Group and settings">
          {me.user.name.slice(0, 1).toUpperCase()}
        </button>
      </header>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
      <main className="page">{page}</main>
      <nav className="tabbar">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => go(key)} aria-label={label} title={label}>
            <Icon name={key} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
    </ZoneContext.Provider>
  );
}
