import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { omEnd, describeRasterFrame, publishRasterDrawn, getRasterDrawn, _resetRasterDrawnForTest, PENDING_QUIET_MS } from './rasterDrawnFrame';
import ForecastTimeStatus from './ForecastTimeStatus';

const hourly = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 9, 22, 12 + i)).toISOString());
const threeHourly = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 9, 22, 12 + 3 * i)).toISOString());
const CACHE = { ncep_gfs013: { validTimes: hourly }, ecmwf_ifs025: { validTimes: threeHourly } };
const u = (model, i) => `om://https://openmeteo.s3.amazonaws.com/data_spatial/${model}/latest.json?time_step=valid_times_${i}&variable=precipitation&contours=true`;
const end = (model, i) => omEnd(u(model, i), CACHE);

afterEach(() => { _resetRasterDrawnForTest(); delete window.__RAW_DISABLE_RASTER_DRAWN_READOUT__; jest.useRealTimers(); });

describe('omEnd', () => {
  test('data instant from the model axis; half the local gap (hourly 0, 3-hourly 1)', () => {
    expect(end('ncep_gfs013', 10)).toMatchObject({ dataMs: Date.parse(hourly[10]), model: 'GFS', nearestMaxHours: 0 });
    expect(end('ecmwf_ifs025', 4)).toMatchObject({ dataMs: Date.parse(threeHourly[4]), model: 'EURO', nearestMaxHours: 1 });
  });
  test('transparent / unknown model / index off the axis: null', () => {
    expect(omEnd('om://transparent-tile', CACHE)).toBeNull();
    expect(omEnd(u('dwd_icon', 1), CACHE)).toBeNull();
    expect(omEnd(u('ncep_gfs013', 99), CACHE)).toBeNull();
  });
});

describe('describeRasterFrame', () => {
  test('shown is the wanted slot: nothing to say', () => {
    const e = end('ncep_gfs013', 10);
    expect(describeRasterFrame({ layer: 'rain', shown: e, want: e }, 'rain', e.dataMs)).toBeNull();
  });
  test('an older hour held while the asked one loads: pending, with both times', () => {
    const r = describeRasterFrame({ layer: 'rain', shown: end('ncep_gfs013', 10), want: end('ncep_gfs013', 11) }, 'rain', Date.parse(hourly[11]));
    expect(r.state).toBe('pending');
    expect(r.text).toMatch(/^Loading .+… still showing .+/);
  });
  test('a model switch names the models', () => {
    const r = describeRasterFrame({ layer: 'rain', shown: end('ncep_gfs013', 10), want: end('ecmwf_ifs025', 4) }, 'rain', 0);
    expect(r.text).toBe('Loading EURO Precip… still showing GFS Precip');
  });
  test('nothing shown yet (toggle on): loading the asked hour', () => {
    expect(describeRasterFrame({ layer: 'fog', shown: null, want: end('ncep_gfs013', 3) }, 'fog', 0).text).toMatch(/^Loading Fog /);
  });
  test('EURO 3-hourly: the nearest stored forecast, said as such', () => {
    const e = end('ecmwf_ifs025', 4);
    const r = describeRasterFrame({ layer: 'rain', shown: e, want: e }, 'rain', e.dataMs + 3600000);
    expect(r.state).toBe('nearest');
    expect(describeRasterFrame({ layer: 'rain', shown: e, want: e }, 'rain', e.dataMs + 30 * 60000)).toBeNull();
  });
  test('another layer\'s record, or the kill: null', () => {
    const e = end('ncep_gfs013', 1);
    expect(describeRasterFrame({ layer: 'fog', shown: e, want: end('ncep_gfs013', 2) }, 'rain', 0)).toBeNull();
    window.__RAW_DISABLE_RASTER_DRAWN_READOUT__ = true;
    expect(describeRasterFrame({ layer: 'rain', shown: e, want: end('ncep_gfs013', 2) }, 'rain', 0)).toBeNull();
  });
  test('radar: clock times, no nearest state', () => {
    const shown = { url: 'radar-frame-a', dataMs: Date.UTC(2026, 9, 22, 21, 30) };
    const want = { url: 'radar-frame-b', dataMs: Date.UTC(2026, 9, 22, 21, 40) };
    expect(describeRasterFrame({ layer: 'radar', shown, want }, 'radar', want.dataMs).text).toMatch(/:40 .M… still showing .*:30 /);
    expect(describeRasterFrame({ layer: 'radar', shown: want, want }, 'radar', want.dataMs)).toBeNull();
  });
});

