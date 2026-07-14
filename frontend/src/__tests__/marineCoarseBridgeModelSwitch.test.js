/**
 * Model-switch wash re-warm (2026-07-15).
 *
 * User report (online dev, ICON leg): "animations show, but the colored heatmap below isn't
 * showing" — FORENSIC-SNAP showed model:"ICON" with washBase:"GFS", washEngaged:false. Root:
 * blend-both requires a SAME-model coarse base, but the bridge-seed stager refused to stage
 * while ANY base existed — a stale other-model base blocked its own replacement forever, so the
 * wash stayed dead until the user zoomed far out and a world-coarse commit landed organically.
 * The gate now treats a base/pending whose (model, layer) identity mismatches the active pair
 * as absent.
 */
import { _stageCoarseBridgeSeed, _coarseBaseMatches } from '../components/map/marineController';

const worldGrid = (model, layer = 'waves') => ({
  __sourceModel: model, __componentLayer: layer,
  bounds: { west: -180, south: -80, east: 180, north: 85 },
  cols: 37, rows: 17, vectors: [{ lat: 0, lng: 0, speed: 1, direction: 90 }],
});

describe('coarse-bridge seed — model-switch staleness gate', () => {
  beforeEach(() => {
    window.__MARINE_ENGINE__ = { _coarseBaseData: null, _pendingCoarseBaseGrid: null };
    delete window.__RAW_DISABLE_COARSE_BRIDGE__;
    delete window.__MARINE_BRIDGE_SEED__;
  });
  afterEach(() => {
    delete window.__MARINE_ENGINE__;
    delete window.__RAW_DISABLE_COARSE_BRIDGE__;
  });

  it('matches on model+layer identity with GFS/waves defaults', () => {
    expect(_coarseBaseMatches({ __sourceModel: 'ICON', __componentLayer: 'waves' }, 'ICON', 'waves')).toBe(true);
    expect(_coarseBaseMatches({ __sourceModel: 'GFS', __componentLayer: 'waves' }, 'ICON', 'waves')).toBe(false);
    expect(_coarseBaseMatches({}, 'GFS', 'waves')).toBe(true);          // untagged legacy base = GFS/waves
    expect(_coarseBaseMatches(null, 'GFS', 'waves')).toBe(false);
  });

  it('stages when the engine has no base (the original cold-coast contract)', () => {
    _stageCoarseBridgeSeed(worldGrid('GFS'), 'GFS', 'waves', 'test');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid.__sourceModel).toBe('GFS');
  });

  it('STAGES over a stale other-model base (the ICON no-heatmap fix)', () => {
    window.__MARINE_ENGINE__._coarseBaseData = { __sourceModel: 'GFS', __componentLayer: 'waves' };
    _stageCoarseBridgeSeed(worldGrid('ICON'), 'ICON', 'waves', 'test');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid.__sourceModel).toBe('ICON');
  });

  it('does NOT stage over a matching base (no re-encode churn)', () => {
    window.__MARINE_ENGINE__._coarseBaseData = { __sourceModel: 'ICON', __componentLayer: 'waves' };
    _stageCoarseBridgeSeed(worldGrid('ICON'), 'ICON', 'waves', 'test');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeNull();
  });

  it('replaces a stale pending seed but never a matching one', () => {
    const pendingEuro = worldGrid('EURO');
    window.__MARINE_ENGINE__._pendingCoarseBaseGrid = pendingEuro;
    _stageCoarseBridgeSeed(worldGrid('ICON'), 'ICON', 'waves', 'test');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid.__sourceModel).toBe('ICON');

    const pendingIcon = window.__MARINE_ENGINE__._pendingCoarseBaseGrid;
    _stageCoarseBridgeSeed(worldGrid('ICON'), 'ICON', 'waves', 'test');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBe(pendingIcon); // deduped, not rebuilt
  });

  it('a layer switch is staleness too (same model, different layer)', () => {
    window.__MARINE_ENGINE__._coarseBaseData = { __sourceModel: 'GFS', __componentLayer: 'waves' };
    _stageCoarseBridgeSeed(worldGrid('GFS', 'swell_1'), 'GFS', 'swell_1', 'test');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid.__componentLayer).toBe('swell_1');
  });

  it('respects the kill switch', () => {
    window.__RAW_DISABLE_COARSE_BRIDGE__ = true;
    window.__MARINE_ENGINE__._coarseBaseData = { __sourceModel: 'GFS', __componentLayer: 'waves' };
    _stageCoarseBridgeSeed(worldGrid('ICON'), 'ICON', 'waves', 'test');
    expect(window.__MARINE_ENGINE__._pendingCoarseBaseGrid).toBeNull();
  });
});
