/**
 * ownRasterGapFill.js: what an own-only raster layer draws where the PICKED model's own frames have a gap (2026-11-22).
 *
 * The owner's ruling on #1071 (David, relayed by the director): where our own frames have gaps, do NOT leave blanks and do NOT
 * fall back to Open-Meteo. Fill with the clearly labelled prediction, so the user always sees a value and knows its source.
 *
 * A GAP is any forecast hour of the 14-day scrubber with no frame of the picked model's own set within the 3-hour pick window
 * (pickIndexFrame), for one of three reasons:
 *   1. RANGE: past the model's last frame (ICON 180 h, EURO 240 h);
 *   2. HOLE: an hour inside the range the index does not list (a dropped step);
 *   3. SET: no index at all (the set is not published yet, killed per set, or the read failed and is being retried).
 *
 * WHAT FILLS IT, in order:
 *   a. the SAME MODEL's coarser own set, where one exists (ICON air temperature: our ICON 0.5-degree set when the 0.125-degree
 *      set is missing whole): labelled "ICON's own 0.5° frames";
 *   b. the MODEL-ANCHORED PREDICTION (air temperature and cloud): NOAA GFS's field at the hour, plus the picked model's own offset
 *      from GFS at the model's last frame before the hour, decaying linearly to zero over ANCHOR_DECAY_HOURS (5 days):
 *          value = GFS(t) + w(t) * (MODEL(t0) - GFS(t0)),  w = 1 - (t - tL) / 120 h,
 *      tL = the model's last own frame <= t (the seam), t0 = its last own frame <= t at the SAME UTC hour of day (the 2 m
 *      temperature offset has a daily cycle over land; the advisor's hold on #1136). Five days past the seam it is GFS. The
 *      120 h linear ramp is a LABELLED BRIDGE AND A DESIGN CHOICE, justified only by analogy with the house rule for ICON's
 *      marine extension ("ICON@168 + GFS@168 anchor trend-extrapolation, persistence -> GFS weight shift over 5 days",
 *      BRAIN_RULES' 14-day contract); it is unscored. CORRECTED 2026-11-22 (the senior research lead's Q2 note, #1141): #1136
 *      called it "the decaying-average bias handover of NOAA's National Blend of Models". It is not: NBM's decaying average is a
 *      FILTER OVER PAST RUNS (a bias estimate updated run to run), not a ramp over lead time. That filter is what (b') runs.
 *      Cloud is clamped to 0-100 %. Labelled "<MODEL> prediction: NOAA GFS trend anchored to <MODEL>'s last frame";
 *   b'. DARK (the director, 2026-11-22; lever window.__RAW_RASTER_GAPFILL_OFFSET__ = true, default off): the offset split in two,
 *          value = GFS(t) + S(h) + w(t) * (MODEL(t0) - GFS(t0) - S(h)),
 *      S(h) = the ingest's running mean of MODEL - GFS at UTC hour h over past runs (backend services/frame_set_offset.py, a
 *      decaying-average filter as NAEFS / NBM and Cui et al. 2012 use for week-2 bias), which does NOT decay; only the
 *      residual R does (w as above until the pre-registered fit replaces it). Past the decay S alone stays on GFS. No skill is
 *      claimed until the score pre-registered in log 2026-11-22-claude-gapfill-offset-s-r.md passes against observations;
 *   c. a plain NOAA GFS stand-in where no anchor exists (a whole set missing, rain, or more than 5 days past the anchor):
 *      labelled with whose frames are missing and that GFS is shown. Rain is never offset (an added millimetre of rain where GFS
 *      has none is not a forecast); past ICON's 180 h it is the layer's GFS stand-in rule since 2026-11-12;
 *   d. only when GFS has nothing for the hour either: "unavailable" on the status line (never Open-Meteo).
 *
 * The later "Raw Surf prediction" (the research lead's pre-registration, 2026-11-19: skill-weighted ensemble means past each
 * model's horizon, built by the frame-carry lane) replaces (b) and (c) past the horizon when its sets publish: one more strategy.
 *
 * KILL: window.__RAW_DISABLE_RASTER_OWN_GAP_FILL__ = true. Gaps then say "unavailable" (the drafts' behaviour); never Open-Meteo.
 * Pure functions here; ownRasterFrames.js loads the fields and useOwnRasterFrames.js wires the indexes.
 */
import { pickIndexFrame } from './staticFrameCodec';

export const FILL_MODEL = 'GFS';
export const ANCHOR_DECAY_HOURS = 120;
export const PICK_WINDOW_MS = 3 * 3600000;   // pickIndexFrame's window: an hour within it of an own frame is not a gap
const MISSING = -9999;
const NO_DATA_BELOW = -9000;

