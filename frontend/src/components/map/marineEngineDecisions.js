/**
 * marineEngineDecisions.js — the marine engine's PURE decision layer.
 *
 * Extracted verbatim from WebGLMarineEngine.js (2026-07-29). That file was 3,845 lines against the
 * repo's 800-line governance limit — the worst in the codebase — and this is the half of it that
 * is provably safe to move: every function here is pure, already exported, and already carries its
 * own test file (.ratingBandFade, .deadEdgeTrim, .tileBackoff, .noDowngrade, .nullEncodeGuard,
 * .opacityEase, .coldVeil, .tileClamp, .coarseCrest, .ribbonTaper, .heatmapOpacity — eleven of the
 * engine's suites target this block alone, which is why its FUNCTION coverage is 58.82% against
 * 25.13% of statements).
 *
 * ★ WHAT THIS BLOCK IS. Not helpers — POLICY. Every incident in the marine regression graveyard
 * ended in one of these predicates: whether to reject a resolution downgrade, whether to keep a
 * resident grid on a null encode, when a coarse field is too magnified to draw, how far the
 * rating band fades on zoom-out. They are pure and injectable (a 'win' argument) precisely so a
 * live defect can be reproduced in a unit test instead of on a map.
 *
 * ⚠️ `_ratingGraceState` is module-level MUTABLE state shared by
 * `shouldRejectResolutionDowngrade` and `__resetRatingGraceForTests`. Both live here; splitting
 * them apart would give each its own object and silently break the grace window.
 *
 * WebGLMarineEngine re-exports every name below, so no importer and no test changed.
 */
import { recordMarineEvent } from './marineForensics';
import { MARINE_ZOOMED_OUT_MAX_ZOOM } from './marineZoomThresholds';

export function latToMercatorY(lat) {
  const latClamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const rad = (latClamped * Math.PI) / 180.0;
  return (1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0;
}

// Zoom-based base heatmap opacity ladder (shared by the main heatmap pass and the BLEND-BOTH coarse base wash).
// HEATMAP BASE OPACITY vs ZOOM. Multiplied by coarseFade / no-truth / rating-band / mult downstream.
// FLATTENED + C0-CONTINUOUS (2026-07-17, per-zoom color-consistency audit): sampling one fixed ocean
// point at every zoom showed its on-screen luminance swing 155→198 (red channel 77→161) — driven
// mostly by THIS ramp (old range 0.55→0.85) plus a hard 0.05 DISCONTINUITY at z12 (0.80→0.85, the
// documented "z12.05 flutter"). The height→color hue is zoom-invariant, so that swing is pure
// opacity presentation. Tighten the range to [0.65, 0.80] (swing 0.30→0.15) and remove the step, so
// the same wave height reads as a far more consistent color across zoom. Raising the WIDE-zoom floor
// (0.55→0.65) moves AWAY from the documented regression class (blank/disappearing heatmap = too-LOW
// opacity), and the data-driven guards that dim low-confidence coarse/cold fields — coarseFade (0.7
// floor) and the no-truth window (0.3 floor) — are untouched and still apply on top. `win` is
// injectable for tests. Kill switch → legacy curve: __RAW_DISABLE_FLAT_HEATMAP_OPACITY__.
export function heatmapZoomOpacity(z, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_DISABLE_FLAT_HEATMAP_OPACITY__ === true) {
    // Legacy curve (pre-2026-07-17): range [0.55, 0.85] with the z12 hard step. Kept for A/B revert.
    if (z <= 2) return 0.55;
    if (z <= 5) return 0.55 + (z - 2) / 3 * 0.10;
    if (z <= 8) return 0.65 + (z - 5) / 3 * 0.10;
    if (z <= 12) return 0.75 + (z - 8) / 4 * 0.05;
    return 0.85;
  }
  if (z <= 3) return 0.65;
  if (z <= 8) return 0.65 + (z - 3) / 5 * 0.10;    // 0.65 → 0.75
  if (z <= 13) return 0.75 + (z - 8) / 5 * 0.05;   // 0.75 → 0.80 (continuous at z13; no step)
  return 0.80;
}

