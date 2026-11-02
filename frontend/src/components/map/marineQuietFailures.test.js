/**
 * D12 (2026-10-28; the lead's offline erratic fuzzer at 4bd90d0d9): intentional aborts were logged as errors (over 100 per batch; the
 * top console error of six seeded sequences: "Grid fetch error: signal is aborted without reason"), and OceanMask's deferred hide asked
 * a removed map for its layers ("Cannot read properties of null (reading 'getLayer')", Wind on plus a WebGL context loss).
 */
import fs from 'fs';
import path from 'path';
import { isAbortError, logFetchFailure, maskMapGone } from './marineQuietFailures';

const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
let err; let dbg;
beforeEach(() => { err = jest.spyOn(console, 'error').mockImplementation(() => {}); dbg = jest.spyOn(console, 'debug').mockImplementation(() => {}); });
afterEach(() => { err.mockRestore(); dbg.mockRestore(); delete window.__RAW_DISABLE_ABORT_LOG_DOWNGRADE__; delete window.__RAW_DISABLE_MASK_MAP_GONE_GUARD__; });

describe('an abort is not an error', () => {
  const abort = (() => { const e = new Error('signal is aborted without reason'); e.name = 'AbortError'; return e; })();
  it('the fuzzer\'s three messages: an AbortError, and the message the browser gives a reason-less abort', () => {
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(new Error('signal is aborted without reason'))).toBe(true);
    expect(isAbortError(new Error('Backend grid returned HTTP 502'))).toBe(false);
    expect(isAbortError(new Error('No local API'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
  it('logs an abort at debug and a real failure at error, with the caller\'s message and extras', () => {
    expect(logFetchFailure(abort, '[Backend Weather Service] Grid fetch error: signal is aborted without reason.')).toBe('debug');
    expect(err).not.toHaveBeenCalled();
    expect(dbg.mock.calls[0][0]).toMatch(/Grid fetch error.*\(aborted: a newer request replaced it\)/);
    const http = new Error('Backend grid returned HTTP 502');
    expect(logFetchFailure(http, '[Backend Weather Client Point] ICON extended point emulation failed:', http)).toBe('error');
    expect(err).toHaveBeenCalledWith('[Backend Weather Client Point] ICON extended point emulation failed:', http);
  });
  it('kill: __RAW_DISABLE_ABORT_LOG_DOWNGRADE__ logs aborts as errors again', () => {
    window.__RAW_DISABLE_ABORT_LOG_DOWNGRADE__ = true;
    expect(logFetchFailure(abort, 'x')).toBe('error');
    expect(err).toHaveBeenCalledTimes(1);
  });
  it('the three fetch paths that logged aborts as errors go through it (call sites, in source)', () => {
    expect(src('backendWeatherServiceClient.js')).toMatch(/logFetchFailure\(err, `\[Backend Weather Service\] Grid fetch error:/);
    expect(src('backendWeatherServiceClient.js')).not.toMatch(/console\.error\(`\[Backend Weather Service\] Grid fetch error:/);
    expect(src('backendWeatherServiceClientPoint.js')).toMatch(/logFetchFailure\(err, '\[Backend Weather Client Point\] ICON extended point emulation failed:', err\)/);
    expect(src('backendWindServiceClient.js')).toMatch(/logFetchFailure\(err, `\[Backend Weather Service\] Wind grid fetch error:/);
    expect(src('backendWindServiceClient.js')).not.toMatch(/console\.error\(`\[Backend Weather Service\] Wind grid fetch error:/);
  });
});

describe('a removed map is not asked for its layers', () => {
  it('a map with no style (MapLibre after map.remove()) is gone; a live one is not; the kill restores the old ask', () => {
    expect(maskMapGone(null)).toBe(true);
    expect(maskMapGone({ style: null })).toBe(true);
    expect(maskMapGone({ style: {}, _removed: true })).toBe(true);
    expect(maskMapGone({ style: {} })).toBe(false);
    window.__RAW_DISABLE_MASK_MAP_GONE_GUARD__ = true;
    expect(maskMapGone({ style: null })).toBe(false);
  });
  it('OceanMask\'s deferred hide and its reposition frame callback ask first (call sites, in source)', () => {
    const s = src('OceanMask.js');
    expect(s).toMatch(/import \{ maskMapGone \} from '\.\/marineQuietFailures';/);
    expect(s).toMatch(/deactivateTimerRef\.current = null; if \(maskMapGone\(mapInstance\)\) return;/);
    expect(s).toMatch(/if \(!active \|\| maskMapGone\(mapInstance\) \|\| !mapInstance\.getLayer\(MASK_BUFFER\)\) return;/);
  });
  it('the deferred hide on a removed map: the old code throws MapLibre\'s error, the guard returns', () => {
    // MapLibre's Map.getLayer is `return this.style.getLayer(id)`: with style null it throws exactly the fuzzer's page error.
    const removed = { style: null, getLayer(id) { return this.style.getLayer(id); }, setLayoutProperty: jest.fn() };
    const oldHide = () => { for (const lid of ['m1', 'm2']) if (removed.getLayer(lid)) removed.setLayoutProperty(lid, 'visibility', 'none'); };
    expect(oldHide).toThrow("Cannot read properties of null (reading 'getLayer')");
    const newHide = () => { if (maskMapGone(removed)) return; oldHide(); };
    expect(newHide).not.toThrow();
  });
});
