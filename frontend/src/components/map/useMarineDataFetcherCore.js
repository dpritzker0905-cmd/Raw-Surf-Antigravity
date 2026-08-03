import { useCallback } from 'react';
import { fetchMarineData, getRemainingCooldown, getModelSafeMarine, isContainedInMarineCache } from './marineController';
import { getMarineSeriesFrame } from './marineGridSeries';   // flavor-toggle instant cache commit
import { fetchCopernicusComponentGrid, mergeComponentGrid, COMPONENT_LAYERS } from './copernicusGridFetcher';
import { getBackendCopernicusFlag, getSharedValidTime, getBackendIconMarineFlag, getBackendWeatherFlag, getSurfModeFlag } from './backendWeatherServiceClient';
import { updateDeprecationDiag } from './forecastSamplers';
import { isInCooldown, clearCooldown } from './marineControllerUtils';
import { _marineDataSignature } from './useMarineOrchestratorDiag';
import { recordMarineEvent } from './marineForensics';   // __RAW_FORENSIC__ ring buffer
// THE CONSUMER. Imported for its side effect: registers __RAW_RING_REPORT__() / __RAW_RING_TICK__()
// on window, so the rings this app has always written finally have a reader. It shipped in
// 96dc9165 with ZERO call sites — a consumer nobody calls is the exact disease it was built to
// cure. `ringReaderTick` is rate-limited to once a minute and gates on the CLOCK BEFORE walking
// any ring, so it is safe from any path; it logs only on FAILURE and never writes to a ring.
import { ringReaderTick } from './marineRingReader';
import {
  DISPLAY_EURO_WAVES_MAX_HOURS,
  DISPLAY_EURO_COMPONENT_MAX_HOURS,
  DISPLAY_ICON_MAX_HOURS,
  checkShouldClearRegionalGrid,
  isActivationSource,
  buildIconFallbackGrid,
  buildEuroFallbackGrid,
  buildCopernicusEmptyGrid,
  getAbortRecoveryGrid,
  handleRegionalGridClearing,
  handleCooldownFallback,
  commitMarineData,
  bufferPanMovedReplay
} from './useMarineDataFetcherHelpers';
import { getTarget, endTransition, recordChurn } from './marineTransitionCoordinator';

/**
 * Release an abandoned in-flight marine fetch when a newer request supersedes it.
 *
 * Phase 2c (OOM rework): during ACTIVE timeline scrubbing we ABORT the abandoned fetch —
 * closing the socket so the backend's disconnect-detection cancels the remaining per-hour
 * upstream work instead of running it to completion. Under a scrub storm there's no
 * switch-back benefit to detaching, only a pile-up of open connections + backend memory.
 * For model/layer switches we keep DETACHing so the abandoned fetch self-caches (a
 * switch-back becomes a cache hit). The aborted fetch's finally -> inFlight.complete(...,
 * 'abort') removes its registry entry, so no extra bookkeeping is needed here.
 */
function releaseAbandonedFetch(inFlight, controller, site, activeSource, source) {
  if (!controller || !controller.__intent) return;
  const scrubbing = typeof window !== 'undefined' && window.isScrubbingTimeline;
  if (scrubbing) {
    recordChurn('scrub_abort', { site, from: activeSource, to: source });
    try { controller.abort(); } catch (e) { /* ignore */ }
    return;
  }
  recordChurn('detach', { site, from: activeSource, to: source });
  inFlight.detach(controller.__intent);
}

// Max time a marine fetch may legitimately hold the isFetching lock before we treat it as stranded.
// A real fetch registers in the governor within ms, so the govIdle guard (not this timeout) is the
// real safety against aborting a live request — this just bounds how long a blank persists before
// the watchdog acts. Kept short for fast recovery; govIdle prevents false positives.
export const MARINE_FETCH_LEASE_MS = 4000;

// HARD lease: a lock held this long is treated as dead UNLESS the in-flight registry proves otherwise. The
// govIdle guard below trusts the governor to flag a live fetch, but a stranded fetch can leave the governor's
// in-flight counters set TOO (its decrement skipped alongside locks.isFetching), so govIdle stays false forever
// and the lock wedges PERMANENTLY (forensically observed: grid stuck on a stale tile while panning, governor
// never clearing). Past the hard lease we heal regardless of govIdle, so a doubly-stranded (lock + governor)
// wedge can still self-recover.
export const MARINE_FETCH_HARD_LEASE_MS = 25000;

// LIVE-FETCH CEILING (2026-07-06, the post-deploy abort loop): "held >25s" is NOT "provably dead" on a
// cold-restoring backend — a real EURO 48-frame grid_series measured 40.7s live. The hard-lease heal
// aborted that live fetch, the recovery refetch hit the same wall, and the loop cycled forever
// (requestId 40→45 in one console capture; heatmaps starved of every commit). When the in-flight
// registry still shows OUR controller as the live foreground entry, extend the lease to this absolute
// ceiling instead; a zombie hang (entry never deleted, fetch never settles) still heals here. True
// strands (no entry / different controller) keep healing at the hard lease exactly as before.
export const MARINE_FETCH_LIVE_CEILING_MS = 120000;

// STRANDED-DEBOUNCE HEAL decision (2026-07-22, hunt defect 3.3). A pre-dispatch early return in
// updateMarineGrid leaves requestId=0 (it never reached the :486 dispatch-time clear), so the finally's
// requestId===marineRequestIdRef.current block — which a real prior fetch bumped to N>0 — never clears
// __MARINE_FETCH_DEBOUNCING__. The enqueue set it true, so it strands, holding the ~8 "transitioning"
// gates on stale frames until the settle watchdog (>8s) or the next gesture heals it. A requestId=0
// invocation owns no in-flight fetch, so clearing the flag can never stomp a live one (a dispatched
// fetch already cleared it at :486). Heal ONLY when the flag is genuinely stranded true AND this path
// did not deliberately preserve the debounce (clearDebounce; the isMoving/detached/degenerate-retry
// paths set it false because they schedule a re-drive). Kill: __RAW_DISABLE_MARINE_DEBOUNCE_STRAND_HEAL__.
export function shouldHealStrandedDebounce(requestId, clearDebounce, debouncingFlag) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_MARINE_DEBOUNCE_STRAND_HEAL__ === true) return false;
  return requestId === 0 && clearDebounce === true && debouncingFlag === true;
}

/**
 * Stale-lock watchdog. A superseded marine fetch can strand locks.isFetching=true +
 * __MARINE_FETCH_PENDING__/__MARINE_FETCH_DEBOUNCING__ when its finally skips cleanup (the
 * `requestId === marineRequestIdRef.current` guard fails because a newer fetch bumped the id).
 * The same-target dedup below then trusts the dead-but-not-aborted abortControllerRef and skips
 * EVERY recovery fetch → the heatmap wedges blank forever until a scrub/pan releases the lock
 * (the "sometimes the heatmap won't load / won't track the scrub" + "clears after toggling" churn,
 * reproduced live on dev). This releases the lock ONLY when it's dead by every available signal —
 * held past the lease, the governor shows no active marine fetch, and the in-flight registry has no
 * live foreground entry for our controller (a live entry extends the lease to the absolute ceiling,
 * so a slow cold-backend fetch is never aborted) — letting the caller fall through to a fresh fetch.
 * Returns true if it healed a stranded lock.
 */
