// LAND-MASK STASH (2026-10-19): the second entry of the encoder's mask cache. Pure rules + texture bookkeeping for
// WebGLMarineTextureEncoder's REBUILD branch.
//
// WHY. Zoomed in, a layer or model switch alternates the committed grid between the world frame (a series page) and the
// viewport's own grid (the mid tier sharpened in the background, mid_res_tier._schedule_sharpen), and every alternation
// rebuilt the land mask: 9 rebuilds of the 4096 x 2048 mask in a dozen zoomed-in switches in the offline harness
// (scn_mask_cost.js over serve_synthetic.py --regions ... --dynamic 1), each a 57-242 ms setWaveData on desktop, the owner's
// "High-resolution land mask texture created (4096x2048)" x8 of 2026-10-19. The same two bounds came back again and again.
//
// WHAT. When the encoder REBUILDS, the outgoing resident texture is kept in a one-slot stash instead of being deleted. A later
// rebuild whose geojson and bounds the stash matches swaps it back in (no polygon paint, no SDF, no 32 MB upload) and the
// outgoing resident takes the slot. It runs ONLY where the encoder had already decided to rebuild, so reuse, retain-patched,
// the no-downgrade retain, the close-zoom carve-out and the density floor all decide first, unchanged.
//
// SAFETY. The swapped-in texture is exactly what a rebuild of those bounds would draw, or better:
//   * same geojson OBJECT and identical bounds and dims (a world texture also matches a covered world frame, the #347 rule);
//   * a texture that carries a DEGRADED basemap-water paint is never stashed (the patch-carry rule in WebGLMarineEngine);
//   * if the patch carry would transplant truth onto a rebuild that the stash does not already hold (the last painted box
//     belongs to OTHER bounds and overlaps these), the stash declines and the rebuild runs, carry included.
// The trailing basemap-water refresh runs after a swap exactly as after a rebuild (its grid key changed).
// Cost: one extra mask texture held (up to 32 MB of GPU memory), counted in __RAW_GPU__.
// Kill: window.__RAW_DISABLE_MASK_STASH__ = true (every rebuild deletes the outgoing mask, as before).
//
// VARIANT SLOT (2026-10-23, waveLakes.js). Once a mask with carried lakes cut in is in play, one model's mask and another's
// differ for the SAME bounds (EURO cuts the Great Lakes, GFS does not), so a zoomed-in EURO <-> GFS toggle cycles THREE masks
// (offline z8 Lake Michigan: the plain world mask for GFS, EURO's world series page with lakes, EURO's viewport with lakes) through
// two places (the resident and the stash), and every toggle rebuilt one (setWaveData 250-375 ms vs 5-15 ms without lakes). So a
// second slot, `engine._maskStash2`, takes what the first slot would have evicted (and a resident the WORLD PIN refuses), and the
// toggle is a reference swap again. It is used only while a lake mask is in play (one is resident or held), so a session that
// never sees a carried lake holds exactly what it held before. Cost: one more mask texture (up to 32 MB of GPU memory, desktop
// only: the stash is off on handhelds). Kill: window.__RAW_DISABLE_MASK_STASH_VARIANT__ = true (one slot, as before).
import { maskCanvasWidthForSpan, incomingMaskDensityPxPerDeg } from './WebGLMarineMaskRenderer';
import { maskCoversWorldFrame } from './maskCoverReuse';
import { computePatchCarryRects } from './maskSmoothing';
import { recordMarineEvent } from './marineForensics';
import { isHandheldDevice } from './deviceTier';

const WORLD_SPAN_DEG = 340; // the client's own world threshold (maskCoverReuse.js)
const span = (b) => ((b.east < b.west) ? b.east + 360 : b.east) - b.west;
const sameBounds = (a, b) => !!a && !!b && a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north;
const boundsKey = (b) => `${b.west}_${b.south}_${b.east}_${b.north}`;

// HANDHELD GATE (review 2026-10-19): the stash holds one extra mask texture (up to 32 MB of GPU memory), and phones are where
// the OOM forensics live (iOS Safari exposes no deviceMemory to size it by). Off on handhelds (deviceTier.js) until it is read
// on a real low-end phone; window.__RAW_MASK_STASH_HANDHELD__ = true opts a phone in for that read.
export function maskStashEnabled() {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_STASH__ === true) return false;
  return !isHandheldDevice() || (typeof window !== 'undefined' && window.__RAW_MASK_STASH_HANDHELD__ === true);
}

const hasLakes = (geo) => !!(geo && Array.isArray(geo.__waveLakes) && geo.__waveLakes.length);
function variantSlotOn(engine) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_STASH_VARIANT__ === true) return false;
  return !!engine._maskStash2 || hasLakes(engine._cachedMaskGeoJSON) || !!(engine._maskStash && hasLakes(engine._maskStash.geojson));
}

