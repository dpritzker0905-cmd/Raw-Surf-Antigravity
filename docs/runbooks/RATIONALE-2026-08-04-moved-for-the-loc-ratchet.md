# Rationale moved out of code for the 800-LOC ratchet — 2026-08-04

**Nothing here was deleted. Every block below was moved VERBATIM out of a source file that had
crossed the LOC ratchet, and each site now carries a one-line pointer back to this document.**

This is option (b) from `HANDOFF-2026-08-04-C-the-loc-ratchet-is-measuring-our-documentation.md`.
That handoff's finding is the reason this file exists: the gate counts raw `wc -l`, so it counts
comments, and three of the four offending files were already **under 800 in code**. The practice
that keeps this repo safe — recording the measured defect, the number, and the thing that was tried
and failed — is what trips its own size gate.

⛔ **Do not delete anything here to "clean up".** Each block is the record of a defect that was
expensive to find. If a block stops being true, correct it — do not drop it.

⚠️ **A structural note discovered while doing this work.** The ratchet's grandfathered rule is
"a baselined file may only shrink". That means a grandfathered file can never accept a new line of
**code** without deleting an existing line — removing the comments that arrived with it is not
enough, because the code line is permanent. Both grandfathered regressions here were 10 comment
lines plus 1–2 code lines, so each needed pre-existing content moved out. That is a governance
property worth deciding on deliberately (handoff §5 option (d): count code lines, not raw lines).

---

## WebGLMarineLayer - high-zoom land-mask refinement

_moved from `frontend/src/components/map/WebGLMarineLayer.js` (was lines 563-579)_

```js
  // ── High-zoom land-mask refinement ──────────────────────────────────────────────
  // Bug: the wave heatmap bleeds over land at z12+ because the engine masks land with the 50m
  // GeoJSON, which is too coarse to follow barrier islands / thin coastline. When a marine layer is
  // zoomed past the threshold we lazily swap in the 10m mask and re-encode; below the threshold we
  // revert to 50m so the global mask render stays cheap (it iterates ALL land features). The 10m
  // swap re-uploads because geojsonSig (land_<featureCount>) differs → no duplicate-upload skip.
  // Isolated from the fetch/commit pipeline — worst case is a coarser mask, never a wedge.
  // Kill switch: window.__MARINE_HIRES_MASK__ === false.
  // Lowered 11→9 (2026-06-29): waves bled over barrier islands/thin coast at "somewhat close" zooms (z9-z11)
  // where the coarse 50m mask still simplifies the coastline. Lowered 9→8 (2026-07-02): the user reported crests
  // "partially over land, in a grid" at z8.39 — below the old threshold the 50m mask still simplified the FL
  // barrier islands while the regional 13×13 tile was (correctly) resident. The regional mask canvas is now
  // 2048×1024 (WebGLMarineMaskRenderer), fine enough for the 10m polygons to pay off from z8. Kill switch
  // unchanged: window.__MARINE_HIRES_MASK__=false.
  // HYSTERESIS (2026-07-06, rapid-zoom churn): enter hires at z≥8, exit below z7.3 — a single
  // threshold fired a full land_mask_res_swap re-upload per gesture when zoom cycling straddled
  // z8 (see desiredMaskRes in maskSmoothing.js).
```

---

## useMarineDataFetcherCore - flavor-mismatch bypass

_moved from `frontend/src/components/map/useMarineDataFetcherCore.js` (was lines 268-279)_

```js
      // FLAVOR-MISMATCH BYPASS (2026-07-15, visual-verified on the live map: the rating band NEVER
      // loaded on toggle without a pan — surf ON fired 0 fetches for 8s). The surf/swell toggle's
      // manual re-fetch was dedup-skipped: locks.lastHash can equal the current surf-hash while the
      // RESIDENT grid is still the opposite flavor, so the hash dedup below wrongly skips the re-fetch.
      // When the committed grid's flavor (ratingMode) doesn't match the desired surf mode, the resident
      // data is simply the WRONG flavor and must be re-fetched regardless of viewport. Terminating:
      // once the correct flavor commits, the mismatch clears. NOT scoped to 'manual': the surf
      // toggle's own manual fetch can be blocked by other in-flight/lock guards, so the reliable
      // re-drive is the periodic backstop/SWR — which must ALSO see the mismatch to re-fetch the
      // right flavor. Bounded because it only fires while the resident flavor is wrong AND a re-drive
      // is scheduled; at a genuinely zoomed-out coarse view the backstop is idle (coarse is adequate
      // there), so this does not spin (measured: 0 idle fetches at z3.2 + surf-on).
```

