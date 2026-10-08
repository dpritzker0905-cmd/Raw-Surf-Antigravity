# WebGLWindEngine — relocated rationale blocks

Rationale relocated verbatim from `frontend/src/components/map/WebGLWindEngine.js` under the
LOC-ratchet discipline (2026-08-09, ratchet red on `086ee773`): the file is grandfathered
shrink-only at 1,095 lines, and the recorded fix pattern is moving narrative rationale here —
never deleting it. Each block below is pointed to by a short comment at its source site.

## `windFineWideFade` — WIDE-ZOOM HANDLING, round 2 (2026-07-19 late)

Round 1 faded the whole overlay out at wide zoom — and the user immediately caught the crime:
"when you removed the grid, so went the low pressure system." The fine box's INTERIOR held the
only data resolving the circulation; fading data to fix a frame artifact inverts the truth-first
contract. The corrected split:

- the fine DATA never fades (colour == speed at every zoom; a circulation must never vanish);
- only the box EDGE dissolves — the feather band widens as the viewport dwarfs the box, so the
  rectangle reading disappears while the core keeps full truth;
- only the vortex PERSISTENCE lever rides the fade (it hoards the fixed particle population into
  the box at wide zoom — the "no animations over Texas" depletion; arc-reading is a close-zoom
  concern).

Pure + exported for the gate tests. Kill: `__RAW_DISABLE_WIND_WIDEFADE__` (fade pinned to 1,
feather stays narrow).

## Heatmap base pass — BASE-PASS CUTOUT (queue #9) + SINGLE-PASS BASE+FINE (2026-07-20)

BASE-PASS CUTOUT: fade the base out exactly where the fine overlay fades in so the two
semi-transparent passes crossfade instead of compounding. Skipped when the fine box crosses the
antimeridian (rect wraps in base-UV space); the compound there is feathered and brief, and
correctness of DATA is unaffected.

SINGLE-PASS BASE+FINE (the hairline-seam fix): with the fine box mapped into base-UV space, the
base pass samples BOTH textures and mixes the WIND in-shader — one draw, one alpha, so the
two-pass crossfade band (and its bright hairline rectangle) cannot exist. Legacy two-pass path
kept behind the kill switch AND for the vortex debug view (which paints on the overlay pass).
Kill: `__RAW_DISABLE_WIND_HEATMAP_SINGLEPASS__`.

## Advection — ACCESSIBILITY reduced-motion damp (R11-09 port, 2026-08-09)

Honor `prefers-reduced-motion` by damping particle drift to 0.15× — verbatim from the marine
engine's 2026-07-03 §6.4 implementation (see `WebGLMarineEngine.js`, which carries the full
original rationale), which was never mirrored here: 147,456 wind particles — the busiest motion
surface in the app — ran at full speed for reduced-motion users, against the CLAUDE.md
accessibility mandate. The heatmap (the actual data) is untouched; only decorative motion slows.
Cached matchMedia (evaluated once; OS-level changes re-evaluate on reload, the norm for this
media feature). Test override: `window.__RAW_REDUCED_MOTION__` (true = force damp, false =
force off).

## Respawn — MOTION FLOOR (2026-10-08, the hurricane report)

Owner report (Gulf hurricane, with a screen recording): "for winds around 44kts or higher, the
speed of the animations is that of slow wind, where it almost looks like it isn't moving at all
and in the shape of a diamond."

**What the recording shows.** In the hurricane band every particle leaves 1-3 isolated ring
stamps (the "diamonds") and the whole pattern reshuffles between frames 0.1 s apart — nothing is
seen travelling. In slower air in the same frame the same renderer draws 5-10-stamp streaks that
glide.

**Root cause.** ADVECT_FS respawns with `u_drop_rate + speed * u_drop_rate_bump`, with `speed` in
KNOTS. The v3.8 port (`0105a9d7`, 2026-05-16) took webgl-wind's defaults (0.003 / 0.01), but
upstream multiplies the bump by speed NORMALISED to 0..1 (`speed_t`), so its bump never exceeds
0.01; here it is 0.008 × knots — 0.376 at 47 kn. Mean life is 1 / dropRate:

| kn | 10 | 20 | 30 | 47 | 64 | 100 |
|---|---|---|---|---|---|---|
| life, frames (60 Hz) | 12.2 | 6.2 | 4.1 | **2.6** | **1.9** | **1.2** |
| streak = step × life, css px | 6.2 | 6.9 | 7.4 | 7.9 | 8.3 | 8.8 |

A particle that lives ~40 ms cannot be seen moving, and the distance it covers before it dies is
nearly the same at every speed above ~5 kn — a hurricane streak is no longer than a breeze's.
The 2026-07-18 ink-budget work called the rule "a well-tuned compensator" because it holds TRAIL
ink flat; true, but flat ink was bought with lifetime, and above ~20 kn the lifetime fell below
what motion needs. (Above 124.75 kn `1 - dropRate` also went negative, leaving the A15-18
`pow(1 - dropRate, u_dt_scale)` undefined.)

**Fix.** `dropRate = min(dropRate, u_drop_cap)` as the last rule before the drop test, with
`u_drop_cap = 1 / minLifeFrames`, default 6 frames = 100 ms (about the shortest exposure at which
speed reads). It engages above ~20.6 kn only — every value at and below that is bit-identical —
and above it the life is constant, so the streak grows linearly with speed (47 kn: 18 px against
10 kn's 6-9). An unset uniform (0) means no cap. On the density gate's own ink model the ratio
across real and hurricane speeds IMPROVES (2.92x → 2.08x on the real Gulf speeds; 7.5x → 2.1x
with hurricane speeds included), because hurricane cores stop being starved of marks.

**Verified on the GPU** (WebGL1 / ANGLE, the real ADVECT_FS text, synthetic 100 kn Rankine storm,
65,536 particles × 240 frames, per-frame respawn hazard by speed band):

| band | uncapped (cap 1.0 / unset) | motion floor (1/6) |
|---|---|---|
| 10-20 kn | 0.153 (6.5 frames) | 0.152 (6.6) — unchanged |
| 30-44 kn | 0.275 (3.6) | 0.165 (6.1) |
| 44-64 kn | 0.403 (2.5) | 0.164 (6.1) |
| 64-100 kn | 0.600 (1.7) | 0.165 (6.1) |

Resolver `resolveWindMotionFloor` (WebGLWindUtils.js), bound every frame next to
`u_speed_gamma`. Lever: `window.__RAW_WIND_MIN_LIFE_FRAMES__` (2..60). Kill:
`window.__RAW_DISABLE_WIND_MOTION_FLOOR__ = true` (cap 1.0 = the uncapped rule). Tests:
`windMotionFloor.test.js`; the density gate's mirror (`windParticleDensity.test.js`) carries the
cap.
