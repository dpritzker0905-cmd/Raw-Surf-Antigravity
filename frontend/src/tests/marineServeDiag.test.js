/**
 * The serve-coverage diagnostic's published CONTRACT (2026-08-09 split).
 *
 * `marineController.js` hit 853 LOC against a hard 800 ceiling, so it splits by lane; this block was
 * the first cut because it is pure instrumentation. The extraction's risk is NOT logic — it is the
 * SHAPE of `window.__MARINE_SERVE_DIAG__`, because nothing imports it: two probes
 * (`scripts/live_session_diagnostic.js`, `scripts/probe_wind_zoomburst.js`) read the global at
 * runtime. A renamed key does not fail a build; the probe silently reads `undefined` and reports it
 * as a value. These tests are the only thing standing between a rename and a lying instrument.
 */
import { publishServeDiag } from '../components/map/marineServeDiag';

const VIEWPORT = { west: -81, south: 27, east: -80, north: 28 };
const META = { cacheSource: 'per_model_hour_cache_exact', model: 'GFS', layer: 'waves', hour: 0 };
const hit = (bounds) => ({ grid: bounds ? { bounds } : {} });

// Exactly the keys the two probes read. Adding is safe; renaming is not.
const CONTRACT = ['cacheSource', 'model', 'layer', 'hour', 'gridWidth', 'coversViewport',
  'gridBounds', 'viewport', 'ts'];

describe('publishServeDiag — the global contract two probes depend on', () => {
  beforeEach(() => { delete window.__MARINE_SERVE_DIAG__; });

  it('publishes every key the probes read', () => {
    publishServeDiag(hit({ west: -82, south: 26, east: -79, north: 29 }), VIEWPORT, META);
    expect(Object.keys(window.__MARINE_SERVE_DIAG__).sort()).toEqual([...CONTRACT].sort());
  });

  it('a covering grid reads coversViewport true, with its width', () => {
    publishServeDiag(hit({ west: -82, south: 26, east: -79, north: 29 }), VIEWPORT, META);
    const d = window.__MARINE_SERVE_DIAG__;
    expect(d.coversViewport).toBe(true);
    expect(d.gridWidth).toBeCloseTo(3, 6);
    expect(d.cacheSource).toBe('per_model_hour_cache_exact');
  });

  it('a sub-viewport grid reads FALSE — the heatmap-clamp signature', () => {
    publishServeDiag(hit({ west: -80.5, south: 27.2, east: -80.2, north: 27.5 }), VIEWPORT, META);
    expect(window.__MARINE_SERVE_DIAG__.coversViewport).toBe(false);
  });

  it('⛔ NO BOUNDS => gridWidth NULL, which means NOT MEASURED, never "does not cover"', () => {
    // A consumer that reads null as false invents a clamp. Measured 2026-08-09: unknown-coverage
    // windows of 1s/24s/33s/95s across four live sessions, all from serves with no grid bounds.
    publishServeDiag(hit(null), VIEWPORT, META);
    const d = window.__MARINE_SERVE_DIAG__;
    expect(d.gridWidth).toBeNull();
    expect(d.coversViewport).toBeNull();
    expect(d.coversViewport).not.toBe(false);
  });

  it('an antimeridian-spanning grid computes a positive width', () => {
    publishServeDiag(hit({ west: 170, south: -10, east: -170, north: 10 }),
      { west: 175, south: -5, east: 179, north: 5 }, META);
    expect(window.__MARINE_SERVE_DIAG__.gridWidth).toBeCloseTo(20, 6);
  });

  it('publishes NOTHING when there is no hit or no viewport — absence is not a zero', () => {
    publishServeDiag(null, VIEWPORT, META);
    expect(window.__MARINE_SERVE_DIAG__).toBeUndefined();
    publishServeDiag(hit({ west: -82, south: 26, east: -79, north: 29 }), null, META);
    expect(window.__MARINE_SERVE_DIAG__).toBeUndefined();
  });

  it('★ never throws — a diagnostic must not break the serve it observes', () => {
    expect(() => publishServeDiag({ get grid() { throw new Error('boom'); } }, VIEWPORT, META))
      .not.toThrow();
  });
});
