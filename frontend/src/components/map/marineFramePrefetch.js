/**
 * marineFramePrefetch.js — which forecast frames to fetch next, and the loop that fetches them (GPU-resident frames, phase 2
 * step 4). Spec: docs/architecture/gpu-resident-forecast-frames.md section 4.1; the policy is the one prefetch_sim.js scored
 * (`spec_intent`): 100% of presses and toggles within one frame on desktop and 4G at the live Cloudflare latency, against 53%
 * for #422's on-demand window, at 1.9 MB for a glance and 7.5 MB for a week-long scrub.
 *
 * THE RULES
 *   1. CDN only: the caller passes a fetch of static frames (#422's loader). Nothing here can reach the backend.
 *   2. Priority, re-planned on every press / switch / settle:
 *      (a) the active set's +-8 frames (+-4 on slow links) nearest the cursor, the scrub direction first on a tie;
 *      (b) the settled hour of the one-click-away sets (the other layers of this model, the other models of this layer);
 *      (c) the rest of the active series, nearest-first, ONLY once the wheel has moved >= 4 frames from where this set
 *          started (dwell alone never expands) and the tier allows full series;
 *      (d) nothing else; (e) never an unbuilt index entry (`path: null`), which /grid serves.
 *   3. At most 6 frame requests in flight (3 on slow links), none before the map's first marine draw (`open()`).
 *   4. An in-flight request is aborted when it drops out of the top 2 x cap of the plan AND is not in the active set (the active
 *      series is fetched anyway). With #422's shared per-path fetch, an abort only detaches this caller. When the plan's first
 *      two frames need fetching and every slot is busy, the lowest-priority in-flight request is preempted (a big jump).
 * Packing (marineFramePack) runs on the main thread in idle slices: it calls the encoder's own functions, so its bytes are the
 * encoder's (a worker would need the bundle). ~2.2 ms per world frame measured, never on the press path.
 */

export const WINDOW = 8;
export const WINDOW_SLOW = 4;
export const EXPAND_AFTER_FRAMES = 4;
export const CAP = 6;
export const CAP_SLOW = 3;
// A failed frame waits before it is asked again: 2 s, doubling to 60 s (found 2026-10-22: an error put the frame straight back
// to `absent` and the same pump re-asked it at once, a tight loop against the CDN for as long as the error lasted).
export const RETRY_MIN_MS = 2000;
export const RETRY_MAX_MS = 60000;

/** Frame indices of a sorted series, nearest `c` first, `dir` (+1 / -1) first on a tie, within `radius` (Infinity = all). */
export function nearestFirst(n, c, dir = 1, radius = Infinity) {
  const out = [];
  if (!(n > 0)) return out;
  const cc = Math.max(0, Math.min(n - 1, c));
  out.push(cc);
  const step = dir >= 0 ? 1 : -1;
  for (let d = 1; d <= Math.min(radius, n); d++) {
    const a = cc + step * d; const b = cc - step * d;
    if (a >= 0 && a < n) out.push(a);
    if (b >= 0 && b < n) out.push(b);
  }
  return out;
}

/**
 * The plan: an ordered list of { key, validTime } to have resident.
 * active = { key, validTimes: [...sorted], built: (validTime) => bool }, cursor = index of the shown frame in active.validTimes,
 * dir = last scrub direction, expanded = the intent gate (see createIntent), warm = [{ key, validTime, built }],
 * slow = Save-Data / 2g / 3g or the constrained tier, full = the tier allows whole series.
 */
