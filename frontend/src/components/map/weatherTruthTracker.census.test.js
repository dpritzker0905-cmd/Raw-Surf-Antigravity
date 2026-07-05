/**
 * Validity census in the truthTag (zoom-in cleared-rect forensics, 2026-07-05).
 *
 * The tracker's fallback truthTag constructor must report invalidCount/validZeroCount for BOTH
 * vector shapes that reach the engine: raw backend GridVectors (snake_case is_valid — series
 * frames) and mapper-rebuilt vectors (camelCase isOcean ONLY — the per-hour /grid path). A probe
 * that checks is_valid on mapper vectors misreads every land cell as "valid + speed 0.00"; these
 * counts make grid validity readable at every stage regardless of shape.
 */
import { recordTruthStage, resetTruthTracker } from './weatherTruthTracker';

function stageData(vectors) {
  return {
    model: 'GFS',
    domain: 'marine',
    layer: 'waves',
    valid_time: '2026-07-06T00:00:00Z',
    run_time: '2026-07-05T18:00:00Z',
    grid: {
      cols: 2,
      rows: 2,
      bounds: { west: -120, south: 33, east: -119.75, north: 33.25 },
      vectors,
    },
  };
}

function lastTruthTag() {
  const stages = window.__WEATHER_TRUTH_TRACE__.stages;
  return stages[stages.length - 1].truthTag;
}

describe('truthTag validity census', () => {
  beforeEach(() => resetTruthTracker('test'));

  it('counts is_valid:false and valid-zero on raw backend vectors (series-frame shape)', () => {
    recordTruthStage('mappedGrid', stageData([
      { lat: 33, lng: -120, speed: 1.2, direction: 200, u: 0.4, v: 1.1, is_valid: true },
      { lat: 33, lng: -119.75, speed: 0.0, direction: 0, u: 0, v: 0, is_valid: false },
      { lat: 33.25, lng: -120, speed: 0.0, direction: 0, u: 0, v: 0, is_valid: true },
      { lat: 33.25, lng: -119.75, speed: 0.9, direction: 210, u: 0.4, v: 0.8, is_valid: true },
    ]), 'test', 'test');
    const tag = lastTruthTag();
    expect(tag.invalidCount).toBe(1);
    expect(tag.validZeroCount).toBe(1);
    expect(tag.nonzeroCount).toBe(2);
  });

  it('counts isOcean:false as invalid on mapper-rebuilt vectors (per-hour /grid shape)', () => {
    recordTruthStage('mappedGrid', stageData([
      { lat: 33, lng: -120, speed: 1.2, direction: 200, u: 0.4, v: 1.1, isOcean: true },
      { lat: 33, lng: -119.75, speed: 0, direction: 0, u: 0, v: 0, isOcean: false },
      { lat: 33.25, lng: -120, speed: 0, direction: 0, u: 0, v: 0, isOcean: false },
      { lat: 33.25, lng: -119.75, speed: 0.9, direction: 210, u: 0.4, v: 0.8, isOcean: true },
    ]), 'test', 'test');
    const tag = lastTruthTag();
    expect(tag.invalidCount).toBe(2);
    expect(tag.validZeroCount).toBe(0);
  });

  it('reports zero counts on a fully valid, fully nonzero grid', () => {
    recordTruthStage('mappedGrid', stageData([
      { lat: 33, lng: -120, speed: 1.2, direction: 200, u: 0.4, v: 1.1, isOcean: true },
      { lat: 33, lng: -119.75, speed: 0.8, direction: 190, u: 0.1, v: 0.8, isOcean: true },
    ]), 'test', 'test');
    const tag = lastTruthTag();
    expect(tag.invalidCount).toBe(0);
    expect(tag.validZeroCount).toBe(0);
  });
});