function bump(name) {
  if (typeof window !== 'undefined') window[name] = (window[name] || 0) + 1;
}

/** Delete a stashed texture with the encoder's own accounting (it created the texture with a raw gl.createTexture). */
function evict(gl, entry) {
  if (!entry || !entry.tex) return;
  try { gl.deleteTexture(entry.tex); } catch (e) { /* lost context: nothing to free */ }
  if (typeof window !== 'undefined' && window.__RAW_GPU__) {
    window.__RAW_GPU__.textureCount--;
    window.__RAW_GPU__.gpuMemoryEstimate -= entry.dims.w * entry.dims.h * 4;
  }
}

/** True when `tex` is the stashed mask: the engine's texture cleanup must not delete it (WebGLWindUtils.safeDeleteTexture). */
export function isStashedMaskTex(engine, tex) {
  return !!(engine && tex && ((engine._maskStash && engine._maskStash.tex === tex) || (engine._maskStash2 && engine._maskStash2.tex === tex)));
}

/**
 * Would the encoder's patch carry paint truth onto a fresh rebuild of `bounds` that the stashed texture (built for
 * `entryBounds`) may not hold? Mirrors the carry's own gates (kill switch, >= 32 px/deg destination, overlap).
 */
export function carryWouldAddTruth(lastPatched, entryBounds, bounds) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_MASK_PATCH_CARRY__ === true) return false;
  if (!lastPatched || !lastPatched.canvas || !lastPatched.bounds || !lastPatched.box) return false;
  if (incomingMaskDensityPxPerDeg(bounds) < 32 || span(bounds) >= 30) return false;
  if (sameBounds(lastPatched.bounds, entryBounds)) return false; // painted on this very geography: the stash holds it
  const w = maskCanvasWidthForSpan(span(bounds));
  return !!computePatchCarryRects(lastPatched.box, lastPatched.bounds, lastPatched.canvas.width, lastPatched.canvas.height,
    bounds, w, w / 2);
}

/**
 * PATCH TRUST (2026-10-23): does the stashed texture already hold the truth the carry would transplant? It does when its own
 * paint record (maskPatchKeep.js, `tex.__rsPatch`) is a CLEAN paint filed under the stashed bounds whose box contains the last
 * painted box. Two boxes alternating at one view (z9 Florida offline: the /grid tile, north 30, and the series frame, north 29)
 * then swap back with their paint instead of rebuilding and repainting (~150-200 ms each). Kill: __RAW_DISABLE_STASH_PATCH_TRUST__.
 */
export function stashHoldsPatch(entry, lastPatched) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_STASH_PATCH_TRUST__ === true) return false;
  const r = entry && entry.tex && entry.tex.__rsPatch;
  const b = lastPatched && lastPatched.box;
  if (!r || r.degraded || !r.box || !b || r.gridKey !== boundsKey(entry.bounds)) return false;
  return r.box.west <= b.west && r.box.east >= b.east && r.box.south <= b.south && r.box.north >= b.north;
}

/** The decision, pure: does stash entry `entry` serve a mask for (geojson, bounds)? */
export function stashServes(entry, geojson, bounds, lastPatched) {
  if (!entry || !entry.tex || !entry.dims || !entry.bounds || !bounds || entry.geojson !== geojson) return false;
  const exact = sameBounds(entry.bounds, bounds) && entry.dims.w === maskCanvasWidthForSpan(span(bounds));
  if (!exact && !maskCoversWorldFrame(entry.bounds, entry.dims, bounds)) return false;
  return !carryWouldAddTruth(lastPatched, entry.bounds, bounds) || stashHoldsPatch(entry, lastPatched);
}

/** Take the stash entry (either slot) that serves this rebuild out of the engine; null otherwise (both stay). */
export function takeMaskStash(engine, geojson, bounds) {
  if (!engine || !maskStashEnabled()) return null;
  const entry = engine._maskStash;
  if (stashServes(entry, geojson, bounds, engine._lastPatchedMask)) { engine._maskStash = null; return entry; }
  const alt = engine._maskStash2;
  if (alt && stashServes(alt, geojson, bounds, engine._lastPatchedMask)) { engine._maskStash2 = null; bump('__RAW_MASK_STASH_VARIANT_HIT__'); return alt; }
  return null;
}

