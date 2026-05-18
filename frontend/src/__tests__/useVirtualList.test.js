/**
 * useVirtualList.test.js Unit tests for list virtualization hook.
 */
import { renderHook } from '@testing-library/react';
import useVirtualList from '../../hooks/useVirtualList';

describe('useVirtualList', () => {
  it('returns empty visibleItems for empty items', () => {
    const containerRef = { current: null };
    const { result } = renderHook(() => useVirtualList({
      items: [],
      itemHeight: 100,
      containerRef,
    }));

    expect(result.current.visibleItems).toEqual([]);
    expect(result.current.totalHeight).toBe(0);
  });

  it('calculates correct totalHeight', () => {
    const containerRef = { current: null };
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const { result } = renderHook(() => useVirtualList({
      items,
      itemHeight: 50,
      containerRef,
    }));

    expect(result.current.totalHeight).toBe(5000); // 100 * 50
  });

  it('reports isVirtualized correctly', () => {
    const containerRef = { current: null };
    
 // 10 items not worth virtualizing
    const { result: small } = renderHook(() => useVirtualList({
      items: Array(10).fill({}),
      itemHeight: 100,
      containerRef,
    }));
    expect(small.current.isVirtualized).toBe(false);

 // 100 items worth virtualizing
    const { result: large } = renderHook(() => useVirtualList({
      items: Array(100).fill({}),
      itemHeight: 100,
      containerRef,
    }));
    expect(large.current.isVirtualized).toBe(true);
  });
});
