/**
 * scrubPerfProbe.js — objective scrub / timeline-animation re-render harness (backlog #1, 2026-07-08).
 *
 * WHY (runbook 07-08 §2a): the timeline scrub + marine layer-toggle feel "slow or buggy". The forensic
 * root is that MapWebGL (a ~850-line component) takes `radarFrameIndex` / `timeOffsetHours` as
 * render-driving PROPS, so every animation/scrub tick re-renders the whole map component (and MapPage
 * above it re-creates its inline handler props). The child LAYERS are already memoized (chip
 * task_c5366c79 — OceanMask/WebGLMarineLayer/WindLayer/markers), so what remains is the PARENT churn.
 * This harness measures that churn and is the A/B any decoupling fix must beat.
 *
 * HOW: MapWebGL calls `__SCRUB_PROBE__.onRender({...})` once per render (armed by `__SCRUB_PROBE_ON__`,
 * near-zero cost when off). `bench()` runs the REAL playback interval (isPlayingTimeline, so the modulo
 * / hour-step logic is the app's own, not re-implemented here), samples frame times, and reports:
 *   - mapWebGLRenders  — how many times MapWebGL's body ran during the run (the number to CUT)
 *   - byProp           — which prop drove each of those renders (radarFrameIndex vs timeOffsetHours)
 *   - frameMs P50/P95/max + longFrames>50ms — the jank the user actually feels
 *   - newMarineClears / newParticleReinits — MUST stay 0: a decoupling fix that resets the marine
 *     engine or reseeds particles has regressed (radar render-mode SUSPENDS the marine engine, and
 *     the whole point is to touch neither).
 *
 * Console API (dev — set up the view first, then bench):
 *   window.__SCRUB_PROBE_ON__ = true                          // arm the per-render counter
 *   await __SCRUB_PROBE__.bench('radar',    { durationMs: 6000 })   // radar layer ON  → radarFrameIndex playback
 *   await __SCRUB_PROBE__.bench('forecast', { durationMs: 6000 })   // a marine layer ON → timeOffsetHours playback
 *   __SCRUB_PROBE__.snapshot()      // current counters
 *   __SCRUB_PROBE__.reset()
 *
 * Requires MapPage to expose window.setIsPlayingTimeline (+ setRadarFrameIndex/setTimeOffsetHours).
 * Pairs with the context-split decoupling (§2b): re-run the same bench before/after and diff the report.
 */

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

// The two load-bearing regression signals a scrub fix must not disturb (runbook §2b / §5b).
const marineClears = () => (typeof window !== 'undefined' && Number(window.__WEBGL_MARINE_CLEAR_COUNT__)) || 0;
const particleReinits = () => (typeof window !== 'undefined' && Number(window.__MARINE_ZOOMSTATE_REINITS__)) || 0;

function makeProbe() {
  const state = { renders: 0, byProp: {}, prev: null };

  // Called by MapWebGL every render (armed by __SCRUB_PROBE_ON__). Attributes each render to the
  // prop(s) that changed vs the previous render, so a run tells us WHAT is driving the churn.
  function onRender(props) {
    state.renders++;
    if (state.prev) {
      for (const k of Object.keys(props)) {
        // shallow compare; arrays (activeLayers) compare by identity, which is what React sees too
        if (state.prev[k] !== props[k]) state.byProp[k] = (state.byProp[k] || 0) + 1;
      }
    }
    state.prev = props;
  }

  function reset() {
    state.renders = 0;
    state.byProp = {};
    state.prev = null;
  }

  function snapshot() {
    return { renders: state.renders, byProp: { ...state.byProp } };
  }

  // Sample inter-frame gaps for the whole run: long gaps = dropped frames = the felt jank.
  function sampleFrames(stopRef, out) {
    let last = nowMs();
    const step = () => {
      const t = nowMs();
      out.push(t - last);
      last = t;
      if (!stopRef.stopped) requestAnimationFrame(step);
    };
    requestAnimationFrame(() => { last = nowMs(); requestAnimationFrame(step); });
  }

  async function bench(mode = 'radar', { durationMs = 6000 } = {}) {
    if (typeof window === 'undefined') return null;
    const setPlay = window.setIsPlayingTimeline;
    if (typeof setPlay !== 'function') {
      throw new Error('scrubPerfProbe.bench: window.setIsPlayingTimeline is not exposed (is MapPage mounted?)');
    }
    const wasOn = window.__SCRUB_PROBE_ON__;
    window.__SCRUB_PROBE_ON__ = true;
    reset();

    const r0 = state.renders, clears0 = marineClears(), reinits0 = particleReinits();
    const frameTimes = [];
    const stopRef = { stopped: false };
    sampleFrames(stopRef, frameTimes);

    setPlay(true);
    await new Promise((r) => setTimeout(r, durationMs));
    setPlay(false);
    stopRef.stopped = true;
    await new Promise((r) => setTimeout(r, 60)); // let the last paint/settle land

    const renders = state.renders - r0;
    const secs = durationMs / 1000;
    frameTimes.sort((a, b) => a - b);
    const pct = (q) => (frameTimes.length ? frameTimes[Math.min(frameTimes.length - 1, Math.floor(q * frameTimes.length))] : 0);
    const round = (x) => Math.round(x * 10) / 10;

    const report = {
      mode,
      durationMs,
      mapWebGLRenders: renders,
      rendersPerSec: round(renders / secs),
      byProp: { ...state.byProp },
      frameMsMedian: round(pct(0.5)),
      frameMsP95: round(pct(0.95)),
      frameMsMax: round(Math.max(0, ...frameTimes)),
      longFrames_gt50ms: frameTimes.filter((x) => x > 50).length,
      sampledFrames: frameTimes.length,
      newMarineClears: marineClears() - clears0,
      newParticleReinits: particleReinits() - reinits0,
    };
    window.__SCRUB_PROBE_ON__ = wasOn;
    try { console.table(report); } catch (e) { console.log(report); }
    if (report.newMarineClears > 0 || report.newParticleReinits > 0) {
      console.warn('[scrubPerfProbe] ⚠️ marine engine was disturbed during the run — a scrub fix MUST keep these 0',
        { newMarineClears: report.newMarineClears, newParticleReinits: report.newParticleReinits });
    }
    return report;
  }

  return {
    onRender,
    reset,
    snapshot,
    bench,
    get renders() { return state.renders; },
    get byProp() { return { ...state.byProp }; },
  };
}

if (typeof window !== 'undefined' && !window.__SCRUB_PROBE__) {
  window.__SCRUB_PROBE__ = makeProbe();
}

export default (typeof window !== 'undefined' ? window.__SCRUB_PROBE__ : null);
