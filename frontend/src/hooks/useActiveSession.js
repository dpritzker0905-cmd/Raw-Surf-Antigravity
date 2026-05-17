/**
 * useActiveSession.js
 *
 * Global hook that polls for any active on-demand dispatch, live session,
 * or pending crew invite for the current user. Runs app-wide (mounted in
 * AppLayout) so the ActiveSessionBanner always has fresh data regardless
 * of which tab the user is on.
 *
 * Returns:
 *   - activeSession: { type, id, status, photographerName, eta, locationName, role }
 *   - loading: boolean
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

const POLL_INTERVAL = 8000; // 8 seconds

export const useActiveSession = () => {
  const { user } = useAuth();
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(null);

  const fetchActiveSession = useCallback(async () => {
    if (!user?.id) {
      setActiveSession(null);
      setLoading(false);
      return;
    }

    try {
      // Check for active on-demand dispatch
      const res = await apiClient.get(`/dispatch/user/${user.id}/active`);
      const dispatch = res.data?.active_dispatch;

      if (
        dispatch &&
        ['requester', 'crew_member', 'photographer'].includes(dispatch.role) &&
        ['searching_for_pro', 'pending_payment', 'accepted', 'en_route', 'arrived', 'in_session'].includes(dispatch.status)
      ) {
        setActiveSession({
          type: 'on_demand',
          id: dispatch.id,
          status: dispatch.status,
          photographerName: dispatch.photographer_name || 'Photographer',
          eta: dispatch.eta_minutes,
          locationName: dispatch.location_name,
          role: dispatch.role,
        });
      } else {
        setActiveSession(null);
      }
    } catch (err) {
      logger.debug('[useActiveSession] Poll error:', err);
      // Don't clear session on transient errors
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setActiveSession(null);
      setLoading(false);
      return;
    }

    // Immediate fetch
    fetchActiveSession();

    // Poll
    pollRef.current = setInterval(() => {
      // Skip when tab is hidden
      if (document.visibilityState === 'hidden') return;
      fetchActiveSession();
    }, POLL_INTERVAL);

    return () => clearInterval(pollRef.current);
  }, [user?.id, fetchActiveSession]);

  return { activeSession, loading };
};

export default useActiveSession;
