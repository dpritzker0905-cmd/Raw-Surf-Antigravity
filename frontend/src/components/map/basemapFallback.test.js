import React from 'react';
import { render, screen, renderHook, act } from '@testing-library/react';
import {
  FALLBACK_PALETTES, basemapStyleFailure, getFallbackMapStyle, publishBasemapDiag,
} from './basemapFallback';
import BasemapFallbackNotice from './BasemapFallbackNotice';
import { useMapErrorSurface } from './useMapErrorSurface';
import { findMarineInsertionLayer } from './mapUtils';
import { isBasemapWaterSourceReady } from './WebGLMarineMaskRenderer';
import fs from 'fs';
import path from 'path';

jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: global.__TEST_THEME__ || 'dark' }),
}));
jest.mock('./WeatherTelemetry', () => ({
  WeatherTelemetry: { trackMapError: jest.fn(), trackWebGLContextLost: jest.fn(), trackWebGLContextRestored: jest.fn() },
}));

const THEMES = ['dark', 'light', 'beach'];
const TOKEN = process.env.REACT_APP_MAPBOX_TOKEN;
// AJAXError shape maplibre fires when the style JSON request fails. The token value is a
// placeholder; nothing here reaches the network.
const styleError = (status, path = 'mapbox/navigation-night-v1') => ({
  error: { status, url: `https://api.mapbox.com/styles/v1/${path}?access_token=pk.placeholder` },
  target: {},
});

afterEach(() => {
  delete global.__TEST_THEME__;
  delete window.__BASEMAP_DIAG__;
  if (TOKEN === undefined) delete process.env.REACT_APP_MAPBOX_TOKEN;
  else process.env.REACT_APP_MAPBOX_TOKEN = TOKEN;
});

describe('getFallbackMapStyle', () => {
  it.each(THEMES)('%s: a local style that needs no token and no third-party host', (theme) => {
    const style = getFallbackMapStyle(theme);
    expect(style.version).toBe(8);
    const text = JSON.stringify(style);
    expect(text).not.toMatch(/mapbox/i);
    expect(text).not.toMatch(/access_token/);
    expect(style.sources['fallback-land'].data).toBe(`${window.location.origin}/ne_50m_land.json`);
    expect(style.layers.find((l) => l.id === 'water').paint['background-color']).toBe(FALLBACK_PALETTES[theme].ocean);
  });

  it('gives each theme its own palette, and an unknown theme the dark one', () => {
    const oceans = THEMES.map((t) => getFallbackMapStyle(t).layers[0].paint['background-color']);
    expect(new Set(oceans).size).toBe(3);
    expect(getFallbackMapStyle('nope').layers[0].paint['background-color']).toBe(FALLBACK_PALETTES.dark.ocean);
  });

  it('keeps the layer-id contract: marine rasters land between water and land', () => {
    // The same finder the marine engine uses; with no OceanMask it must pick `land`, so weather
    // draws over the ocean and under the land exactly as on the Mapbox styles.
    const style = getFallbackMapStyle('dark');
    expect(findMarineInsertionLayer({ getStyle: () => style })).toBe('land');
  });
});

describe('basemapStyleFailure', () => {
  it.each([
    [styleError(401), 'style_http_401'],
    [styleError(403, 'mapbox/outdoors-v11'), 'style_http_403'],
    [{ error: { url: 'https://api.mapbox.com/styles/v1/mapbox/navigation-day-v1?access_token=x' } }, 'style_http_0'],
  ])('reads a failed style request as basemap loss (%#)', (event, reason) => {
    expect(basemapStyleFailure(event)).toBe(reason);
  });

  it.each([
    ['a sprite', 'https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/sprite@2x.json?access_token=x'],
    ['a vector tile', 'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/3/2/1.vector.pbf?access_token=x'],
    ['a font', 'https://api.mapbox.com/fonts/v1/mapbox/DIN/0-255.pbf?access_token=x'],
    ['a weather request', 'https://raw-surf-antigravity.onrender.com/api/weather/grid'],
  ])('ignores %s failing (the style itself still drew)', (_, url) => {
    expect(basemapStyleFailure({ error: { status: 401, url } })).toBeNull();
  });

  it('ignores events with no request URL', () => {
    expect(basemapStyleFailure({ error: new Error('WebGL context lost') })).toBeNull();
    expect(basemapStyleFailure(null)).toBeNull();
  });

  it('never carries the URL (and so the token) into the reason', () => {
    expect(basemapStyleFailure(styleError(401))).not.toMatch(/token|http[s]?:/);
  });
});

