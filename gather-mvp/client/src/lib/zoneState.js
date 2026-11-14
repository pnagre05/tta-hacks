// The zone times are currently shown in. Plain formatting helpers (api.js) read it; the React side sets it.
import { browserZone } from './zone.js';

let current = browserZone();

export const getZone = () => current;
export function setZoneSync(zone) {
  current = zone || browserZone();
}
