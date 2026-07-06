// inlandWaterGuard.js — "the basemap refines the coastline; it cannot invent new seas" (2026-07-06).
//
// THE SALTON-SEA / LAGUNA-SALADA LEAK: the basemap-water truth patch whitens water features and
// treats CLASS-LESS features as ocean — but Mapbox Streets v8's `water` source layer is "a polygon
// layer with no differentiating types or classes ... a single merged shape per tile" (Mapbox docs),
// so on this basemap EVERY lake, reservoir and inland sea arrives class-less and reads as ocean.
// The sheltered-water connectivity classifier didn't catch these either: it skips canvases with
// lonSpan >= 10°, and the socal regional tile is EXACTLY 10.0° wide (-125..-115) — so at z≥7 the
// patch painted the Salton Sea and Laguna Salada white with nothing downstream to suppress them,
// and the wash rendered in them (live user report).
//
// THE GUARD: basemap water may only whiten pixels within ~maxKm (default 10 km) of NATURAL-EARTH
// water — the authoritative macro-scale ocean truth already rendered on the canvas before the
// patch. Coastal corrections (port channels, inlets, barrier-island lagoons, NE generalization
// error) all live within a few km of NE water and keep working; water deeper inland than maxKm
// (Salton ~60 km, Laguna Salada ~40 km, Great-Lakes class) re-blacks. Distance-limited trust is
// zoom- and span-independent, so it also covers the classifier's span gaps.
//
// Kill switch: window.__RAW_DISABLE_INLAND_WATER_GUARD__ = true.
// Tune: window.__RAW_INLAND_WATER_KM__ (default 10).
// Telemetry: window.__RAW_GPU__.inlandWaterGuard.

// Pure grid core (exported for tests): pixels that are painted water (water=1) but NOT Natural-
// Earth water (neWater=0) and farther than maxDistPx (Chebyshev) from ANY neWater pixel.
// Two-pass 8-neighbour chamfer — same O(w·h) idiom as classifySheltered.
export function classifyInlandWater(water, neWater, w, h, maxDistPx) {
  const INF = 0x3fffffff;
  const size = w * h;
  const dist = new Int32Array(size);
  for (let i = 0; i < size; i++) dist[i] = neWater[i] ? 0 : INF;
  // forward pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      let m = dist[i];
      if (x > 0 && dist[i - 1] + 1 < m) m = dist[i - 1] + 1;
      if (y > 0) {
        const up = i - w;
        if (dist[up] + 1 < m) m = dist[up] + 1;
        if (x > 0 && dist[up - 1] + 1 < m) m = dist[up - 1] + 1;
        if (x < w - 1 && dist[up + 1] + 1 < m) m = dist[up + 1] + 1;
      }
      dist[i] = m;
    }
  }
  // backward pass
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      let m = dist[i];
      if (x < w - 1 && dist[i + 1] + 1 < m) m = dist[i + 1] + 1;
      if (y < h - 1) {
        const dn = i + w;
        if (dist[dn] + 1 < m) m = dist[dn] + 1;
        if (x > 0 && dist[dn - 1] + 1 < m) m = dist[dn - 1] + 1;
        if (x < w - 1 && dist[dn + 1] + 1 < m) m = dist[dn + 1] + 1;
      }
      dist[i] = m;
    }
  }
  const reblack = new Uint8Array(size);
  let count = 0;
  for (let i = 0; i < size; i++) {
    if (water[i] && !neWater[i] && dist[i] > maxDistPx) {
      reblack[i] = 1;
      count++;
    }
  }
  return { reblack, count };
}

// Pure gate (exported for tests): a canvas smaller than ~2× the trust distance cannot tell "deep
// inland" from "tiny window near an off-canvas coast" when it holds NO NE water — skip rather than
// re-black genuine harbor water at deep zoom. Canvases WITH NE water in frame always have context.
// (Regional-grid deep-zoom overlays min()-combine with the guarded BASE mask, so a skipped small
// canvas still inherits the base's inland verdict.)
export function shouldRunInlandGuard(canvasWidthKm, hasNeWater, maxKm) {
  if (hasNeWater) return true;
  return canvasWidthKm >= 2 * maxKm;
}

/**
 * Canvas applier. `neSnapshot` is a downsampled ImageData of the canvas BEFORE the basemap water
 * pass (NE-only truth; red channel ≥128 = water). Re-blacks painted water farther than maxKm from
 * NE water. Never throws; returns stats ({ applied, reblackedFrac, ... }) or { applied: false }.
 */
