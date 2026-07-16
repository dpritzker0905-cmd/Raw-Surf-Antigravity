/**
 * WebGLMarineEngine.js
 * Ocean GPU v2 — Fully GPU-native, raster-free marine rendering engine.
 * Renders pulsing, perpendicular wave fronts using gl.drawArrays(gl.LINES)
 * overlayed on a smooth, continuous GPU wave height heatmap.
 * Strictly conforms to WebGL State Isolation Protocol and is < 600 lines of code.
 */

import { recordTruthStage } from './weatherTruthTracker';
import { recordMarineEvent } from './marineForensics';   // __RAW_FORENSIC__ ring buffer (one-read live diagnosis)
import { captureWebGLState, restoreWebGLState } from './WebGLStateIsolation';
import './maskFloodProbe';   // installs window.__MASK_PROBE__ (dev mask-flood diagnostic)
import './marineSharpenTrace';   // installs window.__SHARPEN_TRACE__ (zoom-out sharpen-timeline instrument)

import {
  createShader,
  createProgram,
  bindTexture,
  unbindTexture,
  safeDeleteTexture
} from './WebGLWindUtils';
import {
  createTexture,
  encodeMarineTexture
} from './WebGLMarineTextureEncoder';
import { renderMaskToCanvas, overlayBasemapWaterOnMask, isBasemapWaterSourceReady, maskDensityPxPerDeg } from './WebGLMarineMaskRenderer';

import { populateCrestDiagnostics } from './WebGLMarineEngineDiagnostics';
import { MARINE_ZOOMED_OUT_MAX_ZOOM, COARSE_CREST_BAND_MIN_ZOOM } from './marineZoomThresholds';
import {
  reinitParticles,
  reseedParticleStateInPlace,
  shouldCarryParticlesOnGridSwap,
  initEngine,
  disposeEngine
} from './WebGLMarineEngineInit';

