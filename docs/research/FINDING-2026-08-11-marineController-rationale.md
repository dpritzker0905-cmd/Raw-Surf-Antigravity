# marineController.js — relocated rationale (2026-08-11)

`frontend/src/components/map/marineController.js` hit **853 LOC** against the repo's 800-line
ratchet (introduced by `516a7200`). The house rule is *relocate rationale, never delete it* —
so the three largest comment blocks were moved here **verbatim**, each leaving a pointer at the
original site. Nothing was reworded and no code changed; the file is behaviour-identical.

⚠️ These were written at the point of use by the session that owns this file. If that reasoning
moves back inline after a split, delete the corresponding section here so it does not fork.

---

## INSERTION ORDER DECIDED THE FIELD

<a id="insertion-order"></a>

```js
      // ⛔ INSERTION ORDER DECIDED THE FIELD (audit 11.2 / T-2′ step 3, 2026-08-11).
      // This scan used `break` on the FIRST containing entry. `_perModelHourCache` is a Map, so
      // iteration is INSERTION order — when two entries both contain the viewport and both pass
      // every predicate (prefix, TTL, non-stale, vectors>0, DEBT-CACHE-03 world-skip, containment
      // AND the full signature check), the one cached EARLIER won. That makes the served EXTENT a
      // function of interaction history rather than of the request.
      // Measured on the live layer OFF→ON battery: a byte-identical productId served at 289 and
      // then 15,023 vectors, band value 0.5152 → 0.5954 m (+15.6%).
      // ★ Every candidate here is already deemed servable by the predicates above, so choosing
      //   among them is safe — and the TIGHTEST containing grid is both deterministic and the
      //   finest data available for this viewport. Ties break on key for total ordering.
      // Kill: __RAW_DISABLE_TIGHTEST_CONTAINED__ = true restores the first-wins behaviour, so the
      // two legs can be A/B'd under identical cache state (same shape as the two neighbouring
      // fixes in this function: __RAW_DISABLE_SAFECACHE_GLOBAL_SKIP__, __RAW_DISABLE_GLOBAL_TILE_ALIAS__).
      // ★ MIRRORS the series cache, which already solved this exact question
      //   (marineGridSeries.js:713-754: "pick the SMALLEST containing bbox so the served frame is
      //   the highest resolution available", with global-width entries held as a last resort).
      //   Two caches answering the same question must not use two policies — that asymmetry is
      //   what made the global prewarm harmless in one cache and hazardous in the other.
      //   Deviation, deliberate: the reference computes area from a RAW `east - west`, which is
      //   wrong across the antimeridian; this uses the wrapped width it already computes for the
      //   global check, so a date-line-crossing bbox is measured correctly.
```

---

## THE SERIES HALF (audit v6)

<a id="series-half"></a>

```js
    // ── THE SERIES HALF (audit v6 §5.1, 2026-08-02) ───────────────────────────────────────────
    // A zoom-out consults TWO independent caches and this function warmed only one of them. The
    // block below warms `/api/weather/grid` into `_cacheMarineResult`; the multi-hour `grid_series`
    // page the same gesture ALSO needs lives in `_seriesCache` (marineGridSeries.js) and nothing
    // warmed it along the zoom axis — prewarm exists for TIME (adjacent pages), MODEL and LAYER,
    // never for VIEWPORT, while `pageKey` contains the viewport.
    //
    // MEASURED LIVE, and this is why the fix is here rather than in the debounce: on the FIRST
    // zoom-out of a cold session `__MARINE_CACHE_DIAG__` read `{hit: 4}` with ZERO containment
    // misses — the grid prewarm had already WON its race — beside a 2,972 KB / 10,129 ms
    // grid_series. A perfectly warm grid cache next to a 9.6 s gesture can only mean the gesture
    // waits on the other cache. (z9->z4 cold: 1 fetch, 2,449 KB, 8,658 ms. The SECOND zoom-out: 0.)
    //
    // ★ ONE request, not 48: `currentPageOnly=true` suppresses the adjacent-page fan-out, the same
    //   flag and the same reason as the sibling-layer prewarm above.
    // ★ ONE warm serves every coast: `viewportKey` collapses any span > 15° to a single 'global'
    //   key, so this is location-independent (proven live — a global view over Portugal hit the
    //   series warmed over Florida) and it is the SAME entry the second zoom-out already hits.
    // ★ It cannot clamp close zoom: `getMarineSeriesFrame` refuses a global-width entry on the
    //   exact-key path for a regional viewport, and its containment fallback prefers the SMALLEST
    //   containing bbox — global is last-resort only. Pinned by the ordering test in
    //   marineGridSeries.globalPrewarm.test.js.
    // ★ Deliberately placed BEFORE the grid cache-warm early-return below: the two caches are
    //   independent, so a warm GRID must not skip a cold SERIES — that conflation is the bug.
    // Kill: window.__RAW_DISABLE_GLOBAL_SERIES_PREWARM__ = true
```

---

## Sibling-layer SERIES prewarm

<a id="sibling-prewarm"></a>

```js
// Sibling-layer SERIES prewarm (instant marine layer toggles) — DEFAULT OFF (opt-in).
// After a marine layer commits, warm the OTHER component layers' regional SERIES frames into the
// client per-model-hour cache, so toggling to a sibling is an instant client-side hit via the
// orchestrator's switch instant-commit path (getModelSafeMarine) — NO round-trip, NO blank.
//
// Why SERIES (not /grid): fetchBackendMarineGrid always returns a COARSE-GLOBAL grid; the REGIONAL
// grid only exists in the grid_series path. A coarse-global frame committed at a zoomed-in viewport
// trips the render backstop → clear — the bug the first /grid prewarm attempt hit (it was a confirmed
// no-op). So we warm the sibling SERIES, read its REGIONAL current-hour frame, and cache THAT.
//
// Safe by design:
//  • DEFAULT ON (2026-06-26) — kill switch: set window.__MARINE_SIBLING_PREWARM__ === false (or
//    localStorage marine_sibling_prewarm === 'false') to disable. Held opt-in until the zoom-out
//    coverage/clamp blocker was resolved (54e289b5 + SWR revalidation); live A/B 2026-06-25 verified
//    instant toggles + 0 engine clears at stable zoom. The other guards below still bound the load.
//  • REGIONAL GUARD — only at a zoomed-in viewport (span ≤ 15°, mirrors the switch path's
//    !zoomedOut gate). At global/coarse we skip (global toggles already hit the manifest cache).
//  • REGIONAL-ONLY WRITE — only caches a frame whose grid width < 340° (never a coarse-global one),
//    so a sibling toggle can never commit a coarse-global grid at a regional viewport.
//  • LAYER-ISOLATED — writes only the layer-keyed _perModelHourCache via _cacheMarineResult (it does
//    NOT touch marineHourlyCache.__layerKey/lastKnownGood), so a sibling write never clobbers the
//    active layer's cache view; silent=true skips the GFS-waves-h0 truth-stage (no diag pollution).
//  • BOUNDED — ensureMarineSeries is deduped + TTL'd + capped at 2 concurrent grid_series fetches
//    and aborts with the active signal; skipped during scrub; per-(model,hour,layer) in-flight dedup.
```
