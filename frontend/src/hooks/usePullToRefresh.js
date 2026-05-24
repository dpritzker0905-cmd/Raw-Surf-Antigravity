/**
 * usePullToRefresh -- Mobile-native pull-to-refresh gesture handler.
 *
 * Usage:
 *   const { pullRef, isPulling, pullProgress } = usePullToRefresh(fetchData);
 * return <div ref={pullRef}>Gscrollable contentG</div>;
 *
 * Shows a visual indicator when user pulls down from the top of a scrollable area.
 * Triggers the onRefresh callback when released past the threshold.
 */
import { useRef, useState, useCallback, useEffect } from 'react';

const THRESHOLD = 80;     // px to pull before triggering refresh
const MAX_PULL = 120;     // max visual pull distance
const RESISTANCE = 0.45;  // pull resistance factor

export function usePullToRefresh(onRefresh, { enabled = true } = {}) {
  const pullRef = useRef(null);
  const startY = useRef(0);
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleTouchStart = useCallback((e) => {
    if (!enabled || isRefreshing) return;
    const el = pullRef.current;
    if (!el || el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
  }, [enabled, isRefreshing]);

  const handleTouchMove = useCallback((e) => {
    if (!enabled || isRefreshing || startY.current === 0) return;
    const el = pullRef.current;
    if (!el || el.scrollTop > 0) {
      startY.current = 0;
      setIsPulling(false);
      setPullProgress(0);
      return;
    }

    const deltaY = (e.touches[0].clientY - startY.current) * RESISTANCE;
    if (deltaY <= 0) return;

    const clampedDelta = Math.min(deltaY, MAX_PULL);
    const progress = Math.min(clampedDelta / THRESHOLD, 1);

    setIsPulling(true);
    setPullProgress(progress);
  }, [enabled, isRefreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling) return;

    if (pullProgress >= 1 && onRefresh) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } catch (e) {
        // Silently handle refresh errors
      }
      setIsRefreshing(false);
    }

    setIsPulling(false);
    setPullProgress(0);
    startY.current = 0;
  }, [isPulling, pullProgress, onRefresh]);

  useEffect(() => {
    const el = pullRef.current;
    if (!el || !enabled) return;

    const oldTouchAction = el.style.touchAction;
    el.style.touchAction = 'pan-y';

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.style.touchAction = oldTouchAction;
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { pullRef, isPulling, pullProgress, isRefreshing };
}

export default usePullToRefresh;