function latToMercatorY(lat) {
  const latClamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const rad = (latClamped * Math.PI) / 180.0;
  return (1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0;
}

// Zoom-based base heatmap opacity ladder (shared by the main heatmap pass and the BLEND-BOTH coarse base wash).
function heatmapZoomOpacity(z) {
  if (z <= 2) return 0.55;
  if (z <= 5) return 0.55 + (z - 2) / 3 * 0.10;
  if (z <= 8) return 0.65 + (z - 5) / 3 * 0.10;
  if (z <= 12) return 0.75 + (z - 8) / 4 * 0.05;
  return 0.85;
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
// Levers: __RAW_RATING_SPAN_FADE_LO__ (default 6°, fade starts) / __RAW_RATING_SPAN_FADE_HI__
// (default 9.5° ≈ the 15° request-span boundary before the frontend fetch pad). Kill:
// __RAW_RATING_ZOOM_FADE_DISABLED__ (restores the hard on/off). Telemetry: __RAW_GPU__.ratingBandFade.
export function resolveRatingBandFade(viewportLonSpan, isRatingPainting, washEngaged, win) {
  const ident = { bandMult: 1.0, washStrength: null, fade: 1.0 };
  if (!isRatingPainting) return ident;
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_RATING_ZOOM_FADE_DISABLED__ === true) return ident;
  if (typeof viewportLonSpan !== 'number' || !(viewportLonSpan > 0)) return ident;
  const lo = (typeof w.__RAW_RATING_SPAN_FADE_LO__ === 'number') ? w.__RAW_RATING_SPAN_FADE_LO__ : 6.0;
  const hi = (typeof w.__RAW_RATING_SPAN_FADE_HI__ === 'number') ? w.__RAW_RATING_SPAN_FADE_HI__ : 9.5;
  const t = Math.max(0.0, Math.min(1.0, (viewportLonSpan - lo) / Math.max(1e-6, hi - lo)));
  const fade = 1.0 - t * t * (3.0 - 2.0 * t);      // smoothstep: 1 at lo (band full) → 0 at hi (band gone)
  const bandMult = washEngaged ? fade : Math.max(0.3, fade);
  const base = (typeof w.__RAW_BLEND_BASE_WASH__ === 'number') ? w.__RAW_BLEND_BASE_WASH__ : 0.72;
  const washStrength = base + (1.0 - base) * (1.0 - fade);   // dimmed under a full band → full when the band is gone
  return { bandMult, washStrength, fade };
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
function boundsLonSpan(b) {
  if (!b || typeof b.west !== 'number' || typeof b.east !== 'number') return 0;
  return (b.east < b.west) ? (b.east + 360 - b.west) : (b.east - b.west);
}

// A regional tile covers a sub-global longitude span (< 359°). The coarse-global fallback spans the whole world.
function isRegionalBounds(b) {
  const span = boundsLonSpan(b);
  return span > 0 && span < 359.0;
}

// The coarse-global fallback: spans the world AND has large (~10°) cells. A hypothetical full-width FINE grid
// (cellDeg < 1°) is NOT a coarse base — mirrors the cellDeg>1° gate used by the close-zoom coarse-fade.
function isCoarseGlobalGrid(waveGrid) {
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

// Per-cell longitude size in degrees; null when unknowable. Feeds the CELL-SIZE branch of the
// no-downgrade guard (a mid 2°/cell clip is "regional" by bounds but a hard resolution downgrade
// over a resident 0.25° tile).
function gridCellDeg(waveGrid) {
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

export function resolveCoarseCrestControls(inVortexBand, win) {
  if (!inVortexBand) return { dirCoherenceMin: 0.0, coarseNearestDir: 0.0, mode: 'off' };
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

// --- Engine Definition ---

function WebGLMarineEngine() {
  this.particleRes = 296;       // 296² = 87,616 crests
  this.speedFactor = 0.05;      // drift speed scale
  this.dropRate = 0.003;        // particle drop rate
  this._initialized = false;
  this._waveData = null;
  this._startTime = Date.now();
  this._fboSupported = true;

  if (typeof window !== 'undefined') {
    window.__MARINE_ENGINE__ = this;
  }

  if (typeof window !== 'undefined' && !window.__RAW_GPU__) {
    window.__RAW_GPU__ = {
      textureCount: 0,
      textureUploadCount: 0,
      framebufferCount: 0,
      activeRafCount: 1,
      drawCallsPerFrame: 0,
      gpuMemoryEstimate: 0,
      shaderCompileCount: 6, // 6 shaders compiled at start
      frameTimeHistogram: [0, 0, 0, 0, 0], // <8ms, 8-16ms, 16-32ms, 32-64ms, >64ms
      droppedFrameCounter: 0,
      reactRerenderCounter: 0
    };
  }
}

WebGLMarineEngine.prototype.init = function(gl) {
  initEngine(this, gl);
};

WebGLMarineEngine.prototype.reinitParticles = function(gl) {
  reinitParticles(this, gl);
};

WebGLMarineEngine.prototype.isHighResMaskLoaded = function() {
  return !!this._cachedMaskGeoJSON;
};

WebGLMarineEngine.prototype.setWaveData = function(gl, waveGrid, landGeoJSON) {
  if (!waveGrid?.vectors?.length) return;

  // Every commit (re-)encodes the mask WITHOUT the basemap-truth patch — the repaint hysteresis
  // must forget its "already painted" state or it SKIPS the re-apply and the freshly-encoded
  // NE-only mask leaks the heatmap over fine-grained land (live "leaking all over the place"
  // report: hour scrubs/sharpens/toggles re-commit constantly). The layer's revision effect
  // re-patches immediately after the commit; this line just lets it through.
  this._regionalPatchState = null;

  // === NO-DOWNGRADE GUARD — kills the coarse⇄regional ping-pong "spin" at the single engine choke point every
  // commit source funnels through (orchestrator data_commit + SWR, WebGLMarineLayer land_mask_res_swap, the
  // instant cache-hit on toggle, and the sync overlay). Refuse to overwrite a resident REGIONAL grid with the
  // global-COARSE fallback for the same layer+hour while zoomed in over a covered viewport — that swap resets the
  // particle FBO and re-orients the direction field (the spin). Hour/coverage-scoped + directional, so coarse→
  // regional sharpen, a scrub to a new hour, a pan off the tile, and zoom-out all pass through untouched. Kill:
  // window.__RAW_DISABLE_NO_DOWNGRADE__. Telemetry: window.__MARINE_NO_DOWNGRADE__.count.
  const _ndDisabled = typeof window !== 'undefined' && !!window.__RAW_DISABLE_NO_DOWNGRADE__;
  const _rejDowngrade = !!(this._waveData && this._waveData.waveGrid &&
      shouldRejectResolutionDowngrade(this._waveData.waveGrid, waveGrid, this._lastZoom, this._lastViewportBounds, _ndDisabled));
  // SUB-COVERING REGIONAL over a covering coarse-global at wide view (see
  // shouldRejectSubcoveringRegional): same choke point, same self-heal stash — the gate would hide
  // it (mult 0) and the bridge would bounce the world grid back, so the commit is pure churn.
  const _rejSubcover = !_rejDowngrade && !!(this._waveData && this._waveData.waveGrid &&
      shouldRejectSubcoveringRegional(this._waveData.waveGrid, waveGrid, this._lastZoom, this._lastViewportBounds, _ndDisabled,
        typeof window !== 'undefined' ? window : undefined));
  if (_rejDowngrade || _rejSubcover) {
    const _res = this._waveData.waveGrid;
    const _why = _rejDowngrade ? 'downgrade' : 'subcover';
    if (typeof window !== 'undefined') {
      const nd = window.__MARINE_NO_DOWNGRADE__ || (window.__MARINE_NO_DOWNGRADE__ = { count: 0 });
      nd.count++;
      nd.last = { residentDims: `${_res.cols}×${_res.rows}`, rejectedDims: `${waveGrid.cols}×${waveGrid.rows}`,
        layer: waveGrid.__componentLayer || 'waves', hour: waveGrid.hourOffset, zoom: this._lastZoom, ts: Date.now(), why: _why };
    }
    console.log(`[WebGLMarineEngine] No-${_why}: kept resident ${_res.cols}×${_res.rows} (${waveGrid.__componentLayer || 'waves'} h${waveGrid.hourOffset}); rejected ${waveGrid.cols}×${waveGrid.rows} at zoom ${typeof this._lastZoom === 'number' ? this._lastZoom.toFixed(1) : this._lastZoom}.`);
    recordMarineEvent(_rejDowngrade ? 'reject_downgrade' : 'reject_subcover', {
      resident: `${_res.cols}x${_res.rows}`, incoming: `${waveGrid.cols}x${waveGrid.rows}`,
      layer: waveGrid.__componentLayer || 'waves', hour: waveGrid.hourOffset,
      zoom: (typeof this._lastZoom === 'number') ? +this._lastZoom.toFixed(2) : null,
      incomingRating: !!waveGrid.ratingMode, residentRating: !!_res.ratingMode,
    });
    // SELF-HEAL STASH (2026-07-03): a rejected grid must never be lost — the commit path records its
    // signature, so it will NEVER be re-committed (dup-skip) and a wrong rejection (stale _lastZoom)
    // would strand the display permanently. Stash it; the render loop re-evaluates the guard with the
    // CURRENT zoom/viewport every frame and swaps it in the moment rejection no longer holds.
    this._pendingDowngrade = waveGrid;
    return;
  }
  // Any ACCEPTED commit supersedes a stashed reject (newer data won; the stash must not resurrect).
  this._pendingDowngrade = null;

  if (landGeoJSON) {
    this._landGeoJSON = landGeoJSON;
  }
  const activeGeoJSON = landGeoJSON || this._landGeoJSON;
  // Per-commit logs fire dozens/sec during a drag and are serialized by session-replay console
  // capture (a measured jank amplifier) — quiet by default; flip window.__MARINE_VERBOSE__=true.
  const _verbose = typeof window !== 'undefined' && window.__MARINE_VERBOSE__ === true;
  if (_verbose) console.log(`[WebGLMarineEngine-Forensic] setWaveData: ${waveGrid.vectors.length} vectors, landGeoJSON present: ${!!activeGeoJSON}`);

  if (_verbose) console.log('[WebGLMarineEngine] setWaveData input:', {vectors: waveGrid.vectors.length, cols: waveGrid.cols, rows: waveGrid.rows, hasBounds: !!waveGrid.bounds, hasGeoJSON: !!activeGeoJSON});
  
  let newWaveData;
  try {
    newWaveData = encodeMarineTexture(gl, waveGrid, activeGeoJSON, this);
  } catch (err) {
    console.error('[WebGLMarineEngine] encodeMarineTexture threw an error:', err);
    this.clearBuffers(gl);
    throw err;
  }

  if (newWaveData) {
    newWaveData.truthTag = waveGrid.truthTag;
    newWaveData.waveGrid = waveGrid;
  }

  const oldWaveData = this._waveData;
  this._waveData = newWaveData;

  // Compare old grid dimensions/bounds to check if they shifted
  const oldGrid = oldWaveData?.waveGrid;
  const boundsChanged = !oldGrid || !oldGrid.bounds || !waveGrid.bounds ||
    waveGrid.bounds.west !== oldGrid.bounds.west ||
    waveGrid.bounds.south !== oldGrid.bounds.south ||
    waveGrid.bounds.east !== oldGrid.bounds.east ||
    waveGrid.bounds.north !== oldGrid.bounds.north;
  const dimsChanged = !oldGrid ||
    waveGrid.cols !== oldGrid.cols ||
    waveGrid.rows !== oldGrid.rows;

  if (boundsChanged || dimsChanged) {
    // Phase 1.3: record reset reason + source product so real product changes can be
    // distinguished from redundant commits before optimizing. Diagnostics only.
    if (typeof window !== 'undefined') {
      const reason = (boundsChanged && dimsChanged) ? 'both' : boundsChanged ? 'bounds' : 'dimensions';
      const rd = window.__MARINE_GPU_RESET__ || (window.__MARINE_GPU_RESET__ = { counts: {}, log: [] });
      rd.counts[reason] = (rd.counts[reason] || 0) + 1;
      rd.log.unshift({
        reason,
        oldCols: oldGrid?.cols, newCols: waveGrid.cols,
        oldRows: oldGrid?.rows, newRows: waveGrid.rows,
        productId: waveGrid.productId || waveGrid.__productId || null,
        timestamp: new Date().toISOString()
      });
      if (rd.log.length > 40) rd.log.pop();
    }
    // PARTICLE CARRY (2026-07-06 Part 9 ②; DEFAULT ON since 2026-07-13, round-12 §2b): carrying
    // evolved positions through a grid swap kills the "crests clear then rebuild from the bottom"
    // blink (positions are TILE/MERCATOR-space, geographically valid across the swap). The 07-06
    // land-sitting regression that kept this opt-in no longer reproduces at HEAD (live-retested on
    // the deployed engine across zoom-out/zoom-in/pan swaps — see shouldCarryParticlesOnGridSwap).
    // Kill switch: __RAW_DISABLE_PARTICLE_CARRY__ = true → this reseed branch.
    // Telemetry: __MARINE_PARTICLE_CARRY__ {count,lastAt}.
    const _carry = shouldCarryParticlesOnGridSwap(
      typeof window !== 'undefined' ? window : null, !!this.particleStateA, !!this.particleStateB);
    if (!_carry) {
      console.log('[WebGLMarineEngine] Resetting particle state textures due to grid shift/resize:', {
        boundsChanged,
        dimsChanged,
        oldCols: oldGrid?.cols,
        newCols: waveGrid.cols,
        oldRows: oldGrid?.rows,
        newRows: waveGrid.rows
      });
      // Reseed the FIXED-size particle textures in place (texSubImage2D) instead of
      // delete+realloc — eliminates per-switch GPU texture churn during rapid toggling.
      reseedParticleStateInPlace(this, gl);
    } else if (typeof window !== 'undefined') {
      const pc = window.__MARINE_PARTICLE_CARRY__ = window.__MARINE_PARTICLE_CARRY__ || { count: 0 };
      pc.count++; pc.lastAt = new Date().toISOString();
    }
  }

  if (oldWaveData) {
    try {
      if (oldWaveData.u_waveTexture && oldWaveData.u_waveTexture !== this._residentWaveTex && (!newWaveData || oldWaveData.u_waveTexture !== newWaveData.u_waveTexture)) {
        safeDeleteTexture(gl, oldWaveData.u_waveTexture, this);
      }
      if (oldWaveData.u_chlorophyllTexture && oldWaveData.u_chlorophyllTexture !== this._residentChlTex && (!newWaveData || oldWaveData.u_chlorophyllTexture !== newWaveData.u_chlorophyllTexture)) {
        safeDeleteTexture(gl, oldWaveData.u_chlorophyllTexture, this);
      }
      if (oldWaveData.u_bathymetryTexture && oldWaveData.u_bathymetryTexture !== this._residentBathTex && (!newWaveData || oldWaveData.u_bathymetryTexture !== newWaveData.u_bathymetryTexture)) {
        safeDeleteTexture(gl, oldWaveData.u_bathymetryTexture, this);
      }
      
      if (oldWaveData.u_oceanMaskTexture && oldWaveData.u_oceanMaskTexture === this._cachedMaskTex) {
        // Keep it
      } else {
        if (oldWaveData.u_oceanMaskTexture && (!newWaveData || oldWaveData.u_oceanMaskTexture !== newWaveData.u_oceanMaskTexture)) {
          safeDeleteTexture(gl, oldWaveData.u_oceanMaskTexture, this);
        }
      }
    } catch (e) {
      console.warn('[WebGLMarineEngine] Error during safe deletion of old textures:', e);
    }
  }

  // BLEND BOTH: whenever the committed grid is the GLOBAL-COARSE fallback, snapshot it into a standalone,
  // independently-owned texture set (the resident wave/chl/bath textures get reused/realloc'd in place on the
  // next commit, so the old coarse textures can't simply be "retained"). A later regional commit then composites
  // over this faded base instead of reading as a cleared heatmap. Re-encode only when the coarse grid changes.
  try {
    const blendEnabled = (typeof window === 'undefined') || window.__RAW_DISABLE_BLEND_BOTH__ !== true;
    if (blendEnabled && newWaveData && isCoarseGlobalGrid(waveGrid)) {
      const key = coarseBaseKey(waveGrid);
      if (!this._coarseBaseData || this._coarseBaseData.__key !== key) {
        this._captureCoarseBase(gl, waveGrid, key);
      }
    }
  } catch (e) {
    console.warn('[WebGLMarineEngine] coarse-base capture skipped:', e && e.message);
  }

  if (_verbose) console.log('[WebGLMarineEngine] setWaveData result:', {hasData: !!this._waveData, hasWaveTexture: !!this._waveData?.u_waveTexture});

  const model = waveGrid.__sourceModel || 'GFS';
  const layer = waveGrid.__componentLayer || 'waves';
  const hourOffset = waveGrid.hourOffset || 0;

  // §4.2 MOTION-UNLOCK resident stamp: the render passes read this (with the
  // __RAW_RATING_MOTION_UNLOCK__ opt-in) to lift particle land checks to the dataMask.g
  // motion-water channel the encoder writes for rating grids. Non-rating commits stamp false
  // → u_motionUnlock stays 0 → byte-identical legacy behavior.
  this._residentRatingMode = !!waveGrid.ratingMode;

  // Forensic ledger: every ACCEPTED commit with its identity — the ring's spine. Rejects,
  // clears and fade transitions are recorded at their own sites; together one dump() reads
  // as the full lifecycle without console archaeology.
  recordMarineEvent('commit', {
    model, layer, hour: hourOffset,
    dims: `${waveGrid.cols}x${waveGrid.rows}`,
    spanLng: waveGrid.bounds ? +boundsLonSpan(waveGrid.bounds).toFixed(2) : null,
    rating: !!waveGrid.ratingMode,
    fromSeries: !!waveGrid.__fromSeries,
    product: waveGrid.productId || waveGrid.product_id || null,
    scope: waveGrid.coverage_scope || null,
  });

  if (model === 'GFS' && layer === 'waves' && hourOffset === 0) {
    recordTruthStage('webglUpload', {
      model,
      domain: 'marine',
      layer,
      valid_time: waveGrid.valid_time || waveGrid.validTime,
      run_time: waveGrid.run_time || waveGrid.runTime,
      product_id: waveGrid.productId || waveGrid.product_id,
      is_dynamic_viewport_product: waveGrid.is_dynamic_viewport_product,
      coverage_scope: waveGrid.coverage_scope,
      requested_bbox: waveGrid.requested_bbox,
      served_bbox: waveGrid.served_bbox,
      grid: waveGrid,
      truthTag: waveGrid.truthTag
    }, 'WebGLMarineEngine.js', 'setWaveData');
  }
};

WebGLMarineEngine.prototype.renderHeatmapAndParticles = function(gl, matrix, screenWidth, screenHeight, zoom, theme, viewportBounds, opacityMultiplier) {
  let mult = typeof opacityMultiplier === 'number' ? opacityMultiplier : 1.0;   // let: the bridge-promotion realign below may override the layer's stale gate value
  const renderStart = (typeof window !== 'undefined' && window.__RAW_GPU__) ? performance.now() : 0;
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.drawCallsPerFrame = 0;
    window.__RAW_GPU__.particlePassExecuted = false;
  }
  if (!this._initialized || !this._waveData || !matrix || !matrix.length) {
    if (this._renderLogged === undefined) {
      this._renderLogged = 0;
    }
    this._renderLogged++;
    if (this._renderLogged === 1 || this._renderLogged % 180 === 0) {
      console.log("[WebGLMarineEngine] render returned early! _initialized:", this._initialized, "_waveData:", !!this._waveData, "matrix:", !!matrix);
    }
    return;
  }

  // WORLD-WRAP CULL (perf 2026-07-07, "paint faster on pan/zoom"): the heatmap grid pass and the
  // 525k-vert crest ribbon pass below are each drawn 3× at lng/merc offsets {0, ±1 world} so the
  // field tiles across the antimeridian when the map renders more than one world horizontally. At
  // close zoom mid-globe only ONE world copy is on screen, so the ±offset draws render a whole world
  // OFF-SCREEN — 2 of every 3 draws are wasted vertex work every frame (measured: pan FPS 30→18 at
  // z9). Cull to the main copy unless the viewport can actually see a world edge (low zoom, or near
  // ±180). Render-time only, imperceptible. Kill: __RAW_DISABLE_WRAP_CULL__.
  const _needWrap = (typeof window !== 'undefined' && window.__RAW_DISABLE_WRAP_CULL__ === true)
    || !viewportBounds || viewportBounds.east < viewportBounds.west
    || viewportBounds.west < -170 || viewportBounds.east > 170
    || typeof zoom !== 'number' || zoom < 4;

  // COARSE-BASE SEED consume (2026-07-04, Part 2 of the z7 zoom-out bridge): a cold coast never commits a
  // coarse grid, so prewarmGlobalMarineGrid stages the global here — snapshot it into the bridge base NOW,
  // inside the render callback where the GL context is valid (never from the prewarm's detached Promise).
  // MODEL-SWITCH STALENESS (2026-07-15, ICON "no heatmap under the crests"): a base for ANOTHER
  // model/layer no longer blocks the consume — the stale base is REPLACED (_captureCoarseBase frees it
  // first) so blend-both re-engages for the new model without waiting for an organic world commit.
  // A base already matching the seed's identity means an organic commit beat the seed here — the seed
  // is DISCARDED (the old gate left it pending forever, which then blocked every future staging).
  if (this._pendingCoarseBaseGrid) {
    const _seed = this._pendingCoarseBaseGrid;
    const _b = this._coarseBaseData;
    const _stale = !_b ||
      (_b.__sourceModel || 'GFS') !== (_seed.__sourceModel || 'GFS') ||
      (_b.__componentLayer || 'waves') !== (_seed.__componentLayer || 'waves');
    this._pendingCoarseBaseGrid = null;
    if (_stale) {
      try {
        if (isCoarseGlobalGrid(_seed)) this._captureCoarseBase(gl, _seed, coarseBaseKey(_seed));
      } catch (e) { /* best-effort seed — the live zoom-out fetch still commits the global */ }
    }
  }

  if (window.__WEATHER_DEBUG_ISOLATE_OVERLAY__ === true) {
    gl.clearColor(0.05, 0.05, 0.08, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  let waveGrid = this._waveData?.waveGrid;   // let: re-captured after the mid-frame swaps below
  if (waveGrid) {
    const model = waveGrid.__sourceModel || 'GFS';
    const layer = waveGrid.__componentLayer || 'waves';
    const hourOffset = waveGrid.hourOffset || 0;

    if (model === 'GFS' && layer === 'waves' && hourOffset === 0) {
      recordTruthStage('webglRender', {
        model,
        domain: 'marine',
        layer,
        valid_time: waveGrid.valid_time || waveGrid.validTime,
        run_time: waveGrid.run_time || waveGrid.runTime,
        product_id: waveGrid.productId || waveGrid.product_id,
        is_dynamic_viewport_product: waveGrid.is_dynamic_viewport_product,
        coverage_scope: waveGrid.coverage_scope,
        requested_bbox: waveGrid.requested_bbox,
        served_bbox: waveGrid.served_bbox,
        grid: waveGrid,
        truthTag: this._waveData.truthTag
      }, 'WebGLMarineEngine.js', 'renderHeatmapAndParticles');

      recordTruthStage('animationFrame', {
        model,
        domain: 'marine',
        layer,
        valid_time: waveGrid.valid_time || waveGrid.validTime,
        run_time: waveGrid.run_time || waveGrid.runTime,
        product_id: waveGrid.productId || waveGrid.product_id,
        is_dynamic_viewport_product: waveGrid.is_dynamic_viewport_product,
        coverage_scope: waveGrid.coverage_scope,
        requested_bbox: waveGrid.requested_bbox,
        served_bbox: waveGrid.served_bbox,
        grid: waveGrid,
        truthTag: this._waveData.truthTag
      }, 'WebGLMarineEngine.js', 'renderHeatmapAndParticles');
    }
  }

  var themeVal = 0.0;
  if (typeof window !== 'undefined' && window.__DIAGNOSTIC_THEME__ !== undefined) {
    themeVal = window.__DIAGNOSTIC_THEME__;
  } else if (theme === 'light') {
    themeVal = 1.0;
  } else if (theme === 'beach') {
    themeVal = 2.0;
  }

  const webglState = captureWebGLState(gl);
  try {
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.blendEquation(gl.FUNC_ADD);

    if (window.__WEATHER_DEBUG_ISOLATE_OVERLAY__ === true) {
      gl.clearColor(0.05, 0.05, 0.08, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // Unbind only the texture units we actually use (0 to 3) to prevent feedback loops (non-blocking)
    for (let u = 0; u < 4; u++) {
      bindTexture(gl, null, u);
    }

    if (webglState.isWebGL2) {
      gl.bindVertexArray(null);
    }

    var mat4 = matrix instanceof Float32Array ? matrix : new Float32Array(matrix);
    var time = (Date.now() - this._startTime) / 1000.0;
    let waveBounds = this._waveData.bounds;   // let: re-captured after the mid-frame swaps below
    const z = typeof zoom === 'number' ? zoom : 6;

    // v3.22: Compute camera center and tile origin for high-precision advection
    var vb = viewportBounds || [-180, -80, 180, 85];
    this._lastViewportBounds = vb;   // snapshot for the no-downgrade guard's coverage check in setWaveData
    var centerLng = (vb[0] + vb[2]) * 0.5;
    if (vb[2] < vb[0]) {
      centerLng = (vb[0] + vb[2] + 360) * 0.5;
      if (centerLng > 180) centerLng -= 360;
    }
    var centerLat = (vb[1] + vb[3]) * 0.5;
    var cx = (centerLng + 180.0) / 360.0;
    var cy = latToMercatorY(centerLat);

    // Zoom above which particles use the camera-centered TILE (concentrated → adequate on-screen density). Below
    // it they seed across the whole data domain (global = sparse in any viewport), which caused the dense→sparse
    // CLIFF at z6 when zooming out — and, after the 4.0 lowering, its shadow at z3.02–3.93. Now 3.0: the
    // constant-screen-density solve covers everything down to z3 (at z3.x the tile is HALF the world → pans
    // basically never re-anchor), while below z3 the legacy globe-thinning curve stays deliberate. Live-verified
    // 2026-07-02: solve holds 1650 across z3.0–4.0 (densityBase 0.15–0.53), one reinit per 3.0 crossing, none
    // while panning in-band. Tunable via window.__RAW_TILE_ZOOM_MIN__. Must match u_tileZoomMin.
    var tileZoomMin = (typeof window !== 'undefined' && typeof window.__RAW_TILE_ZOOM_MIN__ === 'number') ? window.__RAW_TILE_ZOOM_MIN__ : 3.0;
    var isHighZoom = z > tileZoomMin;
    // THE z4–6 "VORTEX" ROOT (2026-07-02): prevHighZoom kept the OLD hardcoded 6.0 threshold when the
    // density-cliff fix moved isHighZoom onto tileZoomMin (default 4.0). For any zoom stably inside
    // (tileZoomMin, 6.0] the two flags disagreed on EVERY frame → zoomStateChanged stayed true →
    // reinitParticles() ran EVERY FRAME — full-field particle churn exactly in z4–6, the band of every
    // vortex report (z4.02–5.88, 3.9–5.93, 4.13–5.91). Both sides must use the SAME threshold; a
    // per-frame reseed can never be a valid steady state. Telemetry: window.__MARINE_ZOOMSTATE_REINITS__.
    var prevHighZoom = this._lastZoom > tileZoomMin;
    var zoomStateChanged = (this._lastZoom !== undefined && isHighZoom !== prevHighZoom);
    if (zoomStateChanged && typeof window !== 'undefined') {
      window.__MARINE_ZOOMSTATE_REINITS__ = (window.__MARINE_ZOOMSTATE_REINITS__ || 0) + 1;
    }
    this._lastZoom = z;

    // SELF-HEAL a stashed no-downgrade rejection (2026-07-03): re-evaluate with the zoom/viewport we
    // JUST recorded — the guard call inside setWaveData reads these same fields, so acceptance here is
    // authoritative. This releases the wedge where a coarse commit was rejected against a stale zoom
    // and the commit dedup then blocked every retry (stranded 3° regional at band zoom, live repro ×2).
    // Captured BEFORE the two in-frame resident swaps below (self-heal accept + zoom-out bridge):
    // the layer computed this frame's `mult` for THIS resident — if either swap replaces it, that
    // gate verdict is stale for the painted frame (see MULT REALIGN below).
    const _residentBeforeSwaps = this._waveData && this._waveData.waveGrid;
    if (this._pendingDowngrade) {
      const _pd = this._pendingDowngrade;
      const _pdDisabled = typeof window !== 'undefined' && !!window.__RAW_DISABLE_NO_DOWNGRADE__;
      // COMBINED predicate — must mirror the setWaveData choke point exactly, or a grid stashed by
      // the subcover clause would insta-accept here and bounce anyway.
      if (!shouldRejectResolutionDowngrade(this._waveData && this._waveData.waveGrid, _pd, z, vb, _pdDisabled) &&
          !shouldRejectSubcoveringRegional(this._waveData && this._waveData.waveGrid, _pd, z, vb, _pdDisabled,
            typeof window !== 'undefined' ? window : undefined)) {
        this._pendingDowngrade = null;
        if (typeof window !== 'undefined') {
          const nd = window.__MARINE_NO_DOWNGRADE__ || (window.__MARINE_NO_DOWNGRADE__ = { count: 0 });
          nd.selfHealed = (nd.selfHealed || 0) + 1;
        }
        console.log(`[WebGLMarineEngine] No-downgrade self-heal: stashed ${_pd.cols}×${_pd.rows} grid accepted at zoom ${z.toFixed(1)}.`);
        recordMarineEvent('selfheal_accept', { dims: `${_pd.cols}x${_pd.rows}`, zoom: +z.toFixed(2), rating: !!_pd.ratingMode });
        // ESCAPED-MASK RECIPE ON THE SELF-HEAL DOOR TOO (2026-07-16 Playwright frame trace: the
        // accept of a stashed WORLD grid painted ONE lavender land-flooded frame — the encoder's
        // retain_res_no_downgrade kept the 170 px/° REGIONAL mask under the world grid, so
        // everything outside its box CLAMP_TO_EDGE'd water over land until the next rebuild).
        // The zoom-out bridge already disarms the retain guards for exactly this geometry
        // (64bd1ff6); a stashed grid WIDER than the cached mask needs the same disarm. Same kill
        // as the escape rebuild: __RAW_DISABLE_ESCAPED_MASK_REBUILD__.
        if (isCoarseGlobalGrid(_pd) &&
            !(typeof window !== 'undefined' && window.__RAW_DISABLE_ESCAPED_MASK_REBUILD__ === true)) {
          this._maskSourceReady = true;
          this._maskRetainPatchedOk = false;
        }
        this.setWaveData(gl, _pd, null);
      }
    }

    // ZOOM-OUT BRIDGE (see bridgeToCoarseGlobalIfHeld): when no pending downgrade exists but the
    // regional resident has stopped covering a wide viewport (fast zoom-out with no fresh global
    // commit yet), promote the retained coarse-global grid so it never floats as a blocky
    // rectangle or clears to blank. No-op unless a coarse base is held and coverage actually
    // dropped; runs once (resident becomes coarse-global).
    if (this._coarseBaseData && this._coarseBaseData.waveGrid && !this._pendingDowngrade) {
      this.bridgeToCoarseGlobalIfHeld(gl);
    }

    // MID-FRAME RESIDENT-SWAP MULT REALIGN (2026-07-16, Playwright real-wheel frame traces: every
    // in-frame swap painted ONE near-bare-basemap frame — L201→220→169, hm=0/mult=0 on the flash):
    // the layer computed this frame's opacity gate for the OLD sub-covering regional (reject path →
    // mult 0 coarse-bridge hold) BEFORE the self-heal accept or the zoom-out bridge above swapped
    // the resident — so the freshly-committed grid painted at the stale mult=0. Both swap doors hit
    // it (run 1: the bridge; run 2: the self-heal accepting the stashed world grid). If the NEW
    // resident covers the viewport (≥ the shared cover-frac — the gate's own next-frame verdict),
    // paint it at full mult NOW and clear the layer's coarse-bridge hold (it described the old
    // regional). Kill: __RAW_DISABLE_BRIDGE_MULT_REALIGN__. Telemetry: __RAW_GPU__.bridgeMultRealign.
    {
      const _nowResident = this._waveData && this._waveData.waveGrid;
      const _realignOff = typeof window !== 'undefined' && window.__RAW_DISABLE_BRIDGE_MULT_REALIGN__ === true;
      let _realigned = false;
      if (!_realignOff && mult < 1.0 && _nowResident && _nowResident !== _residentBeforeSwaps) {
        let _covers = isCoarseGlobalGrid(_nowResident);
        if (!_covers && _nowResident.bounds && vb) {
          const _nb = _nowResident.bounds;
          const _vpA = Math.max(1e-9, (vb[2] - vb[0]) * (vb[3] - vb[1]));
          const _ix = Math.max(0, Math.min(_nb.east, vb[2]) - Math.max(_nb.west, vb[0]));
          const _iy = Math.max(0, Math.min(_nb.north, vb[3]) - Math.max(_nb.south, vb[1]));
          const _minFrac = (typeof window !== 'undefined' && Number(window.__RAW_DOWNGRADE_COVER_FRAC__)) || 0.6;
          _covers = ((_ix * _iy) / _vpA) >= _minFrac;
        }
        if (_covers) {
          mult = 1.0;
          this.__coarseBridgeActive = false;
          _realigned = true;
        }
      }
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.bridgeMultRealign = _realigned;
      }
    }

    // MID-FRAME SWAP RE-CAPTURE (2026-07-16, the residual pale flash — Playwright frame trace,
    // two byte-identical-state frames painting 50 L apart): waveGrid/waveBounds were captured at
    // the top of this function, BEFORE the self-heal accept / zoom-out bridge above could replace
    // the resident — so a swap frame painted the NEW world texture stretched over the OLD regional
    // u_dataBounds (CLAMP_TO_EDGE smear over the rest of the viewport: the pale lavender frame).
    // Re-derive both so this frame paints the resident with its own geometry.
    waveGrid = this._waveData?.waveGrid;
    waveBounds = this._waveData.bounds;

    // === COARSE-GLOBAL CREST SUPPRESSION — the real vortex fix (default ON) ===
    // The "clockwise spin" is NOT merely a bilinear-interpolation artifact: the coarse-GLOBAL 37×17 grid's direction
    // field is GENUINELY ROTATIONAL at regional magnification (measured curl 1.769 across ocean basins). A partial
    // coherence-floor cull removes only the cell-BOUNDARY particles (low interpolated magnitude) but KEEPS the
    // cell-CENTER particles (magnitude ≈1), and those still advect the divergent per-cell headings → the field
    // still rotates → vortex persists at ANY floor <1 (confirmed: 0.7 didn't kill it, z4.02–5.88). The honest fix is
    // to NOT animate crests on a coarse-global grid once it's magnified past a global view: the heatmap already
    // conveys wave height, and the coarse direction is not meaningful for per-crest animation there. We force the
    // discard floor ABOVE the max unit magnitude (>1 → discards EVERY crest) whenever a coarse-global grid is the
    // resident advection source and z>3.5. Regional/fine grids are untouched (crests stream normally). Heatmap pass
    // is unaffected. Kill: window.__RAW_DISABLE_COARSE_CREST_SUPPRESS__=true. Tune (partial cull instead of full
    // suppress): window.__RAW_DIR_COHERENCE_MIN__ = <0..1>. Echo: __RAW_GPU__.anim.dirCoherenceMin (2 = suppressed).
    const _residentCoarseGlobal = isCoarseGlobalGrid(this._waveData && this._waveData.waveGrid);
    // The vortex band: a coarse ~10°/cell grid shows 1-2 whole cells on screen so the divergent per-cell
    // headings rotate across the viewport (empirically z4.02–5.88). ABOVE ~z7 you are inside a single coarse
    // cell (near-uniform direction, no vortex) and BELOW ~z3.5 you see many cells (a global field, no
    // per-cell swirl). In the band, resolveCoarseCrestControls picks the crest strategy — default 'nearest'
    // (cell-center direction sampling: crests animate, no swirl); 'suppress' = the 2026-07-01 full discard.
    // MAGNIFICATION-KEYED GATE (2026-07-13, the Canaveral "low-pressure center" report): the
    // legacy predicate (coarse-GLOBAL only + empirical z3.5–7 band) missed MID-tier 2°/cell
    // grids magnified at z7–9.3, which bilinear-swirl exactly like the world grid did. Key on
    // px-per-cell instead (see isMagnifiedCoarseField — 80 px preserves the legacy onset by
    // construction). Kill __RAW_VORTEX_MAG_GATE_DISABLED__ restores the legacy band verbatim.
    const _wgCellDeg = gridCellDeg(this._waveData && this._waveData.waveGrid);
    const _magGate = isMagnifiedCoarseField(_wgCellDeg, z, typeof window !== 'undefined' ? window : null);
    const _inVortexBand = (_magGate === null)
      ? (_residentCoarseGlobal && z > COARSE_CREST_BAND_MIN_ZOOM && z <= MARINE_ZOOMED_OUT_MAX_ZOOM)
      : _magGate;
    const _ccc = resolveCoarseCrestControls(_inVortexBand, typeof window !== 'undefined' ? window : null);
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.vortexGate = {
        cellDeg: _wgCellDeg, zoom: +z.toFixed(2), engaged: _inVortexBand, mode: _ccc.mode,
        legacy: _magGate === null,
      };
    }
    let dirCoherenceMin = _ccc.dirCoherenceMin;
    // COARSE-GLOBAL CLOSE-ZOOM crest suppression (2026-07-04, "waves over Venice z7.67-22, fixes
    // itself on zoom-out"): above the vortex band the old logic re-ENABLED crests on a coarse
    // WORLD grid, assuming a single near-uniform cell — but the world grid's 1024x512 land mask
    // (~39 km/texel) cannot resolve ANY coastline, so during the sharpen window (seconds warm,
    // minutes on a cold backend) crests race over cities and inland water.
    // OVERLAY-AWARE RELAXATION (2026-07-04 round 4): when the viewport-truth overlay mask COVERS
    // the current viewport, land is clipped at meter truth even on the world grid — crests behave
    // NORMALLY in the sharpen window (the suppressed dim/slow crests read as "broken animation",
    // live report at z17). Suppression remains only while the viewport is NOT overlay-covered
    // (stale overlay right after a pan, below the refresh cutoff, or painting unavailable) —
    // exactly where the 39 km mask is the only land guard.
    // Kill switch: the existing __RAW_DISABLE_COARSE_CREST_SUPPRESS__.
    const _ovb = this._overlayMaskBounds;
    const _overlayCoversViewport = !!(this._overlayMaskTex && _ovb &&
      _ovb.west <= vb[0] && _ovb.east >= vb[2] && _ovb.south <= vb[1] && _ovb.north >= vb[3]);
    // INTERSECTS is the fade guard's bar (not CONTAINS): every pan breaks containment for a beat
    // until the moveend repaint, and a contains-keyed fade blanked the whole wash per gesture
    // ("heatmaps clearing at z13", live). While the overlay still OVERLAPS the view, uncovered
    // pixels fall back per-pixel to the base mask — open water renders fine; only a brief
    // near-land edge bleed rides the repaint latency. Full fade is reserved for NO overlay at all
    // (boot) or a teleport whose old overlay doesn't even touch the view.
    const _overlayIntersectsViewport = !!(this._overlayMaskTex && _ovb &&
      _ovb.west < vb[2] && _ovb.east > vb[0] && _ovb.south < vb[3] && _ovb.north > vb[1]);
    // DIRECTION-TRUTH TIGHTENING (2026-07-14, user: "faint waves run the WRONG WAY away from
    // the FL coast for 3-4 s when EURO first activates, until the heatmap fixes itself"): the
    // overlay relaxation above was for the 07-04 era's MINUTES-long cold sharpen windows where
    // full suppression read as "broken animation". Today the sharpen lands in seconds
    // (checkpointed lanes + series), and the relaxation's cost is CONFIDENTLY-WRONG crest
    // directions — a coarse world cell's block-mean heading at close zoom. Honest suppression
    // beats confident wrongness for a seconds-long window: suppress crests on a coarse-GLOBAL
    // resident at z ≥ 7 regardless of overlay coverage (the heatmap still paints; crests appear
    // with the honest regional commit). Tune: __RAW_COARSE_SUPPRESS_MIN_ZOOM__ (default 7.0).
    // Kill: the existing __RAW_DISABLE_COARSE_CREST_SUPPRESS__.
    const _coarseSuppressZ = (typeof window !== 'undefined' && Number.isFinite(+window.__RAW_COARSE_SUPPRESS_MIN_ZOOM__))
      ? +window.__RAW_COARSE_SUPPRESS_MIN_ZOOM__ : 7.0;
    if (_residentCoarseGlobal && z >= _coarseSuppressZ &&
        !(typeof window !== 'undefined' && window.__RAW_DISABLE_COARSE_CREST_SUPPRESS__ === true)) {
      dirCoherenceMin = 2.0; // > max unit magnitude -> every crest discards (the proven suppress path)
    }
    const coarseNearestDir = _ccc.coarseNearestDir;
    const _wgCols = (this._waveData.waveGrid && this._waveData.waveGrid.cols) || 2;
    const _wgRows = (this._waveData.waveGrid && this._waveData.waveGrid.rows) || 2;

    var tileOriginX = 0.0;
    var tileOriginY = 0.0;
    var tileWidth = 1.0;

    if (isHighZoom) {
      // v3.23: Use -3 instead of -5 so the tile is 8x larger than the screen instead of 32x.
      // The tile is the particle-advection domain; only ~(screen/tile)² of particles land on screen, so the bigger
      // the tile, the fewer usable on-screen crests (and the deeper the per-zoom density sawtooth). Backoff is the
      // root density-headroom lever: 3 = 8×screen (default, max pan-stability); 2 = 4×screen (4× more on-screen
      // crests, slightly more reseed-on-pan). Default-neutral; tune live via window.__RAW_TILE_BACKOFF__.
      var _tileBackoff = (typeof window !== 'undefined' && typeof window.__RAW_TILE_BACKOFF__ === 'number') ? window.__RAW_TILE_BACKOFF__ : 2;
      var tileZoom = Math.max(0, Math.floor(z) - _tileBackoff);
      tileWidth = 1.0 / Math.pow(2.0, tileZoom);

      // §7i tile≥viewport clamp — see clampTileToViewport. Runs BEFORE the change detection so
      // a clamp crossing reinitializes particles exactly like any other tile-width step.
      if (!(typeof window !== 'undefined' && window.__RAW_DISABLE_TILE_VP_CLAMP__ === true)) {
        var _vpLonSpan = (vb[2] < vb[0]) ? (vb[2] + 360 - vb[0]) : (vb[2] - vb[0]);
        var _vpMercW = Math.min(1.0, Math.max(0, _vpLonSpan) / 360.0);
        var _vpMercH = Math.abs(latToMercatorY(vb[3]) - latToMercatorY(vb[1]));
        var _tc = clampTileToViewport(tileZoom, tileWidth, _vpMercW, _vpMercH);
        tileZoom = _tc.tileZoom;
        tileWidth = _tc.tileWidth;
        if (typeof window !== 'undefined' && window.__RAW_GPU__) {
          window.__RAW_GPU__.tileCover = { tileWidth: +tileWidth.toFixed(4), vpW: +_vpMercW.toFixed(4), vpH: +_vpMercH.toFixed(4), clamped: _tc.clamped };
        }
      }

      var tileWidthChanged = (this._lastTileWidth !== undefined && tileWidth !== this._lastTileWidth);
      this._lastTileWidth = tileWidth;

      // Initialize or drift check
      if (this._tileCenterX === undefined || this._tileCenterY === undefined || tileWidthChanged) {
        this._tileCenterX = cx;
        this._tileCenterY = cy;
        this.reinitParticles(gl);
      } else {
        var dx = cx - this._tileCenterX;
        var dy = cy - this._tileCenterY;
        if (Math.abs(dx) > tileWidth * 0.25 || Math.abs(dy) > tileWidth * 0.25) {
          this._tileCenterX = cx;
          this._tileCenterY = cy;
          this.reinitParticles(gl);
        }
      }
      tileOriginX = this._tileCenterX - tileWidth * 0.5;
      tileOriginY = this._tileCenterY - tileWidth * 0.5;
    } else {
      this._tileCenterX = undefined;
      this._tileCenterY = undefined;
      this._lastTileWidth = undefined;
    }

    if (zoomStateChanged) {
      this.reinitParticles(gl);
    }

    const smoothstepVal = (edge0, edge1, x) => {
      const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
      return t * t * (3.0 - 2.0 * t);
    };
    // v7.0: Slow animation motion speed smoothly by 25% at lower/far zoom without changing animation type
    const zoomFactor = z < 6.0 ? (0.75 + 0.25 * smoothstepVal(3.0, 6.0, z)) : 1.0;
    const motionScale = (0.75 + 0.25 * smoothstepVal(4.0, 7.0, z)) * zoomFactor;
    this.motionScale = motionScale;

    // BLEND BOTH: engage when the active grid is a REGIONAL tile and we retained a same-model/same-layer
    // global-coarse base. The coarse wash is drawn first (faded), then the regional on top with height-based
    // alpha so faint/near-zero regional cells let the wash show through — GFS's accurate-but-faint regional
    // swap then never reads as a "cleared" heatmap. Non-rating only (the rating band has its own coarse-fade
    // exemption). Kill switch: window.__RAW_DISABLE_BLEND_BOTH__ = true.
    const _gridForBlend = this._waveData && this._waveData.waveGrid;
    let blendEngaged = false;
    // RATING-BAND ZOOM-OUT CROSS-FADE result (see resolveRatingBandFade): bandMult multiplies the
    // main pass opacity below (only while it paints rating colors); washStrength replaces the
    // dimmed blend-base factor so the honest wash rises as the band fades.
    let _ratingBandFade = { bandMult: 1.0, washStrength: null, fade: 1.0 };
    {
      const blendEnabled = (typeof window === 'undefined') || window.__RAW_DISABLE_BLEND_BOTH__ !== true;
      const cg = this._coarseBaseData;
      const isRating = !!(_gridForBlend && _gridForBlend.ratingMode);
      // RATING-MODE WASH (2026-07-12, user: pan in rating mode shows a CLEARED heatmap; open
      // ocean should fade to the regular heatmap): the original composite scoped itself
      // non-rating-only (db363a14 design choice, no regression history). In rating mode the
      // band's open-ocean cells are MASKED transparent, so without the wash every pan/zoom
      // reveal reads as blank. Let the coarse waves wash draw under the band: coastal cells
      // show rating colors, masked ocean shows the familiar height wash through the holes —
      // the requested coast-band + open-ocean-heatmap hybrid, with the existing zoom damps.
      // Kill: __RAW_RATING_BLEND_WASH_DISABLED__ (restores the non-rating-only composite).
      const ratingWashOk = (typeof window === 'undefined') || window.__RAW_RATING_BLEND_WASH_DISABLED__ !== true;
      const curModel = (_gridForBlend && _gridForBlend.__sourceModel) || 'GFS';
      const curLayer = (_gridForBlend && _gridForBlend.__componentLayer) || 'waves';
      if (blendEnabled && (!isRating || ratingWashOk) && cg && cg.u_waveTexture &&
          isRegionalBounds(this._waveData.bounds) &&
          cg.__sourceModel === curModel && cg.__componentLayer === curLayer &&
          window.__WEATHER_DEBUG_ISOLATE_OVERLAY__ !== true) {
        blendEngaged = true;
      }
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.blendBoth = {
          engaged: blendEngaged,
          haveCoarseBase: !!(cg && cg.u_waveTexture),
          baseModel: cg && cg.__sourceModel,
          baseLayer: cg && cg.__componentLayer,
          curModel, curLayer,
          curRegional: isRegionalBounds(this._waveData.bounds),
          isRating
        };
      }
      // The fade only engages while the band is actually painting: rating grid AND the surf flag on
      // (the same inline flag read as the Option-A gate below — kept inline to avoid an import cycle).
      let _surfFlagOn = false;
      try {
        _surfFlagOn = (typeof window !== 'undefined') && ((window.__SURF_MODE__ !== undefined)
          ? !!window.__SURF_MODE__
          : !!(window.localStorage && window.localStorage.getItem('__SURF_MODE__') === 'true'));
      } catch (e) { _surfFlagOn = false; }
      // FAIL OPEN on an unknown viewport (same lesson as the guard's unknown-zoom rule): vb defaults
      // to WORLD bounds when viewportBounds is missing, which would read as span 360 → band killed.
      const _vpSpanForFade = viewportBounds
        ? ((viewportBounds[2] < viewportBounds[0])
            ? (viewportBounds[2] + 360 - viewportBounds[0])
            : (viewportBounds[2] - viewportBounds[0]))
        : null;
      _ratingBandFade = resolveRatingBandFade(
        _vpSpanForFade, isRating && _surfFlagOn, blendEngaged,
        (typeof window !== 'undefined') ? window : undefined);
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.ratingBandFade = {
          span: _vpSpanForFade, washEngaged: blendEngaged,
          fade: _ratingBandFade.fade, bandMult: _ratingBandFade.bandMult,
          washStrength: _ratingBandFade.washStrength,
        };
      }
      // Forensic: record fade TRANSITIONS only (decile buckets), never per-frame — the ring must
      // hold minutes of session, not milliseconds of one gesture.
      const _fadeBucket = Math.round(_ratingBandFade.fade * 10);
      if (this._lastFadeBucket !== _fadeBucket) {
        this._lastFadeBucket = _fadeBucket;
        recordMarineEvent('band_fade', {
          span: (typeof _vpSpanForFade === 'number') ? +_vpSpanForFade.toFixed(2) : null,
          fade: +_ratingBandFade.fade.toFixed(2), washEngaged: blendEngaged,
        });
      }
    }
    // CREST RING-FILL (2026-07-16 queue #1): decide once per frame; the SAME flag feeds the draw
    // AND advect passes below (advected positions and drawn crests must share field semantics
    // beyond the resident grid edge, or crests die where particles advect and vice versa — the
    // §4.2 motion-unlock parity lesson). Kill: __RAW_DISABLE_CREST_RINGFILL__.
    // Telemetry: __RAW_GPU__.crestRingFill.
    if (this._maxVertexTexUnits === undefined) {
      try { this._maxVertexTexUnits = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS); }
      catch (e) { this._maxVertexTexUnits = 0; }
    }
    const _ringFill = resolveCrestRingFill({
      killed: (typeof window !== 'undefined' && window.__RAW_DISABLE_CREST_RINGFILL__ === true),
      blendEngaged,
      base: this._coarseBaseData,
      maxVertexTextures: this._maxVertexTexUnits,
    });
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.crestRingFill = _ringFill;
    }
    // Fallback-bind sources when ring-fill is off (samplers must always be complete; the shader
    // never reads them at u_ringFillEnabled=0 — the u_shoalFoam/u_bathTexture pattern).
    const _rfBase = _ringFill.enabled ? this._coarseBaseData : null;
    const _rfB = (_rfBase && _rfBase.bounds) || { west: 0, south: 0, east: 0, north: 0 };
    const _blendBaseWash = (typeof window !== 'undefined' && typeof window.__RAW_BLEND_BASE_WASH__ === 'number')
      ? window.__RAW_BLEND_BASE_WASH__ : 0.72;
    // Close-zoom damp (2026-07-04, Long Beach land-bleed report): the coarse base is the WORLD grid
    // whose land-mask canvas is 1024x512 (~39 km/texel) — at harbor zooms the wash paints softly over
    // land/waterways no matter how good the polygons are. The regional tile fully covers the viewport
    // at these zooms, so the wash adds nothing there — damp it across z8→9.5. FLOOR 0.35, never 0
    // (live 2026-07-04 zoom-out report): during a zoom-out the ring revealed beyond the regional
    // tile has ONLY this wash to show — a zero damp blanked it ("the heatmap cleared, then came
    // back") until z<8 restored it. Dim reads as loading; blank reads as a bug — the same lesson
    // as the coarse-fade 0.7 and no-truth 0.3 floors.
    const _washZoomDamp = 1.0 - 0.65 * smoothstepVal(8.0, 9.5, z);
    // COARSE-BASE BRIDGE (2026-07-04, the z8.84↔z6.32 zoom-out clear): when the display gate hides a
    // rejected REGIONAL grid at zoomed-out (mult→0; WebGLMarineCustomLayer sets __coarseBridgeActive)
    // but the retained coarse-global base is engaged, the base wash must NOT collapse to 0 — it bridges
    // the ~1s gap until the real global commits at moveend. Gated on blendEngaged so it only floors the
    // opacity when PHASE 0 will actually draw. The regional heatmap (heatmapOpacity*=mult below) and the
    // crests (u_opacity=mult) STAY hidden at mult 0 — no clamped-rectangle regression. Kill switch:
    // __RAW_DISABLE_COARSE_BRIDGE__ (layer-side). Tune: __RAW_COARSE_BRIDGE_OPACITY__ (default 1.0).
    const _bridgeActive = !!this.__coarseBridgeActive && blendEngaged;
    const _baseMult = _bridgeActive
      ? ((typeof window !== 'undefined' && typeof window.__RAW_COARSE_BRIDGE_OPACITY__ === 'number') ? window.__RAW_COARSE_BRIDGE_OPACITY__ : 1.0)
      : mult;
    // COVERING-RESIDENT GATE (2026-07-06, "shadow underneath the coastal edge" — A/B-proven on the
    // Florida panhandle: wash OFF = clean coast, wash ON = dark halo): when the resident regional
    // COVERS the viewport (the no-downgrade guard's own ≥0.8 predicate, shared lever
    // __RAW_DOWNGRADE_COVER_FRAC__) and the bridge is idle, the base wash is fully occluded except
    // where near-coast fades are translucent — i.e. its ONLY visible contribution is the dark
    // coastal halo (the 10°/cell base block-means low near land). Gate it to zero there. Ring-fill
    // (coverage < 0.8) and the zoom-out bridge keep the wash — the "never blank the revealed ring"
    // floor lesson still holds on those paths. Kill: __RAW_DISABLE_BASE_COVER_GATE__.
    // Telemetry: __RAW_GPU__.baseWashGated.
    // 2026-07-06 SAME NIGHT DEMOTION → OPT-IN ONLY (__RAW_ENABLE_BASE_COVER_GATE__): live regression
    // "colored heatmap clears leaving just the animations" — the wash under a covering regional is
    // NOT merely occluded: the blend DESIGN shows it through faint low-height regional cells (the
    // Gulf!) so an accurate-but-faint regional never reads as cleared. Gating on coverage killed
    // that. The real coastal-shadow fix is clipping the phase-0 wash with the RESIDENT crisp mask
    // (the shadow is the base's own 39 km mask edge, not base values) — see the coastal-shadow item.
    let _baseCoverGated = false;
    if (blendEngaged && !_bridgeActive &&
        (typeof window !== 'undefined' && window.__RAW_ENABLE_BASE_COVER_GATE__ === true)) {
      const _rb = this._waveData.bounds;
      if (_rb && vb) {
        const _vpArea = Math.max(1e-9, (vb[2] - vb[0]) * (vb[3] - vb[1]));
        const _ix = Math.max(0, Math.min(_rb.east, vb[2]) - Math.max(_rb.west, vb[0]));
        const _iy = Math.max(0, Math.min(_rb.north, vb[3]) - Math.max(_rb.south, vb[1]));
        const _minFrac = (typeof window !== 'undefined' && Number(window.__RAW_DOWNGRADE_COVER_FRAC__)) || 0.8;
        _baseCoverGated = ((_ix * _iy) / _vpArea) >= _minFrac;
      }
    }
    // In rating mode the cross-fade LIFTS the wash toward full strength as the band fades
    // (washStrength ⊇ the __RAW_BLEND_BASE_WASH__ lever); null = non-rating frame, keep the default.
    const _blendBaseWashEff = (_ratingBandFade.washStrength !== null) ? _ratingBandFade.washStrength : _blendBaseWash;
    let baseWashOpacity = _baseCoverGated ? 0.0 : heatmapZoomOpacity(z) * _baseMult * _blendBaseWashEff * _washZoomDamp;
    // HALO DAMP (2026-07-07, "band halo glitching as it works to cover up the bands"): while the
    // RESIDENT mask is world-tier (<32 px/° — it cannot render a crisp coastline), the wash's
    // soft mask edge IS the visible halo band, and every heal step (retain → mid rebuild →
    // patched → fine) pulses it. Quiet the wash to 35% for exactly that window; the moment a
    // denser mask lands the full wash returns. Render-time multiplier only.
    // ZOOM GATE = TEXEL VISIBILITY, not a magic number (2026-07-07 refinement, user-caught at
    // the boundary: damped/clean at z6.36, halo back at z5.49 under the old z≥6 gate): the
    // world mask's ~0.088° texels exceed ~1.3 screen px above z≈4.4 (360/(256·2^z) °/px) —
    // that is where the soft edge becomes a visible band, so that is where the damp engages.
    // Below it the softness is sub-pixel and the full wash is correct.
    // Kill: __RAW_DISABLE_HALO_DAMP__. Telemetry: __RAW_GPU__.haloDamp.
    let _haloDamped = false;
    // BAND-WINDOW WASH UN-DAMP (2026-07-16 pt4, user: "strange clearing of just the heatmap and
    // not the animations at ~z5.5, sometimes varies" — 3130-frame factor trace): in rating mode
    // across the band→global span window (~span 9-17°) the cross-fade sets bandMult≈0, so the
    // MAIN heatmap pass is invisible BY DESIGN and this wash is the ONLY ocean field — while the
    // crests keep u_opacity=mult (the §0e anim decouple), so any wash damp reads as "the heatmap
    // cleared but the animations kept going". The ×0.35 halo/no-truth damps took the sole field
    // to ~0.23 effective opacity, flapping with overlay presence (the "sometimes varies": trace
    // caught noTruth true at z5.5/span16.6 and false at z6.3/span9.5 in the same session). When
    // the cross-fade says the wash IS the field (washStrength ≥ 0.8), exempt it from both damps:
    // they exist to hide soft mask edges, but a dimmed SOLE field reads as a cleared heatmap —
    // worse than a faint coastal halo (the house "dim reads as loading" floor lesson, flipped for
    // the sole-content case). Safe now: the pt2/pt3 mask legs guarantee a real carved mask under
    // the wash (live floodPct 0 at z3.5-5.5). Kill: __RAW_DISABLE_BAND_WASH_UNDAMP__.
    // Telemetry: __RAW_GPU__.bandWashUndamp.
    const _bandWashSole = _ratingBandFade.washStrength !== null && _ratingBandFade.washStrength >= 0.8 &&
      !(typeof window !== 'undefined' && window.__RAW_DISABLE_BAND_WASH_UNDAMP__ === true);
    // BRIDGE-SOLE WASH (2026-07-16 flash forensics, Playwright real-wheel trace): while the layer's
    // gate holds the regional dark (__coarseBridgeActive) the wash is the ONLY field on screen —
    // the ×0.35 damps below took it to ~0.17 effective and the "coarse bridge" painted nearly bare
    // basemap (the L220 flash / "cleared for a moment"). Same sole-field rule as the rating band
    // window above: damping the sole field reads as a cleared heatmap, worse than the soft halo the
    // damps exist to hide. Kill: __RAW_DISABLE_BRIDGE_WASH_UNDAMP__.
    const _bridgeWashSole = _bridgeActive &&
      !(typeof window !== 'undefined' && window.__RAW_DISABLE_BRIDGE_WASH_UNDAMP__ === true);
    const _washSole = _bandWashSole || _bridgeWashSole;
    // DAMP VERDICT MOTION-HOLD (2026-07-16 shimmer forensics: the noTruth/halo verdicts FLAPPED
    // across mid-gesture commits — nt0↔nt1 = a ±35% wash-luminance shimmer, the "sometimes
    // varies"): the verdict inputs (cached-mask density/coverage, overlay presence) churn while the
    // mask/overlay pipelines chase the camera. Hold the last verdict while the gesture is live
    // (__MARINE_FETCH_DEBOUNCING__ — the pipeline's own motion signal, cleared at moveend);
    // re-evaluate the moment it settles. A briefly-stale "truthful" verdict shows a soft halo for
    // the gesture tail — the doctrine trade (halo < flap). Texture BINDING stays live truth; only
    // the damp/edge verdicts hold. Kill: __RAW_DISABLE_DAMP_MOTION_HOLD__.
    const _dampHoldOn = !(typeof window !== 'undefined' && window.__RAW_DISABLE_DAMP_MOTION_HOLD__ === true);
    // The hold freezes verdicts against INPUT CHURN — but a GENUINE resident-mask replacement
    // (promotion/self-heal rebuilt it this frame) must re-evaluate immediately: holding the old
    // dense-regional verdict over the fresh 11 px/° world mask painted one soft-edged bright frame
    // (the residual +35 L bump the trace caught after the first hold landed).
    const _maskIdKey = (this._cachedMaskTexDims ? `${this._cachedMaskTexDims.w}x${this._cachedMaskTexDims.h}` : 'none')
      + '|' + (this._cachedMaskBounds ? `${this._cachedMaskBounds.west},${this._cachedMaskBounds.east}` : 'none');
    const _maskChanged = this._lastMaskIdKey !== undefined && this._lastMaskIdKey !== _maskIdKey;
    this._lastMaskIdKey = _maskIdKey;
    const _inMotion = typeof window !== 'undefined' && window.__MARINE_FETCH_DEBOUNCING__ === true
      && !_maskChanged;
    // Shared coarse-mask verdict: drives BOTH the wash damp and the shader's crisp mask edge
    // (u_maskEdgeSharp — the heatmap pass's own soft edge was the halo the damp couldn't touch).
    const _coarseMaskVisibleRaw = z >= 4.4 && this._cachedMaskTexDims && this._cachedMaskBounds &&
      !(typeof window !== 'undefined' && window.__RAW_DISABLE_HALO_DAMP__ === true) &&
      maskDensityPxPerDeg(this._cachedMaskTexDims, this._cachedMaskBounds) < 32;
    const _coarseMaskVisible = (_dampHoldOn && _inMotion && this._lastCoarseMaskVisible !== undefined)
      ? this._lastCoarseMaskVisible : _coarseMaskVisibleRaw;
    if (!_inMotion || this._lastCoarseMaskVisible === undefined) this._lastCoarseMaskVisible = _coarseMaskVisibleRaw;
    this._maskEdgeSharp = _coarseMaskVisible ? 1.0 : 0.0;
    if (baseWashOpacity > 0 && _coarseMaskVisible && !_washSole) {
      baseWashOpacity *= 0.35;
      _haloDamped = true;
    }
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.coarseBridgeActive = _bridgeActive;
      window.__RAW_GPU__.baseWashGated = _baseCoverGated;
      window.__RAW_GPU__.haloDamp = _haloDamped;
      window.__RAW_GPU__.bandWashUndamp = _bandWashSole && baseWashOpacity > 0;
      // Per-frame wash-opacity forensics (2026-07-16 zoom-clear trace): the pre-halo/noTruth value
      // here; the no-truth leg updates .washEff at its own site below. Telemetry only.
      window.__RAW_GPU__.washPreDamp = +baseWashOpacity.toFixed(3);
    }

    // DECOUPLED MASK BOUNDS (2026-07-04): the resident ocean-mask texture may cover different
    // geography than the data grid — refreshMaskWithBasemapWater rebuilds it VIEWPORT-scoped while
    // the WORLD grid is resident at close zoom (the 1024×512 world mask is ~39 km/texel and cannot
    // carve any island — the Pianosa class). Every mask sample in the shaders uses these bounds.
    const maskBounds = (this._cachedMaskBounds && this._waveData.u_oceanMaskTexture === this._cachedMaskTex)
      ? this._cachedMaskBounds : waveBounds;
    // Viewport-truth OVERLAY mask (refreshViewportOverlayMask): shaders consult it only inside
    // its bounds; per-pixel fallback makes a stale overlay harmless. Two regimes:
    //  - WIDE (world) grid: overlay REPLACES the base sample (the 39 km base is too coarse to
    //    trust anywhere near a coast).
    //  - REGIONAL grid at deep zoom: overlay min()-COMBINES with the base (base is already
    //    truthful incl. the sheltered-water verdict; the crisp overlay only ever removes wash —
    //    the 27 m regional texels haloed over waterfront roads past ~z12).
    const _gwSpan = (waveBounds.east < waveBounds.west) ? (waveBounds.east + 360) - waveBounds.west : waveBounds.east - waveBounds.west;
    const _ovSpan = this._overlayMaskBounds ? (this._overlayMaskBounds.east - this._overlayMaskBounds.west) : 0;
    // Does the BASE mask actually cover the current viewport? (2026-07-07, the z5.27 persistent
    // halo): a MID grid (e.g. 16° span, gwSpan<340) resident under a ~60° viewport leaves the coarse
    // fallback flooding the margins while the built viewport-truth overlay sits UNUSED — the old
    // `_gwSpan>=340` REPLACE trigger only fired for near-global grids. REPLACE whenever the base
    // can't cover the viewport (world grid OR mid grid too small): the crisp overlay is viewport-
    // truth and its per-pixel fallback covers any stale margin. SAFE now that the overlay carries
    // the island re-assert (islands stay masked). Deep-zoom regional masks that DO cover the viewport
    // are unchanged (min()-combine below). Kill: __RAW_DISABLE_OVERLAY_COVERAGE_REPLACE__.
    const _mbCov = !!(maskBounds && maskBounds.west <= vb[0] && maskBounds.east >= vb[2] && maskBounds.south <= vb[1] && maskBounds.north >= vb[3]);
    // PATCH-BOX coverage (2026-07-07 zoom-out transient): the base mask geographically covers the
    // viewport, but its basemap-PATCHED region (strict viewport at paint time) may not — on zoom-out
    // the ring outside it is NE-only/coarse (the transient rectangle + island flood). When the patch
    // can't cover AND a basin-scale viewport overlay exists (eager-built in refreshMaskWithBasemapWater),
    // REPLACE with it so islands stay masked through the transient.
    const _covReplaceOff = typeof window !== 'undefined' && window.__RAW_DISABLE_OVERLAY_COVERAGE_REPLACE__ === true;
    // DENSE-GLOBAL-BASE → REFINE-NOT-REPLACE (2026-07-15, live-proven continent crest land-bleed on
    // zoom-out): the `_gwSpan>=340` unconditional REPLACE dates to the 39 km 1024×512 world base
    // ("too coarse to trust near coasts"). The base now rebuilds to a dense 4096×2048 global mask
    // (~10 km/texel) that carves every continent correctly (live GPU-probe at z3: base=0 over Ohio/
    // Kansas/Congo/Sahara). A wide-viewport overlay's 50%-PADDED RING is water-FLOODED past its
    // truth box (live probe: overlay=255 over Ohio/Connecticut where base=0) — under REPLACE that
    // flood overrides the correct base and crests bleed across every continent in the ring (the
    // persistent settled-z3 symptom the user reports). When the resident base IS that dense global
    // mask AND it covers the viewport, treat it as the authoritative view-scoped truth (the
    // earth.nullschool "one mask, regenerated for the view" model): keep the overlay ACTIVE but as a
    // min()-COMBINE refinement, not a REPLACE. min(base,overlay) preserves the overlay's crisp
    // island/sheltered truth inside its truth box (live probe: Bahamas base=149 soft, overlay=0 →
    // min=0 land) while the correct base wins in the flooded ring (Ohio min(0,255)=0 land). Verified
    // correct at every probe point (C.Florida/Gulf/Bahamas/Ohio/Connecticut/Mexico/W-Atlantic).
    // Scoped to the world-grid clause ONLY: the deep-zoom regional min-combine (z≥12) and the
    // mid-grid uncovered REPLACE (!_mbCov — there the small base does NOT cover, so the overlay is
    // the only viewport truth) are untouched. Kill: __RAW_DISABLE_DENSE_BASE_NO_REPLACE__.
    const _cmb = this._cachedMaskBounds, _cmd = this._cachedMaskTexDims;
    const _cmSpan = _cmb ? ((_cmb.east < _cmb.west) ? (_cmb.east + 360) - _cmb.west : _cmb.east - _cmb.west) : 0;
    const { rawWideTrigger: _rawWideTrigger, replace: _overlayReplace, baseGlobalDense: _baseGlobalDense } =
      computeWideOverlayMode({
        gwSpan: _gwSpan, mbCov: _mbCov, covReplaceOff: _covReplaceOff,
        baseTexIsCached: this._waveData.u_oceanMaskTexture === this._cachedMaskTex,
        cachedSpan: _cmSpan, cachedTexWidth: _cmd ? _cmd.w : null,
        killed: (typeof window !== 'undefined' && window.__RAW_DISABLE_DENSE_BASE_NO_REPLACE__ === true),
      });
    // DEGRADED-OVERLAY DROP BELOW THE REPAINT GATE (2026-07-16, user live at z3.85: grey
    // heatmap-hole STRIPS south of Louisiana + through the Yucatán/DR): a paint flagged degraded
    // (missing-tile false-land — see overlayBasemapWaterOnMask's open-water plausibility verdict)
    // self-heals via refresh above z4.4, but refreshViewportOverlayMask hard-gates `z < 4.4 →
    // return false`, so BELOW the gate the bad overlay can never repaint yet stays bound — the
    // shader min-combines its false-land strips into permanent heatmap holes. Below the gate the
    // overlay isn't needed at all (the gate's own rationale: texels go sub-pixel and the dense
    // base mask reads fine — live probe: base floodPct 0 at z3.5/z2.3), so a DEGRADED overlay is
    // dropped there and the base renders alone. Non-degraded overlays keep the old behavior.
    // Kill: __RAW_DISABLE_DEGRADED_OVERLAY_DROP__. Telemetry: overlayMask.reason='degraded_drop'.
    const _degradedDrop = this._overlayPaintDegraded === true && z < 4.4 &&
      !(typeof window !== 'undefined' && window.__RAW_DISABLE_DEGRADED_OVERLAY_DROP__ === true);
    const overlayOn = !!(this._overlayMaskTex && this._overlayMaskBounds && !_degradedDrop &&
      (_rawWideTrigger || (z >= 12 && _ovSpan > 0 && _ovSpan < _gwSpan * 0.5)));
    const ob = overlayOn ? this._overlayMaskBounds : { west: 0, south: 0, east: 0, north: 0 };
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.overlayMask = { on: overlayOn, replace: _overlayReplace, reason: _degradedDrop ? 'degraded_drop' : (_overlayReplace ? (_gwSpan >= 340 ? 'world_grid' : 'coverage_gap') : (overlayOn ? (_baseGlobalDense ? 'dense_base_min_combine' : 'min_combine') : 'off')), baseCoversView: _mbCov, baseGlobalDense: _baseGlobalDense, bounds: overlayOn ? ob : null };
    }
    // Probe state (maskFloodProbe.js): the exact mask-selection the shader just used, so the
    // GPU read-back diagnostic samples what is actually on screen. Dev-only; cheap object write.
    this._probeState = { overlayOn, replace: _overlayReplace, z, maskBounds, waveBounds };

    // ==========================================
    // PHASE 1: GPU HEATMAP BASE LAYER (Upgraded Multi-Texture)
    // Draw base heatmap instantly using fallback grid mask texture if land mask is loading.
    // ==========================================
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // PHASE 0 (BLEND BOTH): faded coarse-global wash painted under the regional tile (same
    // premultiplied blend). The base is a WORLD grid, so when a viewport-truth overlay exists it
    // REPLACES the base's 39 km mask inside its bounds — the floored wash is then land-clipped at
    // meter truth wherever truth has been painted.
    if (blendEngaged) {
      // Same degraded-drop as the main pass: a false-land overlay must not clip the wash either.
      const baseOverlay = (this._overlayMaskTex && this._overlayMaskBounds && !_degradedDrop)
        ? { tex: this._overlayMaskTex, bounds: this._overlayMaskBounds } : null;
      // CRISP-MASK OVERLAY (2026-07-06, "shadow underneath the coastal edge" — A/B-proven on the
      // FL panhandle; REWORKED same day after the "intermittent land halo band" regression): the
      // base's own mask is the 39 km world canvas whose soft coastal edge IS the dark band under
      // the regional's crisp coastline. V1 swapped the base's slot-3 mask for the viewport-scoped
      // crisp mask — but the phase-0 wash draws the WHOLE WORLD, and outside the crisp bounds the
      // mask UV clamps to edge, stretching the border row into a visible band whenever a gesture
      // revealed it (the intermittent halo). V2 rides the pass's EXISTING overlay mechanism
      // instead: crisp mask on the OVERLAY slot (replace-inside-bounds, per-pixel fallback to the
      // base 39 km mask everywhere else) — crisp coast where it matters, no band, and a real
      // viewport-truth overlay still takes priority. Kill: __RAW_DISABLE_BASE_CRISP_MASK__.
      // Telemetry: __RAW_GPU__.baseCrispMask.
      let baseCrispMask = null;
      if (!baseOverlay && this._cachedMaskTex && this._cachedMaskBounds &&
          !(typeof window !== 'undefined' && window.__RAW_DISABLE_BASE_CRISP_MASK__ === true)) {
        const _mb = this._cachedMaskBounds;
        // DENSITY eligibility (2026-07-15, island-halo report): a cached WORLD mask (~2.8 px/°)
        // "covers" every viewport by bounds but carries the SAME 39 km softness as the base's own
        // mask — binding it as crisp truth is a no-op that also blocked the no-truth damp below.
        // Crisp truth must actually be crisp: same 32 px/° floor as the retain/halo-damp guards.
        const _dense = this._cachedMaskTexDims &&
          maskDensityPxPerDeg(this._cachedMaskTexDims, _mb) >= 32;
        if (_dense && _mb.west <= vb[0] && _mb.east >= vb[2] && _mb.south <= vb[1] && _mb.north >= vb[3]) {
          baseCrispMask = { tex: this._cachedMaskTex, bounds: _mb };
        }
      }
      // ISLAND-HALO NO-TRUTH DAMP (2026-07-15 user report: "halo around islands, more than
      // coastal land, both flavors, intermittent covering"): when NEITHER a viewport-truth
      // overlay NOR a dense covering resident mask rides the wash's overlay slot, the wash draws
      // with only its ~39 km world mask — small islands aren't carved AT ALL and the soft edge
      // rings every one. The "intermittent" face is this state FLAPPING across the per-commit
      // mask-rebuild churn (the 4096↔2048 alternation in the user's log): each rebuild opens a
      // window where the cached mask doesn't cover/isn't dense yet. Mirror the coarse-resident
      // halo damp for exactly this window (same 0.35 quiet, same z≥4.4 texel-visibility bound);
      // full wash returns the moment crisp truth covers. Kill: __RAW_DISABLE_ISLAND_HALO_DAMP__.
      // Telemetry: __RAW_GPU__.washNoTruthDamp.
      let _washOpacityEff = baseWashOpacity;
      // _washSole exemption (band-sole ∪ bridge-sole): same rationale as the halo damp above —
      // when this wash is the SOLE visible field, a 0.35 damp reads as a cleared heatmap.
      // MOTION-HOLD on the truth verdict too (the nt0↔nt1 mid-gesture flap — see the halo site).
      const _noTruthRaw = !baseOverlay && !baseCrispMask;
      const _noTruthHeld = (_dampHoldOn && _inMotion && this._lastNoTruth !== undefined)
        ? this._lastNoTruth : _noTruthRaw;
      if (!_inMotion || this._lastNoTruth === undefined) this._lastNoTruth = _noTruthRaw;
      const _noTruthDamp = _noTruthHeld && z >= 4.4 && !_washSole &&
        !(typeof window !== 'undefined' && window.__RAW_DISABLE_ISLAND_HALO_DAMP__ === true);
      if (_noTruthDamp && _washOpacityEff > 0 && !_haloDamped) {
        _washOpacityEff *= 0.35;
      }
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.baseCrispMask = !!baseCrispMask;
        window.__RAW_GPU__.washNoTruthDamp = _noTruthDamp && baseWashOpacity > 0;
        // The FINAL wash opacity handed to the base pass (2026-07-16 zoom-clear forensics).
        window.__RAW_GPU__.washEff = +_washOpacityEff.toFixed(3);
      }
      this._drawCoarseBasePass(gl, mat4, themeVal, time, _washOpacityEff, baseOverlay || baseCrispMask);
    }

    gl.useProgram(this.heatmapProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.heatmapProgram, 'u_matrix'), false, mat4);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_maskBounds_min'), maskBounds.west, maskBounds.south);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_maskBounds_max'), maskBounds.east, maskBounds.north);

    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_waveTexture'), 0);
    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_chlorophyllTexture'), 1);
    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_bathymetryTexture'), 2);
    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_oceanMaskTexture'), 3);
    gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_overlayMaskTexture'), 4);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayMaskEnabled'), overlayOn ? 1.0 : 0.0);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayReplace'), _overlayReplace ? 1.0 : 0.0);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayBounds_min'), ob.west, ob.south);
    gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayBounds_max'), ob.east, ob.north);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_theme'), themeVal);

    const isRegionalGrid = (waveBounds.east - waveBounds.west < 359.9);
    const edgeFeatherEnabledVal = isRegionalGrid ? 1.0 : 0.0;
    if (typeof window !== 'undefined') {
      window.__MARINE_COVERAGE_STATUS__ = isRegionalGrid
        ? 'partial_regional_coverage'
        : 'full_coverage';
    }
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_edgeFeatherEnabled'), edgeFeatherEnabledVal);

    // CLAMP SOFTENER: a regional tile narrower than the viewport (a sub-viewport tile committed during zoom-out)
    // otherwise renders as a hard-edged rectangle against the fainter coarse base. When the blend coarse base is
    // filling outside it, widen the regional edge-feather in proportion to how undersized the tile is, so it
    // dissolves smoothly into the coarse field instead of a hard clamp line. Default 0.18 (unchanged) when the
    // tile covers the viewport or there's no coarse base. Kill: window.__RAW_DISABLE_CLAMP_SOFTEN__ = true.
    let edgeFeatherWidthVal = 0.18;
    if (blendEngaged && (typeof window === 'undefined' || window.__RAW_DISABLE_CLAMP_SOFTEN__ !== true)) {
      const rLon = boundsLonSpan(waveBounds);
      const vLon = (vb[2] < vb[0]) ? (vb[2] + 360 - vb[0]) : (vb[2] - vb[0]);
      const coverage = (vLon > 0 && rLon > 0) ? Math.min(1, rLon / vLon) : 1;
      edgeFeatherWidthVal = 0.18 + (1 - coverage) * 0.32; // → up to ~0.5 as the tile shrinks below the viewport
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.clampSoften = { coverage: +coverage.toFixed(2), featherWidth: +edgeFeatherWidthVal.toFixed(2) };
      }
    }
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_edgeFeatherWidth'), edgeFeatherWidthVal);

    if (typeof window !== 'undefined' && !window.__GPU_DEBUG__) {
      window.__GPU_DEBUG__ = { mode: null };
    }
    let debugModeVal = 0.0;
    if (typeof window !== 'undefined' && window.__GPU_DEBUG__) {
      const mode = window.__GPU_DEBUG__.mode;
      if (mode === 'uv') debugModeVal = 1.0;
      else if (mode === 'mask') debugModeVal = 2.0;
      else if (mode === 'grid') debugModeVal = 3.0;
      else if (mode === 'mercator') debugModeVal = 4.0;
    }
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_debug_mode'), debugModeVal);

    // Only apply the power-law visual scaling to actual trend-blended estimated products (provider "estimated" or source_dataset "estimated_blend")
    // and NOT to direct model fallbacks (like open-meteo or GFS fallback) which contain actual physical wave heights.
    const isEstimatedBlend = (
      waveGrid?.is_estimated || waveGrid?.isEstimated
    ) && (
      waveGrid?.provider === 'estimated' || 
      waveGrid?.source_dataset === 'estimated_blend' ||
      (waveGrid?.estimate_basis && (
        waveGrid.estimate_basis.type === 'euro_persistence_gfs_icon_blend' ||
        waveGrid.estimate_basis.type === 'euro_persistence_gfs_blend'
      ))
    );
    // ESTIMATED POWER-LAW NEUTRALIZED (2026-07-06, "the heatmap changes colors dramatically at
    // the native→extended handoff"): the shader's u_is_estimated branch applies pow(h,0.45)·0.95
    // — a 4 m sea displays as 1.78 m, 8 m as 2.42 m — so the colormap collapsed the moment the
    // timeline crossed into the estimated tail, on BOTH EURO (>240h) and ICON (>168h). The
    // estimator emits PHYSICAL meters (anchor-offset deltas, continuous at the boundary by
    // construction), so the transform is a relic of the pre-`7b89eadf` mislabeling era and
    // scientifically distorting today. Estimated frames now render through the SAME colormap as
    // native (estimated-ness stays visible via the HUD provenance badge + confidence).
    // Forensics lever: __RAW_ESTIMATED_POWERLAW__ = true restores the old curve.
    const _estPowerLaw = isEstimatedBlend &&
      (typeof window !== 'undefined' && window.__RAW_ESTIMATED_POWERLAW__ === true);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_is_estimated'), _estPowerLaw ? 1.0 : 0.0);

    // Swell↔Surf coastal-band mode: rescale the color ramp to the surf range (0-4 m) so the band
    // differentiates. Read the flag inline (mirrors getSurfModeFlag) to avoid an engine import cycle; it
    // matches the rendered data, which marineGridSeries fetched with the same flag.
    var surfModeVal = 0.0;
    try {
      if (typeof window !== 'undefined') {
        surfModeVal = (window.__SURF_MODE__ !== undefined)
          ? (window.__SURF_MODE__ ? 1.0 : 0.0)
          : ((window.localStorage && window.localStorage.getItem('__SURF_MODE__') === 'true') ? 1.0 : 0.0);
      }
    } catch (e) { surfModeVal = 0.0; }
    // Option-A gate (rating plan §8 #2): the rating colormap (getRatingColorSmooth) decodes the height channel
    // as a 0-100 QUALITY score, which is only valid when the backend actually produced a rating grid. On a
    // raw-height frame (e.g. the global-coarse frame where the surf transform was skipped) `ratingMode` is
    // false, so we force surfMode off and the shader shows the HONEST swell field instead of fake rating
    // colours. The per-spot glyphs gate on the same signal (useSpotRatings) so both layers stay consistent.
    if (surfModeVal > 0.0 && !(waveGrid && waveGrid.ratingMode)) {
      surfModeVal = 0.0;
    }
    // REVERSE gate (2026-07-12 round-8, the toggle-OFF twin of Option-A): flag OFF but the
    // rendered grid is still a RATING grid (the toggle-off → honest-refetch gap). Its height
    // channel holds SCORES — the honest ramp over scores is the "clamped garbage heatmap when I
    // deactivate ratings" report. Keep painting it as the band (+wash) until the honest grid
    // commits; the guard's rated-resident release above makes that exactly one commit away.
    // Kill: __RAW_RATING_HOLD_DISABLED__.
    else if (surfModeVal === 0.0 && waveGrid && waveGrid.ratingMode
             && (typeof window === 'undefined' || window.__RAW_RATING_HOLD_DISABLED__ !== true)) {
      surfModeVal = 1.0;
    }
    // Telemetry to localize a "no rating band" report in ONE console read (window.__RAW_GPU__.ratingBand): the
    // backend serves rating_mode=true on regional tiles (verified), the series conformer stamps grid.ratingMode,
    // and the shader paints the band when u_surfMode>0.5 — so a missing band is one of: flag off, grid not a
    // rating grid (propagation), or downstream. No render effect; reads the same inputs the gate above uses.
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      var _rawFlag = (window.__SURF_MODE__ !== undefined)
        ? !!window.__SURF_MODE__
        : (typeof window.localStorage !== 'undefined' && window.localStorage.getItem('__SURF_MODE__') === 'true');
      window.__RAW_GPU__.ratingBand = {
        flag: _rawFlag,                                            // is the Surf/Rating toggle's global flag set?
        gridRatingMode: !!(waveGrid && waveGrid.ratingMode),       // did a rating grid reach the engine?
        forcedOff: _rawFlag && !(waveGrid && waveGrid.ratingMode), // gate killing the band (flag on, grid not rating)
        active: surfModeVal > 0.5,                                 // is the band actually being painted?
        gridCols: (waveGrid && waveGrid.cols) || 0,
        fromSeries: !!(waveGrid && waveGrid.__fromSeries),         // which fetch path produced the rendered grid
      };
      // Loud, throttled breadcrumb so a "no band" report is self-diagnosing in the console (no need to know the
      // var name). Once per ~2s, only while the Surf/Rating toggle is on. Names the exact break.
      if (_rawFlag && typeof console !== 'undefined') {
        var _rbNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (!this._ratingBandLogT || (_rbNow - this._ratingBandLogT) > 2000) {
          this._ratingBandLogT = _rbNow;
          var _rb = window.__RAW_GPU__.ratingBand;
          console.log('[rating-band]', _rb.active
            ? 'PAINTING ✓ (band on)'
            : (_rb.forcedOff
                ? 'OFF — rendered grid is NOT a rating grid (ratingMode=false): the backend surf=1/regional tile is not reaching the engine for this viewport'
                : 'OFF — surf flag not set'),
            'cols=' + _rb.gridCols, 'fromSeries=' + _rb.fromSeries, _rb);
        }
        // Forensic: band-STATE transitions (painting↔forcedOff↔off) land in the ring the moment
        // they happen — the "activates then CLEARS" report becomes a timestamped sequence.
        var _bandStateNow = (surfModeVal > 0.5) ? 'painting' : (_rawFlag ? 'forcedOff' : 'off');
        if (this._lastBandState !== _bandStateNow) {
          recordMarineEvent('band_state', {
            from: this._lastBandState || null, to: _bandStateNow,
            cols: (waveGrid && waveGrid.cols) || 0, rating: !!(waveGrid && waveGrid.ratingMode),
          });
          this._lastBandState = _bandStateNow;
        }
      }
      // Forensic snapshot: ONE compact greppable line + ring entry every ~15 s while marine is
      // active — a pasted log then self-describes build/zoom/resident/band state at a glance
      // ([FORENSIC-SNAP]). Cheap: runs inside the existing telemetry branch.
      var _fsNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (!this._forensicSnapT || (_fsNow - this._forensicSnapT) > 15000) {
        this._forensicSnapT = _fsNow;
        var _snap = {
          zoom: (typeof z === 'number') ? +z.toFixed(2) : null,
          dims: waveGrid ? `${waveGrid.cols}x${waveGrid.rows}` : null,
          spanLng: (waveGrid && waveGrid.bounds) ? +boundsLonSpan(waveGrid.bounds).toFixed(2) : null,
          rating: !!(waveGrid && waveGrid.ratingMode),
          band: (surfModeVal > 0.5),
          fade: +_ratingBandFade.fade.toFixed(2),
          washEngaged: !!(window.__RAW_GPU__.blendBoth && window.__RAW_GPU__.blendBoth.engaged),
          // §7 round-12 pt8 — one-line answers for the standing questions: washBase names the
          // coarse-base model (a mismatch vs `model` = the wash silently disengaged on a model
          // switch, the empty-pan suspect); tileClamped = §7i viewport clamp active; serTTLByp =
          // §7j coverage bypasses fired; probes = clamp slow-probes fired this session.
          washBase: (window.__RAW_GPU__.blendBoth && window.__RAW_GPU__.blendBoth.baseModel) || null,
          tileClamped: !!(window.__RAW_GPU__.tileCover && window.__RAW_GPU__.tileCover.clamped),
          serTTLByp: (window.__MARINE_SERIES_DIAG__ && window.__MARINE_SERIES_DIAG__.ttlCoverageBypass) || 0,
          probes: window.__MARINE_CLAMP_CAP_PROBE_COUNT__ || 0,
          hour: waveGrid ? waveGrid.hourOffset : null,
          model: (waveGrid && waveGrid.__sourceModel) || null,
          // §0c serving honesty: nonzero = the resident grid is a nearest-frame stand-in, value
          // = served − requested hours (a pasted log now self-reports frame skew at a glance).
          frameOff: (waveGrid && waveGrid.frame_substituted) ? (waveGrid.frame_offset_hours || 0) : 0,
        };
        recordMarineEvent('snap', _snap);
        console.log('[FORENSIC-SNAP]', JSON.stringify(_snap));
      }
    }
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_surfMode'), surfModeVal);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_time'), time);

    // COASTAL RIBBON (user spec ~10 mi, see resolveRibbonTaper): only the band pays — radius is
    // forced 0 on honest frames so the shader never ring-samples outside rating mode.
    const _ribbon = resolveRibbonTaper(
      (typeof window !== 'undefined') ? window : null,
      (this._cachedMaskTexDims && this._cachedMaskBounds)
        ? 1.0 / Math.max(1e-6, maskDensityPxPerDeg(this._cachedMaskTexDims, this._cachedMaskBounds))
        : null,
      blendEngaged);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_ribbonRadiusDeg'),
      (surfModeVal > 0.5) ? _ribbon.radiusDeg : 0.0);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_ribbonFloor'), _ribbon.floor);
    // INLAND-WATER GATE strength (2026-07-15, "land mask halo when rating is activated"): fades
    // the band on ENCLOSED water (lagoons/bays behind barrier islands) so rating-on mirrors the
    // honest path there (which colors by real data → empty). 1 = full gate; 0 = pre-gate behavior.
    const _inlandGate = (typeof window !== 'undefined' && typeof window.__RAW_BAND_INLAND_GATE__ === 'number')
      ? Math.max(0, Math.min(1, window.__RAW_BAND_INLAND_GATE__)) : 1.0;
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_bandInlandGate'), _inlandGate);
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.ratingRibbon = {
        active: surfModeVal > 0.5 && _ribbon.radiusDeg > 0,
        radiusDeg: _ribbon.radiusDeg, radiusMi: +(_ribbon.radiusDeg * 69).toFixed(1),
        floor: _ribbon.floor, inlandGate: _inlandGate,
      };
    }

    // BLEND BOTH: on the regional overlay pass, fade near-flat cells so the coarse base wash shows through.
    // Off (0) on every non-blend frame → the shader factor is forced to 1 → no behavior change. lo/hi tunable live.
    const _haLo = (typeof window !== 'undefined' && typeof window.__RAW_BLEND_HEIGHT_LO__ === 'number') ? window.__RAW_BLEND_HEIGHT_LO__ : 0.05;
    // 1.4m crossover: below it the faint regional lets the coarse wash bleed through (lifts the nearshore where
    // surf is small); above it the regional dominates (real swell still reads as the precise regional tile).
    const _haHi = (typeof window !== 'undefined' && typeof window.__RAW_BLEND_HEIGHT_HI__ === 'number') ? window.__RAW_BLEND_HEIGHT_HI__ : 1.4;
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_heightAlphaEnabled'), blendEngaged ? 1.0 : 0.0);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_heightAlphaLo'), _haLo);
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_heightAlphaHi'), _haHi);
    // Crisp mask edge for coarse residents (the heatmap pass's own halo — see the damp block).
    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_maskEdgeSharp'), this._maskEdgeSharp || 0.0);

    var heatmapOpacity = heatmapZoomOpacity(z);

    if (window.__WEATHER_DEBUG_ISOLATE_OVERLAY__ === true) {
      heatmapOpacity = 1.0;
    }

    // Coarse-grid fade (2026-06-29): when the ONLY marine data covering this viewport is the coarse-global
    // fallback (~10°/cell, 37×17) and the camera is zoomed in past it, a single flat cell fills the screen.
    // The old behavior painted that as a solid wash that reads as "wrong data" (the close-zoom "clamp").
    // Fade the heatmap out instead so it reads as "no fine data here" — the inherent 0.25°/10° resolution
    // limit, not a render bug. Per-spot rating glyphs (drawn in MapMarkerLayers, not this shader) stay visible.
    // Gate on cellDeg>1° so regional tiles (<0.3°/cell) NEVER fade, and the fade only engages once <2 cells
    // span the view (so zoomed-out global stays full). Kill switch: window.__RAW_DISABLE_COARSE_FADE__ = true
    let coarseFade = 1.0;
    if (window.__RAW_DISABLE_COARSE_FADE__ !== true && window.__WEATHER_DEBUG_ISOLATE_OVERLAY__ !== true) {
      const gb = (waveGrid && waveGrid.bounds) || waveBounds; // grid extent (matches waveGrid.cols); waveBounds is the same grid on the non-series path
      const gcols = waveGrid && waveGrid.cols;
      if (gb && gcols > 0 && typeof gb.west === 'number' && typeof gb.east === 'number') {
        const gridLonSpan = (gb.east < gb.west) ? (gb.east + 360 - gb.west) : (gb.east - gb.west);
        const cellDeg = gridLonSpan / gcols;                 // grid cell size in ° of longitude
        const vLonSpan = (vb[2] < vb[0]) ? (vb[2] + 360 - vb[0]) : (vb[2] - vb[0]);
        // RATING MODE IS EXEMPT: the surf-quality BAND is a smoothed coastal quality ZONE (not a literal
        // value), with accurate per-spot glyphs on top — it's wanted at close zoom even from coarse data, so
        // only the raw-height marine wash fades. Without this exemption the band vanished when zoomed in.
        const isRatingBand = !!(waveGrid && waveGrid.ratingMode);
        if (cellDeg > 1.0 && vLonSpan > 0 && !isRatingBand) { // only the coarse-global RAW wash qualifies
          const cellsAcross = vLonSpan / cellDeg;            // how many grid cells span the viewport
          // FLOOR at 0.7 (2026-06-29): a full fade-to-0 made the heatmap "clear" at very close zoom — but most
          // coastal viewports were STUCK on the coarse-global grid back then, so the fade fired constantly and
          // read as "the heatmap disappeared". Dim to 70% instead so the data stays visible.
          // 2026-07-04 (Pianosa/world-window saga): two fade-to-zero ramps were tried here and BOTH
          // read as a "blank heatmap" bug within minutes of live driving. The real fix landed
          // elsewhere — refreshMaskWithBasemapWater now rebuilds the mask VIEWPORT-scoped while a
          // wide grid is resident (u_maskBounds decoupling), so the wash is land-clipped at meter
          // truth and can stay visible over water at every zoom. The legacy 0.7 floor stands.
          coarseFade = 0.7 + 0.3 * smoothstepVal(0.5, 2.0, cellsAcross); // [0.7..1.0]: dims, never clears
        }
      }
      if (typeof window !== 'undefined' && window.__RAW_GPU__) window.__RAW_GPU__.coarseFade = coarseFade;
    }
    heatmapOpacity *= coarseFade;

    // RATING-BAND ZOOM-OUT CROSS-FADE: the band trades places with the honest wash as the viewport
    // widens toward the mid→global tier boundary (see resolveRatingBandFade above). surfModeVal>0.5
    // ⇒ this pass is painting RATING colors — honest height frames are never faded here.
    if (surfModeVal > 0.5) {
      heatmapOpacity *= _ratingBandFade.bandMult;
    }

    // NO-TRUTH WINDOW GUARD (2026-07-04): a wide grid at close zoom with NO overlay covering the
    // viewport has only the ~39 km world mask — the wash paints roads/cities (boot at close zoom,
    // or the instants between a pan and the moveend/idle overlay repaint). Fade the wash for
    // exactly that window; it returns the moment the overlay covers the view (land then clipped at
    // meter truth). Keyed on MASK COVERAGE, not zoom — the two earlier zoom-keyed fades both read
    // as "blank heatmap" bugs because they fired even when masking was fine. Mirrors the crest
    // suppression condition above, so heatmap and particles agree about the window.
    if (_residentCoarseGlobal && z >= 8.0 && !_overlayIntersectsViewport) {
      // FLOOR 0.3, never 0 (live "heatmap clears occasionally" on fast long pans): a blank map
      // reads as a bug every time; a briefly-dimmed wash with ~1 s of soft near-land bleed reads
      // as loading. The overlay repaint (moveend/idle, 700 ms throttle) restores full truth.
      heatmapOpacity *= Math.max(0.3, 1 - (z - 8.0));
    }

    heatmapOpacity *= mult;

    gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_opacity'), heatmapOpacity);
    // Per-frame MAIN-pass opacity + resident-mask identity forensics (2026-07-16 zoom-clear trace).
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.opacity = {
        heatmap: +heatmapOpacity.toFixed(3), mult: +mult.toFixed(3), coarseFade: +coarseFade.toFixed(2),
      };
      window.__RAW_GPU__.maskId = {
        cachedBound: this._waveData.u_oceanMaskTexture === this._cachedMaskTex,
        dims: (() => { try { return JSON.stringify(this._cachedMaskTexDims); } catch (e) { return null; } })(),
        mb: maskBounds ? [maskBounds.west, maskBounds.south, maskBounds.east, maskBounds.north]
          .map((v) => +(+v).toFixed(1)).join(',') : null,
      };
    }

    // Overlay on unit 4 (fallback-bind the base mask so the sampler is always complete).
    bindTexture(gl, overlayOn ? this._overlayMaskTex : this._waveData.u_oceanMaskTexture, 4);
    // §0e (2026-07-14): the HEATMAP colors from the score variant on rating grids (band
    // colormap unchanged) while draw/advect keep the honest main texture — animations are
    // identical rating-on/off. Whenever the encoder packed a score texture the heatmap MUST
    // use it (the main texture is honest heights then). The feature kill switch lives at the
    // ENCODER (__RAW_DISABLE_ANIM_PHYS__ → no score texture, score back in the shared channel).
    bindTexture(gl, this._waveData.u_waveScoreTexture || this._waveData.u_waveTexture, 0);
    bindTexture(gl, this._waveData.u_chlorophyllTexture, 1);
    bindTexture(gl, this._waveData.u_bathymetryTexture, 2);
    bindTexture(gl, this._waveData.u_oceanMaskTexture, 3);

    var heatLngOffsetLoc = gl.getUniformLocation(this.heatmapProgram, 'u_lng_offset');
    if (this.heatmapVAO) {
      gl.bindVertexArray(this.heatmapVAO);
    } else {
      var heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gridUVBuffer);
      gl.enableVertexAttribArray(heatUVLoc);
      gl.vertexAttribPointer(heatUVLoc, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIndexBuffer);
    }

    var worldOffsets = _needWrap ? [0.0, -360.0, 360.0] : [0.0];
    for (var wi = 0; wi < worldOffsets.length; wi++) {
      gl.uniform1f(heatLngOffsetLoc, worldOffsets[wi]);
      gl.drawElements(gl.TRIANGLES, this.numGridIndices, gl.UNSIGNED_SHORT, 0);
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.drawCallsPerFrame++;
      }
    }

    if (this.heatmapVAO) {
      gl.bindVertexArray(null);
    } else {
      var heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
      if (heatUVLoc !== -1) gl.disableVertexAttribArray(heatUVLoc);
    }

    if (this._fboSupported !== false) {
      // ==========================================
      // PHASE 2: WAVE CREST RENDERER
      // ==========================================
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.drawProgram);
      gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_particles'), 0);
      gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_waveTexture'), 1);
      gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_oceanMaskTexture'), 2);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_particles_res'), this.particleRes);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.drawProgram, 'u_matrix'), false, mat4);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_theme'), themeVal);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_edgeFeatherEnabled'), edgeFeatherEnabledVal);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_edgeFeatherWidth'), edgeFeatherWidthVal);
      // Directional-spectrum spread (breaks the parallel-crest lattice over uniform/coarse fields). OPT-IN until
      // visually verified + tuned on real swell data (default 0 = legacy parallel crests, no regression). Enable +
      // tune live via window.__RAW_CREST_DIR_JITTER__ (radians, ~0.15–0.30 is a natural spread).
      const _crestDirJitter = resolveAnimValue('__RAW_CREST_DIR_JITTER__');
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_crestDirJitter'), _crestDirJitter);
      // Direction-coherence floor: DIM crests sampled from bilinear-interpolated DIVERGENT-direction zones (the
      // synthetic close-zoom vortex). Engine-computed close-zoom ramp above; 0 = off (legacy). Matches ADVECT_FS.
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_dirCoherenceMin'), dirCoherenceMin);
      // Seam-fade alpha FLOOR (2026-07-03): incoherent-direction zones dim to this instead of vanishing —
      // the zero-alpha fade made divergence hotspots (Baja rows 177° apart) a crest DEAD ZONE across the
      // whole band. 0.3 keeps motion visible at low emphasis. Tune live: __RAW_SEAM_FADE_FLOOR_ALPHA__.
      const _seamFadeFloor = (typeof window !== 'undefined' && typeof window.__RAW_SEAM_FADE_FLOOR_ALPHA__ === 'number')
        ? window.__RAW_SEAM_FADE_FLOOR_ALPHA__ : 0.3;
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_seamFadeFloor'), _seamFadeFloor);
      // Coarse-band nearest-cell direction (vortex band, default mode): crest orientation snaps to the nearest
      // coarse cell-center heading — matches ADVECT so orientation == motion. 0 outside the band.
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_coarseNearestDir'), coarseNearestDir);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_waveGridSize'), _wgCols, _wgRows);

      // Zoom-band crest SELF-CONTRAST (2026-07-03): full strength where the crest palette collides
      // with the heatmap palette (user-reported z3.65–4.25 wash-out), ramping in from z3.0 and out
      // by z4.9. Internal dark-skirt/bright-core gradient — no theme palette change, 0 elsewhere.
      // Override live: window.__RAW_CREST_CONTRAST__ (0 = off everywhere, 1 = on everywhere).
      let _crestContrast;
      const _ccOverride = (typeof window !== 'undefined' && typeof window.__RAW_CREST_CONTRAST__ === 'number')
        ? window.__RAW_CREST_CONTRAST__ : null;
      if (_ccOverride !== null) {
        _crestContrast = _ccOverride;
      } else {
        const _ccUp = Math.min(1, Math.max(0, (z - 3.0) / 0.5));
        const _ccDown = 1 - Math.min(1, Math.max(0, (z - 4.4) / 0.5));
        _crestContrast = Math.max(0, Math.min(_ccUp, _ccDown));
      }
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_crestContrast'), _crestContrast);

      // LOW-HEIGHT crest self-contrast (2026-07-05): the zoom band above fixes the palette
      // collision at world zoom, but the SAME collision happens at any zoom where height <~0.75 m
      // — live-proven in the Catalina/San Clemente swell shadow ("hard line, animations don't
      // cover the heatmap east of it"): dashes rendered wash-camouflaged and __RAW_CREST_CONTRAST__=1
      // made them read instantly. The fragment ramps this term out by 1.05 m; the existing
      // __RAW_CREST_CONTRAST__ override still means "0 = off everywhere / 1 = on everywhere".
      // Kill: __RAW_DISABLE_LOWH_CREST_CONTRAST__ = true. Tune: __RAW_LOWH_CREST_CONTRAST__ [0..1].
      let _lowHCC;
      if (_ccOverride !== null) {
        _lowHCC = _ccOverride;
      } else if (typeof window !== 'undefined' && window.__RAW_DISABLE_LOWH_CREST_CONTRAST__ === true) {
        _lowHCC = 0.0;
      } else {
        _lowHCC = (typeof window !== 'undefined' && typeof window.__RAW_LOWH_CREST_CONTRAST__ === 'number')
          ? Math.max(0, Math.min(1, window.__RAW_LOWH_CREST_CONTRAST__)) : 1.0;
      }
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_lowHCrestContrast'), _lowHCC);

      // === ANIMATION UPGRADES (§5 #2) — all gated, default-off → byte-identical render until enabled ===
      // Trochoidal crest shape: asymmetric ribbon (sharp leading face, broad trailing back). window.__RAW_TROCHOIDAL__ [0..1].
      const _trochoidal = resolveAnimValue('__RAW_TROCHOIDAL__');
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_trochoidal'), _trochoidal);
      // Orbital pitch: phase-synced forward/back sway (CSS px) so crests pitch, not just translate. window.__RAW_ORBITAL_PITCH__.
      const _orbitalPitch = resolveAnimValue('__RAW_ORBITAL_PITCH__');
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_orbitalPitch'), _orbitalPitch);
      // Shoaling foam: extra whitecap in shallow water via bathymetry. GATED on a resident bath texture so the
      // sampler (bound to unit 3 below) is never READ unbound. window.__RAW_SHOAL_FOAM__.
      const _hasBathTex = !!(this._waveData && this._waveData.u_bathymetryTexture);
      const _shoalFoam = _hasBathTex ? resolveAnimValue('__RAW_SHOAL_FOAM__') : 0.0;
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_shoalFoam'), _shoalFoam);
      gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_bathTexture'), 3);

      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_opacity'), mult);

      // Constant-screen-density (flow-viz best practice): keep a FIXED number of seeded crests on screen at every
      // zoom instead of an ad-hoc per-zoom fraction. Particles live in a tile ~Nx the screen; the viewport's share
      // of that tile (onScreenFrac) lets us solve the cull fraction so total × onScreenFrac × threshold = target.
      // Default ON at 1650 on-screen seeds (≈ the previously-liked integer-zoom density), now held CONSTANT across
      // every zoom — verified via telemetry: count stays ~1650 from z9..z16 and across fractional zooms (was a ~4×
      // sawtooth: sparse just-before-integer, dense at integer). Reachable thanks to TILE_BACKOFF=2. Tunable live
      // via window.__RAW_PART_TARGET__ (set 0 to fall back to the legacy per-zoom curve). Telemetry: __RAW_GPU__.particleDensity.
      let densityBase = 0.0;
      const _partTarget = (typeof window !== 'undefined' && typeof window.__RAW_PART_TARGET__ === 'number')
        ? window.__RAW_PART_TARGET__ : 1650;
      if (_partTarget > 0 && z > tileZoomMin && tileWidth > 0) {
        const vWest = vb[0], vEast = vb[2];
        const lonSpan = (vEast < vWest) ? (vEast + 360 - vWest) : (vEast - vWest);
        const vMercX = Math.min(1.0, Math.max(0, lonSpan) / 360.0);
        const vMercY = Math.abs(latToMercatorY(vb[3]) - latToMercatorY(vb[1]));
        const onScreenFrac = Math.max(1e-6, Math.min(1.0, (vMercX * vMercY) / (tileWidth * tileWidth)));
        const totalParticles = this.particleRes * this.particleRes;
        densityBase = Math.max(0.02, Math.min(0.97, _partTarget / (totalParticles * onScreenFrac)));
        if (typeof window !== 'undefined' && window.__RAW_GPU__) {
          window.__RAW_GPU__.particleDensity = { zoom: +z.toFixed(2), onScreenFrac: +onScreenFrac.toFixed(4), densityBase: +densityBase.toFixed(3), targetSeeds: _partTarget, estInViewport: Math.round(totalParticles * onScreenFrac) };
        }
      }
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_densityBase'), densityBase);

      // Ribbon-endpoint land fade (2026-07-04): crest quads dissolve toward a land end instead of
      // overhanging barrier islands (Venice/Lido). Kill: window.__RAW_DISABLE_ENDPOINT_LAND_FADE__=true.
      const _endpointLandFade = (typeof window !== 'undefined' && window.__RAW_DISABLE_ENDPOINT_LAND_FADE__ === true) ? 0.0 : 1.0;
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_endpointLandFade'), _endpointLandFade);
      // Crest-center land cut (2026-07-07, "crests on islands at various zooms"): align crests with
      // the heatmap's 0.5 discard so they stop surviving on soft/partial-land mask values (thin cays,
      // coastal edges) the wash already rejects. Tune live: __RAW_CREST_LAND_THRESH__ (0.3 = legacy).
      const _crestLandThresh = (typeof window !== 'undefined' && Number.isFinite(+window.__RAW_CREST_LAND_THRESH__)) ? +window.__RAW_CREST_LAND_THRESH__ : 0.5;
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_crestLandThreshold'), _crestLandThresh);
      // §4.2 MOTION-UNLOCK (DEFAULT ON since 2026-07-14 §0e — the user directive "animations
      // identical rating-on/off" IS the A/B verdict): in rating mode lift crest land checks to
      // max(mask.r, mask.g) — g is the encoder's motion-water channel — so crests ride the real
      // swell over band-masked open ocean while the band COLORS stay untouched. Kill:
      // window.__RAW_RATING_MOTION_UNLOCK__ = false. 0 on non-rating commits = byte-identical.
      const _motionUnlock = (this._residentRatingMode === true && (typeof window === 'undefined' ||
        window.__RAW_RATING_MOTION_UNLOCK__ !== false)) ? 1.0 : 0.0;
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_motionUnlock'), _motionUnlock);
      // §0e ANIM-PHYS (2026-07-14): on rating grids the encoder keeps the MAIN wave texture
      // honest (animation reads it untouched) and packs the score into a heatmap-only variant
      // (u_waveScoreTexture, bound at the heatmap site). This flag is telemetry-only here.
      const _animPhys = !!(this._waveData && this._waveData.u_waveScoreTexture);
      // Viewport-truth overlay mask (unit 4; fallback-bound below so the sampler is always complete).
      gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_overlayMaskTexture'), 4);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_overlayMaskEnabled'), overlayOn ? 1.0 : 0.0);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_overlayReplace'), _overlayReplace ? 1.0 : 0.0);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_overlayBounds_min'), ob.west, ob.south);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_overlayBounds_max'), ob.east, ob.north);
      // CREST RING-FILL (2026-07-16): coarse-base fallback pair on units 5/6 (fallback-bound below
      // so the samplers are always complete; resolveCrestRingFill forces enabled=false when no
      // complete base is held, so the fallback binds are never read).
      gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_coarseWaveTexture'), 5);
      gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_coarseMaskTexture'), 6);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_ringFillEnabled'), _ringFill.enabled ? 1.0 : 0.0);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_coarseBounds_min'), _rfB.west, _rfB.south);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_coarseBounds_max'), _rfB.east, _rfB.north);

      // TRUTHFULNESS ECHO: publish the exact animation values the engine is applying THIS frame (+ live zoom)
      // so the tuner can prove the sliders reach the GPU and show what's active per zoom. Read every frame.
      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        const _g = (k, d) => (typeof window[k] === 'number' ? window[k] : d);
        window.__RAW_GPU__.anim = {
          zoom: +z.toFixed(2),
          trochoidal: _trochoidal,
          orbitalPitch: _orbitalPitch,
          shoalFoam: _shoalFoam,
          shoalActive: _hasBathTex,            // false → shoaling foam is inert (no bathymetry bound at this view)
          crestJitter: _crestDirJitter,
          dirCoherenceMin: +dirCoherenceMin.toFixed(3),  // applied close-zoom coherence floor (0 = off / far zoom)
          seamFadeFloor: _g('__RAW_SEAM_FADE_FLOOR_ALPHA__', 0.3), // alpha floor of the seam DIM (crests never vanish in incoherent zones)
          coarseNearestDir: coarseNearestDir,            // 1 = vortex-band nearest-cell direction sampling active
          coarseCrestMode: _ccc.mode,                    // 'nearest' | 'suppress' | 'killed' | 'off' (off = not in band)
          crestContrast: +_crestContrast.toFixed(3),     // zoom-band self-contrast strength (1 in z~3.5-4.4, 0 outside; __RAW_CREST_CONTRAST__ overrides)
          lowHCrestContrast: +_lowHCC.toFixed(3),        // low-height (<~0.75m) self-contrast strength — island swell-shadow dash camouflage (kill: __RAW_DISABLE_LOWH_CREST_CONTRAST__)
          waveSpeed: _g('__RAW_WAVE_SPEED__', 1.0),
          reducedMotion: !!this._prefersReducedMotion || window.__RAW_REDUCED_MOTION__ === true, // a11y damp (0.15× drift; heatmap untouched)
          speedHeightCap: _g('__RAW_SPEED_HEIGHT_CAP__', 3.0),
          partTarget: _partTarget,
          densityBase: +densityBase.toFixed(3),
          tileZoomMin: tileZoomMin,
          tileBackoff: _g('__RAW_TILE_BACKOFF__', 2),
          stratifiedReseed: (typeof window.__RAW_STRATIFIED_RESEED__ === 'number' ? window.__RAW_STRATIFIED_RESEED__ !== 0 : true),
          farzoomSizeFloor: _g('__RAW_FARZOOM_SIZE_FLOOR__', 0.55),
          endpointLandFade: _endpointLandFade === 1.0,  // crest ribbons dissolve toward land ends (kill: __RAW_DISABLE_ENDPOINT_LAND_FADE__)
          motionUnlock: _motionUnlock === 1.0,          // §4.2: rating-mode crests riding motion-water (DEFAULT ON; kill __RAW_RATING_MOTION_UNLOCK__=false)
          animPhys: _animPhys,                          // §0e: rating grid committed with the honest-height main texture + score side-texture
          blendWash: _blendBaseWash,
          legacyAnim: window.__RAW_ANIM_LEGACY__ === true   // true → Natural defaults killed (flat pre-2026-07 look)
        };
      }

      let drawDebugModeVal = 0.0;
      if (typeof window !== 'undefined' && window.__GPU_DEBUG__) {
        const mode = window.__GPU_DEBUG__.mode;
        if (mode === 'part_uv') drawDebugModeVal = 5.0;
        else if (mode === 'part_pos') drawDebugModeVal = 6.0;
        else if (mode === 'part_offset') drawDebugModeVal = 7.0;
        else if (mode === 'part_fbo') drawDebugModeVal = 8.0;
      }
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_debug_mode'), drawDebugModeVal);

      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_maskBounds_min'), maskBounds.west, maskBounds.south);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_maskBounds_max'), maskBounds.east, maskBounds.north);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_time'), time);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_zoom'), z);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_tileZoomMin'), tileZoomMin);
      // U3 density-aware crest size: far-zoom size floor (0.55 default; 0.4 = legacy pre-2026-07-02 look).
      const _fzFloor = (typeof window !== 'undefined' && typeof window.__RAW_FARZOOM_SIZE_FLOOR__ === 'number')
        ? window.__RAW_FARZOOM_SIZE_FLOOR__ : 0.55;
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_farzoomSizeFloor'), _fzFloor);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_motion_scale'), motionScale);
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_tile_origin'), tileOriginX, tileOriginY);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_tile_width'), tileWidth);

      // v5.3: viewport and DPR uniforms for pixel-space quad expansion
      var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1.0;
      gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_viewport'), gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_device_pixel_ratio'), dpr);

      bindTexture(gl, this.particleStateA, 0);
      bindTexture(gl, this._waveData.u_waveTexture, 1);
      bindTexture(gl, this._waveData.u_oceanMaskTexture, 2);
      // Bind bathymetry to unit 3 for the (gated) shoaling-foam sampler. Fall back to the wave texture when no
      // bath texture is resident, so unit 3 is always a valid bound texture — the sampler is only READ when
      // u_shoalFoam>0, which the engine forces to 0 without a bath texture (so the fallback is never sampled).
      bindTexture(gl, (this._waveData.u_bathymetryTexture ? this._waveData.u_bathymetryTexture : this._waveData.u_waveTexture), 3);
      bindTexture(gl, overlayOn ? this._overlayMaskTex : this._waveData.u_oceanMaskTexture, 4);
      bindTexture(gl, _rfBase ? _rfBase.u_waveTexture : this._waveData.u_waveTexture, 5);
      bindTexture(gl, _rfBase ? _rfBase.u_oceanMaskTexture : this._waveData.u_oceanMaskTexture, 6);

      var mercOffsetLoc = gl.getUniformLocation(this.drawProgram, 'u_merc_offset');
      if (this.drawVAO) {
        gl.bindVertexArray(this.drawVAO);
      } else {
        var idLoc = gl.getAttribLocation(this.drawProgram, 'a_vertex_id');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexIdBuffer);
        gl.enableVertexAttribArray(idLoc);
        gl.vertexAttribPointer(idLoc, 1, gl.FLOAT, false, 0, 0);
      }

      // v5.3: gl.TRIANGLES quad ribbons (6 verts per particle)
      var numQuadVerts = this._numQuadVertices || this.particleRes * this.particleRes * 6;
      var worldOffsets = _needWrap ? [0.0, -1.0, 1.0] : [0.0];
      for (var wi = 0; wi < worldOffsets.length; wi++) {
        gl.uniform1f(mercOffsetLoc, worldOffsets[wi]);
        gl.drawArrays(gl.TRIANGLES, 0, numQuadVerts);
        if (typeof window !== 'undefined' && window.__RAW_GPU__) {
          window.__RAW_GPU__.drawCallsPerFrame++;
        }
      }

      if (this.drawVAO) {
        gl.bindVertexArray(null);
      } else {
        var idLoc = gl.getAttribLocation(this.drawProgram, 'a_vertex_id');
        if (idLoc !== -1) gl.disableVertexAttribArray(idLoc);
      }

      // === CREST DIAGNOSTICS (v5.3) ===
      populateCrestDiagnostics(this, gl, waveBounds, z);

      // ==========================================
      // PHASE 3: PARTICLE ADVECTION SYSTEM (Simulate next state)
      // ==========================================
      // Overall drift-speed multiplier (separate from the per-wave height cap below): lets the whole field be
      // slowed if mid-zoom motion reads too fast. Default 1.0 (unchanged); tunable live via window.__RAW_WAVE_SPEED__.
      const _waveSpeedMult = (typeof window !== 'undefined' && typeof window.__RAW_WAVE_SPEED__ === 'number') ? window.__RAW_WAVE_SPEED__ : 1.0;
      // ACCESSIBILITY (2026-07-03 audit §6.4): honor prefers-reduced-motion by damping crest drift
      // to 0.15× — the heatmap (the actual data) is untouched; only the decorative particle motion
      // slows. Cached matchMedia (evaluated once; OS-level changes re-evaluate on reload, which is
      // the norm for this media feature). Override for testing: window.__RAW_REDUCED_MOTION__
      // (true = force damp, false = force off); tuner __RAW_WAVE_SPEED__ still multiplies on top.
      if (this._prefersReducedMotion === undefined) {
        try {
          this._prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (e) { this._prefersReducedMotion = false; }
      }
      const _rmOverride = (typeof window !== 'undefined' && typeof window.__RAW_REDUCED_MOTION__ === 'boolean')
        ? window.__RAW_REDUCED_MOTION__ : null;
      const _reducedMotion = _rmOverride !== null ? _rmOverride : this._prefersReducedMotion;
      const _rmScale = _reducedMotion ? 0.15 : 1.0;
      const stableSpeedScale = this.speedFactor * Math.pow(0.5, Math.max(0, z - 6)) * 1.5e-5 * motionScale * _waveSpeedMult * _rmScale;

      gl.disable(gl.BLEND); // CRITICAL: Disable blend to prevent position texture corruption!
      gl.useProgram(this.advectProgram);
      gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_particles'), 0);
      gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_waveTexture'), 1);
      gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_oceanMaskTexture'), 2);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_min'), waveBounds.west, waveBounds.south);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_dataBounds_max'), waveBounds.east, waveBounds.north);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_maskBounds_min'), maskBounds.west, maskBounds.south);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_maskBounds_max'), maskBounds.east, maskBounds.north);
      gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_overlayMaskTexture'), 3);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_overlayMaskEnabled'), overlayOn ? 1.0 : 0.0);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_overlayReplace'), _overlayReplace ? 1.0 : 0.0);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_overlayBounds_min'), ob.west, ob.south);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_overlayBounds_max'), ob.east, ob.north);
      // CREST RING-FILL — must match the DRAW pass exactly (same _ringFill decision, same base
      // set; advect units 4/5 since this pass only uses 0-3). Fallback-bound below.
      gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_coarseWaveTexture'), 4);
      gl.uniform1i(gl.getUniformLocation(this.advectProgram, 'u_coarseMaskTexture'), 5);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_ringFillEnabled'), _ringFill.enabled ? 1.0 : 0.0);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_coarseBounds_min'), _rfB.west, _rfB.south);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_coarseBounds_max'), _rfB.east, _rfB.north);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speed_scale'), stableSpeedScale);
      // Cap the height term that drives drift speed (big swell otherwise drifts ~linearly with height → unnaturally
      // fast at mid-zoom over the coarse-global). Default 3.0 m; tunable live via window.__RAW_SPEED_HEIGHT_CAP__.
      const _speedHeightCap = (typeof window !== 'undefined' && typeof window.__RAW_SPEED_HEIGHT_CAP__ === 'number') ? window.__RAW_SPEED_HEIGHT_CAP__ : 3.0;
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_speedHeightCap'), _speedHeightCap);
      // Direction-coherence floor (matches DRAW): drop particles advecting through interpolated divergent-direction
      // zones so they can't spiral the synthetic vortex. Engine-computed close-zoom ramp above; 0 = off (legacy).
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_dirCoherenceMin'), dirCoherenceMin);
      // Coarse-band nearest-cell direction (matches DRAW): advect along the nearest cell-center heading so the
      // per-cell motion is uniform — the bilinear swirl cannot form. 0 outside the vortex band.
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_coarseNearestDir'), coarseNearestDir);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_waveGridSize'), _wgCols, _wgRows);

      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_rand_seed'), Math.random());
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_drop_rate'), this.dropRate);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_zoom'), z);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_tileZoomMin'), tileZoomMin);
      gl.uniform2f(gl.getUniformLocation(this.advectProgram, 'u_tile_origin'), tileOriginX, tileOriginY);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_tile_width'), tileWidth);
      // U2 stratified reseeding (default ON): respawn each particle inside its own state-texel stratum for
      // Jobard–Lefer-style even seed spacing (kills uniform-random reseed clumps at low density). Kill:
      // window.__RAW_STRATIFIED_RESEED__ = 0.
      const _stratified = (typeof window !== 'undefined' && window.__RAW_STRATIFIED_RESEED__ === 0) ? 0.0 : 1.0;
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_stratifiedReseed'), _stratified);
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_particles_res'), this.particleRes);
      // §4.2 MOTION-UNLOCK — must match the DRAW pass exactly (advected positions and drawn
      // crests share land semantics, or particles die where crests would render and vice versa).
      // DEFAULT ON since 2026-07-14 §0e (kill __RAW_RATING_MOTION_UNLOCK__ = false).
      const _advMotionUnlock = (this._residentRatingMode === true && (typeof window === 'undefined' ||
        window.__RAW_RATING_MOTION_UNLOCK__ !== false)) ? 1.0 : 0.0;
      gl.uniform1f(gl.getUniformLocation(this.advectProgram, 'u_motionUnlock'), _advMotionUnlock);

      bindTexture(gl, null, 0);
      bindTexture(gl, null, 1);
      bindTexture(gl, null, 2);

      unbindTexture(gl, this.particleStateB);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.particleStateB, 0);
      gl.viewport(0, 0, this.particleRes, this.particleRes);

      const readTex = this.particleStateA;
      const writeTex = this.particleStateB;
      console.assert(readTex !== writeTex, "Assertion failed: readTex === writeTex inside WebGL advection loop!");

      const fboStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      let fboStatusStr = 'UNKNOWN';
      if (fboStatus === gl.FRAMEBUFFER_COMPLETE) fboStatusStr = 'FRAMEBUFFER_COMPLETE';
      else if (fboStatus === gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT) fboStatusStr = 'INCOMPLETE_ATTACHMENT';
      else if (fboStatus === gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT) fboStatusStr = 'INCOMPLETE_MISSING';
      else if (fboStatus === gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS) fboStatusStr = 'INCOMPLETE_DIMENSIONS';
      else if (fboStatus === gl.FRAMEBUFFER_UNSUPPORTED) fboStatusStr = 'UNSUPPORTED';
      else fboStatusStr = 'INCOMPLETE_STATUS_' + fboStatus;

      if (typeof window !== 'undefined' && window.__RAW_GPU__) {
        window.__RAW_GPU__.particleStateATexUnit = 0;
        window.__RAW_GPU__.particleStateBTexUnit = 'FBO_ATTACH_COLOR0';
        window.__RAW_GPU__.advFboStatus = fboStatusStr;
        window.__RAW_GPU__.particlePassExecuted = true;
      }

      if (fboStatus !== gl.FRAMEBUFFER_COMPLETE) {
        console.warn('[WebGLMarine] Framebuffer incomplete: ' + fboStatusStr + '. Falling back to Heatmap only.');
        this._fboSupported = false;
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        bindTexture(gl, this.particleStateA, 0);
        bindTexture(gl, this._waveData.u_waveTexture, 1);
        bindTexture(gl, this._waveData.u_oceanMaskTexture, 2);
        bindTexture(gl, overlayOn ? this._overlayMaskTex : this._waveData.u_oceanMaskTexture, 3);
        bindTexture(gl, _rfBase ? _rfBase.u_waveTexture : this._waveData.u_waveTexture, 4);
        bindTexture(gl, _rfBase ? _rfBase.u_oceanMaskTexture : this._waveData.u_oceanMaskTexture, 5);

        if (this.advectVAO) {
          gl.bindVertexArray(this.advectVAO);
        } else {
          var advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(advPosLoc);
          gl.vertexAttribPointer(advPosLoc, 2, gl.FLOAT, false, 0, 0);
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (typeof window !== 'undefined' && window.__RAW_GPU__) {
          window.__RAW_GPU__.drawCallsPerFrame++;
        }

        if (this.advectVAO) {
          gl.bindVertexArray(null);
        } else {
          var advPosLoc = gl.getAttribLocation(this.advectProgram, 'a_pos');
          if (advPosLoc !== -1) gl.disableVertexAttribArray(advPosLoc);
        }

        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);

        var tmp = this.particleStateA;
        this.particleStateA = this.particleStateB;
        this.particleStateB = tmp;
      }
    }
  } finally {
    if (gl && !gl.isContextLost() && webglState) {
      if (this.advFBO && gl.isFramebuffer(this.advFBO)) {
        try {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.advFBO);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        } catch (e) {}
      }
      restoreWebGLState(gl, webglState);
    }

    if (typeof window !== 'undefined' && window.__RAW_GPU__ && renderStart > 0) {
      const renderDuration = performance.now() - renderStart;
      if (renderDuration < 8.0) window.__RAW_GPU__.frameTimeHistogram[0]++;
      else if (renderDuration < 16.6) window.__RAW_GPU__.frameTimeHistogram[1]++;
      else if (renderDuration < 33.3) window.__RAW_GPU__.frameTimeHistogram[2]++;
      else if (renderDuration < 66.6) window.__RAW_GPU__.frameTimeHistogram[3]++;
      else window.__RAW_GPU__.frameTimeHistogram[4]++;

      if (renderDuration > 16.6) {
        window.__RAW_GPU__.droppedFrameCounter++;
      }
    }
  }

  // COMPOSITED SCREEN READ-BACK (maskFloodProbe crest-on-land, 2026-07-07): one-shot + gated, so
  // it costs a single null-check on normal frames. After the marine pass has drawn heatmap+crests
  // into the framebuffer, sample the composited pixel at requested screen points — this captures
  // what the eye sees (particle crests + soft wash on land), which the mask-only probe misses.
  if (this._screenProbeRequest && this._screenProbeRequest.length) {
    try {
      const req = this._screenProbeRequest; this._screenProbeRequest = null;
      const cvs = gl.canvas;
      const dpr = (cvs && cvs.clientWidth) ? (gl.drawingBufferWidth / cvs.clientWidth) : 1;
      const H = gl.drawingBufferHeight, W = gl.drawingBufferWidth;
      const out = new Uint8Array(4);
      const res = new Array(req.length);
      for (let i = 0; i < req.length; i++) {
        const rx = Math.round(req[i].x * dpr), ry = Math.round(H - req[i].y * dpr);
        if (rx < 0 || ry < 0 || rx >= W || ry >= H) { res[i] = null; continue; }
        gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
        res[i] = [out[0], out[1], out[2], out[3]];
      }
      this._screenProbeResult = res;
      this._screenProbeAt = Date.now();
    } catch (e) { this._screenProbeResult = null; }
  }
};

