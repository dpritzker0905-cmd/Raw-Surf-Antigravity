import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
// Isolate the resolver's import-time capabilities fetch (same pattern as MapWeatherControls.playback.test.js).
const { MapWeatherControls } = (() => {
  const previousFetch = global.fetch;
  global.fetch = () => Promise.reject(new Error('Offline test: capabilities not acquired'));
  try { return require('./MapWeatherControls'); }
  finally { global.fetch = previousFetch; }
})();
let mockTheme = 'dark';
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
beforeEach(() => {
  window.localStorage.clear();
  delete window.__RAW_DISABLE_TIDE_OVERLAY__;
  delete window.__SURF_MODE__;
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(Object.fromEntries(
    ['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText'].map(k => [k, jest.fn()])));
});
afterEach(() => jest.restoreAllMocks());

// Tides sits beside Surf Rating (owner 2026-11-15): the desktop panel and the mobile sheet. The collapsed float has neither.
const LAYOUTS = { desktop: { isDesktop: true }, mobileSheet: { isDesktop: false, isMobileExpanded: true } };
const base = { activeModel: 'GFS', activeLayers: ['waves'], userTier: 'guest', onTimeChange() {}, onModelChange() {}, onLayerToggle() {}, onTogglePlay() {} };

test.each(['light', 'dark', 'beach'].flatMap(theme => Object.keys(LAYOUTS).map(l => [theme, l])))(
  '%s %s: Tides is a real button beside Surf Rating, aria-pressed, text state, independent of Surf Rating', (theme, layout) => {
    mockTheme = theme;
    render(<MapWeatherControls {...base} {...LAYOUTS[layout]} />);
    const toggle = screen.getByTestId('tide-overlay-toggle');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');   // ships ON
    expect(toggle).toHaveTextContent('Tides: ON');
    const surf = screen.getByRole('button', { name: /Surf Rating/ });
    expect(toggle.previousElementSibling).toBe(surf);   // beside Surf Rating
    fireEvent.click(surf);                              // Surf Rating ON leaves Tides ON (independent)
    expect(surf).toHaveTextContent('Surf Rating: ON');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveTextContent('Tides: OFF');
    expect(surf).toHaveTextContent('Surf Rating: ON');
  });

test('the collapsed mobile float carries no Tides button (it has no Surf Rating either)', () => {
  render(<MapWeatherControls {...base} isDesktop={false} />);
  expect(screen.queryByTestId('tide-overlay-toggle')).toBeNull();
});

test('kill switch removes the toggle from every layout', () => {
  window.__RAW_DISABLE_TIDE_OVERLAY__ = true;
  Object.values(LAYOUTS).forEach((l) => {
    const { unmount } = render(<MapWeatherControls {...base} {...l} />);
    expect(screen.queryByTestId('tide-overlay-toggle')).toBeNull();
    unmount();
  });
});
