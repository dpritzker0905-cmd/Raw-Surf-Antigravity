/**
 * useOptimisticAction — Hook for optimistic UI updates.
 * Immediately updates the UI, then makes the API call.
 * Rolls back on failure with a toast notification.
 *
 * Usage:
 *   const optimistic = useOptimisticAction();
 *
 *   const handleLike = () => {
 *     optimistic({
 *       action: () => apiClient.post(`/posts/${postId}/like`),
 *       onOptimistic: () => setLiked(true),
 *       onRollback: () => setLiked(false),
 *       errorMessage: 'Failed to like post',
 *     });
 *   };
 */
import { useCallback, useRef } from 'react';
import { toast } from 'sonner';

var useOptimisticAction = () => {
  const pendingRef = useRef(new Set());

  /**
   * Execute an optimistic action.
   * @param {Object} config
   * @param {Function} config.action - The async API call
   * @param {Function} config.onOptimistic - Immediate state update (optimistic)
   * @param {Function} config.onRollback - State rollback on error
   * @param {string} [config.errorMessage] - Toast message on failure
   * @param {string} [config.key] - Dedup key to prevent double-taps
   */
  const execute = useCallback(async ({ action, onOptimistic, onRollback, errorMessage, key }) => {
    // Deduplicate rapid taps
    if (key && pendingRef.current.has(key)) return;
    if (key) pendingRef.current.add(key);

    // Haptic feedback — light vibration on mobile for premium feel
    if (navigator.vibrate) {
      navigator.vibrate(8);
    }

    // Optimistic update — instant UI change
    onOptimistic?.();

    try {
      await action();
    } catch (error) {
      // Rollback on failure
      onRollback?.();
      if (errorMessage) {
        toast.error(errorMessage);
      }
    } finally {
      if (key) pendingRef.current.delete(key);
    }
  }, []);

  return execute;
};

export default useOptimisticAction;