describe('useMapErrorSurface basemap fallback', () => {
  const setup = () => renderHook(() => useMapErrorSurface({
    mapInstance: null, innerMapRef: { current: {} }, setWebglWindFailed: jest.fn(), setWebglMarineFailed: jest.fn(),
  }));

  it('starts on the fallback when the build has no token (no doomed request first)', () => {
    delete process.env.REACT_APP_MAPBOX_TOKEN;
    const { result } = setup();
    expect(result.current.basemapFallbackReason).toBe('no_token');
    expect(window.__BASEMAP_DIAG__).toMatchObject({ mode: 'fallback', reason: 'no_token' });
  });

  it('switches to the fallback when the style is refused, without the startup panel', () => {
    process.env.REACT_APP_MAPBOX_TOKEN = 'pk.placeholder';
    const { result } = setup();
    expect(result.current.basemapFallbackReason).toBeNull();
    expect(window.__BASEMAP_DIAG__).toMatchObject({ mode: 'mapbox', reason: null });
    act(() => { result.current.onMapError(styleError(401)); });
    expect(result.current.basemapFallbackReason).toBe('style_http_401');
    expect(result.current.mapUnavailableReason).toBeNull();
    expect(window.__BASEMAP_DIAG__).toMatchObject({ mode: 'fallback', reason: 'style_http_401' });
    act(() => { result.current.onMapError(styleError(403)); });
    expect(result.current.basemapFallbackReason).toBe('style_http_401');   // first cause kept
  });

  it('leaves a tile error alone (the map is drawing)', () => {
    process.env.REACT_APP_MAPBOX_TOKEN = 'pk.placeholder';
    const { result } = setup();
    act(() => { result.current.onMapError({ error: { status: 401, url: 'https://api.mapbox.com/v4/x/1/1/1.pbf' }, target: {} }); });
    expect(result.current.basemapFallbackReason).toBeNull();
  });
});

describe('BasemapFallbackNotice', () => {
  it('announces politely, in text, without taking the map from the user', () => {
    render(<BasemapFallbackNotice reason="style_http_401" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(/simplified coastlines/i);
    expect(status).toHaveTextContent(/forecasts are unaffected/i);
    expect(screen.getByTestId('basemap-fallback-notice').className).toMatch(/pointer-events-none/);
  });

  it.each(THEMES)('renders a theme-appropriate surface in %s', (theme) => {
    global.__TEST_THEME__ = theme;
    render(<BasemapFallbackNotice reason="no_token" />);
    const cls = screen.getByRole('status').className;
    if (theme === 'light') expect(cls).toMatch(/bg-white/);
    else if (theme === 'beach') expect(cls).toMatch(/cyan/);
    else expect(cls).toMatch(/bg-zinc-900/);
  });
});

describe('publishBasemapDiag', () => {
  it('reports mapbox when no fallback reason is set', () => {
    publishBasemapDiag(null);
    expect(window.__BASEMAP_DIAG__).toMatchObject({ mode: 'mapbox', reason: null });
  });
});

describe('consumers of the basemap water source stay quiet on the fallback', () => {
  // Found live 2026-09-26 by loading the fallback style into the running map: both of these assumed
  // Mapbox's `composite` source, and maplibre answered each probe with an `error` event
  // ("There is no tile manager with ID 'composite'", "source \"composite\" not found").
  const fakeMap = (hasSource) => ({
    getStyle: () => getFallbackMapStyle('dark'),
    getSource: jest.fn(() => (hasSource ? {} : undefined)),
    isSourceLoaded: jest.fn(() => true),
    areTilesLoaded: () => true,
  });

  it('the mask readiness probe fails open without asking about a source that is not there', () => {
    const m = fakeMap(false);
    expect(isBasemapWaterSourceReady(m)).toBe(true);
    expect(m.isSourceLoaded).not.toHaveBeenCalled();
  });

  it('...and still asks when the basemap does have one (Mapbox styles unchanged)', () => {
    const m = fakeMap(true);
    expect(isBasemapWaterSourceReady(m)).toBe(true);
    expect(m.isSourceLoaded).toHaveBeenCalledTimes(1);
  });

  it('OceanMask adds the inland water layers only when their source exists, and restyles only layers it has', () => {
    const src = fs.readFileSync(path.join(__dirname, 'OceanMask.js'), 'utf8');
    expect(src).toContain('if (!hasWater && mapInstance.getSource(waterSource))');
    expect(src).toContain('if (!hasWaterway && mapInstance.getSource(waterwaySource))');
    expect(src).toContain('} else if (hasWater) {');
    expect(src).toContain('} else if (hasWaterway) {');
  });
});
