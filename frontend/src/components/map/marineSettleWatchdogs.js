// Pure watchdog predicates of the blank-heatmap backstop in useMarineScrubSettle.js, moved here VERBATIM (2026-10-21) to keep
// that hook under the 800-LOC cap; the only edit is `export` on recordMarineFreeze, which the backstop still calls.
// useMarineScrubSettle.js re-exports every name that was exported there, so existing imports keep working.

// How long a marine fetch-PENDING flag may persist with no live fetch backing it before we treat it as
// STRANDED. Symmetric to MARINE_FETCH_LEASE_MS (the isFetching lease in useMarineDataFetcherCore) but for
// the wedge the isFetching-gated watchdog CANNOT see: __MARINE_FETCH_PENDING__ stuck non-null while
// locks.isFetching is false and the governor is idle. Slightly longer than the isFetching lease because
// this path only clears a window flag (no controller to abort), so we want zero chance of clobbering a
// just-queued fetch that hasn't registered in the governor yet (the governor registers a real fetch in ms).
export const MARINE_PENDING_LEASE_MS = 6000;
// Snapshot the freeze state earlier than we act, so a single organic repro is fully diagnosable even if the
// auto-recovery's trigger turns out to be slightly off.
export const STRANDED_PENDING_RECORD_MS = 3000;

/**
 * Decide whether a marine fetch-PENDING is STRANDED. A stranded pending wedges BOTH frontend recovery
 * paths — runScrubSettleCheck bypasses on a matching pending (see "isAlreadyFetchingCurrentHour"), and the
 * blank-heatmap backstop requires `!pending` — while the isFetching-gated releaseStaleMarineLock stays
 * silent (isFetching is false). Net result: the heatmap freezes near a region that HAS data until a manual
 * layer toggle clears pending. This is the symmetric sibling of releaseStaleMarineLock for that case; the
 * govIdle + age + !isFetching guards make a false positive (clobbering a real in-flight fetch) effectively
 * impossible. Pure + unit-testable (no I/O). `record` requests a forensic snapshot before we act.
 */
export function evaluateStrandedPending({ hasPending, pendingAgeMs, govIdle, isFetching,
  leaseMs = MARINE_PENDING_LEASE_MS, recordMs = STRANDED_PENDING_RECORD_MS }) {
  if (!hasPending) return { record: false, stranded: false };
  // Record whatever is stuck (govIdle / isFetching captured in the payload by the caller) once a single
  // pending has out-lived a normal fetch — that alone is abnormal and worth a snapshot.
  const record = pendingAgeMs > recordMs;
  // Only treat as STRANDED (safe to clear + re-drive) when provably dead: idle + not isFetching + past lease.
  const stranded = !!govIdle && !isFetching && pendingAgeMs > leaseMs;
  return { record, stranded };
}

// Marker-wedge predicate (chip task_59bcc036), pure + exported for tests: isFetching=true with
// NO lease start stamp is the strand releaseStaleMarineLock cannot heal (its lease math bails
// on fetchStartedAt=0) — every fetch dedup-blocks with zero network activity. A HEALTHY fetch
// stamps the lease in the same tick it sets the marker, so tracking begins only on the
// abnormal combination, and stranded requires it sustained (default 10s) under an idle governor.
export const MARKER_WEDGE_LEASE_MS = 10 * 1000;
export function evaluateMarkerWedge({ isFetching, hasStartStamp, govIdle, ageMs, leaseMs = MARKER_WEDGE_LEASE_MS }) {
  const tracking = !!isFetching && !hasStartStamp;
  const stranded = tracking && !!govIdle && ageMs > leaseMs;
  return { tracking, stranded };
}

/**
 * Ring-buffer recorder for the "froze, needed a manual toggle" wedge (rating plan §8 #1). Read-only telemetry
 * — captures the lock/governor/pending state at the moment of a suspected freeze so the NEXT organic repro is
 * diagnosable in one shot (instrument-then-fix, not guess). Keeps the last ~20 snapshots + per-reason counts.
 */
export function recordMarineFreeze(reason, payload) {
  if (typeof window === 'undefined') return;
  const store = window.__MARINE_FREEZE_DIAG__ || { counts: {}, recent: [] };
  store.counts[reason] = (store.counts[reason] || 0) + 1;
  store.recent.push({ ts: Date.now(), reason, ...payload });
  if (store.recent.length > 20) store.recent.shift();
  store.last = store.recent[store.recent.length - 1];
  window.__MARINE_FREEZE_DIAG__ = store;
}

// How often a CAPPED no-progress clamp may fire a slow PROBE re-drive. The cap itself is right (it
// breaks the ~6s re-commit/particle-reset churn), but its reset signature is the ENGINE grid bounds —
// for a held coarse_global grid those are always ±180/±85, so no pan ever resets the interval's cap
// and an idle user got PERMANENT silence: with the series coarse-reval budget also exhausted, nothing
// re-fetched until a moveend (the Venice "world grid resident for minutes" wedge, 2026-07-04). A probe
// every ~45s re-runs checkScrubSettle: if the backend's regional build finished meanwhile, the series
// force-fetch pulls it and the sharpen commits (event-driven via marine_series_revalidated); if not,
// it costs one bounded background fetch — no commit, so no particle-reset churn.
export const CLAMP_CAP_REARM_MS = 45000;

/**
 * Decide whether a no-progress-capped clamp should fire a slow probe re-drive. Pure + unit-testable.
 * `noProgress` = consecutive backstop passes with an unchanged engine-grid signature;
 * `sinceLastProbeMs` = elapsed since the cap engaged or the last probe fired;
 * `probesFired` = slow probes already fired for THIS clamp signature.
 * §7h.3 TERMINAL STATE (2026-07-13, the non-pilot forever-probe wedge): each probe forces one
 * bounded series fetch — when the best-available tier genuinely IS the resident (non-pilot mid
 * ceiling, or a dynamic tile the clamp classifier still dislikes), probes can never progress, so
 * they stop after `probeMax` (~3 min at the 45 s cadence). Recovery stays intact WITHOUT probes:
 * a landed regional frame fires `marine_series_revalidated` (event-driven sharpen), and any
 * viewport/grid change resets the signature and re-arms everything.
 */
export function evaluateClampCapProbe({ noProgress, sinceLastProbeMs, probesFired = 0, threshold = 3, rearmMs = CLAMP_CAP_REARM_MS, probeMax = 4 }) {
  if (noProgress < threshold) return { capped: false, probe: false, terminal: false };
  if (probesFired >= probeMax) return { capped: true, probe: false, terminal: true };
  return { capped: true, probe: sinceLastProbeMs >= rearmMs, terminal: false };
}
