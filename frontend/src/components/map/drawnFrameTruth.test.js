/**
 * DRAWN TRUTH (2026-10-24): the status line must describe what the map draws (the verify matrix's step-to-h2 frame: a stored
 * frame drawn under the selected hour with no words). Reproduced offline at a pilot tile's edge (scn_drawn_honesty, the stored
 * tile serving in-box): a 03Z stored frame labelled +2 h and a series frame of the next hour, both with an empty status line.
 *  - LABEL INSTANT (drawnFrameReadout): compare the drawn data with the selection's own instant, not the snapped ask.
 *  - SERVED TIME (marineDrawnFrame + the useMarineWindData conform): a /grid frame keeps its served time for the record.
 *  - ENGINE TRUTH (marineDrawnFrame + WebGLMarineLayer + WebGLMarineCustomLayer): the record follows what the engine HOLDS.
 */
import fs from 'fs';
import path from 'path';
import { describeDrawnFrame } from './drawnFrameReadout';
import { _resetMarineDrawnForTest, engineHoldsGrid, getMarineDrawn, publishMarineDrawn, syncDrawnToEngine } from './marineDrawnFrame';

const A = Date.UTC(2026, 9, 25, 2, 0, 0);   // the series anchor (round(now))
const H = 3600000;
const KILLS = ['__RAW_DISABLE_DRAWN_LABEL_INSTANT__', '__RAW_DISABLE_DRAWN_SERVED_TIME__', '__RAW_DISABLE_DRAWN_ENGINE_TRUTH__'];
afterEach(() => { KILLS.forEach((k) => { delete window[k]; }); _resetMarineDrawnForTest(); });

const sel = (hour, snappedMs) => ({ model: 'GFS', layer: 'waves', hour, labelMs: A + hour * H, instantMs: snappedMs, nearestMaxHours: 1 });
const drawnAt = (hour, dataMs) => ({ model: 'GFS', layer: 'waves', hour, dataMs });

describe('LABEL INSTANT: a stand-in is described against the selection, not the ask it was snapped to', () => {
  it('a 3-hourly stored frame under the hour between (the ask was snapped to it): "nearest", never silent', () => {
    const r = describeDrawnFrame(sel(2, A + H), drawnAt(2, A + H));       // selected 04Z, the ask snapped to the 03Z product
    expect(r && r.state).toBe('nearest');
    expect(r.text).toMatch(/the nearest stored forecast/);
  });

  it('a series frame from the next hour (the edge run, step 3): "nearest"', () => {
    expect(describeDrawnFrame(sel(3, A + 4 * H), drawnAt(4, A + 4 * H)).state).toBe('nearest');
  });

  it('a resident 2 h behind the selection: "Loading <selection>… still showing <drawn>", worded on one clock', () => {
    const r = describeDrawnFrame(sel(2, A + H), drawnAt(0, A));
    expect(r.state).toBe('pending');
    const fmt = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' });
    expect(r.text).toBe(`Loading ${fmt(A + 2 * H)}… still showing ${fmt(A)}`);
  });

  it('the exact frame (an hourly series frame at the selection) needs no words; EURO past 144 h keeps its 3 h window', () => {
    expect(describeDrawnFrame(sel(5, A + 6 * H), drawnAt(5, A + 5 * H))).toBeNull();
    const euro = { model: 'EURO', layer: 'waves', hour: 150, labelMs: A + 150 * H, instantMs: A + 150 * H, nearestMaxHours: 3 };
    expect(describeDrawnFrame(euro, { model: 'EURO', layer: 'waves', hour: 150, dataMs: A + 153 * H }).state).toBe('nearest');
  });

  it('positive control: with the kill, the snapped ask decides again (the silent case returns)', () => {
    window.__RAW_DISABLE_DRAWN_LABEL_INSTANT__ = true;
    expect(describeDrawnFrame(sel(2, A + H), drawnAt(2, A + H))).toBeNull();
  });
});

