/**
 * Wind bench, PATH mode: the camera moves a hand makes on the map, one {lng, lat, z} per 60 Hz frame. Pure, no DOM.
 *
 * Owner (2026-10-09): "Use even newer special tests that test it all through zooms and pans of all types, even erratic."
 *   pan      a steady drag across the coast at z8;
 *   fling    a fast drag released into MapLibre-style inertia (linear deceleration);
 *   zoomIn   z5 -> z10.5 (the wheel / double-tap direction), through the close-zoom ramp;
 *   zoomOut  z11 -> z5, the reverse;
 *   pinch    a two-finger zoom about an off-centre point that drifts while it zooms;
 *   jitter   rapid zoom in/out across z5.7-7.9 (the close-zoom ramp's whole width) with a small circling pan;
 *   erratic  a seeded random walk: bursts of pan (to 2500 css px/s) and zoom (to 4 z/s), pauses, and one-frame jumps
 *            (a trackpad flick), bounded to the Gulf coast so the served grid stays in view.
 * Every path holds still before and after, so the trails settle and the first and last samples are at rest.
 *
 * FLOW mode only (flow.js scores a turned map; the colour metrics assume north-up):
 *   turn     a two-finger turn of the map, 70 degrees there and back, with a slow drift (frames carry `bearing`).
 */
const { mercY, latOf, TILE_PX } = require('./camera');
const { mulberry32 } = require('./scanner');

const FPS = 60;
const START = { lng: -88.05, lat: 30.45 };                   // Mobile Bay: the owner's 2026-10-09 view
const BOX = { west: -92, east: -80, south: 26, north: 33 };  // erratic stays over the served grid (-90..-78 / 25..32)
const Z_MIN = 4.5, Z_MAX = 11;

const merc = (lng, lat) => ({ x: (lng + 180) / 360, y: mercY(lat) });
const perPx = (z) => 1 / (TILE_PX * Math.pow(2, z));         // mercator units per css px at zoom z
const smooth = (t) => t * t * (3 - 2 * t);

/** A mutable camera in mercator units that emits frames. */
function track(lng, lat, z) {
  const m = merc(lng, lat), frames = [];
  const cam = {
    x: m.x, y: m.y, z, bearing: 0,
    pan(dxPx, dyPx) { cam.x += dxPx * perPx(cam.z); cam.y += dyPx * perPx(cam.z); },
    /** Zoom to z2 keeping the point at css offset (fx, fy) from the centre fixed on screen. */
    zoomAbout(z2, fx = 0, fy = 0) {
      const px = cam.x + fx * perPx(cam.z), py = cam.y + fy * perPx(cam.z);
      cam.z = z2; cam.x = px - fx * perPx(z2); cam.y = py - fy * perPx(z2);
    },
    emit() { const b = +cam.bearing.toFixed(3); frames.push({ lng: cam.x * 360 - 180, lat: latOf(cam.y), z: +cam.z.toFixed(5), ...(b ? { bearing: b } : {}) }); },
    hold(n) { for (let i = 0; i < n; i++) cam.emit(); },
    frames,
  };
  return cam;
}

