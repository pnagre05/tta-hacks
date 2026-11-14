import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api } from './api.js';
import { browserZone, zoneChoices } from './lib/zone.js';
import { setZoneSync } from './lib/zoneState.js';

// The zone times are shown in. Three choices, remembered per group in this browser:
//   ''        follow the group's time zone (default, so the grid and the suggestions agree)
//   'device'  this device's time zone
//   any IANA zone name, for example 'Asia/Tokyo'
export const ZoneContext = createContext(null);

export function useZone() {
  const ctx = useContext(ZoneContext);
  if (ctx) return ctx;
  const z = browserZone();
  return { zone: z, groupZone: z, choice: '', setChoice() {} };
}

const storageKey = (groupId) => `gather.tz.${groupId}`;
function readChoice(groupId) {
  try {
    return localStorage.getItem(storageKey(groupId)) || '';
  } catch {
    return '';
  }
}

export function useZoneChoice(groupId, groupZone) {
  const [choice, setChoiceState] = useState(() => readChoice(groupId));
  const setChoice = useCallback((value) => {
    setChoiceState(value);
    try {
      if (value) localStorage.setItem(storageKey(groupId), value);
      else localStorage.removeItem(storageKey(groupId));
    } catch {
      /* storage unavailable: the choice just lasts until reload */
    }
  }, [groupId]);

  const device = browserZone();
  const zone = choice === 'device' ? device : choice || groupZone || device;
  setZoneSync(zone); // plain formatting helpers read this while the page renders

  return useMemo(
    () => ({ zone, groupZone: groupZone || device, choice, setChoice }),
    [zone, groupZone, device, choice, setChoice]
  );
}

const label = (z) => z.replaceAll('_', ' ');

// "Show times in" selector, for each person.
export function ZonePicker({ id = 'zone-pick' }) {
  const { zone, groupZone, choice, setChoice } = useZone();
  const device = browserZone();
  const all = useMemo(() => zoneChoices([groupZone, device, zone]), [groupZone, device, zone]);
  return (
    <label className="zone-pick" htmlFor={id}>
      <span className="small muted">Show times in</span>
      <select id={id} value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">Group time zone ({label(groupZone)})</option>
        <option value="device">This device ({label(device)})</option>
        <optgroup label="All time zones">
          {all.map((z) => <option key={z} value={z}>{label(z)}</option>)}
        </optgroup>
      </select>
    </label>
  );
}

// The group's own time zone. It decides the 9 AM to 11 PM window used for suggestions, so only the owner can change it.
export function GroupZoneEditor({ ctx }) {
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const current = ctx.group?.timezone;
  const isOwner = ctx.members.find((m) => m.id === ctx.user.id)?.role === 'owner';
  const all = useMemo(() => zoneChoices([current]), [current]);

  const change = async (timezone) => {
    setError(null);
    setSaving(true);
    try {
      await api(`/groups/${ctx.groupId}/timezone`, { method: 'PATCH', body: { timezone } });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack tight">
      <label className="zone-pick" htmlFor="group-zone">
        <span className="small muted">Group time zone</span>
        <select id="group-zone" value={current || ''} disabled={!isOwner || saving} onChange={(e) => change(e.target.value)}>
          {all.map((z) => <option key={z} value={z}>{label(z)}</option>)}
        </select>
      </label>
      <p className="small muted">
        {isOwner
          ? "Suggested times are picked between 9 AM and 11 PM in this zone. Changing it affects everyone."
          : 'Only the group owner can change this. Use "Show times in" to see times in your own zone.'}
      </p>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
