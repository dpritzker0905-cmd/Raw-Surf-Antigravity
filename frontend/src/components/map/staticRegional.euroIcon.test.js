/**
 * EURO / ICON regional bundles at z7-9 (2026-11-01, item 11 "instant everywhere"; staticRegional.js, DARK).
 * Pins: the gate is OFF by default and REGIONAL_MODELS stays GFS (other modules read it as "the GFS selection"); with the gate on,
 * EURO waves and ICON waves / swell_1 / wind_waves are regional sets on their 14 pilot boxes (pinned to the backend's
 * REGIONAL_CONFIGS + WORLDWIDE_COASTAL_REGIONS), never the GFS-only extras; the kill wins; their 2-deg snap skips the
 * snapped-inside test exactly as the server's MARINE_REGIONAL_TILE_FIRST_EURO_ICON does (regional_tile_first.covering_tile).
 */
import fs from 'fs';
import path from 'path';
import { setCachedManifest } from './backendWeatherServiceClientCoverage';
import {
  EURO_ICON_BOX_IDS, PILOT_BOXES, REGIONAL_EURO_ICON_DEFAULT_ON, REGIONAL_MODELS, _setRegionalCodecForTest, insidePilotBox,
  isRegionalSetKey, pickRegionalTile, regionalClipWindow, regionalEuroIconOn, regionalModelLayer, regionalSetKey,
} from './staticRegional';

const FLORIDA = { west: -85, south: 24, east: -79, north: 31 };
const MANIFEST = { products: ['GFS', 'EURO', 'ICON'].flatMap((model) => [
  { model, domain: 'marine', layer: 'waves', region_id: 'global_mid', coverage: { west: -180, south: -80, east: 180, north: 85 } },
  { model, domain: 'marine', layer: 'waves', region_id: 'florida_east_coast', coverage: FLORIDA },
]).concat([{ model: 'ICON', domain: 'marine', layer: 'swell_1', region_id: 'florida_east_coast', coverage: FLORIDA }]) };
const INSIDE = '-82.6,27.6,-80.4,29.4';
const OWNER_Z9 = '-81.65,27.6,-79.58,28.6';         // the owner's Florida east-coast z9 box: a 2-deg snap reaches -78 (tile edge -79)
const TILE_GRID = { cols: 25, rows: 29, bounds: { ...FLORIDA } };   // the 0.25-deg lattice of florida_east_coast

beforeEach(() => {
  delete window.__RAW_ENABLE_REGIONAL_EURO_ICON__;
  delete window.__RAW_DISABLE_REGIONAL_EURO_ICON__;
  _setRegionalCodecForTest({ sha12: async () => 'x', gunzip: async () => new ArrayBuffer(0) });
  setCachedManifest(MANIFEST);
});
afterAll(() => {
  delete window.__RAW_ENABLE_REGIONAL_EURO_ICON__;
  delete window.__RAW_DISABLE_REGIONAL_EURO_ICON__;
  _setRegionalCodecForTest({});
});

