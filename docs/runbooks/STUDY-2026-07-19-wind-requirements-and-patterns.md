# WIND — the full requirements & patterns study (2026-07-19)

Compiled from every wind commit (2026-06-01 Stage 3A → HEAD `e5eba029`), the handoffs, and the
user's standing mandates. **Read before ANY wind change. The thrash this arc suffered came from
fixing one requirement while silently violating another — this list is the contract.**

## A. Product requirements (user-stated, binding)

1. **Truth first.** Colour == speed, motion == direction; legibility never trades away data truth
   (gamma damps RELATIVE motion only; the dash narrows, it never lengthens into implied motion).
2. **Three themes × two devices.** Every visual works in dark, light AND beach, on desktop AND
   mobile (DPR 1-3). Physical mark size must match across devices (gl_PointSize is DEVICE px).
3. **Size ordering is monotone in speed.** Slower air must NEVER draw larger than faster air
   (2026-07-19). Speed is read from trail length + motion; the mark may grow with speed only.
4. **Land must show through.** The field is semi-transparent; marks are dashes (area ∝ 1/elong);
   ink is budgeted (ink ~ area × lifetime — pay for size in lifetime).
5. **Direction must read at synoptic zoom** (forming lows) — the oriented dash, not disc growth.
6. **No dead zones where circulation exists** (2026-07-19): near-calm air inside a weather system
   must render as SOMETHING — a spinning low reading as holes is a product failure.
7. **Spectral sensitivity across the common range** (2026-07-19): the 0-21 kn band where most
   weather lives needs many distinguishable hues, not one wash. Beaufort anchoring = a colour
   change means a NAMED sea-state change (Windy/Ventusky convention).
8. **No clamping/clearing across zoom or pan.** Coverage outranks freshness; something covering
   always beats a hole; cold starts paint the cheap global base first, then sharpen.
9. **Every lever kill-switched** for live A/B; every fix carries an enumerating gate test.

## B. The architecture, one paragraph

Data: viewport → `clampViewportBbox` (wind branch: span ≤13° → 1°-snapped padded fine bbox, else
global) → `fetchBackendWindGrid` → backend grid_resolver (manifest global 10° / dynamic 0.25-1°,
self-degrading to stale-coarse under upstream failure, `stale` flag NOW propagated) →
`windController` caches (tileId-keyed, stale-aware TTL, world-grids can't impersonate fine) →
`WeatherEngine` commit policy (fresh-covering > stale-covering > fresh-partial > blank; late
arrivals abort/drop; moveend re-drives on tileId change) → `WebGLWindLayer` (same-model swaps
keep trails) → engine (5 programs compiled ONCE; advect→fade→draw→copy→composite; regional grids
get edge feather ~0.6° absolute + regional respawn).

## C. Traps that keep biting (violating any of these = a regression)

- **Shader edits are inert under HMR** — programs compile once; hard-reload, always.
- **The two shader stages must agree on the size curve** (ADVECT ink mirror vs DRAW size) — the
  density gate pins the literal expressions in BOTH.
- **ADVECT_FS never takes u_theme** — density is physical; themes differ in colour only.
- **A mid-luminance field defeats any fixed rim** — the dual-tone casing chooses its pole from
  the COMPOSITED background (LUT colour × fieldAlpha over basemapY) at linear Y=0.179.
- **Enumerate, never sample** — averages hid per-band failures four separate times.
- **The instrument must see what the user sees** — probes suppress the Tuner AND the Diagnostics
  HUD, re-dismiss the cookie banner pre-screenshot, and diff wind-on vs wind-off pixels.
- **cwd in background shell commands** — absolute paths only; two probe runs died to this.
- **`is_dynamic_viewport_product:true` + a 37×17 grid = the lane tried and FELL BACK** — check
  `fallbackReason` before concluding the tier is broken.
- **A dark-theme calm field is eye-invisible but pixel-present** — do not diagnose "nothing
  renders" from a screenshot; diff it.

## D. The palette split (found 2026-07-19, fix in flight)

Round 3 Beaufort-anchored the PARTICLE LUT (13 stops in knots, WindColorRamp.js) but the
HEATMAP kept its own inline 7-stop ramp keyed to FRACTIONS of the data max — so the field's
colours stretch with whatever max the grid happens to have, the 0-21 kn band collapses into ~1.5
hue bands (the "flat wash"), and the field no longer matches the LUT that the round-6 casing
math assumes it sits on. windParticleContrast.test.js has modelled the field FROM the LUT all
along — the gate was right and the shader wrong. FIX: heatmap samples the same LUT texture
(u_color_ramp), alpha formula unchanged, kill `__RAW_DISABLE_WIND_FIELD_LUT__`.

## E. Backend residuals (approved direction: NOAA)

The dynamic wind lane shares open-meteo's forecast quota (marine's separate marine-api quota is
why marine never hits this), pulls forecast_days=16/request, and rate-limits for long windows —
during which the fine tier degrades to the honest 10° fallback. USER HAS APPROVED wiring
NOAA-direct (`backend/services/noaa_gfs_wind_fetcher.py` exists, quota-free NOMADS) as the
dynamic lane's fallback. Also candidates: a wind `global_mid` cron tier (marine has one,
mid_res_tier.py is marine-only); trimming dynamic forecast_days 16→3.