// === RATING-BAND ZOOM-OUT CROSS-FADE (pure; exported for tests) ===
// USER SPEC (2026-07-12 zoom-out half of the coastal-ribbon spec): the rating ribbon hugs the shore
// at close zoom; at mid zoom the NORMAL heatmap blends in beyond it; zoomed way out the normal
// heatmap DOMINATES — "not a hard on/off". Mechanically the band's last rated tier is the clipped
// global_mid, which the resolver stops serving once the padded request span exceeds
// MARINE_MID_RES_MAX_SPAN (15°); the next commit is the unrated 10° global (surf transform skipped:
// coarse_extent) and ratingMode drops. Before this fade that tier handoff was a hard swap: the band
// painted at full strength right up to the boundary, then the whole field flipped (the "rating
// heatmap CLEARS on zoom-out" report, 2026-07-12 round 3). NOTE the backend alternative — rating the
// global frame too — was probed and falsified: on the real 37×17 lattice only 70/524 water cells
// rate while 429 open-ocean cells get MASKED, and the blend wash never engages when the ACTIVE grid
// is global (isRegionalBounds gate), so world zoom would read as a blank ocean with scattered 10°
// rating blocks; it would also poison the coarse-base wash capture with score-valued textures.
// The fade trades places smoothly instead, across a VIEWPORT-SPAN window (span, not zoom — the
// span↔zoom mapping shifts with map pixel width, while the tier boundary is span-keyed): the band's
// heatmap alpha ramps to 0 while the under-band honest wash (blend-both) lifts from its dimmed
// default to full strength — by the time the unrated global replaces the held rated resident, the
// screen is already showing the honest field at ≈committed strength and the swap is invisible.
// bandMult floors at 0.3 when NO wash is engaged under the band (a fully-faded band over a washless
// viewport reads as the blank-map bug — same lesson as the coarse-fade 0.7 / no-truth 0.3 floors).
// COVERAGE LEG (2026-07-16 §2c, zoomlab real-wheel traces): the span window alone cannot anticipate
// the rated→unrated handoff, because the release is the CONJUNCTION `z ≤ MARINE_ZOOMED_OUT_MAX_ZOOM
// && coverage < __RAW_DOWNGRADE_COVER_FRAC__` (display gate / zoom-out bridge / subcover reject all
// share it) — on a zoom-out with a small rated tile it goes true around span ~5-6°, where the span
// fade has barely started, so the world bridge swapped in under a FULL-strength band (+11-16 L hard
// flip, trace frames 14-17). The coverage leg fades the band as the resident's viewport coverage
// falls toward the SAME release lever, engaged only as z nears the SAME zoom boundary (smoothstep
// over the __RAW_BAND_COVER_FADE_ZLEAD__ window above it, default 0.5) — derived from the release's
// own constants so fade and release can never disagree. Close-zoom pans (z > boundary+lead) are
// untouched: their coverage drops lead to rated→rated handoffs under the grace, where dimming would
// re-open the §4f band-blink. Both legs combine via min() (the dacdabac combine idiom); the wash
// lift keys on the COMBINED fade so the trade-places invariant holds whichever leg drives.
// Unknown coverage/zoom FAILS OPEN (leg inert — the 07-03 unknown-input lesson).
// Levers: __RAW_RATING_SPAN_FADE_LO__ (default 6°, fade starts) / __RAW_RATING_SPAN_FADE_HI__
// (default 9.5° ≈ the 15° request-span boundary before the frontend fetch pad) /
// __RAW_BAND_COVER_FADE_ZLEAD__ (zoom lead above the wide-view boundary). Kills:
// __RAW_RATING_ZOOM_FADE_DISABLED__ (whole fade → hard on/off) / __RAW_DISABLE_BAND_COVER_FADE__
// (coverage leg only). Telemetry: __RAW_GPU__.ratingBandFade.
export function resolveRatingBandFade(viewportLonSpan, isRatingPainting, washEngaged, win, cov) {
  const ident = { bandMult: 1.0, washStrength: null, fade: 1.0, spanFade: 1.0, covFade: 1.0 };
  if (!isRatingPainting) return ident;
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_RATING_ZOOM_FADE_DISABLED__ === true) return ident;
  if (typeof viewportLonSpan !== 'number' || !(viewportLonSpan > 0)) return ident;
  const lo = (typeof w.__RAW_RATING_SPAN_FADE_LO__ === 'number') ? w.__RAW_RATING_SPAN_FADE_LO__ : 6.0;
  const hi = (typeof w.__RAW_RATING_SPAN_FADE_HI__ === 'number') ? w.__RAW_RATING_SPAN_FADE_HI__ : 9.5;
  const t = Math.max(0.0, Math.min(1.0, (viewportLonSpan - lo) / Math.max(1e-6, hi - lo)));
  const spanFade = 1.0 - t * t * (3.0 - 2.0 * t);  // smoothstep: 1 at lo (band full) → 0 at hi (band gone)
  let covFade = 1.0;
  if (w.__RAW_DISABLE_BAND_COVER_FADE__ !== true
      && cov && typeof cov.coverFrac === 'number' && typeof cov.zoom === 'number') {
    const zLead = (typeof w.__RAW_BAND_COVER_FADE_ZLEAD__ === 'number') ? w.__RAW_BAND_COVER_FADE_ZLEAD__ : 0.5;
    const zT = Math.max(0.0, Math.min(1.0,
      ((MARINE_ZOOMED_OUT_MAX_ZOOM + zLead) - cov.zoom) / Math.max(1e-6, zLead)));
    const zProx = zT * zT * (3.0 - 2.0 * zT);      // 0 above the lead window → 1 at the release boundary
    const minFrac = Number(w.__RAW_DOWNGRADE_COVER_FRAC__) || 0.6;
    const cLo = minFrac + 0.02;                    // just above the release: band gone before the swap
    const cHi = Math.min(1.0, minFrac + 0.25);     // fade begins as coverage leaves "comfortably covering"
    const cT = Math.max(0.0, Math.min(1.0, (cov.coverFrac - cLo) / Math.max(1e-6, cHi - cLo)));
    const cRamp = cT * cT * (3.0 - 2.0 * cT);      // 1 while covering → 0 at the release lever
    covFade = 1.0 - zProx * (1.0 - cRamp);
  }
  const fade = Math.min(spanFade, covFade);
  const bandMult = washEngaged ? fade : Math.max(0.3, fade);
  const base = (typeof w.__RAW_BLEND_BASE_WASH__ === 'number') ? w.__RAW_BLEND_BASE_WASH__ : 0.72;
  const washStrength = base + (1.0 - base) * (1.0 - fade);   // dimmed under a full band → full when the band is gone
  return { bandMult, washStrength, fade, spanFade, covFade };
}

// === COASTAL-RIBBON taper resolution (pure; exported for tests) ===
// USER SPEC (2026-07-12, revised same day from "a couple miles"): the rating band extends
// ~10 MILES out into the water and tapers into the honest heatmap. is_coastal classifies whole
// CELLS within ±0.75° (~50 mi), so the narrowing is per-pixel in the fragment shader
// (landInRing ring-samples of the ocean mask); this resolver just supplies the radius + floor.
//  * radius: __RAW_RATING_RIBBON_MI__ (default 10) converted at ~69 statute miles per ° latitude.
//  * MASK-RESOLUTION FLOOR: on the coarse world mask (texel ≈ 24 mi) a 10-mi ribbon is
//    sub-texel and would erase the band before a crisp mask lands — widen to ~1.6 texels and
//    let it tighten the moment a denser mask commits (coarse-but-present beats missing, the
//    standing ribbon-spec rule).
//  * floor: beyond the ribbon the band goes fully transparent when the honest wash draws
//    underneath (the trade-places spec); a dim 0.3 ghost when no wash is engaged (blank-map
//    floor lesson, same family as the zoom cross-fade and coarse-fade floors).
// Kill: __RAW_RATING_RIBBON_DISABLED__ (radiusDeg 0 → the shader skips all ribbon sampling).
export function resolveRibbonTaper(win, maskTexelDeg, washUnder) {
  const w = win || {};
  if (w.__RAW_RATING_RIBBON_DISABLED__ === true) return { radiusDeg: 0.0, floor: 1.0 };
  const mi = (typeof w.__RAW_RATING_RIBBON_MI__ === 'number') ? w.__RAW_RATING_RIBBON_MI__ : 10.0;
  if (!(mi > 0)) return { radiusDeg: 0.0, floor: 1.0 };
  let radiusDeg = mi / 69.0;
  if (typeof maskTexelDeg === 'number' && maskTexelDeg > 0) {
    radiusDeg = Math.max(radiusDeg, 1.6 * maskTexelDeg);
  }
  return { radiusDeg, floor: washUnder ? 0.0 : 0.3 };
}

// Longitude span of a grid's bounds in degrees (antimeridian-safe).
export function boundsLonSpan(b) {
  if (!b || typeof b.west !== 'number' || typeof b.east !== 'number') return 0;
  return (b.east < b.west) ? (b.east + 360 - b.west) : (b.east - b.west);
}

// A regional tile covers a sub-global longitude span (< 359°). The coarse-global fallback spans the whole world.
export function isRegionalBounds(b) {
  const span = boundsLonSpan(b);
  return span > 0 && span < 359.0;
}

// The coarse-global fallback: spans the world AND has large (~10°) cells. A hypothetical full-width FINE grid
// (cellDeg < 1°) is NOT a coarse base — mirrors the cellDeg>1° gate used by the close-zoom coarse-fade.
export function isCoarseGlobalGrid(waveGrid) {
  const b = waveGrid && waveGrid.bounds;
  const cols = waveGrid && waveGrid.cols;
  if (!b || !cols) return false;
  const span = boundsLonSpan(b);
  if (span < 359.0) return false;
  return (span / cols) > 1.0;
}

// === TILE≥VIEWPORT CLAMP (pure; exported for tests) ===
// §7i (2026-07-13, user live report: "animations cover half the Pacific with a vertical division
// at ~z3; coverage follows pans"): db363a14 set TILE_BACKOFF 2 for crest-density headroom, sizing
// the particle tile 1/2^(floor(z)-2) of the world — in the LOW fraction of each integer zoom
// (worst at z3.0–3.6, tile = half the world vs a wide monitor's ~240° viewport) the camera-
// centered tile is NARROWER than the viewport. Particles only exist inside the tile (ADVECT_FS
// fract()-wraps positions), so its edge is a hard crest cliff that re-anchors with every pan.
// Widen by POWER-OF-TWO steps until the tile covers the viewport (both axes + margin): the
// discrete reinit-on-change contract is preserved, and the constant-density solve reads the same
// tileWidth so on-screen crest count self-corrects. Kill: __RAW_DISABLE_TILE_VP_CLAMP__.
export function clampTileToViewport(tileZoom, tileWidth, vpMercW, vpMercH) {
  const need = Math.min(1.0, Math.max(vpMercW || 0, vpMercH || 0) * 1.1);
  let z = tileZoom, w = tileWidth, clamped = false;
  while (w < need && z > 0) { z -= 1; w *= 2; clamped = true; }
  return { tileZoom: z, tileWidth: w, clamped };
}

