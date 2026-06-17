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

import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

const POLL_INTERVAL = 8000; // 8 seconds

// Global shared state
let globalActiveSession = null;
let globalLoading = true;
let globalUser = null;
const subscribers = new Set();
let pollIntervalId = null;

const fetchActiveSessionGlobal = async (userId) => {
  if (!userId) {
    globalActiveSession = null;
    globalLoading = false;
    notifySubscribers();
    return;
  }

  try {
    const res = await apiClient.get(`/dispatch/user/${userId}/active`);
    const dispatch = res.data?.active_dispatch;

    if (
      dispatch &&
      ['requester', 'crew_member', 'photographer'].includes(dispatch.role) &&
      ['searching_for_pro', 'pending_payment', 'accepted', 'en_route', 'arrived', 'in_session'].includes(dispatch.status)
    ) {
      globalActiveSession = {
        type: 'on_demand',
        id: dispatch.id,
        status: dispatch.status,
        photographerName: dispatch.photographer_name || 'Photographer',
        eta: dispatch.eta_minutes,
        locationName: dispatch.location_name,
        role: dispatch.role,
      };
    } else {
      globalActiveSession = null;
    }
  } catch (err) {
    logger.debug('[useActiveSession] Poll error:', err);
  } finally {
    globalLoading = false;
    notifySubscribers();
  }
};

const notifySubscribers = () => {
  const currentState = { activeSession: globalActiveSession, loading: globalLoading };
  subscribers.forEach(callback => callback(currentState));
};

const startPolling = (userId) => {
  if (pollIntervalId) return;

  // Immediate fetch
  fetchActiveSessionGlobal(userId);

  pollIntervalId = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    fetchActiveSessionGlobal(userId);
  }, POLL_INTERVAL);
};

const stopPolling = () => {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
};

export const useActiveSession = () => {
  const { user } = useAuth();
  const [state, setState] = useState({
    activeSession: globalActiveSession,
    loading: globalLoading
  });

  useEffect(() => {
    if (!user?.id) {
      setState({ activeSession: null, loading: false });
      return;
    }

    // Reset state if user changes
    if (globalUser !== user.id) {
      globalUser = user.id;
      globalActiveSession = null;
      globalLoading = true;
      stopPolling();
    }

    const handleUpdate = (newState) => {
      setState(newState);
    };

    subscribers.add(handleUpdate);
    startPolling(user.id);

    // Sync state immediately with currently cached global value
    setState({
      activeSession: globalActiveSession,
      loading: globalLoading
    });

    return () => {
      subscribers.delete(handleUpdate);
      if (subscribers.size === 0) {
        stopPolling();
      }
    };
  }, [user?.id]);

  return state;
};

export default useActiveSession;
