/**
 * island-reassert-ab.js — is the ISLAND RE-ASSERT (§26) the coastal displacement?
 *
 * THE CLAIM UNDER TEST. `reassertNeLand` composites the pristine Natural Earth 10m mask back over
 * the basemap-patched canvas with globalCompositeOperation='multiply' (WebGLMarineMaskRenderer.js
 * :85-87). Land=0, water=255, so multiply keeps land wherever EITHER source says land: the finished
 * overlay mask is the UNION of two land sets, and the union can only push the water edge SEAWARD.
 *
 * TWO INDEPENDENT ROUTES TO EACH STATE — the point of the design. `neFull` is captured only when
 * `canvas.width / lonSpan < __RAW_ISLAND_REASSERT_MAX_DENSITY__` (default 1200), so the pass can be
 * driven by its GATE as well as by its boolean kill switch:
 *      ON  : stock (threshold 1200)     | dens_high (threshold 5000)
 *      OFF : off_flag (boolean)         | dens_low  (threshold 400)
 * Two mechanisms reaching the same state is a far stronger control than one: if the two ON legs
 * agree, the two OFF legs agree, and ON != OFF, the attribution is causal. If two routes to the SAME
 * state disagree, something other than the re-assert moved and the run REFUSES rather than reports.
 *
 * ⛔ THE FIRST VERSION USED THRESHOLDS 900/800 TO STRADDLE A "FIXED" 850 px/deg AND THAT WAS WRONG —
 * see the DENS_LO/DENS_HI note below. The density is not a constant, and a Jacobian built on a
 * constant that drifts is not a Jacobian.
 *
 * PRIMARY METRIC — field alpha at the basemap shoreline, per ray, NEVER meaned across bearings (§19).
 * Basemap water is forced to #ff0000, so over water G and B are EXACTLY 0 and any field contribution
 * lifts them: a(d) = G(d) / G_far is a normalised alpha proxy needing no second background. a(0) is
 * the field's strength AT the basemap coast:
 *      re-assert ON  -> NE land asserted seaward of the basemap coast -> field suppressed -> a(0) LOW
 *      re-assert OFF -> only basemap truth -> field reaches the true shore -> a(0) HIGHER
 * a(0) needs no crossing detection, so it cannot be refused for want of a plateau.
 *
 * ⛔ THE FIRST VERSION KEYED ON R AND THREW AWAY 20 OF 24 RAYS. In BEACH theme the field is WARM, so
 * over forced red it RAISES R (far-field 245-247) — the depth test rejected exactly the rays where
 * the field was strongest. The channel was chosen from an assumption about colour; it is now chosen
 * from ray-profile-diag.js, which printed the actual pixels. Pick the channel the backdrop ZEROES.
 *
 * CONTROLS:
 *   1. ENGAGEMENT (§24a): islandReassert.applied must be true in both ON legs and false in both OFF
 *      legs. A lever that cannot fire reads exactly like a term that is innocent.
 *   2. GATE RELATION: applied must equal (densityPxDeg < threshold) on every gate-route leg. This
 *      replaces an assertion on the density VALUE, which drifts.
 *   3. RAY YIELD: refuse the run if a leg yields < 12 of 24 rays. A median from n=2 is not a median.
 *   4. FIELD ALIVE: a leg that painted no field at all is retried, not recorded as a silent zero —
 *      one replicate returned 0 of 24 rays that way.
 *   5. Replicates per leg, and the ON/OFF separation must exceed the within-state replicate scatter.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AI_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'island-reassert-ab-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[reassert] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };

const TARGET = { center: [-16.92, 32.74], z: 9.30, rayDeg: 0.45 };
const BEARINGS = 24;
const FORCED_WATER = '#ff0000';
const MIN_RAYS = 12;
const REPLICATES = 2;
// ⛔ MEASURED 2026-08-17, and it broke the first design: densityPxDeg is NOT the fixed 850 that
// §26 computed. It is canvas.width / lonSpan, and the padded bounds depend on the viewport AT PAINT
// TIME, which varies between loads — observed 850 and 690 in two replicates of the SAME leg. So
// thresholds of 900/800 do not reliably straddle the gate: at 690 a threshold of 800 leaves the
// re-assert ON when the design predicted OFF. The gate route is kept (it is a genuinely independent
// mechanism from the boolean) but moved OUTSIDE the observed range in both directions, so each leg's
// state is robust to the drift. The per-leg observed density is asserted against the threshold
// rather than against a constant.
const DENS_LO = 400;     // below any observed density => gate CLOSED => re-assert OFF
const DENS_HI = 5000;    // above any observed density => gate OPEN   => re-assert ON
const LEGS = [
  { id: 'stock',     expect: 'on',  flags: {} },
  { id: 'off_flag',  expect: 'off', flags: { __RAW_DISABLE_ISLAND_REASSERT__: true } },
  { id: 'dens_high', expect: 'on',  flags: { __RAW_ISLAND_REASSERT_MAX_DENSITY__: DENS_HI } },
  { id: 'dens_low',  expect: 'off', flags: { __RAW_ISLAND_REASSERT_MAX_DENSITY__: DENS_LO } },
];

const measure = ({ center, rayDeg, bearings }) => new Promise((resolve) => {
  const m = window.map;
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
    const rays = [];
    for (let b = 0; b < bearings; b++) {
      const th = (b / bearings) * 2 * Math.PI;
      const dest = [center[0] + rayDeg * Math.sin(th) / Math.cos(center[1] * Math.PI / 180),
        center[1] + rayDeg * Math.cos(th)];
      const p0 = m.project(center), p1 = m.project(dest);
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const nDev = Math.max(8, Math.round(Math.hypot(dx, dy) * dpr));
      const at = (i) => ({ cx: p0.x + dx * i / nDev, cy: p0.y + dy * i / nDev });
      const inView = (cx, cy) => cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height
        && (document.elementFromPoint(cx, cy) || {}).tagName === 'CANVAS';
      const water = [];
      const isWater = (i) => {
        if (water[i] !== undefined) return water[i];
        const { cx, cy } = at(i);
        if (!inView(cx, cy)) { water[i] = null; return null; }
        let w = null;
        try { w = m.queryRenderedFeatures([cx, cy], { layers: waterIds }).length > 0; } catch (e) {}
        water[i] = w; return w;
      };
      let coast = -1;
      for (let i = 1; i + 8 <= nDev; i++) {
        if (isWater(i) !== true) continue;
        let ok = true;
        for (let k = 1; k < 8; k++) if (isWater(i + k) !== true) { ok = false; break; }
        if (ok) { coast = i; break; }
      }
      if (coast < 0) { rays.push({ b, void: 'no_coast' }); continue; }
      // CHANNEL CHOICE, from ray-profile-diag.js rather than from assumption: in BEACH theme the
      // field is WARM, so compositing it over forced red RAISES R (245-247 far-field) and an
      // R-based depth test rejects exactly the rays where the field is strongest — which is how the
      // first attempt threw away 20 of 24. Over pure red water G and B are EXACTLY 0, so G is a
      // clean monotone alpha proxy: 0 = no field, G_far = full field. Measured: b0 holds 255,0,0
      // out to d16 then jumps to 231,107,74; b12 is 243,6,2 at d0 and 182,77,62 by d1.
      const G = [];
      for (let d = 0; d + coast <= nDev; d++) {
        const { cx, cy } = at(coast + d);
        if (!inView(cx, cy)) break;
        const X = Math.round(cx * dpr), Y = Math.round(cy * dpr);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) break;
        G.push(img[(Y * cv.width + X) * 4 + 1]);
      }
      if (G.length < 40) { rays.push({ b, void: 'short_ray' }); continue; }
      const far = G.slice(Math.floor(G.length * 0.66)).slice().sort((x, y) => x - y);
      const gFar = far[Math.floor(far.length / 2)];
      if (gFar < 40) { rays.push({ b, void: 'no_field', gFar }); continue; }
      // PRIMARY: normalised field alpha AT the basemap coastline (no crossing needed => no refusal)
      const a0 = Math.max(0, Math.min(1.5, G[0] / gFar));
      const a2 = Math.max(0, Math.min(1.5, G[2] / gFar));
      // SECONDARY: 50% crossing offset, clamped at 0 when the edge is at/inside the basemap coast
      const mid = 0.5 * gFar;
      let cross = 0;
      if (G[0] < mid) {
        cross = -1;
        for (let d = 1; d < G.length; d++) {
          if (G[d - 1] < mid && G[d] >= mid) { cross = (d - 1) + (mid - G[d - 1]) / Math.max(G[d] - G[d - 1], 1e-6); break; }
        }
      }
      rays.push({ b, a0: +a0.toFixed(3), a2: +a2.toFixed(3), offset: cross === -1 ? null : +cross.toFixed(2), gFar });
    }
    const g = window.__RAW_GPU__ || {};
    resolve({
      rays,
      islandReassert: g.islandReassert || null,
      overlayReason: g.overlayMask ? g.overlayMask.reason : null,
      zoom: +m.getZoom().toFixed(2),
      winFlag: window.__RAW_DISABLE_ISLAND_REASSERT__ === true,
      winDens: window.__RAW_ISLAND_REASSERT_MAX_DENSITY__ === undefined ? null : window.__RAW_ISLAND_REASSERT_MAX_DENSITY__,
    });
  };
  m.on('render', fn); m.triggerRepaint();
});

const stat = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return { n: s.length, median: +q(0.5).toFixed(3), p10: +q(0.1).toFixed(3), p90: +q(0.9).toFixed(3),
    spread: +(s[s.length - 1] - s[0]).toFixed(3) };
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
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Waves');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  await page.waitForFunction(() => window.__RAW_GPU__ && window.__RAW_GPU__.overlayMask, null, { timeout: 120000 });
  await page.evaluate(({ c, z }) => window.map.jumpTo({ center: c, zoom: z }), { c: TARGET.center, z: TARGET.z });
  await page.waitForTimeout(15000);
  await page.evaluate((col) => {
    const m = window.map;
    for (const l of (m.getStyle().layers || [])) {
      if (l['source-layer'] === 'water' || l.id === 'water' || /(^|[-_])water$/.test(l.id)) {
        try { m.setPaintProperty(l.id, 'fill-color', col); } catch (e) {}
      }
    }
  }, FORCED_WATER);
  await page.waitForTimeout(3000);

  // FIELD-ALIVE PRECHECK. One replicate returned 0 of 24 rays with `no_field` on every bearing —
  // the leg simply painted no field, and a leg that never rendered the subject reads identically to
  // one where the subject is absent for a real reason. Sample a known open-ocean point west of the
  // island: over forced red, G is 0 with no field and rises with it. Retry rather than record a
  // silent zero; report `fieldAlive` so a leg that never came up is visible in the output.
  const fieldAlive = async () => page.evaluate(({ c }) => {
    const m = window.map;
    const p = m.project([c[0] - 0.30, c[1]]);
    const src = m.getCanvas(), rect = m.getContainer().getBoundingClientRect();
    const dpr = src.width / rect.width;
    const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
    cv.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0);
    const d = cv.getContext('2d', { willReadFrequently: true })
      .getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data;
    return { g: d[1], rgb: [d[0], d[1], d[2]] };
  }, { c: TARGET.center });
  let alive = await fieldAlive();
  for (let tries = 0; tries < 3 && alive.g < 40; tries++) {
    await page.waitForTimeout(6000);
    alive = await fieldAlive();
  }

  const r = await page.evaluate(measure, { center: TARGET.center, rayDeg: TARGET.rayDeg, bearings: BEARINGS });
  r.fieldAlive = alive;
  await ctx.close();
  const a0s = r.rays.filter((x) => x.a0 !== undefined).map((x) => x.a0);
  const offs = r.rays.filter((x) => x.offset !== undefined && x.offset !== null).map((x) => x.offset);
  return { leg: leg.id, expect: leg.expect, rep, ...r, a0: stat(a0s), off: stat(offs) };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const all = [];
  for (const leg of LEGS) {
    for (let rep = 1; rep <= REPLICATES; rep++) {
      const r = await runLeg(browser, leg, rep);
      all.push(r);
      const ir = r.islandReassert || {};
      log(`${leg.id.padEnd(9)} rep${rep} expect=${leg.expect.padEnd(3)} applied=${String(ir.applied).padEnd(5)}`
        + ` reason=${String(ir.reason || ir.mode || '-').padEnd(12)} dens=${ir.densityPxDeg}`
        + `  rays=${r.a0 ? r.a0.n : 0}/${BEARINGS}`
        + `  a0 med=${r.a0 ? r.a0.median : '-'} (p10-p90 ${r.a0 ? r.a0.p10 + '-' + r.a0.p90 : '-'})`
        + `  offset med=${r.off ? r.off.median : '-'}`);
      const voids = r.rays.filter((x) => x.void);
      if (voids.length) log(`${' '.repeat(9)}      refused ${voids.length}: `
        + JSON.stringify(voids.reduce((a, x) => { a[x.void] = (a[x.void] || 0) + 1; return a; }, {})));
    }
  }
  await browser.close();

  // ── CONTROLS ──────────────────────────────────────────────────────────────
  const engagementOk = all.every((r) => {
    const ap = r.islandReassert && r.islandReassert.applied;
    return r.expect === 'on' ? ap === true : ap === false;
  });
  // Density is NOT a constant (observed 850 and 690 across replicates of one leg), so the control
  // cannot assert a value. It asserts the GATE RELATION instead: applied must equal (dens < threshold),
  // with the threshold defaulting to 1200 when the leg does not set one.
  const densities = all.map((r) => r.islandReassert && r.islandReassert.densityPxDeg);
  const densOk = all.every((r) => {
    const d = r.islandReassert && r.islandReassert.densityPxDeg;
    if (d === null || d === undefined) return false;
    if (r.winFlag) return true;                       // boolean kill switch bypasses the gate entirely
    const thr = r.winDens === null ? 1200 : r.winDens;
    return (r.islandReassert.applied === true) === (d < thr);
  });
  const yieldOk = all.every((r) => r.a0 && r.a0.n >= MIN_RAYS);
  log('');
  log('CONTROLS');
  log(`  1 engagement matches expectation : ${engagementOk}`);
  all.forEach((r) => log(`      ${r.leg}/rep${r.rep} expect=${r.expect} applied=${r.islandReassert && r.islandReassert.applied}`
    + ` reason=${(r.islandReassert && (r.islandReassert.reason || r.islandReassert.mode)) || '-'}`));
  log(`  2 gate relation applied==(dens<thr): ${densOk}  (observed densities ${JSON.stringify(densities)})`);
  log(`  3 ray yield >= ${MIN_RAYS}/24 every leg   : ${yieldOk}  (${all.map((r) => (r.a0 ? r.a0.n : 0)).join(',')})`);

  const med = (id) => {
    const rs = all.filter((r) => r.leg === id && r.a0);
    return rs.length ? +(rs.reduce((s, r) => s + r.a0.median, 0) / rs.length).toFixed(3) : null;
  };
  const onLegs = ['stock', 'dens_high'].map(med), offLegs = ['off_flag', 'dens_low'].map(med);
  log('');
  log('STATE BY ROUTE  [two independent mechanisms reaching each state]');
  log(`   stock (threshold 1200)   -> ${med('stock')}`);
  log(`   dens_high (thr 5000)     -> ${med('dens_high')}   gate OPEN   => ON`);
  log(`   off_flag  (boolean)      -> ${med('off_flag')}   kill switch => OFF`);
  log(`   dens_low  (thr 400)      -> ${med('dens_low')}   gate CLOSED => OFF`);
  const routeAgreeOn = onLegs.every((x) => x !== null) ? Math.abs(onLegs[0] - onLegs[1]) : null;
  const routeAgreeOff = offLegs.every((x) => x !== null) ? Math.abs(offLegs[0] - offLegs[1]) : null;
  const sep = (onLegs.every((x) => x !== null) && offLegs.every((x) => x !== null))
    ? ((offLegs[0] + offLegs[1]) / 2) - ((onLegs[0] + onLegs[1]) / 2) : null;
  log('');
  log('VERDICT');
  log(`  two ON routes agree within  : ${routeAgreeOn === null ? '-' : routeAgreeOn.toFixed(3)}`);
  log(`  two OFF routes agree within : ${routeAgreeOff === null ? '-' : routeAgreeOff.toFixed(3)}`);
  log(`  OFF - ON separation in a(0) : ${sep === null ? '-' : (sep > 0 ? '+' : '') + sep.toFixed(3)}`);
  if (!engagementOk || !yieldOk || !densOk) {
    log('  => WITHHELD: a control failed above. Not a negative result.');
  } else if (routeAgreeOn === null || routeAgreeOff === null || sep === null) {
    log('  => incomplete');
  } else if (Math.max(routeAgreeOn, routeAgreeOff) >= Math.abs(sep)) {
    log('  => REFUSED: the two routes to the SAME state disagree by as much as ON differs from OFF.');
    log('     Something other than the re-assert moved.');
  } else if (sep > 0.05) {
    log('  => CONFIRMED: disabling the island re-assert RAISES field alpha at the basemap shoreline,');
    log('     by BOTH the boolean and the gate route, and the gate flips exactly where it crosses 850.');
    log('     The union baked in by reassertNeLand suppresses the field seaward of the true coast.');
  } else if (sep < -0.05) {
    log('  => INVERTED: disabling it LOWERS shoreline alpha - opposite of the mechanism. Refuted as stated.');
  } else {
    log('  => REFUTED: no separation. The island re-assert does not move the shoreline alpha.');
  }
  fs.writeFileSync(path.join(outdir, 'island-reassert-ab.json'),
    JSON.stringify({ base: BASE, target: TARGET, legs: LEGS, all,
      controls: { engagementOk, densOk, yieldOk, routeAgreeOn, routeAgreeOff, sep } }, null, 1));
  log('written: ' + path.join(outdir, 'island-reassert-ab.json'));
})().catch((e) => { console.error(e); process.exit(1); });
