/**
 * teardown-255-whopaints.js — in 'why' mode the hole shows NEITHER discard. So who owns those pixels?
 *
 * THE READING THAT PRODUCED THIS. With `__GPU_DEBUG__.mode='why'` the heatmap pass writes pure
 * RED/BLUE/GREEN at alpha 1.0. Beyond the hole every sample is GREEN. INSIDE the hole not one sample
 * carries a debug colour at all — it reads rgb(191,105,105), (255,255,255), (232,200,200). So the
 * cause is NOT a discard: either the pass never covers those pixels, or something fully opaque is
 * painted on top of them afterwards.
 *
 * ⛔ WHY THE EARLIER COVERS TEST DID NOT CATCH THIS. It asked which layers are PRESENT inside the
 * hole versus beyond it and found them identical (`water`, `water-shadow`, `ocean-mask-inland-water`),
 * so it reported "nothing unique to the hole". But presence is not opacity and it is not order: a
 * layer spanning the whole ocean can still be OPAQUE only in a coastal band, and it can only hide the
 * field if it paints ABOVE the marine layer. The test never checked either. A shared layer with a
 * coast-varying paint is exactly the blind spot of a set-difference.
 *
 * THE INTERVENTION. Hold 'why' mode on, sample one pixel INSIDE the hole, then take each candidate
 * layer's opacity to 0 one at a time and re-read that pixel:
 *
 *     it turns GREEN  ⇒ that layer was covering the field. A LAYER-ORDER/paint defect, and the fix
 *                       belongs in LAYER_ORDER_PROOF_LOG.json per the owner mandate.
 *     nothing turns   ⇒ no basemap layer is responsible; the heatmap GEOMETRY genuinely stops 8 px
 *                       short of the coast, and the cause is upstream of the fragment shader.
 *
 * ⛔ OPACITY, NEVER `visibility:'none'` — OceanMask.js:658 silently reverts visibility, which would
 * clear a guilty layer with a FALSE NEGATIVE. (Landmine from the 08-16 arc.)
 * ⛔ Paint order comes from `map.style._order`, which includes custom layers; `getStyle().layers`
 * omits them and would make every candidate look "above" by default.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.TD_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'teardown-255-whopaints-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[whopaints] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };
const PT = { lng: -17.12638, lat: 32.69350 };
const Z = 9.30;
const PROBE_D = [2, 4, 6];      // CSS px seaward along the coast normal, inside the 8 px hole
const CONTROL_D = 14;           // beyond it — must stay GREEN in every leg or the harness is lying

const run = ({ pt, probeD, controlD }) => {
  const m = window.map;
  return new Promise((resolve) => {
    const fn = async () => {
      m.off('render', fn);
      const rect = m.getContainer().getBoundingClientRect();
      const waterIds = (m.getStyle().layers || [])
        .filter((l) => l['source-layer'] === 'water' || l.id === 'water')
        .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
      const isWater = (cx, cy) => {
        if (!(cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height)) return null;
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
      if (nW < 6 || nL < 6) { resolve({ err: `ring not a coast (w${nW}/l${nL})` }); return; }
      const mag = Math.hypot(sx, sy) || 1, nx = sx / mag, ny = sy / mag;

      const readAt = (ds) => new Promise((res) => {
        const g = () => {
          m.off('render', g);
          const src = m.getCanvas();
          const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
          const c2 = cv.getContext('2d', { willReadFrequently: true }); c2.drawImage(src, 0, 0);
          const img = c2.getImageData(0, 0, cv.width, cv.height).data;
          const dpr = src.width / rect.width;
          res(ds.map((d) => {
            const X = Math.round((c0.x + nx * d) * dpr), Y = Math.round((c0.y + ny * d) * dpr);
            const o = (Y * cv.width + X) * 4;
            return { d, c: [img[o], img[o + 1], img[o + 2]] };
          }));
        };
        m.on('render', g); m.triggerRepaint();
      });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));

      // paint order INCLUDING custom layers
      const order = (m.style && m.style._order) ? m.style._order.slice() : [];
      const styleIds = new Set((m.getStyle().layers || []).map((l) => l.id));
      const customIds = order.filter((id) => !styleIds.has(id));
      const marineIdx = Math.min(...customIds.map((id) => order.indexOf(id)).filter((i) => i >= 0));

      // candidates: everything rendered at the hole, plus the known coastal suspects
      const holePt = [c0.x + nx * probeD[1], c0.y + ny * probeD[1]];
      let feats = [];
      try { feats = m.queryRenderedFeatures(holePt) || []; } catch (e) {}
      const atHole = [];
      for (const f of feats) if (f.layer && atHole.indexOf(f.layer.id) < 0) atHole.push(f.layer.id);
      const extra = order.filter((id) => /ocean-mask|water-shadow|coast|shore|halo|buffer/i.test(id));
      const candidates = Array.from(new Set(atHole.concat(extra)))
        .filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });

      if (!window.__GPU_DEBUG__) window.__GPU_DEBUG__ = { mode: null };
      window.__GPU_DEBUG__.mode = 'why';
      m.triggerRepaint(); await wait(3500);
      const baseline = await readAt(probeD.concat([controlD]));

      const legs = [];
      for (const id of candidates) {
        const layer = m.getLayer(id); if (!layer) continue;
        const type = layer.type;
        const prop = type === 'line' ? 'line-opacity' : type === 'fill' ? 'fill-opacity'
          : type === 'symbol' ? 'icon-opacity' : type === 'background' ? 'background-opacity'
            : type === 'raster' ? 'raster-opacity' : type === 'circle' ? 'circle-opacity' : null;
        if (!prop) { legs.push({ id, type, skipped: 'no opacity property for this layer type' }); continue; }
        let prev = null;
        try { prev = m.getPaintProperty(id, prop); } catch (e) {}
        try { m.setPaintProperty(id, prop, 0); } catch (e) { legs.push({ id, type, skipped: 'setPaintProperty threw' }); continue; }
        m.triggerRepaint(); await wait(1400);
        const after = await readAt(probeD.concat([controlD]));
        try { m.setPaintProperty(id, prop, prev === undefined ? 1 : prev); } catch (e) {}
        m.triggerRepaint(); await wait(700);
        legs.push({ id, type, prop, aboveMarine: order.indexOf(id) > marineIdx, orderIdx: order.indexOf(id), after });
      }
      window.__GPU_DEBUG__.mode = null; m.triggerRepaint();
      resolve({ nx: +nx.toFixed(3), ny: +ny.toFixed(3), marineIdx, customIds, candidates, baseline, legs,
        zoom: +m.getZoom().toFixed(2) });
    };
    m.on('render', fn); m.triggerRepaint();
  });
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
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
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 180000 });
  await page.evaluate(({ p, z }) => window.map.jumpTo({ center: [p.lng, p.lat], zoom: z }), { p: PT, z: Z });
  await page.waitForTimeout(16000);
  const r = await page.evaluate(run, { pt: PT, probeD: PROBE_D, controlD: CONTROL_D });
  await page.screenshot({ path: path.join(outdir, 'whopaints.png') });
  await ctx.close(); await browser.close();

  if (r.err) { log('VOID: ' + r.err); return; }
  const isGreen = (c) => c && c[1] > 200 && c[0] < 60 && c[2] < 60;
  const fmt = (rows) => rows.map((x) => `d${x.d}:${isGreen(x.c) ? 'GREEN' : `rgb(${x.c.join(',')})`}`).join('  ');
  log(`z${r.zoom}  marine custom layer index ${r.marineIdx} (${JSON.stringify(r.customIds)})`);
  log(`baseline (why mode, nothing hidden):  ${fmt(r.baseline)}`);
  log('');
  log('hiding each candidate in turn (opacity -> 0):');
  const guilty = [];
  for (const leg of r.legs) {
    if (leg.skipped) { log(`  ${leg.id.padEnd(28)} ${String(leg.type).padEnd(10)} SKIPPED: ${leg.skipped}`); continue; }
    const inHole = leg.after.filter((x) => x.d !== CONTROL_D);
    const ctrl = leg.after.find((x) => x.d === CONTROL_D);
    const flipped = inHole.filter((x) => isGreen(x.c)).length;
    const ctrlOk = isGreen(ctrl && ctrl.c);
    if (flipped > 0 && ctrlOk) guilty.push({ id: leg.id, flipped, aboveMarine: leg.aboveMarine });
    log(`  ${leg.id.padEnd(28)} ${String(leg.type).padEnd(10)} above=${String(leg.aboveMarine).padEnd(5)} `
      + `flipped ${flipped}/${inHole.length}  ctrl=${ctrlOk ? 'ok' : 'BROKEN'}  ${fmt(leg.after)}`);
  }
  log('');
  if (!guilty.length) {
    log('NO COVERING LAYER — hiding every candidate leaves the hole non-GREEN, so nothing basemap-side '
      + 'is painting over the field. The heatmap GEOMETRY does not reach these pixels, and the cause is '
      + 'UPSTREAM of the fragment shader (the draw itself, not the mask and not a discard).');
  } else {
    log('COVERING LAYER FOUND — the field IS drawn and then hidden:');
    for (const g of guilty) log(`   ${g.id}  (flipped ${g.flipped} hole samples to GREEN, aboveMarine=${g.aboveMarine})`);
    log('⭐ This is a LAYER-ORDER/paint defect. Per the owner mandate the correction must be appended '
      + 'to program/weather-simulation/LAYER_ORDER_PROOF_LOG.json — a proof not in the log does not exist.');
  }
  fs.writeFileSync(path.join(outdir, 'whopaints.json'), JSON.stringify({ base: BASE, pt: PT, z: Z, ...r, guilty }, null, 1));
  log('written: ' + path.join(outdir, 'whopaints.json'));
})().catch((e) => { console.error(e); process.exit(1); });
