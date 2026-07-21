import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchWindData, getRemainingCooldown, getWindHourlyCache, extractWindAtOffset, isContainedInWindCache, getModelSafeWind, getBackendWindFlag, prewarmSiblingModelWind, isRenderableWindData } from './marineController';
import { onForecastUpdate } from '../../engine/data/forecast-pipeline';
import { clampViewportBbox } from './backendWeatherServiceClientCoverage';
import { windGridsCompatible } from './WebGLWindEngine';
import { recordTruthStage } from './weatherTruthTracker';
import { ensureWindSeries, getWindSeriesFrame, prewarmWindSeries } from './windGridSeries';
import { isTerminalNoCoverage } from './marineControllerCache';

// Module-level scrub log throttle (max once per 2s)
let _lastScrubLogTime = 0;

/**
 * Unified Weather Data Engine (v3.9.4)
 * 
 * v3.9.4 FIXES:
 * - Retry survives layer switches (effect depends on mapInstance only)
 * - Removed timeline skip log spam (was firing on every slider tick)
 * - Uses module-level retry scheduling so 429 recovery persists
 * - Timeline scrub uses local hourly cache (zero API calls)
 */
export function useWeatherEngine({ activeLayers, mapInstance, timeOffsetHours = 0, activeModel = 'GFS', forecastDays = 3 }) {
  const [windData, _setWindData] = useState(null);
  // #14 DELIVERY QUEUE (the fix, 2026-07-21). Every committed grid is appended here in commit
  // order. React 18 automatic batching collapses multiple same-flush commits (e.g. a world base
  // + its covering clip on a model round-trip) into a SINGLE effect run whose `windData` is only
  // the LAST-in-batch — the world base is dropped before it reaches engine.setWindData (measured
  // live: world base committed to state x2, delivered to the engine x0, so the engine ends
  // clip-primary with no global base and a same-model pan shows a hole). The layer effect drains
  // this queue and delivers EVERY grid; the engine's base/fine/promote filing is order-independent
  // so the base+overlay invariant is restored regardless of interleaving. This is the ONE function
  // all React-state commits pass through (the choke), never a per-call-site guard. Kill:
  // __RAW_DISABLE_WIND_DELIVERY_QUEUE__ -> single-`data` delivery (the legacy lossy path).
  const windDeliveryQueueRef = useRef([]);
  // #14 STATE-COMMIT TRIPWIRE (permanent, bounded 200; the __WIND_BASE_LANE__ telemetry precedent):
  // logs EVERY windData React-state transition (span, source, hour, revision). Comparing
  // window.__WIND_STATE_COMMITS__ (what state was SET to) against window.__WIND_LAYER_DELIVERY__
  // (what the layer effect DELIVERED to the engine) is the regression detector for the
  // batching-collapse drop class — if a world span commits here but worldApplied stays 0 there,
  // the queue drain regressed.
  const setWindData = (d) => {
    if (typeof window !== 'undefined') {
      if (window.__RAW_DISABLE_WIND_DELIVERY_QUEUE__ !== true) {
        const q = windDeliveryQueueRef.current;
        q.push(d);
        if (q.length > 16) q.splice(0, q.length - 16); // bounded — never accumulate unboundedly while inactive
      }
      const _c = (window.__WIND_STATE_COMMITS__ = window.__WIND_STATE_COMMITS__ || []);
      const b = d && d.bounds;
      const sp = b ? (b.west > b.east ? (b.east + 360) - b.west : b.east - b.west) : 0;
      if (_c.length < 200) _c.push({ t: Date.now(), span: d ? Math.round(sp) : null, src: d?.source || null, hr: d?.hourOffset || 0, rev: windRevision.current });
    }
    _setWindData(d);
  };
  const windRevision = useRef(0);
  // COVERAGE STATE MUST BE A REF (2026-07-19 night). As an effect-local variable it reset to
  // null on every effect re-run (model switch, wind toggle), blinding BOTH commit gates — a
  // late 2-deg fine box was observed committing over a covering global at z5.5 through exactly
  // that window. The ref survives re-runs for the component's whole life.
  const lastCommittedWindRef = useRef(null); // { bounds, stale }
  const timeOffsetRef = useRef(timeOffsetHours);
  const activeModelRef = useRef(activeModel);
  const activeLayersRef = useRef(activeLayers);
  // Keep latest model in a ref so an async wind fetch can verify request-intent parity (model +
  // hour) before committing — a scrub/model-switch during the fetch must not commit stale data.
  activeModelRef.current = activeModel;

  // THE SINGLE CHOKE POINT (2026-07-19 night, after the clamp leaked through a THIRD path).
  // Distributed coverage gates at call sites kept missing the next path (fetch, stale, warm,
  // series, reload-restore...). The invariant now lives where every path must pass: a REGIONAL
  // grid that does not cover the current viewport may never REPLACE a grid that does. Null
  // (deliberate clears) and covering/world grids pass untouched.
  const lastGoodCoveringRef = useRef(null); // the last committed grid that covered its viewport
  // Which model|hour the ENGINE currently holds a world base for — the BASE-FIRST churn guard.
  // Tracks the engine, not history: any different-model commit REPLACES the engine base, so it
  // must invalidate this (2026-07-20 live: a stale 'GFS|0' entry skipped the probe after an
  // EURO interlude had evicted the GFS base — the persistent-lattice state).
  const windWorldBaseRef = useRef(null);
  const commitWindData = (data) => {
    try {
      if (data && data.bounds && mapInstance) {
        const b = mapInstance.getBounds();
        const vp = { west: b.getWest(), south: Math.max(-85, b.getSouth()), east: b.getEast(), north: Math.min(85, b.getNorth()) };
        const span = data.bounds.west > data.bounds.east
          ? (data.bounds.east + 360.0) - data.bounds.west : data.bounds.east - data.bounds.west;
        const eps = 0.05;
        const covers = span >= 350.0
          || (data.bounds.west <= vp.west + eps && data.bounds.east >= vp.east - eps
            && data.bounds.south <= vp.south + eps && data.bounds.north >= vp.north - eps);
        if (covers) {
          // BASE-FIRST (2026-07-20 #14 v2). A covering CLIP committing into a base-less engine
          // renders alone — its box edge/lattice visible until the base lane's fetch lands
          // (measured 336 ms-1.6 s). When the client cache already holds a world grid that the
          // ENGINE ITSELF would composite with this clip (windGridsCompatible — the engine's own
          // gate: model+hour+valid_time), commit the world first and defer the clip ONE tick
          // (React batches same-tick setStates — the engine never saw the world in v1). The
          // compatibility precheck is what makes this safe: BASE-FIRST only fires when the
          // engine is GUARANTEED to file the clip as the fine overlay, never a wasted commit.
          // Churn guard: windWorldBaseRef (probe once per model|hour; engine-tracking — see its
          // declaration). Kill: __RAW_DISABLE_WIND_BASE_FIRST__.
          try {
            const bfModel = data.source || activeModel;
            const bfKey = `${bfModel}|${data.hourOffset || 0}`;
            if (windWorldBaseRef.current && !windWorldBaseRef.current.startsWith(`${bfModel}|`)) {
              windWorldBaseRef.current = null; // cross-model commit → the engine base is replaced
            }
            const baseFirstOn = typeof window === 'undefined' || window.__RAW_DISABLE_WIND_BASE_FIRST__ !== true;
            if (baseFirstOn && span < 350.0 && windWorldBaseRef.current !== bfKey && getBackendWindFlag()) {
              windWorldBaseRef.current = bfKey; // one probe per model|hour, hit or miss
              const world = getModelSafeWind(bfModel, data.hourOffset || 0,
                { west: -179.0, south: -75.0, east: 179.0, north: 80.0 });
              const wSpan = world && world.bounds
                ? (world.bounds.west > world.bounds.east
                  ? (world.bounds.east + 360.0) - world.bounds.west : world.bounds.east - world.bounds.west)
                : 0;
              if (world && world.vectors?.length > 0 && wSpan >= 350.0
                  && world.renderable !== false && windGridsCompatible(world, data)) {
                console.log('[WeatherEngine] commitWindData CHOKE: BASE-FIRST — compatible cached world base under the covering clip');
                lastGoodCoveringRef.current = data;
                windRevision.current += 1;
                commitWindDataInner(world);
                setTimeout(() => {
                  if (lastGoodCoveringRef.current === data) {
                    windRevision.current += 1;
                    commitWindDataInner(data);
                  }
                }, 0);
                return;
              }
            }
            if (span >= 350.0) windWorldBaseRef.current = bfKey; // a world commit IS the base
          } catch (e) { /* base-first is best-effort; plain commit below */ }
          lastGoodCoveringRef.current = data;
        } else {
          const lg = lastGoodCoveringRef.current;
          const lgSpan = lg && lg.bounds ? (lg.bounds.west > lg.bounds.east
            ? (lg.bounds.east + 360.0) - lg.bounds.west : lg.bounds.east - lg.bounds.west) : 0;
          const lgCovers = lg && lg.bounds && (lgSpan >= 350.0
            || (lg.bounds.west <= vp.west + eps && lg.bounds.east >= vp.east - eps
              && lg.bounds.south <= vp.south + eps && lg.bounds.north >= vp.north - eps));
          if (lgCovers) {
            // BASE+OVERLAY (2026-07-19 #9): with the two-texture engine live, a non-covering
            // regional grid of the SAME model+hour as the covering base is not a threat — the
            // engine files it as the FINE OVERLAY on top of the resident base (which stays on
            // screen everywhere the fine box is not). Different model/hour still blocks: those
            // grids would describe different air than the base under them.
            // Kill: __RAW_DISABLE_WIND_BASE_OVERLAY__ -> the strict block below.
            const twoTexLive = typeof window === 'undefined' || window.__RAW_DISABLE_WIND_BASE_OVERLAY__ !== true;
            const sameModel = (data.source || null) === (lg.source || null);
            const sameHour = (data.hourOffset || 0) === (lg.hourOffset || 0);
            if (twoTexLive && sameModel && sameHour && lgSpan >= 350.0) {
              console.log('[WeatherEngine] commitWindData CHOKE: non-covering grid passes as FINE OVERLAY over the resident global base');
              windRevision.current += 1;
              return commitWindDataInner(data);
            }
            console.log('[WeatherEngine] commitWindData CHOKE: non-covering regional grid blocked — keeping the covering grid on screen');
            windRevision.current += 1;
            setWindData(lg);
            return;
          }
          // BASE-FIRST for the fail-open case (no covering resident at all): same validated
          // pattern as the covering branch above — only fires when the engine is guaranteed
          // to composite (windGridsCompatible), clip deferred one tick past React batching.
          try {
            const bfModel = data.source || activeModel;
            const bfKey = `${bfModel}|${data.hourOffset || 0}`;
            if (windWorldBaseRef.current && !windWorldBaseRef.current.startsWith(`${bfModel}|`)) {
              windWorldBaseRef.current = null;
            }
            const baseFirstOn = typeof window === 'undefined' || window.__RAW_DISABLE_WIND_BASE_FIRST__ !== true;
            if (baseFirstOn && windWorldBaseRef.current !== bfKey && getBackendWindFlag()) {
              windWorldBaseRef.current = bfKey;
              const world = getModelSafeWind(bfModel, data.hourOffset || 0,
                { west: -179.0, south: -75.0, east: 179.0, north: 80.0 });
              const wSpan = world && world.bounds
                ? (world.bounds.west > world.bounds.east
                  ? (world.bounds.east + 360.0) - world.bounds.west : world.bounds.east - world.bounds.west)
                : 0;
              if (world && world.vectors?.length > 0 && wSpan >= 350.0
                  && world.renderable !== false && windGridsCompatible(world, data)) {
                console.log('[WeatherEngine] commitWindData CHOKE: BASE-FIRST — compatible cached world base under the incoming clip');
                lastGoodCoveringRef.current = world;
                windRevision.current += 1;
                commitWindDataInner(world);
                setTimeout(() => {
                  if (lastGoodCoveringRef.current === world) {
                    windRevision.current += 1;
                    commitWindDataInner(data);
                  }
                }, 0);
                return;
              }
            }
          } catch (e) { /* best-effort; fail open below */ }
        }
      }
    } catch (e) { /* the choke must never break commits */ }
    return commitWindDataInner(data);
  };
  const commitWindDataInner = (data) => {
    if (data && typeof window !== 'undefined' && data.hourOffset === 0) {
      recordTruthStage('orchestratorCommit', {
        model: data.source || activeModel,
        domain: 'wind',
        layer: 'wind',
        valid_time: data.valid_time,
        run_time: data.run_time,
        product_id: data.productId || data.product_id,
        is_dynamic_viewport_product: data.is_dynamic_viewport_product,
        coverage_scope: data.coverage_scope,
        requested_bbox: data.requested_bbox,
        served_bbox: data.served_bbox,
        grid: {
          cols: data.cols,
          rows: data.rows,
          bounds: data.bounds,
          vectors: data.vectors
        },
        truthTag: data.truthTag
      }, 'WeatherEngine.js', 'commitWindData');
    }
    setWindData(data);
  };

  const isWindActive = useMemo(
    () => activeLayers.includes('wind'),
     
    [activeLayers.join(',')]
  );

  useEffect(() => {
    timeOffsetRef.current = timeOffsetHours;
  }, [timeOffsetHours]);

  useEffect(() => {
    activeLayersRef.current = activeLayers;
  }, [activeLayers]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.getWindHourlyCache = getWindHourlyCache;
    }
  }, []);

  // ===== PRIMARY DATA FETCH WITH RETRY =====
  // Depends only on mapInstance so retries survive layer switches
  useEffect(() => {
    if (!mapInstance) return;

    let cancelled = false;
    let retryTimer = null;
    let retryCount = 0;
    let baseRetryCount = 0; // cold-start GLOBAL-base lane retries (bounded; see the base lane)
    // ONE authoritative wind fetch at a time (2026-07-19). With the fine tier, every zoom/pan
    // step mints a new bbox; on a slow upstream the responses stack up and resolve LATE — a z11
    // 2-deg box was observed committing onto a z6.8 viewport two steps later (the "moving clamp").
    // Superseded requests are aborted at the source; the covers-now gate below is the belt.
    let windFetchController = null;
    let windFetchGen = 0; // supersession token — see attemptFetch's mutual-abort livelock note
    // COVERAGE-AWARE COMMIT STATE (2026-07-19). What is on screen — held in a REF (see its
    // declaration) so effect re-runs cannot blind the gates. The stale-commit policy pivots on
    // VIEWPORT COVERAGE, not just freshness: a retained fine box that no longer covers the
    // viewport is a CLAMP, strictly worse than a covering stale global.
    // Ordering: fresh-covering > stale-covering > fresh-partial > blank.
    const gridCovers = (gb, vp) => {
      if (!gb || !vp) return false;
      const span = gb.west > gb.east ? (gb.east + 360.0) - gb.west : gb.east - gb.west;
      if (span >= 350.0) return true; // world grid covers every viewport
      const eps = 0.05;
      return gb.west <= vp.west + eps && gb.east >= vp.east - eps &&
             gb.south <= vp.south + eps && gb.north >= vp.north - eps;
    };
    const MAX_RETRIES = 5;
    // First empty-retry is fast (3s) so wind recovers quickly when its initial fetch returns
    // empty because the 1-CPU backend was momentarily storm-loaded (e.g. right after rapidly
    // cycling marine layers — the "wind won't activate" report). Subsequent retries back off so
    // a persistently-empty viewport doesn't hammer the box.
    const RETRY_DELAYS = [0, 3000, 10000, 25000, 60000];

    const getBounds = () => {
      try {
        const b = mapInstance.getBounds();
        return {
          west: b.getWest(),
          south: Math.max(-85, b.getSouth()),
          east: b.getEast(),
          north: Math.min(85, b.getNorth())
        };
      } catch (e) {
        return null;
      }
    };

    const attemptFetch = async () => {
      // Scrubbing mode hard freeze (Request 3)
      if (window.isScrubbingTimeline) {
        console.log("[SCRUB] [FETCH] Wind fetch suppressed during active scrubbing");
        return;
      }

      if (cancelled) return;

      // Check if wind is currently active
      if (!isWindActive) {
        return; // Return immediately to allow zero-overhead sleeping when wind is inactive
      }

      const bounds = getBounds();
      if (!bounds) {
        retryTimer = setTimeout(attemptFetch, 1000); // Shorter retry window to capture bounds faster
        return;
      }

      // v6I.1 Check coverage limits first to enforce regional tiles and outside coverage clearing
      const clampResult = clampViewportBbox(bounds, 'wind', activeModel, 'wind');
      if (!clampResult.isInside) {
        console.log(`[WeatherEngine] Viewport outside wind coverage (${clampResult.fallbackReason}). Clearing visual layer.`);
        commitWindData(null);
        windRevision.current += 1;
        // Periodic check to see if we pan back into coverage
        retryTimer = setTimeout(attemptFetch, 10000);
        return;
      }

      // Check if in 429 cooldown wait and retry
      const cooldownMs = getRemainingCooldown('wind');
      if (cooldownMs > 0) {
        const waitMs = cooldownMs + 2000;
        console.log(`[FETCH] [WeatherEngine] 429 cooldown active (${Math.ceil(cooldownMs/1000)}s), waiting ${Math.ceil(waitMs/1000)}s`);
        retryTimer = setTimeout(attemptFetch, waitMs);
        return;
      }

      // SYNC PARITY (wind↔marine): if a warm client/series cache already covers the current
      // hour+viewport+model, commit it INSTANTLY so wind renders without waiting on the backend
      // round-trip — the same cached-instant pattern the marine scrub path uses. The network
      // fetch below still runs to refresh. Additive + cache-only (keyed by model+hour+bounds, so
      // never a stale-viewport commit): a cold cache is a no-op, no extra backend load. This kills
      // the "wind reloads slowly after toggling around / scrubbing marine" delay on warm toggles.
      try {
        let warm = getBackendWindFlag() ? getModelSafeWind(activeModel, timeOffsetRef.current, bounds) : null;
        if (!warm || !(warm.vectors?.length > 0)) {
          const sf = getWindSeriesFrame(activeModel, bounds, timeOffsetRef.current);
          if (sf && sf.vectors?.length > 0) warm = sf;
        }
        // WARM COMMITS TAKE THE SAME COVERAGE GATE (2026-07-19 night, the LAST leak). The warm
        // sources are bounds-blind lookups — getModelSafeWind's containment can be satisfied by
        // stale-keyed entries, and the wind SERIES lane (default ON since 696f855e) keys frames
        // by requested bounds — so a small fine box cached for a close-zoom viewport could warm-
        // commit over a covering global after zooming out (reproduced on the mobile ladder even
        // with the ref fix). A warm grid must COVER the current viewport, or be strictly better
        // than what is showing (nothing / non-covering).
        if (warm && warm.vectors?.length > 0) {
          const vpWarm = getBounds();
          const lc = lastCommittedWindRef.current;
          if (gridCovers(warm.bounds, vpWarm) || !lc || !gridCovers(lc.bounds, vpWarm)) {
            windRevision.current += 1;
            commitWindData(warm);
            lastCommittedWindRef.current = { bounds: warm.bounds || null, stale: !!warm.stale };
          }
        }
      } catch (e) { /* best-effort warm commit; fall through to the authoritative fetch */ }

      console.log(`[FETCH] [WeatherEngine] Fetching wind (attempt ${retryCount + 1}/${MAX_RETRIES}, offset: ${timeOffsetRef.current}h)`);

      // COLD-START GLOBAL BASE (2026-07-19, marine's coarse-base-then-sharpen pattern). A cold
      // enable at a fine-tier zoom used to wait on the DYNAMIC fetch with a bare ocean the whole
      // time (20s+ when the upstream is rate-limited) — the "clearing" state, impossible in the
      // always-global era where the manifest product painted instantly. If nothing is committed
      // and the clamp resolved to a fine tile, race a cheap GLOBAL manifest fetch alongside the
      // fine one and commit it only while the screen is still empty — the fine product then
      // sharpens over it on arrival, and if the fine path lands first the base is skipped.
      // Fire the base whenever nothing COVERING is on screen — not only when nothing is
      // committed at all. On reload the first fetch can build its box from the PRE-RESTORE
      // viewport; that box commits (nothing better exists), and gating the base on
      // !lastCommitted left the mismatched rectangle standing (user repro 2026-07-19 night).
      // BASE+OVERLAY completion (2026-07-19 #2/#9, found by the vortex probe's failed
      // precondition): when the FINE product lands FIRST on a cold enable, the old guard
      // (`lastCommittedWindRef.current` set -> skip) meant a GLOBAL base never committed for the
      // whole session, so the two-texture engine stayed dormant and every later fine commit was
      // a regional REPLACE (feathered box edges — the residual clamp path). With the two-texture
      // engine live, the global base is valuable even AFTER a fine commit: the engine PROMOTES
      // it underneath the resident fine grid (which moves to the overlay slot, no visual
      // downgrade). The lane fires when nothing covering-GLOBAL is committed yet.
      const twoTexBase = typeof window === 'undefined' || window.__RAW_DISABLE_WIND_BASE_OVERLAY__ !== true;
      const lcBase = lastCommittedWindRef.current;
      const lcSpan = lcBase && lcBase.bounds
        ? (lcBase.bounds.west > lcBase.bounds.east
          ? (lcBase.bounds.east + 360.0) - lcBase.bounds.west : lcBase.bounds.east - lcBase.bounds.west)
        : 0;
      const needGlobalBase = !lcBase || !gridCovers(lcBase.bounds, getBounds()) || (twoTexBase && lcSpan < 350.0);
      // BASE-LANE TRIGGER WIDENED (2026-07-20 §13b, instrumented repro: 877 ms lattice window).
      // The fine-tile-only precondition left MID-SPAN activations (a 58x46° clip) and coarse-clip
      // geometries (the user's 88-vector 11x8) with NO base race at all — the fail-open commit
      // stood alone until a later cycle happened to bring the world grid. Fire the base lane on
      // ANY cold-no-covering activation whose viewport fetch will return a clip (span < 350°;
      // at true world spans the viewport fetch IS the world grid — racing it is pure duplication).
      // Measured: activation lattice window 877 ms -> 336 ms at a z5.5 mid-span viewport.
      // Kill: __RAW_DISABLE_WIND_BASE_LANE_WIDE__ restores the fine-tile-only trigger.
      const _vpNowB = getBounds();
      const _vpSpanB = _vpNowB
        ? (_vpNowB.west > _vpNowB.east ? (_vpNowB.east + 360.0) - _vpNowB.west : _vpNowB.east - _vpNowB.west)
        : 360.0;
      // needGlobalBase ALREADY encodes "the engine lacks a world base" (twoTex && lcSpan<350) —
      // an extra cold-no-cover conjunct here blocked the fresh-world race exactly when a
      // COVERING clip was resident (model switch: clip covers → no world ever fetched → the
      // engine stayed clip-primary until the 5-min refresh; live round 6). The only condition
      // the wide trigger needs is "the viewport fetch will return a clip" (span < 350°).
      const _baseLaneWide = typeof window === 'undefined' || window.__RAW_DISABLE_WIND_BASE_LANE_WIDE__ !== true;
      if (needGlobalBase && ((clampResult.selectedTileId || '').startsWith('wind_viewport_fine_')
          || (_baseLaneWide && _vpSpanB < 350.0))) {
        // LANE TELEMETRY (2026-07-20 #14 forensics): splits "lane not firing" from "fetch
        // failing" from "arrival guarded away" — the model-switch-back leg's world fetch
        // vanished without a trace and this counter set is the instrument-to-catch.
        const _bl = (typeof window !== 'undefined')
          ? (window.__WIND_BASE_LANE__ = window.__WIND_BASE_LANE__
              || { fires: 0, committed: 0, skippedResident: 0, emptyRetry: 0, cancelledArrival: 0, error: 0 })
          : null;
        if (_bl) { _bl.fires += 1; _bl.lastFireAt = Date.now(); }
        fetchWindData({ west: -180, south: -80, east: 180, north: 85 }, null, timeOffsetRef.current, false, forecastDays, activeModel)
          .then((gd) => {
            if (cancelled) { if (_bl) _bl.cancelledArrival += 1; return; }
            const lc2 = lastCommittedWindRef.current;
            const lc2Span = lc2 && lc2.bounds
              ? (lc2.bounds.west > lc2.bounds.east
                ? (lc2.bounds.east + 360.0) - lc2.bounds.west : lc2.bounds.east - lc2.bounds.west)
              : 0;
            // commit while the screen is empty (legacy) OR to slide the base under a resident
            // fine grid (two-texture promote); never re-commit when a global is already up.
            if (lc2 && (!twoTexBase || lc2Span >= 350.0)) { if (_bl) _bl.skippedResident += 1; return; }
            if (gd?.vectors?.length > 0 && gd.renderable !== false) {
              if (_bl) _bl.committed += 1;
              console.log(`[CACHE] [WeatherEngine] Committing GLOBAL base ${lc2 ? 'UNDER the resident fine grid (promote)' : 'while the fine product loads'} (${gd.vectors.length} vectors)`);
              windRevision.current += 1;
              commitWindData(gd);
              lastCommittedWindRef.current = { bounds: gd.bounds || null, stale: !!gd.stale };
            } else if (baseRetryCount < 5) {
              if (_bl) { _bl.emptyRetry += 1; _bl.lastEmpty = { n: gd?.vectors?.length || 0, renderable: gd?.renderable }; }
              // BOUNDED RETRY (2026-07-19): the base lane was ONE-SHOT — a transient 429/empty on
              // this single fetch left the session without a global base until the 5-min refresh
              // (the two-texture engine dormant the whole time). Re-drive through attemptFetch
              // (its cooldown/scrub/dedup guards apply; the fine product re-serves from cache).
              // First retry FAST (3 s): the zoomburst probe caught a mid-gesture structural clamp
              // living exactly in this window (fine-as-base, global lost its race).
              baseRetryCount += 1;
              retryTimer = setTimeout(attemptFetch, baseRetryCount === 1 ? 3000 : 8000);
            }
          })
          .catch((err) => {
            if (_bl) { _bl.error += 1; _bl.lastError = (err && err.message) || String(err); }
            if (cancelled) return;
            if (baseRetryCount < 5) {
              baseRetryCount += 1;
              retryTimer = setTimeout(attemptFetch, baseRetryCount === 1 ? 3000 : 8000);
            }
          });
      }

      // SUPERSESSION TOKEN (2026-07-20, the mutual-abort livelock): attemptFetch is re-entered
      // by FOUR schedulers (base-lane retries, late-arrival re-drives, the 5-min refresh,
      // moveend/gesture kicks). Each entry aborts the shared controller — killing a sibling's
      // in-flight fetch — and the sibling's abort surfaces as a SAFE-ZERO grid (the redirect
      // chain converts abort errors to zero-grid fallbacks), which walks the retry ladder and
      // aborts the next attempt in turn: the livelock behind "attempt 9/5" + "signal is aborted
      // without reason" storms while the backend was healthy. A superseded attempt must die
      // SILENTLY: no commit, no reschedule — the newer attempt owns the loop now.
      const myGen = ++windFetchGen;
      try {
        if (windFetchController) { try { windFetchController.abort(); } catch (e) { /* already done */ } }
        windFetchController = new AbortController();
        const data = await fetchWindData(bounds, windFetchController.signal, timeOffsetRef.current, false, forecastDays, activeModel);

        if (cancelled) return;
        if (myGen !== windFetchGen) return; // superseded mid-flight — the newer attempt owns the loop
        
        // Commit ONLY a renderable, non-stale grid. A failed redirect returns a 1-vector safe-zero
        // grid (renderable:false/stale:true) — committing it would CLEAR the wind heatmap. Instead
        // fall through to the retry branch and RETAIN the previous frame (the EURO-wind-clearing fix).
        const vpNow = getBounds();
        const freshCoversNow = isRenderableWindData(data)
          && (gridCovers(data.bounds, vpNow) || !lastCommittedWindRef.current || !gridCovers(lastCommittedWindRef.current.bounds, vpNow));
        if (isRenderableWindData(data) && !freshCoversNow) {
          // LATE-ARRIVAL BELT (2026-07-19): a fresh regional grid that no longer covers the
          // CURRENT viewport (slow upstream + the camera moved on) must not replace a covering
          // grid — observed live as a z11 2-deg box committing onto a z6.8 viewport, i.e. the
          // "moving clamp". The grid is already in WIND_CACHE for its own box; re-drive for the
          // tile the user is actually looking at.
          console.log(`[FETCH] [WeatherEngine] Dropping LATE wind grid (no longer covers viewport) — re-driving for the current tile`);
          retryTimer = setTimeout(attemptFetch, 250);
        } else if (freshCoversNow) {
          console.log(`[CACHE] [WeatherEngine] Wind data: ${data.vectors.length} vectors`);
          windRevision.current += 1;
          commitWindData(data);
          lastCommittedWindRef.current = { bounds: data.bounds || null, stale: false };
          retryCount = 0; // Reset on success
          // Cross-model prewarm (DEFAULT OFF): warm the OTHER models' wind into the isolated
          // per-model cache so a subsequent model switch is an instant warm commit, not a cold fetch.
          prewarmSiblingModelWind(activeModel, bounds, timeOffsetRef.current, forecastDays, null);
          // GLOBAL BACKSTOP PREFETCH (2026-07-19). When a REGIONAL fine grid commits, prefetch the
          // cheap global manifest product into WIND_CACHE (isPrewarm — no commit, no shared-state
          // clobber) so zooming OUT warm-commits the world instantly instead of showing the fine
          // box clipped in a wide viewport until the network round-trip lands (the zoom-out
          // "clamping" report). Cache-hit early-returns make repeat calls free.
          try {
            const gb = data.bounds;
            const gspan = gb ? (gb.west > gb.east ? (gb.east + 360.0) - gb.west : gb.east - gb.west) : 360;
            if (gspan < 350) {
              fetchWindData({ west: -180, south: -80, east: 180, north: 85 }, null, timeOffsetRef.current, false, forecastDays, activeModel, true).catch(() => {});
            }
          } catch (e) { /* insurance only — never break the commit path */ }
          // Schedule periodic refresh (5 min)
          retryTimer = setTimeout(attemptFetch, 5 * 60 * 1000);
        } else if (data?.vectors?.length > 0 && data.renderable !== false && data.stale
          && (!lastCommittedWindRef.current
              || lastCommittedWindRef.current.stale
              || (!gridCovers(lastCommittedWindRef.current.bounds, getBounds()) && gridCovers(data.bounds, getBounds())))) {
          // DEGRADED COMMIT, COVERAGE-AWARE (2026-07-19). A stale fallback grid (rate-limited
          // upstream answering a fine request with the coarse global) must never replace a good
          // COVERING grid — that was the zoom/pan "clearing" thrash. But refusing it in ALL
          // cases created the OPPOSITE bug: after a pan/zoom the retained fine box no longer
          // covers the viewport, every refetch returns stale, and the hole persists — the
          // user-reported PERSISTENT CLAMP. Coverage outranks freshness: commit stale when the
          // screen is empty, when what is showing is itself stale, or when the stale grid covers
          // a viewport the current grid has fallen off of. Keep climbing the retry ladder for
          // the real product either way.
          console.log(`[CACHE] [WeatherEngine] Committing STALE fallback wind grid (${data.vectors.length} vectors, ${data.staleReason || 'stale'}) — coverage over freshness; retrying for fresh`);
          windRevision.current += 1;
          commitWindData(data);
          lastCommittedWindRef.current = { bounds: data.bounds || null, stale: true };
          retryCount++;
          const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)] || 60000;
          retryTimer = setTimeout(attemptFetch, delay);
        } else {
          retryCount++;
          if (retryCount < MAX_RETRIES) {
            const delay = RETRY_DELAYS[retryCount] || 60000;
            console.log(`[FETCH] [WeatherEngine] No data (attempt ${retryCount}), retry in ${delay/1000}s`);
            retryTimer = setTimeout(attemptFetch, delay);
          } else {
            console.warn(`[FETCH] [WeatherEngine] Max retries (${MAX_RETRIES}) exhausted`);
            // Try again in 2 minutes
            retryTimer = setTimeout(() => { retryCount = 0; attemptFetch(); }, 120000);
          }
        }
      } catch (e) {
        if (e.name === 'AbortError' || cancelled) return;
        if (myGen !== windFetchGen) return; // superseded — no retry from a dead generation
        retryCount++;
        if (retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAYS[retryCount] || 60000;
          console.error(`[FETCH] [WeatherEngine] Error: ${e.message}, retry in ${delay/1000}s`);
          retryTimer = setTimeout(attemptFetch, delay);
        }
      }
    };

    // Start the fetch loop
    attemptFetch();

    // WIND VIEWPORT-FINE REFETCH (2026-07-19). The always-global era never needed a move
    // listener — one grid covered the world and a 5-min timer refreshed it. With the fine tier
    // (clampViewportBbox wind branch), panning/zooming can leave the committed regional grid
    // behind, so a camera move that CHANGES THE CLAMP TILE ID re-drives the fetch. The id is
    // 1-deg-snapped, so pans inside the same snapped box are free, and the global id is a
    // constant — wide views never refetch on move (exact old behaviour). attemptFetch carries
    // its own scrub-freeze, 429-cooldown, warm-cache and in-flight dedup, so re-entry is cheap.
    // The kill switch that disables the fine tier makes the id constant again, which makes this
    // listener a structural no-op — one lever kills both halves.
    let lastWindTileId = null;
    const onWindMoveEnd = () => {
      if (cancelled || !isWindActive) return;
      try {
        const b = getBounds();
        if (!b) return;
        const tile = clampViewportBbox(b, 'wind', activeModel, 'wind').selectedTileId || '';
        const prev = lastWindTileId;
        lastWindTileId = tile;
        // Refetch on tile change — AND on any move that leaves the committed grid not covering
        // the viewport (the reload/restore case: the first moveend used to be skipped entirely,
        // leaving a wrong-viewport box standing until the 5-min timer).
        const lc = lastCommittedWindRef.current;
        const uncovered = !!(lc && lc.bounds && !gridCovers(lc.bounds, b));
        if ((prev !== null && tile !== prev) || uncovered) attemptFetch();
      } catch (e) { /* the clamp must never break a move handler */ }
    };
    mapInstance.on('moveend', onWindMoveEnd);

    // GESTURE-START BASE KICK (2026-07-19, the zoomburst probe's frame-1 structural clamp — the
    // user saw it live). Cold enable at fine zoom can leave the FINE box as the only resident
    // grid (the global base fetch lost its race to a 429); a zoom-out that starts inside that
    // window shows the box edge MID-GESTURE, before any moveend fires. On gesture start, if the
    // committed grid is not world-span, re-drive attemptFetch immediately: the global backstop
    // prefetch usually has the world grid in WIND_CACHE already, so the base lane commits it
    // (engine PROMOTE) within a frame — before the viewport leaves the box. Dedup/cooldown
    // guards inside attemptFetch make spurious kicks free.
    const onWindGestureStart = () => {
      if (cancelled || !isWindActive) return;
      try {
        const twoTex = typeof window === 'undefined' || window.__RAW_DISABLE_WIND_BASE_OVERLAY__ !== true;
        const lc = lastCommittedWindRef.current;
        const span = lc && lc.bounds
          ? (lc.bounds.west > lc.bounds.east
            ? (lc.bounds.east + 360.0) - lc.bounds.west : lc.bounds.east - lc.bounds.west)
          : 0;
        if (twoTex && lc && lc.bounds && span < 350.0) attemptFetch();
      } catch (e) { /* never break a gesture handler */ }
    };
    mapInstance.on('zoomstart', onWindGestureStart);
    mapInstance.on('dragstart', onWindGestureStart);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (windFetchController) { try { windFetchController.abort(); } catch (e) { /* already done */ } }
      try { mapInstance.off('moveend', onWindMoveEnd); } catch (e) { /* map may be disposed */ }
      try { mapInstance.off('zoomstart', onWindGestureStart); } catch (e) { /* map may be disposed */ }
      try { mapInstance.off('dragstart', onWindGestureStart); } catch (e) { /* map may be disposed */ }
    };
  }, [mapInstance, activeModel, forecastDays, isWindActive]); // Refetch when model or forecast window changes

  // F3: background-load the wind multi-hour series for the active model/viewport — the page
  // containing the current hour first, neighbours on idle — so far-hour scrubbing is instant
  // (the during-drag path reads getWindSeriesFrame above). Flag-gated (window.__WIND_SERIES__);
  // a no-op until enabled, so the default wind path is unchanged.
  useEffect(() => {
    if (!mapInstance || !isWindActive) return;
    let cancelled = false;
    const controller = new AbortController();
    const kick = () => {
      if (cancelled || !mapInstance) return;
      try {
        const b = mapInstance.getBounds();
        ensureWindSeries(
          activeModel,
          { west: b.getWest(), south: Math.max(-85, b.getSouth()), east: b.getEast(), north: Math.min(85, b.getNorth()) },
          timeOffsetHours,
          controller.signal
        );
      } catch (e) { /* map not ready — ignore */ }
    };
    const t = setTimeout(kick, 600);
    const onIdle = () => kick();
    mapInstance.on('moveend', onIdle);
    // On scrub start, eagerly load EVERY page so any hour the user jumps to during a fast drag
    // is already cached (the during-drag path reads getWindSeriesFrame synchronously).
    const onScrubStart = () => {
      if (cancelled || !mapInstance) return;
      try {
        const b = mapInstance.getBounds();
        prewarmWindSeries(
          activeModel,
          { west: b.getWest(), south: Math.max(-85, b.getSouth()), east: b.getEast(), north: Math.min(85, b.getNorth()) },
          controller.signal
        );
      } catch (e) { /* map not ready — ignore */ }
    };
    if (typeof window !== 'undefined') window.addEventListener('timeline_scrub_start', onScrubStart);
    return () => {
      cancelled = true;
      clearTimeout(t);
      controller.abort();
      try { mapInstance.off('moveend', onIdle); } catch (e) { /* ignore */ }
      if (typeof window !== 'undefined') window.removeEventListener('timeline_scrub_start', onScrubStart);
    };
    // Page is intentionally NOT a dep (mirror useMarineOrchestrator). prewarmWindSeries loads ALL
    // pages on settle + scrub-start; re-running per page crossing only ABORTS the in-flight warm via
    // the cleanup's controller.abort(), so a fast multi-page scrub perpetually killed its own wind
    // warm → the wind series never warmed → wind scrub fell to per-hour fetches. Key on
    // model/layer/map only so the warm COMPLETES and getWindSeriesFrame hits during scrub.
  }, [mapInstance, activeModel, isWindActive]);

  // On a MODEL switch (or the first wind landing) eagerly warm the NEW model's series pages —
  // mirror useMarineOrchestrator's model-switch prewarm. The scrub-start prewarm above fires only
  // on a DRAG and series pages are per-model, so a switched-to model's series stayed cold and every
  // click-jump/landed hour fell to a per-hour fetch (the model-compare "Cache miss ... Fetching
  // immediately" storm, 2026-07-10). Rapid re-switching aborts the previous model's still-queued
  // warm via the cleanup controller (prewarmWindSeries is deduped + TTL'd + capped at 2 concurrent),
  // so toggling can't pile onto the 1-CPU backend. Ref-guarded: fires on model change only — never
  // on pans or hour ticks. Kill switch: window.__RAW_WIND_MODEL_PREWARM_DISABLED__ = true
  // (scrub-start prewarm and the per-hour fallback are unchanged); __WIND_SERIES__ = false also
  // no-ops it (master series flag).
  const prevWindPrewarmModelRef = useRef(null);
  useEffect(() => {
    if (!mapInstance || !isWindActive) return;
    if (typeof window !== 'undefined' && window.__RAW_WIND_MODEL_PREWARM_DISABLED__) return;
    if (prevWindPrewarmModelRef.current === activeModel) return;
    prevWindPrewarmModelRef.current = activeModel;
    const controller = new AbortController();
    try {
      const b = mapInstance.getBounds();
      prewarmWindSeries(
        activeModel,
        { west: b.getWest(), south: Math.max(-85, b.getSouth()), east: b.getEast(), north: Math.min(85, b.getNorth()) },
        controller.signal
      );
      if (typeof window !== 'undefined') {
        window.__WIND_MODEL_PREWARM_COUNT__ = (window.__WIND_MODEL_PREWARM_COUNT__ || 0) + 1;
      }
    } catch (e) { /* map not ready — ignore */ }
    return () => { try { controller.abort(); } catch (e) { /* ignore */ } };
  }, [activeModel, mapInstance, isWindActive]);

  // ===== TIMELINE SCRUB (local cache re-index, with FETCH ON CACHE MISS) =====
  const prevOffsetRef = useRef(timeOffsetHours);
  useEffect(() => {
    if (prevOffsetRef.current === timeOffsetHours) return;
    prevOffsetRef.current = timeOffsetHours;
    if (!mapInstance || !isWindActive) return;

    // Active drag scrub path - immediate cache-only lookup (zero network requests)
    if (window.isScrubbingTimeline) {
      let targetData = null;
      try {
        const b = mapInstance.getBounds();
        const bounds = {
          west: b.getWest(),
          south: Math.max(-85, b.getSouth()),
          east: b.getEast(),
          north: Math.min(85, b.getNorth())
        };
        if (getBackendWindFlag()) {
          targetData = getModelSafeWind(activeModel, timeOffsetHours, bounds);
        } else {
          const cache = getWindHourlyCache();
          if (cache?.results?.length && cache.model === activeModel) {
            targetData = extractWindAtOffset(cache, timeOffsetHours);
          }
        }
        // F3: wind multi-hour series cache — nearest frame for the scrubbed hour, served
        // synchronously. Additive: returns null when the series flag is off or unloaded, so the
        // existing per-hour cache/fetch path is unchanged.
        if (!targetData || !(targetData.vectors?.length > 0)) {
          const seriesFrame = getWindSeriesFrame(activeModel, bounds, timeOffsetHours);
          if (seriesFrame) targetData = seriesFrame;
        }
      } catch (e) {
        // ignore
      }

      if (targetData && targetData.vectors?.length > 0) {
        windRevision.current += 1;
        commitWindData(targetData);
      }
      return;
    }

    const t = setTimeout(async () => {
      let cacheMiss = false;
      let targetData = null;
      try {
        if (getBackendWindFlag()) {
          const b = mapInstance.getBounds();
          const bounds = {
            west: b.getWest(),
            south: Math.max(-85, b.getSouth()),
            east: b.getEast(),
            north: Math.min(85, b.getNorth())
          };
          targetData = getModelSafeWind(activeModel, timeOffsetHours, bounds);
          if (!targetData) {
            cacheMiss = true;
          }
        } else {
          const cache = getWindHourlyCache();
          if (cache?.results?.length && cache.model === activeModel) {
            targetData = extractWindAtOffset(cache, timeOffsetHours);
            if (!targetData || !targetData.vectors || targetData.vectors.length === 0) {
              cacheMiss = true;
            }
          } else {
            cacheMiss = true;
          }
        }
      } catch (e) {
        cacheMiss = true;
      }

      // SERIES-FIRST SETTLE (2026-07-10, the wind "Cache miss ... Fetching immediately" storm): the
      // during-drag path serves warmed series frames (above), but this SETTLE path only consulted the
      // per-hour caches — so every hour LANDED on after a drag/jump missed and fired a per-hour network
      // fetch. Marine's settle has committed warmed series frames ("no fetch") since F3; mirror it for
      // wind. Additive: getWindSeriesFrame returns null when the series is off (__WIND_SERIES__=false
      // restores the old behavior exactly) or unloaded, falling through to the fetch unchanged.
      if (cacheMiss) {
        try {
          const b = mapInstance.getBounds();
          const bounds = {
            west: b.getWest(),
            south: Math.max(-85, b.getSouth()),
            east: b.getEast(),
            north: Math.min(85, b.getNorth())
          };
          const seriesFrame = getWindSeriesFrame(activeModel, bounds, timeOffsetHours);
          if (seriesFrame && seriesFrame.vectors?.length > 0) {
            targetData = seriesFrame;
            cacheMiss = false;
            if (typeof window !== 'undefined') {
              window.__WIND_SERIES_SETTLE_HIT__ = (window.__WIND_SERIES_SETTLE_HIT__ || 0) + 1;
            }
          }
        } catch (e) { /* fall through to the per-hour fetch */ }
      }

      // TERMINAL NO-COVERAGE skip (2026-07-10, audit queue #2 — wind analog of marine d38a693b):
      // a genuinely-terminal coverage 404 recorded by windController won't resolve by refetching
      // this run — skip the doomed per-hour fetch and keep the held frame displaying. TTL 15 min
      // (marineControllerCache); kill __RAW_DISABLE_TERMINAL_NOCOV_BYPASS__ (shared with marine).
      // Tel: __WIND_TERMINAL_NOCOV_SKIP_COUNT__.
      if (cacheMiss && isTerminalNoCoverage(activeModel, 'wind', timeOffsetHours)) {
        if (typeof window !== 'undefined') {
          window.__WIND_TERMINAL_NOCOV_SKIP_COUNT__ = (window.__WIND_TERMINAL_NOCOV_SKIP_COUNT__ || 0) + 1;
        }
        return;
      }

      if (cacheMiss) {
        console.log(`[CACHE] [WeatherEngine] Cache miss for wind at hour +${timeOffsetHours}h. Fetching immediately...`);
        try {
          const b = mapInstance.getBounds();
          const bounds = {
            west: b.getWest(),
            south: Math.max(-85, b.getSouth()),
            east: b.getEast(),
            north: Math.min(85, b.getNorth())
          };

          const clampResult = clampViewportBbox(bounds, 'wind', activeModel, 'wind');
          if (!clampResult.isInside) {
            console.log(`[WeatherEngine] Scrub target +${timeOffsetHours}h is outside wind coverage. Clearing visual.`);
            commitWindData(null);
            windRevision.current += 1;
            return;
          }

          // F3: revalidate via the cache-aware path (was forceFetch=true). The WeatherEngine
          // caches already missed above, but fetchWindData's own WIND_CACHE may still hold this
          // exact tile/hour — let it reuse that (TTL-gated) instead of forcing a duplicate network
          // fetch, and join any in-flight request for the same target.
          const data = await fetchWindData(bounds, null, timeOffsetHours, false, forecastDays, activeModel);
          // Request-intent parity: if the user scrubbed or switched model during the async fetch,
          // this result is stale — discard it (the newer effect run owns the display) (F3).
          if (timeOffsetRef.current !== timeOffsetHours || activeModelRef.current !== activeModel) {
            console.log(`[SCRUB] [WeatherEngine] Discarding stale wind fetch (req +${timeOffsetHours}h/${activeModel}; now +${timeOffsetRef.current}h/${activeModelRef.current}).`);
            return;
          }
          if (isRenderableWindData(data)) {
            console.log(`[SCRUB] [WeatherEngine] Fetch wind grid success for hour +${timeOffsetHours}h: ${data.vectors.length} vectors`);
            windRevision.current += 1;
            commitWindData(data);
          } else if (typeof window !== 'undefined' && window.__RAW_WIND_HOLD_LAST_FRAME_DISABLED__ === true) {
            // Kill switch: restore the old clear-on-no-coverage behavior exactly.
            console.log(`[WeatherEngine] No wind forecast coverage at offset +${timeOffsetHours}h. Clearing visual.`);
            commitWindData(null);
            windRevision.current += 1;
          } else {
            // HOLD-LAST-FRAME (2026-07-10, audit queue #2 — wind analog of marine d38a693b): a
            // no-coverage or safe-zero result must not blank the wind layer mid-scrub; keep the
            // last-good frame displaying. The 1-vector safe-zero grid used to pass the old
            // vectors.length>0 guard and commit (= the "wind clears at 14 days" blank); the
            // renderable guard above now rejects it, and the terminal record in windController
            // stops the settle re-driving this hour for 15 min.
            console.log(`[WeatherEngine] No renderable wind at +${timeOffsetHours}h (${(data && data.__failureReason) || 'empty'}) — holding last frame.`);
          }
        } catch (err) {
          // F3: preserve the previous same-model frame on a fetch error — do NOT clear the visual
          // merely because a (far-hour) fetch failed/aborted. A transient error shouldn't blank wind.
          console.error('[WeatherEngine] Wind scrub fetch failed (preserving previous frame):', err.message);
        }
      } else if (targetData && targetData.vectors?.length > 0) {
        const _now = Date.now();
        if (_now - _lastScrubLogTime > 2000) {
          _lastScrubLogTime = _now;
          console.log(`[CACHE] [WeatherEngine] Timeline data: ${targetData.vectors.length} vectors at +${timeOffsetHours}h`);
        }
        windRevision.current += 1;
        commitWindData(targetData);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [timeOffsetHours, mapInstance, activeModel, isWindActive, forecastDays]);

  // ===== VIEWPORT CHANGE REFETCH =====
  useEffect(() => {
    if (!mapInstance || !isWindActive) return;

    let timer = null;
    let lastMoveSpan = 0;

    const onMoveEnd = () => {
      if (window.isScrubbingTimeline) return;
      if (timer) {
        clearTimeout(timer);
      }
      try {
        const b = mapInstance.getBounds();
        const bounds = {
          west: b.getWest(),
          south: Math.max(-85, b.getSouth()),
          east: b.getEast(),
          north: Math.min(85, b.getNorth())
        };
        // Turbo-boost: check if the new bounds are contained in cache, drop pan delay to 50ms instead of 500ms
        const isCached = isContainedInWindCache(bounds, activeModel);
        // ZOOM-OUT FAST LANE (2026-07-20, user: "the zoom out is a little slower than I'd like"):
        // an EXPANDING viewport (new span > previous) refetches after 150 ms instead of 500 —
        // the server answers expansion requests instantly from the clipped global_mid, and the
        // no-op commit guard + supersession token make an early duplicate harmless.
        const moveSpan = bounds.east - bounds.west;
        const expanding = lastMoveSpan > 0 && moveSpan > lastMoveSpan + 0.01;
        lastMoveSpan = moveSpan;
        const delay = isCached ? 50 : (expanding ? 150 : 500);

        timer = setTimeout(async () => {
          timer = null;

          if (window.isScrubbingTimeline) {
            console.log("[SCRUB] [FETCH] Wind fetch suppressed during active scrubbing");
            return;
          }

          // v6I.1 Check coverage limits first
          const clampResult = clampViewportBbox(bounds, 'wind', activeModel, 'wind');
          if (!clampResult.isInside) {
            console.log(`[WeatherEngine] Viewport moved outside wind coverage. Clearing visual.`);
            commitWindData(null);
            windRevision.current += 1;
            return;
          }

          try {
            const data = await fetchWindData(bounds, null, timeOffsetRef.current, false, forecastDays, activeModel);
            // Renderable guard (2026-07-10, the "ICON wind heatmap cleared" report): the 1-vector
            // safe-zero fallback PASSED the old vectors.length>0 check and committed here ×5 on
            // moveend refetches of a failed far hour — the layer's renderable===false branch then
            // CLEARED the wind buffers (the same guard-class bug the settle path fixed in 06fbeef2).
            // Hold the last-good frame instead; kill __RAW_WIND_HOLD_LAST_FRAME_DISABLED__ restores.
            const _holdDisabled = typeof window !== 'undefined' && window.__RAW_WIND_HOLD_LAST_FRAME_DISABLED__ === true;
            // STALE-COVERING UPGRADE (2026-07-20, live-caught): during an upstream rate-limit
            // window the backend serves a STALE dynamic product that COVERS the whole viewport
            // (containment fallback) — but `!d.stale` in isRenderableWindData rejected it, so
            // the screen kept a tiny old fine box surrounded by the 10-deg smear ("the clamp is
            // hiding the wind"). Coverage outranks freshness (the native-recovery lane's own
            // rule): accept a stale REAL regional grid that covers the viewport when no fresh
            // covering fine overlay is resident. Safe-zero/empty fallbacks stay held (they carry
            // __failureReason / renderable:false / <4 vectors). World-span stale never upgrades
            // (the global manifest lane owns that). Kill: __RAW_DISABLE_WIND_STALE_COVERING__.
            const staleCoveringUpgrade = (() => {
              try {
                if (typeof window !== 'undefined' && window.__RAW_DISABLE_WIND_STALE_COVERING__ === true) return false;
                if (!data || data.stale !== true || data.renderable === false) return false;
                if (data.__failureReason) return false;
                if (!Array.isArray(data.vectors) || data.vectors.length < 4) return false;
                const db = data.bounds;
                if (!db) return false;
                const dSpan = db.east >= db.west ? db.east - db.west : (db.east + 360.0) - db.west;
                if (dSpan >= 350.0) return false;
                const eps = 0.05;
                const vpS = Math.max(-85, bounds.south), vpN = Math.min(85, bounds.north);
                const covers = db.west <= bounds.west + eps && db.east >= bounds.east - eps
                  && db.south <= vpS + eps && db.north >= vpN - eps;
                if (!covers) return false;
                const f = typeof window !== 'undefined' ? window.__WIND_FINE_OVERLAY__ : null;
                const fineCovers = !!(f && f.active && f.bounds
                  && f.bounds.west <= bounds.west + eps && f.bounds.east >= bounds.east - eps
                  && f.bounds.south <= vpS + eps && f.bounds.north >= vpN - eps);
                if (fineCovers) return false;
                // RESOLUTION GUARD (2026-07-20 regression study #1, refined same day): a stale
                // coarse covering product must never REPLACE a finer resident box over the
                // viewport centre — that trade erased a live tropical system (the 0.5-deg box
                // resolved its rotation; the 2-deg replacement cannot). BUT the guard only
                // holds while the sharp box still covers MOST of the view (>= 70% area):
                // below that, the un-covered remainder is depleted 10-deg base ("animations
                // missing for the top part of the low") and coverage outranks sharpness.
                if (f && f.active && f.bounds && f.cols > 0) {
                  const fCell = (f.bounds.east - f.bounds.west) / Math.max(1, f.cols - 1);
                  const dCell = (db.east - db.west) / Math.max(1, (data.cols || 2) - 1);
                  const cx = (bounds.west + bounds.east) / 2, cy = (vpS + vpN) / 2;
                  const centerInFine = f.bounds.west <= cx && f.bounds.east >= cx
                    && f.bounds.south <= cy && f.bounds.north >= cy;
                  const ovW = Math.max(0, Math.min(f.bounds.east, bounds.east) - Math.max(f.bounds.west, bounds.west));
                  const ovH = Math.max(0, Math.min(f.bounds.north, vpN) - Math.max(f.bounds.south, vpS));
                  const vpArea = Math.max(1e-6, (bounds.east - bounds.west) * (vpN - vpS));
                  const fineCoverFrac = (ovW * ovH) / vpArea;
                  if (centerInFine && dCell > fCell * 1.5 && fineCoverFrac >= 0.7) return false;
                }
                return true;
              } catch (e) { return false; }
            })();
            if (isRenderableWindData(data) || staleCoveringUpgrade || (_holdDisabled && data && data.vectors?.length > 0)) {
              console.log(`[FETCH] [WeatherEngine] Viewport wind fetch success: ${data.vectors.length} vectors${staleCoveringUpgrade && !isRenderableWindData(data) ? ' (STALE-COVERING upgrade — covering beats holding)' : ''}`);
              windRevision.current += 1;
              commitWindData(data);
            } else if (data) {
              console.log(`[WeatherEngine] Viewport refetch unrenderable (${data.__failureReason || 'empty'}) — holding last frame.`);
            }
          } catch (e) { /* ignore */ }
        }, delay);
      } catch (e) { /* ignore bounds error on init */ }
    };

    mapInstance.on('moveend', onMoveEnd);
    return () => {
      mapInstance.off('moveend', onMoveEnd);
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [mapInstance, isWindActive, activeModel, forecastDays]);  

  // v3.11.1: Subscribe to forecast pipeline for downstream engine consumers
  useEffect(() => {
    var unsub = onForecastUpdate(function(field) {
      console.log('[TRANSITION] [WeatherEngine] Pipeline update:', field?.source, field?.grid?.width + 'x' + field?.grid?.height);
    });
    return unsub;
  }, []);

  return { windData, windRevision, windDeliveryQueue: windDeliveryQueueRef };
}
