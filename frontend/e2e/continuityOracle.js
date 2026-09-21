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
 * @returns {{ms:number, label:string|null, from:number|null}} longest stall and the gesture label
 *          the stall STARTED under.
 */
function longestStall(samples) {
  const worst = { ms: 0, label: null, from: null };
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
    }
  }
  return worst;
}

module.exports = { longestStall };