// === WIDE-ZOOM PARTICLE-TILE BACKOFF (pure; exported for tests) — HANDOFF item B, 2026-07-23 ===
// Resolves how many power-of-two steps SMALLER than the map zoom the particle-advection tile is sized
// (tileZoom = floor(z) − backoff; tileWidth = 1/2^tileZoom). The knob matters at WIDE zoom, where backoff 2
// makes a 0.5-merc (180°) PARTIAL tile whose fract()-wrap edge is a geographic DISCONTINUITY near the
// antimeridian (the "split"). Resolution order & modes (see the call-site comment for the full rationale):
//   • explicit numeric __RAW_TILE_BACKOFF__            → pinned (mode 'pin'); wins over everything.
//   • __RAW_DISABLE_TILE_BACKOFF_ZOOMGATE__ === true    → forces mode 'off' (constant backoff 2 = pre-fix).
//   • __RAW_TILE_BACKOFF_GATE_MODE__ (default 'world'):
//       'world'  z∈(3,4) → backoff 3 (tileWidth 1.0, WHOLE-WORLD tile: seamless antimeridian wrap, never
//                re-anchors → no split, no edge-gap/blink on pan; density solve still on-target to ~z3.7).
//       'dense'  z∈(3,5) → backoff 1 (tileWidth 0.25: DISPROVEN — edge-gap + 2× reseed-blink on pan; A/B only).
//       else               backoff 2 (the proven pan-stable default at every other zoom).
// Live-validated 2026-07-23: world @z3.5 across the antimeridian = seamless crests, 2 reinits/270° pan.
export function resolveTileBackoff(z, win) {
  win = win || {};
  if (typeof win.__RAW_TILE_BACKOFF__ === 'number') return { backoff: win.__RAW_TILE_BACKOFF__, mode: 'pin' };
  let mode = (typeof win.__RAW_TILE_BACKOFF_GATE_MODE__ === 'string') ? win.__RAW_TILE_BACKOFF_GATE_MODE__ : 'world';
  if (win.__RAW_DISABLE_TILE_BACKOFF_ZOOMGATE__ === true) mode = 'off';
  let backoff;
  if (mode === 'world' && z >= 3 && z < 4) backoff = 3;
  else if (mode === 'dense' && z >= 3 && z < 5) backoff = 1;
  else backoff = 2;
  return { backoff, mode };
}

// Per-cell longitude size in degrees; null when unknowable. Feeds the CELL-SIZE branch of the
// no-downgrade guard (a mid 2°/cell clip is "regional" by bounds but a hard resolution downgrade
// over a resident 0.25° tile).
export function gridCellDeg(waveGrid) {
  const b = waveGrid && waveGrid.bounds;
  const cols = waveGrid && waveGrid.cols;
  if (!b || !cols || cols < 2) return null;
  const span = boundsLonSpan(b);
  return span > 0 ? span / (cols - 1) : null;
}

