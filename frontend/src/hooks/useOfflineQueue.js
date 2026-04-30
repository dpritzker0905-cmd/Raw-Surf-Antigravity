/**
 * useOfflineQueue — Queues user actions when offline, auto-syncs on reconnect.
 *
 * Supported action types: 'reaction', 'comment', 'follow', 'save_post'
 * Uses localStorage key `rawsurf_offline_queue` for persistence across refreshes.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';

const STORAGE_KEY = 'rawsurf_offline_queue';

const loadQueue = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveQueue = (queue) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage full — drop oldest items
    localStorage.removeItem(STORAGE_KEY);
  }
};

/**
 * Replay a single queued action against the API.
 * Returns true if successful, false if should retry.
 */
const replayAction = async (action) => {
  const { type, payload } = action;

  try {
    switch (type) {
      case 'reaction':
        await apiClient.post(
          `/posts/${payload.postId}/like?user_id=${payload.userId}`
        );
        break;

      case 'comment':
        await apiClient.post(
          `/posts/${payload.postId}/comments?user_id=${payload.userId}`,
          { content: payload.content }
        );
        break;

      case 'follow':
        await apiClient.post(
          `/profiles/${payload.targetId}/follow?follower_id=${payload.userId}`
        );
        break;

      case 'save_post':
        await apiClient.post(
          `/posts/${payload.postId}/save?user_id=${payload.userId}`
        );
        break;

      default:
        console.warn(`[OfflineQueue] Unknown action type: ${type}`);
        return true; // Drop unknown actions
    }
    return true;
  } catch (err) {
    // 4xx = permanent failure, don't retry
    if (err.response && err.response.status >= 400 && err.response.status < 500) {
      console.warn(`[OfflineQueue] Dropping action (${type}) — ${err.response.status}`);
      return true;
    }
    return false; // Retry on 5xx / network errors
  }
};

export const useOfflineQueue = () => {
  const [queue, setQueue] = useState(loadQueue);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingRef = useRef(false);

  // Track online/offline status
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Flush queue when coming back online
  useEffect(() => {
    if (isOnline && queue.length > 0 && !syncingRef.current) {
      flushQueue();
    }
  }, [isOnline]); // flushQueue intentionally omitted — guarded by syncingRef

  const flushQueue = useCallback(async () => {
    if (syncingRef.current || queue.length === 0) return;
    syncingRef.current = true;
    setIsSyncing(true);

    const remaining = [...queue];
    let synced = 0;

    for (let i = 0; i < remaining.length; i++) {
      const ok = await replayAction(remaining[i]);
      if (ok) {
        remaining.splice(i, 1);
        i--;
        synced++;
      } else {
        // Stop on first failure (server might be down)
        break;
      }
    }

    setQueue(remaining);
    saveQueue(remaining);
    syncingRef.current = false;
    setIsSyncing(false);

    if (synced > 0) {
      toast.success(`✅ Synced ${synced} offline action${synced !== 1 ? 's' : ''}`);
    }
  }, [queue]);

  /** Queue an action for later sync */
  const queueAction = useCallback((type, payload) => {
    const action = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      payload,
      createdAt: new Date().toISOString(),
    };

    setQueue((prev) => {
      const next = [...prev, action];
      saveQueue(next);
      return next;
    });

    toast.info('📶 Saved offline — will sync when back online');
  }, []);

  return {
    isOnline,
    isSyncing,
    pendingCount: queue.length,
    queueAction,
    flushQueue,
  };
};

export default useOfflineQueue;
