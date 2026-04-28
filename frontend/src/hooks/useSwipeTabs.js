import { useRef, useCallback } from 'react';

/**
 * useSwipeTabs — lightweight horizontal-swipe hook for tab navigation.
 *
 * Only fires when the gesture is predominantly horizontal (|dx| > |dy| * 1.5)
 * so that normal vertical scrolling is never blocked.
 *
 * @param {string[]} tabs        Ordered list of tab keys, e.g. ['for_you','waves','following']
 * @param {string}   activeTab   Currently active tab key
 * @param {Function} setActiveTab Setter to change the active tab
 * @param {Object}   [options]
 * @param {number}   [options.threshold=50]  Min horizontal px to count as a swipe
 * @returns {{ onTouchStart, onTouchMove, onTouchEnd }}  Spread onto a container element
 */
export default function useSwipeTabs(tabs, activeTab, setActiveTab, options = {}) {
  const { threshold = 50 } = options;

  // Refs survive re-renders without causing them
  const startX = useRef(0);
  const startY = useRef(0);
  const swiping = useRef(false);   // true once we confirm a horizontal swipe
  const locked  = useRef(false);   // true once we confirm a vertical scroll (ignore)

  const onTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    startX.current  = touch.clientX;
    startY.current  = touch.clientY;
    swiping.current = false;
    locked.current  = false;
  }, []);

  const onTouchMove = useCallback((e) => {
    if (locked.current) return; // already decided this is a vertical scroll

    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    // Once we've moved enough to decide direction, lock the decision
    if (!swiping.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      if (Math.abs(dx) > Math.abs(dy) * 1.5) {
        swiping.current = true; // horizontal swipe confirmed
      } else {
        locked.current = true;  // vertical scroll — bail out
        return;
      }
    }

    // Prevent vertical scroll while we're swiping horizontally
    if (swiping.current) {
      e.preventDefault();
    }
  }, []);

  const onTouchEnd = useCallback((e) => {
    if (!swiping.current) return; // wasn't a horizontal swipe

    const dx = e.changedTouches[0].clientX - startX.current;
    const currentIndex = tabs.indexOf(activeTab);
    if (currentIndex === -1) return;

    if (dx < -threshold && currentIndex < tabs.length - 1) {
      // Swiped left → next tab
      setActiveTab(tabs[currentIndex + 1]);
    } else if (dx > threshold && currentIndex > 0) {
      // Swiped right → previous tab
      setActiveTab(tabs[currentIndex - 1]);
    }

    swiping.current = false;
  }, [tabs, activeTab, setActiveTab, threshold]);

  return { onTouchStart, onTouchMove, onTouchEnd };
}
