/**
 * The wind bench's SPEED RAMP fixture (scripts/wind-bench/ramp-fixture.js; LESSONS L-V61): one scene in which a column of the
 * picture is one wind speed over land and sea. Its geometry is the instrument: on 2026-10-12 a frame pixel was read as a map pixel
 * (the bench's map is 897 px wide, a frame 1000) and every speed written beside a measurement was wrong by up to 8 kn. This file
 * pins the geometry against the bench's own constants, so a change to either is seen.
 */
import fs from 'fs';
import path from 'path';

const { rampFixture, speedAt, viewSpan } = require('../../../scripts/wind-bench/ramp-fixture');
const BENCH = path.join(__dirname, '..', '..', '..', 'scripts', 'wind-bench');

describe('the view: the bench\'s own map, not the frame', () => {
  it('the bench\'s map is 897 CSS px wide and a motion frame is that view scaled to a given width (the two constants this file\'s geometry rests on)', () => {
    const entry = fs.readFileSync(path.join(BENCH, 'page', 'map-entry.js'), 'utf8');
    expect(entry).toMatch(/const CSS_W = 897, CSS_H = 914,/);
    expect(entry).toContain('t.getContext(\'2d\').drawImage(map.getCanvas(), 0, 0, t.width, t.height);');
    expect(fs.readFileSync(path.join(BENCH, 'page', 'mirror-probe.js'), 'utf8')).toContain('sx = Math.round((im.naturalWidth - W) * at[0])');
  });
  it('at zoom 6 the view spans 92.98 to 83.12 W: 9.86 degrees, not the 10.99 a 1000 px map would', () => {
    const s = viewSpan(6);
    expect(s.west).toBeCloseTo(-92.977, 2); expect(s.east).toBeCloseTo(-83.123, 2);
    expect(viewSpan(5).east - viewSpan(5).west).toBeCloseTo(2 * (s.east - s.west), 6);
  });
});

describe('the fixture: wind due north, speed rising with longitude across the view', () => {
  const fx = rampFixture(2, 30, 6);
  it('every node blows due north, and the speed is `from` at the view\'s west edge and `to` at its east edge', () => {
    expect(fx.u.every((u) => u === 0)).toBe(true);
    const at = (lng) => fx.v[Math.round((lng - fx.bounds.west) / 0.5)];
    expect(at(-93)).toBeCloseTo(2, 6);                                                      // a hair west of the view (92.98 W): held at the view's own end
    expect(at(-90)).toBeCloseTo(2 + 28 * (-90 - fx.ramp.west) / (fx.ramp.east - fx.ramp.west), 2);
    expect(at(-88)).toBeCloseTo(2 + 28 * (-88 - fx.ramp.west) / (fx.ramp.east - fx.ramp.west), 2);
    expect(fx.v.every((v) => v >= 1)).toBe(true);                                           // never calm or reversed west of the view
    expect(fx.u).toHaveLength(fx.cols * fx.rows);
  });
  it('a column is one speed: every row of the grid carries the same values', () => {
    for (let j = 1; j < fx.rows; j++) expect(fx.v.slice(j * fx.cols, (j + 1) * fx.cols)).toEqual(fx.v.slice(0, fx.cols));
  });
  it('the box covers the view with room to spare and starts on even degrees, so the bench\'s 2 degree world base takes its nodes (eye.js nodeAt)', () => {
    for (const k of ['west', 'east', 'south', 'north']) expect(Math.abs(fx.bounds[k] % 2)).toBe(0);
    expect(fx.bounds.west).toBeLessThan(fx.ramp.west - 2); expect(fx.bounds.east).toBeGreaterThan(fx.ramp.east + 2);
    expect(fx.bounds.south).toBeLessThan(25); expect(fx.bounds.north).toBeGreaterThan(36);
    expect((fx.bounds.east - fx.bounds.west) / (fx.cols - 1)).toBe(0.5);
  });
});

describe('the speed at a probe crop: the crop\'s centre, as mirror-probe.js places it', () => {
  it('the two ramps of 2026-10-12 read at the speeds their corrected tables carry', () => {
    const low = rampFixture(2, 30, 6), high = rampFixture(6.85, 60.6, 6);
    expect([0.2, 0.33, 0.47, 0.6].map((x) => +speedAt(low, x).toFixed(1))).toEqual([8.5, 11.8, 15.2, 18.5]);
    expect([0.07, 0.33, 0.47, 0.6, 0.73].map((x) => +speedAt(high, x).toFixed(1))).toEqual([13.1, 25.6, 32.3, 38.5, 44.7]);
  });
  it('a crop at --at 0 starts at the frame\'s edge and one at --at 1 ends at it; the size moves the centre', () => {
    const fx = rampFixture(0, 100, 6);
    expect(speedAt(fx, 0, 100)).toBeCloseTo(5, 6); expect(speedAt(fx, 1, 100)).toBeCloseTo(95, 6);
    expect(speedAt(fx, 0.5, 360)).toBeCloseTo(50, 6);
  });
});

describe('any zoom, and nothing off the view (an independent review: the box was a fixed 8 degrees of latitude, and the speed ran on past the view to 99 kn)', () => {
  it.each([4, 5, 6, 9])('at zoom %i the box covers the whole view, in latitude too', (z) => {
    const fx = rampFixture(2, 30, z), half = (914 / 2) / (512 * Math.pow(2, z)) * 2 * Math.PI;   // the view's half height in Mercator units
    const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)), inv = (m) => (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180 / Math.PI;
    expect(fx.bounds.north).toBeGreaterThanOrEqual(Math.min(84, inv(merc(30.45) + half)));
    expect(fx.bounds.south).toBeLessThanOrEqual(Math.max(-80, inv(merc(30.45) - half)));
    expect(fx.bounds.west).toBeLessThanOrEqual(fx.ramp.west); expect(fx.bounds.east).toBeGreaterThanOrEqual(fx.ramp.east);
  });
  it('outside the view the speed holds at the view\'s own ends: the wind\'s top speed is `to`, whatever the box', () => {
    for (const [from, to] of [[2, 30], [6.85, 60.6]]) { const fx = rampFixture(from, to, 6); expect(Math.max(...fx.v)).toBeCloseTo(to, 6); expect(Math.min(...fx.v)).toBeCloseTo(Math.max(1, from), 6); }
  });
});
