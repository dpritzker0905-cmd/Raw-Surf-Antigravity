/**
 * ForecastWheel.js — the detented drum timeline scrubber (2026-07-12, USER-approved prototype
 * artifact d50c0923: "I do like the Forecast wheel prototype. Implement it").
 *
 * Interaction spec (from the approved mock):
 *  - JOG: 1:1 px→hours while dragging (one detent per forecast hour; day boundaries heavier).
 *  - SHUTTLE: a flick coasts with friction, velocity CAPPED at ~6 hours/sec — fast enough to
 *    cross 14 days in ~8 s, slow enough that every day boundary registers.
 *  - SETTLE-GATED COMMITS: the map commits on detent settle (plus one leading commit at gesture
 *    start so it begins responding immediately). Intermediate hours are display-only — the same
 *    churn contract as the old slider's 11 Hz decimation, but tighter (see wheelCommitPlan).
 *  - Radar mode: per-frame commits during the jog (a radar tick is a cheap CDN tile swap — the
 *    existing full-rate contract, cb074b8b), wider tick pitch, no day labels.
 *  - Accessibility: role="slider" + keyboard (arrows ±1, PgUp/PgDn ±day, Home=now), visible
 *    focus, prefers-reduced-motion = no inertia (drag + instant settle only).
 *  - THREE THEMES (light/dark/beach — binding rule, CLAUDE.md) via the `theme` prop; serves all
 *    three MapWeatherControls layouts (desktop panel, mobile float, mobile sheet) unchanged.
 *
 * Kill switch: window.__RAW_CLASSIC_SCRUBBER__ = true restores the classic range slider
 * (shouldUseClassicScrubber — the parent checks it, this module owns the predicate).
 */
import React, { useEffect, useRef, useCallback } from 'react';

export const WHEEL_MAX_VEL_HPS = 6;      // shuttle coast cap, hours/second (user-tunable below)
const FRICTION_PER_SEC = 0.06;           // strong friction: velocity decays to 6% per second
const SETTLE_EPS = 0.01;

/**
 * The velocity a release should actually coast on (pure; exported for tests).
 *
 * ⚠️ THE DEFECT THIS CLOSES. `s.vel` is written ONLY inside `onPointerMove`. If the finger stops
 * moving, no pointermove fires, so `s.vel` keeps whatever it held at the last motion sample — however
 * long ago — and `onPointerUp` branched on that fossil with no elapsed-time check. Park the wheel on
 * the hour you want, pause to read it, release: the wheel coasts off a velocity from before the pause
 * and lands somewhere else. That corrupts the VALUE the user is looking at, not merely the timing.
 *
 * The decay reuses `coast()`'s OWN `FRICTION_PER_SEC` rather than inventing a threshold, so a pause is
 * physically identical to having coasted through it — continuous, with no new constant to calibrate
 * and no cliff to sit on. Derived, against the 1.2 h/s coast gate and the 6 h/s cap:
 *
 *     pause  50 ms -> 5.21 h/s  COAST      (a real flick: the finger leaves in well under 100 ms)
 *     pause 100 ms -> 4.53      COAST
 *     pause 300 ms -> 2.58      COAST
 *     pause 500 ms -> 1.47      COAST      (still a flick, barely — the curve has no edge to snag on)
 *     pause   1 s  -> 0.36      settle     (a deliberate pause can no longer throw the wheel)
 *     pause   2 s  -> 0.02      settle
 *
 * Kill: window.__RAW_DISABLE_WHEEL_RELEASE_DECAY__ = true restores the fossil-velocity behaviour.
 */
export function wheelReleaseVelocity(vel, msSinceLastMove, win) {
  const v = Number(vel) || 0;
  const w = win || (typeof window !== 'undefined' ? window : {});
  if (w.__RAW_DISABLE_WHEEL_RELEASE_DECAY__ === true) return v;
  const dt = Number(msSinceLastMove);
  if (!Number.isFinite(dt) || dt <= 0) return v;   // no elapsed reading -> change nothing
  return v * Math.pow(FRICTION_PER_SEC, dt / 1000);
}

/** Classic-slider escape hatch (pure; exported for tests). */
export function shouldUseClassicScrubber(win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  return w.__RAW_CLASSIC_SCRUBBER__ === true;
}

/** Coast-velocity cap (pure; exported for tests). Lever: __RAW_WHEEL_MAX_HPS__. */
export function clampWheelVelocity(vel, win) {
  const w = win || (typeof window !== 'undefined' ? window : {});
  const cap = (typeof w.__RAW_WHEEL_MAX_HPS__ === 'number' && w.__RAW_WHEEL_MAX_HPS__ > 0)
    ? w.__RAW_WHEEL_MAX_HPS__ : WHEEL_MAX_VEL_HPS;
  return Math.max(-cap, Math.min(cap, vel));
}