export function releaseStaleMarineLock(locks, abortControllerRef, inFlight = null) {
  if (!locks || !locks.isFetching) return false;
  const startedAt = locks.fetchStartedAt || 0;
  if (!startedAt) return false;
  const heldMs = Date.now() - startedAt;
  if (heldMs <= MARINE_FETCH_LEASE_MS) return false;
  // Past the HARD lease the lock is treated as dead — heal even if the governor (which can strand too) still
  // shows it active, otherwise the wedge is permanent. Under the hard lease keep deferring to govIdle so we
  // never abort a real slow request.
  const provablyDead = heldMs > MARINE_FETCH_HARD_LEASE_MS;
  // The governor only sees legacy proxy requests (governMarineRequest); BACKEND-redirect grid fetches
  // (fetchBackendMarineGrid / fetchBackendCopernicusGrid — plain fetch()) never register there, so
  // govIdle reads true while one is live. On a slow backend (>4s) the old code then ABORTED the live
  // fetch every lease period — an infinite kill/refetch loop (live console repro 2026-07-04: "Stale
  // fetch lock released… → Grid fetch error: signal is aborted" cycling every ~4.5s). The in-flight
  // REGISTRY does track these: a FOREGROUND entry whose controller is the current, un-aborted one is
  // a live fetch — never a stranded lock (any completion path deletes the entry in complete()).
  // Past the hard lease the SAME live-entry signal extends the lease to MARINE_FETCH_LIVE_CEILING_MS
  // (2026-07-06: the 25s heal was murdering live 40s cold-backend series fetches in an endless
  // abort/refetch loop). Kill: __RAW_DISABLE_LOCK_LIVE_EXTEND__. Telemetry: __MARINE_LOCK_LIVE_EXTENDED__.
  if (inFlight && typeof inFlight.find === 'function') {
    const ctrl = abortControllerRef?.current;
    if (ctrl && !ctrl.signal?.aborted && ctrl.__intent) {
      const entry = inFlight.find(ctrl.__intent);
      if (entry && entry.state === 'foreground' && entry.controller === ctrl) {
        if (!provablyDead) return false;
        const extendDisabled = typeof window !== 'undefined' && !!window.__RAW_DISABLE_LOCK_LIVE_EXTEND__;
        if (!extendDisabled && heldMs <= MARINE_FETCH_LIVE_CEILING_MS) {
          if (typeof window !== 'undefined') {
            const t = window.__MARINE_LOCK_LIVE_EXTENDED__ = window.__MARINE_LOCK_LIVE_EXTENDED__ || { count: 0 };
            t.count++; t.lastHeldMs = heldMs; t.lastAt = new Date().toISOString();
          }
          recordChurn('stale_lock_live_extend', { heldMs });
          return false;
        }
      }
    }
  }
  let govIdle = true;
  try {
    const gov = (typeof window !== 'undefined') && window.__MARINE_GOVERNOR_STATE__;
    if (gov) {
      govIdle = !gov.activeGridFetches && !gov.activeCopernicusFetches &&
                !(gov.inFlightKeys && gov.inFlightKeys.length);
    }
  } catch (e) { govIdle = true; }
  if (!govIdle && !provablyDead) return false; // a real fetch may still be running — never abort it
  try {
    if (abortControllerRef.current && !abortControllerRef.current.signal?.aborted) {
      abortControllerRef.current.abort();
    }
  } catch (e) { /* ignore */ }
  locks.isFetching = false;
  locks.activeSource = null;
  locks.fetchStartedAt = 0;
  if (typeof window !== 'undefined') {
    window.__MARINE_FETCH_PENDING__ = null;
    window.__MARINE_FETCH_DEBOUNCING__ = false;
  }
  recordChurn('stale_lock_release', { provablyDead });
  console.warn('[Marine] Stale fetch lock released (' +
    (provablyDead ? `provably dead, held >${MARINE_FETCH_HARD_LEASE_MS}ms (governor may also be stranded)` : 'held >lease, governor idle') +
    ') — refetching to recover wedged heatmap.');
  return true;
}

