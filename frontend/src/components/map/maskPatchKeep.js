/**
 * maskPatchKeep.js — a commit that keeps the very mask texture that was painted keeps its basemap-water paint record (2026-10-23).
 *
 * WHY. setWaveData forgets the regional patch record on every commit ("every commit re-encodes the mask WITHOUT the basemap-truth
 * patch"), so the trailing refreshMaskWithBasemapWater repaints. That is right when the encoder built a NEW mask texture. It is
 * wrong when the encoder REUSED the cached one (same bounds and land GeoJSON, `_lastMaskEncodeMode === 'reuse'`): nothing was
 * uploaded, the texture still holds the paint, and the repaint redraws the same pixels on the main thread.
 *   - Live, dev 5460d13b, the map's opening view (z9, Florida east coast), 10 one-hour steps 600 ms apart (the lead's read,
 *     2026-10-23): maskWaterPaint 8 calls, 853 ms (~107 ms each); 4 of 10 steps drew a 127-182 ms frame.
 *   - Offline (scn_main_thread.js, the same view, the real basemap): every commit repainted, 136-254 ms each; 5 of the 7 paints
 *     were on a REUSED mask with an unchanged view, delivered coverage and zoom (the record was null because of the reset).
 *
 * WHAT. A paint stamps its record on the texture it painted (`tex.__rsPatch`). After a commit, when the bound mask is that very
 * texture and its record names the current mask bounds, the record comes back, and the refresh's own hysteresis (same bounds, the
 * view inside the painted box, a clean paint, a stable zoom, delivered coverage) decides exactly as if no commit had happened. A
 * NEW texture (a rebuild; a stash swap of a texture never painted) carries no record and repaints as before. The paint depends on
 * the map's water features, the view and the mask bounds, never on the wave data, so the record stays true across data commits.
 * Kill: window.__RAW_DISABLE_MASK_PATCH_KEEP__ = true (forget on every commit, as before).
 */
export function maskPatchKeepEnabled() {
  return typeof window === 'undefined' || window.__RAW_DISABLE_MASK_PATCH_KEEP__ !== true;
}

/** The key refreshMaskWithBasemapWater files a paint under: the mask texture's bounds. */
export function maskGridKey(b) {
  return b ? `${b.west}_${b.south}_${b.east}_${b.north}` : null;
}

/** The paint record also goes on the painted texture; returns the record (the engine keeps it as _regionalPatchState). */
export function stampMaskPatch(tex, record) {
  if (tex && record && typeof tex === 'object') {
    try { Object.defineProperty(tex, '__rsPatch', { value: record, configurable: true, writable: true }); } catch (e) { tex.__rsPatch = record; }
  }
  return record;
}

/** After a commit installed `waveData`: give the paint record back when the bound mask is still the painted texture. */
export function keepMaskPatch(engine, waveData) {
  if (!engine || !maskPatchKeepEnabled()) return false;
  const tex = waveData && waveData.u_oceanMaskTexture;
  const rec = tex && typeof tex === 'object' && tex === engine._cachedMaskTex ? tex.__rsPatch : null;
  if (!rec || rec.gridKey !== maskGridKey(engine._cachedMaskBounds)) return false;
  engine._regionalPatchState = rec;
  if (typeof window !== 'undefined' && window.__RAW_GPU__) window.__RAW_GPU__.maskPatchKept = (window.__RAW_GPU__.maskPatchKept || 0) + 1;
  return true;
}
