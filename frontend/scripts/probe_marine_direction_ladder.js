/**
 * probe_marine_direction_ladder.js — does the ANIMATED ARROW agree with the MARKER, at every zoom?
 *
 * WHY THIS EXISTS (2026-07-31, user-reported and reproduced). The user reported: "the GFS swell
 * marker says SE .8ft at 5.1 sec, but the animations are flowing out of the NE at all the zooms,
 * except at around 8.74 about 2 seconds into that zoom level the wave animations correct their
 * direction." Every existing instrument missed it:
 *
 *   zoomlab.js scenarios       measure COVERAGE / CLAMPING / pixels — never DIRECTION
 *   backend unit tests         measure the engine's math, never what tier the map ends up sampling
 *   API probes                 measure one coordinate at one tier, not the zoom ladder
 *
 * The defect is a TIER-FOOTPRINT problem and is therefore only visible as a function of ZOOM: the
 * animation reads whichever product covers the viewport (the ~2 degree global_mid whenever the
 * viewport is wider than a regional pilot tile), while the marker reads the finest product AT the
 * coordinate. A 2 degree block near a coast is mostly open water, so its energy-weighted mean can
 * disagree with the beach by up to 180 degrees while being internally coherent (measured: Cocoa
 * waves, arrow 265.4 vs marker 86.7 = 178.7 degrees, block coherence R = 0.82).
 *
 * WHAT IT DOES. For each model x layer, it walks a zoom ladder at a fixed coordinate and, at each
 * rung, reads the ENGINE'S OWN resident grid (the exact field the particles advect on) and compares
 * its direction at that coordinate against the point lane the marker/infobox reads. It reports the
 * zoom at which they converge — the user's "8.74" — and fails when they disagree at surf zooms.
 *
 * ENGINE STATE, NOT PIXELS: the arrow's direction is `waveGrid`'s vector at the coordinate, which
 * is event-driven and therefore rAF-independent. (A backgrounded/headless tab throttles rAF to 0,
 * which is exactly why per-frame particle sampling reads "nothing moved" — see the 2026-07-31
 * forensics. Reading the committed grid sidesteps that entirely.)
 *
 * Usage (from frontend/):
 *   node scripts/probe_marine_direction_ladder.js [outdir]
 * Env:
 *   ML_BASE     default http://localhost:3001
 *   ML_LAT/ML_LNG   default 28.25,-80.50 (Cocoa Beach — the reported spot)
 *   ML_MODELS   default GFS,EURO,ICON      ML_LAYERS default waves,swell_1,swell_2,wind_waves
 *   ML_ZOOMS    default 4,5,6,7,8,8.5,8.74,9,10
 *   ML_MAX_DELTA  default 30  (degrees; the surfer-relevant tolerance)
 * Exit 1 when any rung at zoom >= ML_SURF_ZOOM (default 7) disagrees by more than ML_MAX_DELTA.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try {
  ({ chromium } = require('@playwright/test'));
} catch (e) {
  ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test')));
}

const BASE = process.env.ML_BASE || 'http://localhost:3001';
const LAT = Number(process.env.ML_LAT || 28.25);
const LNG = Number(process.env.ML_LNG || -80.50);
const MODELS = (process.env.ML_MODELS || 'GFS,EURO,ICON').split(',').map((s) => s.trim());
const LAYERS = (process.env.ML_LAYERS || 'waves,swell_1,swell_2,wind_waves').split(',').map((s) => s.trim());
const ZOOMS = (process.env.ML_ZOOMS || '4,5,6,7,8,8.5,8.74,9,10').split(',').map(Number);
const MAX_DELTA = Number(process.env.ML_MAX_DELTA || 30);
const SURF_ZOOM = Number(process.env.ML_SURF_ZOOM || 7);
const SETTLE_MS = Number(process.env.ML_SETTLE_MS || 3500);
const outdir = process.argv[2] || path.join(__dirname, 'direction-ladder-out');
fs.mkdirSync(outdir, { recursive: true });

// The UI label for each layer key (the buttons the user actually clicks).
const LAYER_BUTTON = {
  waves: 'Waves', swell_1: 'Swell', swell_2: 'Swell 2', wind_waves: 'Wind Waves',
};

const log = (m) => { process.stdout.write(m + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function angDiff(a, b) {
  if (a == null || b == null) return null;
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

async function clickByText(page, text) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => (x.textContent || '').trim() === t);
    if (!b) return false;
    b.click();
    return true;
  }, text);
  return ok;
}

/** The direction the ENGINE is advecting on, at (lat,lng), plus which product it came from. */
async function readArrow(page, lat, lng) {
  return page.evaluate(([la, ln]) => {
    const e = window.__MARINE_ENGINE__;
    const wd = e && e._waveData;
    const wg = wd && wd.waveGrid;
    const diag = window.__WebGLMarineLayer_DIAG__ || {};
    if (!wg || !wg.vectors) return { ok: false, reason: 'no resident grid' };
    let best = null; let bd = 1e9;
    for (const v of wg.vectors) {
      if (!v || v.is_valid === false) continue;
      const d = Math.abs(v.lat - la) + Math.abs(v.lng - ln);
      if (d < bd) { bd = d; best = v; }
    }
    if (!best) return { ok: false, reason: 'no valid cell' };
    // Derive from u/v when present — the stored `direction` is 0.0 for "none" and thus ambiguous.
    let derived = best.direction;
    if (best.u || best.v) {
      derived = ((Math.atan2(-best.u, -best.v) * 180) / Math.PI + 360) % 360;
    }
    return {
      ok: true,
      dir: derived,
      storedDir: best.direction,
      h: best.speed,
      cellLat: best.lat,
      cellLng: best.lng,
      cellOffsetDeg: bd,
      cols: wg.cols,
      rows: wg.rows,
      dirConfidence: best.dirConfidence != null ? best.dirConfidence : null,
      signature: String(diag.lastUploadedGridSignature || ''),
      model: diag.activeModel,
      layer: diag.activeMarineLayer,
      zoom: (window.__RAW_GPU__ && window.__RAW_GPU__.anim && window.__RAW_GPU__.anim.zoom) || null,
    };
  }, [lat, lng]);
}