/** Nearest detent inside the track (pure; exported for tests). */
export function wheelSettleTarget(hour, max) {
  return Math.max(0, Math.min(max, Math.round(hour)));
}

/** Tick pitch in CSS px: forecast hours are dense; radar frames spread to stay readable. */
export function wheelPitchPx(isRadar, max) {
  return isRadar ? 28 : 14;
}

const THEME_COLORS = {
  dark:  { tick: '#3b3f4b', day: '#565b6b', label: 'rgba(255,255,255,0.6)', accent: '#06b6d4' },
  light: { tick: '#c3c8d1', day: '#8b93a1', label: 'rgba(0,0,0,0.6)',       accent: '#0891b2' },
  beach: { tick: '#1d5a4e', day: '#2f8272', label: 'rgba(127,181,170,0.9)', accent: '#00e0cc' },
};

const ForecastWheel = ({ isRadar, max, value, theme, onPreview, onCommit, onScrubStart, onScrubEnd }) => {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const s = useRef({ hour: value || 0, vel: 0, dragging: false, coasting: false,
                     lastX: 0, lastT: 0, raf: null, lastCommitted: null }).current;
  const reduced = typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const colors = THEME_COLORS[theme] || THEME_COLORS.dark;
  const pitch = wheelPitchPx(isRadar, max);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    ctx.clearRect(0, 0, W, H);
    const mid = W / 2;
    for (let h = 0; h <= max; h++) {
      const x = mid + (h - s.hour) * pitch * dpr;
      if (x < -40 || x > W + 40) continue;
      const isDay = !isRadar && h % 24 === 0;
      ctx.strokeStyle = isDay ? colors.day : colors.tick;
      ctx.lineWidth = (isDay ? 2 : 1) * dpr;
      const len = isDay ? 0.52 : ((!isRadar && h % 6 === 0) || isRadar ? 0.34 : 0.22);
      ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x, H * (1 - len)); ctx.stroke();
      if (isDay) {
        ctx.fillStyle = colors.label;
        ctx.font = `${10 * dpr}px -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        const d = new Date(); d.setHours(d.getHours() + h);
        ctx.fillText(h === 0 ? 'Now' : d.toLocaleDateString('en-US', { weekday: 'short' }), x, H * 0.28);
      }
    }
    // nearest-detent emphasis under the cursor line
    const nx = mid + (wheelSettleTarget(s.hour, max) - s.hour) * pitch * dpr;
    ctx.strokeStyle = colors.accent; ctx.lineWidth = 2 * dpr; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(nx, H); ctx.lineTo(nx, H * 0.42); ctx.stroke();
    ctx.globalAlpha = 1;
  }, [max, isRadar, pitch, colors, s]);

  const setAria = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const h = wheelSettleTarget(s.hour, max);
    box.setAttribute('aria-valuenow', h);
    box.setAttribute('aria-valuetext', isRadar ? `frame ${h + 1}` : (h === 0 ? 'Now' : `+${h} hours`));
  }, [max, isRadar, s]);

  const commit = useCallback((h) => {
    const t = wheelSettleTarget(h, max);
    if (s.lastCommitted === t) return;
    s.lastCommitted = t;
    onCommit(t);
  }, [max, onCommit, s]);

  const setHour = useCallback((h, { preview = true, doCommit = false } = {}) => {
    s.hour = Math.max(0, Math.min(max, h));
    draw(); setAria();
    if (preview && onPreview) onPreview(wheelSettleTarget(s.hour, max));
    if (doCommit) commit(s.hour);
  }, [max, draw, setAria, onPreview, commit, s]);

  const settle = useCallback(() => {
    const target = wheelSettleTarget(s.hour, max);
    const finish = () => { s.coasting = false; setHour(target, { doCommit: true }); if (onScrubEnd) onScrubEnd(); };
    if (reduced) { finish(); return; }
    const step = () => {
      const d = target - s.hour;
      if (Math.abs(d) < SETTLE_EPS) { finish(); return; }
      s.hour += d * 0.3; draw(); setAria();
      s.raf = requestAnimationFrame(step);
    };
    if (s.raf) cancelAnimationFrame(s.raf);
    s.raf = requestAnimationFrame(step);
  }, [max, reduced, setHour, draw, setAria, onScrubEnd, s]);

  const coast = useCallback(() => {
    if (reduced) { settle(); return; }
    s.coasting = true;
    let prev = performance.now();
    const step = (t) => {
      const dt = (t - prev) / 1000; prev = t;
      s.vel = clampWheelVelocity(s.vel) * Math.pow(FRICTION_PER_SEC, dt);
      setHour(s.hour - s.vel * dt, { preview: true });
      if (Math.abs(s.vel) < 0.4) { settle(); return; }
      s.raf = requestAnimationFrame(step);
    };
    if (s.raf) cancelAnimationFrame(s.raf);
    s.raf = requestAnimationFrame(step);
  }, [reduced, settle, setHour, s]);

  const onPointerDown = useCallback((e) => {
    s.dragging = true; s.vel = 0;
    s.lastX = e.clientX; s.lastT = performance.now();
    if (s.raf) cancelAnimationFrame(s.raf);
    s.coasting = false;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    if (onScrubStart) onScrubStart();
    commit(s.hour);   // leading commit — the map starts responding immediately
  }, [onScrubStart, commit, s]);

  const onPointerMove = useCallback((e) => {
    if (!s.dragging) return;
    const dx = e.clientX - s.lastX;
    const t = performance.now();
    const dh = dx / pitch;
    s.vel = 0.8 * s.vel + 0.2 * (dh / Math.max(0.001, (t - s.lastT) / 1000));
    s.lastX = e.clientX; s.lastT = t;
    const before = wheelSettleTarget(s.hour, max);
    setHour(s.hour - dh, { preview: true });
    // Radar keeps its full-rate contract: a tick is a cheap CDN tile swap.
    if (isRadar) {
      const after = wheelSettleTarget(s.hour, max);
      if (after !== before) commit(after);
    }
  }, [pitch, max, isRadar, setHour, commit, s]);

  const onPointerUp = useCallback(() => {
    if (!s.dragging) return;
    s.dragging = false;
    // Decay the sampled velocity across the gap since the last MOVE, not the last event: a finger
    // that stopped moving has no velocity, however recently it was lifted. See wheelReleaseVelocity.
    s.vel = wheelReleaseVelocity(s.vel, performance.now() - s.lastT);
    if (Math.abs(s.vel) > 1.2 && !isRadar) coast(); else settle();
  }, [coast, settle, isRadar, s]);

  const onKeyDown = useCallback((e) => {
    const dayStep = isRadar ? 1 : 24;
    const step = { ArrowLeft: -1, ArrowRight: 1, PageDown: -dayStep, PageUp: dayStep }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      setHour(wheelSettleTarget(s.hour, max) + step, { doCommit: true });
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHour(0, { doCommit: true });
    }
  }, [max, isRadar, setHour, s]);

  // Follow external value changes (autoplay, model resets) while the user isn't driving.
  useEffect(() => {
    if (!s.dragging && !s.coasting && typeof value === 'number' && wheelSettleTarget(s.hour, max) !== value) {
      s.hour = Math.max(0, Math.min(max, value));
      s.lastCommitted = value;
      draw(); setAria();
    }
  }, [value, max, draw, setAria, s]);

  // Canvas sizing (DPR-aware) — ResizeObserver keeps mobile rotations/panel resizes crisp.
  useEffect(() => {
    const box = boxRef.current;
    const cv = canvasRef.current;
    if (!box || !cv) return undefined;
    const resize = () => {
      const r = box.getBoundingClientRect();
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      cv.width = Math.max(1, r.width * dpr);
      cv.height = Math.max(1, r.height * dpr);
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      draw();
    };
    resize();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(resize);
      ro.observe(box);
    }
    return () => { if (ro) ro.disconnect(); if (s.raf) cancelAnimationFrame(s.raf); };
  }, [draw, s]);

  const edgeFade = theme === 'light' ? 'rgba(255,255,255,0.9)' : (theme === 'beach' ? 'rgba(3,17,15,0.9)' : 'rgba(24,24,27,0.9)');

  return (
    <div
      ref={boxRef}
      role="slider"
      tabIndex={0}
      aria-label={isRadar ? 'Radar timeline wheel' : 'Forecast timeline wheel'}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={wheelSettleTarget(s.hour, max)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className="relative w-full rounded-lg overflow-hidden cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-cyan-500 outline-none"
      style={{ height: 52, touchAction: 'pan-y' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: 0, width: 36, background: `linear-gradient(to right, ${edgeFade}, transparent)` }} />
      <div className="absolute top-0 bottom-0 pointer-events-none" style={{ right: 0, width: 36, background: `linear-gradient(to left, ${edgeFade}, transparent)` }} />
      <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: '50%', width: 2, transform: 'translateX(-1px)', background: colors.accent }} />
    </div>
  );
};

export default ForecastWheel;
