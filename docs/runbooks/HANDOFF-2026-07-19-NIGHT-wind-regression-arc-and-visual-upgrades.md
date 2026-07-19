# HANDOFF 2026-07-19 NIGHT — the wind regression arc, and the visual upgrades

Commits this arc: `e5eba029` (size monotonicity + the clamp/clear chain) · `a579ed3b` (field
samples the Beaufort LUT + calm marks) · probe threshold fix (with this handoff).
Suite **1256/1256** (×3 at every stage). **READ FIRST:**
`docs/runbooks/STUDY-2026-07-19-wind-requirements-and-patterns.md` — the binding contract
distilled from every wind commit since Stage 3A. The thrash this arc suffered came from fixing
one requirement while silently violating another; the study is the checklist that stops it.

## 1. The user's reports → the roots (all fixed, all kill-switched, all gated)

| report | root(s) | lever |
|---|---|---|
| "slower particles larger than faster" | floor slowness-ramp; v3.21 additive boost; DPR-blind sizeBase (structural on phones) | `__RAW_DISABLE_WIND_SIZE_MONOTONIC__` |
| "clamping/clearing on zoom" | mapper hardcoded `stale:false`; retain policy holding non-covering boxes; cold-enable bare ocean; LATE fine responses committing onto departed viewports (the "moving clamp", caught live by the probe: a z11 2° box committing at z6.8); 18%-of-span feather inside viewport-sized grids | coverage-aware commits + abort superseded + covers-now gate + global-base-first + `u_edge_feather_frac` + request pad |
| "color map needs a longer range of spectrum" | the PALETTE SPLIT: heatmap ran a 7-stop fraction-of-max ramp while particles ran the 13-band Beaufort LUT — the 0-21 kn band collapsed to ~1.5 hues and the field diverged from what the casing math models | `__RAW_DISABLE_WIND_FIELD_LUT__` |
| "particle dead zones under a spinning low" | sub-0.5 kn drew NOTHING; flat-ink recycled calm marks in 0.26 s (flicker reads as emptiness) | `__RAW_DISABLE_WIND_CALM_MARKS__` (0.3-1 kn @2.2px + 25-frame lifetime floor <4.75 kn) |

## 2. Instruments (use these, not eyeballs)

- `scripts/probe_wind_zoomclamp.js` — wind-on/off pixel differential over a 12-step in+out zoom
  ladder, per theme × device, quadrant asymmetry = clamp, per-step collapse = clear. **Metric is
  the SUM of channel deltas (>20)** — a per-channel >10 test sat on the dark calm wash's
  knife-edge (~-8,-9,-10 uniform) and issued phantom CLAMP verdicts on a fully covered screen.
  Verify pixels before believing a verdict either way.
- `scripts/probe_wind_finegrid_visual.js` — injects a synthetic regional grid into the live
  engine (upstream-independent): the tier-request geometry must show NO rectangle.
- `scripts/probe_wind_vortex_dump.js` / `_analyze.js` — engine-grid dump + circulation-candidate
  analysis (curl dominance R), ready for the vortex-lever calibration once fine data is reliable.

Results at close: desktop dark/light/beach + mobile dark/light/beach ladders ALL PASS (72 steps
pre-LUT; post-LUT re-verified after the metric fix). Fine-grid injection: 99.7% coverage, no
rectangle. Size gates enumerate zoom × DPR × speed.

## 3. 🔴 OPEN, in order

1. **NOAA-direct wiring (USER-APPROVED).** The dynamic wind lane shares open-meteo's forecast
   quota (`forecast_days=16`/request) and rate-limits for long windows — every degraded state
   this arc fought traces to that. `backend/services/noaa_gfs_wind_fetcher.py` exists;
   wire it as the viewport_service wind fallback (or add a wind `global_mid` cron tier like
   marine's `mid_res_tier.py`, or cut dynamic forecast_days 16→3).
2. **Vortex levers** (R-gated gamma restore / persistence) — behind reliable fine data; the
   instrument is ready.
3. Dark-theme calm field tint is subtle post-LUT (uniform ~-9 wash). Data-truthful, but if the
   user wants calm structure to pop in dark, raise the dark LUT's calm-stop chroma distance from
   the slate basemap — one ramp edit, the windFieldLut gate pins distinguishability.
4. From earlier: `applyThemeWindScale` legend duplication · marine particle 2-vs-6 theme
   branches · ARBITER Phase C · real-device checks · `__WIND_SERIES__` lane bbox alignment.

## 4. Lessons this arc (they cost hours; don't rebuy them)

- A per-channel diff threshold is an instrument LANDMINE when a uniform low-alpha wash sits at
  its knife-edge — phantom quadrant asymmetry on a fully covered screen.
- A fresh-but-late response is as dangerous as a stale one: commit gates must check the CURRENT
  viewport, and superseded fetches should be aborted at the source.
- The dark-theme calm field is eye-invisible but pixel-present: never diagnose wind rendering
  from a screenshot — diff it against wind-off.
- HMR: shader edits AND React-effect edits both need a hard reload before any live conclusion.
- Background shell commands: absolute paths only (the cwd bit twice).
