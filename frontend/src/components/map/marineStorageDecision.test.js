import { shouldRejectResolutionDowngrade, __resetRatingGraceForTests } from './marineEngineDecisions';
import { decideMarineCommit } from './marineCommitGate';
import { readMarineSurfMode } from './marineSurfMode';

const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
const grid = (bounds, cols, extra = {}) => ({ bounds, cols, rows: 17, vectors: [{ speed: 1 }], hourOffset: 6,
  __sourceModel: 'GFS', __componentLayer: 'waves', ...extra });
const resident = grid({ west: -82, south: 26, east: -78, north: 30 }, 17);
const incoming = grid({ west: -180, south: -80, east: 180, north: 85 }, 37);
const viewport = [-81, 27, -79, 29];

beforeEach(() => { delete window.__SURF_MODE__; __resetRatingGraceForTests(); });
afterEach(() => {
  Object.defineProperty(window, 'localStorage', descriptor);
  delete window.__SURF_MODE__;
  delete window.__RAW_MARINE_ARBITER__;
});

test.each(['getter', 'getItem'])('blocked %s preserves downgrade and cross-model decisions in both modes', failure => {
  const blocked = () => { throw new DOMException('blocked', 'SecurityError'); };
  Object.defineProperty(window, 'localStorage', { configurable: true, get: failure === 'getter' ? blocked : () => ({ getItem: blocked }) });
  expect(shouldRejectResolutionDowngrade(resident, incoming, 8.5, viewport, false, 0)).toBe(true);
  for (const arbiter of [false, true]) {
    window.__RAW_MARINE_ARBITER__ = arbiter;
    expect(decideMarineCommit(resident, incoming, 8.5, viewport, window, 0).reject).toBe(true);
    expect(decideMarineCommit(resident, { ...incoming, __sourceModel: 'EURO' }, 8.5, viewport, window, 0).reject).toBe(false);
  }
});

test.each([true, false])('explicit Surf Rating %s remains authoritative with storage denied', enabled => {
  window.__SURF_MODE__ = enabled;
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
  const rated = { ...resident, ratingMode: true };
  expect(shouldRejectResolutionDowngrade(rated, incoming, 8.5, viewport, false, 0)).toBe(enabled);
});

test.each(['true', 'false', null])('persisted Surf Rating %s is read when the runtime flag is absent', persisted => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: () => persisted } });
  expect(readMarineSurfMode()).toBe(persisted === 'true');
});

test('injected arbiter state reads its own preference rather than the ambient browser', () => {
  window.__SURF_MODE__ = false;
  const injected = { __RAW_MARINE_ARBITER__: true, localStorage: { getItem: () => 'true' } };
  expect(decideMarineCommit({ ...resident, ratingMode: true }, incoming, 8.5, viewport, injected, 0).reject).toBe(true);
});
