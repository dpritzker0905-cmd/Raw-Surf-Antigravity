/**
 * A DEAD /surf-spots MUST BE VISIBLE.
 *
 * ⛔ THE DEFECT. `fetchSurfSpots` retried on a ladder of [1500, 3000, 6000, 12000] and, when that
 * ran out, called `logger.error` and nothing else. No error state, no user-facing signal. So a
 * broken spots endpoint looked exactly like a working one: the map kept whatever spots it already
 * had — possibly a STALE service-worker cache, which is the "only Central FL spots show worldwide"
 * report the ladder exists for — or none at all, and never gave the user a reason to reload.
 * Combined with the then-60s request timeout, that was ~22.5s of retry delay plus five request
 * timeouts of silence.
 *
 * ⭐ WHAT IS ASSERTED. Two things, and they are separable: (1) exhausting the retries now sets
 * `spotsError` AND toasts, and (2) recovery clears both, and re-arms the toast edge so a LATER
 * outage is not swallowed by the first one's dedupe flag. (2) matters because this fetch also runs
 * on a 30s poll — a flag that latches on forever would silence every subsequent outage.
 *
 * ⚠️ NOT ASSERTED. The retry ladder's own timing. These tests drive it with fake timers rather than
 * waiting out real delays, so they prove the exhaustion PATH, not that the delays are well chosen.
 */
import { renderHook, waitFor, act } from '@testing-library/react';

jest.mock('../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));
jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import { useMapData } from './useMapData';

const SPOT = { id: 's1', latitude: 30.1, longitude: -85.2, name: 'Test Break' };

/** Spots always reject; overlays resolve empty so they never interfere. */
function routeWithFailingSpots() {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/surf-spots')) return Promise.reject(new Error('boom'));
    return Promise.resolve({ data: [] });
  });
}

/** Drain the retry ladder: advance past every backoff delay, flushing microtasks between each. */
async function drainRetries() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it('surfaces an error and toasts once the retry ladder is exhausted', async () => {
  routeWithFailingSpots();
  const { result } = renderHook(() => useMapData('u1', null));

  await drainRetries();

  await waitFor(() => expect(result.current.spotsError).toBeTruthy());
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error.mock.calls[0][0]).toMatch(/surf spots/i);
});

it('clears the error on recovery and re-arms the toast for a LATER outage', async () => {
  routeWithFailingSpots();
  const { result } = renderHook(() => useMapData('u1', null));
  await drainRetries();
  await waitFor(() => expect(result.current.spotsError).toBeTruthy());
  expect(toast.error).toHaveBeenCalledTimes(1);

  // Recover.
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/surf-spots')) return Promise.resolve({ data: [SPOT] });
    return Promise.resolve({ data: [] });
  });
  await act(async () => { await result.current.fetchSurfSpots(); });
  await waitFor(() => expect(result.current.spotsError).toBeNull());
  expect(result.current.surfSpots).toHaveLength(1);

  // Break it again -- the second outage must NOT be swallowed by the first one's dedupe flag.
  routeWithFailingSpots();
  await act(async () => { await result.current.fetchSurfSpots(); });
  await drainRetries();
  await waitFor(() => expect(result.current.spotsError).toBeTruthy());
  expect(toast.error).toHaveBeenCalledTimes(2);
});