// === NO-DOWNGRADE decision (pure; exported for tests) ===
// True when `incoming` is the global-COARSE fallback that would DOWNGRADE a resident REGIONAL grid of the SAME
// component layer + hour while the map is zoomed IN — the coarse⇄regional ping-pong that resets the particle FBO
// and re-orients the (different) direction field on every commit, i.e. the "clockwise spin" (live repro
// 2026-07-01, Cocoa z9: 13×13 series_GFS_waves_h0 resident, overwritten by 37×17 gfs_marine_waves_global_coarse,
// rev 1→3→5→7 flipping shapes with a particle reset + traceId-race MISMATCH each time). Blocks ONLY the downgrade:
// coarse→regional (sharpen/UPGRADE), a scrub to a DIFFERENT hour, zoomed-out, no resident, or a resident regional
// that no longer COVERS the viewport (stale after a pan) all return false — so the guard can never strand a
// non-covering rectangle nor re-create the coarse-global CLAMP that 7f6c39be/54e289b5 fixed.
export function shouldRejectResolutionDowngrade(resident, incoming, lastZoom, viewportBounds, disabled, nowMs) {
  if (disabled || !resident || !incoming) return false;
  // Two downgrade shapes are blocked (everything else falls through unguarded):
  //  (1) the coarse-GLOBAL fallback displacing a regional (the original 07-01 ping-pong), and
  //  (2) CELL-SIZE downgrades ≥2× — e.g. the 2°/cell global_mid clip displacing a still-covering
  //      0.25° fine tile (live 2026-07-05, z7.38→7.54 Channel Islands: the 30%-padded request
  //      bbox pokes past the 6° socal fine tile in exactly that band, the resolver hands the mid
  //      clip, and this gate — coarse-global-only until now — waved it through: dark smeared
  //      island shadow + visible 2° lattice, stuck 12s+ until a pan). Upgrades and ≈equal-res
  //      replacements (<2×) always pass; every safety predicate below (same layer+hour, resident
  //      renderable + covers ≥80%) applies to this branch identically.
  // MODEL SWITCH IS NEVER A DOWNGRADE (2026-07-06, live-proven at z11.4: GFS 9×9 regional resident
  // rejected EURO's 37×17 mid — EURO's close-zoom CEILING, it has no fine tiles — same layer+hour,
  // so the map kept DISPLAYING GFS data under the EURO selection, permanently: the self-heal stash
  // re-evaluates only zoom/coverage, which keep holding. A cross-model commit is a deliberate
  // replacement; resolution comparison across models is meaningless and holding the old model's
  // grid mislabels the data (truth violation). Kill shared: __RAW_DISABLE_NO_DOWNGRADE__.
  const _rm = resident.__sourceModel || 'GFS';
  const _im = incoming.__sourceModel || 'GFS';
  if (_rm !== _im) return false;
  // RATED-RESIDENT RELEASE (2026-07-12 round-8, live-proven: "clamping when I deactivate the
  // ratings" — FORENSIC-SNAP showed {rating:true, band:false} held 75+ s at z5.9 while the guard
  // rejected the honest 37×17): a resident RATING grid's height channel holds SCORES; with the
  // Surf flag OFF the honest colormap renders scores-as-heights (garbage). Once the flag is off,
  // ANY honest incoming — even the coarse global — is a TRUTH UPGRADE over a rated resident:
  // never hold it. (Exact mirror of ratingDowngrade below, which protects rated residents while
  // the flag is ON.) Kill shared: __RAW_DISABLE_NO_DOWNGRADE__ disables the whole guard.
  const _surfFlagOn = (typeof window !== 'undefined') && (window.__SURF_MODE__ === true
    || (window.__SURF_MODE__ === undefined && typeof window.localStorage !== 'undefined'
        && window.localStorage.getItem('__SURF_MODE__') === 'true'));
  if (resident.ratingMode && !incoming.ratingMode && !_surfFlagOn) return false;
  const _rc = gridCellDeg(resident);
  const _ic = gridCellDeg(incoming);
  const cellDowngrade = _rc !== null && _ic !== null && _ic >= _rc * 2.0;
  // RATING downgrade (2026-07-12, "ICON band activated then CLEARED / EURO never activates"):
  // in rating mode, an UNRATED incoming grid replacing a RATED resident is a downgrade — on
  // cold-SWR models (EURO/ICON, no warm pilot tiles) the coarse global (transform skipped)
  // kept displacing the rated dynamic grid every cycle, flickering the band off. Same coverage/
  // layer/hour predicates below apply, so a non-covering rated rect still releases (no stranding)
  // and cross-model switches above stay deliberate. Kill shared: __RAW_DISABLE_NO_DOWNGRADE__.
  const ratingDowngrade = !!(resident.ratingMode && !incoming.ratingMode)
    && (typeof window !== 'undefined') && (window.__SURF_MODE__ === true
        || (window.__SURF_MODE__ === undefined && typeof window.localStorage !== 'undefined'
            && window.localStorage.getItem('__SURF_MODE__') === 'true'));
  if (!isCoarseGlobalGrid(incoming) && !cellDowngrade && !ratingDowngrade) return false;
  if (!isRegionalBounds(resident.bounds)) return false;    // resident must itself be a regional tile
  const sameLayer = (incoming.__componentLayer || 'waves') === (resident.__componentLayer || 'waves');
  const sameHour = incoming.hourOffset !== undefined && resident.hourOffset !== undefined
    && incoming.hourOffset === resident.hourOffset;
  // UNKNOWN zoom must FAIL OPEN (2026-07-03): _lastZoom is only written by the render loop, so a
  // commit racing a zoom change (or arriving before the first frame / while rAF is paused) reads
  // undefined-or-stale. Treating unknown as "zoomed in" made the guard reject the coarse WHILE the
  // commit ledger recorded it — every retry then dup-skipped and the band displayed a stranded 3°
  // regional rectangle until an hour scrub (live 3Hz×40min loop, 2026-07-03). A wrong ACCEPT costs
  // one particle reset and self-heals via the sharpen path; a wrong REJECT was permanent.
  const zoomedIn = (typeof lastZoom === 'number') && (lastZoom > MARINE_ZOOMED_OUT_MAX_ZOOM);
  const residentRenderable = resident.__renderable !== false && !!(resident.vectors && resident.vectors.length);
  // Keep the resident regional ONLY if it still covers the current viewport; otherwise it's stale after a pan and
  // coarse (or a fresh regional) should be allowed to replace it (no stranded non-covering regional rectangle).
  const rb = resident.bounds;
  let covers = true;
  const coverageKnown = !!(viewportBounds && rb);
  if (coverageKnown) {
    // FRACTIONAL coverage (2026-07-04, the coverage-boundary flip): exact containment made the
    // guard release the moment the viewport crept ONE texel past the tile edge — a small pan at
    // z7.2 or the z6.89 rung of a zoom-out swapped the whole field to the world grid (direction/
    // color flip) even though the tile still filled ~99% of the screen. Keep the regional while
    // it covers ≥80% of the viewport: the blend base wash already draws under it, so the
    // uncovered ring shows coarse wash either way — only the CENTER truth is at stake. Below the
    // threshold the tile is genuinely a fraction of the screen and coarse must take over.
    const vw = viewportBounds[0], vs = viewportBounds[1], ve = viewportBounds[2], vn = viewportBounds[3];
    const vpArea = Math.max(1e-9, (ve - vw) * (vn - vs));
    const ix = Math.max(0, Math.min(rb.east, ve) - Math.max(rb.west, vw));
    const iy = Math.max(0, Math.min(rb.north, vn) - Math.max(rb.south, vs));
    const frac = (ix * iy) / vpArea;
    // 0.8 → 0.6 (2026-07-11, the z7.76 Sebastian "clamping" report, counter-instrumented live):
    // the viewport pokes ~1° past the florida_east_coast tile's east edge, the fine 61×41 covers
    // ~67%, this predicate released it, and EVERY lane then correctly serves covering-but-coarse
    // ~0.24° viewport grids — a whole-screen blocky field while the fine tile (with the entire
    // coastline on it) sat rejected. Per this guard's own 2026-07-04 rationale the uncovered ring
    // shows the coarse blend wash either way — only the CENTER truth is at stake — so keep the
    // fine tile down to 60% coverage. Below that the tile genuinely is a minority of the screen.
    // Live lever unchanged: __RAW_DOWNGRADE_COVER_FRAC__.
    const minFrac = (typeof window !== 'undefined' && Number(window.__RAW_DOWNGRADE_COVER_FRAC__)) || 0.6;
    covers = frac >= minFrac;
  }
  // RATING-INTERLUDE GRACE (2026-07-14, round-12 §4f — "heatmap + animations clear between zooms
  // with the rating band ON"): the coverage release below is CORRECT data-wise (the rated clip is
  // a minority of the screen), but the incoming that wins the release is the UNRATED global —
  // ratingMode drops, the band forces off, the wash disengages, and the whole rating layer blinks
  // out for the seconds until the WIDER rating clip lands (user logs: rating:true 17×17 → the
  // 37×17 global rating:false → rating clip again). Hold the rated resident through that
  // interlude for a BOUNDED grace: the rejected unrated grid sits in the _pendingDowngrade stash
  // (re-evaluated every frame), so when a RATED incoming lands first the swap is rated→rated (no
  // blink), and when the grace expires the unrated stash commits (truth wins — the 07-04
  // stranded-rectangle class stays impossible BY THE BOUND, never by coverage). A rated incoming
  // is untouched by this branch (!incoming.ratingMode), as are scrubs/layer switches/cross-model
  // (same predicates as the guard proper). Kill: __RAW_DISABLE_RATING_GRACE__ = true.
  // Tune: __RAW_RATING_GRACE_MS__ (default 4000). Ring: rating_grace_hold / rating_grace_expired.
  // WIDE-VIEW EXEMPTION (2026-07-16 pt3, user "still glitchy — heatmap clears + animations clamp
  // briefly on zoom-out", rating ON; frame-trace proof on the live harness): at a zoomed-out
  // viewport (≤ MARINE_ZOOMED_OUT_MAX_ZOOM or >15° span — the display gate's own wide-view
  // predicate) the gate has ALREADY hidden this non-covering rated resident (op=0, same
  // __RAW_DOWNGRADE_COVER_FRAC__ boundary), so there is no visible band left for the grace to
  // protect. Holding here pinned a gate-HIDDEN resident for the full grace window while the
  // screen showed only the dimmed crest-less paint-bridge wash, and WEDGED the zoom-out bridge
  // promotion (bridgeToCoarseGlobalIfHeld → setWaveData → this hold → _pendingDowngrade stash →
  // the bridge's own stash early-return skipped every retry until grace expiry; live trace:
  // 4.6s of hidden-wash ≈ the 4000ms grace + frame slop). On a wide viewport the honest coarse
  // must land immediately (the zoom-out arc's "coarsening, never clearing"). The settled
  // band-flicker protection (§4f's cold-SWR case) is unaffected: a COVERING rated resident is
  // still held by the ratingDowngrade branch, and the grace remains for zoomed-IN coverage drops
  // (pans at band zooms), where the gate still displays the resident and the band would blink.
  const wideView = ((typeof lastZoom === 'number') && lastZoom <= MARINE_ZOOMED_OUT_MAX_ZOOM)
    || (coverageKnown && ((viewportBounds[2] - viewportBounds[0]) > 15.0
        || (viewportBounds[3] - viewportBounds[1]) > 15.0));
  const graceEligible = _surfFlagOn && !!resident.ratingMode && !incoming.ratingMode
    && sameLayer && sameHour && residentRenderable && coverageKnown && !covers && !wideView;
  if (graceEligible) {
    const w = (typeof window !== 'undefined') ? window : {};
    if (w.__RAW_DISABLE_RATING_GRACE__ !== true) {
      const graceMs = (typeof w.__RAW_RATING_GRACE_MS__ === 'number') ? w.__RAW_RATING_GRACE_MS__ : 4000;
      const t = (typeof nowMs === 'number') ? nowMs : Date.now();
      const key = `${_rm}|${resident.__componentLayer || 'waves'}|${resident.hourOffset}|`
        + `${rb ? [rb.west, rb.south, rb.east, rb.north].join(',') : 'nb'}`;
      if (_ratingGraceState.key !== key) {
        _ratingGraceState.key = key;
        _ratingGraceState.startedAt = t;
        _ratingGraceState.expired = false;
        try { recordMarineEvent('rating_grace_hold', { key, graceMs }); } catch (e) { /* ring never fatal */ }
      }
      if (t - _ratingGraceState.startedAt < graceMs) return true;   // hold — stash re-offers next frames
      if (!_ratingGraceState.expired) {
        _ratingGraceState.expired = true;
        try { recordMarineEvent('rating_grace_expired', { key }); } catch (e) { /* ring never fatal */ }
      }
      // expired → fall through: covers=false releases the resident (bounded, self-healing).
    }
  }
  // COVERAGE, not zoom, is the real predicate (2026-07-04, "waves flip direction + height color
  // around z7.0-7.74, then correct"): dipping below the z7.0 threshold let the 37×17 world grid
  // displace a regional tile that still fully covered the viewport — its 10° cells carry leaked
  // directions and block-mean heights at coasts, so every threshold crossing flipped the field on
  // screen (instrumented soak: commits ping-ponged span 360 ⇄ span 3-6 through the band). While
  // KNOWN coverage holds, keep the finer grid at ANY zoom; the swap to coarse then happens at the
  // natural coverage boundary, where the tile is a small part of the screen. The double-unknown
  // case (no zoom AND no viewport) still fails OPEN, and a wrong reject self-heals via the
  // _pendingDowngrade stash re-evaluated every frame with the current zoom/viewport.
  return !!(sameLayer && sameHour && residentRenderable && covers && (zoomedIn || coverageKnown));
}

