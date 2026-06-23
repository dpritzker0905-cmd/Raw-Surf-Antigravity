/**
 * coordinator.parity.viewport.test.js
 *
 * Completes the transition coordinator's parity comparison with VIEWPORT awareness
 * (the long-deferred "viewportKey in displayMatchesRequested" item).
 *
 * Done by bounds CONTAINMENT, not viewport-key equality: the orchestrator feeds beginTransition
 * a `getViewportHash` that is `toFixed(2)` precise, so a key-equality parity gate would flip off
 * on every micro-pan even while a valid grid is on screen. Containment instead asks the real
 * question — does the frame currently on screen actually cover the requested point? — which is
 * immune to micro-pans and only vetoes a genuinely different-region held frame.
 */
import {
  markDisplayed,
  displayMatchesRequested,
  __resetForTests,
} from '../components/map/marineTransitionCoordinator';

const FLORIDA = { west: -85, east: -79, south: 24, north: 31 };
const GLOBAL = { west: -180, east: 180, south: -80, north: 80 };

beforeEach(() => { __resetForTests(); });

describe('displayMatchesRequested — model/layer/hour (unchanged)', () => {
  test('matches when model+layer+hour agree', () => {
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 12, bounds: FLORIDA });
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 12 })).toBe(true);
  });

  test('vetoes a model mismatch (no relabeling a held layer/model)', () => {
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 12, bounds: FLORIDA });
    expect(displayMatchesRequested({ model: 'ICON', layer: 'waves', hour: 12 })).toBe(false);
  });

  test('vetoes an hour mismatch only when an hour is supplied', () => {
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 12, bounds: FLORIDA });
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 24 })).toBe(false);
    // hour omitted → not compared
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves' })).toBe(true);
  });
});

describe('displayMatchesRequested — viewport containment', () => {
  test('holds parity when the requested point is INSIDE the displayed grid bounds', () => {
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 0, bounds: FLORIDA });
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 0, lat: 27, lng: -82 })).toBe(true);
  });

  test('VETOES parity when the requested point is OUTSIDE the displayed grid bounds', () => {
    // Held Florida frame; user is now looking at the Pacific — must not relabel Florida data.
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 0, bounds: FLORIDA });
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 0, lat: 20, lng: -150 })).toBe(false);
  });

  test('does not churn on a micro-pan (point a hair inside the eps tolerance)', () => {
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 0, bounds: FLORIDA });
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 0, lat: 31.0005, lng: -79.0005 })).toBe(true);
  });

  test('a GLOBAL displayed grid is never vetoed (covers any point)', () => {
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 0, bounds: GLOBAL });
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 0, lat: 20, lng: -150 })).toBe(true);
  });
});

describe('displayMatchesRequested — backward compatibility (containment is opt-in)', () => {
  test('no point supplied → containment skipped, model/layer/hour parity stands', () => {
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 0, bounds: FLORIDA });
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 0 })).toBe(true);
  });

  test('frame recorded without bounds → containment skipped even with a point', () => {
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 0 }); // legacy: no bounds
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 0, lat: 20, lng: -150 })).toBe(true);
  });

  test('still false when nothing has been displayed yet', () => {
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 0, lat: 27, lng: -82 })).toBe(false);
  });
});
