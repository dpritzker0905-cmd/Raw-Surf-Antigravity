/**
 * useVirtualList — Lightweight list virtualization hook.
 * Only renders items visible in the viewport + a buffer zone.
 * No external dependencies — pure React implementation.
 *
 * Usage:
 *   const { visibleItems, containerProps, totalHeight } = useVirtualList({
 *     items: posts,
 *     itemHeight: 400,
 *     overscan: 3,
 *     containerRef: scrollRef,
 *   });
 *
 *   return (
 *     <div ref={scrollRef} style={{ height: '100vh', overflow: 'auto' }}>
 *       <div style={{ height: totalHeight, position: 'relative' }}>
 *         {visibleItems.map(({ item, index, style }) => (
 *           <div key={index} style={style}><PostCard post={item} /></div>
 *         ))}
 *       </div>
 *     </div>
 *   );
 */
import { useState, useEffect, useCallback, useMemo } from 'react';

var useVirtualList = ({
  items = [],
  itemHeight = 300,
  overscan = 5,
  containerRef,
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Update on scroll
  const handleScroll = useCallback(() => {
    if (containerRef?.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, [containerRef]);

  // Observe container size
  useEffect(() => {
    const el = containerRef?.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    setContainerHeight(el.clientHeight);

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', handleScroll);
    };
  }, [containerRef, handleScroll]);

  const totalHeight = items.length * itemHeight;

  const visibleItems = useMemo(() => {
    if (!containerHeight || items.length === 0) return [];

    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );

    const result = [];
    for (let i = startIndex; i <= endIndex; i++) {
      result.push({
        item: items[i],
        index: i,
        style: {
          position: 'absolute',
          top: i * itemHeight,
          left: 0,
          right: 0,
          height: itemHeight,
        },
      });
    }
    return result;
  }, [items, itemHeight, scrollTop, containerHeight, overscan]);

  return {
    visibleItems,
    totalHeight,
    startIndex: visibleItems.length > 0 ? visibleItems[0].index : 0,
    endIndex: visibleItems.length > 0 ? visibleItems[visibleItems.length - 1].index : 0,
    isVirtualized: items.length > 50, // Only worthwhile for large lists
  };
};

export default useVirtualList;
