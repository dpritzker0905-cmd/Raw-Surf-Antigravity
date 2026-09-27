/**
 * continuityOracle — turn a series of draw-counter samples into "the longest gap, and what caused it".
 *
 * Extracted from marine-render-continuity.spec.js so it can be unit-tested. ⭐⭐ AN ORACLE MUST BE
 * VERIFIED AGAINST A KNOWN ANSWER BEFORE IT IS POINTED AT AN UNKNOWN ONE: this one decides whether
 * a months-old defect class is present or absent, and if it reported gaps for a healthy series it
 * would send the next session chasing a phantom — or, worse, if it reported none for a broken one
 * it would certify the exact bug it was built to catch.
 *
 * THE SIGNAL. `WebGLMarineEngine` stamps `window.__RAW_GPU__.opacity` with `n`, a draw counter, on
 * every heatmap draw. Three states, and the distinction is the entire point:
 *
 *   n advancing, heatmap > 0   -> painting             (healthy)
 *   n advancing, heatmap == 0  -> drawing, but hidden  (a deliberate hold, e.g. the coarse bridge)
 *   n NOT advancing            -> not drawing at all   (the gap the owner sees)
 *
 * ⚠️ `n === null` means the engine has never drawn. That is NOT a gap — it is a precondition
 * failure, and the caller checks for it separately. Folding the two together would let "the marine
 * engine never started" masquerade as "a 30-second animation gap", which points at the wrong
 * subsystem entirely.
 */

/**
 * THE DEFINITION, because an off-by-one-poll here is an under-report of the defect itself.
 *
 * A stall is measured from the FIRST sample carrying a counter value to the LAST consecutive
 * sample still carrying it. That interval is a PROVEN no-draw window: two observations bracket it
 * and the counter did not move between them.
 *
 * ⚠️ The first draft anchored on the first REPEATED sample instead, which lost one poll interval
 * on every stall and reported 0 for a genuine single-interval gap. Its unit tests caught it — the
 * three failures were each off by exactly 100 ms, the poll period. ⭐ UNDER-REPORTING IS THE
 * DANGEROUS DIRECTION for a gate: it certifies the bug it was built to catch.
 *
 * The true gap may be up to one poll longer at each end (the counter could have stopped just after
 * the anchor and resumed just before the next advance). Reporting the proven interval rather than
 * the possible one keeps this a LOWER bound — a failure here is never an artefact of the sampler.
 *
 * @param {Array<{at:number, n:number|null, label:string|null}>} samples
 * @returns {{ms:number, label:string|null, from:number|null, start:number|null, end:number|null}}
 *          longest stall, the gesture label it STARTED under, and its bracketing sample times.
 */
function longestStall(samples) {
  const worst = { ms: 0, label: null, from: null, start: null, end: null };
  let anchor = null;          // first sample carrying the current counter value
  for (const s of samples) {
    // A null counter is "never drew", not "stopped drawing" — it breaks the run rather than
    // extending it, so a cold start cannot be reported as a gap.
    if (s.n === null || s.n === undefined) {
      anchor = null;
      continue;
    }
    if (anchor === null || s.n !== anchor.n) {
      anchor = s;
      continue;
    }
    const ms = s.at - anchor.at;
    if (ms > worst.ms) {
      worst.ms = ms;
      worst.label = anchor.label;
      worst.from = anchor.n;
      worst.start = anchor.at;
      worst.end = s.at;
    }
  }
  return worst;
}

/**
 * WHAT HAPPENED INSIDE THE WORST STALL (2026-09-26). The draw counter says THAT drawing stopped; the
 * layer stamp (`__RAW_GPU__.layer`, src/components/map/marineLayerStamp.js) says why:
 *
 *   layerCalls      how many times MapLibre called the layer during the stall. 0 means nothing was
 *                   driving frames at all (the animation clock stopped); > 0 means it was called and
 *                   took an exit instead of drawing.
 *   skips           {reason: samples} — the exit each sample saw (`null` = asked the engine to draw)
 *   maxSampleGapMs  the largest spacing between samples. The sampler is a 100 ms setInterval on the
 *                   page, so a hole far above that means the MAIN THREAD was blocked (a long task),
 *                   not that the renderer skipped.
 *
 * Returns null when there was no stall. Samples recorded before the stamp existed read as
 * `layerCalls: null` rather than 0, so an old series can never be misread as "not called".
 */
function stallAnatomy(samples, worst) {
  if (!worst || worst.start === null || worst.end === null) return null;
  const inside = samples.filter((s) => s.at >= worst.start && s.at <= worst.end);
  if (inside.length < 2) return null;
  const first = inside[0].layerN;
  const last = inside[inside.length - 1].layerN;
  const layerCalls = (typeof first === 'number' && typeof last === 'number') ? last - first : null;
  const skips = {};
  for (const s of inside) {
    if (s.layerN === undefined || s.layerN === null) continue;
    const key = s.skip === null || s.skip === undefined ? 'drew' : s.skip;
    skips[key] = (skips[key] || 0) + 1;
  }
  let maxSampleGapMs = 0;
  for (let i = 1; i < inside.length; i++) {
    maxSampleGapMs = Math.max(maxSampleGapMs, inside[i].at - inside[i - 1].at);
  }
  return { layerCalls, skips, maxSampleGapMs };
}

module.exports = { longestStall, stallAnatomy };
