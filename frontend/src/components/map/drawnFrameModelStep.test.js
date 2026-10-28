/**
 * BY MODEL STEP (2026-10-27, the lead's live read on dev dcc514bf3, z4.6 at -75,30): across EURO's 6-hourly steps the status line read
 * "Loading Sun 9 AM… still showing Sun 7 AM" for 20+ s over a correct frame, with no request in flight. The EURO world run was
 * 10-26 12Z and the clock 10-27 ~06Z (an 18 h-old run); timeline hour 128 = valid 11-01 14Z = model step 146, and the server served
 * its nearest stored product, the authoritative 12Z (step 144: candidates within 3 h, authoritative before estimated). The half-step
 * rule keyed the 6-hourly tolerance on the TIMELINE hour (> 144), so hours 126-144 kept a 1 h window and stayed "pending" for good.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describeDrawnFrame, latticeNearestMaxHours, reconcileStaleBadge } from './drawnFrameReadout';
import { _resetMarineDrawnForTest, getMarineDrawn, getWindDrawn, publishMarineDrawn, publishWindDrawn, readoutModelRun } from './marineDrawnFrame';
import ForecastTimeStatus from './ForecastTimeStatus';
import { windReadout } from './WindTimeStatus';
import { mapNormalizedCopernicusGridToWebGL } from './backendCopernicusServiceClient';
import { mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';

const H = 3600000;
const RUN = Date.UTC(2026, 9, 26, 12);          // the EURO world run (verified cycle)
const ANCHOR = Date.UTC(2026, 9, 27, 6);        // the series anchor, round(now) at 06:03Z: the run is 18 h old
const RUN_ISO = '2026-10-26T12:00:00Z';
const fmt = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' });
afterEach(() => { delete window.__RAW_DISABLE_LATTICE_MODEL_STEP__; delete window.__MOCK_DATE_NOW__; _resetMarineDrawnForTest(); });

/** The conformed /grid answer the engine held (useMarineWindData): the ask echo, the readout-only served time and cycle. */
const conformed = (hour, servedMs, run = RUN_ISO) => ({
  hourOffset: hour, __componentLayer: 'waves', __sourceModel: 'EURO', valid_time: new Date(ANCHOR + (hour + 1) * H).toISOString(),
  __readoutServedTime: new Date(servedMs).toISOString(), ...(run ? { __readoutModelRun: run } : {}),
});
/** What ForecastTimeStatus asks: the selection's own instant + the tolerance from the drawn frame's run. */
const readout = (hour, drawn) => {
  const labelMs = ANCHOR + hour * H;
  const nearestMaxHours = latticeNearestMaxHours('EURO', hour, { selectedMs: labelMs, runMs: drawn.runMs });
  return describeDrawnFrame({ model: 'EURO', layer: 'waves', hour, labelMs, instantMs: labelMs + H, nearestMaxHours }, drawn);
};

