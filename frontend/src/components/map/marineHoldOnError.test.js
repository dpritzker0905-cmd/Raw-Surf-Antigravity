import {
  shouldHoldFrameOnFetchError, isFetchFailureCommit,
} from './marineTransitionCoordinator';
import { createFallbackSafeZeroGrid } from './marineControllerCache';

// A backend OOM-kill: every fetch answers 502 (CORS-less -> the browser sees a rejected fetch). Each failed commit
// reaches the WebGLMarineLayer non-renderable branch; none may clear the resident frame.
describe('hold the last good frame on fetch errors', () => {
  const resident = { hasResident: true, hasUploadSignature: true };
  const win = () => ({});

  test('a 502 / reject sequence never asks for a clear', () => {
    const w = win();
    const sequence = [
      createFallbackSafeZeroGrid('GFS', 'http_502'),
      createFallbackSafeZeroGrid('GFS', 'net_TypeError'),
      createFallbackSafeZeroGrid('GFS', 'backend_fetch_failed'),
      { __provider: 'abort_recovery', __failureReason: 'abort_recovery_no_previous_data', __renderable: false },
      { grid: { __provider: 'fallback_safe_zero' }, __renderable: false },
    ];
    for (const data of sequence) {
      expect(shouldHoldFrameOnFetchError(data, resident, w)).toBe(true);
    }
    expect(w.__MARINE_ERROR_HOLD_COUNT__).toBe(sequence.length);
  });

  test('nothing to hold -> normal path; deliberate / renderable data is not an error hold', () => {
    const w = win();
    const failed = createFallbackSafeZeroGrid('GFS', 'http_502');
    expect(shouldHoldFrameOnFetchError(failed, { hasResident: false, hasUploadSignature: false }, w)).toBe(false);
    expect(shouldHoldFrameOnFetchError({ __unsupportedLayer: true, __renderable: false }, resident, w)).toBe(false);
    expect(shouldHoldFrameOnFetchError({ vectors: [1], __renderable: true, __provider: 'backend' }, resident, w)).toBe(false);
    expect(isFetchFailureCommit(null)).toBe(false);
  });

  test('kill switch restores the old behaviour', () => {
    const w = { __RAW_DISABLE_MARINE_HOLD_ON_ERROR__: true };
    expect(shouldHoldFrameOnFetchError(createFallbackSafeZeroGrid('GFS', 'http_502'), resident, w)).toBe(false);
  });
});
