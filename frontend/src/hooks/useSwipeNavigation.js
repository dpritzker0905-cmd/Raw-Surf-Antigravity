/**
 * useSwipeNavigation — Shared hook for swipe-to-navigate tab switching (v80)
 *
 * Extracted from Explore.js. Provides touch handlers and a content ref
 * for horizontal swipe navigation between tabs on mobile.
 *
 * Usage:
 *   const { contentRef, swipeHandlers, isAnimating } = useSwipeNavigation({
 *     tabs: ['tab1', 'tab2', 'tab3'],
 *     activeTab: 'tab1',
 *     setActiveTab: setActiveTab,
 *   });
 *
 *   <div {...swipeHandlers}>
 *     <div ref={contentRef}>{children}</div>
 *   </div>
 */
import { useRef, useState, useCallback } from 'react';

const useSwipeNavigation = ({ tabs, activeTab, setActiveTab }) => {
  // Refs for tracking touch position
  const swipeStartXRef = useRef(0);
  const swipeStartYRef = useRef(0);
  const swipeActiveRef = useRef(false);
  const swipeDragRef = useRef(0);
  const swipeLockedRef = useRef(false);
  const contentRef = useRef(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const tabIds = typeof tabs[0] === 'string' ? tabs : tabs.map(t => t.id);

  const onTouchStart = useCallback((e) => {
    if (isAnimating) return;
    swipeStartXRef.current = e.touches[0].clientX;
    swipeStartYRef.current = e.touches[0].clientY;
    swipeActiveRef.current = true;
    swipeLockedRef.current = false;
    swipeDragRef.current = 0;
    if (contentRef.current) {
      contentRef.current.style.transition = 'none';
    }
  }, [isAnimating]);

  const onTouchMove = useCallback((e) => {
    if (!swipeActiveRef.current || isAnimating) return;
    const dx = e.touches[0].clientX - swipeStartXRef.current;
    const dy = e.touches[0].clientY - swipeStartYRef.current;

    // Lock axis: if vertical movement is dominant, cancel swipe
    if (!swipeLockedRef.current) {
      // Use a stricter threshold to ensure we don't accidentally lock vertical scrolls
      if (Math.abs(dy) > Math.abs(dx) * 0.8 && Math.abs(dy) > 10) {
        swipeActiveRef.current = false;
        if (contentRef.current) {
          contentRef.current.style.transform = '';
          contentRef.current.style.transition = '';
        }
        return;
      }
      if (Math.abs(dx) > 10) {
        swipeLockedRef.current = true;
      } else {
        return;
      }
    }

    // We rely on CSS `touch-action: pan-y` on the container instead of `e.preventDefault()`.
    // Calling preventDefault here can cause severe scroll-locking regressions on precision touchpads.
    // if (e.cancelable) {
    //   e.preventDefault();
    // }
    const currentIdx = tabIds.indexOf(activeTab);
    const atEdge = (dx > 0 && currentIdx === 0) || (dx < 0 && currentIdx === tabIds.length - 1);
    const dampened = atEdge ? dx * 0.2 : dx;
    swipeDragRef.current = dampened;

    if (contentRef.current) {
      contentRef.current.style.transform = `translateX(${dampened}px)`;
      const progress = Math.min(Math.abs(dampened) / 200, 1);
      contentRef.current.style.opacity = `${1 - progress * 0.15}`;
    }
  }, [isAnimating, activeTab, tabIds]);

  const onTouchEnd = useCallback(() => {
    if (!swipeActiveRef.current || isAnimating) {
      swipeActiveRef.current = false;
      return;
    }
    swipeActiveRef.current = false;
    const dragX = swipeDragRef.current;
    const MIN_SWIPE = 50;
    const currentIdx = tabIds.indexOf(activeTab);

    if (Math.abs(dragX) >= MIN_SWIPE && swipeLockedRef.current) {
      const goingLeft = dragX < 0;
      const nextIdx = goingLeft ? currentIdx + 1 : currentIdx - 1;

      if (nextIdx >= 0 && nextIdx < tabIds.length) {
        setIsAnimating(true);
        if (contentRef.current) {
          contentRef.current.style.transition = 'transform 0.22s ease-out, opacity 0.22s ease-out';
          contentRef.current.style.transform = `translateX(${goingLeft ? '-100%' : '100%'})`;
          contentRef.current.style.opacity = '0';
        }

        setTimeout(() => {
          setActiveTab(tabIds[nextIdx]);
          if (contentRef.current) {
            contentRef.current.style.transition = 'none';
            contentRef.current.style.transform = `translateX(${goingLeft ? '60%' : '-60%'})`;
            contentRef.current.style.opacity = '0.5';
          }
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (contentRef.current) {
                contentRef.current.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out';
                contentRef.current.style.transform = 'translateX(0)';
                contentRef.current.style.opacity = '1';
              }
              setTimeout(() => {
                setIsAnimating(false);
                if (contentRef.current) {
                  contentRef.current.style.transition = '';
                  contentRef.current.style.transform = '';
                  contentRef.current.style.opacity = '';
                }
              }, 260);
            });
          });
        }, 200);
        return;
      }
    }

    // Snap back
    if (contentRef.current) {
      contentRef.current.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
      contentRef.current.style.transform = 'translateX(0)';
      contentRef.current.style.opacity = '1';
      setTimeout(() => {
        if (contentRef.current) {
          contentRef.current.style.transition = '';
          contentRef.current.style.transform = '';
          contentRef.current.style.opacity = '';
        }
      }, 220);
    }
  }, [isAnimating, activeTab, tabIds, setActiveTab]);

  const swipeHandlers = {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };

  return { contentRef, swipeHandlers, isAnimating, setIsAnimating };
};

export default useSwipeNavigation;