describe('latticeNearestMaxHours reads EURO\'s 6-hourly range by MODEL STEP', () => {
  const at = (hour, runMs = RUN) => latticeNearestMaxHours('EURO', hour, { selectedMs: ANCHOR + hour * H, runMs });
  it('timeline 128 on an 18 h-old run is step 146: 3 h (the timeline hour said 1)', () => {
    expect(at(128)).toBe(3);
    expect(latticeNearestMaxHours('EURO', 128)).toBe(1);   // the cycle unknown: today's rule
  });
  it('the boundary is step 144 (stored 3-hourly up to it): timeline 126 = step 144 -> 1, 127 = step 145 -> 3', () => {
    expect(at(126)).toBe(1);
    expect(at(127)).toBe(3);
  });
  it('control: the 3-hourly range keeps 1 h (timeline 100 = step 118)', () => { expect(at(100)).toBe(1); });
  it('a fresh run (0 h old) agrees with the timeline hour on both sides', () => {
    expect(at(144, ANCHOR)).toBe(1);
    expect(at(150, ANCHOR)).toBe(3);
  });
  it('other models stay 1 h; an unknown, unparsable or future cycle keeps the timeline hour', () => {
    expect(latticeNearestMaxHours('GFS', 200, { selectedMs: ANCHOR + 200 * H, runMs: RUN })).toBe(1);
    expect(latticeNearestMaxHours('EURO', 150, { selectedMs: ANCHOR + 150 * H, runMs: null })).toBe(3);
    expect(latticeNearestMaxHours('EURO', 128, { selectedMs: ANCHOR + 128 * H, runMs: NaN })).toBe(1);
    expect(latticeNearestMaxHours('EURO', 128, { selectedMs: ANCHOR + 128 * H, runMs: ANCHOR + 200 * H })).toBe(1);
  });
  it('kill: __RAW_DISABLE_LATTICE_MODEL_STEP__ makes the timeline hour decide again', () => {
    window.__RAW_DISABLE_LATTICE_MODEL_STEP__ = true;
    expect(at(128)).toBe(1);
    expect(at(150)).toBe(3);
  });
});

describe('the live sequence: EURO h126-h140 on the 18 h-old run, through the drawn record', () => {
  it('timeline 128 (valid 14Z, step 146) over the served 12Z: "Showing …: the nearest stored forecast", not "Loading"', () => {
    publishMarineDrawn(conformed(128, RUN + 144 * H));
    const r = readout(128, getMarineDrawn());
    expect(r.state).toBe('nearest');
    expect(r.text).toBe(`Showing ${fmt(RUN + 144 * H)}: the nearest stored forecast`);
  });
  it('every hour from 127 to 140 over its nearest authoritative 6-hourly frame reads "nearest"', () => {
    const states = [];
    for (let hour = 127; hour <= 140; hour += 1) {
      const step = hour + 18;
      const servedStep = step % 6 === 3 ? step - 3 : 6 * Math.round(step / 6);   // the nearest authoritative step; a tie goes earlier
      publishMarineDrawn(conformed(hour, RUN + servedStep * H));
      const r = readout(hour, getMarineDrawn());
      states.push(`${hour}:${r ? r.state : 'exact'}`);
    }
    // steps 150 and 156 are stored exactly (timeline 132, 138): no words; every other hour is its nearest stored forecast
    expect(states).toEqual([127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140]
      .map((h) => `${h}:${(h + 18) % 6 === 0 ? 'exact' : 'nearest'}`));
  });
  it('control: in the 3-hourly range a frame 2 h off is still loading ("Loading <selected>… still showing <drawn>")', () => {
    publishMarineDrawn(conformed(100, ANCHOR + 98 * H));   // step 118, drawn 2 h behind
    const r = readout(100, getMarineDrawn());
    expect(r.state).toBe('pending');
    expect(r.text).toBe(`Loading ${fmt(ANCHOR + 100 * H)}… still showing ${fmt(ANCHOR + 98 * H)}`);
  });
  it('positive control: the kill, or a frame naming no cycle, restores the stuck "Loading" (the live defect)', () => {
    publishMarineDrawn(conformed(128, RUN + 144 * H, null));
    expect(readout(128, getMarineDrawn()).state).toBe('pending');
    publishMarineDrawn(conformed(128, RUN + 144 * H));
    window.__RAW_DISABLE_LATTICE_MODEL_STEP__ = true;
    expect(readout(128, getMarineDrawn()).text).toBe(`Loading ${fmt(ANCHOR + 128 * H)}… still showing ${fmt(RUN + 144 * H)}`);
  });
});

