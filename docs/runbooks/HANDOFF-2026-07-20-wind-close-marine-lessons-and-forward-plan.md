# HANDOFF 2026-07-20 — wind arc closed at a stable baseline; marine lessons banked; forward plan

HEAD `3e886348` on `origin/dev`. Suite **1258/1258 ×3**. State: **wind is ALWAYS-GLOBAL again**
(the viewport-fine tier is opt-in via `__RAW_WIND_VIEWPORT_FINE__=true`) with every
tier-independent improvement of 07-18/19 kept. READ FIRST:
`STUDY-2026-07-19-wind-requirements-and-patterns.md` (the binding contract), then this.

## 0. The one-paragraph history a fresh context needs

The wind arc found a real data root (10° global grids), shipped a viewport-fine tier for it, and
the tier's single-texture integration then caused every user-visible regression of day 2 (pan
"clears" the heatmap = the fine box's own edge; slow activation = cold dynamic upstream vs the
instant cached global; the clamp = the box). The tier is now opt-in until its structural
prerequisites land (#5, #9 below). Meanwhile seven genuine visual upgrades shipped and stay:
size monotonicity + DPR parity, field==LUT Beaufort spectrum, low-band hue spread (≥18° gaps,
gated), calm marks + calm lifetime floor, dash-true ink (light-wind count restored), 7 kn field
alpha ramp, close-zoom density. The commit-side coverage invariant lives in ONE choke point
(`commitWindData`) and logs its blocks.

## 1. MARINE STABILITY — lessons banked from the wind arc (future debt, ranked)

1. **Finish ARBITER Phase C** (the marine "single choke point"). Wind proved the pattern: five
   distributed commit-path guards each leaked in turn; one invariant inside the commit function
   ended it. Marine's guard chain IS the distributed version; the ARBITER is the choke point —
   3000/3000 differential already passes, needs the stateful sequence harness, then default ON.
2. **Audit marine client mappers for dropped backend flags.** Wind's mapper hardcoded
   `stale:false`, erasing the backend's fallback signal — harmless until response quality began
   to vary, then it thrashed. Marine's normalizers (backendWeatherServiceClient,
   backendCopernicusServiceClient, marineGridSeries frame mapping) should be grepped for
   constants where backend fields exist (`stale`, `fallbackReason`, `partial_coverage`).
3. **Span-aware cache containment.** Wind's world-span cached grids satisfied containment for
   every viewport and impersonated fine products (suppressing authoritative fetches, serving
   coarse into fine contexts). Marine's dyncache/coarse-base LRU/containment lookups need the
   same review: a world-span entry must never COUNT AS a fine product.
4. **Commit-gating state must be refs, never effect-locals.** Wind's coverage state reset on
   effect re-runs and blinded gates. Audit marine hooks (useMarineOrchestrator,
   useMarineScrubSettle) for effect-local variables that gate commits.
5. **Instrument thresholds are landmines.** A per-channel pixel-diff threshold sat on the dark
   calm wash's knife-edge and issued phantom CLAMP verdicts. zoomlab verdicts should use
   channel-SUM thresholds and be validated by raw pixel sampling when a verdict surprises.
6. **Default flips ship behind structural prerequisites.** The fine tier's data win converted
   into UX regressions because integration architecture lagged. Marine's pending flips
   (ARBITER default, any tier changes) take the same gate: prerequisites first, flip last.
7. **Bounds-blind warm sources.** Wind's series lane (default ON since `696f855e` — memory had
   it wrong) and warm caches committed without coverage checks. Marine's warm/instant-commit
   paths deserve the same question: does anything commit a grid without proving it covers?

## 2. LIGHT-WIND VISIBILITY — the Jacobian, measured (composited over each theme's basemap)

visDelta = chromaDistance(LUT stop, basemap) × fieldAlpha. Current shipped state:

| theme | 1 kn | 3 kn | 5 kn | binding constraint |
|---|---|---|---|---|
| dark | **24 ⚠** | **56 ⚠** | 106 | **chroma (156-207)** — alpha capped by land visibility |
| light | 107 | 164 | 226 | none — healthy |
| beach | 61 ⚠ | 97 | 138 | mild chroma at 0-1 kn |

**Prescription (next lever, NOT yet shipped):** dark's 0-3 kn stops need CHROMA, not alpha —
move them toward saturated violet/purple (high R+B against the slate basemap's low R; the
current indigo differs from slate almost only in the blue channel). Beach 0 kn: +saturation on
the magenta-rose. Alpha is DONE (0.28 base + 7 kn ramp) — pushing further trades the land-
visibility contract. Gates that must hold: windFieldLut (≥18° gaps, distinguishability),
windParticleContrast (casing poles re-derive automatically). Verify with the zoomclamp ladder +
eyes in all three themes; judge against THIS baseline (`3e886348`), not mid-regression states.

## 3. VORTEX ROTATION — the plan (theme-complete by construction)

Rotation legibility = angular displacement/frame × lifetime × count × direction-cue. All four
levers are THEME-INDEPENDENT (motion/geometry); the casing self-themes the marks, so no
per-theme work is needed beyond the standard 3-theme verification pass.
- DATA first: a vortex must exist in the texture. Order: **#5** (native upstreams: NOAA
  `noaa_wind_service.py`, DWD `dwd_wind_service.py`, ECMWF `ecmwf_wind_service.py` — all exist,
  cron-only; wire as the dynamic lane's fallback in viewport_service, per-model) → **#9**
  (base+overlay two-texture engine, marine's BLEND-BOTH pattern — global always resident, fine
  sharpens on top, clamp geometrically impossible) → re-enable the fine tier by default.
- Then the shader levers, calibrated on a real fine dump via `probe_wind_vortex_analyze.js`
  (ready; computes curl-dominance R, exact shipped lifetime/motion/arc arithmetic, and the
  lever deltas): R-gated gamma restore (slow air back to LINEAR truth near cores), R-gated
  persistence, and the already-shipped calm marks. Test at z5.5-8 over the live system, 3 runs,
  both devices, three themes.

## 4. ANTI-REGRESSION PROTOCOL for the fresh context (the pace WITH safety)

1. Hard-reload before judging ANY change (shaders AND React effects are HMR-stale).
2. Never diagnose from a screenshot — diff wind-on vs wind-off (`probe_wind_zoomclamp.js`,
   channel-SUM metric). A dark calm field is eye-invisible and pixel-present.
3. Every lever: kill switch + enumerating gate + suite ×3 + ladder (all zooms in AND out, three
   themes, both devices) + one live eye pass. The ladders take ~10 min; run them.
4. One change-set at a time; commit each with its evidence; push and verify `origin/dev`.
5. If a clamp EVER reappears: check the console for the commitWindData choke log — its
   presence/absence instantly splits "gate blocked it" from "a path bypasses the choke".
6. Absolute paths in background shell commands; watch the cwd.
7. The queue lives in the task list (#5 → #9 → #2 vortex → #8 probe hardening → dark-chroma
   lever from §2 → marine items from §1). Do not reorder #5/#9 ahead of re-enabling the tier.
