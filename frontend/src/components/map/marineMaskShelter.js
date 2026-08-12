/**
 * marineMaskShelter.js — water the ocean cannot reach: lagoons, harbour basins, urban canals.
 *
 * Extracted verbatim from WebGLMarineMaskRenderer.js (2026-07-29) with no behavioural change, to
 * bring that file under the repo's 800-line governance limit. This seam is nearly free-standing:
 * `classifySheltered` is a pure grid algorithm with no imports at all, and only the canvas
 * wrappers reach back for the shared projector.
 *
 * ⚠️ The calibration comments below are live-tuned constants with incident history attached
 * (Venice's Porto di Lido at 600 m, Canal Grande's sub-pixel mottle, the "breaks between islands"
 * minimum-area filter). Do not round them off without re-running the live check they name.
 * `WebGLMarineMaskRenderer` re-exports every symbol here, so importers are unchanged.
 */
import { makeMaskProjector } from './marineMaskProjection';

// ── SHELTERED-WATER CLASSIFIER ──────────────────────────────────────────────────────────────────
// Pure grid core (exported for tests): given a binary water grid, mark water pixels that cannot
// reach the border through a channel of half-width > nPx. Erode water by nPx (Chebyshev distance
// to land), flood-fill the eroded core from the border, then re-dilate the flooded core by nPx —
// water not covered is enclosed. Two-pass chamfer transforms + one BFS: O(w·h).
export function classifySheltered(water, w, h, nPx) {
  const INF = 0x3fffffff;
  const size = w * h;
  // distance-to-LAND (Chebyshev, 8-neighbour chamfer)
  const dist = new Int32Array(size);
  for (let i = 0; i < size; i++) dist[i] = water[i] ? INF : 0;
  const chamfer = (d) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (d[i] === 0) continue;
        let m = d[i];
        if (x > 0 && d[i - 1] + 1 < m) m = d[i - 1] + 1;
        if (y > 0) {
          const up = i - w;
          if (d[up] + 1 < m) m = d[up] + 1;
          if (x > 0 && d[up - 1] + 1 < m) m = d[up - 1] + 1;
          if (x < w - 1 && d[up + 1] + 1 < m) m = d[up + 1] + 1;
        }
        d[i] = m;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (d[i] === 0) continue;
        let m = d[i];
        if (x < w - 1 && d[i + 1] + 1 < m) m = d[i + 1] + 1;
        if (y < h - 1) {
          const dn = i + w;
          if (d[dn] + 1 < m) m = d[dn] + 1;
          if (x > 0 && d[dn - 1] + 1 < m) m = d[dn - 1] + 1;
          if (x < w - 1 && d[dn + 1] + 1 < m) m = d[dn + 1] + 1;
        }
        d[i] = m;
      }
    }
  };
  chamfer(dist);
  // BFS the ERODED core (dist > nPx) from every border core pixel.
  const flooded = new Uint8Array(size);
  const queue = new Int32Array(size);
  let qh = 0, qt = 0;
  const push = (i) => { if (!flooded[i] && dist[i] > nPx) { flooded[i] = 1; queue[qt++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + (w - 1)); }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  // distance-to-FLOODED-core; open water = within nPx of the core. Water beyond it is enclosed.
  const dist2 = new Int32Array(size);
  for (let i = 0; i < size; i++) dist2[i] = flooded[i] ? 0 : INF;
  chamfer(dist2);
  const sheltered = new Uint8Array(size);
  let count = 0;
  for (let i = 0; i < size; i++) {
    if (water[i] && dist2[i] > nPx) { sheltered[i] = 1; count++; }
  }
  // MINIMUM-AREA FILTER (live calibration 2026-07-04, "breaks in the heatmap between islands"):
  // a long NARROW passage between islands also fails the erode-flood reachability test, but it is
  // open fairway, not an enclosed basin — suppressing it punched blocky gaps into the heatmap at
  // z12–16. Keep only basin-scale components: connected sheltered regions smaller than ~(4·nPx)²
  // pixels (≈ a few km² at the default gap) are released back to open water. True lagoons and
  // harbor basins are orders of magnitude larger.
  if (count) {
    const minArea = 16 * nPx * nPx;
    const nearOpen = 2 * nPx;   // "next to the open core" distance for the passage-vs-canal test
    const seen = new Uint8Array(size);
    const comp = new Int32Array(size);
    for (let s = 0; s < size; s++) {
      if (!sheltered[s] || seen[s]) continue;
      let ch = 0, ct = 0, near = 0;
      comp[ct++] = s; seen[s] = 1;
      while (ch < ct) {
        const i = comp[ch++];
        if (dist2[i] <= nearOpen) near++;
        const x = i % w, y = (i / w) | 0;
        if (x > 0 && sheltered[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; comp[ct++] = i - 1; }
        if (x < w - 1 && sheltered[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; comp[ct++] = i + 1; }
        if (y > 0 && sheltered[i - w] && !seen[i - w]) { seen[i - w] = 1; comp[ct++] = i - w; }
        if (y < h - 1 && sheltered[i + w] && !seen[i + w]) { seen[i + w] = 1; comp[ct++] = i + w; }
      }
      // Release a small component ONLY when it is genuinely a PASSAGE — most of it hugs the open
      // core (inter-island fairways, the round-3 "breaks between islands" catch). A long dead-end
      // urban canal (Canal Grande, live z16 catch) touches the core only at its mouth, so it stays
      // suppressed no matter how small its area is.
      if (ct < minArea && near > ct * 0.5) {
        for (let k = 0; k < ct; k++) sheltered[comp[k]] = 0;
        count -= ct;
      }
    }
  }
  return { sheltered, count };
}

// ── BASIN-VERDICT CACHE (2026-07-04, "heatmap on Canal Grande" with a REGIONAL grid resident) ────
// Sheltered truth can only be classified on basin-scale canvases (≥0.5° span), but the canvases
// that RESOLVE urban canals are the crisp deep-zoom overlays (≤0.1° span, classifier skipped by
// design — a window smaller than a basin mis-classifies). Bridge: every basin-scale classification
// stashes its downsampled verdict here; small canvases DARKEN themselves with the finest cached
// verdict that contains them. Darken = per-pixel min, so the verdict only ever REMOVES wash from
// water (land stays land, open water untouched) — the round-6 halo class cannot happen.
const _basinVerdicts = [];
const BASIN_VERDICT_MAX = 3;

// Pure selection: the finest-resolution cached verdict whose bounds CONTAIN the target bounds.
// Exported for tests.
export function pickBasinVerdict(entries, bounds) {
  let best = null;
  for (const e of entries) {
    if (!e || !e.bounds) continue;
    if (e.bounds.west <= bounds.west && e.bounds.east >= bounds.east &&
        e.bounds.south <= bounds.south && e.bounds.north >= bounds.north) {
      if (!best || e.mPerPx < best.mPerPx) best = e;
    }
  }
  return best;
}

function stashBasinVerdict(entry) {
  // Replace any older entry with identical bounds, newest first, cap the list.
  for (let i = _basinVerdicts.length - 1; i >= 0; i--) {
    const b = _basinVerdicts[i].bounds;
    if (b.west === entry.bounds.west && b.east === entry.bounds.east &&
        b.south === entry.bounds.south && b.north === entry.bounds.north) {
      _basinVerdicts.splice(i, 1);
    }
  }
  _basinVerdicts.unshift(entry);
  while (_basinVerdicts.length > BASIN_VERDICT_MAX) _basinVerdicts.pop();
}

// Darken a small (crisp) canvas with the cached basin verdict: the verdict's sheltered pixels are
// RGBA(64,64,64,255) and its open pixels are transparent, so a 'darken' draw min()s the sheltered
// blocks into the mask (water 255 → 64, below the 0.5 heatmap discard and 0.3 particle cull) and
// leaves everything else untouched. Blocky at the verdict's ds resolution — acceptable: it only
// dims water, never paints wash where truth says land.
export function applyCachedShelteredVerdict(canvas, bounds) {
  if (!canvas || !bounds) return { applied: false, fromCache: true, reason: 'no_canvas' };
  const hit = pickBasinVerdict(_basinVerdicts, bounds);
  if (!hit) return { applied: false, fromCache: true, reason: 'no_containing_verdict' };
  if (!hit.ds || !hit.count) return { applied: true, fromCache: true, shelteredFrac: 0, mPerPx: hit.mPerPx };
  try {
    const project = makeMaskProjector(hit.bounds, hit.dsW, hit.dsH);
    const [sx0, sy0] = project(bounds.west, bounds.north);
    const [sx1, sy1] = project(bounds.east, bounds.south);
    const sx = Math.min(sx0, sx1), sy = Math.min(sy0, sy1);
    const sw = Math.abs(sx1 - sx0), sh = Math.abs(sy1 - sy0);
    if (sw < 0.5 || sh < 0.5) return { applied: false, fromCache: true, reason: 'degenerate_subrect' };
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const prevSmooth = ctx.imageSmoothingEnabled;
    const prevComp = ctx.globalCompositeOperation;
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'darken';
    ctx.drawImage(hit.ds, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = prevComp;
    ctx.imageSmoothingEnabled = prevSmooth;
    return { applied: true, fromCache: true, mPerPx: hit.mPerPx, verdictBounds: hit.bounds };
  } catch (e) {
    return { applied: false, fromCache: true, reason: 'draw_failed' };
  }
}

// MORPHOLOGICAL CLOSE (dilate+erode by 1, 4-neighbour): a sub-pixel canal (Canal Grande is
// ~60 m vs 76 m/px ds) samples as a BROKEN run — the gap pixels read as land, never classify,
// and re-open as mottled wash blocks at deep zoom (live 2026-07-04). Closing bridges 1-2 px
// gaps without moving the outer sheltered boundary (dilate-then-erode is identity on solid
// blobs). Bridged pixels can lie on ds-land — harmless: 0.25 sits below every render threshold
// and the crisp-canvas darken path min()s against true land anyway.
// Extracted from suppressShelteredWater 2026-08-12 so the verdict CACHE can store the POST-close
// mask and a hit skips this too. Mutates `sheltered` in place, exactly as the inline block did.
export function _closeShelteredMask(sheltered, dsW, dsH) {
  const size = dsW * dsH;
  const dil = new Uint8Array(size);
  for (let y = 0; y < dsH; y++) {
    for (let x = 0; x < dsW; x++) {
      const i = y * dsW + x;
      if (!sheltered[i]) continue;
      dil[i] = 1;
      if (x > 0) dil[i - 1] = 1;
      if (x < dsW - 1) dil[i + 1] = 1;
      if (y > 0) dil[i - dsW] = 1;
      if (y < dsH - 1) dil[i + dsW] = 1;
    }
  }
  for (let y = 0; y < dsH; y++) {
    for (let x = 0; x < dsW; x++) {
      const i = y * dsW + x;
      if (!dil[i]) { sheltered[i] = 0; continue; }
      sheltered[i] = ((x === 0 || dil[i - 1]) && (x === dsW - 1 || dil[i + 1]) &&
                      (y === 0 || dil[i - dsW]) && (y === dsH - 1 || dil[i + dsW])) ? 1 : 0;
    }
  }
}

// --- verdict cache -----------------------------------------------------------------------
// Small LRU. Each entry holds a Uint8Array of dsW*dsH — 512 KB at the 1024x512 cap — so the cap is
// deliberately tiny: 4 entries is ~2 MB, and the measured working set on a static viewport was ONE
// distinct input in 20 s (4 across 30 s including transients).
const _SHELTER_CACHE_CAP = 4;
const _shelterCache = new Map();   // key -> { sheltered, count }

function _shelterCacheGet(key) {
  const v = _shelterCache.get(key);
  if (v === undefined) return null;
  _shelterCache.delete(key);        // re-insert = most-recently-used
  _shelterCache.set(key, v);
  return v;
}

function _shelterCacheSet(key, sheltered, count) {
  _shelterCache.set(key, { sheltered, count });
  while (_shelterCache.size > _SHELTER_CACHE_CAP) {
    _shelterCache.delete(_shelterCache.keys().next().value);   // evict least-recently-used
  }
}

function _shelterCacheStat(kind) {
  if (typeof window === 'undefined') return;
  const g = window.__RAW_GPU__ || (window.__RAW_GPU__ = {});
  const c = g.shelterCache || (g.shelterCache = { hit: 0, miss: 0 });
  c[kind]++;
  c.size = _shelterCache.size;
}

/** Test seam: the cache is module state and would otherwise leak between cases. */
export function _resetShelterCache() { _shelterCache.clear(); }

// Canvas wrapper: downsample the finished mask, classify, and repaint enclosed water to 0.25.
// Close-zoom tiers only (<10° span) — coarser masks can't resolve entrance widths anyway.
// opts.gapM overrides the channel gap (the NARROW-WATER pass reuses this whole pipeline at
// canal scale); opts.stash=false keeps a non-basin verdict out of the basin cache.
export function suppressShelteredWater(canvas, bounds, opts) {
  // ⭐ CALL COUNTER (instrument-first, 2026-08-12 — NO behaviour change). Per-call cost is MEASURED
  // at 46.7 ms (GATE6_mask_percall_bench_RUN.txt), but the CPU profile attributes 1394-1486 ms to
  // this function, which is ~30 calls, not the 2 that a neighbouring counter implied. That counter
  // — `__RAW_MASK_REPATCH_LOG__` — turned out to be written at the LAYER RE-PATCH site and never
  // counted this function at all.
  // ★ Count the thing you are asking about, at the thing you are asking about. A counter answers
  //   the question its author had, not the question you are asking.
  // `calls` counts every entry; `workCalls` counts the ones that survive the guards and actually
  // downsample+classify. The gap between them is refusals, which are nearly free — conflating the
  // two would misattribute the cost.
  if (typeof window !== 'undefined') {
    const _g = window.__RAW_GPU__ || (window.__RAW_GPU__ = {});
    _g.shelteredCalls = (_g.shelteredCalls || 0) + 1;
  }
  if (!canvas || !bounds || typeof document === 'undefined') return false;
  const spanLon = (bounds.east < bounds.west) ? (bounds.east + 360) - bounds.west : bounds.east - bounds.west;
  if (spanLon >= 10 || spanLon <= 0) return false;
  // 1000 m default: seals every Venice inlet (widest ~900 m — at 600 the Porto di Lido stayed open
  // and its channel network kept animating, live user report) while Golden-Gate-class entrances
  // (≥1.6 km) stay open. Seas larger than the mask tile always touch the canvas border and are
  // open by construction, so the gap only ever decides basins smaller than ~1-2°.
  const gapM = (opts && opts.gapM) ||
    (typeof window !== 'undefined' && Number(window.__RAW_SHELTERED_GAP_M__)) || 1000;
  const dsW = Math.min(1024, canvas.width);
  const scale = dsW / canvas.width;
  const dsH = Math.max(2, Math.round(canvas.height * scale));
  const latMid = (bounds.north + bounds.south) / 2;
  const mPerPx = (spanLon * 111320 * Math.abs(Math.cos(latMid * Math.PI / 180))) / dsW;
  const nPx = Math.max(1, Math.round((gapM / 2) / Math.max(1e-6, mPerPx)));
  if (nPx > 48) return false;   // extreme zoom-in: entrances resolve wider than the analysis radius
  const ds = document.createElement('canvas');
  ds.width = dsW; ds.height = dsH;
  const dctx = ds.getContext('2d', { willReadFrequently: true });
  if (!dctx) return false;
  // Past every guard: this call pays the ~46.7 ms.
  if (typeof window !== 'undefined') {
    const _g = window.__RAW_GPU__ || (window.__RAW_GPU__ = {});
    _g.shelteredWorkCalls = (_g.shelteredWorkCalls || 0) + 1;
  }
  // Smoothing ON (2026-07-04, the Canal Grande mottle): nearest-sampling a sub-ds-pixel canal
  // (60 m canal vs 76 m/px ds) hits it only ~1 cell in 3 — the classifier sees a broken run and
  // the missed stretches re-open as wash at deep zoom. Area-averaging makes any cell that is
  // mostly water read ≥128 → thin canals become CONNECTED 1-px water lines and classify
  // coherently. The classify-time source holds only 0/255 (the sheltered stamp lands after), so
  // averaging never mixes verdict gray into the water grid.
  dctx.imageSmoothingEnabled = true;
  dctx.drawImage(canvas, 0, 0, dsW, dsH);
  const img = dctx.getImageData(0, 0, dsW, dsH);
  const px = img.data;
  const size = dsW * dsH;
  const water = new Uint8Array(size);
  for (let i = 0; i < size; i++) water[i] = px[i * 4] >= 128 ? 1 : 0;
  // ⭐ INPUT-REDUNDANCY INSTRUMENT (2026-08-12) — OFF unless `__RAW_MASK_INPUT_HASH__ === true`.
  // Frequency is measured at ~1.1 calls/s sustained on a STATIC viewport, which suggests the
  // classifier is re-deciding unchanged input. Before writing a cache, measure how much of the work
  // is actually redundant — "most of it, surely" is the kind of unmeasured assumption that has been
  // wrong five times in this session.
  // The key is the classifier's COMPLETE input: `classifySheltered` is pure, so identical
  // (water, nPx, dims) means identical output by definition. That is also exactly the cache key a
  // real implementation would need, so measuring it prices the fix at the same time.
  // ⚠️ It hashes 500k+ bytes per call (~5% of the 46.7 ms), so it must never be on by default —
  // an instrument must not tax the product.
  // ⭐ VERDICT CACHE. `classifySheltered` is pure, so identical (water, nPx, dims) gives an
  // identical verdict by definition — measured 96% redundant on a static viewport, 32% while
  // panning (GATE6_mask_input_redundancy_MEASURED.md).
  //
  // ⚠️ WHAT A HIT ACTUALLY SAVES, because I over-claimed this once: NOT the whole 46.7 ms call.
  // The downsample (11.7 ms) and the readback (4.5 ms) must still happen to produce the pixels the
  // key is computed FROM, and the stamp-back still has to paint. A hit skips the classifier
  // (28 ms) and the morphological close — roughly 60% of a call, not 100%. Eliding the whole call
  // would need a content signature from upstream of the readback, which this does not attempt.
  //
  // Cost of the key: one FNV-1a pass over ~500k bytes, ~2.3 ms, paid on EVERY call including
  // misses. Worth it at both measured hit rates (96% -> ~+24.6 ms/call, 32% -> ~+6.7 ms/call), but
  // it is a real tax and the kill switch below restores the pre-cache path exactly.
  // Kill: `__RAW_DISABLE_SHELTER_CACHE__ = true`.
  const _cacheOn = !(typeof window !== 'undefined' && window.__RAW_DISABLE_SHELTER_CACHE__ === true);
  let _key = null;
  if (_cacheOn) {
    let _h = 0x811c9dc5;
    for (let i = 0; i < size; i++) { _h ^= water[i]; _h = Math.imul(_h, 0x01000193); }
    _key = `${(_h >>> 0).toString(36)}:${nPx}:${dsW}x${dsH}`;
    // Redundancy stats stay behind their own flag — they are diagnostics, not the cache.
    if (typeof window !== 'undefined' && window.__RAW_MASK_INPUT_HASH__ === true) {
      const _g = window.__RAW_GPU__ || (window.__RAW_GPU__ = {});
      const _m = _g.shelteredInputs || (_g.shelteredInputs = { total: 0, distinct: 0, repeats: 0, keys: {} });
      _m.total++;
      if (_m.keys[_key] === undefined) { _m.keys[_key] = 0; _m.distinct++; } else { _m.repeats++; }
      _m.keys[_key]++;
    }
  }
  const doStash = !opts || opts.stash !== false;

  let sheltered, count;
  const _hit = _key !== null ? _shelterCacheGet(_key) : null;
  if (_hit) {
    // The cached mask is POST-close, so a hit skips the close too. Nothing downstream mutates
    // `sheltered` — the stamp loop only reads it — so the stored array is handed out directly.
    sheltered = _hit.sheltered;
    count = _hit.count;
    _shelterCacheStat('hit');
  } else {
    const _r = classifySheltered(water, dsW, dsH, nPx);
    sheltered = _r.sheltered;
    count = _r.count;
    if (count) _closeShelteredMask(sheltered, dsW, dsH);
    if (_key !== null) _shelterCacheSet(_key, sheltered, count);
    _shelterCacheStat('miss');
  }

  if (!count) {
    // Stash the ALL-OPEN verdict too: a crisp canvas inside this region must prefer "nothing
    // sheltered here" over a coarser stale entry that might still contain it.
    if (doStash) stashBasinVerdict({ bounds: { ...bounds }, mPerPx: Math.round(mPerPx), ds: null, dsW, dsH, count: 0 });
    return { applied: true, shelteredFrac: 0, nPx, mPerPx: Math.round(mPerPx) };
  }
  // Paint enclosed water 0.25 (64) and stamp back at full resolution, hard-edged.
  for (let i = 0; i < size; i++) {
    if (sheltered[i]) { px[i * 4] = 64; px[i * 4 + 1] = 64; px[i * 4 + 2] = 64; px[i * 4 + 3] = 255; }
    else { px[i * 4 + 3] = 0; }
  }
  dctx.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(ds, 0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = prevSmooth;
  // Stash the verdict canvas (sheltered = gray, open = transparent) for crisp deep-zoom canvases.
  if (doStash) stashBasinVerdict({ bounds: { ...bounds }, mPerPx: Math.round(mPerPx), ds, dsW, dsH, count });
  return { applied: true, shelteredFrac: +(count / Math.max(1, size)).toFixed(4), nPx, mPerPx: Math.round(mPerPx) };
}