describe('the drawn records name the frame\'s verified cycle (runMs)', () => {
  it('a conformed /grid or series frame: its readout-only cycle', () => {
    publishMarineDrawn(conformed(128, RUN + 144 * H));
    expect(getMarineDrawn().runMs).toBe(RUN);
  });
  it('a store show: its index meta\'s cycle, never the resident\'s it was spread over', () => {
    publishMarineDrawn({ ...conformed(128, RUN + 144 * H, '2026-10-27T00:00:00Z'), __fromFrameStore: true, model_run_time: RUN_ISO });
    expect(getMarineDrawn().runMs).toBe(RUN);
    publishMarineDrawn({ ...conformed(128, RUN + 144 * H, '2026-10-27T00:00:00Z'), __fromFrameStore: true });
    expect(getMarineDrawn().runMs).toBeNull();
  });
  it('an unverified cycle and the ingest clock are not a run', () => {
    publishMarineDrawn({ ...conformed(128, RUN + 144 * H, null), model_run_time: RUN_ISO, model_run_time_status: 'missing', run_time: RUN_ISO });
    expect(getMarineDrawn().runMs).toBeNull();
  });
  it('wind: a verified cycle on the grid; none when its status is not known', () => {
    publishWindDrawn({ hourOffset: 128, model: 'EURO', model_run_time: RUN_ISO, model_run_time_status: 'known' });
    expect(getWindDrawn().runMs).toBe(RUN);
    publishWindDrawn({ hourOffset: 128, model: 'EURO', model_run_time: RUN_ISO, model_run_time_status: 'incomplete' });
    expect(getWindDrawn().runMs).toBeNull();
  });
});

describe('readoutModelRun (the conform\'s source, useMarineWindData)', () => {
  it('the conform carries it under the readout-only name (the grid the engine holds)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'useMarineWindData.js'), 'utf8');
    expect(src).toMatch(/__readoutModelRun: readoutModelRun\(marineData\),/);
  });
  it('a /grid frame: its receipt\'s verified cycle', () => {
    expect(readoutModelRun({ grid: { frameReceipt: { modelRunTime: '2026-10-26T12:00:00.000Z', modelRunTimeStatus: 'known' } } }))
      .toBe('2026-10-26T12:00:00.000Z');
    expect(readoutModelRun({ grid: { frameReceipt: { modelRunTime: null, modelRunTimeStatus: 'missing' } } })).toBeNull();
  });
  // The miss the first offline replay found (2026-10-27): EURO's /grid answers come through the Copernicus mapper, which built no
  // receipt, so the fix read no cycle and the replay's words did not move. Both mappers, on the /grid JSON the backend serves.
  it('the /grid JSON through BOTH mappers (EURO\'s Copernicus mapper and the GFS/ICON one) yields its verified cycle', () => {
    const json = { model: 'EURO', provider: 'open-meteo', layer: 'waves', valid_time: '2026-11-01T16:00:00Z', served_valid_time: '2026-11-01T18:00:00Z',
      run_time: '2026-10-26T10:00:00Z', model_run_time: '2026-10-26T06:00:00Z', model_run_time_status: 'known', product_id: 'euro_marine_waves_global_mid_20261101T180000Z.json',
      grid: { bounds: { west: -100, south: 10, east: -50, north: 50 }, cols: 2, rows: 1, vectors: [{ lat: 30, lng: -75, u: 1, v: 0, speed: 1 }, { lat: 30, lng: -74, u: 1, v: 0, speed: 1 }] } };
    const euro = mapNormalizedCopernicusGridToWebGL(json, null, 127, 'waves');
    expect(readoutModelRun(euro)).toBe('2026-10-26T06:00:00.000Z');
    expect(euro.grid.model_run_time).toBeUndefined();   // the legacy identity fields stay as they were (the commit rules read them)
    expect(readoutModelRun(mapNormalizedGridToWebGL({ ...json, model: 'GFS' }, null, 127, 'waves', 'GFS'))).toBe('2026-10-26T06:00:00.000Z');
    expect(readoutModelRun(mapNormalizedCopernicusGridToWebGL({ ...json, model_run_time_status: 'missing' }, null, 127, 'waves'))).toBeNull();
  });
  it('a series frame: the grid\'s cycle, else its wrapper\'s; never run_time', () => {
    expect(readoutModelRun({ grid: { model_run_time: RUN_ISO, model_run_time_status: 'known' } })).toBe(RUN_ISO);
    expect(readoutModelRun({ model_run_time: RUN_ISO, model_run_time_status: 'known', grid: {} })).toBe(RUN_ISO);
    expect(readoutModelRun({ run_time: RUN_ISO, grid: { run_time: RUN_ISO } })).toBeNull();
    expect(readoutModelRun(null)).toBeNull();
  });
});

