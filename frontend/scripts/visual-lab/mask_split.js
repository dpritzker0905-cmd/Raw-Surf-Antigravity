// MASK SPLIT — where the land-mask build spends its time, per lab step (2026-10-20).
//
// Companion to stall_profile.js (PR #400): that tool says the land mask owns ~46% of zoom/pan stall time; this one splits
// the land-mask share into its stages so a fix can be aimed at the right one. Input: the V8 CPU profile lab.js writes
// with LAB_TRACE=1 (OUT/profile.json, LABSTEP_<n>_<label> markers) and the build directory (source maps WITH
// sourcesContent, the CRA default). Every sample inside a stall (an unbroken non-idle stretch >= STALL_MS, the same
// definition as stall_profile.js) whose stack holds a land-mask frame is billed to the INNERMOST land-mask frame's stage:
//
//   rasterize      WebGLMarineMaskRenderer.js renderMaskToCanvas (Natural Earth polygons -> canvas, incl. the LRU blit)
//   featureQuery   prepareBasemapWaterOverlay (MapLibre queryRenderedFeatures / querySourceFeatures)
//   overlay        overlayBasemapWaterOnMask + reassertNeLand (basemap water paint, wetlands, plausibility read-back)
//   inland         inlandWaterGuard.js (NE snapshot + chamfer + stamp)
//   shelter        marineMaskShelter.js (downsample, classifySheltered, close, stamp, cached verdict)
//   sdf / carry / stash   maskCoastSDF.js, maskSmoothing.js, maskTextureStash.js
//   upload         texImage2D / texSubImage2D leaf under a mask method of WebGLMarineEngine.js or the mask block of
//                  WebGLMarineTextureEncoder.js (native GL bills its time to its JS caller; see stall_profile.js)
//   glue           any other time inside those engine/encoder mask methods
// 2026-10-20 (sliced prototype): basemapWaterOverlay.js holds the painter now (prepareBasemapWaterOverlay /
// snapshotOverlayInputs = featureQuery, the rest = overlay), marineMaskRefresh.js the two refresh methods (glue / upload),
// and maskSliceScheduler.js is the slice driver (`slice`: its own glue, incl. the 1 px raster flushes it forces).
//
// marineMaskProjection.js is transparent (its time goes to the stage that called it). The enclosing top-level function of
// a frame is found from the ORIGINAL source text (sourcesContent), not from minified names.
//
//   node frontend/scripts/visual-lab/mask_split.js <lab OUT dir> <build dir> [STALL_MS=50]
const fs = require('fs');
const path = require('path');
const { SourceMapConsumer } = require('source-map');

const [outDir, buildDir, stallArg] = process.argv.slice(2);
const STALL_US = (+(stallArg || 50)) * 1000;
const UPLOAD = /^(texImage2D|texSubImage2D|texStorage2D)$/;
const ENGINE_MASK_FNS = /^(refreshMaskWithBasemapWater|refreshViewportOverlayMask)$/;

// Top-level declarations of an original source file: [{ line, name }] sorted by line.
function declarationsOf(text) {
  const out = [];
  text.split('\n').forEach((ln, i) => {
    const m = ln.match(/^(?:export\s+)?(?:async\s+)?function\*?\s+(\w+)/) || ln.match(/^(?:export\s+)?(?:const|let)\s+(\w+)\s*=/)
      || ln.match(/^\w+\.prototype\.(\w+)\s*=\s*function/);
    if (m) out.push({ line: i + 1, name: m[1] });
  });
  return out;
}
function enclosing(decls, line) { let cur = null; for (const d of decls) { if (d.line <= line) cur = d.name; else break; } return cur; }

