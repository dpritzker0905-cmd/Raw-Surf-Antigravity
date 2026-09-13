import { recordMarineDemand } from './marineDemandEvidence';

const map = () => ({ getBounds: () => ({ getWest: () => -84, getSouth: () => 26, getEast: () => -76, getNorth: () => 30 }),
  getZoom: () => 6.666, isMoving: () => false, isZooming: () => false });
beforeEach(() => { delete window.__RAW_DEMAND_EVIDENCE__; delete window.__RAW_CAPTURE_OPACITY__; delete window.__MARINE_ENGINE__; });
afterEach(() => { delete window.__RAW_DEMAND_EVIDENCE__; delete window.__RAW_CAPTURE_OPACITY__; delete window.__MARINE_ENGINE__; });

it('does not inspect supplied objects or allocate a store while disabled', () => {
  const poison = new Proxy({}, { get: () => { throw Error('must not be read'); } });
  expect(recordMarineDemand('update', 'moveend', poison, poison, poison)).toBeNull();
  expect(window.__RAW_DEMAND_EVIDENCE__).toBeUndefined();
});
it('links dispatch and completion to an attempt and snapshots values without retaining input objects', () => {
  window.__RAW_CAPTURE_OPACITY__ = true;
  const locks = { isFetching: true, fetchStartedAt: 123, lastTime: 0, activeSource: 'moveend', token: 'secret' };
  const intent = { model: 'GFS', layer: 'waves', hour: 0, surf: false, bounds: { west: -84, south: 26, east: -76, north: 30 }, zoom: 6.666, headers: 'secret' };
  const attempt = recordMarineDemand('update', 'moveend', map(), locks, intent);
  recordMarineDemand('dispatch', 'moveend', map(), locks, { attempt, requestId: 12, intent });
  locks.isFetching = false; intent.bounds.west = -100;
  recordMarineDemand('exit', 'moveend', map(), locks, { attempt, requestId: 12, phase: 'fetch', status: 'success' });
  const s = window.__RAW_DEMAND_EVIDENCE__;
  expect(s.events).toHaveLength(3);
  expect(s.events[1]).toMatchObject({ attempt, requestId: 12, t: expect.any(Number), utcMs: expect.any(Number),
    locks: { fetching: true }, target: { model: 'GFS', hour: 0, bounds: [-84, 26, -76, 30] } });
  expect(s.events[2].locks.fetching).toBe(false);
  expect(JSON.stringify(s)).not.toContain('secret');
});
it('copies grid dimensions and forecast times, never vectors or arbitrary metadata', () => {
  window.__RAW_CAPTURE_OPACITY__ = true;
  const grid = { cols: 17, rows: 17, __sourceModel: 'GFS', model_run_time: '2026-09-12T06:00:00Z',
    served_valid_time: '2026-09-12T21:00:00Z', vectors: [{ secret: 'secret' }], token: 'secret' };
  window.__MARINE_ENGINE__ = { _waveData: { waveGrid: grid } };
  recordMarineDemand('resolved', 'moveend', map(), null, { grid });
  grid.cols = 2;
  const event = window.__RAW_DEMAND_EVIDENCE__.events[0];
  expect(event.incoming).toMatchObject({ cols: 17, cycle: '2026-09-12T06:00:00Z', served: '2026-09-12T21:00:00Z' });
  expect(event.resident.cols).toBe(17);
  expect(JSON.stringify(event)).not.toMatch(/secret|vectors|token/);
});
it('counts overflow while retaining the latest bounded interval', () => {
  window.__RAW_CAPTURE_OPACITY__ = true;
  for (let i = 0; i < 2003; i++) recordMarineDemand('enqueue', 'moveend', null, null);
  const s = window.__RAW_DEMAND_EVIDENCE__;
  expect(s).toMatchObject({ seen: 2003, dropped: 3, errors: 0 });
  expect(s.events).toHaveLength(2000);
  expect(Math.min(...s.events.map(e => e.id))).toBe(4);
  expect(Math.max(...s.events.map(e => e.id))).toBe(2003);
});
it('cannot break the scheduler when a diagnostic read throws; missing inputs remain unknown', () => {
  window.__RAW_CAPTURE_OPACITY__ = true;
  expect(recordMarineDemand('update', 'moveend', { getBounds: () => { throw Error('secret'); } }, null)).toBeNull();
  recordMarineDemand('update', 'https://private/?secret', null, null);
  expect(window.__RAW_DEMAND_EVIDENCE__.errors).toBe(1);
  expect(window.__RAW_DEMAND_EVIDENCE__.events[0]).toMatchObject({ source: null, zoom: null, viewport: null });
  expect(JSON.stringify(window.__RAW_DEMAND_EVIDENCE__)).not.toContain('secret');
});