WebGLMarineEngine.prototype.render = WebGLMarineEngine.prototype.renderHeatmapAndParticles;

// BASEMAP-WATER TRUTH REFRESH (2026-07-04, "Gull Park / Pier 15-16 under water"): repaint the
// CACHED mask texture in place with the basemap's own water polygons inside the viewport (see
// overlayBasemapWaterOnMask). In-place texImage2D on the SAME texture object means the resident
// waveData (which binds that object) picks it up on the next frame — no re-encode, no commit.
// Regional grids only (a world mask can't hold viewport detail at 1024px anyway). Idempotent and
// throttle-friendly: cheap enough for moveend. Kill switch window.__RAW_BASEMAP_WATER_MASK__=false.
WebGLMarineEngine.prototype.refreshMaskWithBasemapWater = function(gl, mapInstance) {
  if (typeof window !== 'undefined' && window.__RAW_BASEMAP_WATER_MASK__ === false) return false;
  if (!gl || !mapInstance) return false;
  const geo = this._cachedMaskGeoJSON;
  const tex = this._cachedMaskTex;
  const bounds = this._cachedMaskBounds;
  if (!geo || !bounds || !tex) { this._lastMaskRepatchReason = 'no_cache'; return false; }
  this._lastMaskRepatchReason = 'enter';
  const span = (bounds.east < bounds.west ? bounds.east + 360 : bounds.east) - bounds.west;
  // WIDE (world) grids: the grid's own 1024×512 mask (~39 km/texel) cannot hold viewport detail —
  // paint a SEPARATE viewport-truth OVERLAY texture instead (see refreshViewportOverlayMask). The
  // base mask is never touched, so a stale overlay can only ever fall back to base behavior.
  // (A first attempt retargeted THIS texture to viewport bounds in place: one pan later the
  // out-of-bounds samples clamped to edge-water and land masking died wholesale — Istria/Susak.)
  if (span >= 30) { this._lastMaskRepatchReason = 'wide_delegate'; return this.refreshViewportOverlayMask(gl, mapInstance, true); }
  // STALE-OVERLAY CLEAR (2026-07-04, the "bright rectangle block" at Punat z9.44 after a z12.5 zoom):
  // the viewport-truth overlay is a DEEP-ZOOM (z≥12) crispness enhancement painted for a SMALL box.
  // Zooming back out below z12 leaves that box resident, and it then applies its sheltered/crisp
  // verdict over a SUB-VIEWPORT rectangle (min()-combine) while the surrounding viewport uses the
  // base mask — a hard rectangular seam that pans with the map (live repro: z12.5→z9.44). Below the
  // overlay-active zone for a REGIONAL grid (span<30, z<12) the overlay is never legitimately
  // painted OR rendered, so a resident box is always stale — drop it. Wide grids (span≥30, handled
  // above) keep their overlay: they use it at every zoom via REPLACE. Proven fix: clearing the
  // bounds alone (no re-patch) removes the block.
  try {
    if (mapInstance.getZoom() < 12 && this._overlayMaskBounds) {
      this._overlayMaskBounds = null;
      this._overlayMaskTruthBox = null;
    }
  } catch (e) { /* zoom unavailable — leave overlay untouched */ }
  // The resident frame must actually be USING the cached texture — otherwise refreshing it paints
  // a texture nothing binds (and skipping avoids fighting an in-flight commit).
  if (!this._waveData || this._waveData.u_oceanMaskTexture !== tex) { this._lastMaskRepatchReason = 'tex_mismatch'; return false; }
  // HYSTERESIS (stair-climb choppiness fix): the painter patches the viewport padded 40%; while
  // the SAME grid is resident and the current viewport is still INSIDE the last patch, a repaint
  // adds nothing — skip the 50–250 ms canvas+upload. Deep-zoom crispness still refreshes via the
  // overlay branch below (its own hysteresis).
  let curView = null;
  try {
    const b = mapInstance.getBounds();
    curView = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  } catch (e) { curView = null; }
  const gridKey = `${bounds.west}_${bounds.south}_${bounds.east}_${bounds.north}`;
  const rp = this._regionalPatchState;
  let _curZoom = 0; try { _curZoom = mapInstance.getZoom(); } catch (e) { _curZoom = 0; }
  // ZOOM-CHANGE REBUILD (2026-07-07, "intracoastal wash takes 30-60s to suppress at z9 on zoom-in"):
  // the base hysteresis used to skip ALL zoom-ins inside the patch box (its comment even said so), so
  // after a zoom-in the sheltered-water verdict + finest basemap holes for the closer view never
  // refreshed until the next data commit — the 30-60s the user saw. Now a zoom change ≥0.75 forces a
  // rebuild (fresh classify + finest tiles); pans inside the box and small zooms still skip, and the
  // layer's 700 ms throttle keeps it from churning. Kill: __RAW_DISABLE_ZOOM_REBUILD__.
  const _zoomRebuildOff = typeof window !== 'undefined' && window.__RAW_DISABLE_ZOOM_REBUILD__ === true;
  const _zoomStable = _zoomRebuildOff || typeof rp?.z !== 'number' || Math.abs(_curZoom - rp.z) < 0.75;
  // A DEGRADED previous paint (parent-vulnerable source-query fallback) never earns the
  // hysteresis skip — the next refresh repaints with finest-tile truth (grey-rect self-heal).
  if (curView && rp && !rp.degraded && _zoomStable && rp.gridKey === gridKey && rp.box &&
      rp.box.west <= curView.west && rp.box.east >= curView.east &&
      rp.box.south <= curView.south && rp.box.north >= curView.north) {
    // Base patch still covers the view — only the deep-zoom overlay may need work.
    try {
      if (_curZoom >= 12) return this.refreshViewportOverlayMask(gl, mapInstance);
    } catch (e3) { /* enhancement only */ }
    this._lastMaskRepatchReason = 'hysteresis_covered';
    return false;
  }
  // TILE-READINESS GATE (the "rectangle holes" root, 2026-07-04): painting while the water source
  // is mid-load bakes missing-tile rectangles into the mask as false land, and the hysteresis
  // above then keeps the bad paint. Skip entirely — the resident mask (NE truth) serves, and the
  // layer's `idle` listener re-drives this refresh once every covering tile is queryable.
  if (!isBasemapWaterSourceReady(mapInstance)) { this._lastMaskRepatchReason = 'source_not_ready'; return false; }
  try {
    const canvas = renderMaskToCanvas(geo, bounds);
    const applied = overlayBasemapWaterOnMask(canvas, bounds, mapInstance);
    if (!applied) { this._lastMaskRepatchReason = 'overlay_not_applied'; return false; }
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    // Record the TRUTH box for the hysteresis above — the STRICT viewport the painter actually
    // repainted (the old 40%-padded box claimed truth over a ring the tile queries can never
    // cover; that ring was black land = the pan/zoom "rectangle holes"). Zoom-ins inside the box
    // still skip; any pan escaping it repaints (throttled + tile-gated at the layer).
    if (curView) {
      const degraded = !!(applied && applied.degraded);
      this._regionalPatchState = { gridKey, box: { ...curView }, degraded, z: _curZoom };
      // PATCH CARRY-FORWARD source (2026-07-06, "bays flicker on rapid zoom"): retain the painted
      // canvas so the NEXT mask rebuild (bounds change / geojson swap) transplants this truth box
      // synchronously instead of flashing NE-only until the async repatch (see maskSmoothing.js).
      // The canvas is a fresh renderMaskToCanvas copy — nothing else aliases it. NEVER stash a
      // DEGRADED paint (grey-rectangle class): the carry would propagate a parent-vulnerable
      // paint into every rebuild until a good repaint replaced it.
      if (!degraded) {
        this._lastPatchedMask = { canvas, bounds: { ...bounds }, box: { ...curView } };
      }
    }
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.basemapWaterMask = { applied: true, at: new Date().toISOString() };
    }
    // DEEP-ZOOM CRISPNESS (2026-07-04 round 6): past ~z12 the regional canvas (1° @ 4096 ≈ 27 m/
    // texel) halos the wash over waterfront roads — ALSO paint the crisp viewport overlay. The
    // shaders min()-combine it with the regional base for non-wide grids, so the regional
    // sheltered verdict and land truth both survive; the overlay only ever REMOVES wash.
    try {
      let _z2; try { _z2 = mapInstance.getZoom(); } catch (e2) { _z2 = 0; }
      if (_z2 >= 12) this.refreshViewportOverlayMask(gl, mapInstance);
    } catch (e2) { /* overlay is an enhancement */ }
    this._lastMaskRepatchReason = 'applied';
    return true;
  } catch (e) {
    console.warn('[WebGLMarineEngine] basemap-water mask refresh skipped:', e && e.message);
    return false;
  }
};

