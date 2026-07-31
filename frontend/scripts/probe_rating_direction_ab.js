/**
 * probe_rating_direction_ab.js — does the SURF RATING toggle change the ANIMATION'S DIRECTION FIELD?
 *
 * WHY THIS EXISTS. User report, 2026-07-31: *"when I turn the surf rating band on, the wave
 * animations seem to flow better, or more accurately, in terms of direction, than when the surf
 * rating band is turned off."* That is a gift, because it names a single BINARY variable that moves
 * direction accuracy — and direction accuracy is open task #7.
 *
 * FIRST MEASUREMENT (2026-07-31, z7.5 Cocoa) — the toggle moves the RESIDENT GRID, not just paint:
 *
 *     rating OFF   grid  5x5   cellDeg 1.600   span  8°   lane series_sharpen   product null
 *     rating ON    grid 16x16  cellDeg 1.875   span 30°   lane flavor_toggle    product global_mid
 *
 * A 5x5 field carries almost no spatial structure across a viewport, so the particles advect on a
 * nearly uniform heading. That is a credible mechanism for "flows better with rating on" — but ONE
 * camera and ONE sample point proved nothing (the direction at Cocoa read 27.9° in BOTH states).
 * Hence this instrument.
 *
 * ★★ WHY IT MUST BE A GESTURE, NOT A LADDER. Standing mandate (2026-07-19): a `jumpTo`+settle ladder
 * samples SETTLED states only, and cannot see clamping that appears DURING a gesture — the user
 * caught one live on a build where three ladders had just passed 72/72. So this drives ANIMATED
 * `easeTo` zoom in/out and `panBy`, captures a burst of frames THROUGH each gesture plus video, and
 * samples engine state per frame.
 *
 * ★★★ THE QUANTITATIVE HALF, which video alone cannot give: at every frame it reads the ENGINE'S
 * OWN resident grid direction at a LATTICE of points across the viewport, for both rating states,
 * and reports the per-point angular difference. "Flows better" becomes a number.
 *
 * ⚠️ THE A/B VARIABLE IS A PRODUCT TOGGLE, NOT A WINDOW FLAG — it is clicked in the UI, so each
 * side must be given real settle time for the refetch/commit. Both sides run the SAME camera path
 * in the SAME order; only the toggle differs.
 * ⚠️⚠️ PORT 3009 (`frontend-verify`), NEVER 3001 — 3001 is the preview pane's server and driving a
 * headless run against it wedged the renderer on 2026-07-31.
 * ⚠️ Headless swiftshader renders the marine palette differently from a real GPU (see
 * `probe_land_bleed.js`'s validity gate). PIXEL claims from this tool are indicative; the ENGINE
 * numbers below are the evidence.
 *
 * Usage (from frontend/):
 *   node scripts/probe_rating_direction_ab.js [outdir]
 * Env: RD_BASE (default http://localhost:3009) · RD_LAT/RD_LNG (default Cocoa) ·
 *      RD_ZOOMS (default 6,7,7.5,8,8.5,9) · RD_MODEL/RD_LAYER · RD_BURST (frames/gesture, default 5)
 *      RD_MAX_DELTA (default 20 deg — beyond this the two states disagree about direction)
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.RD_BASE || 'http://localhost:3009';
const LAT = Number(process.env.RD_LAT || 28.41);
const LNG = Number(process.env.RD_LNG || -80.60);
const ZOOMS = (process.env.RD_ZOOMS || '6,7,7.5,8,8.5,9').split(',').map(Number);
const MODEL = process.env.RD_MODEL || 'GFS';
const LAYER = process.env.RD_LAYER || 'waves';
const BURST = Number(process.env.RD_BURST || 5);
const MAX_DELTA = Number(process.env.RD_MAX_DELTA || 20);
const LAYER_BUTTON = { waves: 'Waves', swell_1: 'Swell', swell_2: 'Swell 2', wind_waves: 'Wind Waves' };
const OUT = process.argv[2] || path.join(__dirname, 'rating-dir-ab-out');

const lines = [];
const log = (s) => { console.log(s); lines.push(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

async function clickStarts(page, text) {
  return page.evaluate((t) => {
    let hit = null;
    document.querySelectorAll('button,[role="button"]').forEach((el) => {
      const s = (el.textContent || '').trim();
      if (!hit && s.toLowerCase().startsWith(t.toLowerCase())) { el.click(); hit = s; }
    });
    return hit;
  }, text);
}

/** Engine truth for one frame: the resident grid's identity + its direction on a viewport lattice. */
async function sampleField(page, n) {
  return page.evaluate((N) => {
    const m = window.map, e = window.__MARINE_ENGINE__;
    const wd = e && e._waveData, wg = wd && wd.waveGrid;
    const f = window.__RAW_FORENSIC__ || {};
    const commits = (f.events || []).filter((x) => x.type === 'commit');
    const last = commits[commits.length - 1] || {};
    const b = m.getBounds();
    const pts = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      pts.push({ lng: b.getWest() + (b.getEast() - b.getWest()) * (i + 0.5) / N,
                 lat: b.getSouth() + (b.getNorth() - b.getSouth()) * (j + 0.5) / N });
    }
    const dirs = pts.map((p) => {
      if (!wg || !wg.vectors) return null;
      let best = null, bd = 1e9;
      for (const v of wg.vectors) {
        if (!v || v.is_valid === false) continue;
        const d = Math.abs(v.lat - p.lat) + Math.abs(v.lng - p.lng);
        if (d < bd) { bd = d; best = v; }
      }
      if (!best) return null;
      // Derive from u/v — the stored `direction` is 0.0 for "none" and thus ambiguous.
      return (best.u || best.v)
        ? ((Math.atan2(-best.u, -best.v) * 180) / Math.PI + 360) % 360
        : best.direction;
    });
    return {
      zoom: +m.getZoom().toFixed(2),
      gridDims: wg ? `${wg.cols}x${wg.rows}` : null,
      cellDeg: last.cellDeg, tier: last.tier, lane: last.lane, spanLng: last.spanLng,
      product: last.product, scope: last.scope,
      dirs, pts: pts.map((p) => [+p.lng.toFixed(2), +p.lat.toFixed(2)]),
    };
  }, n);
}