describe('publish', () => {
  test('an identical pair is not re-published', () => {
    const e = end('ncep_gfs013', 1);
    publishRasterDrawn({ layer: 'rain', shown: e, want: e });
    const first = getRasterDrawn();
    publishRasterDrawn({ layer: 'rain', shown: { ...e }, want: { ...e } });
    expect(getRasterDrawn()).toBe(first);
    expect(window.__RASTER_DRAWN__).toBe(first);
  });
});

describe('ForecastTimeStatus on a raster layer', () => {
  test('a pending pair speaks only after the quiet period, as a polite status', () => {
    jest.useFakeTimers();
    const hourNow = Math.round((Date.parse(hourly[11]) - Date.now()) / 3600000);
    act(() => { publishRasterDrawn({ layer: 'rain', shown: { ...end('ncep_gfs013', 10) }, want: { ...end('ncep_gfs013', 11) } }); });
    render(<ForecastTimeStatus model="GFS" layer="rain" hour={hourNow} theme="dark" />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { jest.advanceTimersByTime(PENDING_QUIET_MS + 10); });
    const s = screen.getByRole('status');
    expect(s.textContent).toMatch(/still showing/);
    expect(s.getAttribute('aria-live')).toBe('polite');
  });
  test('an instant step (shown == wanted) never flashes a line; the marine record is never read for rasters', () => {
    jest.useFakeTimers();
    const e = end('ncep_gfs013', 11);
    act(() => { publishRasterDrawn({ layer: 'rain', shown: e, want: e }); });
    render(<ForecastTimeStatus model="GFS" layer="rain" hour={Math.round((e.dataMs - Date.now()) / 3600000)} theme="light" />);
    act(() => { jest.advanceTimersByTime(PENDING_QUIET_MS + 600); });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('a layer drawn from our own frames (useOwnRasterFrames)', () => {
  const { setEngaged, _resetOwnRasterFramesForTest } = require('./ownRasterFrames');
  const { useRasterDrawnPublisher } = require('./rasterDrawnFrame');
  function Pub({ layers }) { useRasterDrawnPublisher(layers, {}, {}, { current: {} }); return null; }
  afterEach(() => _resetOwnRasterFramesForTest());
  test('the .om publisher never clears its record; another layer\'s record it does', () => {
    const end = (h) => ({ url: `f${h}`, dataMs: Date.UTC(2026, 9, 23, h), model: 'GFS', nearestMaxHours: 1 });
    setEngaged('pressure', true);
    publishRasterDrawn({ layer: 'pressure', shown: end(15), want: end(15) });
    const { rerender } = render(<Pub layers={[]} />);
    expect(getRasterDrawn().layer).toBe('pressure');
    act(() => setEngaged('pressure', false));
    rerender(<Pub layers={['waves']} />);
    expect(getRasterDrawn()).toBeNull();
  });
  test('its 3-hourly frames read as the nearest stored forecast one hour off', () => {
    const shown = { url: 'f15', dataMs: Date.UTC(2026, 9, 23, 15), model: 'GFS', nearestMaxHours: 1 };
    const d = describeRasterFrame({ layer: 'pressure', shown, want: shown }, 'pressure', Date.UTC(2026, 9, 23, 16));
    expect(d.state).toBe('nearest');
  });
});
