import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import apiClient from '../lib/apiClient';

// This owns only GET /sessions/user/{id}; payment and Leave remain in their callers.
const useBookingsLiveSessionsList = ({ user, setLiveSessions }) => {
  const ownerRef = useRef(null);
  const committedIdentity = useRef(null);
  const [state, setState] = useState({ phase: 'idle', hasLoaded: false });
  const userId = user?.id;
  const session = user?.access_token;

  const refresh = useCallback(async () => {
    const owner = ownerRef.current;
    if (!owner || !userId || owner.userId !== userId || owner.session !== session) return;
    const request = ++owner.request;
    const current = () => ownerRef.current === owner && owner.request === request;
    setState({ phase: 'loading', hasLoaded: owner.hasLoaded });
    try {
      const response = await apiClient.get(`/sessions/user/${userId}`);
      if (!current()) return;
      const rows = response.data;
      const valid = Array.isArray(rows) && rows.every(row => row && typeof row === 'object'
        && !Array.isArray(row) && typeof row.id === 'string' && row.id.length > 0
        && ['photographer_name', 'photographer_username', 'location'].every(field =>
          row[field] == null || typeof row[field] === 'string')
        && (row.amount_paid == null || typeof row.amount_paid === 'string'
          || (typeof row.amount_paid === 'number' && Number.isFinite(row.amount_paid))));
      if (!valid) throw new Error('Malformed live sessions list');
      owner.setRows(rows);
      owner.hasLoaded = true;
      owner.settledPhase = 'ready';
      setState({ phase: 'ready', hasLoaded: true });
    } catch (_error) {
      if (!current()) return;
      if ([401, 403, 404].includes(_error.response?.status)) {
        owner.hasLoaded = false;
        owner.setRows([]);
      }
      owner.settledPhase = 'error';
      setState({ phase: 'error', hasLoaded: owner.hasLoaded });
    }
  }, [userId, session]);

  useLayoutEffect(() => {
    const previous = committedIdentity.current;
    const owner = { userId, session, request: 0, hasLoaded: false, settledPhase: 'idle', setRows: setLiveSessions };
    ownerRef.current = owner;
    committedIdentity.current = { userId, session };
    setLiveSessions([]);
    setState({ phase: 'idle', hasLoaded: false });
    // Bookings already refreshes all resources when user ID/navigation changes.
    // A same-ID replacement session refreshes ONLY this private read.
    if (userId && previous?.userId === userId && previous.session !== session) void refresh();
    return () => { if (ownerRef.current === owner) ownerRef.current = null; };
  }, [userId, session, refresh]);

  useLayoutEffect(() => {
    if (ownerRef.current) ownerRef.current.setRows = setLiveSessions;
  });

  const invalidate = useCallback(() => {
    const owner = ownerRef.current;
    if (!owner || !userId || owner.userId !== userId || owner.session !== session) return false;
    // A successful Leave is newer than any previously started list response.
    owner.request++;
    // Leave invalidates an older GET; it cannot resolve that list's settled read error.
    setState({ phase: owner.settledPhase, hasLoaded: owner.hasLoaded });
    return true;
  }, [userId, session]);

  return { ...state, refresh, invalidate };
};

export default useBookingsLiveSessionsList;
