/**
 * The engine's seed consume asks the HOUR too (2026-10-01, audit F-21; marineStaleHour.js).
 *
 * The staged zoom-out seed replaces the engine's coarse base only when the base is "stale for the seed". Until 2026-10-01 that was
 * identity only (no base, another model, another layer), so the right-hour seed was DISCARDED for as long as the page-load world
 * frame (the "now" hour) was held, and the bridge promoted the wrong hour. The rule itself is pinned in marineStaleHour.test.js; the
 * engine cannot be mounted without a GL context, so its CALL SITE is pinned in source (the same method as
 * WebGLMarineEngine.scopeIntegrity.test.js), plus the one behavioural fact the call site depends on: the rule is fed the engine's own
 * `_coarseBaseData` wrapper and a raw grid, and must read the hour from both.
 */
import fs from 'fs';
import path from 'path';
import { coarseBaseStaleForSeed } from './marineCommitGate';

const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineEngine.js'), 'utf8');
const WORLD = { west: -180, south: -80, east: 180, north: 85 };

describe('WebGLMarineEngine seed consume', () => {
  it('imports the hour-aware rule from the commit lane', () => {
    expect(src).toMatch(/import \{[^}]*\bcoarseBaseStaleForSeed\b[^}]*\} from '\.\/marineCommitGate';/);
  });

  it('decides "stale" with the rule, and the identity-only expression is gone', () => {
    expect(src).toMatch(/const _stale = coarseBaseStaleForSeed\(_b, _seed\);/);
    expect(src).not.toMatch(/const _stale = !_b \|\|/);
    expect(src).not.toMatch(/\(_b\.__sourceModel \|\| 'GFS'\) !== \(_seed\.__sourceModel \|\| 'GFS'\)/);
  });

  it('consumes the seed in the render loop, right after reading the held base (the order the rule relies on)', () => {
    const at = src.indexOf('if (this._pendingCoarseBaseGrid) {');
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, at + 600);
    expect(block.indexOf('const _seed = this._pendingCoarseBaseGrid;')).toBeGreaterThan(-1);
    expect(block.indexOf('const _b = this._coarseBaseData;')).toBeGreaterThan(block.indexOf('const _seed'));
    expect(block.indexOf('coarseBaseStaleForSeed(_b, _seed)')).toBeGreaterThan(block.indexOf('const _b'));
    expect(block.indexOf('this._pendingCoarseBaseGrid = null;')).toBeGreaterThan(block.indexOf('coarseBaseStaleForSeed'));
  });

  it('the per-frame bridge hands its decision the layer\'s selected instant (set only while a stale world frame is drawn), on the call it always made', () => {
    expect(src).toMatch(/shouldBridgeToCoarseGlobal\(rwg, cbg, this\._lastZoom, this\._lastViewportBounds,\s*\r?\n\s*typeof window !== 'undefined' \? window : undefined, this\.__staleSwapMs\)\) return false;/);
    // ...and the bridge is still asked every frame while a base is held (the swap rides that call: nothing else would ask it)
    expect(src).toMatch(/if \(this\._coarseBaseData && this\._coarseBaseData\.waveGrid && !this\._pendingDowngrade\) \{\s*\r?\n\s*this\.bridgeToCoarseGlobalIfHeld\(gl\);/);
  });

  it('the shapes the call site passes: the held base is the engine\'s wrapper, the seed a raw grid; both carry the hour', () => {
    const held = { __sourceModel: 'GFS', __componentLayer: 'waves', waveGrid: { bounds: WORLD, valid_time: '2026-10-01T12:00:00Z' } };
    const seed = { bounds: WORLD, cols: 181, rows: 82, valid_time: '2026-10-07T15:00:00Z', __sourceModel: 'GFS', __componentLayer: 'waves' };
    expect(coarseBaseStaleForSeed(held, seed)).toBe(true);              // the wrong-hour base is replaced
    expect(coarseBaseStaleForSeed({ ...held, waveGrid: { ...held.waveGrid, valid_time: seed.valid_time } }, seed)).toBe(false);
  });
});