const DAY_MS = 86400000;
/** Two instants at the same UTC hour of day (the anchor's phase rule). */
export const samePhase = (a, b) => (((a - b) % DAY_MS) + DAY_MS) % DAY_MS === 0;

export const gapFillOn = () => !(typeof window !== 'undefined' && window.__RAW_DISABLE_RASTER_OWN_GAP_FILL__ === true);

const lc = (m) => String(m || '').toLowerCase();
/** The status-line basis keys (drawnFrameReadout.ESTIMATE_WORDS words each). */
export const basisFor = {
  coarse: (m) => `${lc(m)}_coarser_set`,
  anchored: (m) => `${lc(m)}_anchored_gfs`,
  hole: (m) => `${lc(m)}_gfs_gap_fill`,
  range: () => 'gfs_estimated_fallback',
};

/**
 * The frames a scrub walks with the gap fill: the model's own entries (from its primary set, or its coarser set when `coarseKey`
 * is given), then one fill entry per GFS frame whose hour no own frame covers. Each entry: { ...frame, setKey, model, estimated,
 * coarse?, gap?, parts? } where `parts` (anchored entries) names the three frames the field is composed from.
 *   ownIndex, fillIndex: pinned indexes (either may be null); keys: { own, coarse, fill }; model: the picked model ('ICON').
 */
export function gapFillFrames({ ownIndex, fillIndex, keys, model, sourceModel, anchored, clamp = null, framesOf, offsetIndex = null }) {
  const coarse = !!keys.coarse && !!ownIndex && ownIndex.__coarse === true;
  const own = framesOf(ownIndex).map((f) => ({
    ...f, setKey: coarse ? keys.coarse : keys.own, model: sourceModel, estimated: coarse ? basisFor.coarse(model) : null, coarse,
  }));
  const fb = framesOf(fillIndex);
  if (!fb.length) return own;
  const ownMs = own.map((f) => Date.parse(f.valid_time));
  const lastOwn = ownMs.length ? ownMs[ownMs.length - 1] : -Infinity;
  const covered = (ms) => ownMs.some((o) => Math.abs(o - ms) <= PICK_WINDOW_MS);
  const fbAt = (ms) => fb.find((g) => Math.abs(Date.parse(g.valid_time) - ms) < 1000) || null;
  // b' (dark): the offset set's frame for a UTC hour of day; its valid_time carries the hour (frame_set_offset.py).
  const offs = anchored ? framesOf(offsetIndex) : [];
  const offsetAt = (ms) => offs.find((o) => new Date(Date.parse(o.valid_time)).getUTCHours() === new Date(ms).getUTCHours()) || null;
  const out = own.slice();
  for (const g of fb) {
    const ms = Date.parse(g.valid_time);
    // Past the model's last frame every GFS frame is listed (own frames still win within 3 h, gapFillFrameAt): the stand-in tail
    // as combinedFrames' BEYOND lists it. Inside the range only an hour no own frame covers is a gap.
    if (!Number.isFinite(ms) || (ms <= lastOwn && covered(ms))) continue;
    const plain = { ...g, setKey: keys.fill, model: FILL_MODEL, gap: true,
      estimated: ms > lastOwn && ownMs.length ? basisFor.range(model) : basisFor.hole(model) };
    let entry = plain;
    if (anchored) {
      // SAME PHASE (the advisor's hold on #1136, 2026-11-22): the 2 m temperature difference between two models has a strong daily
      // cycle over land, so a 15Z offset carried to 03Z can be off by several degrees. The anchor is the model's last own frame at
      // or before the hour at the SAME UTC hour of day, with a GFS frame at that time. The 120 h decay still runs from the
      // model's last own frame before the hour (the seam), so the weight is the drafts' and only the anchor's phase changed.
      let last = -1;
      let a = -1;
      let gA = null;
      for (let i = 0; i < own.length; i++) {
        if (ownMs[i] > ms) break;
        last = i;
        if (samePhase(ownMs[i], ms)) { const f = fbAt(ownMs[i]); if (f) { a = i; gA = f; } }
      }
      const w = last >= 0 ? 1 - (ms - ownMs[last]) / (ANCHOR_DECAY_HOURS * 3600000) : 0;
      const off = a >= 0 && gA ? offsetAt(ms) : null;
      if ((w > 0 || off) && a >= 0 && gA) {   // with S (b'), S stays on GFS after the residual has decayed
        const wR = Math.max(0, w);
        entry = {
          ...plain,
          path: `anchored:${g.path}|${gA.path}|${own[a].path}|${Math.round(wR * 1000) / 1000}${off ? `|S:${off.path}` : ''}`,
          model: `${sourceModel}+${FILL_MODEL}`,
          estimated: basisFor.anchored(model),
          parts: { now: { ...g, setKey: keys.fill }, fillAnchor: { ...gA, setKey: keys.fill }, modelAnchor: own[a], weight: wR, clamp,
            ...(off ? { offset: { ...off, setKey: keys.offset } } : {}) },
        };
      }
    }
    out.push(entry);
  }
  return out.sort((x, y) => Date.parse(x.valid_time) - Date.parse(y.valid_time));
}

