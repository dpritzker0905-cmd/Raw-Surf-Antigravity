/**
 * usePullToRefresh.test.js Tests for the pull-to-refresh hook.
 */
import { renderHook } from '@testing-library/react-hooks';
import usePullToRefresh from '../hooks/usePullToRefresh';

test('initializes with correct defaults', () => {
  const onRefresh = jest.fn();
  const { result } = renderHook(() => usePullToRefresh(onRefresh));
  
  expect(result.current.isPulling).toBe(false);
  expect(result.current.pullProgress).toBe(0);
  expect(result.current.isRefreshing).toBe(false);
  expect(result.current.pullRef).toBeDefined();
});

test('does not trigger when disabled', () => {
  const onRefresh = jest.fn();
  const { result } = renderHook(() => usePullToRefresh(onRefresh, { enabled: false }));
  
  expect(result.current.isPulling).toBe(false);
  expect(onRefresh).not.toHaveBeenCalled();
});
