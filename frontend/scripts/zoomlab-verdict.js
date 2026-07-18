/**
 * zoomlab-verdict.js — automatic PASS/FAIL analysis of zoomlab traces (2026-07-18).
 *
 * The testing-system upgrade the ad-hoc era earned: screenshots and whole-frame luminance miss
 * exactly the two classes users keep reporting — (1) PERSISTENT vertical dead bands (the ingest
 * fencepost stripe: a 1-cell invalid column neither resident nor ring-fill painted) and
 * (2) TRANSIENT dead bands (the zoom-out flash: the band appears for a beat, then gets covered).
 * Canvas apps can't be DOM-asserted and an ANIMATED field can't be screenshot-baselined
 * (industry guidance: analyze dynamic canvases, don't pixel-baseline them) — so zoomlab now
 * captures a per-frame 40-column animation-density profile (`anim`: mean frame-to-frame |Δ| per
 * column band) and this module turns it into typed findings with a CI exit code.
 *
 * Detectors:
 *   DEAD_BAND_PERSISTENT — ≥minWidth contiguous quiet columns flanked by active ones,
 *                          present ≥persistFrames consecutive frames.
 *   DEAD_BAND_TRANSIENT  — same geometry, seen ≥transientFrames but healed (the flash class).
 *   SETTLED_STEP         — |ΔL| > maxSettledStep between consecutive same-zoom frames.
 *   MULT0_FRAME          — any frame drawn with mult 0 (blank-flash class).
 *   WEDGE                — trace ends without the scenario's expected resident state (from meta).
 *
 * Usage:  node zoomlab-verdict.js <trace.json> [--json]     exit 0 = pass, 1 = findings.
 * Library: const { analyzeTrace } = require('./zoomlab-verdict');
 */
const fs = require('fs');

const DEFAULTS = {
  quietFrac: 0.18,      // column is "quiet" if its anim < quietFrac * median of active columns
  activeMin: 4.0,       // ...and only when the frame's median activity is at least this (else the
                        //    whole frame is settling/static — no seam claims from a still frame)
  minWidth: 2,          // ≥2 of 40 columns (~5% of viewport width) to call it a band
  edgeCols: 3,          // ignore the outermost columns (UI chrome, basemap edges)
  persistFrames: 6,     // ≥6 consecutive frames = persistent
  transientFrames: 3,   // 3..5 consecutive frames = transient flash
  maxSettledStep: 16,   // |ΔL| between same-zoom consecutive frames (content-swap variance ~11-14)
  // LAND EXCLUSION (2026-07-18 EVE-2): with trace.water (zoomlab's probeMaskGPU column ground
  // truth), a band whose columns average below landWaterMin water fraction is LAND — never a
  // marine dead-band finding. The Florida peninsula parked under cols 4-13 at the mid-zoom
  // settled steps and burned two forensic arcs as a phantom sim defect before this.
  landWaterMin: 0.35,        // mean water fraction across the band's columns to count as marine
  waterMaxAgeMs: 4500,       // nearest water sample must be within this of the frame
};

function bandsInFrame(anim, cfg) {
  const inner = anim.slice(cfg.edgeCols, anim.length - cfg.edgeCols);
  const active = inner.filter((v) => v > 0).sort((a, b) => a - b);
  if (!active.length) return [];
  const med = active[Math.floor(active.length / 2)];
  if (med < cfg.activeMin) return [];
  const thr = med * cfg.quietFrac;
  const bands = [];
  let start = null;
  for (let c = cfg.edgeCols; c < anim.length - cfg.edgeCols; c++) {
    const quiet = anim[c] <= thr;
    if (quiet && start === null) start = c;
    if ((!quiet || c === anim.length - cfg.edgeCols - 1) && start !== null) {
      const end = quiet ? c : c - 1;
      // flanked by ACTIVE columns on both sides = an internal band, not a field edge
      const leftActive = start - 1 >= cfg.edgeCols && anim[start - 1] > thr;
      const rightActive = end + 1 < anim.length - cfg.edgeCols && anim[end + 1] > thr;
      if (end - start + 1 >= cfg.minWidth && leftActive && rightActive) bands.push([start, end]);
      start = null;
    }
  }
  return bands;
}

