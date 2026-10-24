/**
 * waveLakesShow.js — the GPU frame store's half of waveLakes.js (2026-10-23).
 *
 * The frame store holds GFS sets only and shows a stored frame WITHOUT a commit (no encoder, so no mask decision). After an EURO
 * commit whose mask has carried lakes cut in, an EURO -> GFS switch served from the store would draw GFS bytes under lit lakes:
 * GFS has no lake data there, so the lake shows the encoder's extrapolation or height 0, a mislabelled "fake calm" (a defect).
 * So the resident mask becomes the plain-land mask IN THE SAME SHOW:
 *   - `lakeShowPlan(engine, model)`: 'keep' (the resident mask has no lakes, or the model carries lakes), 'swap' (either stash slot
 *     holds the plain-land mask for the resident's bounds: a reference swap, no raster), or 'decline' (no ready plain-land
 *     texture: the show declines and the normal commit path draws, its encoder choosing the plain mask);
 *   - `applyLakeSwap(gl, engine)`: does the planned swap (the stash takes the lake mask, so switching back is a swap too) and points
 *     the drawn frame at it. Called only once the frame copy succeeded, so a declined show never changes the mask.
 * Kill: window.__RAW_DISABLE_WAVE_LAKES__ = true (no lake is ever cut, so every plan is 'keep').
 */
import { LAKE_MODELS, maskLakes, waveLakesOn } from './waveLakes';
import { installStashedMask, stashResidentMask, stashServesAny, takeMaskStash, maskStashEnabled } from './maskTextureStash';
import { keepMaskPatch } from './maskPatchKeep';

const boundsKey = (b) => (b ? `${b.west}_${b.south}_${b.east}_${b.north}` : '');

export function lakeShowPlan(engine, model) {
  const geo = engine && engine._cachedMaskGeoJSON;
  if (!waveLakesOn() || !engine || !engine._cachedMaskTex || !maskLakes(geo).length) return 'keep';
  if (LAKE_MODELS.includes(String(model || 'GFS').toUpperCase())) return 'keep';
  if (!geo.__base || !maskStashEnabled()) return 'decline';
  // A degraded basemap paint on the lake mask cannot be stashed (maskTextureStash): the normal path rebuilds instead.
  const rp = engine._regionalPatchState;
  if (rp && rp.degraded && rp.gridKey === boundsKey(engine._cachedMaskBounds)) return 'decline';
  return stashServesAny(engine, geo.__base, engine._cachedMaskBounds) ? 'swap' : 'decline';
}

function bumpSwaps() {
  if (typeof window === 'undefined') return;
  const t = window.__RAW_WAVE_LAKES__ || {};
  window.__RAW_WAVE_LAKES__ = { ...t, showSwaps: (t.showSwaps || 0) + 1 };
}

/** The reference swap planned by lakeShowPlan ('swap'). Returns true when the drawn frame now samples the plain-land mask. */
export function applyLakeSwap(gl, engine) {
  const geo = engine && engine._cachedMaskGeoJSON;
  if (!gl || !geo || !geo.__base) return false;
  const entry = takeMaskStash(engine, geo.__base, engine._cachedMaskBounds);   // either slot (the stash's variant slot)
  if (!entry || !entry.tex) return false;
  const out = { tex: engine._cachedMaskTex, dims: engine._cachedMaskTexDims };
  if (out.tex && !stashResidentMask(gl, engine, null)) {
    // Not expected (lakeShowPlan declines the one refusal case); free it with the encoder's accounting rather than strand it.
    try { gl.deleteTexture(out.tex); } catch (e) { /* lost context */ }
    if (typeof window !== 'undefined' && window.__RAW_GPU__ && out.dims) {
      window.__RAW_GPU__.textureCount--;
      window.__RAW_GPU__.gpuMemoryEstimate -= out.dims.w * out.dims.h * 4;
    }
  }
  const tex = installStashedMask(engine, entry);
  if (engine._waveData) engine._waveData.u_oceanMaskTexture = tex;
  // The paint record follows the texture now bound (a clean earlier paint comes back, as after a reuse commit; none -> null).
  if (!keepMaskPatch(engine, engine._waveData)) engine._regionalPatchState = null;
  bumpSwaps();
  return true;
}