const PATHS = {
  pan() {
    const c = track(START.lng, START.lat, 8);
    c.hold(20);
    for (let i = 0; i < 90; i++) { c.pan(700 / 90, 0); c.emit(); }   // ~470 css px/s
    c.hold(30);
    return c.frames;
  },
  fling() {
    const c = track(START.lng, START.lat, 8), a = 35 * Math.PI / 180;
    c.hold(20);
    let v = 2400;                                                       // css px/s at release
    while (v > 0) { const d = v / FPS; c.pan(d * Math.cos(a), -d * Math.sin(a)); c.emit(); v -= 2500 / FPS; }
    c.hold(30);
    return c.frames;
  },
  zoomIn() {
    const c = track(START.lng, START.lat, 5);
    c.hold(20);
    for (let i = 1; i <= 150; i++) { c.zoomAbout(5 + 5.5 * smooth(i / 150)); c.emit(); }
    c.hold(30);
    return c.frames;
  },
  zoomOut() {
    const c = track(START.lng, START.lat, 11);
    c.hold(20);
    for (let i = 1; i <= 150; i++) { c.zoomAbout(11 - 6 * smooth(i / 150)); c.emit(); }
    c.hold(30);
    return c.frames;
  },
  pinch() {
    const c = track(START.lng, START.lat, 7);
    c.hold(20);
    for (let i = 1; i <= 120; i++) {
      c.zoomAbout(7 + 2.5 * smooth(i / 120), 224, -183);                // fingers at (+0.25 W, -0.2 H)
      c.pan(-200 / 120, 90 / 120);                                      // the fingers drift as they spread
      c.emit();
    }
    c.hold(30);
    return c.frames;
  },
  jitter() {
    const c = track(START.lng, START.lat, 6.8);
    c.hold(20);
    for (let i = 1; i <= 180; i++) {
      const t = i / FPS;
      c.zoomAbout(6.8 + 1.1 * Math.sin(2 * Math.PI * 2 * t));
      c.pan(60 * 2 * Math.PI / FPS * -Math.sin(2 * Math.PI * t), 60 * 2 * Math.PI / FPS * Math.cos(2 * Math.PI * t));
      c.emit();
    }
    c.hold(30);
    return c.frames;
  },
  erratic(seed = 1) {
    const rnd = mulberry32(seed * 7919 + 17), c = track(START.lng, START.lat, 7.5), box = { a: merc(BOX.west, BOX.north), b: merc(BOX.east, BOX.south) };
    c.hold(20);
    let left = 360;
    while (left > 0) {
      const n = Math.min(left, 6 + Math.floor(rnd() * 19)), kind = rnd();
      if (kind < 0.12) {                                                // a one-frame jump (trackpad flick)
        const a = rnd() * 2 * Math.PI, d = 150 + rnd() * 350;
        c.pan(d * Math.cos(a), d * Math.sin(a)); c.emit(); left -= 1; continue;
      }
      const pause = kind > 0.8, a = rnd() * 2 * Math.PI, v = pause ? 0 : rnd() * 2500, dz = pause ? 0 : (rnd() * 8 - 4);
      for (let i = 0; i < n; i++) {
        c.pan(v / FPS * Math.cos(a), v / FPS * Math.sin(a));
        c.zoomAbout(Math.max(Z_MIN, Math.min(Z_MAX, c.z + dz / FPS)));
        c.x = Math.max(box.a.x, Math.min(box.b.x, c.x)); c.y = Math.max(box.a.y, Math.min(box.b.y, c.y));
        c.emit();
      }
      left -= n;
    }
    c.hold(30);
    return c.frames;
  },
};

PATHS.turn = function turn() {
  const c = track(START.lng, START.lat, 8);
  c.hold(20);
  for (let i = 1; i <= 120; i++) { c.bearing = i < 120 ? 70 * Math.sin(Math.PI * i / 120) : 0; c.pan(1, -0.5); c.emit(); }
  c.hold(30);
  return c.frames;
};

const FLOW_PATH_NAMES = ['turn'];                             // scored by flow mode only
const PATH_NAMES = Object.keys(PATHS).filter((n) => !FLOW_PATH_NAMES.includes(n));

/** Frames for a named path (seed only matters for erratic). */
function pathFrames(name, seed = 1) {
  if (!PATHS[name]) throw new Error(`unknown path ${name} (${PATH_NAMES.concat(FLOW_PATH_NAMES).join(', ')})`);
  return PATHS[name](seed);
}

/** Frame indexes to score: every `every` frames from the first, plus the last. */
function sampleIndexes(n, every) {
  const out = [];
  for (let i = 0; i < n; i += every) out.push(i);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return out;
}

module.exports = { FPS, START, BOX, Z_MIN, Z_MAX, PATH_NAMES, FLOW_PATH_NAMES, pathFrames, sampleIndexes, perPx };
