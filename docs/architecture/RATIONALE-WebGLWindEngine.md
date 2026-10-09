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

## DRAW_FS casing (relocated verbatim from WebGLWindShaders.js, 2026-10-08)

Moved under the LOC ratchet so the particles-v2 hooks fit (the block below is unchanged source comment text).

```
  // Enhance particle contrast over heatmaps. THE STRUCTURAL PROBLEM (2026-07-18 EVE-3, user
  // report: "wind animations are hard to see as they blend too much with their heatmap colors"):
  // the particle and the field beneath it sample the SAME ramp at the SAME normalised speed —
  // texture2D(u_color_ramp, v_speed/u_max_speed) here vs ramp(speed/u_max_speed, u_theme) in
  // HEATMAP_FS — so a particle's colour is IDENTICAL to the pixel behind it BY CONSTRUCTION. No
  // palette edit can fix that; only a luminance separation can, which is what rim+core are for.
  //
  // THE GAP: rim/core were FIXED black/white, and this program was the one wind program that never
  // received u_theme (the engine bound it to heatmapProgram only). Tuned against the dark theme,
  // they invert in light mode — there the field ramp is DEEP NAVY/TEAL on a LIGHT basemap, so a
  // 98%-black rim is camouflage against the very field it must separate from. Beach's bright
  // coral/yellow field washes out the white core for the same reason, mirrored.
  // Now theme-aware: the rim always runs AWAY from the local field's luminance.
  // Kill: __RAW_DISABLE_THEMED_PARTICLE_RIM__ (u_theme_rim = 0.0 -> the legacy black/white pair).
  // DUAL-TONE CASING (2026-07-18 EVE-3 round 2 — the cartographic halo/casing technique).
  // A PER-THEME CONSTANT rim was still wrong. Measured contrast of the shipped rim against the
  // field colour it must separate from, per ramp stop (scripts/probe_wind_contrast.js):
  //   dark  worst 5.48:1 @39kn · light worst 3.78:1 @21kn · beach worst 3.30:1 @39kn
  // The light ramp's luminance is NON-MONOTONIC — it PEAKS at the 21 kn gold (Y=0.460) — so a
  // fixed near-white rim has the least headroom exactly in the common moderate-wind band. That is
  // the "still hard to see at SOME wind speeds" report, and it is not fixable by choosing a better
  // constant: a MID-luminance field contrasts poorly against BOTH poles at once.
  //
  // The fix is the technique mapmakers use for labels/lines over arbitrary terrain: give the mark
  // its OWN high-contrast edge. An outer ring and an inner ring at OPPOSITE luminance poles put a
  // ~21:1 boundary INSIDE the mark, so legibility stops depending on the field's luminance at all.
  // The orientation flips on the LOCAL field luminance (APCA coefficients) so the OUTER ring is
  // always the one opposing the field — that also makes the rule self-theming: the dark theme's
  // neon ramp is BRIGHT (Y 0.72-0.85) so it resolves to the dark-outer/light-inner pair the dark
  // theme was originally tuned with, while light's dark navy ramp resolves to the inverse.
  // The BODY keeps the speed colour: truth (colour == speed) is never traded away.
  // Kill: __RAW_DISABLE_THEMED_PARTICLE_RIM__ -> the legacy fixed black-rim/white-core pair.
```

## Wind anim tuning (relocated verbatim from WebGLWindEngine.js, 2026-10-08)

```
// WIND ANIM TUNING (2026-07-06, user request: "+~10% wind animation presence at z3.3-4.69" and
// "slower winds move slower, faster winds move faster"): motion was ALREADY linearly proportional
// to |wind| (webgl-wind lineage — offset ∝ decoded u/v); gamma > 1 adds perceptual CONTRAST by
// damping slow particles relative to fast ones (pow(speedNorm, gamma-1)); gamma 1.0 = exact linear.
// Levers: __RAW_WIND_LOWBAND_BIAS__ (0..1, default 0.012 ≈ +10% on-screen in-band),
// __RAW_WIND_SPEED_GAMMA__ (0.5..3, default 1.15), kill __RAW_DISABLE_WIND_SPEED_GAMMA__ → 1.0.
```

## Particles v2 — calibration + theme (2026-10-08, the zoom audit)

Audit: `audit/wind-zoom-2026-10-08/REPORT.md` (live sweep, GFS/EURO/ICON, z2-z14). Owner direction: "a good amount
of animations visible, but it definitely needs to be intended"; the z6 speed approved; then "test it on, and if we
don't like it, we can turn it off". Both halves default ON with independent kill switches.