// Rating-interlude grace state (module singleton — one engine per map). Exported reset for tests.
const _ratingGraceState = { key: null, startedAt: 0, expired: false };
export function __resetRatingGraceForTests() {
  _ratingGraceState.key = null; _ratingGraceState.startedAt = 0; _ratingGraceState.expired = false;
}

// === NULL-ENCODE RESIDENT GUARD (pure; exported for tests) ===
// 2026-07-21 (SDF handoff §9, verified defect): encodeMarineTexture returns null for a DEGENERATE grid
// (no vectors / cols<2 / rows<2 — WebGLMarineTextureEncoder.js ~87). setWaveData's unconditional
// `this._waveData = newWaveData` then DISCARDS a valid resident, and renderHeatmapAndParticles returns
// early on `!this._waveData` (~line 995) → the heatmap goes BLANK, the resident GPU texture is stranded,
// and the commit path dup-skips the same signature → NO re-drive (the user-reported "heatmap clears"
// class). A degenerate grid is never a legitimate CLEAR — real clears go through clearBuffers()/dispose().
// So: when the encode failed BUT a real renderable resident is held, DROP the degenerate commit and keep
// the resident. Returns true ⇒ setWaveData early-returns (keeping the resident intact); false ⇒ legacy
// behaviour (cold start with nothing to preserve keeps the harmless null-assign). Kill switch:
// window.__RAW_DISABLE_NULL_ENCODE_RESIDENT_GUARD__ = true.
export function shouldKeepResidentOnNullEncode(resident, incoming, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (w && w.__RAW_DISABLE_NULL_ENCODE_RESIDENT_GUARD__ === true) return false;
  const rg = resident && resident.waveGrid;
  if (!rg) return false;
  // Only hold a resident that would actually PAINT — a non-renderable resident is no better than blank,
  // so let the legacy path run (nothing worth protecting). Mirrors the encoder's renderability floor.
  if (!(rg.vectors && rg.vectors.length && rg.cols >= 2 && rg.rows >= 2)) return false;
  // TRUTH GUARD (defense-in-depth): only hold across the SAME layer + SAME model. A degenerate grid for
  // a DIFFERENT layer/model must never silently keep the old selection's heatmap MISLABELED under the new
  // one (the documented ICON swell_2→swell_1 mislabel class) — blanking is safer than lying. Today no
  // legitimate cross-layer/model no-data path reaches here as a vectors-present degenerate grid
  // (WebGLMarineLayer drops mismatches first), so this only bites a future refeed/self-heal path. A
  // DIFFERENT hour is still held (a scrub that came back degenerate keeps the last-good frame — a stale
  // hour is a transient, not a truth violation; the real hour re-commits when a valid grid lands).
  if (incoming) {
    if ((incoming.__componentLayer || 'waves') !== (rg.__componentLayer || 'waves')) return false;
    const inModel = incoming.__sourceModel || null;
    const resModel = rg.__sourceModel || null;
    if (inModel && resModel && inModel !== resModel) return false;
  }
  return true;
}

// === COARSE-BAND CREST CONTROLS (pure; exported for tests) ===
// How crests behave on a magnified coarse-global grid in the vortex band (z3.5–7). The 2026-07-01 fix
// SUPPRESSED all crests there (dirCoherenceMin=2 → shader discards everything), which killed the vortex but
// left the whole band crest-less — the "wave animations clear from z3.61 to z6.89, restore at 7.04" report.
// Default is now 'nearest' (2026-07-02): sample the crest DIRECTION at the nearest coarse CELL CENTER
// (u_coarseNearestDir). The vortex was the bilinear BLEND of divergent ~10°-cell headings synthesizing a
// smooth rotation; uniform per-cell headings cannot swirl, so crests animate in the band again with no spin.
// Modes via window.__RAW_COARSE_CREST_MODE__: 'nearest' (default) | 'suppress' (the 2026-07-01 behavior;
// __RAW_DIR_COHERENCE_MIN__ 0..1 = partial cull) | 'off'. Kill switch (legacy bilinear crests — vortex risk,
// forensics only): window.__RAW_DISABLE_COARSE_CREST_SUPPRESS__ = true.
// === VORTEX GATE BY CELL MAGNIFICATION (pure; exported for tests) ===
// 2026-07-13 (user, live at z~8.6 off Canaveral: "waves leaving a center point... like a low
// pressure center" — that pattern is SYNTHESIZED by bilinear blending between a handful of
// divergent cell-center headings, the documented vortex root). The legacy gate below keyed on
// isCoarseGlobalGrid + the empirical z3.5–7 band, so MID-tier grids (2°/cell, regional bounds)
// magnified at z7–9.3 were never gated — the user's log proved 5×4/7×7/9×9 mid grids resident at
// those zooms. Re-key on what actually causes the artifact: CELL MAGNIFICATION. The legacy onset
// is preserved by construction — a 10° cell at z3.5 is ~80 screen px, exactly this threshold.
// cellDeg < 1.0 never gates (fine/regional neighbors are coherent; per-cell uniform motion there
// would be a blocky-motion regression). Returns null when the legacy predicate should be used
// (kill switch __RAW_VORTEX_MAG_GATE_DISABLED__). Tune: __RAW_VORTEX_MIN_CELL_PX__ (default 80).
export function isMagnifiedCoarseField(cellDeg, zoom, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_VORTEX_MAG_GATE_DISABLED__ === true) return null;
  if (cellDeg === null || cellDeg === undefined || typeof zoom !== 'number') return false;
  if (cellDeg < 1.0) return false;
  const pxPerCell = cellDeg * (256 * Math.pow(2, zoom)) / 360;
  const minPx = (typeof w.__RAW_VORTEX_MIN_CELL_PX__ === 'number') ? w.__RAW_VORTEX_MIN_CELL_PX__ : 80;
  return pxPerCell >= minPx;
}

