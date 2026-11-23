/**
 * WHICH MODEL IS DRAWN (SOTA-GAP inspection pass 13, 2026-11-23; rasterDrawnFrame.describeRasterSource). With EURO or ICON
 * picked, Fog draws GFS (Open-Meteo ncep_gfs025) and nothing said so. Now any raster whose DRAWN frame is another weather model
 * than the picked one says so, in words, in the warning tone, in every theme; ICON's water temp names its ocean-model source.
 * Display only. Kill: window.__RAW_DISABLE_RASTER_SOURCE_WORDS__.
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import TimelineDrawerHeader from './TimelineDrawerHeader';
import { readStaleChip } from './StaleLayerChip';
import { omEnd, describeRasterFrame, describeRasterSource, drawnModelFamily, gridWords, publishRasterDrawn, _resetRasterDrawnForTest,
  PENDING_QUIET_MS } from './rasterDrawnFrame';
import ForecastTimeStatus from './ForecastTimeStatus';

const hourly = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 10, 23, 12 + i)).toISOString());
const CACHE = { ncep_gfs025: { validTimes: hourly }, ecmwf_ifs025: { validTimes: hourly } };
const om = (model, i, v = 'visibility') => omEnd(`om://https://openmeteo.s3.amazonaws.com/data_spatial/${model}/latest.json?time_step=valid_times_${i}&variable=${v}`, CACHE);
const fogGfs = () => om('ncep_gfs025', 3);   // LayerRegistry pins fog to ncep_gfs025 on all three models
// The published CMEMS set's grid (its index, read 2026-11-23): 2160 x 1021, west -180 .. east 179.8333 = 1/6 degree.
const CMEMS_DEG = (179.83333333333334 - -180) / (2160 - 1);
const cmems = { url: 'v1/cmems/marine/water_temp/global_1p6/frames/20261123_00z/f012.rswf.gz', dataMs: Date.parse(hourly[3]), model: 'ICON', gridDeg: CMEMS_DEG };

afterEach(() => { _resetRasterDrawnForTest(); delete window.__RAW_DISABLE_RASTER_SOURCE_WORDS__; jest.useRealTimers(); });

describe('describeRasterSource / describeRasterFrame', () => {
  test.each(['EURO', 'ICON'])('Fog on %s draws GFS: said, with the drawn source named', (sel) => {
    const e = fogGfs();
    expect(e.model).toBe('GFS');
    const r = describeRasterFrame({ layer: 'fog', shown: e, want: e }, 'fog', e.dataMs, sel);
    expect(r).toEqual({ state: 'standin', text: `${sel} fog unavailable: NOAA GFS shown` });
  });
  test('Fog on GFS, or the model not given (older callers): nothing to say', () => {
    const e = fogGfs();
    expect(describeRasterFrame({ layer: 'fog', shown: e, want: e }, 'fog', e.dataMs, 'GFS')).toBeNull();
    expect(describeRasterFrame({ layer: 'fog', shown: e, want: e }, 'fog', e.dataMs)).toBeNull();
  });
  test('generic: any raster whose drawn model differs (water temp on ICON falling back to GFS skin)', () => {
    const e = om('ncep_gfs025', 4, 'surface_temperature');
    expect(describeRasterFrame({ layer: 'water_temp', shown: e, want: e }, 'water_temp', e.dataMs, 'ICON').text)
      .toBe('ICON water temp unavailable: NOAA GFS shown');
    const eu = om('ecmwf_ifs025', 4, 'precipitation');
    expect(describeRasterFrame({ layer: 'rain', shown: eu, want: eu }, 'rain', eu.dataMs, 'EURO')).toBeNull();   // its own model
  });
  test("ICON water temp names the ocean model and its grid (a different quantity from GFS / EURO's skin)", () => {
    expect(describeRasterFrame({ layer: 'water_temp', shown: cmems, want: cmems }, 'water_temp', cmems.dataMs, 'ICON'))
      .toEqual({ state: 'source', text: 'Water Temp: Copernicus Marine ocean model, top layer, 1/6° grid' });
    expect(describeRasterSource({ ...cmems, model: 'CMEMS' }, 'water_temp', 'ICON').text).toMatch(/Copernicus Marine/);
    // the grid is READ from the drawn field, never the set's name: no field spacing, no grid words; other spacings as they are
    expect(describeRasterSource({ ...cmems, gridDeg: null }, 'water_temp', 'ICON').text).toBe('Water Temp: Copernicus Marine ocean model, top layer');
    expect(gridWords(1 / 12)).toBe('1/12°');
    expect(gridWords(0.25)).toBe('1/4°');
    expect(gridWords(0.117)).toBe('0.117°');
  });
  test('no false stand-ins: ocean products, radar, an estimated frame (its own words), a load in progress', () => {
    expect(describeRasterSource({ url: 'v1/rtofs/marine/currents/global/f.gz', model: 'RTOFS' }, 'currents', 'EURO')).toBeNull();
    expect(describeRasterSource({ url: 'radar-a', dataMs: 1 }, 'radar', 'EURO')).toBeNull();
    const fill = { ...fogGfs(), layer: 'satellite', model: 'ICON+GFS', estimated: 'icon_gfs_gap_fill', fill: true };
    expect(describeRasterFrame({ layer: 'satellite', shown: fill, want: fill }, 'satellite', fill.dataMs, 'ICON').state).toBe('estimated');
    const r = describeRasterFrame({ layer: 'fog', shown: fogGfs(), want: om('ncep_gfs025', 4) }, 'fog', 0, 'EURO');
    expect(r.state).toBe('pending');
  });
  test('the model family: the record, else the own-frame path', () => {
    expect(drawnModelFamily({ model: 'ICON+GFS' })).toBe('ICON');
    expect(drawnModelFamily({ model: 'GFS:fill:ICON' })).toBe('GFS');
    expect(drawnModelFamily({ url: 'v1/euro/weather/cloud_cover/global_0p25/f.gz' })).toBe('EURO');
  });
  test('the kill switch: no line, as before', () => {
    window.__RAW_DISABLE_RASTER_SOURCE_WORDS__ = true;
    const e = fogGfs();
    expect(describeRasterFrame({ layer: 'fog', shown: e, want: e }, 'fog', e.dataMs, 'EURO')).toBeNull();
    expect(describeRasterFrame({ layer: 'water_temp', shown: cmems, want: cmems }, 'water_temp', cmems.dataMs, 'ICON')).toBeNull();
  });
});

describe('the status line (one component for the desktop panel and both phone layouts)', () => {
  const hourOf = (e) => Math.round((e.dataMs - Date.now()) / 3600000);
  test.each([['light', 'text-amber-800'], ['dark', 'text-amber-200'], ['beach', 'text-amber-200']])(
    'Fog on EURO, %s theme: a polite status in words, in the warning tone, after the quiet time', (theme, tone) => {
      jest.useFakeTimers();
      const e = fogGfs();
      act(() => { publishRasterDrawn({ layer: 'fog', shown: e, want: e }); });
      render(<ForecastTimeStatus model="EURO" layer="fog" hour={hourOf(e)} theme={theme} />);
      expect(screen.queryByText(/fog unavailable/)).toBeNull();   // not before PENDING_QUIET_MS (no flash on a switch)
      act(() => { jest.advanceTimersByTime(PENDING_QUIET_MS + 10); });
      const s = screen.getByRole('status');
      expect(s.textContent).toBe('EURO fog unavailable: NOAA GFS shown');
      expect(s.getAttribute('aria-live')).toBe('polite');
      expect(s.getAttribute('data-drawn-state')).toBe('standin');
      expect(s.className).toContain(tone);
    });
  test('a model switch: the old record for less than the quiet time never prints a stand-in', () => {
    jest.useFakeTimers();
    const g = om('ncep_gfs025', 3, 'pressure_msl');
    act(() => { publishRasterDrawn({ layer: 'pressure', shown: g, want: g }); });
    render(<ForecastTimeStatus model="EURO" layer="pressure" hour={hourOf(g)} theme="dark" />);   // the button is EURO, the record still GFS
    act(() => { jest.advanceTimersByTime(PENDING_QUIET_MS / 2); });
    const eu = om('ecmwf_ifs025', 3, 'pressure_msl');
    act(() => { publishRasterDrawn({ layer: 'pressure', shown: eu, want: eu }); });   // EURO's frame lands
    act(() => { jest.advanceTimersByTime(PENDING_QUIET_MS * 3); });
    expect(screen.queryByText(/unavailable/)).toBeNull();
  });
  test('the COLLAPSED phone header: the same words on the chip (accessible name, opens the drawer), its own icon', () => {
    const e = fogGfs();
    act(() => { publishRasterDrawn({ layer: 'fog', shown: e, want: e }); });
    const onToggle = jest.fn();
    render(<TimelineDrawerHeader expanded={false} timeLabel="Now" onToggle={onToggle}
      stale={{ model: 'ICON', layer: 'fog', hour: 0, windOn: false }} />);
    const chip = screen.getByRole('button', { name: 'ICON fog unavailable: NOAA GFS shown' });
    expect(chip.getAttribute('data-stale-chip')).toBe('source');
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalled();
    expect(readStaleChip({ model: 'GFS', layer: 'fog', hour: 0 })).toBeNull();   // GFS picked: nothing to say
    window.__RAW_DISABLE_RASTER_SOURCE_WORDS__ = true;
    expect(readStaleChip({ model: 'ICON', layer: 'fog', hour: 0 })).toBeNull();
  });
  test('ICON water temp: a quiet source line (no delay, the quiet tone)', () => {
    act(() => { publishRasterDrawn({ layer: 'water_temp', shown: cmems, want: cmems }); });
    render(<ForecastTimeStatus model="ICON" layer="water_temp" hour={hourOf(cmems)} theme="light" />);
    const s = screen.getByRole('status');
    expect(s.textContent).toBe('Water Temp: Copernicus Marine ocean model, top layer, 1/6° grid');
    expect(s.className).toContain('text-slate-600');
  });
});
