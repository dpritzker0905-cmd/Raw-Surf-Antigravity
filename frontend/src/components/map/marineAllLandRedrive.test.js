// The all-land re-drive cap (marineAllLandRedrive.js), gate L1 of docs/weather-program/log/2026-11-19-opus-all-land-backoff.md.
import fs from 'fs';
import path from 'path';
import { planAllLandRedrive, allLandEpisode, allLandBackoffOn, BACKOFF_MS, MAX_REDRIVES } from './marineAllLandRedrive';

const ep = allLandEpisode({ model: 'GFS', layer: 'waves', hour: 0, bounds: { west: -98.6, south: 37.4, east: -97.3, north: 38.6 } });

// Drive the planner once a second for `seconds`, the way the backstop's 1 s interval does; return the seconds at which it fired.
function simulate({ on = true, allZero = true, seconds = 600, episodeAt = () => ep } = {}) {
  let state = null; const fired = [];
  for (let t = 0; t <= seconds; t += 1) {
    const p = planAllLandRedrive({ on, allZero, episode: episodeAt(t), state, nowMs: t * 1000 });
    state = p.next;
    if (p.fire) fired.push(t);
  }
  return fired;
}

afterEach(() => { delete window.__RAW_DISABLE_ALL_LAND_BACKOFF__; });

test('an all-zero view re-drives at 0, 6, 18, 42, 90 s (gaps 6/12/24/48) and then never again', () => {
  expect(MAX_REDRIVES).toBe(5);
  expect(BACKOFF_MS).toEqual([6000, 12000, 24000, 48000, 96000]);
  expect(simulate()).toEqual([0, 6, 18, 42, 90]);
});

test('a change of episode (view, hour, model or layer) re-arms the budget', () => {
  const other = allLandEpisode({ model: 'GFS', layer: 'waves', hour: 3, bounds: { west: -98.6, south: 37.4, east: -97.3, north: 38.6 } });
  const fired = simulate({ seconds: 400, episodeAt: (t) => (t < 200 ? ep : other) });
  expect(fired).toEqual([0, 6, 18, 42, 90, 200, 206, 218, 242, 290]);
  expect(allLandEpisode({ model: 'ICON', layer: 'waves', hour: 0, bounds: null })).not.toBe(allLandEpisode({ model: 'GFS', layer: 'waves', hour: 0, bounds: null }));
  expect(allLandEpisode({ model: 'GFS', layer: 'swell_1', hour: 0, bounds: null })).not.toBe(allLandEpisode({ model: 'GFS', layer: 'waves', hour: 0, bounds: null }));
});

test('an empty engine that is NOT all-zero (a cold load) is never held: every tick may fire (the caller keeps its 6 s cadence)', () => {
  expect(simulate({ allZero: false, seconds: 30 })).toHaveLength(31);
});

test('OFF PATH: __RAW_DISABLE_ALL_LAND_BACKOFF__ never holds an all-zero view (today\'s behaviour)', () => {
  window.__RAW_DISABLE_ALL_LAND_BACKOFF__ = true;
  expect(allLandBackoffOn()).toBe(false);
  expect(simulate({ on: allLandBackoffOn(), seconds: 30 })).toHaveLength(31);
});

test('the backstop in useMarineScrubSettle consults the planner only for an all-zero empty engine', () => {
  const src = fs.readFileSync(path.join(__dirname, 'useMarineScrubSettle.js'), 'utf8');
  expect(src).toMatch(/renderBlockedReason === 'all_zero_grid'/);
  expect(src).toMatch(/planAllLandRedrive\(\{ on: allLandBackoffOn\(\)/);
  expect(src).toMatch(/if \(!_p\.fire\) \{ blankStreak = 0; return; \}/);
});