---

## useMarineDataFetcherCore - why the ring reader is imported here

_moved from `frontend/src/components/map/useMarineDataFetcherCore.js` (was lines 10-14)_

```js
// THE CONSUMER. Imported for its side effect: registers __RAW_RING_REPORT__() / __RAW_RING_TICK__()
// on window, so the rings this app has always written finally have a reader. It shipped in
// 96dc9165 with ZERO call sites — a consumer nobody calls is the exact disease it was built to
// cure. `ringReaderTick` is rate-limited to once a minute and gates on the CLOCK BEFORE walking
// any ring, so it is safe from any path; it logs only on FAILURE and never writes to a ring.
```

---

## useMarineDataFetcherCore - why the tick sits on the marine fetch path

_moved from `frontend/src/components/map/useMarineDataFetcherCore.js` (was lines 322-326)_

```js
        // THE READER'S CALL SITE. Placed on the marine fetch path — frequent enough that a real
        // session exercises it, and the tick itself gates on a 60 s clock BEFORE walking any ring,
        // so the cost here is one comparison. It logs only when a check FAILS and only when the
        // failing set changes, because the defect it detects is a ring drowned by a loud writer and
        // a noisy reader would recreate exactly that.
```

---

## backendWeatherServiceClientHelpers - the >240h blend

_moved from `frontend/src/components/map/backendWeatherServiceClientHelpers.js` (was lines 645-654)_

```js
      // hourOffset > 240
      // BOUNDARY CONTINUITY (2026-07-06, "the heatmap changes colors dramatically at the
      // native→extended handoff"): the ≤240 branch is ANCHORED (icon168 + GFS trend — continuous
      // by construction), but this branch was a RAW 0.6/0.4 GFS/EURO mix — a level jump at the
      // 240 boundary wherever the mix's climatology differs from the anchored value. The locked
      // 14-day contract keeps this mix as the far-tail mechanism, so the fix is ADDITIVE bias
      // correction: est(t) = mix(t) + [trend(240) − mix(240)]·decay(t), decaying to the pure mix
      // by hour 288. Offsets apply to height/period (the colormap drivers) per cell per sublayer;
      // the boundary anchors ride the SAME cached @168 anchors the ≤240 branch uses plus one
      // cache-hot GFS/EURO fetch @240. Kill: __RAW_DISABLE_ICON_TAIL_CONTINUITY__.
```

---

## backendWeatherServiceClientHelpers - upstream provider (duplicate copy)

_moved from `frontend/src/components/map/backendWeatherServiceClientHelpers.js` (was lines 290-297)_

```js
      // ⛔⛔ THE ORIGIN, NOT THE DISPATCH KEY (2026-08-03). `json.provider` is 'open-meteo' for
      // GFS, ICON and EURO alike — it names the ROUTE, not the data. The backend has always
      // served `upstream_provider` beside it (noaa | dwd | copernicus | ecmwf | gfs_estimated_
      // fallback) and the frontend dropped it here, so the render path could not say what it
      // painted. Measured against NDBC buoys the same day, GFS scored on the SAME sites:
      //     EURO/copernicus MAE 0.159 (3.2x better) · EURO/ecmwf 0.339 (WORSE than GFS 0.266)
      // A 2.8x accuracy spread hid behind one label. Third instance of this class, after
      // `limiter` dropped at the Pydantic boundary and the geometry provenance envelope.
```

---

## backendWeatherServiceClientHelpers - upstream provider is the ORIGIN not the route

_moved from `frontend/src/components/map/backendWeatherServiceClientHelpers.js` (was lines 172-179)_

```js
      // ⛔⛔ THE ORIGIN, NOT THE DISPATCH KEY (2026-08-03). `json.provider` is 'open-meteo' for
      // GFS, ICON and EURO alike — it names the ROUTE, not the data. The backend has always
      // served `upstream_provider` beside it (noaa | dwd | copernicus | ecmwf | gfs_estimated_
      // fallback) and the frontend dropped it here, so the render path could not say what it
      // painted. Measured against NDBC buoys the same day, GFS scored on the SAME sites:
      //     EURO/copernicus MAE 0.159 (3.2x better) · EURO/ecmwf 0.339 (WORSE than GFS 0.266)
      // A 2.8x accuracy spread hid behind one label. Third instance of this class, after
      // `limiter` dropped at the Pydantic boundary and the geometry provenance envelope.
```

---