// VIEWPORT-TRUTH OVERLAY MASK (2026-07-04): while a WIDE (world) grid is resident at close zoom,
// paint the basemap-truth mask for the PADDED VIEWPORT into a dedicated texture the shaders
// consult ONLY inside its bounds (u_overlayMask* uniforms). Per-pixel fallback to the grid's own
// mask makes staleness harmless: after a fast pan the overlay covers where the user WAS, those
// pixels are off-screen, and everything visible degrades to the coarse-but-sane base mask until
// the idle/zoomend refresh repaints. Kill switch rides __RAW_BASEMAP_WATER_MASK__ (caller-gated).
WebGLMarineEngine.prototype.refreshViewportOverlayMask = function(gl, mapInstance, basinScale) {
  const geo = this._cachedMaskGeoJSON;
  if (!geo || !gl || !mapInstance) return false;
  let z;
  try { z = mapInstance.getZoom(); } catch (e) { return false; }
  // z≥4.4 (was 7, was 9 — 2026-07-07, the z5 "halo keeps trying to heal + heatmap on islands"):
  // "below z7 coarse texels read acceptably" was WRONG — world-mask texels stay visibly wide
  // (>1.3 screen px) down to z≈4.4, and the world-GRID regime (span≥30, where this overlay is
  // the ONLY crisp truth) lives mostly below z7. The paint is a fixed screen-resolution canvas,
  // so cost does not grow with span; at z<4.4 the texels go sub-pixel and the base mask reads
  // fine, so the gate self-limits.
  if (z < 4.4) return false;
  let bounds;
  let view = null;
  let viewSpan = 0;
  try {
    const b = mapInstance.getBounds();
    view = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    viewSpan = b.getEast() - b.getWest();
    // 50% pad (was 15%): each paint survives several pan/zoom gestures before the hysteresis
    // below forces a repaint — the paint itself is the choppiness (stair-climb forensics: 38
    // paints × 50–250 ms main-thread each in a 22 s interaction).
    const padX = viewSpan * 0.5;
    const padY = (b.getNorth() - b.getSouth()) * 0.5;
    bounds = {
      west: b.getWest() - padX,
      south: Math.max(-85, b.getSouth() - padY),
      east: b.getEast() + padX,
      north: Math.min(85, b.getNorth() + padY),
    };
    // TWO SPANS by combine mode (live lagoon-bleed catch at z12.5): overlays for REGIONAL grids
    // min()-combine with a base that already carries the sheltered verdict, so they stay CRISP
    // (0.05° floor, ~1 m/texel — the 0.7° attempt haloed canal-side roads). Overlays for WIDE
    // grids REPLACE the base sample, so they must be basin-scale (0.7° ⇒ the painter's ≥0.5°
    // sheltered gate runs and enclosed lagoons stay suppressed through the world-grid window).
    const MIN_SPAN = basinScale ? 0.7 : 0.05;
    if (bounds.east - bounds.west < MIN_SPAN) {
      const cx = (bounds.east + bounds.west) / 2;
      bounds.west = cx - MIN_SPAN / 2; bounds.east = cx + MIN_SPAN / 2;
    }
    if (bounds.north - bounds.south < MIN_SPAN) {
      const cy = (bounds.north + bounds.south) / 2;
      bounds.south = Math.max(-85, cy - MIN_SPAN / 2); bounds.north = Math.min(85, cy + MIN_SPAN / 2);
    }
    // HYSTERESIS (the stair-climb fix): if the previous paint's TRUTH box (the strict viewport it
    // actually repainted from tile truth — NOT the padded texture bounds, whose ring is only NE
    // base truth) still CONTAINS the current viewport AND its resolution is still adequate (span
    // not more than ~5× the viewport — i.e. the user hasn't zoomed far past its texel density),
    // skip the repaint entirely. Zoom-ins inside the truth box cost NOTHING; escaping it repaints
    // once (throttled at the layer, tile-gated below).
    const prev = this._overlayMaskBounds;
    const prevTruth = this._overlayMaskTruthBox;
    // A DEGRADED previous paint (parent-vulnerable fallback) never earns the skip — this is the
    // El Salvador grey-rectangle self-heal (2026-07-06): a bad box on a WIDE-grid residency
    // REPLACES the base mask at every zoom and used to persist until the 5× resolution rule
    // finally escaped (the user had to zoom extremely close). Now the next refresh repaints it.
    if (prev && prevTruth && this._overlayMaskTex && !this._overlayPaintDegraded &&
        prevTruth.west <= view.west && prevTruth.east >= view.east &&
        prevTruth.south <= view.south && prevTruth.north >= view.north &&
        (prev.east - prev.west) <= Math.max(viewSpan, 0.001) * 5) {
      return false; // still fresh — no repaint, no upload
    }
  } catch (e) { return false; }
  // TILE-READINESS GATE (the "rectangle holes" root): never paint truth from a mid-load source —
  // skip and let the `idle`-driven refresh land the paint when every covering tile is queryable.
  if (!isBasemapWaterSourceReady(mapInstance)) return false;
  try {
    // 2048 cap: an overlay spans ≤ ~1°, so 2048 px keeps ≤ ~3 m/texel at deep zoom while the
    // paint + texImage2D upload cost 4× less than the 4096 tier (8 MB vs 32 MB per refresh).
    const canvas = renderMaskToCanvas(geo, bounds, { maxWidth: 2048 });
    const applied = overlayBasemapWaterOnMask(canvas, bounds, mapInstance);
    if (!applied) return false;
    if (!this._overlayMaskTex) {
      this._overlayMaskTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._overlayMaskTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    gl.bindTexture(gl.TEXTURE_2D, this._overlayMaskTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    this._overlayMaskBounds = bounds;
    // The region the painter truth-painted from tiles = the strict viewport at paint time; the
    // canvas ring outside it holds NE base truth (sane but coarser). Hysteresis keys on this box.
    this._overlayMaskTruthBox = view;
    this._overlayPaintDegraded = !!(applied && applied.degraded);
    if (typeof window !== 'undefined' && window.__RAW_GPU__) {
      window.__RAW_GPU__.basemapWaterMask = { applied: true, at: new Date().toISOString(), overlay: true, bounds, truthBox: view, degraded: this._overlayPaintDegraded };
    }
    return true;
  } catch (e) {
    console.warn('[WebGLMarineEngine] viewport overlay mask refresh skipped:', e && e.message);
    return false;
  }
};

// GPU MASK READ-BACK (maskFloodProbe.js diagnostic, 2026-07-07 — "innovate a better way to test"):
// sample the ACTUAL ocean-mask texel the shader used at each lng/lat by attaching the live mask
// texture to an FBO and readPixels (persistent texture; no draw-timing games, no preserveDrawingBuffer).
// Returns per-point { base, overlay, effective, src } as 0-255 red (≥128 = water). `effective`
// mirrors the shader's per-pixel selection (overlay REPLACE, z≥12 min-combine, or base) using the
// state stashed during the last draw. Dev tool only; no effect on rendering.
WebGLMarineEngine.prototype.probeMaskGPU = function(points, glIn) {
  const gl = glIn || (typeof window !== 'undefined' && window.map && window.map.painter && window.map.painter.context && window.map.painter.context.gl);
  if (!gl || !Array.isArray(points)) return null;
  const ps = this._probeState || {};
  const merc = (lat) => { const c = Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180; return (1 - Math.log(Math.tan(c) + 1 / Math.cos(c)) / Math.PI) / 2; };
  const wrap = (lng, center) => { let p = lng; while (p - center > 180) p -= 360; while (p - center < -180) p += 360; return p; };
  const dimsForOverlay = (b) => { const span = (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west; let w = span < 10 ? 4096 : (span < 30 ? 2048 : 4096); if (w > 2048) w = 2048; return { w, h: w / 2 }; };
  const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const fbo = gl.createFramebuffer();
  const out = new Uint8Array(4);
  const read = (tex, b, dims, lng, lat) => {
    if (!tex || !b || !dims) return null;
    const center = (b.west + b.east) / 2;
    const wW = wrap(b.west, center), wE = wrap(b.east, center), pl = wrap(lng, center);
    const mnX = (wW + 180) / 360, mxX = (wE + 180) / 360, mnY = merc(b.north), mxY = merc(b.south);
    if (mxX <= mnX || mxY <= mnY) return null;
    const u = ((pl + 180) / 360 - mnX) / (mxX - mnX);
    const v = (merc(lat) - mnY) / (mxY - mnY);          // 0 = north (canvas top)
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const tx = Math.max(0, Math.min(dims.w - 1, Math.round(u * (dims.w - 1))));
    const tyC = Math.max(0, Math.min(dims.h - 1, Math.round(v * (dims.h - 1))));
    const ty = dims.h - 1 - tyC;                          // mask uploaded UNPACK_FLIP_Y=true
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
    gl.readPixels(tx, ty, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out[0];
  };
  const inBounds = (b, lng, lat) => {
    if (!b || lat < b.south || lat > b.north) return false;
    const c = (b.west + b.east) / 2, pl = wrap(lng, c), wW = wrap(b.west, c), wE = wrap(b.east, c);
    return pl >= wW && pl <= wE;
  };
  const baseTex = this._cachedMaskTex, baseB = this._cachedMaskBounds, baseD = this._cachedMaskTexDims;
  const ovTex = this._overlayMaskTex, ovB = this._overlayMaskBounds, ovD = ovB ? dimsForOverlay(ovB) : null;
  const res = points.map(({ lng, lat }) => {
    const base = read(baseTex, baseB, baseD, lng, lat);
    const overlay = read(ovTex, ovB, ovD, lng, lat);
    let effective = base, src = 'base';
    if (ps.overlayOn && overlay != null && inBounds(ovB, lng, lat)) {
      if (ps.replace) { effective = overlay; src = 'overlay_replace'; }
      else { effective = (base == null) ? overlay : Math.min(base, overlay); src = 'overlay_min'; }
    }
    return { lng, lat, base, overlay, effective, src };
  });
  try { gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo); gl.deleteFramebuffer(fbo); } catch (e) {}
  return res;
};

// BLEND BOTH: snapshot a global-coarse grid into a standalone (non-resident) texture set we own + free.
// ATOMIC-SWAP decision for the coarse base (2026-07-16, deep zoom/pan forensics; pure + exported for tests).
// `prev` = the currently-held base, `encoded` = the freshly-encoded candidate (null if the encode threw or
// produced no wave texture), `atomic` = fix ON. Returns { next: what _coarseBaseData becomes, toFree: the
// superseded set to delete AFTER the swap (null = free nothing here) }.
//   atomic + valid encode → adopt encoded, free the old (only after the pointer is swapped).
//   atomic + FAILED encode → KEEP the last-good base (next=prev, free nothing) — this is the fix: the old
//     order freed the base BEFORE encoding, so a failed re-encode left _coarseBaseData null, and BOTH zoom-out
//     bridges (paint WebGLMarineCustomLayer.js:229 + data bridgeToCoarseGlobalIfHeld) need a held base → a null
//     base fell through to the ~700ms "clear"/clearBuffers on the next zoom-out (deterministically reproduced).
//   legacy (!atomic) → caller already freed prev before the encode, so just adopt encoded (or null).
export function resolveCoarseBaseSwap(prev, encoded, atomic) {
  const valid = !!(encoded && encoded.u_waveTexture);
  if (!atomic) return { next: valid ? encoded : null, toFree: null };
  if (valid) return { next: encoded, toFree: (prev && prev !== encoded) ? prev : null };
  return { next: prev || null, toFree: null };
}

// CREST RING-FILL decision (2026-07-16 queue #1; pure + exported for tests, mirroring
// shouldBridgeToCoarseGlobal). Live + 66-frame split-speckle proof: when the viewport extends past
// the resident grid edge, the revealed ring shows the coarse wash but ZERO crest animations
// (avgSpkE 0.0 beyond the fine tile's bound vs 1.3 inside) — particles COVER the ring (§7i tile
// clamp) but both particle shaders cull outside u_dataBounds (deliberate: prevents the clamp-smear
// rectangle). Fix = per-pixel fallback (webgl-wind / earth.nullschool practice): out-of-resident
// particles sample the held coarse-global base + ITS world mask. Enable ONLY when:
//   • not killed (__RAW_DISABLE_CREST_RINGFILL__), and
//   • the blend wash is engaged (⊇ same-model/same-layer parity + regional resident + not
//     overlay-isolated) — ring crests must animate the SAME field the wash paints under them,
//     and a ring with no wash should stay crest-less (crests over bare basemap read as a glitch), and
//   • the base set is complete (wave texture + its OWN mask + bounds), and
//   • the GPU has ≥7 vertex texture units (DRAW_VS statically samples 7 with the fallback pair;
//     unknown (non-number) fails OPEN — every WebGL-era GPU reports ≥16, the guard is for the
//     exotic floor where the draw program would misbehave anyway).
export function resolveCrestRingFill(opts) {
  const o = opts || {};
  if (o.killed) return { enabled: false, reason: 'killed' };
  if (!o.blendEngaged) return { enabled: false, reason: 'wash_idle' };
  const b = o.base;
  if (!b || !b.u_waveTexture || !b.u_oceanMaskTexture || !b.bounds) {
    return { enabled: false, reason: 'no_base' };
  }
  if (typeof o.maxVertexTextures === 'number' && o.maxVertexTextures < 7) {
    return { enabled: false, reason: 'vertex_tex_units' };
  }
  return { enabled: true, reason: 'ok' };
}

WebGLMarineEngine.prototype._captureCoarseBase = function(gl, waveGrid, key) {
  if (!gl) return;
  // Encode the NEW base BEFORE freeing the old (see resolveCoarseBaseSwap) so a failed re-encode never nulls
  // the base — the two texture sets coexist for a few synchronous lines only. Kill: __RAW_DISABLE_ATOMIC_COARSE_BASE__.
  const atomic = (typeof window === 'undefined') || window.__RAW_DISABLE_ATOMIC_COARSE_BASE__ !== true;
  if (!atomic) this._freeCoarseBase(gl);
  let base = null;
  try {
    // Pass the land GeoJSON so the standalone encode renders a high-res MERCATOR ocean mask (the heatmap shader
    // samples mask_v in mercator; a grid mask would be read at the wrong latitude and hide the wash).
    base = encodeMarineTexture(gl, waveGrid, this._landGeoJSON || null, this, { standalone: true });
  } catch (e) {
    console.warn('[WebGLMarineEngine] coarse-base encode failed:', e && e.message);
    base = null;
  }
  if (base && base.u_waveTexture) {
    base.waveGrid = waveGrid;
    base.__key = key || coarseBaseKey(waveGrid);
    base.__sourceModel = waveGrid.__sourceModel || 'GFS';
    base.__componentLayer = waveGrid.__componentLayer || 'waves';
  }
  const { next, toFree } = resolveCoarseBaseSwap(this._coarseBaseData, (base && base.u_waveTexture) ? base : null, atomic);
  this._coarseBaseData = next;
  if (toFree) this._freeCoarseBase(gl, toFree);   // free the superseded base only AFTER the pointer swap
};

// Free a coarse-base texture set. `obj` (optional) frees a SPECIFIC superseded base (the atomic-swap
// path in _captureCoarseBase) WITHOUT touching this._coarseBaseData; omit it to free + null the resident.
WebGLMarineEngine.prototype._freeCoarseBase = function(gl, obj) {
  const b = obj || this._coarseBaseData;
  if (!b) return;
  if (!obj) this._coarseBaseData = null;
  if (!gl) return;
  try {
    if (b.u_waveTexture) safeDeleteTexture(gl, b.u_waveTexture, this);
    if (b.u_chlorophyllTexture) safeDeleteTexture(gl, b.u_chlorophyllTexture, this);
    if (b.u_bathymetryTexture) safeDeleteTexture(gl, b.u_bathymetryTexture, this);
    if (b.u_oceanMaskTexture) safeDeleteTexture(gl, b.u_oceanMaskTexture, this);
  } catch (e) {}
};

// WIDE-VIEW OVERLAY COMPOSITING MODE (2026-07-15, live-proven continent crest land-bleed on
// zoom-out) — pure decision, exported + unit-tested, mirroring shouldBridgeToCoarseGlobal.
// The wide-grid `_gwSpan>=340` unconditional REPLACE dates to the 39 km 1024×512 world base; the
// base now rebuilds to a dense 4096×2048 global mask (~10 km/texel) that carves every continent.
// A wide-viewport overlay's 50%-padded RING is water-flooded past its truth box (GPU-probe:
// overlay=255 over Ohio where base=0) — under REPLACE that flood overrode the correct base and
// crests bled across the continents. When the resident base IS that dense global mask AND covers
// the viewport, treat it as the authoritative view-scoped truth (earth.nullschool "one mask")
// and keep the overlay as a min()-COMBINE refinement instead of a REPLACE (min(base,overlay)
// keeps the overlay's crisp island/sheltered truth inside its truth box while the correct base
// wins in the flooded ring). Scoped to the world-grid clause; deep-zoom regional min-combine and
// the mid-grid uncovered REPLACE (small base doesn't cover → overlay is the only viewport truth)
// are untouched. `killed` = __RAW_DISABLE_DENSE_BASE_NO_REPLACE__ (restores the old REPLACE).
export function computeWideOverlayMode(opts) {
  const o = opts || {};
  const rawWideTrigger = o.gwSpan >= 340 || (!o.covReplaceOff && !o.mbCov);
  const baseGlobalDense = !o.killed && !!o.baseTexIsCached &&
    typeof o.cachedSpan === 'number' && o.cachedSpan >= 340 &&
    typeof o.cachedTexWidth === 'number' && o.cachedTexWidth >= 4096 && !!o.mbCov;
  const replace = rawWideTrigger && !baseGlobalDense;
  return { rawWideTrigger, replace, baseGlobalDense };
}

// ZOOM-OUT BRIDGE (2026-07-15, user "heatmap clears for a quick second midway zooming out" AND
// "green grid around FL"): on a fast/settling zoom-out the regional resident either CLEARS to a
// blank flash (WebGLMarineLayer's zoom-out clamp guard) or is HELD and renders as a tiny blocky
// grid rectangle floating over its bounds. Both faces are the same root: the regional is never
// replaced by the held global-coarse until a fresh global fetch commits. We already retain a
// global-coarse grid for the wash (_coarseBaseData.waveGrid) — promote it to the MAIN resident
// the moment the regional stops covering a wide viewport, so the honest global field bridges the
// gap (no blank, no floating rectangle). Self-contained coverage check (same math + lever as the
// no-downgrade guard) using the last render frame's zoom/viewport, so both the render loop and
// the layer can call it safely. Runs ONCE — after promotion the resident is coarse-global and the
// isRegionalBounds guard is false. Kill: __RAW_DISABLE_ZOOMOUT_BRIDGE__. Returns true if bridged.
// Pure decision for the zoom-out bridge (exported + unit-tested, mirroring
// shouldRejectResolutionDowngrade). TRUE ⇒ promote the held coarse-global `coarse` over the
// regional `resident`. Fires ONLY when: a coarse-global grid is held, the resident is a regional
// grid, the view is wide (zoomed out ≤ MARINE_ZOOMED_OUT_MAX_ZOOM or >15° either axis), and the
// resident covers < __RAW_DOWNGRADE_COVER_FRAC__ (0.6) of the viewport — i.e. exactly the
// coverage boundary where the no-downgrade guard also releases it, so the two never fight.
export function shouldBridgeToCoarseGlobal(resident, coarse, lastZoom, viewportBounds, win) {
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  if (w && w.__RAW_DISABLE_ZOOMOUT_BRIDGE__ === true) return false;
  if (!coarse || !isCoarseGlobalGrid(coarse)) return false;
  if (!resident || !resident.bounds || !isRegionalBounds(resident.bounds) || isCoarseGlobalGrid(resident)) return false;
  const vb = viewportBounds;
  if (!vb) return false;
  const wideView = (typeof lastZoom === 'number' && lastZoom <= MARINE_ZOOMED_OUT_MAX_ZOOM)
    || (vb[2] - vb[0]) > 15.0 || (vb[3] - vb[1]) > 15.0;
  if (!wideView) return false;
  const rb = resident.bounds;
  const vpA = Math.max(1e-9, (vb[2] - vb[0]) * (vb[3] - vb[1]));
  const ix = Math.max(0, Math.min(rb.east, vb[2]) - Math.max(rb.west, vb[0]));
  const iy = Math.max(0, Math.min(rb.north, vb[3]) - Math.max(rb.south, vb[1]));
  const frac = (ix * iy) / vpA;
  const minFrac = (w && Number(w.__RAW_DOWNGRADE_COVER_FRAC__)) || 0.6;
  return frac < minFrac;   // regional no longer covers → bridge to the held global
}

// SUB-COVERING REGIONAL REJECT (2026-07-16, Playwright real-wheel frame trace of the z5.9→5.02
// "cleared then came back" report; pure + exported for tests). Mid-gesture the pan-following
// refetch committed a regional covering only ~60% of the wide viewport OVER the covering
// coarse-global resident; the display gate hid it (mult 0) and the bridge bounced the world grid
// right back two frames later — a pale interlude plus a promotion flash for zero net change.
// Reject that commit at the same choke point the no-downgrade guard uses: at wide view a regional
// that covers < __RAW_DOWNGRADE_COVER_FRAC__ (0.6 — the SAME lever and math as
// shouldBridgeToCoarseGlobal, so commit/gate/bridge can never disagree) must not replace a
// coarse-global resident. Deliberate switches are never held (model/layer/hour/rating flavor must
// all match), and unknown zoom/viewport FAILS OPEN (the 07-03 lesson: a wrong accept self-heals,
// a wrong reject strands). Rejected grids go to the SAME self-heal stash — zoom back in past the
// coverage boundary and the stash commits. Kill: __RAW_DISABLE_SUBCOVER_REJECT__ (also off under
// the shared __RAW_DISABLE_NO_DOWNGRADE__ via the call sites' `disabled` arg).
export function shouldRejectSubcoveringRegional(resident, incoming, lastZoom, viewportBounds, disabled, win) {
  if (disabled || !resident || !incoming) return false;
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  if (w && w.__RAW_DISABLE_SUBCOVER_REJECT__ === true) return false;
  if (!isCoarseGlobalGrid(resident)) return false;
  if (!incoming.bounds || !isRegionalBounds(incoming.bounds) || isCoarseGlobalGrid(incoming)) return false;
  if ((resident.__sourceModel || 'GFS') !== (incoming.__sourceModel || 'GFS')) return false;
  if ((resident.__componentLayer || 'waves') !== (incoming.__componentLayer || 'waves')) return false;
  if (incoming.hourOffset === undefined || resident.hourOffset === undefined
      || incoming.hourOffset !== resident.hourOffset) return false;
  if (!!resident.ratingMode !== !!incoming.ratingMode) return false;
  const vb = viewportBounds;
  if (typeof lastZoom !== 'number' || !vb) return false;   // unknown → fail open
  const wideView = lastZoom <= MARINE_ZOOMED_OUT_MAX_ZOOM
    || (vb[2] - vb[0]) > 15.0 || (vb[3] - vb[1]) > 15.0;
  if (!wideView) return false;
  const ib = incoming.bounds;
  const vpA = Math.max(1e-9, (vb[2] - vb[0]) * (vb[3] - vb[1]));
  const ix = Math.max(0, Math.min(ib.east, vb[2]) - Math.max(ib.west, vb[0]));
  const iy = Math.max(0, Math.min(ib.north, vb[3]) - Math.max(ib.south, vb[1]));
  const frac = (ix * iy) / vpA;
  const minFrac = (w && Number(w.__RAW_DOWNGRADE_COVER_FRAC__)) || 0.6;
  return frac < minFrac;
}

WebGLMarineEngine.prototype.bridgeToCoarseGlobalIfHeld = function(gl) {
  try {
    if (!gl) return false;
    if (this._pendingDowngrade) return false;   // the self-heal path already owns this case
    const base = this._coarseBaseData;
    const cbg = base && base.waveGrid;
    const rwg = this._waveData && this._waveData.waveGrid;
    if (!shouldBridgeToCoarseGlobal(rwg, cbg, this._lastZoom, this._lastViewportBounds,
        typeof window !== 'undefined' ? window : undefined)) return false;
    // Promotion commits a GLOBAL grid while the cached mask is still the regional's box — force the
    // full mask rebuild (the escaped-mask recipe, 64bd1ff6): left alone, the encoder's retain guards
    // (retain_patched / retain_res_no_downgrade) keep the crisp REGIONAL mask under the WORLD grid and
    // everything outside its box CLAMP_TO_EDGEs water over land (the SC/Cuba bleed geometry).
    this._maskSourceReady = true;
    this._maskRetainPatchedOk = false;
    // Third arg is setWaveData's landGeoJSON slot and MUST be null (2026-07-16 forensics): the old
    // call passed this._waveData (an encoded-texture set, not a geojson) — setWaveData persisted it
    // into _landGeoJSON, renderMaskToCanvas's identity check flushed the pristine-canvas LRU, and its
    // featureless-input early-return produced an ALL-WATER world mask → every promotion rendered the
    // heatmap/crests over every continent and poisoned later null-geojson commits + _captureCoarseBase
    // until a layer commit repaired _landGeoJSON. null falls through to the real stored geojson.
    this.setWaveData(gl, cbg, null);
    if (typeof window !== 'undefined') {
      const b = window.__MARINE_ZOOMOUT_BRIDGE__ = window.__MARINE_ZOOMOUT_BRIDGE__ || { count: 0 };
      b.count++; b.lastAt = Date.now();
    }
    return true;
  } catch (e) { return false; }
};

// Draw the retained coarse-global grid as a faded background wash. Same heatmap program + premultiplied blend as
// the main pass; height-alpha OFF (solid wash) and edge-feather OFF (it's global, no regional rectangle to soften).
WebGLMarineEngine.prototype._drawCoarseBasePass = function(gl, mat4, themeVal, time, baseOpacity, overlay) {
  const base = this._coarseBaseData;
  if (!base || !base.u_waveTexture || !base.bounds) return;
  const bb = base.bounds;

  let debugModeVal = 0.0;
  if (typeof window !== 'undefined' && window.__GPU_DEBUG__) {
    const mode = window.__GPU_DEBUG__.mode;
    if (mode === 'uv') debugModeVal = 1.0;
    else if (mode === 'mask') debugModeVal = 2.0;
    else if (mode === 'grid') debugModeVal = 3.0;
    else if (mode === 'mercator') debugModeVal = 4.0;
  }

  gl.useProgram(this.heatmapProgram);
  gl.uniformMatrix4fv(gl.getUniformLocation(this.heatmapProgram, 'u_matrix'), false, mat4);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_min'), bb.west, bb.south);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_dataBounds_max'), bb.east, bb.north);
  // The base binds its OWN world mask (encoded with the base grid), so its mask bounds = its grid.
  // Crisp coastal truth arrives via the OVERLAY slot below (replace-inside-bounds, per-pixel
  // fallback) — never by swapping this base mask, whose bounds must match the world draw.
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_maskBounds_min'), bb.west, bb.south);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_maskBounds_max'), bb.east, bb.north);
  // Viewport-truth overlay on the base wash (2026-07-04 zoom-out): the base is a WORLD grid whose
  // 39 km mask bleeds over land at z8+ — inside the overlay's bounds REPLACE the base sample at
  // meter truth (same rationale as the wide-grid main pass); per-pixel fallback everywhere else.
  const _bovOn = !!(overlay && overlay.tex && overlay.bounds);
  const _bob = _bovOn ? overlay.bounds : { west: 0, south: 0, east: 0, north: 0 };
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_overlayMaskTexture'), 4);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayMaskEnabled'), _bovOn ? 1.0 : 0.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayReplace'), _bovOn ? 1.0 : 0.0);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayBounds_min'), _bob.west, _bob.south);
  gl.uniform2f(gl.getUniformLocation(this.heatmapProgram, 'u_overlayBounds_max'), _bob.east, _bob.north);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_waveTexture'), 0);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_chlorophyllTexture'), 1);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_bathymetryTexture'), 2);
  gl.uniform1i(gl.getUniformLocation(this.heatmapProgram, 'u_oceanMaskTexture'), 3);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_theme'), themeVal);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_edgeFeatherEnabled'), 0.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_debug_mode'), debugModeVal);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_is_estimated'), 0.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_surfMode'), 0.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_ribbonRadiusDeg'), 0.0); // honest wash: never ring-sample
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_bandInlandGate'), 0.0);  // (inert here — band branch never runs on the wash)
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_time'), time);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_heightAlphaEnabled'), 0.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_heightAlphaLo'), 0.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_heightAlphaHi'), 1.0);
  // Same crisp-edge verdict as the main pass — the wash's coarse mask edge was the other halo face.
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_maskEdgeSharp'), this._maskEdgeSharp || 0.0);
  gl.uniform1f(gl.getUniformLocation(this.heatmapProgram, 'u_opacity'), baseOpacity);

  bindTexture(gl, base.u_waveTexture, 0);
  bindTexture(gl, base.u_chlorophyllTexture, 1);
  bindTexture(gl, base.u_bathymetryTexture, 2);
  bindTexture(gl, base.u_oceanMaskTexture, 3);
  bindTexture(gl, _bovOn ? overlay.tex : base.u_oceanMaskTexture, 4);

  const heatLngOffsetLoc = gl.getUniformLocation(this.heatmapProgram, 'u_lng_offset');
  let heatUVLoc = -1;
  if (this.heatmapVAO) {
    gl.bindVertexArray(this.heatmapVAO);
  } else {
    heatUVLoc = gl.getAttribLocation(this.heatmapProgram, 'a_grid_uv');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridUVBuffer);
    gl.enableVertexAttribArray(heatUVLoc);
    gl.vertexAttribPointer(heatUVLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIndexBuffer);
  }

  const worldOffsets = [0.0, -360.0, 360.0];
  for (let wi = 0; wi < worldOffsets.length; wi++) {
    gl.uniform1f(heatLngOffsetLoc, worldOffsets[wi]);
    gl.drawElements(gl.TRIANGLES, this.numGridIndices, gl.UNSIGNED_SHORT, 0);
    if (typeof window !== 'undefined' && window.__RAW_GPU__) window.__RAW_GPU__.drawCallsPerFrame++;
  }

  if (this.heatmapVAO) {
    gl.bindVertexArray(null);
  } else if (heatUVLoc !== -1) {
    gl.disableVertexAttribArray(heatUVLoc);
  }
};