/** The MARKER's number: the point lane at the exact coordinate. Zoom-independent by construction. */
async function readMarker(page, model, layer, lat, lng) {
  return page.evaluate(async ([m, ly, la, ln]) => {
    const t = new Date();
    t.setUTCMinutes(0, 0, 0);
    t.setUTCHours(t.getUTCHours() - (t.getUTCHours() % 3));
    const vt = t.toISOString().replace(/\.\d+Z$/, 'Z');
    const api = (window.__RAW_API_BASE__ || 'https://raw-surf-antigravity.onrender.com');
    const qs = new URLSearchParams({
      model: m, domain: 'marine', layer: ly, lat: String(la), lng: String(ln), valid_time: vt,
    });
    try {
      const r = await fetch(`${api}/api/weather/point?${qs}`);
      if (!r.ok) return { ok: false, reason: 'HTTP ' + r.status };
      const j = await r.json();
      const p = j.point || {};
      return {
        ok: p.direction != null,
        dir: p.direction,
        h: p.speed,
        tp: p.period,
        product: String(j.product_id || 'DIRECT-POINT'),
        estimated: j.is_estimated,
        basis: (j.estimate_basis || {}).method || null,
      };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  }, [model, layer, lat, lng]);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => log('  [pageerror] ' + e.message.slice(0, 120)));

  log(`direction ladder | ${BASE} | (${LAT},${LNG}) | tolerance ${MAX_DELTA} deg at zoom >= ${SURF_ZOOM}`);
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded' });
  // Same readiness gate zoomlab.js uses — `window.map` is the mapbox handle the app exposes.
  await page.waitForFunction(() => window.map && window.__MARINE_ENGINE__, null, { timeout: 90000 });
  await sleep(4000);

  const rows = [];
  for (const model of MODELS) {
    if (!(await clickByText(page, model))) { log(`  ! model button ${model} not found`); continue; }
    await sleep(1200);
    for (const layer of LAYERS) {
      const label = LAYER_BUTTON[layer];
      if (!(await clickByText(page, label))) { log(`  ! layer button ${label} not found`); continue; }
      await sleep(SETTLE_MS);

      const marker = await readMarker(page, model, layer, LAT, LNG);
      log(`\n=== ${model} / ${layer} ===`);
      if (!marker.ok) { log(`  marker: unavailable (${marker.reason || '-'})`); }
      else {
        log(`  marker: dir=${marker.dir.toFixed(1)} h=${(marker.h || 0).toFixed(3)} `
          + `tp=${marker.tp} [${marker.product.slice(0, 46)}]`
          + (marker.basis ? ` basis=${marker.basis}` : ''));
      }

      for (const z of ZOOMS) {
        await page.evaluate(([la, ln, zz]) => {
          window.map.jumpTo({ center: [ln, la], zoom: zz });
        }, [LAT, LNG, z]);
        // Settle on the CAMERA first (zoomlab's contract), then give the fetch/commit its window.
        await page.waitForFunction(
          (zz) => Math.abs(window.map.getZoom() - zz) < 0.01, z, { timeout: 20000 },
        ).catch(() => {});
        await sleep(SETTLE_MS);
        const arrow = await readArrow(page, LAT, LNG);
        const delta = (arrow.ok && marker.ok) ? angDiff(arrow.dir, marker.dir) : null;
        const tier = arrow.ok && arrow.cols
          ? `${arrow.cols}x${arrow.rows}` : '-';
        rows.push({
          model, layer, zoom: z, engineZoom: arrow.zoom,
          arrowDir: arrow.ok ? arrow.dir : null,
          markerDir: marker.ok ? marker.dir : null,
          delta, tier, cellOffsetDeg: arrow.cellOffsetDeg,
          dirConfidence: arrow.dirConfidence, signature: arrow.signature,
          reason: arrow.ok ? null : arrow.reason,
        });
        const flag = (delta != null && delta > MAX_DELTA && z >= SURF_ZOOM) ? '  <== DISAGREES' : '';
        log(`    z=${String(z).padEnd(5)} arrow=${arrow.ok ? arrow.dir.toFixed(1).padStart(6) : '   -  '}`
          + `  marker=${marker.ok ? marker.dir.toFixed(1).padStart(6) : '   -  '}`
          + `  delta=${delta != null ? delta.toFixed(1).padStart(6) : '   -  '}`
          + `  grid=${tier.padEnd(9)}`
          + `  R=${arrow.dirConfidence != null ? arrow.dirConfidence.toFixed(2) : ' -  '}${flag}`);
      }
    }
  }

  // ── VERDICT ────────────────────────────────────────────────────────────────────────────────
  const surfRows = rows.filter((r) => r.zoom >= SURF_ZOOM && r.delta != null);
  const bad = surfRows.filter((r) => r.delta > MAX_DELTA);
  log(`\n${'='.repeat(76)}\nVERDICT\n${'='.repeat(76)}`);
  log(`  rungs at surf zoom (>= ${SURF_ZOOM}) with a comparable pair: ${surfRows.length}`);
  log(`  DISAGREEING by > ${MAX_DELTA} deg: ${bad.length}`
    + (surfRows.length ? ` (${(100 * bad.length / surfRows.length).toFixed(1)}%)` : ''));
  for (const r of bad.slice(0, 15)) {
    log(`    ${r.model}/${r.layer} z=${r.zoom} arrow=${r.arrowDir.toFixed(1)} `
      + `marker=${r.markerDir.toFixed(1)} delta=${r.delta.toFixed(1)}`);
  }
  // The convergence zoom the user described — first rung where each series comes into tolerance.
  log('\n  convergence zoom per model/layer (first rung within tolerance, and it must STAY within):');
  for (const model of MODELS) {
    for (const layer of LAYERS) {
      const series = rows.filter((r) => r.model === model && r.layer === layer && r.delta != null)
        .sort((a, b) => a.zoom - b.zoom);
      if (!series.length) continue;
      let conv = null;
      for (let i = 0; i < series.length; i += 1) {
        if (series.slice(i).every((s) => s.delta <= MAX_DELTA)) { conv = series[i].zoom; break; }
      }
      log(`    ${model.padEnd(5)} ${layer.padEnd(11)} ${conv == null ? 'NEVER converges' : 'converges at z=' + conv}`);
    }
  }

  fs.writeFileSync(path.join(outdir, 'direction-ladder.json'),
    JSON.stringify({ base: BASE, lat: LAT, lng: LNG, maxDelta: MAX_DELTA, rows }, null, 1));
  log(`\n  results -> ${path.join(outdir, 'direction-ladder.json')}`);

  await context.close();
  await browser.close();
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { log('FATAL ' + e.stack); process.exit(2); });
