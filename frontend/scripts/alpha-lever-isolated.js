/**
 * alpha-lever-isolated.js — the lever sweep, with the state carry-over removed and the replicate
 * built IN.
 *
 * WHAT WENT WRONG IN THE SHARED-PAGE SWEEP. All legs ran sequentially in one page with a fixed 4 s
 * settle after flipping each flag. Flipping a lever kicks off async mask/overlay repaints that do
 * not finish in that window, so a leg partly reads the PREVIOUS leg's state. Two runs of the
 * identical configuration disagreed wildly — midzoom_carve_off gave 82% flatter then 44%,
 * halo_damp_off gave 2% then 69% — and in the second run halo_damp_off and crest_off returned
 * BYTE-IDENTICAL profiles, which two different levers cannot do unless the state never changed.
 * The stock leg reproduced fine (spread 0.613 / 0.597), so the alpha solve is sound; the isolation
 * was not.
 *
 * WHAT THIS DOES DIFFERENTLY:
 *   - ONE PAGE LOAD PER LEG. No leg can inherit another's mask, overlay or texture state.
 *   - The lever is applied via addInitScript, so it is set BEFORE the first frame. There is no
 *     flip-then-settle race at all, because nothing is ever flipped mid-session.
 *   - EVERY LEG IS RUN TWICE, in separate loads, and both replicates are reported. A leg whose two
 *     spreads disagree by more than STABLE_EPS is marked UNSTABLE and its attribution is refused.
 *     The previous sweep only revealed its own instability because a patch silently failed and I
 *     accidentally ran the same thing twice; that should not be luck.
 *   - Backgrounds B1/B2 are captured inside each leg's own load, so the matte solve never mixes a
 *     background from one session with a composite from another.
 *
 * Madeira only: it is the one target that reproduces (stock d0 = 0.100 / 0.099 / 0.099 across runs).
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AI_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'alpha-lever-isolated-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[isolated] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };

const TARGET = { id: 'madeira', center: [-16.92, 32.74], z: 9.30, rayDeg: 0.45 };
const FORCED_WATER = '#ff0000';
const MIN_SEP = 20;
const DISTS = [0, 1, 2, 4, 8, 16, 32, 64, 128];
const STABLE_EPS = 0.08;          // max |spread_rep1 - spread_rep2| for a leg to be believed
const REPLICATES = 2;
// FIX VERIFICATION (2026-08-17). The kill switch gives a paired A/B inside ONE build: `fixed` is
// the shipped path (midcarve REPLACE), `fix_disabled` restores the pre-fix min-combine. Same code,
// same data, same camera — the only difference is the mode, which is the variable the attribution
// named. Both legs replicated, and the stability gate still arbitrates.
const LEGS = [
  { id: 'fixed_midcarve_replace', flags: {} },
  { id: 'fix_disabled_min_combine', flags: { __RAW_DISABLE_MIDCARVE_REPLACE__: true } },
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

async function runLeg(browser, leg, rep) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  // guardrail off + the leg's lever, BEFORE the first frame — nothing is flipped mid-session
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
  await setWater(FORCED_WATER); await page.waitForTimeout(2500);
  const C2 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
  await setWaves(false); await page.waitForTimeout(6500);
  const B2 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
  await setWater(null); await page.waitForTimeout(2500);
  const B1 = await page.evaluate(sampleRays, { tgt: TARGET, dists: DISTS });
  const state = await page.evaluate(() => {
    const g = window.__RAW_GPU__ || {};
    return { overlayReason: g.overlayMask ? g.overlayMask.reason : null,
      overlayOn: g.overlayMask ? g.overlayMask.on : null };
  });
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
      log(`${leg.id.padEnd(19)} rep${rep} rays=${r.rays} ovl=${r.state.overlayReason} alpha: `
        + r.rows.map((x) => String(x.alpha === null ? '-' : x.alpha.toFixed(3)).padStart(7)).join('')
        + `  spread=${r.spread}`);
    }
  }
  log('');
  log('LEG                  rep1    rep2    |diff|   verdict');
  const summary = [];
  for (const leg of LEGS) {
    const rs = all.filter((r) => r.leg === leg.id);
    const s1 = rs[0] && rs[0].spread, s2 = rs[1] && rs[1].spread;
    const diff = (s1 !== null && s2 !== null && s1 !== undefined && s2 !== undefined)
      ? +Math.abs(s1 - s2).toFixed(3) : null;
    const stable = diff !== null && diff <= STABLE_EPS;
    summary.push({ leg: leg.id, s1, s2, diff, stable, mean: stable ? +((s1 + s2) / 2).toFixed(3) : null });
    log(`${leg.id.padEnd(19)} ${String(s1).padStart(6)}  ${String(s2).padStart(6)}  ${String(diff).padStart(6)}   `
      + (stable ? 'stable' : '⚠ UNSTABLE — attribution refused'));
  }
  const stock = summary.find((s) => s.leg === 'stock');
  if (stock && stock.stable) {
    log('');
    log(`stock spread = ${stock.mean}. A lever OWNS the ramp if it is stable AND much flatter:`);
    for (const s of summary.filter((x) => x.leg !== 'stock' && x.stable)) {
      log(`   ${s.leg.padEnd(19)} spread ${s.mean}  => ${((1 - s.mean / stock.mean) * 100).toFixed(0)}% flatter`);
    }
    const unstable = summary.filter((x) => !x.stable).map((x) => x.leg);
    if (unstable.length) log(`   (refused as unstable: ${unstable.join(', ')})`);
  } else {
    log('⚠ stock itself is unstable — no attribution possible from this run');
  }
  fs.writeFileSync(path.join(outdir, 'alpha-lever-isolated.json'),
    JSON.stringify({ base: BASE, target: TARGET, dists: DISTS, stableEps: STABLE_EPS, all, summary }, null, 1));
  log('written: ' + path.join(outdir, 'alpha-lever-isolated.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
