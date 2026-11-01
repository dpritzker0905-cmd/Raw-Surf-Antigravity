import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getNotifications, getUnreadCount, markRead, markAllRead } from '../services/notificationService';
import { refreshUnreadCounts } from './useUnreadCounts';
import logger from '../utils/logger';

const PAGE_SIZE = 50;
const CHANGED = 'raw-notifications-changed';
const empty = { items: [], unread: null, hasMore: false, loading: false, loadingMore: false, error: null, mutating: false };

// A response belongs to both an account/open cycle and a read generation. A completed
// write invalidates earlier reads; account changes also invalidate pending writes.
export default function useNotificationInbox(userId, enabled = true) {
  const owner = useMemo(() => ({ userId, enabled }), [userId, enabled]);
  const [state, setState] = useState({ owner: null, data: empty });
  const scope = useRef(null);
  const source = useRef({});
  const stateRef = useRef(state);
  useLayoutEffect(() => { stateRef.current = state; }, [state]);

  const current = useCallback(context => Boolean(context && scope.current === context && context.owner === owner), [owner]);
  const update = useCallback(change => {
    setState(prev => ({ owner, data: change(prev.owner === owner ? prev.data : empty) }));
  }, [owner]);

  // Only committed account/open cycles own work. A suspended render must not
  // invalidate the visible inbox, and replayed effects get a fresh runtime scope.
  useLayoutEffect(() => {
    const context = { owner, reads: 0, mutating: false };
    scope.current = context;
    stateRef.current = { owner, data: empty };
    setState(stateRef.current);
    return () => { if (scope.current === context) scope.current = null; };
  }, [owner]);

  const load = useCallback(async (older = false, afterWrite = false) => {
    const context = scope.current;
    if (!userId || !enabled || !current(context) || (context.mutating && !afterWrite)) return false;
    const request = ++context.reads;
    const last = older && stateRef.current.owner === owner ? stateRef.current.data.items.at(-1) : null;
    const params = { limit: PAGE_SIZE };
    if (last) {
      params.before_created_at = last.created_at;
      params.before_id = last.id;
    }
    update(prev => ({ ...prev, error: null, loading: !older, loadingMore: older }));
    const currentRead = () => current(context) && context.reads === request;
    try {
      const [response, count] = await Promise.all([getNotifications(userId, params), getUnreadCount(userId)]);
      if (!currentRead()) return false;
      const items = response.data;
      update(prev => ({
        ...prev,
        items: older ? [...prev.items, ...items.filter(item => !prev.items.some(existing => existing.id === item.id))] : items,
        unread: count.data.unread_count,
        hasMore: items.length === PAGE_SIZE,
        loading: false,
        loadingMore: false,
        error: null,
      }));
      return true;
    } catch (error) {
      if (!currentRead()) return false;
      logger.error('Failed to fetch notifications:', error);
      update(prev => ({ ...prev, loading: false, loadingMore: false, error: older ? 'older' : 'latest' }));
      return false;
    }
  }, [userId, enabled, owner, current, update]);

  useEffect(() => {
    load();
    const onChanged = event => {
      if (event.detail.userId === userId && event.detail.source !== source.current) load();
    };
    window.addEventListener(CHANGED, onChanged);
    return () => window.removeEventListener(CHANGED, onChanged);
  }, [userId, load]);

  const performMutation = useCallback(async (id, onActivate, write = true, requireFresh = false) => {
    const context = scope.current;
    if (!userId || !enabled || !current(context) || context.mutating) return false;
    context.mutating = true;
    if (write) context.reads += 1;
    update(prev => ({ ...prev, mutating: true, ...(write ? { loading: false, loadingMore: false } : {}) }));
    try {
      if (write) {
        if (id) await markRead(id);
        else await markAllRead(userId);
        if (!current(context)) return false;
        // Refetch authoritative rows: a notification arriving after read-all
        // must remain unread. Callers may require a fresh read before activation.
        refreshUnreadCounts({ force: true });
        window.dispatchEvent(new CustomEvent(CHANGED, { detail: { userId, source: source.current } }));
        const loaded = await load(false, true);
        if (!current(context) || (onActivate && requireFresh && !loaded)) return false;
      }
      if (onActivate) {
        // Keep same-tick read-only activations serialized before navigation.
        await Promise.resolve();
        if (!current(context)) return false;
        await onActivate();
      }
      return current(context);
    } catch (error) {
      if (!current(context)) return false;
      logger.error('Failed to update or activate notification:', error);
      throw error;
    } finally {
      if (current(context)) {
        context.mutating = false;
        update(prev => ({ ...prev, mutating: false }));
      }
    }
  }, [userId, enabled, load, current, update]);

  const activate = useCallback((notification, onActivate, { requireFresh = false } = {}) => {
    if (!notification || typeof notification !== 'object' || Array.isArray(notification) || typeof notification.id !== 'string' ||
        !notification.id.trim() || typeof onActivate !== 'function') return Promise.resolve(false);
    return performMutation(notification.id, onActivate, !notification.is_read, requireFresh);
  }, [performMutation]);

  return {
    ...(state.owner === owner && enabled ? state.data : empty),
    reload: () => load(),
    loadOlder: () => load(true),
    read: id => performMutation(id),
    readAll: () => performMutation(),
    activate,
  };
}
