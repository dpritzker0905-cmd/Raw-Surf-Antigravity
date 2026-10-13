/**
 * alpha-lever-heightalpha.js — does the height-keyed smoothstep own the coastal alpha ramp?
 *
 * THE LEVER, AND WHY IT IS NOT `__RAW_DISABLE_BLEND_BOTH__`. That switch also gates the whole
 * regional/coarse composite: at Grand Bahama it made the profile identical to Waves-OFF, i.e. it
 * DELETED THE SUBJECT, and a lever that deletes the subject cannot test a property of it. But
 * `__RAW_BLEND_HEIGHT_LO__` / `__RAW_BLEND_HEIGHT_HI__` are read off `window` every frame
 * (WebGLMarineEngine.js:1665-1667) and feed `smoothstep(u_heightAlphaLo, u_heightAlphaHi,
 * displayHeight)` directly. Setting LO=-1, HI=0 makes t = clamp((h+1)/1) = 1 for every h >= 0, so
 * the term becomes EXACTLY 1 while the field keeps painting. Surgical, well-defined, and the
 * composite survives.
 *
 * PREDICTION IF THE TERM OWNS THE RAMP: alpha collapses to u_opacity * maskFade (~0.763 offshore),
 * d0 lifts hard, and spread -> ~0. If the ramp survives at ~0.5 the term is refuted.
 *
 * FOUR VALIDITY GATES, all of which have caught something real in this arc:
 *   1. LEVER REACHED THE SHADER. Not "is the window global set" — the uniforms u_heightAlphaLo/Hi
 *      are read back off the live GL program and must equal -1/0 in the treated leg. This is the
 *      strongest form of the "verify a lever took effect" rule: read the value the shader uses.
 *   2. TERM ENGAGED IN BOTH LEGS. u_heightAlphaEnabled must be 1 in stock AND treated. If blend
 *      disengages in either, the legs differ by more than the lever (the halo-damp void, again).
 *   3. SUBJECT NOT DELETED. Mean alpha must stay above a floor; a leg that stopped painting reads
 *      as "perfectly flat" and would look like a triumphant confirmation.
 *   4. NO COMPOUND MOVEMENT. maskEdgeSharp / overlayReplace must match across legs.
 * Plus the inherited discipline: one page load per leg, lever set before the first frame, every
 * leg replicated, stability gate refuses legs whose replicates disagree.
 */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) { ({ chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'))); }

const BASE = process.env.AI_BASE || 'https://dev--rawsurf.netlify.app';
const outdir = process.argv[2] || path.join(__dirname, 'alpha-lever-heightalpha-out');
fs.mkdirSync(outdir, { recursive: true });
const log = (m) => console.log('[heightalpha] ' + m);
const USER = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'A', username: 'a',
  role: 'admin', subscription_tier: 'premium', is_admin: true };

const TARGET = { id: 'madeira', center: [-16.92, 32.74], z: 9.30, rayDeg: 0.45 };
const FORCED_WATER = '#ff0000';
const MIN_SEP = 20;
const DISTS = [0, 1, 2, 4, 8, 16, 32, 64, 128];
const STABLE_EPS = 0.08;
const REPLICATES = 2;
const ALPHA_FLOOR = 0.05;   // below this the field is effectively not painting
const LEGS = [
  { id: 'stock', flags: {} },
  { id: 'heightalpha_identity', flags: { __RAW_BLEND_HEIGHT_LO__: -1.0, __RAW_BLEND_HEIGHT_HI__: 0.0 } },
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

// Read the uniforms the SHADER actually uses (gate 1) plus the engine/telemetry state.
const readState = () => new Promise((resolve) => {
  const m = window.map;
  const fn = () => {
    m.off('render', fn);
    const e = window.__MARINE_ENGINE__ || null;
    let gl = null;
    try { gl = m.painter && m.painter.context && m.painter.context.gl; } catch (err) {}
    if (!gl) { const c = m.getCanvas(); gl = c.getContext('webgl2') || c.getContext('webgl'); }
    const u = {};
    if (gl && e && e.heatmapProgram) {
      for (const name of ['u_opacity', 'u_maskEdgeSharp', 'u_heightAlphaEnabled', 'u_heightAlphaLo',
        'u_heightAlphaHi', 'u_edgeFeatherEnabled', 'u_overlayReplace', 'u_overlayMaskEnabled',
        'u_coastSDFEnabled', 'u_overlaySDFEnabled', 'u_surfMode', 'u_ribbonRadiusDeg']) {
        const loc = gl.getUniformLocation(e.heatmapProgram, name);
        u[name] = loc ? gl.getUniform(e.heatmapProgram, loc) : null;
      }
    }
    const g = window.__RAW_GPU__ || {};
    resolve({
      uniforms: u,
      glOk: !!(gl && e && e.heatmapProgram),
      maskEdgeSharpEngine: e ? e._maskEdgeSharp : null,
      winLo: window.__RAW_BLEND_HEIGHT_LO__ === undefined ? null : window.__RAW_BLEND_HEIGHT_LO__,
      winHi: window.__RAW_BLEND_HEIGHT_HI__ === undefined ? null : window.__RAW_BLEND_HEIGHT_HI__,
      blendEngaged: g.blendBoth ? g.blendBoth.engaged : null,
      overlayReason: g.overlayMask ? g.overlayMask.reason : null,
      overlayOn: g.overlayMask ? g.overlayMask.on : null,
      haloDamp: g.haloDamp === undefined ? null : g.haloDamp,
      washEff: g.washEff === undefined ? null : g.washEff,
      zoom: +m.getZoom().toFixed(2),
    });
  };
  m.on('render', fn); m.triggerRepaint();
});

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
  const live = rows.map((r) => r.alpha).filter((x) => x !== null);
  return { leg: leg.id, rep, rays: C1.usedRays, state, rows,
    meanAlpha: live.length ? +(live.reduce((s, x) => s + x, 0) / live.length).toFixed(3) : null,
    spread: (a0 !== null && aFar !== null) ? +(aFar - a0).toFixed(3) : null };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const all = [];
  for (const leg of LEGS) {
    for (let rep = 1; rep <= REPLICATES; rep++) {
      const r = await runLeg(browser, leg, rep);
      all.push(r);
      const u = r.state.uniforms || {};
      log(`${leg.id.padEnd(21)} rep${rep} rays=${r.rays} z=${r.state.zoom} hAlpha=${u.u_heightAlphaEnabled}`
        + ` lo/hi=${u.u_heightAlphaLo}/${u.u_heightAlphaHi} sharp=${u.u_maskEdgeSharp}`
        + ` repl=${u.u_overlayReplace} blend=${r.state.blendEngaged} ovl=${r.state.overlayReason}`);
      log(`${' '.repeat(21)}      alpha:`
        + r.rows.map((x) => String(x.alpha === null ? '-' : x.alpha.toFixed(3)).padStart(7)).join('')
        + `  spread=${r.spread} mean=${r.meanAlpha}`);
    }
  }
  log('');
  log('LEG                   rep1    rep2    |diff|   verdict');
  const summary = [];
  for (const leg of LEGS) {
    const rs = all.filter((r) => r.leg === leg.id);
    const s1 = rs[0] && rs[0].spread, s2 = rs[1] && rs[1].spread;
    const diff = (s1 !== null && s2 !== null && s1 !== undefined && s2 !== undefined)
      ? +Math.abs(s1 - s2).toFixed(3) : null;
    const stable = diff !== null && diff <= STABLE_EPS;
    summary.push({ leg: leg.id, s1, s2, diff, stable, mean: stable ? +((s1 + s2) / 2).toFixed(3) : null });
    log(`${leg.id.padEnd(21)} ${String(s1).padStart(6)}  ${String(s2).padStart(6)}  ${String(diff).padStart(6)}   `
      + (stable ? 'stable' : 'UNSTABLE - attribution refused'));
  }

  const stockLegs = all.filter((r) => r.leg === 'stock');
  const trLegs = all.filter((r) => r.leg === 'heightalpha_identity');
  const uni = (legs, k) => [...new Set(legs.map((r) => (r.state.uniforms || {})[k]))];
  const glOk = all.every((r) => r.state.glOk);
  const leverInShader = trLegs.every((r) => {
    const u = r.state.uniforms || {};
    return Number(u.u_heightAlphaLo) === -1 && Number(u.u_heightAlphaHi) === 0;
  });
  const engagedBoth = all.every((r) => Number((r.state.uniforms || {}).u_heightAlphaEnabled) === 1);
  const painting = all.every((r) => r.meanAlpha !== null && r.meanAlpha >= ALPHA_FLOOR);
  const sharpSame = JSON.stringify(uni(stockLegs, 'u_maskEdgeSharp')) === JSON.stringify(uni(trLegs, 'u_maskEdgeSharp'));
  const replSame = JSON.stringify(uni(stockLegs, 'u_overlayReplace')) === JSON.stringify(uni(trLegs, 'u_overlayReplace'));
  log('');
  log('VALIDITY');
  log(`  1 GL read live / lever REACHED THE SHADER : ${glOk} / ${leverInShader}`
    + `  (treated lo/hi = ${uni(trLegs, 'u_heightAlphaLo').join(',')}/${uni(trLegs, 'u_heightAlphaHi').join(',')};`
    + ` stock = ${uni(stockLegs, 'u_heightAlphaLo').join(',')}/${uni(stockLegs, 'u_heightAlphaHi').join(',')})`);
  log(`  2 term ENGAGED in every leg              : ${engagedBoth}  (u_heightAlphaEnabled = ${uni(all, 'u_heightAlphaEnabled').join(',')})`);
  log(`  3 subject NOT deleted (mean alpha>=${ALPHA_FLOOR})  : ${painting}  (means ${all.map((r) => r.meanAlpha).join(', ')})`);
  log(`  4 no compound movement (sharp/replace)   : ${sharpSame && replSame}`
    + `  (sharp ${JSON.stringify(uni(stockLegs, 'u_maskEdgeSharp'))}/${JSON.stringify(uni(trLegs, 'u_maskEdgeSharp'))},`
    + ` replace ${JSON.stringify(uni(stockLegs, 'u_overlayReplace'))}/${JSON.stringify(uni(trLegs, 'u_overlayReplace'))})`);

  const valid = glOk && leverInShader && engagedBoth && painting && sharpSame && replSame;
  const stock = summary.find((s) => s.leg === 'stock');
  const tr = summary.find((s) => s.leg === 'heightalpha_identity');
  log('');
  if (!valid) {
    log('=> ATTRIBUTION WITHHELD - a validity gate failed above. Not a negative result.');
  } else if (!stock.stable || !tr.stable) {
    log('=> ATTRIBUTION REFUSED - replicates disagree.');
  } else {
    const flatter = ((1 - tr.mean / stock.mean) * 100).toFixed(0);
    log(`stock spread = ${stock.mean}   identity spread = ${tr.mean}   => ${flatter}% flatter`);
    log(tr.mean <= 0.15
      ? '=> THE HEIGHT-KEYED SMOOTHSTEP OWNS THE RAMP (profile collapsed).'
      : (Number(flatter) >= 50
        ? '=> the term owns MOST of the ramp, but a residual survives - do not call it solved.'
        : '=> REFUTED as the owner: the ramp survives with the term forced to identity.'));
    log(`   (d0 stock ${stockLegs.map((r) => r.rows[0].alpha).join('/')} -> identity ${trLegs.map((r) => r.rows[0].alpha).join('/')})`);
  }
  fs.writeFileSync(path.join(outdir, 'alpha-lever-heightalpha.json'),
    JSON.stringify({ base: BASE, target: TARGET, dists: DISTS, stableEps: STABLE_EPS,
      validity: { glOk, leverInShader, engagedBoth, painting, sharpSame, replSame, valid }, all, summary }, null, 1));
  log('written: ' + path.join(outdir, 'alpha-lever-heightalpha.json'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
