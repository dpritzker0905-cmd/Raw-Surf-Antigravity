#!/usr/bin/env node
/**
 * Wind bench, a SPEED RAMP fixture: one scene with clean axes (LESSONS L-V61).
 *
 *   node scripts/wind-bench/ramp-fixture.js out.json [--from 2] [--to 30] [--z 6]
 *   node scripts/wind-bench/motion-run.js --fixture out.json --runs runs.json --dpr 1.5
 *   node scripts/wind-bench/mirror-run.js --motion <motion.json> --at 0.33,0.2 --size 110      # land, one speed
 *   node scripts/wind-bench/mirror-run.js --motion <motion.json> --at 0.33,0.85 --size 110     # sea, the same speed
 *
 * The wind blows due north everywhere and its speed rises with longitude: `--from` knots at the west edge of the bench's view
 * (Mobile Bay, zoom `--z`) to `--to` at its east edge. A column of the picture is then one speed over land and over sea, a
 * streak stays in its column, and every speed is on screen at once. The hurricane fixture (the default of every other mode)
 * moves speed, place and zoom together: three lanes each solved a number on it that failed in the next scene (D-022, L-V50).
 *
 * The geometry is the bench's own (page/map-entry.js CSS_W = 897; a motion frame is that view scaled to 1000 px): a frame pixel is
 * 0.897 of a map pixel, so the zoom 6 view spans 92.98 to 83.12 W, not 11 degrees. `speedAt(x, size)` below gives the speed at
 * the centre of a `mirror-run.js --at x --size size` crop (the probe puts the crop's left edge at round((1000 - size) * x)).
 * Along a ramp the PLACE changes with the speed: compare arms at the same crop, and read a row along speed only over the sea.
 */
const fs = require('fs');
const path = require('path');

const VIEW = { lng: -88.05, lat: 30.45 }, CSS_W = 897, CSS_H = 914, FRAME_W = 1000;
const flag = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };

/** The view's west and east edges (degrees) at zoom `z`: 512 px tiles, the bench's 897 px map. */
function viewSpan(z) { const half = (CSS_W / 2) * 360 / (512 * Math.pow(2, z)); return { west: VIEW.lng - half, east: VIEW.lng + half }; }

/** A ramp fixture: { bounds, cols, rows, u, v } on a 0.5 degree grid that covers the zoom `z` view with room to spare. */
function rampFixture(from, to, z = 6) {
  const span = viewSpan(z), step = 0.5, pad = Math.ceil((span.east - span.west) / 2) + 1;
  const even = (x, up) => 2 * (up ? Math.ceil(x / 2) : Math.floor(x / 2));   // even degrees: the bench's 2 degree world base takes these nodes
  // The view's own height, in Mercator (CSS_H = 914), padded like its width and kept inside the world base's latitudes.
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)), inv = (m) => (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180 / Math.PI;
  const half = (CSS_H / 2) / (512 * Math.pow(2, z)) * 2 * Math.PI, north = inv(merc(VIEW.lat) + half), south = inv(merc(VIEW.lat) - half);
  const bounds = { west: even(span.west - pad, false), east: even(span.east + pad, true), south: Math.max(-80, even(south - 2, false)), north: Math.min(84, even(north + 2, true)) };
  const cols = (bounds.east - bounds.west) / step + 1, rows = (bounds.north - bounds.south) / step + 1, u = [], v = [];
  // Held at the view's own ends outside it: the wind's top speed is `to` (the engine scales its tables by the data's maximum).
  const speed = (lng) => Math.max(1, from + (to - from) * Math.min(1, Math.max(0, (lng - span.west) / (span.east - span.west))));
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { u.push(0); v.push(+speed(bounds.west + i * step).toFixed(3)); }
  return { product_id: 'bench_speed_ramp', provenance: `synthetic: wind due north, ${from} kn at ${span.west.toFixed(2)} to ${to} kn at ${span.east.toFixed(2)} (the zoom ${z} view's edges)`,
    valid_time: '2026-10-09T15:00:00Z', bounds, cols, rows, u, v, ramp: { from, to, z, west: span.west, east: span.east } };
}

/** The speed (knots) at the centre of a `mirror-run.js --at x --size size` crop of a frame captured on `fixture`. */
function speedAt(fixture, x, size = 110) { const c = (Math.round((FRAME_W - size) * x) + size / 2) / FRAME_W; return fixture.ramp.from + (fixture.ramp.to - fixture.ramp.from) * c; }

if (require.main === module) {
  const out = process.argv[2];
  if (!out || out.startsWith('--')) { console.error('usage: node scripts/wind-bench/ramp-fixture.js out.json [--from 2] [--to 30] [--z 6]'); process.exit(2); }
  const fx = rampFixture(Number(flag('--from', 2)), Number(flag('--to', 30)), Number(flag('--z', 6)));
  fs.writeFileSync(path.resolve(out), JSON.stringify(fx));
  console.log(`${out}: ${fx.cols} x ${fx.rows} nodes, ${fx.provenance}`);
  console.log('crop centres (--size 110): ' + [0.07, 0.2, 0.33, 0.47, 0.6, 0.73, 0.87].map((x) => `--at ${x} = ${speedAt(fx, x).toFixed(1)} kn`).join(' · '));
}
module.exports = { rampFixture, speedAt, viewSpan };