export function applyInlandWaterGuard(canvas, neSnapshot, bounds, opts) {
  try {
    if (typeof window !== 'undefined' && window.__RAW_DISABLE_INLAND_WATER_GUARD__ === true) {
      return { applied: false, reason: 'disabled' };
    }
    if (!canvas || !neSnapshot || !bounds || typeof document === 'undefined') {
      return { applied: false, reason: 'no_input' };
    }
    const spanLon = (bounds.east < bounds.west) ? (bounds.east + 360) - bounds.west : bounds.east - bounds.west;
    if (spanLon <= 0) return { applied: false, reason: 'degenerate_bounds' };
    const maxKm = (opts && opts.maxKm) ||
      (typeof window !== 'undefined' && Number(window.__RAW_INLAND_WATER_KM__)) || 10;
    const dsW = neSnapshot.width;
    const dsH = neSnapshot.height;
    const latMid = (bounds.north + bounds.south) / 2;
    const mPerPx = (spanLon * 111320 * Math.abs(Math.cos(latMid * Math.PI / 180))) / dsW;
    if (!(mPerPx > 0)) return { applied: false, reason: 'degenerate_scale' };
    const maxDistPx = Math.max(1, Math.round((maxKm * 1000) / mPerPx));

    const size = dsW * dsH;
    const nePx = neSnapshot.data;
    const neWater = new Uint8Array(size);
    let neCount = 0;
    for (let i = 0; i < size; i++) {
      if (nePx[i * 4] >= 128) { neWater[i] = 1; neCount++; }
    }
    const canvasWidthKm = (spanLon * 111.32 * Math.abs(Math.cos(latMid * Math.PI / 180)));
    if (!shouldRunInlandGuard(canvasWidthKm, neCount > 0, maxKm)) {
      return { applied: false, reason: 'small_canvas_no_ne_context' };
    }

    // Downsample the PAINTED canvas to the same grid. Smoothing ON (area average) so thin painted
    // water still registers — mirrors the sheltered classifier's sampling rationale.
    const ds = document.createElement('canvas');
    ds.width = dsW; ds.height = dsH;
    const dctx = ds.getContext('2d', { willReadFrequently: true });
    if (!dctx) return { applied: false, reason: 'no_ctx' };
    dctx.imageSmoothingEnabled = true;
    dctx.drawImage(canvas, 0, 0, dsW, dsH);
    const img = dctx.getImageData(0, 0, dsW, dsH);
    const px = img.data;
    const water = new Uint8Array(size);
    for (let i = 0; i < size; i++) water[i] = px[i * 4] >= 128 ? 1 : 0;

    const { reblack, count } = classifyInlandWater(water, neWater, dsW, dsH, maxDistPx);
    if (!count) return { applied: true, reblackedFrac: 0, maxDistPx, mPerPx: Math.round(mPerPx) };

    // Stamp: opaque black where re-blacked, transparent elsewhere; hard-edged upscale. Blocky at
    // ds resolution — invisible by construction (every re-blacked pixel is ≥maxKm inland).
    for (let i = 0; i < size; i++) {
      if (reblack[i]) { px[i * 4] = 0; px[i * 4 + 1] = 0; px[i * 4 + 2] = 0; px[i * 4 + 3] = 255; }
      else { px[i * 4 + 3] = 0; }
    }
    dctx.putImageData(img, 0, 0);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ds, 0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = prevSmooth;
    return {
      applied: true,
      reblackedFrac: +(count / Math.max(1, size)).toFixed(4),
      maxDistPx,
      mPerPx: Math.round(mPerPx),
    };
  } catch (e) {
    return { applied: false, reason: 'error' };
  }
}

// Downsampled NE-truth snapshot of a canvas (call BEFORE the basemap water pass paints on it).
export function snapshotNeTruth(canvas, dsWidthCap = 1024) {
  try {
    if (!canvas || typeof document === 'undefined') return null;
    const dsW = Math.min(dsWidthCap, canvas.width);
    const scale = dsW / canvas.width;
    const dsH = Math.max(2, Math.round(canvas.height * scale));
    const ds = document.createElement('canvas');
    ds.width = dsW; ds.height = dsH;
    const dctx = ds.getContext('2d', { willReadFrequently: true });
    if (!dctx) return null;
    dctx.imageSmoothingEnabled = true;
    dctx.drawImage(canvas, 0, 0, dsW, dsH);
    return dctx.getImageData(0, 0, dsW, dsH);
  } catch (e) {
    return null;
  }
}