/** One animated gesture with a burst of samples THROUGH it (not after it). */
async function gesture(page, shots, tag, fn) {
  const frames = [];
  const done = fn();                       // start the animated camera move, do NOT await it
  for (let i = 0; i < BURST; i++) {
    await sleep(220);
    frames.push(await sampleField(page, 4));
    await page.screenshot({ path: path.join(OUT, `${tag}-${String(i).padStart(2, '0')}.png`) })
      .catch(() => {});
    shots.push(`${tag}-${String(i).padStart(2, '0')}.png`);
  }
  await done.catch(() => {});
  await sleep(900);
  return frames;
}

async function runSide(page, label, shots) {
  const out = [];
  for (const z of ZOOMS) {
    // ANIMATED, per the zoom-burst mandate — easeTo, sampled mid-flight.
    const fr = await gesture(page, shots, `${label}-z${z}`, () => page.evaluate(
      ([la, ln, zz]) => new Promise((res) => {
        window.map.easeTo({ center: [ln, la], zoom: zz, duration: 1100 });
        window.map.once('moveend', () => res());
      }), [LAT, LNG, z],
    ));
    await sleep(2600);                                     // let the refetch/commit land
    const settled = await sampleField(page, 4);
    // A pan at this rung, also animated — pans re-enter the tier chooser without a zoom change.
    const pan = await gesture(page, shots, `${label}-z${z}-pan`, () => page.evaluate(
      () => new Promise((res) => {
        window.map.panBy([260, 120], { duration: 900 });
        window.map.once('moveend', () => res());
      }),
    ));
    await sleep(2200);
    const settledPan = await sampleField(page, 4);
    out.push({ zoom: z, midZoom: fr, settled, midPan: pan, settledPan });
    log(`  ${label} z=${String(z).padEnd(4)} grid=${String(settled.gridDims).padEnd(8)}`
      + ` cellDeg=${String(settled.cellDeg).padEnd(6)} tier=${String(settled.tier).padEnd(5)}`
      + ` span=${String(settled.spanLng).padEnd(5)} lane=${settled.lane || '-'}`);
  }
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 900 } } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`  ! page error: ${String(e).slice(0, 140)}`));
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.map && window.map.isStyleLoaded && window.map.isStyleLoaded(),
    null, { timeout: 90000 }).catch(() => {});
  await sleep(3500);

  log(`rating x direction A/B | ${BASE} | (${LAT},${LNG}) | ${MODEL}/${LAYER} | burst ${BURST}/gesture`);
  if (!(await clickStarts(page, MODEL))) log(`  ! model ${MODEL} not found`);
  await sleep(1200);
  if (!(await clickStarts(page, LAYER_BUTTON[LAYER] || LAYER))) log(`  ! layer ${LAYER} not found`);
  await sleep(7000);

  const shots = [];
  // Read the toggle's own label so the sides are named by what the UI says, never by assumption.
  const label0 = await page.evaluate(() => { let s = null;
    document.querySelectorAll('button').forEach((el) => {
      const t = (el.textContent || '').trim(); if (t.startsWith('Surf Rating')) s = t; }); return s; });
  log(`\n=== side A: ${label0} ===`);
  const sideA = await runSide(page, 'A', shots);

  const clicked = await clickStarts(page, 'Surf Rating');
  await sleep(9000);
  const label1 = await page.evaluate(() => { let s = null;
    document.querySelectorAll('button').forEach((el) => {
      const t = (el.textContent || '').trim(); if (t.startsWith('Surf Rating')) s = t; }); return s; });
  log(`\n=== side B: ${label1}  (clicked "${clicked}") ===`);
  const sideB = await runSide(page, 'B', shots);

  // ── VERDICT ─────────────────────────────────────────────────────────────────────────────────
  // ⚠️ A verdict is only meaningful if the toggle actually CHANGED STATE. If the label did not
  // move, both sides are the same configuration and every delta below is noise.
  log(`\n${'='.repeat(76)}\nVERDICT\n${'='.repeat(76)}`);
  if (!label0 || !label1 || label0 === label1) {
    log(`  ⚠️ TOGGLE DID NOT CHANGE STATE ("${label0}" -> "${label1}"). Measurement VOID.`);
    fs.writeFileSync(path.join(OUT, 'rating-dir-ab.json'),
      JSON.stringify({ void: true, label0, label1, sideA, sideB }, null, 2));
    fs.writeFileSync(path.join(OUT, 'rating-dir-ab.log'), lines.join('\n'));
    await ctx.close(); await browser.close(); process.exit(2);
  }

  let gridChanged = 0, dirRungs = 0, dirDisagree = 0;
  const rows = [];
  for (let i = 0; i < Math.min(sideA.length, sideB.length); i++) {
    const a = sideA[i].settled, b = sideB[i].settled;
    const pairs = [];
    for (let k = 0; k < Math.min((a.dirs || []).length, (b.dirs || []).length); k++) {
      if (a.dirs[k] == null || b.dirs[k] == null) continue;
      pairs.push(angDiff(a.dirs[k], b.dirs[k]));
    }
    const med = pairs.length ? pairs.slice().sort((x, y) => x - y)[Math.floor(pairs.length / 2)] : null;
    const mx = pairs.length ? Math.max(...pairs) : null;
    if (a.gridDims !== b.gridDims) gridChanged++;
    if (med != null) { dirRungs++; if (med > MAX_DELTA) dirDisagree++; }
    rows.push({ zoom: sideA[i].zoom, aGrid: a.gridDims, bGrid: b.gridDims, aCell: a.cellDeg,
                bCell: b.cellDeg, aLane: a.lane, bLane: b.lane, medianDirDelta: med, maxDirDelta: mx,
                n: pairs.length });
    log(`  z=${String(sideA[i].zoom).padEnd(4)} A[${String(a.gridDims).padEnd(7)} ${String(a.cellDeg).padEnd(6)}]`
      + ` B[${String(b.gridDims).padEnd(7)} ${String(b.cellDeg).padEnd(6)}]`
      + `  medianΔdir=${med != null ? med.toFixed(1).padStart(6) : '   -  '}°`
      + `  maxΔ=${mx != null ? mx.toFixed(1).padStart(6) : '   -  '}°  n=${pairs.length}`
      + (med != null && med > MAX_DELTA ? '  <== THE TWO STATES DISAGREE' : ''));
  }
  log(`\n  rungs where the RESIDENT GRID differs between states: ${gridChanged}/${rows.length}`);
  log(`  rungs where the DIRECTION FIELD differs by > ${MAX_DELTA}°: ${dirDisagree}/${dirRungs}`);
  log(`  ★ a grid change with NO direction change means the toggle alters RESOLUTION, not heading —`);
  log(`    which would make the animation look better without making it more correct.`);
  log(`  frames: ${shots.length} · video in ${OUT}`);

  fs.writeFileSync(path.join(OUT, 'rating-dir-ab.json'),
    JSON.stringify({ base: BASE, at: [LNG, LAT], model: MODEL, layer: LAYER,
                     labels: [label0, label1], rows, sideA, sideB }, null, 2));
  fs.writeFileSync(path.join(OUT, 'rating-dir-ab.log'), lines.join('\n'));
  log(`\n  results -> ${path.join(OUT, 'rating-dir-ab.json')}`);
  await ctx.close();
  await browser.close();
  process.exit(dirDisagree ? 1 : 0);
})();
