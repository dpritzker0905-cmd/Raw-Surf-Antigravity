/**
 * zoomlab-compare.js — trace-vs-trace comparison of zoomlab runs (2026-08-06).
 *
 * WHY THIS EXISTS, AND WHY THE VERDICT ALONE WAS NOT ENOUGH. zoomlab-verdict.js answers "did this
 * run pass", which is the right question for a gate and the wrong one for an investigation: the
 * nightly's verdict is BIMODAL. Measured over nine nightly runs — 0,0,0,11,0,2,6,7,10 findings —
 * 08-01 scored 11 and 08-02 scored 0 on the SAME code. Anchoring on the recent tail reads that as a
 * monotonic regression; it is not one. A binary verdict at n=1 per commit cannot separate a code
 * change from run-to-run conditions, and a bisect built on it will confidently name the wrong
 * commit.
 *
 * So this reports the CONTINUOUS measures, which carry far more signal than pass/fail and are what
 * actually separated a clean run from a failing one when the two traces were diffed:
 *
 *     mult0      frames drawn with opacity multiplier 0 — the user-visible blank itself
 *     settled    same-zoom luminance steps > 16 (the visible "pop")
 *     covF_min   worst resident-grid coverage of the viewport
 *     covF<0.9   how many frames the resident under-covered
 *     residents  distinct resident grids held during the run
 *
 * MEASURED SEPARATION (08-02 clean vs 08-06 failing), which is what this tool is calibrated on:
 *     clean : mult0=0   settled=0  covF_min=0.603  covF<0.9=27  residents=3
 *     fail  : mult0=8   settled=2  covF_min=0.416  covF<0.9=43  residents=9
 * `residents` is the churn correlate: more distinct grids means more transitions, and each
 * transition is a chance for the resident to stop covering the viewport mid-zoom-out.
 *
 * ⛔ IT REFUSES RATHER THAN REPORTING A CLEAN-LOOKING ZERO. A trace from an older zoomlab that never
 * recorded `mult`/`covF`/`resid` would otherwise report mult0=0 and read as a PERFECT run — the
 * worst possible failure for a comparison tool, because the absent field and the healthy value are
 * both "0". Any trace missing those fields is reported UNUSABLE and the exit code is 2.
 *
 * Usage:  node zoomlab-compare.js <traceA.json> <traceB.json> [...]
 * Exit:   0 = compared, 2 = at least one trace unusable (nothing is claimed about it).
 */
const fs = require('fs');
const path = require('path');

const REQUIRED_FRAME_FIELDS = ['mult', 'covF', 'resid', 'z', 'L', 't'];

function residentSpan(frame) {
  const r = frame.resid;
  if (typeof r !== 'string') return null;
  const p = r.split(',').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null;
  const [w, , e] = p;
  return Math.round(((e >= w) ? e - w : (e + 360) - w) * 10) / 10;
}

function measure(file) {
  let trace;
  try {
    trace = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { unusable: `unreadable (${e.message.slice(0, 60)})` };
  }
  const frames = trace.frames || [];
  if (!frames.length) return { unusable: 'no frames' };

  // The refusal that matters: a field this tool reads must be PRESENT on at least one frame.
  // Absent-and-zero are indistinguishable downstream, so never let absence read as health.
  const missing = REQUIRED_FRAME_FIELDS.filter((k) => !frames.some((f) => f[k] !== undefined));
  if (missing.length) return { unusable: `frames lack ${missing.join(',')} — older zoomlab format` };

  let mult0 = 0;
  const steps = [];
  const cov = [];
  const spans = new Set();
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.mult === 0) mult0++;
    if (typeof f.covF === 'number') cov.push(f.covF);
    const s = residentSpan(f);
    if (s !== null) spans.add(s);
    if (i === 0) continue;
    const a = frames[i - 1];
    if (typeof a.L !== 'number' || typeof f.L !== 'number') continue;
    if (Math.abs((f.z ?? 0) - (a.z ?? 0)) < 0.01 && Math.abs(f.L - a.L) > 16) {
      steps.push(Math.round((f.L - a.L) * 10) / 10);
    }
  }
  return {
    frames: frames.length,
    mult0,
    settled: steps.length,
    steps,
    covMin: cov.length ? Math.round(Math.min(...cov) * 1000) / 1000 : null,
    covLow: cov.filter((c) => c < 0.9).length,
    residents: spans.size,
    spans: [...spans].sort((a, b) => a - b),
  };
}

function main(argv) {
  const files = argv.slice(2);
  if (files.length < 1) {
    console.error('usage: node zoomlab-compare.js <traceA.json> [traceB.json ...]');
    return 2;
  }
  // ⚠️ LABEL BY parent/filename, NOT by parent alone. Artifacts unpack to
  // `zoomlab-nightly-<runid>/trace_staircase_full.json`, so the parent is the distinctive part
  // there — but two traces in ONE directory then render with the SAME label, and a comparison tool
  // whose rows cannot be told apart is worse than no tool. Caught by running it.
  const rows = files.map((f) => {
    const parent = path.basename(path.dirname(f));
    const base = path.basename(f);
    return [parent ? `${parent}/${base}` : base, f, measure(f)];
  });

  const head = `${'trace'.padEnd(30)}${'frames'.padStart(7)}${'mult0'.padStart(7)}` +
               `${'settled'.padStart(8)}${'covF_min'.padStart(10)}${'covF<0.9'.padStart(10)}${'residents'.padStart(11)}`;
  console.log(head);
  console.log('-'.repeat(head.length));
  let refused = 0;
  for (const [label, , m] of rows) {
    if (m.unusable) { console.log(`${label.slice(0, 29).padEnd(30)}  UNUSABLE — ${m.unusable}`); refused++; continue; }
    console.log(
      `${label.slice(0, 29).padEnd(30)}${String(m.frames).padStart(7)}${String(m.mult0).padStart(7)}` +
      `${String(m.settled).padStart(8)}${String(m.covMin).padStart(10)}${String(m.covLow).padStart(10)}` +
      `${String(m.residents).padStart(11)}`
    );
  }
  console.log('');
  for (const [label, , m] of rows) {
    if (m.unusable) continue;
    console.log(`  ${label.slice(0, 29).padEnd(30)} spans=[${m.spans.join(', ')}]  steps=[${m.steps.join(', ')}]`);
  }
  if (refused) {
    console.log('');
    console.log(`REFUSING: ${refused} trace(s) unusable — nothing is claimed about them.`);
    return 2;
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { measure, residentSpan };
