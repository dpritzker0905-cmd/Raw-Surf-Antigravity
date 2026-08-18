/**
 * alpha-lever-halodamp.js — the §17 next step: does `__RAW_DISABLE_HALO_DAMP__` own the coastal
 * alpha ramp at Madeira?
 *
 * Derived from alpha-lever-isolated.js (one page load per leg, lever set via addInitScript before
 * the first frame, every leg replicated, stability gate arbitrates). The sampler and the matte
 * solve are copied VERBATIM — this run changes the legs and the telemetry, not the instrument.
 *
 * TWO THINGS THIS ADDS, both because the lever is not the clean single-term switch its name implies:
 *
 * 1. ENGAGEMENT CHECK. The damp is conditional (`WebGLMarineEngine.js:1237`: it needs
 *    baseWashOpacity > 0 AND _coarseMaskVisible AND !_washSole). If it never fires at this camera,
 *    disabling it changes nothing and the leg reads IDENTICALLY to "this term does not own the
 *    ramp". Those are different findings. `__RAW_GPU__.haloDamp` distinguishes them, so it is read
 *    in both legs and the run is declared VOID rather than negative if stock shows haloDamp=false.
 *
 * 2. COMPOUND-LEVER CHECK. `__RAW_DISABLE_HALO_DAMP__` gates `_coarseMaskVisibleRaw` (line 1224),
 *    and that feeds BOTH the wash damp (1237) AND `this._maskEdgeSharp` (1236). If _midCarveEngage
 *    is false at this camera, the lever also flips maskFade from the crisp smoothstep(0.45,0.6) to
 *    the soft smoothstep(0.3,0.8) — moving TWO alpha terms at once, in opposite directions. So
 *    `_maskEdgeSharp` is read per leg off `window.__MARINE_ENGINE__`; if it differs between legs the
 *    comparison is confounded and the attribution must be refused.
 *
 * Telemetry is captured WITH WAVES ON, immediately after the C1 composite. The parent harness read
 * it after `setWaves(false)`, i.e. after the engine had stopped painting the field being measured.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AI_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'alpha-lever-halodamp-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[halodamp] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };

const TARGET = { id: 'madeira', center: [-16.92, 32.74], z: 9.30, rayDeg: 0.45 };
const FORCED_WATER = '#ff0000';
const MIN_SEP = 20;
const DISTS = [0, 1, 2, 4, 8, 16, 32, 64, 128];
const STABLE_EPS = 0.08;
const REPLICATES = 2;
const LEGS = [
  { id: 'stock', flags: {} },
  { id: 'halo_damp_off', flags: { __RAW_DISABLE_HALO_DAMP__: true } },
];

const sampleRays = ({ tgt, dists }) => {
  const m = window.map;
  return new Promise((resolve) => {
    const fn = () => {
      m.off('render', fn);
      const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
      const dpr = src.width / rect.width;
      const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
      const c2 = cv.getContext('2d', { willReadFrequently: true }); c2.drawImage(src, 0, 0);
      const img = c2.getImageData(0, 0, cv.width, cv.height).data;
      const waterIds = (() => {
        try {
          const ids = (m.getStyle().layers || []).filter((l) => l['source-layer'] === 'water' || l.id === 'water')
            .map((l) => l.id).filter((id) => { try { return !!m.getLayer(id); } catch (e) { return false; } });
          return ids.length ? ids : ['water'];
        } catch (e) { return ['water']; }
      })();
      const px = (cx, cy) => {
        const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) return null;
        const o = (Y * cv.width + X) * 4; return [img[o], img[o + 1], img[o + 2]];
      };
      const buckets = {}; for (const d of dists) buckets[d] = [];
      let used = 0;
      for (let b = 0; b < 24; b++) {
        const th = (b / 24) * 2 * Math.PI;
        const dest = [tgt.center[0] + tgt.rayDeg * Math.sin(th) / Math.cos(tgt.center[1] * Math.PI / 180),
          tgt.center[1] + tgt.rayDeg * Math.cos(th)];
        const p0 = m.project(tgt.center), p1 = m.project(dest);
        const dx = p1.x - p0.x, dy = p1.y - p0.y, n = Math.max(4, Math.round(Math.hypot(dx, dy) * dpr));
        const water = [];
        for (let i = 0; i <= n; i++) {
          const cx = p0.x + dx * i / n, cy = p0.y + dy * i / n;
          const okv = cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height
            && (document.elementFromPoint(cx, cy) || {}).tagName === 'CANVAS';
          let w = null;
          if (okv) { try { w = m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) {} }
          water.push(w);
        }
        let coast = -1;
        for (let i = 1; i + 8 <= n; i++) {
          if (water[i] !== true) continue;
          let ok = true; for (let k = 0; k < 8; k++) if (water[i + k] !== true) { ok = false; break; }
          if (ok && water.slice(0, i).some((x) => x === false)) { coast = i; break; }
        }
        if (coast < 0) continue;
        used++;
        for (const d of dists) {
          const i = coast + d; if (i > n || i < 0) continue;
          const c = px(p0.x + dx * i / n, p0.y + dy * i / n); if (c) buckets[d].push(c);
        }
      }
      const mean = (a) => (a.length ? [0, 1, 2].map((k) => a.reduce((s, p) => s + p[k], 0) / a.length) : null);
      const o = { usedRays: used };
      for (const d of dists) o['d' + d] = mean(buckets[d]);
      resolve(o);
    };
    m.on('render', fn); m.triggerRepaint();
  });
};

const readState = () => {
  const g = window.__RAW_GPU__ || {}, e = window.__MARINE_ENGINE__ || null, m = window.map;
  return {
    haloDamp: g.haloDamp === undefined ? null : g.haloDamp,
    washPreDamp: g.washPreDamp === undefined ? null : g.washPreDamp,
    washEff: g.washEff === undefined ? null : g.washEff,
    washNoTruthDamp: g.washNoTruthDamp === undefined ? null : g.washNoTruthDamp,
    baseWashGated: g.baseWashGated === undefined ? null : g.baseWashGated,
    baseMaskDense: g.baseMaskDense === undefined ? null : g.baseMaskDense,
    bandWashUndamp: g.bandWashUndamp === undefined ? null : g.bandWashUndamp,
    baseCrispMask: g.baseCrispMask === undefined ? null : g.baseCrispMask,
    maskEdgeSharp: e ? e._maskEdgeSharp : null,
    engineHandle: !!e,
    overlayReason: g.overlayMask ? g.overlayMask.reason : null,
    overlayOn: g.overlayMask ? g.overlayMask.on : null,
    leverSeen: window.__RAW_DISABLE_HALO_DAMP__ === true,
    zoom: m ? +m.getZoom().toFixed(2) : null,
  };
};

async function runLeg(browser, leg, rep) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript((flags) => {
    window.__DISABLE_WEBGL_GUARDRAIL__ = true;
    Object.assign(window, flags);
  }, leg.flags);
  await page.goto(BASE + '/auth', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('raw-surf-theme', 'beach');
  }, { u: USER });
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.map, null, { timeout: 120000 });
  await page.evaluate(() => {
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      const r = f.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.8) f.remove();
    }
  });
  const setWaves = (on) => page.evaluate((want) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (!b) return 'no-button';
    if ((b.getAttribute('aria-pressed') === 'true') !== want) b.click();
    return b.getAttribute('aria-pressed');
  }, on);
  const setWater = (colour) => page.evaluate((col) => {
    const m = window.map; const done = [];
    for (const l of (m.getStyle().layers || [])) {
      if (l['source-layer'] === 'water' || l.id === 'water' || /(^|[-_])water$/.test(l.id)) {
        try { m.setPaintProperty(l.id, 'fill-color', col === null ? undefined : col); done.push(l.id); } catch (e) {}
      }
    }
    return done;
  }, colour);

  await setWaves(true);
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: TARGET.center, z: TARGET.z });
  await page.waitForTimeout(15000);

  await setWater(null); await page.waitForTimeout(2500);
  const C1 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
  // Telemetry WITH THE FIELD PAINTING — this is the state the C1 composite was drawn under.
  const state = await page.evaluate(readState);
  await setWater(FORCED_WATER); await page.waitForTimeout(2500);
  const C2 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
  await setWaves(false); await page.waitForTimeout(6500);
  const B2 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
  await setWater(null); await page.waitForTimeout(2500);
  const B1 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
  await ctx.close();

  const rows = DISTS.map((d) => {
    const c1 = C1['d' + d], c2 = C2['d' + d], b1 = B1['d' + d], b2 = B2['d' + d];
    if (!c1 || !c2 || !b1 || !b2) return { d, alpha: null };
    const per = [];
    for (let k = 0; k < 3; k++) {
      const sep = b1[k] - b2[k];
      if (Math.abs(sep) < MIN_SEP) continue;
      per.push(1 - (c1[k] - c2[k]) / sep);
    }
    if (!per.length) return { d, alpha: null };
    per.sort((x, y) => x - y);
    return { d, alpha: +per[Math.floor(per.length / 2)].toFixed(3) };
  });
  const a0 = rows[0].alpha, aFar = rows[rows.length - 1].alpha;
  return { leg: leg.id, rep, rays: C1.usedRays, state, rows,
    spread: (a0 !== null && aFar !== null) ? +(aFar - a0).toFixed(3) : null };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const all = [];
  for (const leg of LEGS) {
    for (let rep = 1; rep <= REPLICATES; rep++) {
      const r = await runLeg(browser, leg, rep);
      all.push(r);
      log(`${leg.id.padEnd(14)} rep${rep} rays=${r.rays} z=${r.state.zoom} damp=${r.state.haloDamp}`
        + ` sharp=${r.state.maskEdgeSharp} wash=${r.state.washPreDamp}/${r.state.washEff}`
        + ` ovl=${r.state.overlayReason}`);
      log(`${' '.repeat(14)}      alpha:`
        + r.rows.map((x) => String(x.alpha === null ? '-' : x.alpha.toFixed(3)).padStart(7)).join('')
        + `  spread=${r.spread}`);
    }
  }
  log('');
  log('LEG              rep1    rep2    |diff|   verdict');
  const summary = [];
  for (const leg of LEGS) {
    const rs = all.filter((r) => r.leg === leg.id);
    const s1 = rs[0] && rs[0].spread, s2 = rs[1] && rs[1].spread;
    const diff = (s1 !== null && s2 !== null && s1 !== undefined && s2 !== undefined)
      ? +Math.abs(s1 - s2).toFixed(3) : null;
    const stable = diff !== null && diff <= STABLE_EPS;
    summary.push({ leg: leg.id, s1, s2, diff, stable, mean: stable ? +((s1 + s2) / 2).toFixed(3) : null });
    log(`${leg.id.padEnd(14)} ${String(s1).padStart(6)}  ${String(s2).padStart(6)}  ${String(diff).padStart(6)}   `
      + (stable ? 'stable' : 'UNSTABLE - attribution refused'));
  }

  // ── VALIDITY GATES (run BEFORE any attribution) ───────────────────────────────
  const stockLegs = all.filter((r) => r.leg === 'stock');
  const offLegs = all.filter((r) => r.leg === 'halo_damp_off');
  const dampEngaged = stockLegs.some((r) => r.state.haloDamp === true);
  const leverTook = offLegs.every((r) => r.state.leverSeen === true);
  const sharpStock = [...new Set(stockLegs.map((r) => r.state.maskEdgeSharp))];
  const sharpOff = [...new Set(offLegs.map((r) => r.state.maskEdgeSharp))];
  const confounded = JSON.stringify(sharpStock) !== JSON.stringify(sharpOff);
  log('');
  log('VALIDITY');
  log(`  lever present in off legs : ${leverTook}`);
  log(`  damp ENGAGED in stock     : ${dampEngaged}  (stock haloDamp=${stockLegs.map((r) => r.state.haloDamp).join(',')})`);
  log(`  maskEdgeSharp stock/off   : ${JSON.stringify(sharpStock)} / ${JSON.stringify(sharpOff)}`
    + (confounded ? '  <-- COMPOUND LEVER: two terms moved, attribution confounded' : '  (single term)'));
  if (!dampEngaged) {
    log('  => VOID BY CONSTRUCTION: the damp never fired at this camera, so this lever could not');
    log('     have changed anything. A flat result here is NOT evidence the term is innocent.');
  }

  const stock = summary.find((s) => s.leg === 'stock');
  if (stock && stock.stable && dampEngaged && !confounded) {
    log('');
    log(`stock spread = ${stock.mean}. A lever OWNS the ramp if it is stable AND much flatter:`);
    for (const s of summary.filter((x) => x.leg !== 'stock' && x.stable)) {
      log(`   ${s.leg.padEnd(14)} spread ${s.mean}  => ${((1 - s.mean / stock.mean) * 100).toFixed(0)}% flatter`);
    }
    const unstable = summary.filter((x) => !x.stable).map((x) => x.leg);
    if (unstable.length) log(`   (refused as unstable: ${unstable.join(', ')})`);
  } else if (!stock || !stock.stable) {
    log('  => stock itself is unstable - no attribution possible from this run');
  } else {
    log('  => attribution WITHHELD (see VALIDITY above)');
  }
  fs.writeFileSync(path.join(outdir, 'alpha-lever-halodamp.json'),
    JSON.stringify({ base: BASE, target: TARGET, dists: DISTS, stableEps: STABLE_EPS,
      validity: { dampEngaged, leverTook, sharpStock, sharpOff, confounded }, all, summary }, null, 1));
  log('written: ' + path.join(outdir, 'alpha-lever-halodamp.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
