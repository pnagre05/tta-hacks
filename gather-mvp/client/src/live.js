// Live updates: one socket, one event. When the server says "poll changed",
// every component showing polls refetches through the normal API.
import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from './api.js';

let socket = null;
let currentGroup = null;
const listeners = new Set();

export function connectSocket(groupId) {
  currentGroup = groupId;
  if (!socket) {
    socket = io({ withCredentials: true });
    socket.on('connect', () => currentGroup && socket.emit('join', currentGroup, () => {}));
    socket.on('group:updated', ({ type }) => listeners.forEach((fn) => fn(type)));
  } else if (socket.connected) {
    socket.emit('join', groupId, () => {});
  }
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  currentGroup = null;
}

export function useLive(types, onChange) {
  const ref = useRef(onChange);
  ref.current = onChange;
  const key = types.join(',');
  useEffect(() => {
    const fn = (type) => key.split(',').includes(type) && ref.current();
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, [key]);
}

/**
 * Fetch an API path and refetch whenever one of `types` changes on the server.
 * const { data, error, reload } = useGroupData(`/groups/${id}/polls`, ['poll']);
 */
export function useGroupData(path, types) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(async () => {
    try {
      setData(await api(path));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [path]);
  useEffect(() => {
    reload();
  }, [reload]);
  useLive(types, reload);
  return { data, error, reload };
}