/** The entry for an asked time in a gap-filled list: the model's own (nearest within 3 h) first, else the fill entry there. */
export function gapFillFrameAt(frames, validMs) {
  const own = pickIndexFrame({ frames: frames.filter((f) => !f.gap) }, validMs);
  if (own && own.path) return own;
  const g = pickIndexFrame({ frames: frames.filter((f) => f.gap) }, validMs);
  return g && g.path ? g : null;
}

const missing = (v) => !(v > NO_DATA_BELOW) || !Number.isFinite(v);

/** A source field's value near (lon, lat): the mean of its valid nodes within half a target cell (`half`, in source nodes). */
export function sampleBox(src, lon, lat, half) {
  const b = src.bounds;
  const dLon = src.cols > 1 ? (b.east - b.west) / (src.cols - 1) : 360;
  const dLat = src.rows > 1 ? (b.north - b.south) / (src.rows - 1) : 0;
  const wrap = Math.round(360 / dLon);
  const r0 = dLat > 0 ? Math.round((lat - b.south) / dLat) : 0;
  let c0 = Math.round((((lon - b.west) % 360) + 360) % 360 / dLon);
  if (c0 > src.cols - 1 && c0 - wrap >= 0) c0 -= wrap;
  let sum = 0; let n = 0;
  for (let dr = -half; dr <= half; dr++) {
    const r = r0 + dr;
    if (r < 0 || r >= src.rows) continue;
    for (let dc = -half; dc <= half; dc++) {
      let c = c0 + dc;
      if (c < 0) c += wrap; else if (c >= src.cols) c -= wrap;
      if (c < 0 || c >= src.cols) continue;
      const v = src.values[r * src.cols + c];
      if (!missing(v)) { sum += v; n += 1; }
    }
  }
  return n ? sum / n : NaN;
}

const sameGrid = (a, b) => a.cols === b.cols && a.rows === b.rows && a.bounds.west === b.bounds.west
  && a.bounds.south === b.bounds.south && a.bounds.east === b.bounds.east && a.bounds.north === b.bounds.north;

/**
 * The anchored prediction on `now`'s grid: now + weight * (modelAnchor - fillAnchor), node by node; `clamp` = [lo, hi] or null.
 * A node GFS has no value for stays MISSING; a node the anchors cannot offset keeps GFS's value. Returns a field like toField's.
 */
export function anchoredField(now, fillAnchor, modelAnchor, weight, clamp, offset = null) {
  const n = now.values.length;
  const out = new Float32Array(n);
  const b = now.bounds;
  const dLon = now.cols > 1 ? (b.east - b.west) / (now.cols - 1) : 0;
  const dLat = now.rows > 1 ? (b.north - b.south) / (now.rows - 1) : 0;
  const sameF = sameGrid(now, fillAnchor);
  const sameM = sameGrid(now, modelAnchor);
  const sameS = !!offset && sameGrid(now, offset);
  const halfOf = (src) => (src.cols > 1 && dLon > 0 ? Math.max(0, Math.floor(dLon / ((src.bounds.east - src.bounds.west) / (src.cols - 1)) / 2)) : 0);
  const hF = halfOf(fillAnchor); const hM = halfOf(modelAnchor);
  let min = Infinity; let max = -Infinity;
  for (let r = 0; r < now.rows; r++) {
    const lat = b.south + r * dLat;
    for (let c = 0; c < now.cols; c++) {
      const i = r * now.cols + c;
      const v = now.values[i];
      if (missing(v)) { out[i] = MISSING; continue; }
      const lon = b.west + c * dLon;
      const ga = sameF ? fillAnchor.values[i] : sampleBox(fillAnchor, lon, lat, hF);
      const ma = sameM ? modelAnchor.values[i] : sampleBox(modelAnchor, lon, lat, hM);
      const sv = offset ? (sameS ? offset.values[i] : sampleBox(offset, lon, lat, halfOf(offset))) : NaN;
      const S = missing(sv) ? 0 : sv;                     // b': no S at a node -> the plain anchored offset there
      let x = (missing(ga) || missing(ma)) ? v + S : v + S + weight * (ma - ga - S);
      if (clamp) x = Math.min(clamp[1], Math.max(clamp[0], x));
      out[i] = x;
      if (x < min) min = x; if (x > max) max = x;
    }
  }
  return { ...now, values: out, min, max };
}