/** Would takeMaskStash serve (geojson, bounds) from either slot? Pure. */
export function stashServesAny(engine, geojson, bounds) {
  if (!engine || !maskStashEnabled()) return false;
  return stashServes(engine._maskStash, geojson, bounds, engine._lastPatchedMask)
    || stashServes(engine._maskStash2, geojson, bounds, engine._lastPatchedMask);
}

/**
 * Move the resident mask into the stash (evicting what the stash held). Returns false when it cannot be kept, and the
 * caller deletes it as before: stash off, no resident, a resident carrying a DEGRADED basemap-water paint, or a REGIONAL
 * resident while the stash holds a WORLD mask of the current world geojson (`worldGeoJSON`, the caller's land geojson).
 * WORLD PIN: zoomed in, several viewport boxes arrive between world frames (z9 in the harness: world, A, B, C, world), and a
 * plain one-slot stash let each box evict the world mask, which is the one that keeps coming back (every series page) and
 * the costliest to paint (all ~1420 polygons, ~280 ms vs 70-90 ms for a viewport box on desktop).
 */
export function stashResidentMask(gl, engine, worldGeoJSON) {
  if (!engine || !engine._cachedMaskTex || !engine._cachedMaskTexDims || !engine._cachedMaskBounds) return false;
  if (!maskStashEnabled()) {
    evict(gl, engine._maskStash); evict(gl, engine._maskStash2); engine._maskStash = null; engine._maskStash2 = null; return false;
  }
  const rp = engine._regionalPatchState;
  if (rp && rp.degraded && rp.gridKey === boundsKey(engine._cachedMaskBounds)) return false;
  const held = engine._maskStash;
  const variant = variantSlotOn(engine);
  if (!variant && engine._maskStash2) { evict(gl, engine._maskStash2); engine._maskStash2 = null; }   // the slot was killed
  const resident = {
    tex: engine._cachedMaskTex, dims: engine._cachedMaskTexDims, bounds: engine._cachedMaskBounds,
    geojson: engine._cachedMaskGeoJSON, hasSDF: !!engine._cachedMaskHasSDF,
  };
  if (held && span(held.bounds) >= WORLD_SPAN_DEG && held.geojson === worldGeoJSON && worldGeoJSON
      && span(engine._cachedMaskBounds) < WORLD_SPAN_DEG) {
    if (!variant) return false;
    evict(gl, engine._maskStash2);                  // WORLD PIN keeps the world mask; the variant slot keeps the regional one
    engine._maskStash2 = resident;
  } else if (variant) {
    if (held) {                                     // the first slot's entry moves down instead of being freed
      evict(gl, engine._maskStash2);
      engine._maskStash2 = held;
    }                                               // (slot 1 empty: the rebuild took it; slot 2 keeps what it holds)
    engine._maskStash = resident;
  } else {
    evict(gl, engine._maskStash);
    engine._maskStash = resident;
  }
  engine._cachedMaskTex = null;
  engine._cachedMaskTexDims = null;
  return true;
}

/** Make a taken stash entry the resident mask; returns its texture. */
export function installStashedMask(engine, entry) {
  engine._cachedMaskTex = entry.tex;
  engine._cachedMaskTexDims = entry.dims;
  engine._cachedMaskBounds = { ...entry.bounds };
  engine._cachedMaskGeoJSON = entry.geojson;
  engine._cachedMaskHasSDF = entry.hasSDF;
  engine._lastMaskEncodeMode = 'stash_swap';
  bump('__RAW_MASK_STASH_SWAP__');
  recordMarineEvent('mask_stash_swap', { dims: `${entry.dims.w}x${entry.dims.h}` });
  return entry.tex;
}

/**
 * Transaction rollback (the encoder's catch): a texture swapped in from the stash is in neither the transaction's allocations
 * nor the stash, so nulling _cachedMaskTex would strand it (up to 32 MB, still counted in __RAW_GPU__). Free it with accounting.
 */
export function releaseSwappedMask(gl, engine) {
  if (!engine || engine._lastMaskEncodeMode !== 'stash_swap' || !engine._cachedMaskTex || !engine._cachedMaskTexDims) return;
  // A swap from an EARLIER call whose texture the live frame still binds is not stranded: the engine frees it with that frame.
  if (engine._waveData && engine._waveData.u_oceanMaskTexture === engine._cachedMaskTex) return;
  evict(gl, { tex: engine._cachedMaskTex, dims: engine._cachedMaskTexDims });
  engine._cachedMaskTex = null;
  engine._cachedMaskTexDims = null;
}

/** Engine teardown: free the stashed texture. */
export function freeMaskStash(gl, engine) {
  if (!engine) return;
  if (gl) { evict(gl, engine._maskStash); evict(gl, engine._maskStash2); }
  engine._maskStash = null;
  engine._maskStash2 = null;
}
