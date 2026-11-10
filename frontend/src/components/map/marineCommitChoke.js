/**
 * marineCommitChoke.js - the finer-resident hold at the ONE place every marine commit passes: the state setter (2026-11-09).
 *
 * THE SCENE (live on dev, Nov 9 ~05:00Z, ICON wind_waves, Florida east coast, z9, desktop): turning the layer on drew the 13x17 regional
 * grid at 0.25 deg (t=12.1 s), then the 181x83 world frame at 2 deg replaced it at t=13.5 s and stayed until a pan at t=22.6 s, while
 * window.__MARINE_FINER_HELD__ stayed null: #749's world-over-regional hold never ran. That hold lived only inside commitMarineData's
 * reducer, and ~15 routes call setMarineData directly (the orchestrator's switch cache hits, the 429 cooldown fallback - which asks
 * getModelSafeMarine for a covering WORLD grid on purpose -, the scrub cache, the settle lanes series_settle / series_pending /
 * series_sharpen / recovery_2b, the fetch core's error paths). This wraps the setter useMarineDataFetcher creates, so every route,
 * direct value or functional updater, meets the same rule (marineFinerResidentHold.finerResidentHoldDecision).
 *
 * WHAT IT NEVER HOLDS: an update that keeps the resident's own grid (a restamp, a stale mark, an unsupported-layer override, a re-commit
 * of the same frame), a null / gridless value, anything while the engine holds NOTHING (a held resident that is not drawn would keep the
 * map blank: the recovery lanes exist for exactly that), or anything when no live map viewport can be read. The rule's own releases all
 * stand: a different model, layer, hour, flavour or run, a stale resident, a resident that does not contain the live view (a pan off the
 * tile), a view of 15 deg or more (zoomed out), a finer incoming grid.
 *
 * THE BASE WASH: the engine captures its coarse base (_captureCoarseBase) only from a world grid it ACCEPTS in setWaveData, or from the
 * staged seed (_pendingCoarseBaseGrid, consumed at the next quiet render). A world frame held here never reaches the engine, so it is
 * forwarded as that seed (marineGlobalPrewarm._stageCoarseBridgeSeed, which refuses when a base of that model/layer/hour already exists;
 * kill __RAW_DISABLE_COARSE_BRIDGE__): the wash under and around the regional keeps the frame the hold kept off the resident slot.
 *
 * Kills (read per call): __RAW_DISABLE_FINER_RESIDENT_HOLD__ (every hold), __RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__ (world incoming).
 * Telemetry: __MARINE_FINER_HELD__ {count, last} (last.route = 'choke' | 'commit', last.lane), and __MARINE_WORLD_OVER_REGIONAL__
 * {held, released, last: {held, reason, lane, ...}}: every world-over-regional offer, held or not, with the guard that released it.
 */
import { finerResidentHoldDecision, readLiveViewport } from './marineFinerResidentHold';
import { boundsWidth } from './marineScrubHold';

const WORLD_SPAN_DEG = 340;
// LAZY (as backendWeatherServiceClientDiag.js does): marineGlobalPrewarm pulls the backend clients in at module load, and this module sits
// on the commit helpers' import chain, which many suites load with those clients partially mocked. Resolved only when a world frame is held.
function stageWorldSeed(g, from) {
  try { require('./marineGlobalPrewarm')._stageCoarseBridgeSeed(g, g.__sourceModel, g.__componentLayer, from); } catch (e) { /* best-effort */ }
}
const W = (win) => win || (typeof window !== 'undefined' ? window : null);
const laneOf = (d) => (d && (d.__commitLane || (d.grid && d.grid.__commitLane))) || null;

/** A hold happened (either route): count it, and forward a held WORLD frame to the engine's base-wash seed. */
export function noteFinerHeld(detail, incoming, route, win) {
  const w = W(win);
  if (!w) return;
  try {
    const fh = w.__MARINE_FINER_HELD__ || (w.__MARINE_FINER_HELD__ = { count: 0 });
    fh.count++;
    fh.last = { ...detail, route, lane: laneOf(incoming), ts: Date.now() };
  } catch (e) { /* telemetry only */ }
  const g = incoming && incoming.grid;
  if (g && g.bounds && boundsWidth(g.bounds) >= WORLD_SPAN_DEG) {
    stageWorldSeed(g, `world_over_regional_hold_${route}`);
  }
}

function noteWorldOffer(held, reason, prev, next, w) {
  try {
    const t = w.__MARINE_WORLD_OVER_REGIONAL__ || (w.__MARINE_WORLD_OVER_REGIONAL__ = { held: 0, released: 0 });
    if (held) t.held++; else t.released++;
    t.last = { held, reason: reason || null, lane: laneOf(next), resident: `${prev.grid.cols}x${prev.grid.rows}`,
      incoming: `${next.grid.cols}x${next.grid.rows}`, ts: Date.now() };
  } catch (e) { /* telemetry only */ }
}

/** The value React should keep: `prev` when the finer resident is held, else `next` (unchanged). Pure but for telemetry. */
export function chokeMarineCommit(prev, next, win) {
  const w = W(win);
  if (!w || !prev || !next || next === prev) return next;
  const pg = prev.grid, ng = next.grid;
  if (!pg || !ng || pg === ng) return next;   // the resident's own grid: a restamp / stale mark / override, never a replacement
  const eng = w.__MARINE_ENGINE__;
  if (eng && !eng._waveData) return next;     // nothing drawn: never keep an undrawn resident over a drawable frame
  const vp = readLiveViewport(w);
  if (!vp) return next;
  const d = finerResidentHoldDecision({
    disabled: w.__RAW_DISABLE_FINER_RESIDENT_HOLD__ === true,
    disabledWorld: w.__RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__ === true,
    prev, incoming: next, viewport: vp, liveViewport: vp,
  });
  if (ng.bounds && pg.bounds && boundsWidth(ng.bounds) >= WORLD_SPAN_DEG && boundsWidth(pg.bounds) < WORLD_SPAN_DEG) {
    noteWorldOffer(d.hold, d.reason, prev, next, w);
  }
  if (!d.hold) return next;
  noteFinerHeld(d.detail, next, 'choke', w);
  return prev;
}

/** Wrap a React state setter: direct values and functional-updater results both pass chokeMarineCommit. */
export function guardMarineSetter(rawSet, win) {
  return (valueOrUpdater) => rawSet((prev) => {
    const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(prev) : valueOrUpdater;
    return chokeMarineCommit(prev, next, win);
  });
}
