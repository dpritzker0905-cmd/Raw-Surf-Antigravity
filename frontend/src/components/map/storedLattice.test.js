/**
 * D8 (the lead's offline erratic fuzzer, 2026-10-27; fuzz-2026-10-27 report-batch1..3 `inv2_nearest_claim_overbroad`, 92 times,
 * once held 22.5 s): EURO's "nearest" half-step was 3 h for every layer past model step 144. Replays of the fuzzer's instances
 * through the real rule (latticeNearestMaxHours), words (describeDrawnFrame) and line (ForecastTimeStatus), against manifests
 * shaped like the stored lattices; the kill switch prints the live reading.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { servedPick, servedPickHalfStep } from './storedLattice';
import { latticeNearestMaxHours, describeDrawnFrame, formatInstant } from './drawnFrameReadout';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';
import ForecastTimeStatus from './ForecastTimeStatus';
import { publishMarineDrawn, _resetMarineDrawnForTest } from './marineDrawnFrame';

const H = 3600000;
const NOW = Date.parse('2026-10-28T12:00:00Z');        // the series anchor
const RUN = Date.parse('2026-10-28T00:00:00Z');        // model step = timeline hour + 12
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const at = (hour) => NOW + hour * H;
const prod = (model, layer, ms, estimated = false) => ({ model, domain: layer === 'wind' ? 'wind' : 'marine', layer,
  valid_time_start: iso(ms), is_estimated: estimated });
/** A 3-hourly lattice of `layer` around the hour (stored at multiples of 3 model steps). */
const threeHourly = (model, layer, fromStep, toStep, estimated = false) => {
  const out = [];
  for (let s = fromStep; s <= toStep; s += 3) out.push(prod(model, layer, RUN + s * H, estimated));
  return out;
};
const words = (model, layer, hour, drawnMs, extra = {}) => {
  const labelMs = at(hour);
  const nearestMaxHours = latticeNearestMaxHours(model, hour, { selectedMs: labelMs, runMs: RUN, layer });
  return describeDrawnFrame({ model, layer, hour, labelMs, instantMs: labelMs, nearestMaxHours },
    { model, layer, hour, dataMs: drawnMs, estimated: false, ...extra }, { nowMs: NOW });
};

beforeEach(() => {
  jest.useFakeTimers('modern');
  jest.setSystemTime(NOW);
  _resetMarineDrawnForTest();
});
afterEach(() => {
  jest.useRealTimers();
  setCachedManifest(null);
  delete window.__RAW_DISABLE_LATTICE_BY_LAYER__;
});

describe('the server\'s own pick decides the half-step', () => {
  test('authoritative within 3 h first, else the nearest estimate, the earlier on a tie', () => {
    setCachedManifest({ products: [prod('EURO', 'waves', at(140)), prod('EURO', 'waves', at(146)), prod('EURO', 'waves', at(143), true)] });
    expect(servedPick('EURO', 'waves', at(142))).toEqual({ pickMs: at(140), estimated: false, nearerEstimate: true });
    expect(servedPick('EURO', 'waves', at(143))).toEqual({ pickMs: at(140), estimated: false, nearerEstimate: true });   // tie: earlier
    expect(servedPickHalfStep('EURO', 'waves', at(142))).toBe(2);
    expect(servedPick('EURO', 'waves', at(150))).toBeNull();                                                      // nothing within 3 h
    setCachedManifest({ products: [prod('EURO', 'waves', at(300), true), prod('EURO', 'waves', at(303), true)] });
    expect(servedPick('EURO', 'waves', at(302))).toEqual({ pickMs: at(303), estimated: true, nearerEstimate: false });
    expect(servedPickHalfStep('GFS', 'waves', at(302))).toBeNull();                                               // no GFS rows
  });
});

