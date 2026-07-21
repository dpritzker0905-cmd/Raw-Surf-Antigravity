/**
 * marineGridSeries resource-leak fixes (2026-07-21, adversarial hunt defects #1/#3).
 *
 * #1: loadSeriesPage/loadSeriesHour0 registered `signal.addEventListener('abort', ...)` on the LONG-LIVED
 *     caller signal (one AbortController per model+layer+map, reused for the whole session) but never
 *     removed it — so a pan/scrub session accumulated hundreds of listeners + retained AbortControllers.
 *     Fixed by removing the named handler in the finally (behaviour-neutral: a post-settle abort has
 *     nothing left to cancel). This suite proves net-zero listener accumulation.
 * #3: the coarse-reval / warming / fail-retry setTimeout ids were added to _idleTimers but never removed
 *     on fire (armIdleTimer now self-deletes) — not directly assertable here (module-scoped Set), covered
 *     by the same self-delete pattern as scheduleIdlePrefetch.
 */
jest.mock('../../lib/apiClient', () => ({ API_BASE: '' }));
jest.mock('./backendWeatherServiceClient', () => ({ getSurfModeFlag: () => false }));
jest.mock('./weatherTruthTracker', () => ({ buildTruthTag: () => null, recordTruthStage: () => {} }));

import { ensureMarineSeries, _resetMarineSeriesForTest } from './marineGridSeries';

const BOUNDS = { west: -81, south: 27, east: -80, north: 28 };
const okResp = () => ({
  ok: true,
  status: 200,
  json: async () => ({ frames: [{ hour_offset: 0, cols: 1, rows: 1, bounds: { west: -81, south: 27, east: -80, north: 28 },
    vectors: [{ lat: 27.5, lng: -80.5, u: 0, v: -1, speed: 1, direction: 0, period: 8 }] }] }),
});

// A caller signal that TRACKS its live 'abort' listeners so we can assert net-zero after a settled load.
function makeTrackedSignal() {
  const live = new Set();
  return {
    aborted: false,
    addEventListener: (type, fn) => { if (type === 'abort') live.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'abort') live.delete(fn); },
    liveCount: () => live.size,
  };
}

async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

describe('marineGridSeries caller-signal listener leak fix (#1)', () => {
  beforeEach(() => {
    window.__RAW_DISABLE_HOUR0_FIRST__ = true; // isolate the page lane
    window.__MARINE_SERIES__ = true;
    window.__MARINE_SERIES_DIAG__ = { loads: 0, hits: 0, misses: 0 };
    _resetMarineSeriesForTest();
    global.fetch = async () => okResp();
  });
  afterEach(() => { delete global.fetch; delete window.__RAW_DISABLE_HOUR0_FIRST__; });

  it('a settled loadSeriesPage leaves ZERO live abort listeners on the caller signal', async () => {
    const sig = makeTrackedSignal();
    await ensureMarineSeries('GFS', 'waves', BOUNDS, 0, sig, true);
    await flush();
    expect(sig.liveCount()).toBe(0);
  });

  it('repeated forced loads on the SAME signal do not accumulate listeners', async () => {
    const sig = makeTrackedSignal();
    for (let n = 0; n < 6; n++) {
      await ensureMarineSeries('GFS', 'waves', BOUNDS, 0, sig, true, true); // force re-fetch
      await flush();
    }
    expect(sig.liveCount()).toBe(0); // net-zero — was monotonically growing before the fix
  });

  it('the abort handler IS registered during the in-flight window (guard still works)', async () => {
    const sig = makeTrackedSignal();
    let peak = 0;
    global.fetch = async () => { peak = Math.max(peak, sig.liveCount()); return okResp(); };
    await ensureMarineSeries('GFS', 'waves', BOUNDS, 0, sig, true);
    await flush();
    expect(peak).toBeGreaterThanOrEqual(1); // listener present while fetching (abort still cancels)
    expect(sig.liveCount()).toBe(0);        // ...and removed once settled
  });
});