export function planWant({ active, cursor = 0, dir = 1, expanded = false, warm = [], slow = false, full = true }) {
  const plan = [];
  if (!active || !Array.isArray(active.validTimes)) return plan;
  const n = active.validTimes.length;
  const built = active.built || (() => true);
  const radius = slow ? WINDOW_SLOW : WINDOW;
  const seen = new Set();
  const push = (key, validTime, ok, isWarm) => {
    const id = `${key}@${validTime}`;
    if (!ok || seen.has(id)) return;
    seen.add(id); plan.push(isWarm ? { key, validTime, warm: true } : { key, validTime });
  };
  const order = nearestFirst(n, cursor, dir);
  const near = order.filter((i) => Math.abs(i - cursor) <= radius);
  for (const i of near) push(active.key, active.validTimes[i], built(active.validTimes[i]));
  for (const w of warm) push(w.key, w.validTime, w.built !== false && !!w.validTime, true);
  if (expanded && full) for (const i of order) push(active.key, active.validTimes[i], built(active.validTimes[i]));
  return plan;
}

/** The intent gate: a set expands to its whole series once the wheel has moved EXPAND_AFTER_FRAMES frames from its origin. */
export function createIntent() {
  let key = null; let origin = 0; let expanded = false; let dir = 1; let last = 0;
  return {
    /** A new active set (load, model or layer toggle, a new region): the gate closes, the origin is the current frame. */
    switchTo(setKey, cursor) { key = setKey; origin = cursor; last = cursor; expanded = false; dir = 1; },
    /** A wheel move to `cursor` (frame index in the active series). */
    press(cursor) {
      if (cursor !== last) dir = cursor > last ? 1 : -1;
      last = cursor;
      if (Math.abs(cursor - origin) >= EXPAND_AFTER_FRAMES) expanded = true;
    },
    state: () => ({ key, origin, expanded, dir, cursor: last }),
  };
}

/** Run `fn` when the main thread is idle (requestIdleCallback, else a macrotask); `budgetMs` is advisory to the caller. */
export function idleSlice(fn) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => fn(), { timeout: 250 });
  } else {
    setTimeout(fn, 0);
  }
}

/**
 * The loop. store = marineFrameStore; fetchFrame(path, signal) -> Promise<{ buffer, wire } | { error, status }> (#422's
 * fetchFrameBytes); decodeAndPack(buffer, key, validTime) -> pack | null (parseFrame + packStaticFrame); onPacked(key,
 * validTime) uploads to the GPU; onStale() re-pins after a 404/400 (retention removed the run). Returns
 * { replan(plan, activeKey), open(), telemetry() }.
 */
