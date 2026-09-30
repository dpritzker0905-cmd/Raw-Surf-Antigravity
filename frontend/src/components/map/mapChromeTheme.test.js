/**
 * W-10 R4 (2026-09-30): the map's floating chrome in all three themes (CLAUDE.md: light, dark AND beach).
 * A production build in 3 themes x desktop/mobile found MapHeader, MapFilterTabs, RequestProButton and
 * MapRightControls single-theme (zinc-800 / text-white everywhere: the "Live Map" title vanished on the light and
 * beach basemaps), RequestProButton's label cut to "Request a " since da30f15d, and the weather chips' light
 * muted text under AA contrast. These pin the palette (dark unchanged), each control in each theme, the bare
 * render, the label, and a source guard against the dark literals coming back.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { mapChromeTheme } from './mapChromeTheme';
import { MapHeader } from './MapHeader';
import { MapFilterTabs } from './MapFilterTabs';
import { RequestProButton } from './RequestProButton';
import { MapRightControls } from './MapRightControls';

jest.mock('sonner', () => ({ toast: { info: jest.fn() } }));

const THEMES = ['light', 'dark', 'beach'];
const noop = () => {};

const renderIn = (theme, ui) => {
  window.localStorage.setItem('raw-surf-theme', theme);
  return render(<ThemeProvider>{ui}</ThemeProvider>);
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('the palette', () => {
  test('dark is exactly the classes these controls carried before (no dark regression)', () => {
    const d = mapChromeTheme('dark');
    expect(d.title).toBe('text-white drop-shadow-lg');
    expect(d.chipIdle).toBe('bg-zinc-800/90 text-gray-300 hover:bg-zinc-700');
    expect(d.requestIdle).toBe('bg-zinc-800/90 text-gray-300 hover:bg-zinc-700');
    expect(d.fab).toBe('bg-zinc-800/90 text-white hover:bg-zinc-700');
    expect(d.dropdown).toBe('bg-zinc-800/95 border-zinc-700');
    expect(d.iconButton).toBe('text-gray-400 hover:text-white');
  });

  test.each(['light', 'beach'])('%s carries none of the dark-only surfaces, and its title is not white', (theme) => {
    const t = mapChromeTheme(theme);
    for (const [k, v] of Object.entries(t)) expect([k, v]).not.toEqual([k, expect.stringContaining('bg-zinc-800')]);
    expect(t.title).not.toContain('text-white');
  });

  test('light keeps the darker muted shades that pass AA on white', () => {
    const l = mapChromeTheme('light');
    expect(l.mutedText).toBe('text-gray-600');
    expect(l.activeYellow).toBe('text-yellow-600');
  });

  test('an unknown theme falls back to dark', () => {
    expect(mapChromeTheme(undefined)).toEqual(mapChromeTheme('dark'));
  });
});

describe('each control follows the theme', () => {
  test.each(THEMES)('MapHeader in %s', (theme) => {
    renderIn(theme, <MapHeader livePhotographerCount={3} />);
    const title = screen.getByTestId('map-title');
    const c = mapChromeTheme(theme);
    for (const cls of c.title.split(' ')) expect(title.className).toContain(cls);
    expect(screen.getByTestId('live-count').className).toContain(c.mutedText);
  });

  test.each(THEMES)('MapFilterTabs in %s', (theme) => {
    renderIn(theme, <MapFilterTabs filter="all" onFilterChange={noop} locationDenied surfSpots={[]} />);
    const c = mapChromeTheme(theme);
    const input = screen.getByTestId('map-spot-search-input');
    expect(input.className).toContain(c.surface.split(' ')[0]);
    expect(input.className).toContain(c.surfaceText);
    expect(screen.getByTestId('map-filter-spots').className).toContain(c.chipIdle.split(' ')[0]);
    expect(screen.getByText('Location denied').className).toContain(c.danger);
  });

  test.each(THEMES)('RequestProButton in %s, and its label says what it does', (theme) => {
    renderIn(theme, <RequestProButton userLocation={{ lat: 0 }} requestProLocationLoading={false}
      setPendingRequestPro={noop} setRequestProLocationLoading={noop} setLocationDenied={noop}
      getUserLocation={noop} setShowRequestProModal={noop} />);
    const btn = screen.getByTestId('request-pro-btn');
    expect(btn.textContent.trim()).toBe('Request a Pro');
    expect(btn.className).toContain(mapChromeTheme(theme).requestIdle.split(' ')[0]);
    expect(btn.className).toContain('border-cyan-500/50');
  });

  test.each(THEMES)('MapRightControls in %s', (theme) => {
    renderIn(theme, <MapRightControls userLocation={null} gpsLoading={false} showFeaturedPanel showFriendsOnMap={false}
      friendsOnMap={[]} onGetLocation={noop} onToggleFeatured={noop} onToggleFriends={noop} onToggleWeatherControls={noop} />);
    const c = mapChromeTheme(theme);
    for (const id of ['gps-location-btn', 'featured-photographers-btn', 'friends-on-map-btn', 'weather-layers-btn']) {
      expect(screen.getByTestId(id).className).toContain(c.fab.split(' ')[0]);
    }
  });

  test('rendered bare (no ThemeProvider) the controls do not throw, and read as dark', () => {
    render(<MapHeader />);
    expect(screen.getByTestId('map-title').className).toContain('text-white');
  });
});

describe('source guards', () => {
  const MAP = path.join(__dirname);
  test.each(['MapHeader.js', 'MapFilterTabs.js', 'RequestProButton.js', 'MapRightControls.js'])(
    '%s carries no hardcoded dark surface', (file) => {
      const src = fs.readFileSync(path.join(MAP, file), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//'));
      expect(src.join('\n')).not.toMatch(/['"`][^'"`]*bg-zinc-800\/9[05]/);
      expect(src.join('\n')).toContain('mapChromeTheme(useThemeName())');
    });

  test("the weather controls' light muted text is the AA shade", () => {
    const src = fs.readFileSync(path.join(MAP, 'MapWeatherControls.js'), 'utf8');
    expect(src).toContain("const textMuted = isLight ? 'text-gray-600' : 'text-gray-400';");
  });
});
