import React, { StrictMode } from 'react';
jest.mock('./radarTileRecolor', () => ({ registerRadarRecolorProtocol: jest.fn() }));
jest.mock('./marineController', () => ({ getModelSafeMarine: jest.fn(), prewarmGlobalMarineGrid: jest.fn() }));
jest.mock('./radarForecastSources', () => ({ radarFutureFramesForModel: () => [], radarRegionForCenter: () => 'CONUS', discoverHrrrRun: () => Promise.resolve(null), HRRR_RUN_TTL_MS: 300000, rainviewerCatalogUrl: () => '/offline-radar-catalog' }));
import { act, fireEvent, render, screen } from '@testing-library/react';

// CRA/Jest's resolver cannot follow these installed package export-map entries.
// These shims load real CJS entries; navigation, contexts and hooks are not mocked.
jest.mock('react-router-dom', () => jest.requireActual('../../../node_modules/react-router-dom/dist/index.js'), { virtual: true });
jest.mock('react-router/dom', () => jest.requireActual('../../../node_modules/react-router/dist/development/dom-export.js'), { virtual: true });

const { TextEncoder, TextDecoder } = require('util');
if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;
const { MemoryRouter, Routes, Route, Link, useNavigate } = require('react-router-dom');
const originalFetch = global.fetch;
const { default: useMapWeatherRouteMemory, clearMapWeatherRouteMemory } = (() => {
  global.fetch = () => Promise.reject(new Error('Offline route UI test'));
  try { return require('./useMapWeatherRouteMemory'); }
  finally { global.fetch = originalFetch; }
})();
const { useWeatherState } = require('../../hooks/useWeatherState');
const NOW = Date.parse('2026-11-08T12:00:00Z');
const H = 3600000;
const USER = { id: 'route-user', subscription_tier: 'tier_4' };

function MapView({ user, model }) {
  // MapPage's real state provider and public setters, not fake restore state.
  const { activeLayers: layers, setActiveLayers: setLayers, timeOffsetHours: hour,
    setTimeOffsetHours: setHour, isPlayingTimeline: playing, setIsPlayingTimeline: setPlaying } = useWeatherState({ user });
  const navigate = useNavigate();
  useMapWeatherRouteMemory({ user, activeModel: model, activeLayers: layers, timeOffsetHours: hour,
    setActiveLayers: setLayers, setTimeOffsetHours: setHour, setIsPlayingTimeline: setPlaying });
  return <>
    <output aria-label="Layer">{layers[0] || 'none'}</output><output aria-label="Hour">{hour}</output>
    <output aria-label="Playing">{String(playing)}</output><output aria-label="Model">{model}</output>
    <button onClick={() => setLayers(['waves'])}>Waves</button>
    <button onClick={() => setLayers(['radar'])}>Radar</button><button onClick={() => setLayers(['satellite'])}>Satellite</button>
    <button onClick={() => setLayers(['unrecognized-layer'])}>Other layer</button>
    <button onClick={() => setHour(4)}>Select four</button><button onClick={() => setHour(7)}>Select seven</button>
    <button onClick={() => setHour(48)}>Select forty-eight</button><button onClick={() => setPlaying(true)}>Play</button>
    <Link to="/theme">Theme</Link><Link to="/map?view=second">Another map entry</Link>
    <button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button>
  </>;
}
function Away() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate(-1)}>Back</button><Link to="/map">New map visit</Link></>;
}
function App({ user = USER, model = 'GFS' }) {
  return <StrictMode><MemoryRouter initialEntries={['/map']}><Routes>
    <Route path="/map" element={<MapView user={user} model={model} />} /><Route path="/theme" element={<Away />} />
  </Routes></MemoryRouter></StrictMode>;
}
const click = name => fireEvent.click(screen.getByRole('button', { name, exact: true }));
const leave = () => fireEvent.click(screen.getByRole('link', { name: 'Theme' }));
beforeEach(() => {
  clearMapWeatherRouteMemory();
  window.__MOCK_DATE_NOW__ = NOW;
  delete window.__WEATHER_CAPABILITIES__;
  delete window.__FORCE_PREMIUM_TIER__;
  global.fetch = jest.fn(() => Promise.reject(new Error('Offline route UI test')));
});
afterEach(() => {
  clearMapWeatherRouteMemory(); global.fetch = originalFetch;
  delete window.__MOCK_DATE_NOW__; delete window.__WEATHER_CAPABILITIES__;
});

