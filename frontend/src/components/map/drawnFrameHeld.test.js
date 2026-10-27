/**
 * HELD FRAMES (2026-10-25, the owner's day-14 test: "the ICON data is showing Saturday 13th day on the Sunday 14th day", silently).
 *  - heldFrameTime: a client-built blend carries its OLDEST input's served time (readout only), so the drawn record has a data time;
 *  - drawnFrameReadout 'held': the answer to THIS selection is an estimate older than the nearest-frame rule allows, so the line says
 *    "Holding <data time> <model> forecast: <why>", never "Loading" (nothing newer is coming);
 *  - the wiring: the blend sets __readoutServedTime (never served_valid_time) and the conform carries it.
 */
import fs from 'fs';
import path from 'path';
import { describeDrawnFrame, formatInstant } from './drawnFrameReadout';
import { oldestServedTime, servedTimeOf } from './heldFrameTime';

const H = 3600000;
const A = Date.UTC(2026, 10, 9, 1, 0, 0);            // the selection's own instant (hour 336)
const DATA = A - 13 * H;                              // the held frame: 13 h older (the far-edge hold of the last stored frame)
const NOW = A - 336 * H;                              // the session is 14 days before the selection (dated words)
const say = (s, x) => describeDrawnFrame(s, x, { nowMs: NOW });
const sel = (model = 'ICON', hour = 336) => ({ model, layer: 'waves', hour, labelMs: A, instantMs: A, nearestMaxHours: 1 });
const drawn = (over = {}) => ({ model: 'ICON', layer: 'waves', hour: 336, dataMs: DATA, estimated: true, basisType: 'icon_extended_blend', ...over });
afterEach(() => { delete window.__RAW_DISABLE_DRAWN_HELD_WORDS__; delete window.__RAW_DISABLE_DRAWN_HOLD_WORDS__; delete window.__RAW_DISABLE_BLEND_SERVED_TIME__; delete window.__RAW_DISABLE_DRAWN_DATED_LABEL__; });

describe('the held line: what the field IS, never "Loading" for a frame that is not coming', () => {
  it('the ICON blend past the tail (the owner\'s case): "Holding <data time>’s ICON forecast: blended from GFS and EURO beyond ICON\'s range"', () => {
    const r = say(sel(), drawn());
    expect(r.state).toBe('held');
    expect(r.text).toBe(`Holding ${formatInstant(DATA, true)}’s ICON forecast: blended from GFS and EURO beyond ICON’s range`);
  });

  it('the server\'s far-edge hold (#578\'s words) and its GFS stand-in say why in their own words', () => {
    expect(say(sel('EURO'), drawn({ model: 'EURO', basisType: 'far_edge_hold' })).text)
      .toBe(`Holding ${formatInstant(DATA, true)}’s EURO forecast: the 14-day estimate ends there`);
    expect(say(sel('EURO'), drawn({ model: 'EURO', basisType: 'gfs_estimated_fallback' })).text)
      .toBe(`Holding ${formatInstant(DATA, true)}’s EURO forecast: GFS stand-in beyond EURO’s range`);
    expect(say(sel(), drawn({ basisType: 'something_new' })).text).toBe(`Holding ${formatInstant(DATA, true)}’s ICON forecast: beyond ICON’s range`);
  });

  it('ONE held path: a far-edge hold that is NOT the answer to this selection reads "Loading" (no "ends there" over a loading hour)', () => {
    const r = say(sel('EURO', 330), drawn({ model: 'EURO', basisType: 'far_edge_hold' }));
    expect(r.state).toBe('pending');
    expect(r.text).toMatch(/^Loading .* still showing /);
  });

  it('still "Loading" when an OLDER answer is on screen (the selected hour has not been answered yet)', () => {
    const r = say(sel('ICON', 335), { ...drawn(), hour: 334 });
    expect(r.state).toBe('pending');
    expect(r.text).toMatch(/^Loading /);
  });

  it('still "Loading" for a frame that is not an estimate (a stale answer the server will refresh)', () => {
    expect(say(sel(), drawn({ estimated: false })).state).toBe('pending');
  });

  it('within the nearest-frame rule it is "nearest", as before; with no data time there is nothing to hold up (no "Holding")', () => {
    expect(say(sel(), drawn({ dataMs: A - H })).state).toBe('nearest');
    expect(say(sel(), drawn({ dataMs: null }))).toEqual({ state: 'estimated', text: 'Estimated forecast: blended from GFS and EURO beyond ICON’s range' });
  });

  it('two times a week or more apart are DATED (weekday + hour alone read "Sun 11 PM… still showing Sun 11 PM"); the kill drops the date', () => {
    const old = A - 7 * 24 * H;                          // a resident a week older, still on screen (both after the 2026-11-01 DST change)
    const r = say(sel(), { ...drawn(), hour: 0, dataMs: old, estimated: false });
    expect(r.text).toBe(`Loading ${formatInstant(A, true)}… still showing ${formatInstant(old, true)}`);
    expect(formatInstant(A, true)).not.toBe(formatInstant(old, true));
    expect(formatInstant(A)).toBe(formatInstant(old));    // the old words: the same text two weeks apart
    window.__RAW_DISABLE_DRAWN_DATED_LABEL__ = true;
    expect(say(sel(), { ...drawn(), hour: 0, dataMs: old, estimated: false }).text).toBe(`Loading ${formatInstant(A)}… still showing ${formatInstant(old)}`);
  });

  it('positive control: the kill, or #578\'s documented alias, brings back the "Loading" line', () => {
    window.__RAW_DISABLE_DRAWN_HELD_WORDS__ = true;
    expect(say(sel(), drawn()).state).toBe('pending');
    delete window.__RAW_DISABLE_DRAWN_HELD_WORDS__;
    window.__RAW_DISABLE_DRAWN_HOLD_WORDS__ = true;
    expect(say(sel(), drawn()).state).toBe('pending');
    expect(say(sel('EURO'), drawn({ model: 'EURO', basisType: 'far_edge_hold' })).state).toBe('pending');
  });
});

