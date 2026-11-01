/**
 * useUnreadCounts.js - ONE poller for the notification and message badges, shared by every nav that shows them.
 *
 * AppLayout mounts Sidebar, TopNav and BottomNav together (CSS hides them per breakpoint), and each one polled its own
 * copy: the 2026-10-23 live trace of dev saw /notifications/{id}/unread-count and /messages/unread-counts/{id} each
 * sent twice every 30 s, to the one 1-CPU box that serves production and dev.
 *
 * Same pattern as useActiveSession: module-level state, one interval while anything is subscribed, no request while
 * the tab is hidden, and one catch-up request when the tab comes back after a missed tick. Concurrent refreshes share
 * the request in flight.
 *
 * Returns { notifications, messages, refresh }.
 */
import { useCallback, useEffect, useState } from 'react';
import apiClient from '../lib/apiClient';
import { getUnreadCount } from '../services/notificationService';
import logger from '../utils/logger';

export const UNREAD_POLL_MS = 30000;
const ZERO = { notifications: 0, messages: 0 };

let counts = ZERO;
let currentUser = null;
let intervalId = null;
let lastFetchAt = 0;
let inFlight = null;
let generation = 0;
const subscribers = new Set();

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

const fetchCounts = (userId, force = false) => {
  if (force) {
    generation += 1;
    inFlight = null;
  }
  if (inFlight) return inFlight;
  const requestGeneration = generation;
  lastFetchAt = Date.now();
  const read = (request, pick, what) => request
    .then((response) => pick(response.data || {}) || 0)
    .catch((error) => { logger.error(`Failed to fetch ${what} count:`, error); return null; });
  const request = Promise.all([
    read(getUnreadCount(userId), (d) => d.unread_count, 'notification'),
    read(apiClient.get(`/messages/unread-counts/${userId}`), (d) => d.total, 'message'),
  ]).then(([notifications, messages]) => {
    if (userId !== currentUser || requestGeneration !== generation) return;
    counts = {
      notifications: notifications === null ? counts.notifications : notifications,
      messages: messages === null ? counts.messages : messages,
    };
    subscribers.forEach((notify) => notify(counts));
  }).finally(() => { if (inFlight === request) inFlight = null; });
  inFlight = request;
  return request;
};

const onVisibilityChange = () => {
  if (!isHidden() && currentUser && Date.now() - lastFetchAt >= UNREAD_POLL_MS) fetchCounts(currentUser);
};

const startPolling = (userId) => {
  if (intervalId) return;
  fetchCounts(userId);
  intervalId = setInterval(() => {
    if (!isHidden()) fetchCounts(userId);
  }, UNREAD_POLL_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);
};

const stopPolling = () => {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
  document.removeEventListener('visibilitychange', onVisibilityChange);
};

export const refreshUnreadCounts = ({ force = false } = {}) => (currentUser ? fetchCounts(currentUser, force) : Promise.resolve());

export function useUnreadCounts(userId) {
  const [state, setState] = useState(userId && userId === currentUser ? counts : ZERO);

  useEffect(() => {
    if (!userId) {
      setState(ZERO);
      return undefined;
    }
    if (currentUser !== userId) {
      stopPolling();
      currentUser = userId;
      counts = ZERO;
      inFlight = null;
      generation += 1;
    }
    subscribers.add(setState);
    startPolling(userId);
    setState(counts);
    return () => {
      subscribers.delete(setState);
      if (subscribers.size === 0) {
        stopPolling();
        generation += 1;
        inFlight = null;
        currentUser = null;
        counts = ZERO;
      }
    };
  }, [userId]);

  const refresh = useCallback(() => refreshUnreadCounts(), []);
  return { ...(userId && userId === currentUser ? state : ZERO), refresh };
}

export default useUnreadCounts;