test('real Back and Forward retain the latest layer/hour while playback stays stopped', () => {
  render(<App />); click('Waves'); click('Select four'); click('Play'); leave(); click('Back');
  expect(screen.getByLabelText('Layer')).toHaveTextContent('waves');
  expect(screen.getByLabelText('Hour')).toHaveTextContent('4');
  expect(screen.getByLabelText('Playing')).toHaveTextContent('false');
  click('Select seven'); click('Forward'); click('Back');
  expect(screen.getByLabelText('Hour')).toHaveTextContent('7');
});
test('a new map entry does not reuse another history entry', () => {
  render(<App />); click('Waves'); click('Select four'); leave();
  fireEvent.click(screen.getByRole('link', { name: 'New map visit' }));
  expect(screen.getByLabelText('Layer')).toHaveTextContent('none');
  expect(screen.getByLabelText('Hour')).toHaveTextContent('0');
});
test.each([
  { id: 'different-user', subscription_tier: 'tier_4' },
  { id: USER.id, subscription_tier: 'tier_1' },
])('changed account or entitlement does not revive old intent: %j', user => {
  const { rerender } = render(<App />); click('Waves'); click('Select four'); leave();
  rerender(<App user={user} />); click('Back');
  expect(screen.getByLabelText('Layer')).toHaveTextContent('none');
  expect(screen.getByLabelText('Hour')).toHaveTextContent('0');
});
test.each([[true, 2, 2], [false, 2, 0], [true, 5, 0]])('shared clock restores absolute selection or fresh Now: %s/%s', (future, elapsed, expected) => {
  render(<App />); click('Waves'); if (future) click('Select four'); leave();
  act(() => { window.__MOCK_DATE_NOW__ = NOW + elapsed * H; }); click('Back');
  expect(screen.getByLabelText('Hour')).toHaveTextContent(String(expected));
});
test('current published window caps restored selection, rather than retaining an old limit', () => {
  const cap = max => [{ model: 'GFS', layer: 'waves', domain: 'marine', supports_grid: true, max_forecast_hours: max }];
  window.__WEATHER_CAPABILITIES__ = cap(72);
  render(<App />); click('Waves'); click('Select forty-eight'); leave();
  window.__WEATHER_CAPABILITIES__ = cap(24); click('Back');
  expect(screen.getByLabelText('Layer')).toHaveTextContent('waves');
  expect(screen.getByLabelText('Hour')).toHaveTextContent('24');
});
test('a newer model preference is not overwritten by a history entry', () => {
  const { rerender } = render(<App />); click('Waves'); click('Select four'); leave();
  rerender(<App model="EURO" />); click('Back');
  expect(screen.getByLabelText('Model')).toHaveTextContent('EURO');
  expect(screen.getByLabelText('Layer')).toHaveTextContent('none');
});

test.each(['Radar', 'Satellite'])('real-time %s returns to its fresh catalog instead of an old forecast hour', name => {
  render(<App />); click('Select four'); click(name); leave(); click('Back');
  expect(screen.getByLabelText('Layer')).toHaveTextContent(name.toLowerCase());
  expect(screen.getByLabelText('Hour')).toHaveTextContent('0');
});
test('unsupported current intent removes an older saved entry rather than reviving it', () => {
  render(<App />); click('Waves'); click('Select four'); leave(); click('Back');
  click('Other layer'); leave(); click('Back');
  expect(screen.getByLabelText('Layer')).toHaveTextContent('none');
  expect(screen.getByLabelText('Hour')).toHaveTextContent('0');
});

test('a POP between map entries sharing one mounted state provider stops playback before restoring the selected hour', () => {
  render(<App />); click('Waves'); click('Select four');
  fireEvent.click(screen.getByRole('link', { name: 'Another map entry' }));
  click('Select seven'); click('Play'); expect(screen.getByLabelText('Playing')).toHaveTextContent('true');
  click('Back'); expect(screen.getByLabelText('Hour')).toHaveTextContent('4');
  expect(screen.getByLabelText('Layer')).toHaveTextContent('waves');
  expect(screen.getByLabelText('Playing')).toHaveTextContent('false');
});