describe('the blend\'s data time: its oldest input\'s served time', () => {
  it('reads the served time from the answer, its grid or the grid\'s diagnostics', () => {
    expect(servedTimeOf({ served_valid_time: '2026-11-08T12:00:00Z' })).toBe('2026-11-08T12:00:00Z');
    expect(servedTimeOf({ grid: { served_valid_time: '2026-11-08T09:00:00Z' } })).toBe('2026-11-08T09:00:00Z');
    expect(servedTimeOf({ grid: { diagnostics: { served_valid_time: '2026-11-08T06:00:00Z' } } })).toBe('2026-11-08T06:00:00Z');
    expect(servedTimeOf({ grid: {} })).toBe(null);
    expect(servedTimeOf(null)).toBe(null);
  });

  it('the oldest of the inputs wins (a blend is never fresher than its oldest input); none -> null; the kill -> null', () => {
    const gfs = { served_valid_time: '2026-11-08T21:00:00Z' }; const euro = { grid: { served_valid_time: '2026-11-08T12:00:00Z' } };
    expect(oldestServedTime({ gfs, euro })).toEqual({ oldest: '2026-11-08T12:00:00Z', times: { gfs: '2026-11-08T21:00:00Z', euro: '2026-11-08T12:00:00Z' } });
    expect(oldestServedTime({ gfs })).toEqual({ oldest: '2026-11-08T21:00:00Z', times: { gfs: '2026-11-08T21:00:00Z' } });
    expect(oldestServedTime({ gfs: { grid: {} } })).toBe(null);
    window.__RAW_DISABLE_BLEND_SERVED_TIME__ = true;
    expect(oldestServedTime({ gfs, euro })).toBe(null);
  });
});

describe('wiring', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  it('the blend carries its readout time (never served_valid_time) and its inputs\' times; the conform carries it on', () => {
    const b = src('backendWeatherServiceClientHelpers.js');
    expect(b).toMatch(/const _held = oldestServedTime\(\{ \.\.\.\(gfsVectors\.length \? \{ gfs: gfsTargetGrid \} : \{\}\), \.\.\.\(euroVectors\.length \? \{ euro: euroTargetGrid \} : \{\}\) \}\);/);
    expect(b).toMatch(/\.\.\.\(_held \? \{ __readoutServedTime: _held\.oldest \} : \{\}\)/);
    expect(b).toMatch(/\.\.\.\(_held \? \{ served_times: _held\.times \} : \{\}\)/);
    expect(src('useMarineWindData.js')).toMatch(/__readoutServedTime: marineData\.grid\.served_valid_time \|\| marineData\.served_valid_time \|\| marineData\.grid\.__readoutServedTime \|\| null,/);
  });
  it('both status lines give a hold the warning tone', () => {
    expect(src('ForecastTimeStatus.js')).toMatch(/readout\.state === 'pending' \|\| readout\.state === 'held' \? tone : quiet/);
    expect(src('WindTimeStatus.js')).toMatch(/const tone = readout\.state === 'pending' \|\| readout\.state === 'held'/);
  });
});
