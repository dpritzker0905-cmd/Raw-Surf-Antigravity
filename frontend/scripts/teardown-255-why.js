/**
 * teardown-255-why.js — WHICH discard eats the 8 px? Paint the reason instead of inferring it.
 *
 * THE STATE OF THE TEARDOWN. At 32.69350 −17.12638 the mask reads 255 on every term, no layer covers
 * the hole, and the painted pixel is byte-identical to waves-OFF. Reading the shader closes the gap:
 * there are exactly TWO discards in the heatmap pass, and a merely-zero height cannot produce a blank
 * pixel — at displayHeight 0 the pass still paints the base depth colour. So a DISCARD ran.
 *
 *     if (oceanAlpha < 0.5) discard;                                  // the mask — already excluded
 *     if (u_surfMode > 0.5 && waveHeight*10.0 <= 0.05) discard;       // "the bilinear tail"
 *
 * `__GPU_DEBUG__.mode='mask'` already showed oceanAlpha ≈ 1 through the hole, so the second is the
 * only candidate left. THAT IS AN INFERENCE, and this harness exists to replace it with a reading:
 * the new `mode='why'` paints RED for a mask discard, BLUE for a rating discard, GREEN where the pass
 * paints, at alpha 1.0 so nothing is read through a blend.
 *
 * ⛔ THE COARSE WASH PASS IS DELIBERATELY NOT WIRED TO 'why' — it falls through to a normal render.
 * So a pixel that is not one of the three pure colours means the MAIN pass never covered it, which is
 * itself a distinct answer. Classification is by exact colour and anything else is reported as OTHER,
 * never folded into the nearest class.
 *
 * ⭐ THE PRECONDITION IS PART OF THE TEST. This runs against a LOCAL build (the change is not
 * deployed), so it first measures the hole the ordinary way. If the hole does not reproduce locally,
 * the why-map is meaningless and the harness says so instead of reporting colours — the same rule
 * that made the grid control useful when it refused to answer.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.TD_BASE || 'http://localhost:3000';
const outdir = process.argv[2] || path.join(__dirname, 'teardown-255-why-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[why] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const PT = { lng: -17.12638, lat: 32.69350 };
const Z = Number(process.env.TD_ZOOM || 9.30);

const walk = ({ pt }) => {
  const m = window.map;
  return new Promise((resolve) => {
    const fn = () => {
      m.off('render', fn);
      const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
      const dpr = src.width / rect.width;
      const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
      const c2 = cv.getContext('2d', { willReadFrequently: true }); c2.drawImage(src, 0, 0);
      const img = c2.getImageData(0, 0, cv.width, cv.height).data;
      const waterIds = (m.getStyle().layers || [])
        .filter((l) => l['source-layer'] === 'water' || l.id === 'water')
        .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
      const px = (cx, cy) => {
        const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) return null;
        const o = (Y * cv.width + X) * 4; return [img[o], img[o + 1], img[o + 2]];
      };
      const isWater = (cx, cy) => {
        if (!(cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height)) return null;
        if ((document.elementFromPoint(cx, cy) || {}).tagName !== 'CANVAS') return null;
        try { return m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) { return null; }
      };
      const c0 = m.project([pt.lng, pt.lat]);
      const R = 14; let sx = 0, sy = 0, nW = 0, nL = 0;
      for (let a = 0; a < 72; a++) {
        const th = (a / 72) * 2 * Math.PI;
        const w = isWater(c0.x + R * Math.cos(th), c0.y + R * Math.sin(th));
        if (w === true) { sx += Math.cos(th); sy += Math.sin(th); nW++; }
        else if (w === false) nL++;
      }
      if (nW < 6 || nL < 6) { resolve({ void: `ring not a coast (w${nW}/l${nL})` }); return; }
      const mag = Math.hypot(sx, sy) || 1, nx = sx / mag, ny = sy / mag;
      const rows = [];
      for (let d = -8; d <= 40; d++) rows.push({ d, water: isWater(c0.x + nx * d, c0.y + ny * d), c: px(c0.x + nx * d, c0.y + ny * d) });
      resolve({ dpr, rows, zoom: +m.getZoom().toFixed(3),
        overlayReason: ((window.__RAW_GPU__ || {}).overlayMask || {}).reason || null,
        mPerCssPx: +(156543.03392 * Math.cos(m.getCenter().lat * Math.PI / 180) / Math.pow(2, m.getZoom()) / 2).toFixed(2) });
    };
    m.on('render', fn); m.triggerRepaint();
  });
};
const setDebug = (mode) => {
  if (!window.__GPU_DEBUG__) window.__GPU_DEBUG__ = { mode: null };
  window.__GPU_DEBUG__.mode = mode;
  if (window.map) window.map.triggerRepaint();
  return window.__GPU_DEBUG__.mode;
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('PAGE ERROR: ' + e.message));
  await page.addInitScript(() => { window.__DISABLE_WEBGL_GUARDRAIL__ = true; });
  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('raw-surf-theme', 'beach');
  }, { u: USER });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.map, null, { timeout: 180000 });
  await page.evaluate(() => {
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      const r = f.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.8) f.remove();
    }
  });
  const setWaves = (on) => page.evaluate((want) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && ((b.getAttribute('aria-pressed') === 'true') !== want)) b.click();
  }, on);
  await setWaves(true);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 180000 });
  await page.evaluate(({ p, zz }) => window.map.jumpTo({ center: [p.lng, p.lat], zoom: zz }), { p: PT, zz: Z });
  await page.waitForTimeout(16000);

  // ---- PRECONDITION: does the hole reproduce on THIS build? ----
  const ON = await page.evaluate(walk, { pt: PT });
  await page.screenshot({ path: path.join(outdir, 'WHY_normal.png') });
  await setWaves(false); await page.waitForTimeout(7000);
  const OFF = await page.evaluate(walk, { pt: PT });
  await setWaves(true); await page.waitForTimeout(9000);

  if (ON.void || OFF.void) { log(`VOID: ${ON.void || OFF.void}`); await browser.close(); return; }
  const d3 = (a, b) => (!a || !b) ? null : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const shore = ON.rows.find((r) => r.water === true);
  const firstField = shore && ON.rows.find((r) => r.d >= shore.d && r.water === true &&
    (d3(r.c, (OFF.rows.find((q) => q.d === r.d) || {}).c) || 0) > 10);
  const hole = (shore && firstField) ? firstField.d - shore.d : null;
  log(`build=${BASE}  z${ON.zoom}  overlay=${ON.overlayReason}  m/cssPx=${ON.mPerCssPx}`);
  log(`PRECONDITION — hole = ${hole === null ? 'none found' : hole + ' css px / ' + (hole * ON.mPerCssPx).toFixed(0) + ' m'}`);
  if (!hole) {
    log('⛔ THE HOLE DOES NOT REPRODUCE ON THIS BUILD. The why-map would be describing a different '
      + 'defect, so it is not run. This is a precondition failure, NOT evidence about the cause.');
    fs.writeFileSync(path.join(outdir, 'why.json'), JSON.stringify({ base: BASE, precondition: 'no hole', hole, ON, OFF }, null, 1));
    await browser.close(); return;
  }

  // ---- THE READING ----
  const mode = await page.evaluate(setDebug, 'why');
  await page.waitForTimeout(5000);
  const WHY = await page.evaluate(walk, { pt: PT });
  await page.screenshot({ path: path.join(outdir, 'WHY_map.png') });
  await page.evaluate(setDebug, null);
  await browser.close();

  if (WHY.void) { log(`why-walk VOID: ${WHY.void}`); return; }
  const cls = (c) => {
    if (!c) return 'n/a';
    const [r, g, b] = c;
    if (r > 200 && g < 60 && b < 60) return 'RED   mask discard';
    if (b > 200 && r < 60 && g < 60) return 'BLUE  RATING discard';
    if (g > 200 && r < 60 && b < 60) return 'GREEN pass paints';
    return `OTHER rgb(${r},${g},${b}) — main pass did not cover this pixel`;
  };
  log(`debug mode set to: ${mode}`);
  log('');
  log('  d(css)  basemap   why-map');
  const rows = [];
  for (const r of WHY.rows) {
    const k = cls(r.c);
    rows.push({ d: r.d, water: r.water, c: r.c, cls: k });
    if (r.d >= -4 && r.d <= 22) log(`  ${String(r.d).padStart(5)}   ${(r.water === null ? '?' : r.water ? 'water' : 'LAND ').padEnd(7)}  ${k}`);
  }
  const inHole = rows.filter((r) => r.water === true && r.d >= (shore ? shore.d : 0) && r.d < (shore.d + hole));
  const beyond = rows.filter((r) => r.water === true && r.d >= (shore.d + hole) && r.d <= shore.d + hole + 12);
  const tally = (a) => a.reduce((m, r) => { const k = r.cls.split(' ')[0]; m[k] = (m[k] || 0) + 1; return m; }, {});
  log('');
  log(`inside the hole  (${inHole.length} samples): ${JSON.stringify(tally(inHole))}`);
  log(`beyond the hole  (${beyond.length} samples): ${JSON.stringify(tally(beyond))}`);
  const t = tally(inHole);
  const dominant = Object.keys(t).sort((a, b) => t[b] - t[a])[0];
  log('');
  log(dominant === 'BLUE'
    ? 'PROVEN — the RATING discard eats the hole: surf mode with ratingScore <= 0.05, the bilinear '
      + 'tail of the rating grid toward land. The mask is innocent, and the fix is DATA-SIDE.'
    : dominant === 'RED'
      ? 'CONTRADICTS THE TEARDOWN — the mask discard fires here even though probeMaskGPU read 255. '
        + 'Reconcile the two readings before acting on either.'
      : dominant === 'GREEN'
        ? 'CONTRADICTORY — the pass claims to paint inside a hole where nothing is painted. Something '
          + 'downstream of the fragment (blending, a later pass) is removing it.'
        : 'UNREADABLE — the main pass does not cover the hole at all, so neither discard is reached '
          + 'and the cause is that the pass is not drawn there.');
  fs.writeFileSync(path.join(outdir, 'why.json'),
    JSON.stringify({ base: BASE, z: Z, hole, holeM: +(hole * ON.mPerCssPx).toFixed(0), shoreD: shore.d, rows }, null, 1));
  log('written: ' + path.join(outdir, 'why.json'));
})().catch((e) => { console.error(e); process.exit(1); });
