/**
 * useOptimisticAction.test.js — Unit tests for the optimistic UI hook.
 */
import { renderHook, act } from '@testing-library/react';
import useOptimisticAction from '../../hooks/useOptimisticAction';

// Mock sonner toast
jest.mock('sonner', () => ({
  toast: { error: jest.fn() }
}));

describe('useOptimisticAction', () => {
  it('returns a function', () => {
    const { result } = renderHook(() => useOptimisticAction());
    expect(typeof result.current).toBe('function');
  });

  it('calls onOptimistic immediately', async () => {
    const { result } = renderHook(() => useOptimisticAction());
    const onOptimistic = jest.fn();
    const action = jest.fn().mockResolvedValue(undefined);

    await act(async () => {
      await result.current({ action, onOptimistic });
    });

    expect(onOptimistic).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('calls onRollback when action fails', async () => {
    const { result } = renderHook(() => useOptimisticAction());
    const onOptimistic = jest.fn();
    const onRollback = jest.fn();
    const action = jest.fn().mockRejectedValue(new Error('fail'));

    await act(async () => {
      await result.current({ action, onOptimistic, onRollback, errorMessage: 'Test error' });
    });

    expect(onOptimistic).toHaveBeenCalledTimes(1);
    expect(onRollback).toHaveBeenCalledTimes(1);
  });

  it('deduplicates rapid calls with same key', async () => {
    const { result } = renderHook(() => useOptimisticAction());
    const action = jest.fn().mockImplementation(() => new Promise(r => setTimeout(r, 100)));
    const onOptimistic = jest.fn();

    // Fire two rapid calls with same key
    await act(async () => {
      result.current({ action, onOptimistic, key: 'like-1' });
      result.current({ action, onOptimistic, key: 'like-1' });
    });

    // Wait for the first action to complete
    await act(async () => {
      await new Promise(r => setTimeout(r, 150));
    });

    // Only one should execute (deduplicated)
    expect(action).toHaveBeenCalledTimes(1);
  });
});
