// Opt-in scheduling evidence. No scheduler decisions, timers, retained grids, or error messages.
const number = v => Number.isFinite(v) ? v : null;
const label = v => typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(v) ? v : null;
const bounds = b => b ? ['west', 'south', 'east', 'north'].map(k => number(b[k])) : null;
const target = d => d ? { model: label(d.model), layer: label(d.layer), hour: number(d.hour),
  surf: typeof d.surf === 'boolean' ? d.surf : null, bounds: bounds(d.bounds), zoom: number(d.zoom) } : null;
const grid = g => g ? { model: label(g.__sourceModel), layer: label(g.__componentLayer), hour: number(g.hourOffset),
  cols: number(g.cols), rows: number(g.rows), bounds: bounds(g.bounds),
  cycle: label(g.model_run_time), served: label(g.served_valid_time), rating: !!g.ratingMode,
  stale: !!g.stale, renderable: g.__renderable !== false } : null;

export function recordMarineDemand(stage, source, map, locks, detail = {}) {
  if (typeof window === 'undefined' || window.__RAW_CAPTURE_OPACITY__ !== true) return null;
  let store;
  try {
    store = window.__RAW_DEMAND_EVIDENCE__ || (window.__RAW_DEMAND_EVIDENCE__ = {
      schema: 1, seen: 0, dropped: 0, errors: 0, events: [],
    });
    const id = ++store.seen, b = map?.getBounds();
    const event = { id, stage: label(stage), source: label(source), t: performance.now(), utcMs: Date.now(),
      attempt: number(detail.attempt), requestId: number(detail.requestId), phase: label(detail.phase),
      status: label(detail.status), delay: number(detail.delay),
      viewport: b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(number) : null,
      zoom: number(map?.getZoom()), moving: !!map?.isMoving(), zooming: !!map?.isZooming(),
      target: target(detail.intent || detail), incoming: grid(detail.grid),
      resident: grid(window.__MARINE_ENGINE__?._waveData?.waveGrid),
      locks: locks ? { fetching: !!locks.isFetching, source: label(locks.activeSource),
        startedAt: number(locks.fetchStartedAt), lastTime: number(locks.lastTime) } : null,
      flags: { fetching: !!window.__MARINE_FETCH_PENDING__, debouncing: !!window.__MARINE_FETCH_DEBOUNCING__,
        scrubbing: !!window.isScrubbingTimeline, transitioning: !!window.__MARINE_TRANSITIONING__ } };
    if (store.events.length < 2000) store.events.push(event);
    else { store.events[(id - 1) % 2000] = event; store.dropped++; }
    return id;
  } catch (_) { if (store) store.errors++; return null; }
}