describe('SERVED TIME: a /grid frame keeps its served instant for the record', () => {
  const grid = { hourOffset: 2, __componentLayer: 'waves', __sourceModel: 'GFS', valid_time: '2026-10-25T04:00:00Z', __readoutServedTime: '2026-10-25T03:00:00Z' };

  it('the conform\'s readout-only served time is the data instant (the /grid valid_time only echoes the ask)', () => {
    publishMarineDrawn(grid);
    expect(getMarineDrawn().dataMs).toBe(A + H);
    expect(describeDrawnFrame(sel(2, A + H), getMarineDrawn()).state).toBe('nearest');
  });

  it('served_valid_time still wins when a path carries it; with the kill the record has no data instant (as before)', () => {
    publishMarineDrawn({ ...grid, served_valid_time: '2026-10-25T06:00:00Z' });
    expect(getMarineDrawn().dataMs).toBe(A + 4 * H);
    window.__RAW_DISABLE_DRAWN_SERVED_TIME__ = true;
    publishMarineDrawn(grid);
    expect(getMarineDrawn().dataMs).toBeNull();
  });
});

describe('ENGINE TRUTH: the record follows what the engine holds', () => {
  const old = { hourOffset: 0, __componentLayer: 'waves', __sourceModel: 'GFS', served_valid_time: '2026-10-25T02:00:00Z' };
  const next = { hourOffset: 2, __componentLayer: 'waves', __sourceModel: 'GFS', served_valid_time: '2026-10-25T04:00:00Z' };

  it('a grid the engine REFUSED (stashed; the old resident stays) is not "drawn"', () => {
    const engine = { _waveData: { waveGrid: old } };                     // setWaveData stashed `next`
    expect(engineHoldsGrid(engine, next)).toBe(false);
    expect(engineHoldsGrid({ _waveData: { waveGrid: next } }, next)).toBe(true);
    window.__RAW_DISABLE_DRAWN_ENGINE_TRUTH__ = true;
    expect(engineHoldsGrid(engine, next)).toBe(true);                    // the kill: every handed grid, as before
  });

  it('a swap inside the engine (the self-heal accept) is published on the next frame, once', () => {
    publishMarineDrawn(old);
    const engine = { _waveData: { waveGrid: old } };
    const seen = []; const unsub = require('./marineDrawnFrame').subscribeMarineDrawn(() => seen.push(getMarineDrawn().hour));
    syncDrawnToEngine(engine);
    expect(seen).toEqual([]);                                            // unchanged: nothing published
    engine._waveData = { waveGrid: next };                               // the engine swapped in the stashed grid
    syncDrawnToEngine(engine); syncDrawnToEngine(engine);
    expect(seen).toEqual([2]);
    unsub();
  });

  it('positive control: with the kill a swap inside the engine is not published (the stale "Loading" line)', () => {
    publishMarineDrawn(old);
    window.__RAW_DISABLE_DRAWN_ENGINE_TRUTH__ = true;
    syncDrawnToEngine({ _waveData: { waveGrid: next } });
    expect(getMarineDrawn().hour).toBe(0);
  });
});

describe('wiring', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  it('the layer publishes only a grid the engine took; the custom layer syncs after each render', () => {
    expect(src('WebGLMarineLayer.js')).toMatch(/if \(engineHoldsGrid\(engine, grid\)\) publishMarineDrawn\(grid, /);
    expect(src('WebGLMarineCustomLayer.js')).toMatch(/engine\.render\([^\n]*\);\n(\s*\/\/[^\n]*\n)*\s*syncDrawnToEngine\(engine, /);
  });
  it('the conform carries the readout-only served time; both status lines pass the selection\'s own instant', () => {
    expect(src('useMarineWindData.js')).toMatch(/__readoutServedTime: marineData\.grid\.served_valid_time \|\| marineData\.served_valid_time \|\| null,/);
    expect(src('ForecastTimeStatus.js')).toMatch(/const labelMs = Number\.isFinite\(hour\) \? getSeriesAnchorMs\(\) \+ hour \* 3600000 : null;/);
    expect(src('ForecastTimeStatus.js')).toMatch(/describeDrawnFrame\(\{ model, layer, hour, instantMs, labelMs, nearestMaxHours \}, drawn\)/);
    expect(src('WindTimeStatus.js')).toMatch(/describeDrawnFrame\(\{ model: laneModel, layer: 'wind', hour, instantMs, labelMs, nearestMaxHours \}, drawn\)/);
  });
});
