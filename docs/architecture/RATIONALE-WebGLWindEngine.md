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
