/**
 * zoomlab-diff.js — compare two zoomlab traces at matched zoom notches (2026-07-18, built for the
 * light-vs-dark crest question: is a theme difference palette-only, or does animation DENSITY/size
 * actually diverge?). Groups frames into zoom buckets, averages the inner anim-density columns,
 * luminance, spike fraction, and the resident regime (cols), then prints a per-bucket table and
 * flags buckets where animation density diverges beyond ratio thresholds WITH MATCHED REGIME
 * (a coarse-vs-regional resident difference is a data-supply difference, not a render bug —
 * those buckets are reported separately, never as verdicts).
 *
 * Usage: node zoomlab-diff.js <traceA.json> <traceB.json> [labelA] [labelB]
 * Exit 0 = no matched-regime divergence beyond threshold; 1 = divergence found.
 */
const fs = require('fs');

const EDGE_COLS = 4;          // ignore outermost columns (chrome/panel bleed) — verdict-engine parity
const BUCKET = 0.5;           // zoom bucket width
const ANIM_RATIO_MAX = 1.6;   // matched-regime mean-anim ratio beyond this = divergence
const MIN_FRAMES = 3;         // per bucket per trace, else skip (under-sampled)

function load(p) {
  const t = JSON.parse(fs.readFileSync(p, 'utf8'));
  return (t.frames || []).filter((f) => !f.err && Array.isArray(f.anim) && typeof f.z === 'number');
}

function innerMean(anim) {
  const inner = anim.slice(EDGE_COLS, anim.length - EDGE_COLS);
  return inner.reduce((a, b) => a + b, 0) / Math.max(1, inner.length);
}

function bucketize(frames) {
  const map = new Map();
  for (const f of frames) {
    const key = (Math.round(f.z / BUCKET) * BUCKET).toFixed(1);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  }
  return map;
}

function summarize(frames) {
  const n = frames.length;
  const mean = (sel) => frames.reduce((a, f) => a + (sel(f) || 0), 0) / n;
  // dominant resident cols = the regime signature for the bucket
  const colTally = {};
  for (const f of frames) { const c = f.cols || 0; colTally[c] = (colTally[c] || 0) + 1; }
  const domCols = +Object.entries(colTally).sort((a, b) => b[1] - a[1])[0][0];
  return {
    n,
    anim: +mean((f) => innerMean(f.anim)).toFixed(2),
    L: +mean((f) => f.L).toFixed(1),
    spk: +mean((f) => f.spk).toFixed(2),
    cols: domCols,
  };
}

function main() {
  const [pa, pb, la = 'A', lb = 'B'] = process.argv.slice(2);
  if (!pa || !pb) { console.error('usage: node zoomlab-diff.js <traceA.json> <traceB.json> [labelA] [labelB]'); process.exit(2); }
  const A = bucketize(load(pa));
  const B = bucketize(load(pb));
  const keys = [...new Set([...A.keys(), ...B.keys()])].sort((x, y) => +x - +y);
  const divergences = [];
  const regimeMismatches = [];
  console.log(`z      | ${la}: anim   L     spk   cols | ${lb}: anim   L     spk   cols | animRatio`);
  console.log('-'.repeat(96));
  for (const k of keys) {
    const fa = A.get(k) || [], fb = B.get(k) || [];
    if (fa.length < MIN_FRAMES || fb.length < MIN_FRAMES) continue;
    const sa = summarize(fa), sb = summarize(fb);
    const ratio = sb.anim > 0 ? +(sa.anim / sb.anim).toFixed(2) : (sa.anim > 0 ? Infinity : 1);
    const regimeMatch = sa.cols === sb.cols;
    const flag = !regimeMatch ? ' [REGIME DIFFERS — supply, not render]'
      : (ratio > ANIM_RATIO_MAX || ratio < 1 / ANIM_RATIO_MAX) ? ' <<< DIVERGENCE' : '';
    console.log(
      `z${k.padEnd(5)}| ${String(sa.anim).padEnd(7)}${String(sa.L).padEnd(6)}${String(sa.spk).padEnd(6)}${String(sa.cols).padEnd(5)}| ` +
      `${String(sb.anim).padEnd(7)}${String(sb.L).padEnd(6)}${String(sb.spk).padEnd(6)}${String(sb.cols).padEnd(5)}| ${ratio}${flag}`
    );
    if (!regimeMatch) regimeMismatches.push(k);
    else if (ratio > ANIM_RATIO_MAX || ratio < 1 / ANIM_RATIO_MAX) divergences.push({ z: k, ratio, [la]: sa, [lb]: sb });
  }
  if (regimeMismatches.length) {
    console.log(`\n[diff] ${regimeMismatches.length} bucket(s) had DIFFERENT resident regimes (z ${regimeMismatches.join(', ')}) — ` +
      'data supply differed between runs there; re-run or ignore those buckets for render conclusions.');
  }
  if (divergences.length) {
    console.log(`\n[diff] FAIL — ${divergences.length} matched-regime divergence(s):`);
    for (const d of divergences) console.log('  ', JSON.stringify(d));
    process.exit(1);
  }
  console.log('\n[diff] PASS — no matched-regime animation-density divergence beyond ' + ANIM_RATIO_MAX + 'x.');
  process.exit(0);
}

main();