// === FINE-GRID SEAM FLOOR (pure; exported for tests) ===
// 2026-07-31, the Canaveral "low pressure type wave center" report at z8.2 — the SAME symptom the
// 2026-07-13 magnification gate fixed, on a tier that gate cannot see. `isMagnifiedCoarseField`
// returns false for `cellDeg < 1.0` before it ever considers zoom, so a 0.25° REGIONAL tile never
// engages the vortex guard. But a vortex comes from DIRECTION DIVERGENCE, not cell size: bilinear
// filtering rotates the heading smoothly between two disagreeing cells, so a tight discontinuity
// yields a SMALL swirl rather than none.
//
// Measured on the live regional tile off the cape (GFS waves, 2026-07-31T03Z) — a windsea/swell
// regime boundary crossing the coastline:
//     (28.25,-80.25)  16.4° -> (28.5,-80.25) 229.7°   delta 146.8°   |bilinear mid| 0.286
//     (28.50,-80.50)  84.7° -> (28.5,-80.25) 229.7°   delta 145.0°   |bilinear mid| 0.301
// 6 of 175 adjacent pairs (3.4%) exceed 90°, every one below the 0.7 floor already shipped for
// coarse grids. The instrument existed; it was never allowed to look at this tier.
//
// The floor is deliberately LOWER than the coarse one (0.5 ≈ cull past ~120°) so it bites true
// regime seams only and leaves ordinary coastal refraction — where neighbouring cells legitimately
// fan by 30-60° — untouched. Returns 0 (no floor) for coarse grids so the existing coarse path is
// byte-identical. Kill: __RAW_DISABLE_FINE_SEAM_FLOOR__. Tune: __RAW_FINE_SEAM_FLOOR__.
export const FINE_SEAM_MAX_CELL_DEG = 1.0;    // the exact boundary isMagnifiedCoarseField excludes
export const FINE_SEAM_FLOOR_DEFAULT = 0.5;

export function resolveFineSeamFloor(cellDeg, coarseFloor, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_DISABLE_FINE_SEAM_FLOOR__ === true) return 0;
  // Only the tier the coarse guard structurally cannot reach. A coarse grid keeps its own floor.
  if (cellDeg === null || cellDeg === undefined || !(cellDeg < FINE_SEAM_MAX_CELL_DEG)) return 0;
  // Never LOWER an already-applied floor (the suppress path sets 2.0 and must win).
  if (typeof coarseFloor === 'number' && coarseFloor >= 1.0) return 0;
  const tuned = (typeof w.__RAW_FINE_SEAM_FLOOR__ === 'number') ? w.__RAW_FINE_SEAM_FLOOR__ : FINE_SEAM_FLOOR_DEFAULT;
  if (!(tuned > 0)) return 0;
  return Math.min(1.0, tuned);
}

// === DEAD-EDGE TRIM (pure; exported for tests) ===
// 2026-07-18 "hard vertical line of no animations": the NOAA-direct ingest fencepost baked an
// ALL-INVALID east column (and north row) into every regional tile (FL -79.0 col = 21/21
// is_valid:false, live-proven). Inside the resident bbox nothing paints it; ring-fill only engages
// BEYOND the bbox — a one-cell dead stripe. The backend fix (79d34611) is cron-baked and heals
// tiles only as ingest cycles re-run — this is the CLIENT defense at the commit choke point:
// trim edge columns/rows that are 100% invalid (shrinking bounds+dims) so the resident ends at
// real data and ring-fill covers the strip. Edge-only (interior invalid = real land/masks stays),
// bounded to 2 per side, no-op returns the SAME object (no re-alloc churn on hot commits).
// Kill: __RAW_DISABLE_DEAD_EDGE_TRIM__. Telemetry: __RAW_GPU__.deadEdgeTrim.
export function trimDeadEdges(waveGrid, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_DISABLE_DEAD_EDGE_TRIM__ === true) return waveGrid;
  if (!waveGrid || !waveGrid.vectors || !waveGrid.bounds || !(waveGrid.cols > 3) || !(waveGrid.rows > 3)) return waveGrid;
  const b = waveGrid.bounds;
  const stepX = (b.east - b.west) / (waveGrid.cols - 1);
  const stepY = (b.north - b.south) / (waveGrid.rows - 1);
  if (!(stepX > 0) || !(stepY > 0)) return waveGrid;
  const colValid = new Array(waveGrid.cols).fill(0);
  const rowValid = new Array(waveGrid.rows).fill(0);
  for (const v of waveGrid.vectors) {
    if (v.is_valid === false || !(v.speed > 0 || (v.value !== null && v.value !== undefined))) continue;
    const c = Math.round((v.lng - b.west) / stepX);
    const r = Math.round((v.lat - b.south) / stepY);
    if (c >= 0 && c < waveGrid.cols) colValid[c]++;
    if (r >= 0 && r < waveGrid.rows) rowValid[r]++;
  }
  // ANTIMERIDIAN WRAP MIRROR (2026-07-18, fencepost head #3's client twin — normalizer fix
  // f60e765d bakes the same mirror at the source): a FULL-WRAP grid with a dead ±180 edge column
  // must KEEP its 360° span. Trimming it (the original behavior) shrank world grids to ~350° and
  // silently reclassified them as "regional" across every span≥359 predicate — isCoarseGlobalGrid
  // (cold veil, close-zoom crest suppression, no-truth wash guard), the mask renderer's global
  // branch, the encoder's global branch, the sharpen tracer. The ±180 columns are the SAME
  // physical meridian, so the live seam column is real data for the dead one: replace the dead
  // column with a mirrored copy (distinct objects; lng rewritten) and leave bounds/dims alone.
  // Kill just the mirror (regional trim keeps working): __RAW_DISABLE_WRAP_MIRROR__.
  const fullWrap = (b.east - b.west) >= 359.0 && w.__RAW_DISABLE_WRAP_MIRROR__ !== true;
  let vecs = waveGrid.vectors;
  let mirroredEdge = null;
  if (fullWrap) {
    const lastC = waveGrid.cols - 1;
    const colOf = (v) => Math.round((v.lng - b.west) / stepX);
    if (colValid[lastC] === 0 && colValid[0] > 0) {
      vecs = vecs.filter((v) => colOf(v) !== lastC)
        .concat(vecs.filter((v) => colOf(v) === 0).map((v) => ({ ...v, lng: b.east })));
      colValid[lastC] = colValid[0];
      mirroredEdge = 'east';
    } else if (colValid[0] === 0 && colValid[lastC] > 0) {
      vecs = vecs.filter((v) => colOf(v) !== 0)
        .concat(vecs.filter((v) => colOf(v) === lastC).map((v) => ({ ...v, lng: b.west })));
      colValid[0] = colValid[lastC];
      mirroredEdge = 'west';
    }
  }
  let c0 = 0, c1 = waveGrid.cols - 1, r0 = 0, r1 = waveGrid.rows - 1;
  for (let k = 0; k < 2 && c1 > c0 + 2 && colValid[c1] === 0; k++) c1--;
  for (let k = 0; k < 2 && c1 > c0 + 2 && colValid[c0] === 0; k++) c0++;
  for (let k = 0; k < 2 && r1 > r0 + 2 && rowValid[r1] === 0; k++) r1--;
  for (let k = 0; k < 2 && r1 > r0 + 2 && rowValid[r0] === 0; k++) r0++;
  if (c0 === 0 && c1 === waveGrid.cols - 1 && r0 === 0 && r1 === waveGrid.rows - 1) {
    if (!mirroredEdge) return waveGrid;    // true no-op: SAME object (no re-alloc churn)
    const mirroredGrid = { ...waveGrid, vectors: vecs };
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.deadEdgeTrim = { cols: 0, rows: 0, mirrored: mirroredEdge, east: +b.east.toFixed(2) };
    }
    return mirroredGrid;
  }
  const nb = {
    west: b.west + c0 * stepX, east: b.west + c1 * stepX,
    south: b.south + r0 * stepY, north: b.south + r1 * stepY,
  };
  const eps = Math.min(stepX, stepY) * 0.25;
  const vectors = vecs.filter((v) =>
    v.lng >= nb.west - eps && v.lng <= nb.east + eps && v.lat >= nb.south - eps && v.lat <= nb.north + eps);
  const trimmed = { ...waveGrid, vectors, bounds: nb, cols: c1 - c0 + 1, rows: r1 - r0 + 1 };
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.deadEdgeTrim = {
      cols: (c0) + (waveGrid.cols - 1 - c1), rows: (r0) + (waveGrid.rows - 1 - r1), east: +nb.east.toFixed(2),
      ...(mirroredEdge ? { mirrored: mirroredEdge } : {}),
    };
  }
  return trimmed;
}

