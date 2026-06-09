/**
 * useFocusTrap.test.js Tests for the focus trap hook.
 */
import { renderHook } from '@testing-library/react';
import useFocusTrap from '../hooks/useFocusTrap';

test('returns a ref object', () => {
  const { result } = renderHook(() => useFocusTrap(false));
  expect(result.current).toHaveProperty('current');
});

test('ref is initially null when inactive', () => {
  const { result } = renderHook(() => useFocusTrap(false));
  expect(result.current.current).toBeNull();
});
