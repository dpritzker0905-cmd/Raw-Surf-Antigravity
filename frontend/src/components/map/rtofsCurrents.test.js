// NOAA Global RTOFS currents under the GFS picker (2026-11-22): dark by default (GFS keeps Copernicus), the lever moves GFS
// alone to the RTOFS set, the kill wins over the lever, and the credit names the source drawn, never an atmospheric model.
import { MODEL_SOURCE, RTOFS_CURRENTS_DEFAULT_ON, RTOFS_CURRENTS_KEY, rtofsCurrentsOn, setKey, sourceModel } from './ownRasterFrames';
import { RASTER_SET_KEYS } from './staticRasterSets';
import { creditFor } from './LayerDataCredit';

const CMEMS = 'CMEMS/marine/currents/global_0p25';
afterEach(() => {
  delete window.__RAW_RTOFS_CURRENTS__;
  delete window.__RAW_DISABLE_RTOFS_CURRENTS__;
  try { window.localStorage.removeItem('__RAW_RTOFS_CURRENTS__'); } catch (e) { /* no storage */ }
});

describe('RTOFS currents for GFS', () => {
  test('dark: with no lever every model reads Copernicus', () => {
    expect(RTOFS_CURRENTS_DEFAULT_ON).toBe(false);
    expect(rtofsCurrentsOn()).toBe(false);
    for (const m of ['GFS', 'EURO', 'ICON']) expect(setKey('currents', m)).toBe(CMEMS);
  });
  test('the lever moves GFS alone to NOAA RTOFS; EURO and ICON keep Copernicus', () => {
    window.__RAW_RTOFS_CURRENTS__ = true;
    expect(setKey('currents', 'GFS')).toBe(RTOFS_CURRENTS_KEY);
    expect(setKey('currents', 'gfs')).toBe(RTOFS_CURRENTS_KEY);
    expect(sourceModel('currents', 'GFS')).toBe('RTOFS');
    expect(MODEL_SOURCE.RTOFS).toBe('NOAA RTOFS');
    expect(setKey('currents', 'EURO')).toBe(CMEMS);
    expect(setKey('currents', 'ICON')).toBe(CMEMS);
    expect(setKey('gusts', 'GFS')).toBe('GFS/weather/gust/global_0p25');   // no other layer moves
    expect(RASTER_SET_KEYS).toContain(RTOFS_CURRENTS_KEY);
  });
  test('the lever also reads from localStorage', () => {
    window.localStorage.setItem('__RAW_RTOFS_CURRENTS__', 'true');
    expect(setKey('currents', 'GFS')).toBe(RTOFS_CURRENTS_KEY);
  });
  test('the kill sends GFS back to Copernicus, over the lever', () => {
    window.__RAW_RTOFS_CURRENTS__ = true;
    window.__RAW_DISABLE_RTOFS_CURRENTS__ = true;
    expect(rtofsCurrentsOn()).toBe(false);
    expect(setKey('currents', 'GFS')).toBe(CMEMS);
  });
  test('the credit names NOAA RTOFS or Copernicus Marine, never GFS / ECMWF / DWD', () => {
    const r = creditFor('currents', { currents: 'RTOFS' }, {});
    expect(r.text).toBe('NOAA RTOFS · open-ocean current; no tides, not a nearshore / rip current');
    expect(r.label).toMatch(/NOAA's global RTOFS model/);
    expect(r.label).toMatch(/Real-Time Ocean Forecast System/);
    expect(r.href).toBe('https://polar.ncep.noaa.gov/global/');
    const c = creditFor('currents', { currents: 'CMEMS' }, {});
    expect(c.text).toBe('© Copernicus Marine · open-ocean current; no tides, not a nearshore / rip current');
    for (const x of [r, c]) expect(`${x.text} ${x.label}`).not.toMatch(/\bGFS\b|ECMWF|DWD|ICON/);
  });
});
