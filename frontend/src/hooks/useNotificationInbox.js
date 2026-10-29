import { useCallback, useEffect, useRef, useState } from 'react';
import { getNotifications, getUnreadCount, markRead, markAllRead } from '../services/notificationService';
import { refreshUnreadCounts } from './useUnreadCounts';
import logger from '../utils/logger';

const PAGE_SIZE = 50;
const CHANGED = 'raw-notifications-changed';
const empty = { items: [], unread: null, hasMore: false, loading: false, loadingMore: false, error: null, mutating: false };

// A response belongs to both an account/open cycle and a read generation. A completed
// write invalidates earlier reads; account changes also invalidate pending writes.
export default function useNotificationInbox(userId, enabled = true) {
  const [state, setState] = useState(empty);
  const scope = useRef({ userId, enabled, generation: 0 });
  const reads = useRef(0);
  const mutation = useRef(false);
  const source = useRef({});
  const stateOwner = useRef(userId);
  const stateRef = useRef(state);
  stateRef.current = state;
  if (scope.current.userId !== userId || scope.current.enabled !== enabled) {
    scope.current = { userId, enabled, generation: scope.current.generation + 1 };
    reads.current += 1;
    mutation.current = false;
  }

  const load = useCallback(async (older = false, afterWrite = false) => {
    if (!userId || !enabled || scope.current.userId !== userId || (mutation.current && !afterWrite)) return;
    const owner = scope.current;
    const request = ++reads.current;
    const last = older ? stateRef.current.items.at(-1) : null;
    const params = { limit: PAGE_SIZE };
    if (last) {
      params.before_created_at = last.created_at;
      params.before_id = last.id;
    }
    setState(prev => ({ ...prev, error: null, loading: !older, loadingMore: older }));
    const current = () => scope.current === owner && reads.current === request;
    try {
      const [response, count] = await Promise.all([getNotifications(userId, params), getUnreadCount(userId)]);
      if (!current()) return;
      const items = response.data;
      setState(prev => ({
        ...prev,
        items: older ? [...prev.items, ...items.filter(item => !prev.items.some(existing => existing.id === item.id))] : items,
        unread: count.data.unread_count,
        hasMore: items.length === PAGE_SIZE,
        loading: false,
        loadingMore: false,
        error: null,
      }));
    } catch (error) {
      if (!current()) return;
      logger.error('Failed to fetch notifications:', error);
      setState(prev => ({ ...prev, loading: false, loadingMore: false, error: older ? 'older' : 'latest' }));
    }
  }, [userId, enabled]);

  useEffect(() => {
    const owner = scope.current;
    stateOwner.current = userId;
    setState(empty);
    load();
    const onChanged = event => {
      if (event.detail.userId === userId && event.detail.source !== source.current) load();
    };
    window.addEventListener(CHANGED, onChanged);
    return () => {
      window.removeEventListener(CHANGED, onChanged);
      // Invalidate on unmount, including a StrictMode effect replay.
      if (scope.current === owner) scope.current = { ...owner, generation: owner.generation + 1 };
      reads.current += 1;
    };
  }, [userId, load]);

  const mutate = useCallback(async (id) => {
    if (!userId || !enabled || scope.current.userId !== userId || mutation.current) return false;
    const owner = scope.current;
    mutation.current = true;
    reads.current += 1;
    setState(prev => ({ ...prev, mutating: true, loading: false, loadingMore: false }));
    try {
      if (id) await markRead(id);
      else await markAllRead(userId);
      if (scope.current !== owner) return false;
      // Refetch authoritative rows: a notification arriving after read-all must
      // remain unread. Never blanket-mark an arbitrarily newer client snapshot.
      refreshUnreadCounts({ force: true });
      window.dispatchEvent(new CustomEvent(CHANGED, { detail: { userId, source: source.current } }));
      await load(false, true);
      return scope.current === owner;
    } catch (error) {
      if (scope.current !== owner) return false;
      logger.error('Failed to mark notifications as read:', error);
      throw error;
    } finally {
      if (scope.current === owner) {
        mutation.current = false;
        setState(prev => ({ ...prev, mutating: false }));
      }
    }
  }, [userId, enabled, load]);

  return {
    ...(stateOwner.current === userId && enabled ? state : empty),
    reload: () => load(),
    loadOlder: () => load(true),
    read: id => mutate(id),
    readAll: () => mutate(),
  };
}