function stageOf(file, fn, leafName) {
  switch (file) {
    case 'marineMaskShelter.js': return 'shelter';
    case 'inlandWaterGuard.js': return 'inland';
    case 'maskCoastSDF.js': return 'sdf';
    case 'maskSmoothing.js': return 'carry';
    case 'maskTextureStash.js': return 'stash';
    case 'WebGLMarineMaskRenderer.js':
      if (fn === 'renderMaskToCanvas') return 'rasterize';
      if (fn === 'prepareBasemapWaterOverlay') return 'featureQuery';
      if (fn === 'overlayBasemapWaterOnMask' || fn === 'reassertNeLand') return 'overlay';
      return 'overlay';
    case 'basemapWaterOverlay.js':
      return (fn === 'prepareBasemapWaterOverlay' || fn === 'snapshotOverlayInputs') ? 'featureQuery' : 'overlay';
    case 'marineMaskRefresh.js': return UPLOAD.test(leafName) ? 'upload' : 'glue';
    case 'maskSliceScheduler.js': return 'slice';
    case 'WebGLMarineEngine.js':
      if (ENGINE_MASK_FNS.test(fn || '')) return UPLOAD.test(leafName) ? 'upload' : 'glue';
      return null;
    default: return null;
  }
}

(async () => {
  const pr = JSON.parse(fs.readFileSync(path.join(outDir, 'profile.json'), 'utf8'));
  const nodes = new Map(); for (const n of pr.nodes) nodes.set(n.id, n);
  const parentOf = new Map(); for (const n of pr.nodes) for (const c of n.children || []) parentOf.set(c, n.id);
  const times = []; let t = pr.startTime; for (const d of pr.timeDeltas) { t += d; times.push(t); }
  const interval = (times[times.length - 1] - times[0]) / Math.max(1, times.length - 1);
  const w = times.map((x, i) => Math.min((times[i + 1] ?? x + interval) - x, 4 * interval));
  const stackOf = (id) => { const out = []; let cur = id; while (cur != null && nodes.has(cur)) { out.push(nodes.get(cur)); cur = parentOf.get(cur); } return out; };

  const consumers = new Map();
  const urls = new Set(); for (const n of pr.nodes) if (n.callFrame.url && /\/static\/js\//.test(n.callFrame.url)) urls.add(n.callFrame.url);
  for (const u of urls) {
    const file = path.join(buildDir, 'static', 'js', path.basename(new URL(u).pathname));
    if (fs.existsSync(file + '.map') && !consumers.has(file)) consumers.set(file, await new SourceMapConsumer(JSON.parse(fs.readFileSync(file + '.map', 'utf8'))));
  }
  const declCache = new Map();
  const frameCache = new Map();
  // -> { file, fn, line } for an app frame, or null.
  const frameOf = (cf) => {
    const k = `${cf.url}:${cf.lineNumber}:${cf.columnNumber}`;
    if (frameCache.has(k)) return frameCache.get(k);
    let r = null;
    if (cf.url && /\/static\/js\//.test(cf.url)) {
      const c = consumers.get(path.join(buildDir, 'static', 'js', path.basename(new URL(cf.url).pathname)));
      const pos = c && c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
      if (pos && pos.source && !/node_modules/.test(pos.source)) {
        const file = path.basename(pos.source);
        if (!declCache.has(pos.source)) { const txt = c.sourceContentFor(pos.source, true); declCache.set(pos.source, txt ? declarationsOf(txt) : []); }
        r = { file, fn: enclosing(declCache.get(pos.source), pos.line), line: pos.line };
      }
    }
    frameCache.set(k, r); return r;
  };
  // The encoder's mask block: lines between the LAST-MILE mask-source comment and the patch-carry/forensic upload log.
  const encoderMaskBlock = (() => {
    for (const c of consumers.values()) for (const s of c.sources) if (/WebGLMarineTextureEncoder\.js$/.test(s)) {
      const lines = (c.sourceContentFor(s, true) || '').split('\n');
      const a = lines.findIndex((l) => /if \(standalone\) \{/.test(l));
      const b = lines.findIndex((l) => /High-resolution land mask texture created/.test(l));
      if (a >= 0 && b > a) return [a + 1, b + 1];
    }
    return null;
  })();

  let lastFrame = null;   // the frame classify() billed, for the hot-line table
  const classify = (stack) => {
    const leafName = stack[0].callFrame.functionName;
    for (const node of stack) {
      const f = frameOf(node.callFrame);
      if (!f) continue;
      if (f.file === 'marineMaskProjection.js') continue;
      if (f.file === 'WebGLMarineTextureEncoder.js' && encoderMaskBlock && f.line >= encoderMaskBlock[0] && f.line <= encoderMaskBlock[1]) {
        lastFrame = f; return UPLOAD.test(leafName) ? 'upload' : 'glue';
      }
      const st = stageOf(f.file, f.fn, leafName);
      if (st) { lastFrame = f; return st; }
    }
    return null;
  };

  // Steps and stalls (same definitions as stall_profile.js).
  const steps = [];
  const busy = (i) => (nodes.get(pr.samples[i]) || { callFrame: {} }).callFrame.functionName !== '(idle)';
  for (let i = 0; i < pr.samples.length; i++) {
    const m = stackOf(pr.samples[i]).map((n) => n.callFrame.functionName).find((f) => /^LABSTEP_/.test(f));
    if (m && !steps.find((s) => s.name === m)) steps.push({ name: m, t: times[i] });
  }
  const stepAt = (x) => { let cur = 'before first step (load + setup)'; for (const s of steps) if (s.t <= x) cur = s.name.replace(/^LABSTEP_/, ''); return cur; };
  const stalls = []; { let start = null, last = null, i0 = 0;
    for (let i = 0; i <= times.length; i++) {
      const b = i < times.length && busy(i);
      if (b && start == null) { start = times[i]; i0 = i; }
      if (b) last = times[i];
      if (!b && start != null) { if (last - start + interval >= STALL_US) stalls.push({ ts: start, dur: last - start + interval, i0, i1: i }); start = null; }
    } }
  const perStep = new Map();
  const total = new Map();
  const leaves = new Map();   // '<stage> @ <file>:<line>' -> us
  for (const s of stalls) {
    const step = stepAt(s.ts);
    const e = perStep.get(step) || { stalls: 0, stallMs: 0, maxStallMs: 0, maskUs: 0, stages: new Map(), worstMaskStallMs: 0 };
    e.stalls++; e.stallMs += s.dur / 1000; e.maxStallMs = Math.max(e.maxStallMs, s.dur / 1000);
    let maskInStall = 0;
    for (let i = s.i0; i < s.i1; i++) {
      const stack = stackOf(pr.samples[i]);
      const st = classify(stack);
      if (!st) continue;
      { const k = `${st} @ ${lastFrame.file}:${lastFrame.line}`; leaves.set(k, (leaves.get(k) || 0) + w[i]); }
      e.maskUs += w[i]; maskInStall += w[i];
      e.stages.set(st, (e.stages.get(st) || 0) + w[i]); total.set(st, (total.get(st) || 0) + w[i]);
    }
    e.worstMaskStallMs = Math.max(e.worstMaskStallMs, maskInStall / 1000);
    perStep.set(step, e);
  }
  const ms = (us) => Math.round(us / 1000);
  const codeAt = (k) => { const m = k.match(/@ (.+):(\d+)$/); if (!m) return ''; for (const c of consumers.values()) for (const src of c.sources) if (path.basename(src) === m[1]) { const t = c.sourceContentFor(src, true); if (t) return (t.split('\n')[+m[2] - 1] || '').trim().slice(0, 120); } return ''; };
  const sortStages = (m) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, ms(v)]));
  const report = {
    profile: path.join(outDir, 'profile.json'), stallThresholdMs: STALL_US / 1000, samplingIntervalUs: Math.round(interval),
    encoderMaskBlockLines: encoderMaskBlock,
    stallMsTotal: Math.round(stalls.reduce((a, s) => a + s.dur, 0) / 1000),
    maskMsInStalls: ms([...total.values()].reduce((a, b) => a + b, 0)),
    maskStagesInStalls: sortStages(total),
    maskHotLinesInStalls: [...leaves.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => ({ at: k, ms: ms(v), code: codeAt(k) })),
    byStep: Object.fromEntries([...perStep.entries()].map(([k, e]) => [k, { stalls: e.stalls, stallMs: Math.round(e.stallMs), maxStallMs: Math.round(e.maxStallMs),
      maskMs: ms(e.maskUs), worstMaskInOneStallMs: Math.round(e.worstMaskStallMs), stages: sortStages(e.stages) }])),
  };
  console.log(JSON.stringify(report, null, 1));
  for (const c of consumers.values()) c.destroy && c.destroy();
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
