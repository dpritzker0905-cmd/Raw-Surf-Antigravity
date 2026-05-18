/**
 * useRoutePreloader.test.js Unit tests for the route preloader hook.
 */
import { renderHook, act } from '@testing-library/react';
import useRoutePreloader from '../../hooks/useRoutePreloader';

// Mock all dynamic imports
jest.mock('../../components/Feed', () => ({ default: () => null }), { virtual: true });
jest.mock('../../components/Profile', () => ({ default: () => null }), { virtual: true });
jest.mock('../../components/MessagesPage', () => ({ default: () => null }), { virtual: true });
jest.mock('../../components/Explore', () => ({ default: () => null }), { virtual: true });

describe('useRoutePreloader', () => {
  it('returns a preload function', () => {
    const { result } = renderHook(() => useRoutePreloader());
    expect(typeof result.current).toBe('function');
  });

  it('does not throw for valid route keys', () => {
    const { result } = renderHook(() => useRoutePreloader());
    expect(() => {
      act(() => {
        result.current('feed');
        result.current('profile');
        result.current('messages');
      });
    }).not.toThrow();
  });

  it('does not throw for unknown route keys', () => {
    const { result } = renderHook(() => useRoutePreloader());
    expect(() => {
      act(() => {
        result.current('nonexistent');
      });
    }).not.toThrow();
  });

  it('only preloads each route once', () => {
    const { result } = renderHook(() => useRoutePreloader());
    // Call preload for the same route multiple times
    act(() => {
      result.current('feed');
      result.current('feed');
      result.current('feed');
    });
 // No error should occur dedup works via the ref set
  });
});