export function useMarineDataFetcherCore({
  mapInstance,
  activeMarineLayerRef,
  timeOffsetRef,
  activeModelRef,
  marineData,
  setMarineData,
  marineRevision,
  marineRequestIdRef,
  abortControllerRef,
  inFlight,
  activeMarineLayersRef,
  marineFetchLocksRef,
  isCommittingDataRef,
  isInternalMapUpdateRef,
  internalUpdateTimerRef,
  swrTimerRef,
  swrRetryCountRef,
  cooldownRetryRef,
  clearAllTimers,
  scheduleSWRRevalidation,
  scheduleCooldownRetry,
  scheduleDegenerateRetry,
  resetRetryCounts,
  updateMarineGridRef,
  enqueueMarineUpdateRef,
  consecutiveFailuresRef,
  abortRecoveryRetryCountRef,
  lastFetchedModelRef,
  pendingMarineIntentRef,
  pipelineEventsRef,
  pipelineCountersRef,
  lastCommittedSigRef,
  orchestratorInFlight,
  scheduledRef,
  timeoutIdRef,
  moveendDebounceRef,
  scrubDebounceRef,
  detachedWaitTimerRef,
  getViewportHash,
  logPipelineEventHelper,
  marineDataRef,
  lastInvocationRef
}) {
  const updateMarineGrid = useCallback(async (source = 'unknown') => {
    // Null-map guard: this runs from deferred timers/rAF (see the dispatcher below) that can fire
    // after the map is torn down; without it the first `mapInstance.getZoom()` / `.isMoving()` below
    // throws (`Cannot read properties of null`). No map = nothing to fetch or render — bail.
    if (!mapInstance) return;
    let phase = 'init';
    // Phase 2: this invocation's controller + outcome, for identity-safe registry bookkeeping
    // in `finally` (a detached/stale request must still be removed from the registry).
    let myController = null;
    let fetchStatus = 'failure';
    const rawModel = activeModelRef.current;
    const layer = activeMarineLayerRef.current || 'waves';
    const timeOffset = timeOffsetRef.current;
    const isWaves = layer === 'waves';
    const nativeLimit = isWaves ? DISPLAY_EURO_WAVES_MAX_HOURS : DISPLAY_EURO_COMPONENT_MAX_HOURS;
    const model = (rawModel === 'ICON' && timeOffset > 168 && !getBackendIconMarineFlag()) ? 'GFS'
                : (rawModel === 'ICON' && timeOffset > DISPLAY_ICON_MAX_HOURS) ? 'GFS'
                : (rawModel === 'EURO' && timeOffset > nativeLimit) ? 'GFS'
                : rawModel;
    const zoom = mapInstance.getZoom();
    const locks = marineFetchLocksRef.current;
    let requestId = 0;
    let clearDebounce = true;
    // Generation of the transition this fetch fulfills, if any. Captured at dispatch so
    // the finally can end ONLY the transition it owns — a stale request (older generation,
    // or a non-transition viewport refetch) can never end a newer transition.
    let capturedTransitionGen = null;

    try {
      const isTimelineScrub = source === 'timeline_scrub' || source.includes('timeline');
      if (!isTimelineScrub && (window.isScrubbingTimeline || isCommittingDataRef.current)) return;
      if (!activeMarineLayersRef.current) return;
      const viewportHash = getViewportHash();
      if (!viewportHash) {
        console.log(`[Marine] Viewport bounds are degenerate or map not ready. Skipping fetch (source=${source}).`);
        const isRetrySource = source.includes('retry');
        const canRetry = source === 'mount' || source === 'load' || source === 'manual'
          || source === 'flavor_toggle' || isRetrySource;
        if (canRetry) {
          clearDebounce = false;
          scheduleDegenerateRetry(source, (nextSource) => {
            if (activeMarineLayersRef.current && updateMarineGridRef.current) {
              updateMarineGridRef.current(nextSource);
            }
          });
        }
        return;
      }
      resetRetryCounts();
      const isRetry = source === 'cooldown_retry' || source === 'delayed_retry' || source === 'swr_revalidation' || source === 'clamp_resharpen';
      const hasValidData = marineData && marineData.grid && marineData.grid.vectors && marineData.grid.vectors.length > 0;
      const isCorrectLayer = marineData?.grid?.__componentLayer === layer;
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
      const _flavorMismatch = !!(marineData?.grid?.ratingMode) !== getSurfModeFlag();
      let bypassDedupe = !hasValidData || !isCorrectLayer || _flavorMismatch || !!(marineData?.stale || marineData?.grid?.stale);

      if (!isRetry && !isTimelineScrub && !bypassDedupe && locks.lastHash === viewportHash && (Date.now() - locks.lastTime < 5 * 60 * 1000)) return;
      if (locks.lastHash !== viewportHash) {
        consecutiveFailuresRef.current = 0;
        resetRetryCounts();
        clearAllTimers();
        locks.lastTime = 0; // Prevent 1200ms rate-limiter from blocking the fetch on layer/viewport switch
      }

      if (source !== 'swr_revalidation') {
        if (swrTimerRef.current) {
          clearTimeout(swrTimerRef.current);
          swrTimerRef.current = null;
        }
        swrRetryCountRef.current = 0;
      }
      updateMarineGridRef.current = updateMarineGrid;

      // Heal a stranded lock before trusting it (otherwise the same-target dedup below skips
      // this recovery fetch forever → permanent blank heatmap). No-op for a healthy in-flight fetch.
      releaseStaleMarineLock(locks, abortControllerRef, inFlight);
      if (locks.isFetching) {
        // Same-target dedup (see enqueueMarineUpdate): never abort an in-flight fetch that's
        // already loading this exact model/layer/hour — the activation multi-trigger would
        // otherwise abort-loop into the recovery-grid blank.
        const inflight = abortControllerRef.current && abortControllerRef.current.__intent;
        const isAborted = abortControllerRef.current?.signal?.aborted;
        if (inflight && !isAborted && inflight.rawModel === rawModel && inflight.layer === layer && inflight.hour === timeOffset
            && inflight.surf === getSurfModeFlag()) { // §0l: opposite flavor = DIFFERENT target (toggle must not dedup)
          const panMoved = bufferPanMovedReplay({ inflight, currentViewportHash: viewportHash, source, model: activeModelRef.current, layer, hour: timeOffset, pendingMarineIntentRef, logPipelineEventHelper });
          console.log(`[Abort-Gate] Same-target fetch already in-flight (${inflight.rawModel}/${inflight.layer}/h${inflight.hour}); ${panMoved ? 'viewport moved — replay buffered for fetch completion' : 'skipping duplicate'} (no abort).`);
          // Forensic: the AGE of the in-flight fetch is the wedge diagnostic — a healthy dedup
          // skip is seconds old; the 07-12 deploy-window wedge held one fetch alive for MINUTES
          // (server holding the connection), starving every pan of new data.
          recordMarineEvent('inflight_skip', {
            target: `${inflight.rawModel}/${inflight.layer}/h${inflight.hour}`,
            ageMs: locks.fetchStartedAt ? (Date.now() - locks.fetchStartedAt) : null, panMoved,
          });
          return;
        }
        // THE READER'S CALL SITE. Placed on the marine fetch path — frequent enough that a real
        // session exercises it, and the tick itself gates on a 60 s clock BEFORE walking any ring,
        // so the cost here is one comparison. It logs only when a check FAILS and only when the
        // failing set changes, because the defect it detects is a ring drowned by a loud writer and
        // a noisy reader would recreate exactly that.
        try { ringReaderTick(typeof window !== 'undefined' ? window : null); } catch (e) { /* never fatal */ }
        const activeSource = locks.activeSource || 'unknown';
        const isHighPriority = (src) => src === 'manual' || src.includes('timeline') || src.includes('scrub');
        if (isHighPriority(activeSource) && !isHighPriority(source)) {
          console.log(`[Abort-Gate] Preserving high-priority fetch (${activeSource}) against low-priority update request (${source})`);
          return;
        }
        console.log(`[Release] Releasing in-flight fetch (${activeSource}) for new request source=${source} (scrub=abort, switch=detach+self-cache)`);
        // Detach on model/layer switch (self-caches; requestId/live-target guards block its
        // stale commit; registry caps + unmounts) — but ABORT under active scrubbing so the
        // backend's disconnect-detection can cancel the remaining per-hour upstream work.
        releaseAbandonedFetch(inFlight, abortControllerRef.current, 'updateMarineGrid', activeSource, source);
        locks.isFetching = false;
      }
      if (!isRetry && !isTimelineScrub && consecutiveFailuresRef.current >= 3) return;
      const now = Date.now();
      if (!isRetry && !isTimelineScrub && now - locks.lastTime < 1200) return;
      if (!isTimelineScrub && (mapInstance.isMoving() || mapInstance.isZooming()) && hasValidData) {
        clearDebounce = false;
        return;
      }

      // Phase 2b — detached-dedup: if THIS exact target (incl. viewport) is already running
      // as a DETACHED request, don't start a duplicate; mark it wanted so its completion wakes
      // a cache-backed re-entry. Stuck-proof: cap never aborts a wanted entry (so it always
      // completes + wakes) + a 2s fallback re-drives if a wake is ever missed.
      {
        const di = { model, rawModel, layer, hour: timeOffset, boundsKey: viewportHash };
        const detachedSame = inFlight.find(di);
        if (detachedSame && detachedSame.state === 'detached') {
          inFlight.markWanted(di);
          logPipelineEventHelper('detached_dedup_wait', { model: rawModel, layer, hour: timeOffset });
          if (detachedWaitTimerRef.current) clearTimeout(detachedWaitTimerRef.current);
          detachedWaitTimerRef.current = setTimeout(() => {
            detachedWaitTimerRef.current = null;
            if (activeMarineLayersRef.current && updateMarineGridRef.current) updateMarineGridRef.current('detached_wake_fallback');
          }, 2000);
          clearDebounce = false;
          return;
        }
      }
      if (detachedWaitTimerRef.current) { clearTimeout(detachedWaitTimerRef.current); detachedWaitTimerRef.current = null; }

      phase = 'pre_fetch';
      // §5b: 'flavor_toggle' (the surf-rating toggle) is deliberately NON-activation — see
      // isActivationSource. An activation here means a WORLD-bbox fetch, which can never serve
      // the rated viewport tile the toggle needs.
      const isActivation = isActivationSource(source);
      const bounds = handleRegionalGridClearing({
        mapInstance, isActivation, marineData, zoom, model, layer, setMarineData, lastCommittedSigRef
      });

      // NOTE: do NOT bump requestId before the cooldown early-return. The finally clears
      // locks.isFetching only when requestId === marineRequestIdRef.current; if we bumped it here
      // and then returned on cooldown without dispatching, an in-flight prior fetch's finally would
      // no longer match and locks.isFetching would be stranded true forever (stuck in-flight /
      // abort-storm deadlock). Bump it only once we're committed to dispatching, below.
      if (getRemainingCooldown('marine') > 0 || isInCooldown('marine')) {
        handleCooldownFallback({
          mapInstance, model, layer, timeOffset, timeOffsetRef, setMarineData, lastCommittedSigRef,
          marineRevision, getViewportHash, logPipelineEventHelper, cooldownRetryRef, consecutiveFailuresRef,
          clearTimeoutFunc: clearTimeout, getModelSafeMarine, _marineDataSignature, getSharedValidTime
        });
        return;
      }

      // FLAVOR-TOGGLE INSTANT CACHE COMMIT (2026-07-17, user @z8.63: "particles become faint and
      // change direction on rating toggle, then correct themselves"): the toggle re-drive hits the
      // network, and on a COLD backend cache the resolver's instant honest answer is the 2°
      // global_mid tier — coarse blockmean directions + low dir_confidence (the confidence damp =
      // the faint phase) — until the fine dynamic product lands seconds later (the "come back to
      // life"). The FINE frame for the target flavor usually already sits in the FE series cache
      // (flavor-stamped, 2026-07-15). Commit it INSTANTLY so the animation never re-sources from
      // the mid interim; the network fetch below proceeds unchanged for freshness, and its late
      // mid-tier result is then a SAME-flavor resolution downgrade that the no-downgrade guard
      // rejects on its own. Fail-open: any miss/mismatch just falls through to the normal path.
      // Kill: __RAW_DISABLE_FLAVOR_CACHE_FASTPATH__. Ring: flavor_cache_fastpath.
      try {
        const _wantSurf = getSurfModeFlag();
        // marineDataRef, not the closure's marineData: updateMarineGrid's useCallback deps don't
        // include marineData, so the closure capture is mount-time-stale (typically null).
        const _mdNow = marineDataRef.current;
        const _residentFlavor = !!(_mdNow?.grid?.ratingMode);
        // Resolution-upgrade leg (the series-arrival re-drive): same flavor but the resident is
        // meaningfully coarser than what the series cache now holds (the stuck-mid interim).
        // 1.25 mirrors the resolver's Root-A finer-regional threshold.
        const _cellDegOf = (g) => {
          const b = g && g.bounds;
          if (!b || !g.cols || g.cols < 2) return null;
          const w = (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
          return w / g.cols;
        };
        if ((typeof window === 'undefined' || window.__RAW_DISABLE_FLAVOR_CACHE_FASTPATH__ !== true)
            && !(typeof window !== 'undefined' && window.isScrubbingTimeline)
            && _mdNow?.grid?.vectors?.length > 0
            && bounds) {
          const _frame = getMarineSeriesFrame(model, layer, bounds, timeOffset);
          const _fg = _frame && _frame.grid;
          const _fb = _fg && _fg.bounds;
          const _fw = _fb ? ((_fb.east < _fb.west) ? (_fb.east + 360) - _fb.west : _fb.east - _fb.west) : 999;
          const _resCell = _cellDegOf(_mdNow.grid);
          const _frmCell = _cellDegOf(_fg);
          const _flavorLeg = _residentFlavor !== _wantSurf;
          const _upgradeLeg = !_flavorLeg && _resCell !== null && _frmCell !== null
            && _resCell > _frmCell * 1.25;
          if (_fg && Array.isArray(_fg.vectors) && _fg.vectors.length > 0
              && _fg.__renderable !== false && _fw < 340
              && !!_fg.ratingMode === _wantSurf
              && (_flavorLeg || _upgradeLeg)) {
            recordMarineEvent('flavor_cache_fastpath', {
              dims: `${_fg.cols}x${_fg.rows}`, toSurf: _wantSurf, hour: timeOffset,
            });
            try {
              commitMarineData({
                data: _frame, bounds, model, layer, timeOffset, timeOffsetRef, setMarineData, lastCommittedSigRef,
                marineRevision, getViewportHash, logPipelineEventHelper, consecutiveFailuresRef,
                isCommittingDataRef, isInternalMapUpdateRef, internalUpdateTimerRef, locks,
                source: 'flavor_cache_fastpath',
                scheduleSWRRevalidation, updateMarineGrid, getBackendCopernicusFlag, getBackendIconMarineFlag,
                getBackendWeatherFlag, _marineDataSignature, getSharedValidTime, updateDeprecationDiag,
                setTimeoutFunc: setTimeout, clearTimeoutFunc: clearTimeout
              });
            } catch (ce) {
              recordMarineEvent('flavor_fastpath_commit_err', { msg: String(ce && ce.message).slice(0, 80) });
            }
          } else if (_flavorLeg || source === 'series_upgrade') {
            // Miss diagnostics (pinning instrument — fires only on toggle/upgrade re-drives).
            recordMarineEvent('flavor_fastpath_miss', {
              hasFrame: !!_fg, nVec: _fg && _fg.vectors ? _fg.vectors.length : 0,
              fw: _fw === 999 ? null : +_fw.toFixed(1),
              frameRated: _fg ? !!_fg.ratingMode : null, want: _wantSurf, src: source,
            });
          }
        }
      } catch (e) { /* fast path is best-effort — the normal fetch below is the truth path */ }

      // 'series_upgrade' is a CACHE-ONLY lane (the series-arrival re-drive): whether the fast path
      // committed or missed, never fall through to a network fetch for it — the series lane already
      // owns freshness, and fetching here would re-serve the interim tier this lane exists to fix.
      if (source === 'series_upgrade') return;

      requestId = ++marineRequestIdRef.current;

      // Release the prior fetch (same-target is already deduped above, so this is a real
      // switch): detach to self-cache on a model/layer switch, abort under active scrubbing.
      releaseAbandonedFetch(inFlight, abortControllerRef.current, 'updateMarineGrid_preStart', null, source);
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;
      myController = abortControllerRef.current;
      // Tag with this fetch's target so a later switch can detach+self-cache it and the
      // registry can abort it for the concurrency cap / on unmount.
      // §0l: `surf` joins the target identity — the Swell↔Surf flavors are DIFFERENT fields for
      // the same model/layer/hour, so a toggle must never dedup against the opposite flavor's
      // in-flight fetch (the rapid off→on re-activation stick: the ON-ask skipped as "same
      // target", the OFF-leg's swell result then committed and the honest resident held).
      abortControllerRef.current.__intent = { model, rawModel, layer, hour: timeOffset, surf: getSurfModeFlag(), bounds, zoom, boundsKey: viewportHash };
      inFlight.registerForeground(myController, abortControllerRef.current.__intent, requestId);

      locks.isFetching = true;
      locks.activeSource = source;
      locks.fetchStartedAt = Date.now(); // lease start — see releaseStaleMarineLock watchdog
      // Auto-redrive: if this fetch is still holding the lock past the lease (stranded), re-drive
      // once so the watchdog releases it and fetches fresh WITHOUT needing a user scrub/toggle —
      // covers the "activate a layer and it never loads" wedge. A newer fetch clears this timer
      // (above), and a clean completion clears it in finally, so only a truly-stuck fetch re-drives.
      if (locks._staleLockTimer) clearTimeout(locks._staleLockTimer);
      const armStaleLockWatchdog = () => {
        locks._staleLockTimer = setTimeout(() => {
          locks._staleLockTimer = null;
          if (!locks.isFetching) return;
          // A LIVE slow backend fetch (foreground registry entry, controller un-aborted) is not a
          // wedge — keep watching for another lease period instead of re-driving into the
          // same-target dedup. The HARD lease still bounds a genuine hang: past it the re-drive
          // fires and releaseStaleMarineLock heals regardless.
          const ctrl = abortControllerRef.current;
          const heldMs = Date.now() - (locks.fetchStartedAt || 0);
          const liveEntry = ctrl && !ctrl.signal?.aborted && ctrl.__intent && typeof inFlight.find === 'function'
            ? inFlight.find(ctrl.__intent) : null;
          const isLive = liveEntry && liveEntry.state === 'foreground' && liveEntry.controller === ctrl;
          if (isLive && heldMs <= MARINE_FETCH_HARD_LEASE_MS) { armStaleLockWatchdog(); return; }
          if (updateMarineGridRef.current) updateMarineGridRef.current('stale_lock_watchdog');
        }, MARINE_FETCH_LEASE_MS + 500);
      };
      armStaleLockWatchdog();
      if (typeof window !== 'undefined') {
        window.__MARINE_FETCH_DEBOUNCING__ = false;
        window.__MARINE_FETCH_PENDING__ = { model: rawModel, layer, hour: timeOffset, timestamp: new Date().toISOString() };
        // Remember OUR exact stamp (object identity) so the finally can clear it even when this
        // request has been superseded (requestId mismatch). Without this, a detached/stale
        // request's stamp survives forever when the NEW target commits via cache paths that
        // never re-enter this fetch body — the night-1 "fetchPending wedged true" stranding
        // (network_request_started stayed 0 the whole session; everything cache-served).
        if (myController) myController.__fetchPendingStamp = window.__MARINE_FETCH_PENDING__;
      }
      // Take ownership of the open transition ONLY if this fetch's target identity matches it.
      // A viewport/moveend refetch (different intent) leaves capturedTransitionGen null and
      // therefore cannot end the transition.
      {
        const t = getTarget();
        if (t && t.status === 'pending' && t.model === rawModel && t.layer === layer) {
          capturedTransitionGen = t.gen;
        }
      }
      const fetchIntent = { model: rawModel, layer, hour: timeOffset };

      let data = null;

      const diagObj = {
        model, layer, targetHour: timeOffset, nativeLimit: model === 'ICON' ? DISPLAY_ICON_MAX_HOURS : nativeLimit,
        requiredSources: [], cacheHits: [], fetchStarted: [], skippedReason: null, resultStatus: 'pending',
        rateLimitStatus: 'ok', cooldownStatus: isInCooldown('marine') ? 'rate_limited' : 'ok', timestamp: new Date().toISOString()
      };
      window.__EXTENDED_ESTIMATE_FETCH_DIAG__ = diagObj;

      if (model === 'ICON' && timeOffset > DISPLAY_ICON_MAX_HOURS) {
        const hasBackend = getBackendIconMarineFlag();
        const fallbackReason = hasBackend ? 'icon_no_backend_extended_estimate' : 'backend_required_no_frontend_estimator';
        data = buildIconFallbackGrid(bounds, fallbackReason);
      } else if (model === 'EURO' && timeOffset > nativeLimit && !getBackendCopernicusFlag()) {
        data = buildEuroFallbackGrid(bounds, 'backend_required_no_frontend_estimator');
      } else if (data === null) {
        if (model === 'EURO' && layer && COMPONENT_LAYERS.includes(layer)) {
          if (getBackendCopernicusFlag()) {
            phase = 'standard_fetch_copernicus';
            try {
              data = await fetchMarineData(bounds, zoom, signal, timeOffset, false, model, layer, false,
                source === 'clamp_resharpen' ? { tightSnap: true } : null);
              if (!data || !data.grid || (!data.grid.renderable && (!data.grid.vectors || data.grid.vectors.length === 0))) {
                console.warn('[Marine] Deployed Copernicus grid returned empty/unrenderable grid.');
                const failureReason = data?.grid?.__failureReason || 'unavailable';
                data = buildCopernicusEmptyGrid(bounds, timeOffset, layer, failureReason);
              }
            } catch (err) {
              if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort')) {
                throw err;
              } else {
                console.error('[Marine] Deployed Copernicus grid fetch failed:', err.message);
              }
              data = buildCopernicusEmptyGrid(bounds, timeOffset, layer, err.message || 'Copernicus grid fetch failed');
            }
          } else {
            data = {
              type: 'FeatureCollection',
              features: [],
              grid: {
                vectors: [], bounds, cols: 0, rows: 0, status: "no_coverage", source: "backend_required",
                provider: "none", is_estimated: false, fallbackReason: "backend_required_no_frontend_estimator",
                renderable: false, emptyGridWarning: "Backend Copernicus support is absent, no frontend estimator"
              }
            };
          }
        } else {
          phase = 'standard_fetch';
          // TIGHT bbox on the clamp re-drive (see getSnapConfig): the legacy snapped request
          // overflows the fine tile and re-serves the same mid grid — the "no progress after 3
          // re-drives" loop. Viewport-scoped, the re-drive actually upgrades.
          data = await fetchMarineData(bounds, zoom, signal, timeOffset, false, model, layer, false,
            source === 'clamp_resharpen' ? { tightSnap: true } : null);
        }
      }

      // A renderable response means fetchMarineData has self-cached this target (warm for a
      // switch-back). Record success for registry telemetry BEFORE the stale-reject return so
      // a detached request that finished is counted as completed-into-cache, not failed.
      if (data && data.grid && data.grid.renderable !== false && data.grid.vectors && data.grid.vectors.length > 0) {
        fetchStatus = 'success';
      }

      if (requestId !== marineRequestIdRef.current) return;
      if (fetchIntent.model !== activeModelRef.current || fetchIntent.layer !== (activeMarineLayerRef.current || 'waves') || fetchIntent.hour !== timeOffsetRef.current) {
        logPipelineEventHelper('stale_async_response_rejected', fetchIntent); return;
      }

      phase = 'commit';
      if (typeof window !== 'undefined') {
        let nzCount = 0;
        if (data?.grid?.vectors) {
          for (const v of data.grid.vectors) {
            if (v) {
              const comp = v[layer] || v.waves || v.swell_1 || v.swell_2 || v.wind_waves || v;
              if (comp && comp.speed > 0) nzCount++;
            }
          }
        }
        window.__MARINE_FETCH_DIAG__ = { activeModel: activeModelRef.current, activeLayer: layer, timeOffsetHours: timeOffsetRef.current, provider: data?.grid?.__provider || 'none', gridProvider: data?.grid?.__gridProvider || 'none', httpStatus: data ? 200 : 502, elapsedMs: Date.now() - now, vectorCount: data?.grid?.vectors?.length || 0, nonzeroCount: nzCount, timestamp: new Date().toISOString() };
      }

      const isUnsupportedLayer = data?.grid?.__unsupportedLayer || data?.__unsupportedLayer || data?.status === 'unsupported';
      if (isUnsupportedLayer) {
        console.log(`[Marine] Unsupported layer detected: ${model}/${layer}. Preserving existing heatmap.`);
        logPipelineEventHelper('unsupported_layer_preserved', { model, layer, hour: timeOffset, reason: data?.grid?.emptyGridWarning || 'unsupported_model_layer' });
        consecutiveFailuresRef.current = 0; locks.lastHash = viewportHash; locks.lastTime = Date.now();
        setMarineData(prev => {
          if (prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0) {
            return {
              ...prev,
              __unsupportedLayerOverride: { model, layer, reason: data?.grid?.emptyGridWarning || 'unsupported_model_layer' }
            };
          }
          lastCommittedSigRef.current = null;
          return data;
        });
        return;
      }

      if (data && (data.features?.length > 0 || data.grid?.vectors?.length > 0 || data.grid?.__skippedReason === 'zoom_too_low' || data.grid?.skippedReason === 'zoom_too_low' || data.grid?.emptyGridWarning)) {
        commitMarineData({
          data, bounds, model, layer, timeOffset, timeOffsetRef, setMarineData, lastCommittedSigRef,
          marineRevision, getViewportHash, logPipelineEventHelper, consecutiveFailuresRef,
          isCommittingDataRef, isInternalMapUpdateRef, internalUpdateTimerRef, locks, source,
          scheduleSWRRevalidation, updateMarineGrid, getBackendCopernicusFlag, getBackendIconMarineFlag,
          getBackendWeatherFlag, _marineDataSignature, getSharedValidTime, updateDeprecationDiag,
          setTimeoutFunc: setTimeout, clearTimeoutFunc: clearTimeout
        });
      } else {
        consecutiveFailuresRef.current += 1;
        const isCurrentHour = fetchIntent.hour === timeOffsetRef.current;
        if (!window.isScrubbingTimeline && isCurrentHour) {
          setMarineData(prev => {
            const hasValidData = prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0;
            const prevModel = prev?.grid?.__sourceModel || prev?.__sourceModel;
            const prevLayer = prev?.grid?.__componentLayer || prev?.__componentLayer || 'waves';
            const isSameModelAndLayer = prevModel === model && prevLayer === layer;
            if (hasValidData && isSameModelAndLayer) {
              return { ...prev, stale: true, grid: { ...prev.grid, stale: true } };
            }
            lastCommittedSigRef.current = null;
            return null;
          });
        } else {
          console.log(`[Marine] Fetch returned empty/failed (isCurrentHour=${isCurrentHour}), preserving stale data.`);
        }
        if (isInCooldown('marine')) logPipelineEventHelper('rate_limit_429', { model: fetchIntent.model, layer: fetchIntent.layer, hour: fetchIntent.hour });
        if (consecutiveFailuresRef.current >= 3 || ['cooldown_retry', 'delayed_retry'].includes(source)) return;
        scheduleCooldownRetry((src) => {
          if (updateMarineGridRef.current && activeMarineLayersRef.current) {
            updateMarineGridRef.current(src);
          }
        });
      }
    } catch (err) {
      const isAbort = err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('abort');
      fetchStatus = isAbort ? 'abort' : 'failure';
      if (isAbort) {
        console.log(`[Marine] Fetch aborted (expected during model/layer switch) phase=${phase}: ${err.message}`);
      } else {
        console.error(`[Orchestrator Fatal Exception] phase=${phase} error:`, err.message);
      }
      const isCurrentHour = timeOffset === timeOffsetRef.current;
      if (!isAbort && !window.isScrubbingTimeline && isCurrentHour) {
        setMarineData(prev => {
          const hasValidData = prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0;
          const prevModel = prev?.grid?.__sourceModel || prev?.__sourceModel;
          const prevLayer = prev?.grid?.__componentLayer || prev?.__componentLayer || 'waves';
          const isSameModelAndLayer = prevModel === model && prevLayer === layer;
          if (hasValidData && isSameModelAndLayer) {
            return { ...prev, stale: true, grid: { ...prev.grid, stale: true } };
          }
          lastCommittedSigRef.current = null;
          return null;
        });
      } else if (isAbort && isCurrentHour && !window.isScrubbingTimeline) {
        if (requestId !== marineRequestIdRef.current) {
          console.log(`[ABORT RECOVERY] Discarding abort recovery because requestId (${requestId}) is stale (current=${marineRequestIdRef.current}).`);
          return;
        }
        console.log(`[ABORT RECOVERY] AbortError in phase=${phase}, model=${model}, layer=${layer}. Retry count: ${abortRecoveryRetryCountRef.current}/3`);
        const prev = marineDataRef.current;
        const hasValidData = prev && prev.grid && prev.grid.vectors && prev.grid.vectors.length > 0;
        const targetChanged = activeModelRef.current !== model || (activeMarineLayerRef.current || 'waves') !== layer;
        if (hasValidData) {
          console.log(`[ABORT RECOVERY] Previous valid data exists, preserving.`);
        } else if (targetChanged) {
          console.log(`[ABORT RECOVERY] Skipping recovery-grid blank — target moved on (was ${model}/${layer}, now ${activeModelRef.current}/${activeMarineLayerRef.current || 'waves'}); newer fetch owns the display.`);
        } else {
          console.warn(`[ABORT RECOVERY] No previous data exists. Committing recovery grid to break LOADING deadlock.`);
          recordChurn('recovery_grid_commit', { model, layer, hour: timeOffset, phase, retry: abortRecoveryRetryCountRef.current });
          lastCommittedSigRef.current = null;
          marineRevision.current += 1;
          const recoveryGrid = getAbortRecoveryGrid(model, layer, phase, marineRevision.current);
          // ARBITER PHASE A: the one commit path that bypasses commitMarineData/stampSeriesCommit
          // — stamp its lane so the engine ledger has full provenance coverage.
          try {
            recoveryGrid.__commitLane = 'abort_recovery';
            if (recoveryGrid.grid) recoveryGrid.grid.__commitLane = 'abort_recovery';
          } catch (e) { /* stamp is metadata-only */ }
          setMarineData(recoveryGrid);

          if (abortRecoveryRetryCountRef.current < 3) {
            abortRecoveryRetryCountRef.current += 1;
            const retryModel = model;
            const retryLayer = layer;
            setTimeout(() => {
              if (activeModelRef.current !== retryModel || (activeMarineLayerRef.current || 'waves') !== retryLayer) {
                console.log(`[ABORT RECOVERY] Discarding stale retry (target=${retryModel}/${retryLayer}, current=${activeModelRef.current}/${activeMarineLayerRef.current}).`);
                return;
              }
              if (enqueueMarineUpdateRef.current && activeMarineLayersRef.current) {
                console.log(`[ABORT RECOVERY] Scheduling retry fetch after abort recovery (attempt ${abortRecoveryRetryCountRef.current}/3).`);
                enqueueMarineUpdateRef.current('abort_recovery_retry');
              }
            }, 1500);
          } else {
            console.warn(`[ABORT RECOVERY] Max retries (3) reached. Stopping abort recovery loop.`);
          }
        }
      } else {
        console.log(`[Marine] Fetch exception (isAbort=${isAbort}, isCurrentHour=${isCurrentHour}), preserving stale data.`);
      }
    } finally {
      // Registry bookkeeping for THIS request — runs for foreground AND detached/stale
      // requests. Identity-safe (ignored if a newer controller re-took this key), and it
      // NEVER commits or touches the transition/locks, so a detached completion is inert.
      if (myController && myController.__intent) {
        const { shouldWake } = inFlight.complete(myController.__intent, myController, fetchStatus);
        // A wanted detached request finished — re-drive the CURRENT target once (cache-hit if
        // it succeeded, fresh fetch if it failed), unblocking the dedup early-return above.
        if (shouldWake && activeMarineLayersRef.current && enqueueMarineUpdateRef.current) {
          inFlight.noteWakeEnqueued(inFlight.key(myController.__intent));
          setTimeout(() => { enqueueMarineUpdateRef.current && enqueueMarineUpdateRef.current('detached_wake'); }, 0);
        }
      }
      // Clear the pending stamp if it is still OURS (object identity — a newer request that
      // stamped after us is untouched). Runs for superseded requests too, so a stranded
      // "pending" from a detached/stale fetch can no longer wedge __MARINE_FETCH_PENDING__ true.
      if (typeof window !== 'undefined' && myController && myController.__fetchPendingStamp
          && window.__MARINE_FETCH_PENDING__ === myController.__fetchPendingStamp) {
        window.__MARINE_FETCH_PENDING__ = null;
      }
      if (requestId === marineRequestIdRef.current) {
        locks.isFetching = false;
        locks.activeSource = null;
        locks.fetchStartedAt = 0;
        if (locks._staleLockTimer) { clearTimeout(locks._staleLockTimer); locks._staleLockTimer = null; }
        if (typeof window !== 'undefined') {
          window.__MARINE_FETCH_PENDING__ = null;
          if (!timeoutIdRef.current && capturedTransitionGen !== null) {
            // End ONLY the transition this fetch owns. No-op if a newer transition began
            // (endTransition checks generation), so a stale request can't end it. The
            // coordinator mirrors __MARINE_TRANSITIONING__ for un-migrated readers.
            endTransition(capturedTransitionGen);
          }
          if (clearDebounce) {
            window.__MARINE_FETCH_DEBOUNCING__ = false;
          }
        }
        const pending = pendingMarineIntentRef.current;
        if (pending) {
          pendingMarineIntentRef.current = null;
          if (pending.model === activeModelRef.current && pending.layer === (activeMarineLayerRef.current || 'waves')) {
            const pendingSource = pending.source.includes('_pending') ? pending.source : pending.source + '_pending';
            setTimeout(() => enqueueMarineUpdateRef.current?.(pendingSource), 50);
          } else { logPipelineEventHelper('pending_intent_expired', pending); }
        }
        // FLAVOR BACKSTOP (2026-07-16, zoomlab forensic ring): the surf toggle's manual re-fetch
        // can race a just-started same-viewport fetch — the §0l inflight dedup compares
        // intent.surf to the flag BEFORE the toggle's write lands, so the toggle call is
        // "same-target"-skipped, the pre-toggle fetch commits the OLD flavor, and with no later
        // camera move NOTHING re-invokes the fetcher: the flavor-mismatch dedup-bypass above
        // never gets a call to bypass (live ring: inflight_skip ageMs=129 → commit rating:false
        // → 40 s of [rating-band] OFF until a pan). When the request that just finished leaves
        // the resident flavor ≠ the current surf flag, re-drive ONCE per
        // flag|viewport|layer|hour (key stamped before the enqueue, so a backend that cannot
        // serve the flavor — e.g. the falsified global surf transform, coarse_extent skip —
        // gets exactly one extra ask, never a loop). Kill: __RAW_DISABLE_FLAVOR_BACKSTOP__.
        try {
          if ((typeof window === 'undefined' || window.__RAW_DISABLE_FLAVOR_BACKSTOP__ !== true)
              && !(typeof window !== 'undefined' && window.isScrubbingTimeline)) {
            const _fbGrid = marineDataRef.current && marineDataRef.current.grid;
            const _fbWantSurf = getSurfModeFlag();
            if (_fbGrid && _fbGrid.vectors && _fbGrid.vectors.length > 0
                && (!!_fbGrid.ratingMode) !== _fbWantSurf) {
              const _fbKey = `${_fbWantSurf}|${getViewportHash()}|${activeMarineLayerRef.current || 'waves'}|${timeOffsetRef.current}`;
              if (locks.lastFlavorRedriveKey !== _fbKey
                  && activeMarineLayersRef.current && enqueueMarineUpdateRef.current) {
                locks.lastFlavorRedriveKey = _fbKey;
                recordMarineEvent('flavor_backstop', { key: _fbKey });
                setTimeout(() => enqueueMarineUpdateRef.current?.('flavor_backstop'), 60);
              }
            }
          }
        } catch (e) { /* backstop never fatal */ }
      }
      // hunt defect 3.3: heal a debounce flag stranded true by a pre-dispatch early return (see
      // shouldHealStrandedDebounce). Kill: __RAW_DISABLE_MARINE_DEBOUNCE_STRAND_HEAL__.
      if (typeof window !== 'undefined'
          && shouldHealStrandedDebounce(requestId, clearDebounce, window.__MARINE_FETCH_DEBOUNCING__)) {
        window.__MARINE_FETCH_DEBOUNCING__ = false;
        window.__MARINE_DEBOUNCE_FINALLY_HEAL__ = (window.__MARINE_DEBOUNCE_FINALLY_HEAL__ || 0) + 1;
      }
    }
  }, [
    mapInstance,
    activeModelRef,
    activeMarineLayerRef,
    timeOffsetRef,
    getViewportHash,
    logPipelineEventHelper
  ]);

  const enqueueMarineUpdate = useCallback((source) => {
    if (source === 'cancel_scrub') {
      if (scrubDebounceRef.current) {
        clearTimeout(scrubDebounceRef.current);
        scrubDebounceRef.current = null;
      }
      return;
    }

    const isTimelineScrub = source === 'timeline_scrub' || source.includes('timeline');
    if (!isTimelineScrub && window.isScrubbingTimeline) return;

    if (source === 'timeline_scrub_deferred') {
      if (scrubDebounceRef.current) clearTimeout(scrubDebounceRef.current);
      scrubDebounceRef.current = setTimeout(() => {
        scrubDebounceRef.current = null;
        updateMarineGrid('timeline_scrub');
      }, 150);
      return;
    }

    const now = Date.now();
    const locks = marineFetchLocksRef.current;
    // Heal a stranded lock before trusting it (same watchdog as updateMarineGrid).
    releaseStaleMarineLock(locks, abortControllerRef, inFlight);
    if (locks.isFetching) {
      // The series-arrival cache lane is OPPORTUNISTIC: never buffer against, release, or abort a
      // real fetch for it — the next landing page re-fires the event, so a skip costs nothing.
      if (source === 'series_upgrade') return;
      const inflight = abortControllerRef.current && abortControllerRef.current.__intent;
      const isAborted = abortControllerRef.current?.signal?.aborted;
      if (inflight && !isAborted && inflight.rawModel === activeModelRef.current &&
          inflight.layer === (activeMarineLayerRef.current || 'waves') &&
          inflight.hour === timeOffsetRef.current &&
          inflight.surf === getSurfModeFlag()) { // §0l: opposite flavor = DIFFERENT target
        const panMoved = bufferPanMovedReplay({ inflight, getViewportHash, source, model: activeModelRef.current, layer: activeMarineLayerRef.current || 'waves', hour: timeOffsetRef.current, pendingMarineIntentRef, logPipelineEventHelper });
        console.log(`[Abort-Gate] Same-target fetch already in-flight (${inflight.rawModel}/${inflight.layer}/h${inflight.hour}); ${panMoved ? 'viewport moved — replay buffered for fetch completion' : 'skipping duplicate'} (no abort).`);
        recordMarineEvent('inflight_skip', {
          target: `${inflight.rawModel}/${inflight.layer}/h${inflight.hour}`,
          ageMs: locks.fetchStartedAt ? (Date.now() - locks.fetchStartedAt) : null, panMoved,
        });
        return;
      }
      pendingMarineIntentRef.current = { source, model: activeModelRef.current, layer: activeMarineLayerRef.current || 'waves', hour: timeOffsetRef.current, timestamp: Date.now() };
      logPipelineEventHelper('intent_buffered', pendingMarineIntentRef.current);
      const activeSource = locks.activeSource || 'unknown';
      const isHighPriority = (src) => src === 'manual' || src.startsWith('manual') || src.includes('timeline') || src.includes('scrub');
      if (isHighPriority(activeSource) && !isHighPriority(source)) {
        console.log(`[Abort-Gate] Preserving high-priority fetch (${activeSource}) against low-priority request (${source})`);
        return;
      }
      console.log(`[Release] Releasing active fetch (${activeSource}) in enqueueMarineUpdate for new source=${source} (scrub=abort, switch=detach+self-cache)`);
      releaseAbandonedFetch(inFlight, abortControllerRef.current, 'enqueueMarineUpdate', activeSource, source);
      locks.isFetching = false;
      locks.activeSource = null;
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = setTimeout(() => {
        timeoutIdRef.current = null;
        if (!activeMarineLayersRef.current) return;
        updateMarineGrid(source);
      }, 150);
      return;
    }

    if (source === 'manual') locks.manualFetchActiveUntil = now + 1500;
    if (source.includes('moveend') && !source.includes('_pending') && now < (locks.manualFetchActiveUntil || 0)) return;

    let isCached = false;
    try {
      const b = mapInstance.getBounds(), bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
      isCached = isContainedInMarineCache(bounds, activeModelRef.current, timeOffsetRef.current, activeMarineLayerRef.current || 'waves');
    } catch (e) {
      isCached = false;
    }

    const dedupeWindow = isCached ? 50 : 800;
    if (lastInvocationRef.current && lastInvocationRef.current.source === source && now - lastInvocationRef.current.time < dedupeWindow) return;

    try {
      const viewportHash = getViewportHash();
      const hasValidData = marineDataRef.current && marineDataRef.current.grid && marineDataRef.current.grid.vectors && marineDataRef.current.grid.vectors.length > 0;
      const isCorrectLayer = marineDataRef.current?.grid?.__componentLayer === (activeMarineLayerRef.current || 'waves');
      // FLAVOR-MISMATCH BYPASS (2026-07-15) — the enqueue-side twin of the updateMarineGrid guard.
      // See the updateMarineGrid comment for the full rationale (verified on the live map).
      const _flavorMismatch = !!(marineDataRef.current?.grid?.ratingMode) !== getSurfModeFlag();
      const bypassDedupe = !hasValidData || !isCorrectLayer || _flavorMismatch || !!(marineDataRef.current?.stale || marineDataRef.current?.grid?.stale);
      if (!bypassDedupe && locks.lastHash === viewportHash && (now - locks.lastTime < 5 * 60 * 1000)) return;
    } catch (e) {
      // ignore
    }

    lastInvocationRef.current = { source, time: now };
    if (scheduledRef.current) return;
    scheduledRef.current = true;

    if (typeof window !== 'undefined') {
      window.__MARINE_FETCH_DEBOUNCING__ = true;
    }

    // Run the debounced dispatch on the next frame — but via rAF OR a setTimeout fallback, run-once.
    // rAF alone PAUSES when the tab is hidden, stranding scheduledRef true (which makes the
    // `if (scheduledRef.current) return` guard above block every subsequent enqueue) and
    // __MARINE_FETCH_DEBOUNCING__ true. The setTimeout fallback fires even when hidden; whichever
    // fires first runs the body, the other no-ops (visible tab: rAF wins, timing unchanged).
    let _dispatchRan = false;
    const _runDispatch = () => {
      if (_dispatchRan) return;
      _dispatchRan = true;
      scheduledRef.current = false;
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      // 'flavor_toggle' rides the fast lane: the user just clicked the Rating toggle — a 300 ms
      // stall before dispatch reads as an unresponsive control.
      const stableDelay = (isCached || source === 'manual' || source === 'flavor_toggle' || source === 'timeline_scrub') ? 20 : 300;
      timeoutIdRef.current = setTimeout(() => {
        timeoutIdRef.current = null;
        // Map can be torn down during the stableDelay (unmount / style reload / route change) —
        // this deferred callback then derefs a null mapInstance (`Cannot read properties of null
        // (reading 'isMoving')`, live 2026-07-04). Nothing to render on a dead map: bail.
        if (!mapInstance) return;
        if (isTimelineScrub || (!mapInstance.isMoving() && !mapInstance.isZooming())) {
          updateMarineGrid(source);
        } else {
          let fired = false;
          const runUpdate = () => {
            if (fired) return;
            fired = true;
            mapInstance.off('idle', runUpdate);
            if (activeMarineLayersRef.current) {
              updateMarineGrid(source);
            }
          };
          mapInstance.once('idle', runUpdate);
          setTimeout(runUpdate, 1000);
        }
      }, stableDelay);
    };
    requestAnimationFrame(_runDispatch);
    setTimeout(_runDispatch, 1500);
  }, [
    mapInstance,
    activeModelRef,
    activeMarineLayerRef,
    timeOffsetRef,
    getViewportHash,
    logPipelineEventHelper,
    updateMarineGrid,
    marineDataRef,
    lastInvocationRef
  ]);

  return { updateMarineGrid, enqueueMarineUpdate };
}