// === SHARPEN-COMMIT OPACITY EASE (pure; exported for tests) ===
// FIRST-ACTIVATION SWAP (2026-07-17, user: "activate a marine layer after refresh — one heatmap,
// then 1-2 s later a DIFFERENT heatmap + animations"): probe_first_activation.js pinned the ladder —
// coarse-global first paint (37 cols, coarseFade 0.7, eff. opacity 0.53) then the fine viewport
// commit ~2 s later (10 cols, coarseFade 1.0, blend+ringfill on, eff. opacity 0.76). The DATA hue
// change is honest refinement, but the OPACITY stepped +43% in one frame — the visual "pop". This
// eases the final computed heatmap opacity from the last-drawn value to the new target over
// __RAW_SHARPEN_OPACITY_EASE_MS__ (default 600 ms) after a REAL resident swap (bounds/dims changed —
// same-tier scrub frames have identical dims and stamp from≈target ⇒ no-op). Works both directions
// (fine→coarse zoom-out dim too). SNAP-TO-HIDDEN GUARD: when the layer intends invisibility
// (mult 0 — the stale gate / flash-chain doors — or target ≤0.01) the ease is DROPPED, never
// ghost-painting a hidden layer (the 2026-07-16 flash-chain class stays fixed). Chaining: `from` is
// the last DRAWN value, so a mid-ease re-commit continues smoothly from what's on screen.
// Kill: __RAW_DISABLE_SHARPEN_OPACITY_EASE__. Telemetry: __RAW_GPU__.opacityEase while active.
// Returns { value, ease } — the opacity to draw and the (possibly expired ⇒ null) ease state.
export function applySharpenOpacityEase(ease, target, mult, nowMs, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_DISABLE_SHARPEN_OPACITY_EASE__ === true || !ease) return { value: target, ease: null };
  if (mult === 0 || target <= 0.01 || typeof ease.from !== 'number') {
    return { value: target, ease: null };   // hidden intent (or bad stamp) ⇒ snap, drop the ease
  }
  if (ease.from <= 0.01) {
    // FROM-hidden snap (2026-07-17 zoomlab regression battery): a band-faded rated resident draws
    // at hm 0; easing UP from 0 after the unrated world commit re-opened the §2c hard flip the
    // wash-lift architecture engineered away (rated→unrated swap ΔL 1.9 → +48.3 with the ease).
    // Easing from invisible IS the blank-window class — snap instead. The sharpen glide this ease
    // exists for (0.53→0.76 first activation) always has a visible `from` and is unaffected.
    return { value: target, ease: null };
  }
  const ms = (typeof w.__RAW_SHARPEN_OPACITY_EASE_MS__ === 'number' && w.__RAW_SHARPEN_OPACITY_EASE_MS__ > 0)
    ? w.__RAW_SHARPEN_OPACITY_EASE_MS__ : 600;
  const dt = nowMs - ease.t0;
  if (!(dt >= 0) || dt >= ms) return { value: target, ease: null };
  const t = dt / ms;
  const k = t * t * (3 - 2 * t);            // smoothstep
  return { value: ease.from + (target - ease.from) * k, ease };
}

// === COLD-ACTIVATION COARSE VEIL (pure; exported for tests) ===
// 2026-07-18 (user re-report of the 07-17 first-activation swap: "still flashing a different
// colored heatmap for a second before the proper heatmap"): the opacity EASE above softened the
// swap's opacity step, but the cold first paint's HUE is still wrong at coastal zoom — the 37-col
// world grid is one ~10° cell of offshore-mean color across the whole viewport (firstpaint-lab
// measured 6.0 ft world-cell vs 1.6 ft regional at Cocoa z9, ~3.2 s of wrong color). Crests are
// already suppressed on a coarse-global resident at z≥7 (2026-07-14 direction-truth tightening);
// this is the heatmap's matching guard: while the COLD window is open (first resident since
// activation/clear is coarse-global, coastal viewport < 15°, non-rating), hold the heatmap
// invisible so the regional sharpen (~1-3 s) is the FIRST thing painted.
// BOUNDED by design (the 2026-06-29/07-04 lesson — every unbounded fade-to-zero here read as a
// "blank heatmap" bug): a grace timer reveals the coarse anyway if no adequate commit lands
// (mid-ocean viewports with no finer supply). Lift ramps 350 ms; a lift within 50 ms of the
// stamp (wide zoom, rating band — never actually veiled) skips the ramp so those paths stay
// pixel-identical to today. Rating grids are exempt (the band is a smoothed zone, wanted even
// from coarse data — mirrors the coarseFade exemption).
// Kill: __RAW_DISABLE_COLD_COARSE_VEIL__. Grace: __RAW_COLD_VEIL_GRACE_MS__ (default 4000).
// Telemetry: __RAW_GPU__.coldVeil while a veil lifecycle is active.
// Returns { mult, veil } — the opacity multiplier and the (possibly ended ⇒ null) veil state.
export function resolveColdVeil(veil, opts, nowMs, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (!veil) return { mult: 1.0, veil: null };
  if (w.__RAW_DISABLE_COLD_COARSE_VEIL__ === true || opts.debugIsolate === true) {
    return { mult: 1.0, veil: null };       // killed ⇒ end the lifecycle, never resurrect
  }
  const grace = (Number.isFinite(+w.__RAW_COLD_VEIL_GRACE_MS__) && +w.__RAW_COLD_VEIL_GRACE_MS__ > 0)
    ? +w.__RAW_COLD_VEIL_GRACE_MS__ : 4000;
  const span = +opts.viewportSpanDeg;
  const inadequate = opts.residentCoarseGlobal === true && span > 0 && span < 15 && opts.isRating !== true;
  if (!veil.liftT0) {
    if (inadequate && (nowMs - veil.t0) < grace) return { mult: 0.0, veil };
    // Lift: adequate resident (regional swap / wide viewport / rating) or grace expiry.
    if (!inadequate && (nowMs - veil.t0) < 50) return { mult: 1.0, veil: null }; // never engaged ⇒ no ramp
    veil.liftT0 = nowMs;
    veil.reason = inadequate ? 'grace' : 'adequate';
  }
  const RAMP_MS = 350;
  const p = (nowMs - veil.liftT0) / RAMP_MS;
  if (p >= 1) return { mult: 1.0, veil: null };
  const k = p <= 0 ? 0 : p * p * (3 - 2 * p);   // smoothstep reveal
  return { mult: k, veil };
}