**Calibration** (`__RAW_DISABLE_WIND_CALIBRATION_V2__`):
- *Density is decoupled from lifetime.* Shipped: respawn = uniform-global + a zoom-ramped viewport bias below z6,
  uniform over a 4,096-8,192 px tile above it, and lifetime set by the ink budget — measured 476 / 42 / 138 drawn
  marks per 100x100 css px at z2 / z7 / z9 (12x swing, cliff at z6/z7). v2 respawns only inside the padded viewport
  (10% margin, `v2GlobalBox` / `v2RespawnBox`), recycles a particle the moment it leaves, and a deterministic draw
  cull (`v2KeepRate`) holds one screen density at every zoom.
- *Lifetime follows perception, not ink:* ~2 s at calm, ~0.9 s at the grid max (`v2DropRule`; upstream webgl-wind
  shape: base + 0.01 x speed normalised to the grid max). Leaders run 1-6 s; shipped was 0.1-0.2 s above 10 kn.
- *Ink parity, measured on the GPU.* Long-lived heads drag tails, so the shipped head count (~130) carpeted 95% of
  the field. A real-shader A/B (synthetic 100 kn storm, z5, dark theme) matched the shipped ink with 12 heads per
  100x100 css px and fade 0.93: mean mark alpha 0.112 vs 0.094, coverage 19% vs 12% (5 heads / fade 0.965 gave
  0.084 / 15%: sparser, longer streaks). Levers `__RAW_WIND_V2_DENSITY__`, `__RAW_WIND_V2_FADE__`.
- *No beads:* each mark stretches along the flow by its own per-frame step (`v_stretch`), so consecutive stamps
  overlap by the base length at any speed.
- *Speed:* the owner-approved z6 speed (x1.16 of nominal; the shipped `Math.max(2.5e-6, ...)` clamp ran z5.78-6.0
  16% fast and nowhere else) everywhere, with no clamp. Lever `__RAW_WIND_V2_SPEED__`.

**Theme** (`__RAW_DISABLE_WIND_THEME_V2__`):
- *Premultiplied trail buffer.* FADE_FS faded RGB and pinned alpha to 1, and SCREEN_FS derived alpha from
  brightness — so a dark mark (light/beach theme casing's black ring) composited as transparent: the pale light-mode
  marks. v2 fades RGBA together and composites premultiplied (ONE, ONE_MINUS_SRC_ALPHA); the buffer is cleared on
  every mode flip.
- *One neutral body per theme* (white on dark, deep navy on light and beach — `V2_BODY`), a single adaptive casing
  ring, speed carried by the field colour plus the mark's opacity (0.85 -> 1.0) and streak length. The shipped marks
  shared the field's hue at the same speed, so they relied on luminance alone, and colour-only motion reads slower
  (Cavanagh 1984).
- *Contrast:* the field composite is mid-luminance (Y 0.25-0.55) at most speeds in every theme; with near-opaque
  heads (composite 0.95) the body or ring clears WCAG 1.4.11's 3:1 against it at every speed (worst: dark 3.05 @8 kn,
  light 3.34 @5 kn, beach 3.07 @2 kn — pinned in `windParticlesV2.test.js`). Lever `__RAW_WIND_V2_OPACITY__`.

Verified: all wind programs compile and link on WebGL1 and WebGL2 (ANGLE) with every v2 uniform active; point-size
range 1-1024.

## setWindData — COARSE-OVERLAY GUARD + NO-DOWNGRADE (relocated verbatim + extended, 2026-10-08)

```
  // COARSE-OVERLAY GUARD (2026-07-21, user "grid shape / small clamp"). The FINE overlay must
  // SHARPEN the base. A compatible regional grid that is CLEARLY coarser than the resident global
  // base (a 5x4 `swr_revalidation_pending` SWR preview over the sharp 2° world base) would render a
  // blocky patch on top of good data — keep the base, ignore the preview. Kill:
  // __RAW_DISABLE_WIND_COARSE_OVERLAY_GUARD__.
```

NO-DOWNGRADE (2026-10-08, live test after #271/#272): zooming z6 -> z9 over the Gulf, the backend answered the z9 request
with a 4x4 2-deg mid clip (its two-slot reval queue was full of timeline-prefetch frames, so no sharpen was scheduled), and
the engine filed it over the resident 1-deg viewport product that still covered the screen — the guard above only compared
against the 2-deg BASE. A compatible incoming regional grid that is clearly coarser (>1.3x cell) than the resident FINE
overlay AND lies inside it is now ignored ('noop_coarser_than_fine'); one that reaches outside the box still files (the old
box no longer covers the view). Same kill switch: __RAW_DISABLE_WIND_COARSE_OVERLAY_GUARD__.
