import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

const initialState = token => ({ token, bookings: [], loading: true, error: null });
const stop = request => { if (request) { clearTimeout(request.timer); request.controller.abort(); } };

// Only the photographer's GET/list state. Booking mutations keep their existing action owner.
export default function usePhotographerBookingsList({ userId, ownerKey }) {
  const scope = JSON.stringify([userId, ownerKey]);
  const token = useMemo(() => ({ scope }), [scope]);
  const current = useRef(null);
  const request = useRef(null);
  const [state, setState] = useState(() => initialState(token));
  const visible = state.token === token ? state : initialState(token);

  // Speculative renders cannot invalidate the inbox that is still committed on screen.
  useLayoutEffect(() => {
    current.current = token;
    return () => { current.current = null; stop(request.current); };
  }, [token]);

  const setBookings = useCallback(value => {
    if (current.current !== token) return;
    setState(prev => {
      const next = prev.token === token ? prev : initialState(token);
      return { ...next, bookings: typeof value === 'function' ? value(next.bookings) : value };
    });
  }, [token]);

  const fetchBookings = useCallback(async () => {
    if (!userId || current.current !== token) return;
    stop(request.current);
    const entry = { controller: new AbortController(), timer: null };
    request.current = entry;
    const isCurrent = () => current.current === token && request.current === entry && !entry.controller.signal.aborted;
    const fail = clear => setState(prev => ({ ...(clear || prev.token !== token ? initialState(token) : prev),
      loading: false, error: 'Could not load bookings. Please try again.',
    }));
    setState(prev => ({ ...(prev.token === token ? prev : initialState(token)), loading: true }));
    // Preserve the existing ten-second recovery bound, but never manufacture a successful empty list.
    entry.timer = setTimeout(() => {
      if (!isCurrent()) return;
      entry.controller.abort();
      fail(false);
    }, 10000);
    try {
      const response = await apiClient.get(`/photographer/${userId}/bookings`, { signal: entry.controller.signal });
      if (!isCurrent()) return;
      const list = response.data;
      if (!Array.isArray(list) || list.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
        throw new Error('Invalid photographer booking list response');
      }
      setState({ token, bookings: list, loading: false, error: null });
    } catch (error) {
      if (!isCurrent()) return;
      logger.error('Error fetching bookings:', error);
      fail([401, 403, 404].includes(error?.response?.status));
    } finally {
      clearTimeout(entry.timer);
    }
  }, [userId, token]);

  useEffect(() => { if (userId) fetchBookings(); }, [userId, fetchBookings]);
  return { ...visible, setBookings, fetchBookings };
}
