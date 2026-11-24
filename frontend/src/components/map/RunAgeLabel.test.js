/**
 * The always-on run age (reliability lane, 2026-11-24): the served model run's time, source and age under the timeline, on the
 * collapsed phone header, and a stale run on the stale-layer chip. Pins: server verdict first, the client's manifest read as a
 * labelled fallback, the cutoff in WORDS (never colour alone), three themes, the accessible names, and the kill switch.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import RunAgeLabel from './RunAgeLabel';
import TimelineDrawerHeader from './TimelineDrawerHeader';
import { readStaleChip } from './StaleLayerChip';
import { readRunAge, CUTOFF_H } from './runAgeReadout';

jest.mock('./backendWeatherServiceClientCoverage', () => ({
  ...jest.requireActual('./backendWeatherServiceClientCoverage'), getCachedManifest: jest.fn(() => null) }));
import { getCachedManifest } from './backendWeatherServiceClientCoverage';

const NOW = Date.parse('2026-11-24T03:30:00Z');
const caps = (runAge) => [{ model: 'GFS', domain: 'marine', layer: 'waves', run_age: runAge }];
const prod = (model, region, cycle) => ({ model, layer: 'waves', domain: 'marine', region_id: region,
  model_run_time: cycle, model_run_time_status: 'known' });

beforeEach(() => {
  delete window.__WEATHER_CAPABILITIES__;
  delete window.__RAW_DISABLE_RUN_AGE_LABEL__;
  delete window.__RAW_DISABLE_STALE_CHIP__;
  getCachedManifest.mockReturnValue(null);
});

test('a frozen server verdict never hides a run that has aged past the cutoff on an open page', () => {
  // /capabilities loaded when the run was fresh (stale: false); 25 h later the page is still open (advisor, #1268)
  window.__WEATHER_CAPABILITIES__ = caps({ cycle: new Date(Date.now() - 25 * 3600000).toISOString(), age_h: 3, cutoff_h: 18,
    stale: false, source: 's' });
  const r = readRunAge({ model: 'GFS', layer: 'waves' });
  expect(r).toMatchObject({ by: 'server', ageH: 25, stale: true });
  expect(r.text).toContain('older than 18 h');
  expect(readStaleChip({ model: 'GFS', layer: 'waves', hour: 0 })).toMatchObject({ kind: 'run', short: 'GFS run 25 h old (stale)' });
});

test('the client fallback reads GLOBAL products only, as the server does', () => {
  getCachedManifest.mockReturnValue({ products: [
    prod('EURO', 'global_mid', '2026-11-23T00:00:00Z'),
    prod('EURO', 'hawaii', '2026-11-24T00:00:00Z'),          // a newer REGIONAL tile must not stand in for the world run
  ] });
  const r = readRunAge({ model: 'EURO', layer: 'waves', nowMs: NOW });
  expect(r).toMatchObject({ by: 'client', cycleMs: Date.parse('2026-11-23T00:00:00Z') });
  getCachedManifest.mockReturnValue({ products: [prod('EURO', 'hawaii', '2026-11-24T00:00:00Z')] });
  expect(readRunAge({ model: 'EURO', layer: 'waves', nowMs: NOW })).toBeNull();   // regional only: no world run known
});

test('the server verdict names the run, its age and its source', () => {
  window.__WEATHER_CAPABILITIES__ = caps({ cycle: '2026-11-23T12:00:00Z', age_h: 15.5, cutoff_h: 18, stale: false, source: 'ncep_gfswave025' });
  const r = readRunAge({ model: 'GFS', layer: 'waves', nowMs: NOW });
  expect(r).toMatchObject({ by: 'server', ageH: 16, stale: false, source: 'ncep_gfswave025', short: 'GFS run 16 h old' });
  expect(r.text).toMatch(/^GFS model run .*\(12Z\), 16 h old\. Source: ncep_gfswave025$/);
});

test('a stuck run past the cutoff says so in words', () => {
  window.__WEATHER_CAPABILITIES__ = caps({ cycle: '2026-11-23T00:00:00Z', age_h: 27.5, cutoff_h: 18, stale: true, source: 'x' });
  const r = readRunAge({ model: 'GFS', layer: 'waves', nowMs: NOW });
  expect(r.stale).toBe(true);
  expect(r.text).toContain('older than 18 h: newer runs have not arrived');
  expect(r.short).toBe('GFS run 28 h old (stale)');
});

test('without the server field the client reads its manifest, against the same cutoffs, and says so', () => {
  getCachedManifest.mockReturnValue({ products: [prod('ICON', 'global_mid', '2026-11-22T12:00:00Z')] });
  const r = readRunAge({ model: 'ICON', layer: 'waves', nowMs: NOW });
  expect(r).toMatchObject({ by: 'client', cutoffH: CUTOFF_H.ICON, stale: true });
  expect(r.text).toContain('read from the app’s copy of the forecast list');
  expect(CUTOFF_H).toEqual({ GFS: 18, EURO: 30, ICON: 30, ECMWF_ENS: 30, CMEMS: 48 });   // = backend run_age.CUTOFF_H
});

test('nothing known, or killed: no label', () => {
  expect(readRunAge({ model: 'GFS', layer: 'waves', nowMs: NOW })).toBeNull();
  window.__WEATHER_CAPABILITIES__ = caps({ cycle: '2026-11-23T12:00:00Z', cutoff_h: 18, stale: false });
  window.__RAW_DISABLE_RUN_AGE_LABEL__ = true;
  expect(readRunAge({ model: 'GFS', layer: 'waves', nowMs: NOW })).toBeNull();
});

test.each([['light', 'text-slate-600', 'text-amber-800'], ['dark', 'text-slate-300', 'text-amber-200'],
  ['beach', 'text-slate-300', 'text-amber-200']])('the line reads in the %s theme', (theme, okTone, staleTone) => {
  window.__WEATHER_CAPABILITIES__ = caps({ cycle: new Date(Date.now() - 5 * 3600000).toISOString(), cutoff_h: 18, stale: false });
  const { container, unmount } = render(<RunAgeLabel model="GFS" layer="waves" theme={theme} />);
  const p = container.querySelector('[data-run-age]');
  expect(p.getAttribute('data-run-age')).toBe('ok');
  expect(p.className).toContain(okTone);
  expect(p.textContent).toMatch(/GFS model run .*, 5 h old/);
  unmount();
  window.__WEATHER_CAPABILITIES__ = caps({ cycle: new Date(Date.now() - 30 * 3600000).toISOString(), cutoff_h: 18, stale: true });
  const again = render(<RunAgeLabel model="GFS" layer="waves" theme={theme} />);
  const s = again.container.querySelector('[data-run-age]');
  expect(s.getAttribute('data-run-age')).toBe('stale');
  expect(s.className).toContain(staleTone);
  expect(s.textContent).toContain('older than 18 h');                     // the words, not only the colour
});

test('the collapsed phone header carries the run age, with the full sentence as its name', () => {
  window.__WEATHER_CAPABILITIES__ = caps({ cycle: new Date(Date.now() - 7 * 3600000).toISOString(), cutoff_h: 18, stale: false, source: 's' });
  render(<TimelineDrawerHeader expanded={false} onToggle={() => {}} timeLabel="Mon 3 AM"
    stale={{ model: 'GFS', layer: 'waves', hour: 0, windOn: false }} />);
  const btn = screen.getByRole('button', { name: /^Timeline, Mon 3 AM\. GFS model run .*, 7 h old\. Source: s$/ });
  expect(btn.textContent).toBe('Timeline · Mon 3 AM · GFS run 7 h');
  expect(btn.getAttribute('aria-expanded')).toBe('false');
});

test('a stale run reaches the stale-layer chip; a fresh one does not', () => {
  window.__WEATHER_CAPABILITIES__ = caps({ cycle: new Date(Date.now() - 30 * 3600000).toISOString(), cutoff_h: 18, stale: true });
  expect(readStaleChip({ model: 'GFS', layer: 'waves', hour: 0 })).toMatchObject({ kind: 'run', short: 'GFS run 30 h old (stale)' });
  window.__WEATHER_CAPABILITIES__ = caps({ cycle: new Date(Date.now() - 3 * 3600000).toISOString(), cutoff_h: 18, stale: false });
  expect(readStaleChip({ model: 'GFS', layer: 'waves', hour: 0 })).toBeNull();
});