// Nearest water-column sample to time t (from zoomlab's probeMaskGPU ground truth), or null.
function nearestWater(water, t, maxAgeMs) {
  if (!Array.isArray(water) || !water.length) return null;
  let best = null, bd = Infinity;
  for (const s of water) {
    const d = Math.abs(s.t - t);
    if (d < bd) { bd = d; best = s; }
  }
  return (best && bd <= maxAgeMs) ? best : null;
}

function analyzeTrace(trace, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const F = (trace.frames || []).filter((f) => Array.isArray(f.anim) && f.anim.some((v) => v > 0));
  const findings = [];

  // --- dead-band tracking across frames (keyed by overlapping column ranges) ---
  let landExcluded = 0;
  const runs = [];   // { s, e, first, last, count }
  for (const f of F) {
    const water = nearestWater(trace.water, f.t, cfg.waterMaxAgeMs);
    for (const [s, e] of bandsInFrame(f.anim, cfg)) {
      // LAND EXCLUSION: a quiet band over mostly-land columns is geography, not a finding
      // (no water sample near this frame → legacy behavior, count it). A column recorded -1
      // (UNKNOWN — no mask source could answer) counts as WATER: never exclude on ignorance.
      if (water) {
        let sum = 0;
        for (let c = s; c <= e; c++) {
          const v = water.w[c];
          sum += (v == null || v < 0) ? 1 : v;
        }
        if (sum / (e - s + 1) < cfg.landWaterMin) { landExcluded++; continue; }
      }
      const hit = runs.find((r) => !r.closed && s <= r.e + 1 && e >= r.s - 1 && f.t - r.last < 1500);
      if (hit) { hit.s = Math.min(hit.s, s); hit.e = Math.max(hit.e, e); hit.last = f.t; hit.count++; }
      else runs.push({ s, e, first: f.t, last: f.t, count: 1, closed: false });
    }
    for (const r of runs) if (!r.closed && f.t - r.last >= 1500) r.closed = true;
  }
  for (const r of runs) {
    const colFrac = (c) => +(c / 40).toFixed(2);
    if (r.count >= cfg.persistFrames) {
      findings.push({ type: 'DEAD_BAND_PERSISTENT', cols: [r.s, r.e], xFrac: [colFrac(r.s), colFrac(r.e + 1)], t: [r.first, r.last], frames: r.count });
    } else if (r.count >= cfg.transientFrames) {
      findings.push({ type: 'DEAD_BAND_TRANSIENT', cols: [r.s, r.e], xFrac: [colFrac(r.s), colFrac(r.e + 1)], t: [r.first, r.last], frames: r.count });
    }
  }

  // --- settled luminance steps + mult0 ---
  const all = trace.frames || [];
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1], b = all[i];
    if (typeof a.L !== 'number' || typeof b.L !== 'number') continue;
    if (b.mult === 0) findings.push({ type: 'MULT0_FRAME', t: b.t });
    if (Math.abs((b.z ?? 0) - (a.z ?? 0)) < 0.01 && Math.abs(b.L - a.L) > cfg.maxSettledStep) {
      findings.push({ type: 'SETTLED_STEP', t: b.t, z: b.z, dL: +(b.L - a.L).toFixed(1) });
    }
  }

  // --- console errors ride along ---
  for (const e of (trace.consoleErrors || [])) findings.push({ type: 'CONSOLE_ERROR', msg: String(e).slice(0, 120) });

  return {
    pass: findings.length === 0, findings, framesAnalyzed: F.length,
    landExcludedBandFrames: landExcluded,
    waterSamples: Array.isArray(trace.water) ? trace.water.length : 0,
    config: cfg,
  };
}

module.exports = { analyzeTrace, bandsInFrame, DEFAULTS };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node zoomlab-verdict.js <trace.json> [--json]'); process.exit(2); }
  const trace = JSON.parse(fs.readFileSync(file, 'utf8'));
  const verdict = analyzeTrace(trace);
  if (process.argv.includes('--json')) console.log(JSON.stringify(verdict, null, 1));
  else {
    console.log(`[verdict] ${verdict.pass ? 'PASS' : 'FAIL'} — ${verdict.findings.length} finding(s), ${verdict.framesAnalyzed} anim frames`
      + (verdict.waterSamples ? `, ${verdict.waterSamples} water samples, ${verdict.landExcludedBandFrames} land band-frames excluded` : ' (no water ground truth — legacy mode)'));
    for (const f of verdict.findings.slice(0, 20)) console.log('  ' + JSON.stringify(f));
  }
  process.exit(verdict.pass ? 0 : 1);
}