WebGLMarineEngine.prototype.clearBuffers = function(gl) {
  if (!gl) return;
  console.log('[WebGLMarineEngine-Clear] Clearing resident wave textures and waveData');
  recordMarineEvent('engine_clear', {
    hadResident: !!(this._waveData && this._waveData.waveGrid),
    residentDims: this._waveData && this._waveData.waveGrid
      ? `${this._waveData.waveGrid.cols}x${this._waveData.waveGrid.rows}` : null,
  });
  this._freeCoarseBase(gl);
  if (this._waveData) {
    if (this._waveData.u_waveTexture && this._waveData.u_waveTexture !== this._residentWaveTex) {
      safeDeleteTexture(gl, this._waveData.u_waveTexture, this);
    }
    if (this._waveData.u_chlorophyllTexture && this._waveData.u_chlorophyllTexture !== this._residentChlTex) {
      safeDeleteTexture(gl, this._waveData.u_chlorophyllTexture, this);
    }
    if (this._waveData.u_bathymetryTexture && this._waveData.u_bathymetryTexture !== this._residentBathTex) {
      safeDeleteTexture(gl, this._waveData.u_bathymetryTexture, this);
    }
    if (this._waveData.u_oceanMaskTexture && this._waveData.u_oceanMaskTexture !== this._cachedMaskTex) {
      safeDeleteTexture(gl, this._waveData.u_oceanMaskTexture, this);
    }
    // §0e: the score variant follows the same resident-ownership contract as the wave texture.
    if (this._waveData.u_waveScoreTexture && this._waveData.u_waveScoreTexture !== this._residentScoreTex) {
      safeDeleteTexture(gl, this._waveData.u_waveScoreTexture, this);
    }
    this._waveData = null;
  }
};
WebGLMarineEngine.prototype.dispose = function(gl) {
  disposeEngine(this, gl);
};

export default WebGLMarineEngine;
