/**
 * useTopNavPullDown -- Touch gesture hook for the TopNav pull-down drawer.
 *
 * Distinguishes between:
 * - Pulling DOWN on the TopNav header -- opens the drawer
 * - Pulling DOWN on page content -- native pull-to-refresh (usePullToRefresh)
 *
 * How it avoids conflict:
 *   1. Only activates when touch starts INSIDE the TopNav header element
 *   2. Uses a directional lock: once a vertical drag is detected within the
 *      header zone, we call e.preventDefault() to block the browser's native
 *      pull-to-refresh for that gesture
 *   3. The TopNav header has `touch-action: pan-x` + `overscroll-behavior: none`
 *      to hint browsers away from vertical overscroll
 *
 * Usage:
 *   const { headerRef, isOpen, dragOffset, handlers } = useTopNavPullDown();
 *   return <header ref={headerRef} {...handlers}>...</header>;
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import useHapticFeedback from './useHapticFeedback';

const OPEN_THRESHOLD = 40;   // px to pull before snapping open
const CLOSE_THRESHOLD = 30;  // px to push up before snapping closed
const MAX_DRAG = 160;        // max visual drag distance
const RESISTANCE = 0.55;     // drag resistance factor

export function useTopNavPullDown() {
  const headerRef = useRef(null);
  const startY = useRef(0);
  const isDragging = useRef(false);
  const gestureStartedInHeader = useRef(false);

  const [isOpen, setIsOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const haptic = useHapticFeedback();

  // Has the user crossed the snap threshold during this drag?
  const crossedThreshold = useRef(false);

  const handleTouchStart = useCallback((e) => {
    // Only track touches that begin inside the header element
    const headerEl = headerRef.current;
    if (!headerEl) return;

    const touch = e.touches[0];
    const rect = headerEl.getBoundingClientRect();

    // Expand touch zone slightly below header for the pull handle
    const touchZoneBottom = rect.bottom + 12;
    if (touch.clientY > touchZoneBottom || touch.clientY < rect.top) {
      gestureStartedInHeader.current = false;
      return;
    }

    gestureStartedInHeader.current = true;
    startY.current = touch.clientY;
    isDragging.current = false;
    crossedThreshold.current = false;
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!gestureStartedInHeader.current || startY.current === 0) return;

    const deltaY = (e.touches[0].clientY - startY.current) * RESISTANCE;

    if (!isOpen) {
 // CLOSED -- pulling DOWN to open
      if (deltaY <= 5) return; // ignore tiny movements & upward swipes
      isDragging.current = true;

      // Prevent native pull-to-refresh for this gesture
      if (e.cancelable) e.preventDefault();

      const clampedDelta = Math.min(deltaY, MAX_DRAG);
      setDragOffset(clampedDelta);

      // Haptic feedback at threshold crossing
      if (clampedDelta >= OPEN_THRESHOLD && !crossedThreshold.current) {
        crossedThreshold.current = true;
        haptic('light');
      }
    } else {
 // OPEN -- pushing UP to close
      if (deltaY >= -5) return;
      isDragging.current = true;

      if (e.cancelable) e.preventDefault();

      const clampedDelta = Math.max(deltaY, -MAX_DRAG);
      setDragOffset(clampedDelta);

      if (Math.abs(clampedDelta) >= CLOSE_THRESHOLD && !crossedThreshold.current) {
        crossedThreshold.current = true;
        haptic('light');
      }
    }
  }, [isOpen, haptic]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) {
      startY.current = 0;
      gestureStartedInHeader.current = false;
      return;
    }

    if (!isOpen && dragOffset >= OPEN_THRESHOLD) {
      setIsOpen(true);
      haptic('medium');
    } else if (isOpen && dragOffset <= -CLOSE_THRESHOLD) {
      setIsOpen(false);
      haptic('light');
    }

    // Reset drag state with spring-back
    setDragOffset(0);
    startY.current = 0;
    isDragging.current = false;
    gestureStartedInHeader.current = false;
  }, [isOpen, dragOffset, haptic]);

  // Attach listeners with { passive: false } so preventDefault works on touchmove
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  // Close drawer on route change (handled by parent via this setter)
  const close = useCallback(() => {
    setIsOpen(false);
    setDragOffset(0);
  }, []);

  // Toggle for tap-based open/close (accessibility fallback)
  const toggle = useCallback(() => {
    setIsOpen(prev => {
      haptic(prev ? 'light' : 'medium');
      return !prev;
    });
    setDragOffset(0);
  }, [haptic]);

  return {
    headerRef,
    isOpen,
    dragOffset,
    close,
    toggle,
  };
}

export default useTopNavPullDown;
