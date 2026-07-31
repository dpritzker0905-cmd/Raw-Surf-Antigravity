/**
 * probe_land_bleed.js — is the marine field painting on LAND? Answered per PIXEL, not per impression.
 *
 * WHY THIS EXISTS. "The marine heatmap is covering land" is one of this repo's most-repeated user
 * reports, and it has been answered wrongly more than once — in both directions. On 2026-07-24 the
 * marine engine was the obvious suspect and was INNOCENT (the painter was `spot-geofences-layer`,
 * no `minzoom`, Mapbox clamping its radius ramp). On 2026-07-31, chasing it again, I produced THREE
 * separate false positives in one session before getting a real number:
 *
 *   1. A DOWNSCALED SCREENSHOT. 1774 px of sparse crest texture rendered into an 800 px image
 *      reads as a solid wash over the whole frame, land included. A screenshot is not a
 *      measurement for a sparse field.
 *   2. A ONE-PIXEL PROBE. Particle/crest paint is sparse, so a single sample per location lands
 *      BETWEEN streaks almost every time and reports "clean" no matter what is happening.
 *   3. A BLOCK SCAN classified by the block's CENTRE. At z6 a 32 px block spans ~48 km; centred on
 *      a thin Bahamian cay it is mostly the surrounding OCEAN, which is legitimately painted. That
 *      artifact reported 50.6% "land bleed" at Cuba and 58.2% at Andros. Both were noise.
 *
 * ★★ AND A FOURTH, THE SUBTLEST: `engine.probeMaskGPU()` reads the RESIDENT mask, which at z5-6 was
 * a regional 4096x2048 texture over 62° (≈1.7 km/px) — while the coarse wash draws with the WORLD
 * grid's own ~39 km mask (`_drawCoarseBasePass` binds `base.u_oceanMaskTexture`). The side-channel
 * probe and the shader can therefore disagree, and the probe is NOT the authority on what painted.
 *
 * ⇒ THE ONLY HONEST CLASSIFIER IS THE SHADER'S OWN MASK SAMPLE, READ AT THE SAME PIXEL.
 * `__GPU_DEBUG__ = {mode:'mask'}` makes HEATMAP_FS return the mask value it sampled, BEFORE its land
 * discard: ~0 over land, ~255 over water. So: grab that buffer, grab the normal buffer, and compare
 * them PIXEL FOR PIXEL. No blocks, no centres, no eyeballing, no side channel.
 *
 * REFERENCE MEASUREMENT (2026-07-31, GFS/waves, dark theme, ~2.9 M co-registered px per rung):
 *
 *     Florida east   z6..z11   land painted 0.000-0.007%   longest contiguous land run 0-2 px
 *     Bahamas/Cuba   z4..z10   land painted 0.000-0.030%
 *
 * A longest-run of 0-2 px is coastline antialiasing, not bleed. ★ REPORT THE RUN LENGTH, not just
 * the percentage: a real halo is a CONTIGUOUS band tens of pixels wide, while antialiasing and
 * lone-pixel noise are 1-2 px. The percentage alone cannot tell those apart.
 *
 * Usage (from frontend/, dev server on 3009 — NEVER 3001, that is the preview pane):
 *   node scripts/probe_land_bleed.js [outdir]
 * Env:
 *   LB_BASE    default http://localhost:3009
 *   LB_CENTER  default -80.60,28.41 (Cocoa)      LB_ZOOMS default 5,6,7,8,9,10
 *   LB_MODELS  default GFS                        LB_LAYERS default waves
 *   LB_MAX_PCT default 0.5   LB_MAX_RUN default 8   (exit 1 beyond either)
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { console.error('playwright missing: npm i -D @playwright/test'); process.exit(2); }

const BASE = process.env.LB_BASE || 'http://localhost:3009';
const CENTER = (process.env.LB_CENTER || '-80.60,28.41').split(',').map(Number);
const ZOOMS = (process.env.LB_ZOOMS || '5,6,7,8,9,10').split(',').map(Number);
const MODELS = (process.env.LB_MODELS || 'GFS').split(',');
const LAYERS = (process.env.LB_LAYERS || 'waves').split(',');
const MAX_PCT = Number(process.env.LB_MAX_PCT || 0.5);
const MAX_RUN = Number(process.env.LB_MAX_RUN || 8);
const LAYER_BUTTON = { waves: 'Waves', swell_1: 'Swell', swell_2: 'Swell 2', wind_waves: 'Wind Waves' };

const OUT = process.argv[2] || path.join(__dirname, 'land-bleed-out');
const lines = [];
const log = (s) => { console.log(s); lines.push(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, text) {
  return page.evaluate((t) => {
    let hit = false;
    document.querySelectorAll('button,[role="button"]').forEach((el) => {
      const s = (el.textContent || '').trim();
      if (!hit && (s === t || s.toLowerCase().startsWith(t.toLowerCase()))) { el.click(); hit = true; }
    });
    return hit;
  }, text);
}

/** The measurement. Everything above is plumbing; this is the instrument. */
async function measure(page, center, zoom) {
  return page.evaluate(async ([lng, lat, z]) => {
    const m = window.map, cv = m.getCanvas();
    const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true })
            || cv.getContext('webgl', { preserveDrawingBuffer: true });
    const frame = () => new Promise((r) => { m.once('render', () => r()); m.triggerRepaint(); });
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    m.jumpTo({ center: [lng, lat], zoom: z });
    await nap(2400); await frame();

    const W = Math.min(cv.width, 1400), H = Math.min(cv.height, 1400);
    const X0 = Math.floor((cv.width - W) / 2), Y0 = Math.floor((cv.height - H) / 2);
    const grab = () => { const b = new Uint8Array(W * H * 4);
      gl.readPixels(X0, Y0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };

    // The shader's OWN mask sample — the only classifier that describes what painted.
    window.__GPU_DEBUG__ = { mode: 'mask' };
    await frame(); await nap(320); await frame();
    const mk = grab();
    window.__GPU_DEBUG__ = { mode: null };
    await frame(); await nap(320); await frame();
    const nb = grab();

    let land = 0, landPainted = 0, water = 0, waterPainted = 0, drewPx = 0;
    let run = 0, longestRun = 0;
    for (let i = 0; i < mk.length; i += 4) {
      const mr = mk[i], mv = mk[i + 1], mb2 = mk[i + 2];
      // ⚠️⚠️ RESTRICT TO PIXELS THE HEATMAP ACTUALLY DREW — colour alone is NOT specific to marine.
      // In mask mode HEATMAP_FS emits the mask value as GREYSCALE, so a pixel it drew has r≈g≈b;
      // anywhere it did not draw, the coloured basemap shows through. Without this gate the
      // green-dominant test happily matches Florida's basemap PARKLAND and reports 2.9% "bleed" on
      // a frame where the marine field had barely rendered at all (water painted only 3.9%) —
      // measured 2026-07-31, the fifth false positive this class produced in one session.
      const drew = Math.abs(mr - mv) <= 12 && Math.abs(mv - mb2) <= 12;
      if (!drew) { run = 0; continue; }
      drewPx++;
      const r = nb[i], g = nb[i + 1], b = nb[i + 2];
      const marine = (g > r + 25 && g > b + 15);  // green-dominant = marine palette
      if (mv < 60) {
        land++;
        if (marine) { landPainted++; run++; if (run > longestRun) longestRun = run; } else run = 0;
      } else if (mv > 195) { water++; if (marine) waterPainted++; }
    }
    const g2 = window.__RAW_GPU__ || {};
    return {
      zoom: +m.getZoom().toFixed(2), landPx: land, waterPx: water, heatmapDrewPx: drewPx,
      landPaintedPct: +(100 * landPainted / Math.max(land, 1)).toFixed(3),
      waterPaintedPct: +(100 * waterPainted / Math.max(water, 1)).toFixed(1),
      longestLandRun: longestRun,
      maskReason: (g2.overlayMask || {}).reason, maskId: (g2.maskId || {}).mb,
      baseCrispMask: g2.baseCrispMask, washEff: g2.washEff,
    };
  }, [center[0], center[1], zoom]);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => log(`  ! page error: ${String(e).slice(0, 140)}`));
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.map && window.map.isStyleLoaded && window.map.isStyleLoaded(),
    null, { timeout: 90000 }).catch(() => {});
  await sleep(3000);

  log(`land-bleed probe | ${BASE} | centre ${CENTER.join(',')} | land classified by the SHADER's own mask`);
  const rows = [];
  for (const model of MODELS) {
    if (!(await clickByText(page, model))) log(`  ! model button ${model} not found`);
    await sleep(1200);
    for (const layer of LAYERS) {
      if (!(await clickByText(page, LAYER_BUTTON[layer] || layer))) { log(`  ! layer ${layer} not found`); continue; }
      await sleep(6000);
      log(`\n=== ${model} / ${layer} ===`);
      for (const z of ZOOMS) {
        const r = await measure(page, CENTER, z);
        rows.push({ model, layer, ...r });
        const bad = (r.landPaintedPct > MAX_PCT || r.longestLandRun > MAX_RUN) ? '  <== BLEED' : '';
        log(`  z=${String(z).padEnd(5)} landPx=${String(r.landPx).padStart(7)}`
          + `  LAND painted=${String(r.landPaintedPct).padStart(6)}%`
          + `  longestRun=${String(r.longestLandRun).padStart(4)}px`
          + `  water=${String(r.waterPaintedPct).padStart(5)}%`
          + `  drew=${String(r.heatmapDrewPx).padStart(7)}`
          + `  mask=${String(r.maskReason || '-').padEnd(14)} crisp=${r.baseCrispMask}${bad}`);
      }
    }
  }

  // ⚠️⚠️ VALIDITY GATE — A LAND NUMBER IS MEANINGLESS IF THE MARINE FIELD NEVER PAINTED.
  // If marine were bleeding onto land it would be painting WATER far more, so `waterPaintedPct`
  // near zero is proof the measurement is void, not proof the map is clean. Measured 2026-07-31:
  // the headless swiftshader context reported water 0.0% and land 1.9-3.1% "bleed" simultaneously
  // — internally contradictory, and it was basemap colour leaking through, not marine. The same
  // rungs in a real-GPU browser pane read water 95-98% and land 0.000-0.007%.
  // ⇒ RUN THIS AGAINST A REAL GPU. Under swiftshader it refuses rather than lies.
  const VALID_WATER_MIN = Number(process.env.LB_MIN_WATER_PCT || 20);
  const void_ = rows.filter((r) => r.waterPaintedPct < VALID_WATER_MIN);
  if (void_.length) {
    log(`\n${'='.repeat(74)}\n⚠️  MEASUREMENT VOID at ${void_.length}/${rows.length} rungs\n${'='.repeat(74)}`);
    log(`  waterPainted < ${VALID_WATER_MIN}% means the marine field did not render, so the LAND`);
    log(`  number describes the basemap, not the marine layer. Rungs: `
      + void_.map((r) => `z${r.zoom}=${r.waterPaintedPct}%`).join(' '));
    log('  Re-run against a real GPU (the in-app Browser pane), not headless swiftshader.');
    fs.writeFileSync(path.join(OUT, 'land-bleed.json'), JSON.stringify({ base: BASE, center: CENTER, rows, void: true }, null, 2));
    fs.writeFileSync(path.join(OUT, 'land-bleed.log'), lines.join('\n'));
    await browser.close();
    process.exit(2);                       // 2 = could not measure (distinct from 1 = bleed found)
  }

  const bad = rows.filter((r) => r.landPaintedPct > MAX_PCT || r.longestLandRun > MAX_RUN);
  log(`\n${'='.repeat(74)}\nVERDICT\n${'='.repeat(74)}`);
  log(`  rungs measured: ${rows.length}`);
  log(`  BLEEDING (>${MAX_PCT}% of land px, or a run >${MAX_RUN}px): ${bad.length}`);
  // ★ The run length is the discriminator. A real halo is a CONTIGUOUS band; antialiasing is 1-2 px.
  log(`  worst land run anywhere: ${Math.max(0, ...rows.map((r) => r.longestLandRun))} px`
    + `  (0-2 px = coastline antialiasing, not bleed)`);
  for (const r of bad) log(`    ${r.model}/${r.layer} z=${r.zoom} ${r.landPaintedPct}% run=${r.longestLandRun}px`);

  fs.writeFileSync(path.join(OUT, 'land-bleed.json'), JSON.stringify({ base: BASE, center: CENTER, rows }, null, 2));
  fs.writeFileSync(path.join(OUT, 'land-bleed.log'), lines.join('\n'));
  log(`\n  results -> ${path.join(OUT, 'land-bleed.json')}`);
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