describe('the fuzzer\'s overbroad claims are gone', () => {
  test('EURO wind_waves h181 drawing h184 (CMEMS is 3-hourly): "Loading", was "the nearest stored forecast"', () => {
    setCachedManifest({ products: threeHourly('EURO', 'wind_waves', 150, 240) });
    const r = words('EURO', 'wind_waves', 181, at(184));
    expect(r.state).toBe('pending');
    window.__RAW_DISABLE_LATTICE_BY_LAYER__ = true;
    expect(words('EURO', 'wind_waves', 181, at(184))).toEqual({ state: 'nearest',
      text: `Showing ${formatInstant(at(184), true)}: the nearest stored forecast` });
  });

  test('EURO swell_2 past 240 (the GFS stand-in tail is 3-hourly): a frame 2 h off is owed, not nearest', () => {
    setCachedManifest({ products: threeHourly('EURO', 'swell_2', 240, 336, true) });
    expect(latticeNearestMaxHours('EURO', 287, { selectedMs: at(287), runMs: RUN, layer: 'swell_2' })).toBe(1);
    expect(words('EURO', 'swell_2', 287, at(285), { estimated: true, basisType: 'gfs_estimated_fallback' }).state).toBe('pending');
    expect(words('EURO', 'swell_2', 287, at(288), { estimated: true, basisType: 'gfs_estimated_fallback' }).state).toBe('nearest');
  });

  test('EURO waves h314 past the 6-hourly band (estimates every 3 h): h312 drawn under h314 is owed', () => {
    setCachedManifest({ products: threeHourly('EURO', 'waves', 252, 336, true) });
    expect(words('EURO', 'waves', 314, at(312), { estimated: true }).state).toBe('pending');
    window.__RAW_DISABLE_LATTICE_BY_LAYER__ = true;
    expect(words('EURO', 'waves', 314, at(312), { estimated: true }).state).toBe('nearest');            // the live reading
  });
});

describe('where EURO waves really are 6-hourly, the authoritative frame stays an answer, worded truthfully', () => {
  // ECMWF authoritative every 6 h from step 144, lattice_fill's interpolated estimates at the 3-h steps between.
  const wavesBand = () => [...threeHourly('EURO', 'waves', 144, 240).filter((p) => (Date.parse(p.valid_time_start) - RUN) / H % 6 === 0),
    ...threeHourly('EURO', 'waves', 147, 237, true).filter((p) => (Date.parse(p.valid_time_start) - RUN) / H % 6 === 3)];

  test('step 146: the server draws 144 (authoritative, 2 h) over the 147 estimate (1 h): "the nearest full forecast"', () => {
    setCachedManifest({ products: wavesBand() });
    const hour = 146 - 12;
    expect(words('EURO', 'waves', hour, RUN + 144 * H)).toEqual({ state: 'nearest',
      text: `Showing ${formatInstant(RUN + 144 * H)}: the nearest full forecast; an estimate lies closer` });
  });

  test('no manifest: the step rule, now by layer (waves keeps 3 h from step 144 to 240; swells, wind waves and the tail 1 h)', () => {
    const at200 = { selectedMs: RUN + 200 * H, runMs: RUN };
    expect(latticeNearestMaxHours('EURO', 188, { ...at200, layer: 'waves' })).toBe(3);
    expect(latticeNearestMaxHours('EURO', 188, { ...at200, layer: 'swell_1' })).toBe(1);
    expect(latticeNearestMaxHours('EURO', 188, { ...at200, layer: 'wind_waves' })).toBe(1);
    expect(latticeNearestMaxHours('EURO', 188, { ...at200, layer: 'wind' })).toBe(3);                    // IFS is 6-hourly too
    expect(latticeNearestMaxHours('EURO', 288, { selectedMs: RUN + 300 * H, runMs: RUN, layer: 'waves' })).toBe(1);
    expect(latticeNearestMaxHours('EURO', 188, at200)).toBe(3);                                         // no layer: unchanged
    expect(latticeNearestMaxHours('GFS', 188, { ...at200, layer: 'waves' })).toBe(1);
    window.__RAW_DISABLE_LATTICE_BY_LAYER__ = true;
    expect(latticeNearestMaxHours('EURO', 188, { ...at200, layer: 'swell_1' })).toBe(3);                  // the live rule
  });
});

test('the status line itself: EURO wind_waves h181 drawing h184 reads "Loading", in every theme', () => {
  setCachedManifest({ products: threeHourly('EURO', 'wind_waves', 150, 240) });
  publishMarineDrawn({ hourOffset: 181, __componentLayer: 'wind_waves', __sourceModel: 'EURO', served_valid_time: iso(at(184)),
    model_run_time: iso(RUN), model_run_time_status: 'known', bounds: { west: -82, east: -78, south: 26, north: 30 }, cols: 17, rows: 17 });
  for (const theme of ['light', 'dark', 'beach']) {
    const { unmount } = render(<ForecastTimeStatus model="EURO" layer="wind_waves" hour={181} theme={theme} />);
    const line = screen.getAllByRole('status').find((el) => el.hasAttribute('data-drawn-state'));
    expect(line.getAttribute('data-drawn-state')).toBe('pending');
    expect(line.textContent).toMatch(/^Loading .+… still showing .+$/);
    unmount();
  }
});