describe('EURO / ICON regional bundles (dark)', () => {
  it('is ON by default (D-059); the kill leaves no EURO/ICON set key and no pick; GFS unchanged, REGIONAL_MODELS still GFS only', () => {
    expect(REGIONAL_EURO_ICON_DEFAULT_ON).toBe(true);
    expect(REGIONAL_MODELS).toEqual(['GFS']);
    expect(regionalEuroIconOn()).toBe(true);
    expect(pickRegionalTile({ model: 'EURO', layer: 'waves', bboxStr: INSIDE }).key).toBe('EURO/marine/waves/florida_east_coast');
    window.__RAW_DISABLE_REGIONAL_EURO_ICON__ = true;
    expect(regionalEuroIconOn()).toBe(false);
    expect(isRegionalSetKey('EURO/marine/waves/florida_east_coast')).toBe(false);
    expect(pickRegionalTile({ model: 'EURO', layer: 'waves', bboxStr: INSIDE })).toBeNull();
    expect(pickRegionalTile({ model: 'ICON', layer: 'waves', bboxStr: INSIDE })).toBeNull();
    expect(pickRegionalTile({ model: 'GFS', layer: 'waves', bboxStr: INSIDE }).key).toBe('GFS/marine/waves/florida_east_coast');
  });

  it('on: EURO waves and ICON waves / swell_1 / wind_waves pick their tile; other layers never', () => {
    window.__RAW_ENABLE_REGIONAL_EURO_ICON__ = true;
    expect(pickRegionalTile({ model: 'EURO', layer: 'waves', bboxStr: INSIDE }).key).toBe(regionalSetKey('EURO', 'waves', 'florida_east_coast'));
    expect(pickRegionalTile({ model: 'ICON', layer: 'swell_1', bboxStr: INSIDE }).key).toBe('ICON/marine/swell_1/florida_east_coast');
    expect(isRegionalSetKey('ICON/marine/wind_waves/florida_east_coast')).toBe(true);
    for (const [m, l] of [['EURO', 'swell_1'], ['EURO', 'wind_waves'], ['ICON', 'swell_2'], ['EURO', 'swell_2']]) {
      expect(regionalModelLayer(m, l)).toBe(false);
      expect(pickRegionalTile({ model: m, layer: l, bboxStr: INSIDE })).toBeNull();
    }
    expect(isRegionalSetKey('EURO/marine/waves/global_mid')).toBe(false);     // world tiers are never regional
  });

  it('the kill wins over the old opt-in', () => {
    window.__RAW_ENABLE_REGIONAL_EURO_ICON__ = true;
    window.__RAW_DISABLE_REGIONAL_EURO_ICON__ = true;
    expect(regionalEuroIconOn()).toBe(false);
    expect(pickRegionalTile({ model: 'EURO', layer: 'waves', bboxStr: INSIDE })).toBeNull();
  });

  it('EURO/ICON pilot boxes are the 14 boxes their pilots store (pinned to pilot_regions.py), never the GFS-only extras', () => {
    const py = fs.readFileSync(path.join(__dirname, '../../../../backend/services/weather_pipeline/pilot_regions.py'), 'utf8');
    const section = (name) => { const a = py.indexOf(`${name} = {`); return py.slice(a, py.indexOf('\n}', a)); };
    const ids = (txt) => [...txt.matchAll(/^\s{4}"(\w+)":\s*\{/gm)].map((m) => m[1]);
    const fromPy = [...ids(section('REGIONAL_CONFIGS')), ...ids(section('WORLDWIDE_COASTAL_REGIONS'))];
    expect(fromPy).toHaveLength(14);
    expect([...EURO_ICON_BOX_IDS].sort()).toEqual([...fromPy].sort());
    expect(EURO_ICON_BOX_IDS.every((id) => PILOT_BOXES.some(([b]) => b === id))).toBe(true);
    const caribbean = { west: -68, south: 15, east: -66, north: 17 };            // caribbean_pr_dr: a GFS-only extra
    expect(insidePilotBox(caribbean)).toBe(true);
    expect(insidePilotBox(caribbean, 'ICON')).toBe(false);
    expect(insidePilotBox({ west: -82, south: 27, east: -80, north: 29 }, 'EURO')).toBe(true);
  });

  it('the 2-deg snap skips the snapped-inside test (the server rule): the owner box is covered for EURO; GFS keeps it', () => {
    const euro = regionalClipWindow(OWNER_Z9, TILE_GRID, 'EURO');
    expect(euro.snapped).toBe('-82.0000,26.0000,-78.0000,30.0000');
    expect(euro.snapInside).toBe(false);
    expect(euro.covers).toBe(true);
    expect(euro.bounds).toEqual({ west: -82, south: 26, east: -79, north: 30 });     // clamped to the data's -79, as Step 3 serves
    const gfs = regionalClipWindow(OWNER_Z9, TILE_GRID, 'GFS');
    expect(gfs.snapInside).toBe(true);
    expect(gfs.covers).toBe(true);
    // A request past the data's edge is never covered, whatever the model.
    expect(regionalClipWindow('-80.4,27.6,-78.6,28.6', TILE_GRID, 'EURO').covers).toBe(false);
    // GFS on a fractional edge (snapped past the data) still refuses, as #508 does.
    const frac = { cols: 31, rows: 27, bounds: { west: -82, south: 31, east: -74.5, north: 37.5 } };
    expect(regionalClipWindow('-76.0,32.0,-74.6,34.0', frac, 'GFS').covers).toBe(false);
  });
});
