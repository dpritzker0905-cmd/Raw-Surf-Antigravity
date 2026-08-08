/**
 * THE MAP'S LOADING GATE MUST WAIT ON SPOTS, NOT ON DECORATIONS.
 *
 * ⛔⛔ THE DEFECT. `loadMapData` was `Promise.all([fetchSurfSpots, fetchLivePhotographers,
 * fetchFeaturedPhotographers])` before clearing `loading`, and `MapPage` renders `<WaveLoader />`
 * — the full-screen "Loading Waves / Finding surf spots near you" splash — while `loading` is true.
 * So a slow `/live-photographers` or `/photographers/featured` held the ENTIRE map, including every
 * control, behind a loading screen for as long as it took: up to `apiClient`'s 60 s timeout. Both
 * are decorative overlays that render independently the instant their own state arrives.
 *
 * ⭐ HOW IT WAS FOUND, and the part worth keeping: the E2E gate at `weather-simulation.spec.js:358`
 * had been timing out on a map control in 8 of the last 9 CI runs. The Playwright error context
 * showed the page was NOT redirected and NOT erroring — it was authenticated, on `/map`, and
 * sitting on that splash for the full 45 s. Three earlier attempts had treated it as a test-timing
 * problem and raised the bound (15 s → 45 s); the page snapshot is what turned it into an
 * application finding.
 *
 * ⚠️ WHAT THIS DOES NOT CLAIM. The CI failure is intermittent and was never reproduced
 * deterministically — measured 2026-08-07, an isolated `/map` load reached the control in 1.9-3.1 s
 * over 6 of 6 runs, all three endpoints answer in 0.7-3.1 s warm, and the two map specs pass in
 * sequence locally. This narrows the exposed surface from three requests to one; it is not proof
 * that the flake is gone.
 */
import { renderHook, waitFor } from '@testing-library/react';

jest.mock('../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));
jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import apiClient from '../lib/apiClient';
import { useMapData } from './useMapData';

const SPOT = { id: 's1', latitude: 30.1, longitude: -85.2, name: 'Test Break' };

/** Spots answer immediately; both photographer overlays hang until the test releases them. */
function routeWithHangingOverlays() {
  const released = { live: null, featured: null };
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/surf-spots')) return Promise.resolve({ data: [SPOT] });
    if (url.startsWith('/live-photographers')) {
      return new Promise((res) => { released.live = () => res({ data: [] }); });
    }
    if (url.startsWith('/photographers/featured')) {
      return new Promise((res) => { released.featured = () => res({ data: [] }); });
    }
    return Promise.resolve({ data: [] });
  });
  return released;
}

beforeEach(() => jest.clearAllMocks());

it('clears loading as soon as the SPOTS arrive, while both overlays are still in flight', async () => {
  const released = routeWithHangingOverlays();
  const { result } = renderHook(() => useMapData('u1', null));

  expect(result.current.loading).toBe(true);          // the splash is up at mount

  await waitFor(() => expect(result.current.loading).toBe(false));

  // ⭐ THE ASSERTION THAT WOULD HAVE CAUGHT IT: neither overlay has resolved, and the map is
  // already usable. Under the old `Promise.all` this line could not be reached — `loading` stayed
  // true until BOTH of these were released, i.e. until a hung decoration timed out.
  expect(released.live).toBeInstanceOf(Function);
  expect(released.featured).toBeInstanceOf(Function);
  expect(result.current.surfSpots).toHaveLength(1);
});

it('still delivers the overlays once they arrive — ungating is not dropping them', async () => {
  const released = routeWithHangingOverlays();
  const { result } = renderHook(() => useMapData('u1', null));
  await waitFor(() => expect(result.current.loading).toBe(false));

  released.live();
  released.featured();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/photographers/featured'));
  expect(apiClient.get).toHaveBeenCalledWith('/live-photographers');
});

it('a hung SPOTS fetch DOES still hold the splash — the gate did not become vacuous', async () => {
  /** ⛔ THE CONTROL. If this passed with `loading` false, the fix would have removed the gate
   *  rather than narrowed it, and the map would flash an empty world before its spots existed. */
  let releaseSpots;
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/surf-spots')) {
      return new Promise((res) => { releaseSpots = () => res({ data: [SPOT] }); });
    }
    return Promise.resolve({ data: [] });
  });

  const { result } = renderHook(() => useMapData('u1', null));
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/live-photographers'));
  expect(result.current.loading).toBe(true);          // overlays done, spots still pending

  releaseSpots();
  await waitFor(() => expect(result.current.loading).toBe(false));
});