export function resolveCoarseCrestControls(inVortexBand, win, cellDeg) {
  // `cellDeg` (2026-07-31) folds the FINE-GRID SEAM FLOOR in here rather than at the call site:
  // WebGLMarineEngine.js is a grandfathered LOC file that may only SHRINK, and the composition
  // belongs with the other pure crest policy anyway. See resolveFineSeamFloor for the derivation.
  const seam = resolveFineSeamFloor(cellDeg, 0, win);
  // Legacy shape preserved EXACTLY when no fine floor applies, so the pre-existing contract test
  // (and every caller that object-matches) is untouched; the key appears only when it engages.
  if (!inVortexBand) {
    if (!(seam > 0)) return { dirCoherenceMin: 0.0, coarseNearestDir: 0.0, mode: 'off' };
    // ⚠️⚠️ NEAREST-CELL SAMPLING IS THE PRIMARY ANTI-VORTEX MECHANISM, THE FLOOR IS SECONDARY.
    // The first fine-tier attempt (2026-07-31) shipped the floor alone with coarseNearestDir 0 and
    // the user still saw the swirl "at a lot of zooms" — correctly, because the floor only CULLS
    // particles inside the divergent strip while the surviving field is still bilinearly
    // interpolated and therefore still rotates. The 2026-07-01 root analysis is explicit that
    // uniform per-cell headings CANNOT swirl; that is what actually removes the vortex, and the
    // floor then cleans up the seam strips between opposed cells. Both, or neither works.
    return { dirCoherenceMin: seam, coarseNearestDir: 1.0, mode: 'fine_seam', fineSeamFloor: seam };
  }
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_DISABLE_COARSE_CREST_SUPPRESS__ === true || w.__RAW_COARSE_CREST_MODE__ === 'off') {
    return { dirCoherenceMin: 0.0, coarseNearestDir: 0.0, mode: 'killed' };
  }
  const o = (typeof w.__RAW_DIR_COHERENCE_MIN__ === 'number') ? w.__RAW_DIR_COHERENCE_MIN__ : null;
  if (w.__RAW_COARSE_CREST_MODE__ === 'suppress') {
    return { dirCoherenceMin: o !== null ? o : 2.0, coarseNearestDir: 0.0, mode: 'suppress' };
  }
  // SEAM floor default 0.7 (2026-07-03): coherence is now LAND-AWARE — the encoder's direction-only
  // dilation (dilateDirectionField, WebGLMarineTextureEncoder) fills a unit direction into every
  // zero-direction texel (land / is_valid:false / beyond the extrapolation ring), so the bilinear
  // |waveVec| collapses ONLY at true divergent-direction seams, never beside coastlines. (The first
  // default-on attempt was land-BLIND and faded a cell-width of ocean at every coastline — the
  // "missing patches all over" regression, HANDOFF-2026-07-03 §0A.) 0.7 ≈ fade where neighbor
  // headings differ by >~90° (|avg of two unit vectors| = cos(θ/2)); hard drop <0.35 ≈ >~140°.
  // Override via __RAW_DIR_COHERENCE_MIN__ (0 = off); encoder kill: __RAW_DISABLE_DIR_DILATION__.
  return { dirCoherenceMin: o !== null ? o : 0.7, coarseNearestDir: 1.0, mode: 'nearest' };
}

// === NATURAL ANIMATION DEFAULTS (baked 2026-07-01) ===
// The §5#2 animation upgrades (trochoidal crest shape, orbital pitch, shoaling foam, crest direction-jitter)
// shipped as gated shader uniforms DEFAULT-OFF pending visual dial-in — but the dial-in was never baked, so
// production always rendered the legacy flat look and the tuner's "Natural" preset had to be re-applied by hand
// every session. These are the designed Natural values (MarineAnimTuner PRESET_NATURAL). Resolution order per
// frame: explicit window.__RAW_*__ (tuner slider / console) → legacy kill (window.__RAW_ANIM_LEGACY__ = true →
// 0, the pre-2026-07-01 look) → Natural default. All values are DRAW-shader-only (crest visuals); advection is
// untouched, so motion/physics cannot regress. Exported for tests + the tuner (single source of truth).
export const NATURAL_ANIM_DEFAULTS = {
  __RAW_TROCHOIDAL__: 0.7,        // asymmetric crest: sharp leading face, broad trailing back
  __RAW_ORBITAL_PITCH__: 2.5,     // phase-synced fwd/back sway (px); keep ≤3 to avoid banding
  __RAW_SHOAL_FOAM__: 1.5,        // extra whitecap in shallow water (inert without bathymetry)
  __RAW_CREST_DIR_JITTER__: 0.26, // rad of per-crest heading spread (breaks the parallel-crest lattice; 0.2→0.26 2026-07-07, user-tuned to soften the z9 GFS-0.25° crest grid — runbook §9e)
};
export function resolveAnimValue(key) {
  if (typeof window !== 'undefined') {
    if (typeof window[key] === 'number') return window[key];
    if (window.__RAW_ANIM_LEGACY__ === true) return 0.0;
  }
  return NATURAL_ANIM_DEFAULTS[key] !== undefined ? NATURAL_ANIM_DEFAULTS[key] : 0.0;
}

// Identity of a captured coarse base so we re-encode only when the underlying coarse grid actually changes.
// RATING FLAVOR IS PART OF THE IDENTITY (2026-07-16, zoom-out color-snap forensics): without it a
// RATED coarse-global commit with the same dims/bounds/hour as the held UNRATED base was "same key"
// → _captureCoarseBase never re-fired → the base stayed the WRONG flavor indefinitely after a
// rating toggle, and every bridge promotion committed that stale flavor under the current view
// (the vivid↔rating restyle pop when the true-flavor wide grid finally landed).
export function coarseBaseKey(waveGrid) {
  const b = (waveGrid && waveGrid.bounds) || {};
  return [
    waveGrid && waveGrid.__sourceModel || 'GFS',
    waveGrid && waveGrid.__componentLayer || 'waves',
    waveGrid && waveGrid.cols, waveGrid && waveGrid.rows,
    b.west, b.south, b.east, b.north,
    waveGrid && waveGrid.hourOffset || 0,
    (waveGrid && waveGrid.ratingMode) ? 'r1' : 'r0'
  ].join('|');
}

