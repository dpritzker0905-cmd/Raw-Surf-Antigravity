/**
 * A transient error burst must not cost the session its WebGL marine renderer (2026-09-26).
 *
 * Dev E2E run 36285144742: the Chrome burst at Sebastian z12 flipped `webglMarineFailed` and the
 * heatmap stayed gone for 22-30 s (the rest of the sampled window). The fallback is now bounded:
 * remount after a delay, at most `max` times, never undoing a forced fallback.
 */
import fs from 'fs';
import path from 'path';
import { renderHook, act } from '@testing-library/react';
import { useMarineWebglRecovery, MARINE_RECOVERY_DELAY_MS, MARINE_RECOVERY_MAX } from './useMarineWebglRecovery';

beforeEach(() => {
  jest.useFakeTimers();
  delete window.__MARINE_CHURN__;
  delete window.__FORCE_MARINE_FALLBACK__;
  localStorage.removeItem('force_marine_fallback');
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const churn = (kind) => ((window.__MARINE_CHURN__ && window.__MARINE_CHURN__.log) || []).filter((e) => e.kind === kind);

it('falls back at once and recovers the WebGL renderer after the delay', () => {
  const set = jest.fn();
  const { result } = renderHook(() => useMarineWebglRecovery(set));
  act(() => { result.current(); });
  expect(set.mock.calls).toEqual([[true]]);
  act(() => { jest.advanceTimersByTime(MARINE_RECOVERY_DELAY_MS - 1); });
  expect(set.mock.calls).toEqual([[true]]);
  act(() => { jest.advanceTimersByTime(1); });
  expect(set.mock.calls).toEqual([[true], [false]]);
  expect(churn('marine_webgl_recover').map((e) => e.attempt)).toEqual([1]);
});

it('a persistent error cannot loop: after max recoveries the session stays on the fallback', () => {
  const set = jest.fn();
  const { result } = renderHook(() => useMarineWebglRecovery(set));
  for (let i = 0; i < MARINE_RECOVERY_MAX + 2; i++) {
    act(() => { result.current(); });
    act(() => { jest.advanceTimersByTime(MARINE_RECOVERY_DELAY_MS); });
  }
  expect(set.mock.calls.filter(([v]) => v === false)).toHaveLength(MARINE_RECOVERY_MAX);
  expect(set.mock.calls[set.mock.calls.length - 1]).toEqual([true]);
});

it('errors while a recovery is pending schedule only one', () => {
  const set = jest.fn();
  const { result } = renderHook(() => useMarineWebglRecovery(set));
  act(() => { result.current(); result.current(); result.current(); });
  act(() => { jest.advanceTimersByTime(MARINE_RECOVERY_DELAY_MS); });
  expect(set.mock.calls.filter(([v]) => v === false)).toHaveLength(1);
});

it('never undoes a forced fallback', () => {
  localStorage.setItem('force_marine_fallback', 'true');
  const set = jest.fn();
  const { result } = renderHook(() => useMarineWebglRecovery(set));
  act(() => { result.current(); });
  act(() => { jest.advanceTimersByTime(MARINE_RECOVERY_DELAY_MS * 2); });
  expect(set.mock.calls).toEqual([[true]]);
});

it('a pending recovery does not fire after the map unmounts', () => {
  const set = jest.fn();
  const { result, unmount } = renderHook(() => useMarineWebglRecovery(set));
  act(() => { result.current(); });
  unmount();
  act(() => { jest.advanceTimersByTime(MARINE_RECOVERY_DELAY_MS * 2); });
  expect(set.mock.calls).toEqual([[true]]);
});

it('MapWebGL routes the marine onError through the bounded recovery', () => {
  const src = fs.readFileSync(path.join(__dirname, 'MapWebGL.js'), 'utf8');
  expect(src).toMatch(/const onMarineWebglError = useMarineWebglRecovery\(setWebglMarineFailed\);/);
  expect(src).toMatch(/onError=\{onMarineWebglError\}/);
});