export function createPrefetcher({ store, fetchFrame, decodeAndPack, onPacked = () => {}, onStale = () => {}, schedule = idleSlice,
  cap = CAP, now = () => Date.now() } = {}) {
  let plan = []; let activeKey = null; let opened = false; let capNow = cap;
  const inflight = new Map(); // id -> { key, validTime, ctrl }
  const fails = new Map();    // id -> consecutive failures
  const retryAt = new Map();  // id -> the earliest time it may be asked again
  const t = { requests: 0, landed: 0, aborted: 0, preempted: 0, errors: 0, bytes: 0, packFail: 0, stale: 0, backedOff: 0 };
  const idOf = (key, validTime) => `${key}@${validTime}`;
  function failed(id) {
    const n = (fails.get(id) || 0) + 1;
    fails.set(id, n);
    retryAt.set(id, now() + Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** (n - 1)));
  }
  // A plan entry that still needs a request: absent, built, and not waiting out a retry delay.
  function waiting(p) {
    const e = store.entry(p.key, p.validTime);
    return !!(e && e.path && e.state === 'absent' && !((retryAt.get(idOf(p.key, p.validTime)) || 0) > now()));
  }

  // A warm entry (another model's frame at the cursor, kept for an instant model toggle) is never stale while it is planned.
  function abortStale() {
    const top = new Set(plan.filter((p, i) => i < 2 * capNow || p.warm).map((p) => idOf(p.key, p.validTime)));
    for (const [id, f] of [...inflight]) {
      if (f.key === activeKey || top.has(id)) continue;
      f.ctrl.abort(); inflight.delete(id); store.markAbsent(f.key, f.validTime); t.aborted += 1;
    }
  }

  // PREEMPT (measured 2026-10-21: after a big jump all slots held frames near the OLD cursor, active-set requests are never
  // aborted, so the frame now on screen waited for a free slot: 874-886 ms vs 570-645 ms without the store). When one of the
  // plan's first two frames needs fetching and every slot is busy, abort the lowest-priority in-flight request (the latest in
  // the plan, or one no longer in it) to make room. It goes back to absent and is fetched again in its turn.
  function preemptForHead() {
    const rank = new Map(plan.map((p, i) => [idOf(p.key, p.validTime), i]));
    const need = plan.slice(0, 2).filter(waiting).length;
    while (need > 0 && inflight.size > capNow - need) {
      let worst = null;
      for (const [id, f] of inflight) {
        const r = rank.has(id) ? rank.get(id) : Infinity;
        if (r <= 1) continue;
        if (!worst || r > worst.r) worst = { id, f, r };
      }
      if (!worst) return;
      worst.f.ctrl.abort(); inflight.delete(worst.id); store.markAbsent(worst.f.key, worst.f.validTime); t.preempted += 1;
    }
  }

  function start(p) {
    const e = store.entry(p.key, p.validTime);
    if (!e || !e.path || !store.markInflight(p.key, p.validTime)) return false;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : { abort() {}, signal: undefined };
    const id = idOf(p.key, p.validTime);
    inflight.set(id, { key: p.key, validTime: p.validTime, ctrl });
    t.requests += 1;
    Promise.resolve(fetchFrame(e.path, ctrl.signal)).then((got) => {
      if (!inflight.has(id)) return;              // aborted meanwhile
      inflight.delete(id);
      if (!got || got.error) {
        store.markAbsent(p.key, p.validTime);
        if (!got || got.error !== 'aborted') { t.errors += 1; failed(id); }
        if (got && (got.status === 404 || got.status === 400)) { t.stale += 1; onStale(p.key); }
        pump();
        return;
      }
      fails.delete(id); retryAt.delete(id);
      t.bytes += got.wire || 0;
      schedule(() => {
        let pack = null;
        try { pack = decodeAndPack(got.buffer, p.key, p.validTime); } catch (err) { pack = null; }
        const raw = got.raw !== undefined ? got.raw : (got.buffer instanceof ArrayBuffer ? got.buffer : null);
        if (pack && store.putPacked(p.key, p.validTime, pack, raw)) { t.landed += 1; onPacked(p.key, p.validTime); } else {
          // Out of the packer's scope (the wrap-mirror case, another layer) or a stale signature: a terminal miss, so the normal
          // path serves the hour and the loop never re-fetches it.
          store.markUnpackable(p.key, p.validTime, pack ? 'signature' : 'unpackable');
          t.packFail += 1;
        }
      });
      pump();
    }, () => { if (inflight.delete(id)) { store.markAbsent(p.key, p.validTime); t.errors += 1; failed(id); } pump(); });
    return true;
  }

  function pump() {
    if (!opened) return;
    for (const p of plan) {
      if (inflight.size >= capNow) break;
      const e = store.entry(p.key, p.validTime);
      if (e && e.state === 'absent') {
        if ((retryAt.get(idOf(p.key, p.validTime)) || 0) > now()) { t.backedOff += 1; continue; }
        start(p);
      }
    }
  }

  return {
    /** A new plan (planWant's output) and the active set's key; slow = the slow-link cap. */
    replan(nextPlan, nextActiveKey, { slow = false } = {}) {
      plan = Array.isArray(nextPlan) ? nextPlan : []; activeKey = nextActiveKey || null; capNow = slow ? Math.min(cap, CAP_SLOW) : cap;
      abortStale(); if (opened) preemptForHead(); pump();
    },
    /** The map drew its first marine frame: frame requests may start. */
    open() { if (!opened) { opened = true; pump(); } },
    inflightCount: () => inflight.size,
    /** The plan is done: nothing in flight and no plan entry still waiting for a request (unbuilt and backed-off ones excepted). */
    idle: () => inflight.size === 0 && !plan.some(waiting),
    telemetry: () => ({ ...t, inflight: inflight.size, cap: capNow, opened, planned: plan.length }),
  };
}
