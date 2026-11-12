// iconSwell2SeriesBlend.js — the ICON swell_2 blend served from cached GFS + EURO series frames.
// Moved verbatim out of marineGridSeries.js (2026-11-12, LOC ratchet); no behaviour change.

import { blendIconSwell2, isIconSwell2Blend } from './iconSwell2Blend';

// ICON SWELL 2 FROM THE SERIES (2026-10-19). ICON has no swell_2 product: the map shows a GFS/EURO blend
// (iconSwell2Blend.js, owner decision D-003). Before this, that blend existed ONLY on the per-hour path, so every scrub
// step on ICON Swell 2 waited for two /grid fetches plus a main-thread blend ("one marine layer scrubbed quickly, after
// switching to the next it stopped", owner 2026-10-19). Now the series path serves the same blend from the GFS and EURO
// swell_2 series frames already cached: same function, same weights, no network. A step with either input missing still
// misses here and takes the per-hour blend, exactly as before. Kill: window.__RAW_DISABLE_ICON_SWELL2_SERIES_BLEND__ = true.
export function iconSwell2SeriesBlendOn(model, layer, hourOffset) {
  return isIconSwell2Blend(model, layer, hourOffset)
    && !(typeof window !== 'undefined' && window.__RAW_DISABLE_ICON_SWELL2_SERIES_BLEND__ === true);
}
const _iconSwell2BlendMemo = new WeakMap();   // gfs grid -> Map(euro grid -> blended marineData)
export function blendIconSwell2Frames(gfsFrame, euroFrame, bounds) {
  let inner = _iconSwell2BlendMemo.get(gfsFrame.grid);
  if (!inner) { inner = new Map(); _iconSwell2BlendMemo.set(gfsFrame.grid, inner); }
  const hit = inner.get(euroFrame.grid);
  if (hit) return hit;
  const md = blendIconSwell2(gfsFrame.grid, euroFrame.grid, gfsFrame.hourOffset, bounds, { quiet: true });
  if (!md || !md.grid || md.grid.renderable === false) return null;
  md.__fromSeries = true;
  md.__sourceModel = 'ICON';
  md.valid_time = gfsFrame.valid_time || null;
  md.grid.__fromSeries = true;
  md.grid.valid_time = gfsFrame.grid.valid_time || gfsFrame.valid_time || null;
  md.grid.__decimatedStride = Math.max(gfsFrame.grid.__decimatedStride || 0, euroFrame.grid.__decimatedStride || 0);
  md.product_id = `series_ICON_swell_2_h${gfsFrame.hourOffset}`;
  if (inner.size > 4) inner.clear();
  inner.set(euroFrame.grid, md);
  return md;
}
