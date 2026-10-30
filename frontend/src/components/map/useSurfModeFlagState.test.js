/**
 * D6 (2026-10-28; the lead's offline erratic fuzzer at 4bd90d0d9): after a phone rotation, the now-visible desktop panel's Surf Rating
 * button read OFF while window.__SURF_MODE__ was true. MapPage mounts both panels; each kept its own useState. Both are rendered here,
 * as MapPage mounts them, and the band is turned on from the phone sheet.
 */
import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react';
import { MapWeatherControls } from './MapWeatherControls';

let mockTheme = 'dark';
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
beforeEach(() => {
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(Object.fromEntries(
    ['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText'].map((k) => [k, jest.fn()])));
  window.__SURF_MODE__ = false;
  window.localStorage.setItem('__SURF_MODE__', 'false');
});
afterEach(() => { jest.restoreAllMocks(); delete window.__SURF_MODE__; delete window.__RAW_DISABLE_BAND_BUTTON_SYNC__; window.localStorage.removeItem('__SURF_MODE__'); });

const props = { activeModel: 'GFS', activeLayers: ['waves'], onTimeChange: () => {}, onModelChange: () => {}, onLayerToggle: () => {} };
const bothPanels = () => render(
  <>
    <div data-testid="desktop"><MapWeatherControls {...props} isDesktop /></div>
    <div data-testid="phone"><MapWeatherControls {...props} isDesktop={false} isMobileExpanded /></div>
  </>,
);
const band = (r, id) => within(r.getByTestId(id)).getAllByRole('button', { name: /Surf Rating: (ON|OFF)/ })[0];

describe.each(['light', 'dark', 'beach'])('%s: one band state for every mounted panel', (theme) => {
  beforeEach(() => { mockTheme = theme; });

  it('the band turned ON from the phone sheet reads ON in the desktop panel too (the rotation repro), and OFF again from the desktop', () => {
    const r = bothPanels();
    expect(band(r, 'desktop')).toHaveTextContent('Surf Rating: OFF');
    fireEvent.click(band(r, 'phone'));
    expect(window.__SURF_MODE__).toBe(true);
    expect(band(r, 'phone')).toHaveTextContent('Surf Rating: ON');
    expect(band(r, 'desktop')).toHaveTextContent('Surf Rating: ON');
    expect(band(r, 'desktop')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(band(r, 'desktop'));
    expect(window.__SURF_MODE__).toBe(false);
    expect(band(r, 'phone')).toHaveTextContent('Surf Rating: OFF');
    expect(band(r, 'phone')).toHaveAttribute('aria-pressed', 'false');
  });

  it('kill: __RAW_DISABLE_BAND_BUTTON_SYNC__ leaves the other panel stale, as before (the positive control)', () => {
    window.__RAW_DISABLE_BAND_BUTTON_SYNC__ = true;
    const r = bothPanels();
    fireEvent.click(band(r, 'phone'));
    expect(window.__SURF_MODE__).toBe(true);
    expect(band(r, 'desktop')).toHaveTextContent('Surf Rating: OFF');
  });
});

it('a panel mounted after the toggle reads the flag, and a toggle event with no click re-reads it', () => {
  window.__SURF_MODE__ = true;
  const r = bothPanels();
  expect(band(r, 'desktop')).toHaveTextContent('Surf Rating: ON');
  act(() => { window.__SURF_MODE__ = false; window.dispatchEvent(new CustomEvent('rawsurf:surf-toggle')); });
  expect(band(r, 'desktop')).toHaveTextContent('Surf Rating: OFF');
  expect(band(r, 'phone')).toHaveTextContent('Surf Rating: OFF');
});