describe('the three callers read the drawn frame\'s run', () => {
  it('ForecastTimeStatus at the live clock (06:03Z): timeline 128 over the served 12Z reads "nearest" (every theme)', () => {
    window.__MOCK_DATE_NOW__ = ANCHOR + 3 * 60000;   // round(now) = the anchor the app asks on
    act(() => { publishMarineDrawn(conformed(128, RUN + 144 * H)); });
    ['dark', 'light', 'beach'].forEach((theme) => {
      const { unmount } = render(<ForecastTimeStatus model="EURO" layer="waves" hour={128} theme={theme} />);
      const line = screen.getByRole('status');
      expect(line).toHaveAttribute('data-drawn-state', 'nearest');
      expect(line).toHaveTextContent(`Showing ${fmt(RUN + 144 * H)}: the nearest stored forecast`);
      expect(line).not.toHaveAttribute('aria-busy');
      unmount();
    });
  });
  it('ForecastTimeStatus, positive control: with the kill the same frame reads "Loading" (the live line)', () => {
    window.__MOCK_DATE_NOW__ = ANCHOR + 3 * 60000;
    window.__RAW_DISABLE_LATTICE_MODEL_STEP__ = true;
    act(() => { publishMarineDrawn(conformed(128, RUN + 144 * H)); });
    render(<ForecastTimeStatus model="EURO" layer="waves" hour={128} theme="dark" />);
    expect(screen.getByRole('status')).toHaveAttribute('data-drawn-state', 'pending');
  });
  it('the wind line: EURO wind at timeline 128 on the same run', () => {
    window.__MOCK_DATE_NOW__ = ANCHOR + 3 * 60000;
    const drawn = { model: 'EURO', layer: 'wind', hour: 128, dataMs: RUN + 144 * H, runMs: RUN };
    expect(windReadout({ model: 'EURO', hour: 128 }, drawn).state).toBe('nearest');
    expect(windReadout({ model: 'EURO', hour: 128 }, { ...drawn, runMs: null }).state).toBe('pending');
  });
  it('the point card\'s stale badge clears over the nearest stored frame (MapForecastOverlay passes the run)', () => {
    const drawn = { model: 'EURO', layer: 'waves', hour: 128, dataMs: RUN + 144 * H, runMs: RUN };
    const req = (runMs) => ({ model: 'EURO', layer: 'waves', hour: 128, instantMs: ANCHOR + 129 * H,
      nearestMaxHours: latticeNearestMaxHours('EURO', 128, { selectedMs: ANCHOR + 128 * H, runMs }) });
    expect(reconcileStaleBadge('retained_stale_warning', req(RUN), drawn)).toBeNull();
    expect(reconcileStaleBadge(null, req(null), drawn)).toBe('retained_stale_warning');
    const src = fs.readFileSync(path.join(__dirname, 'MapForecastOverlay.js'), 'utf8');
    // 2026-10-28 (D8, storedLattice.test.js): the overlay also passes its layer, so the rule follows that layer's stored lattice.
    expect(src).toMatch(/latticeNearestMaxHours\(activeModel, Number\(timeOffsetHours\), \{ selectedMs: getSeriesAnchorMs\(\) \+ Number\(timeOffsetHours\) \* 3600000, runMs: drawnFrame && drawnFrame\.runMs, layer: activeLayer \}\)/);
  });
});
