# HANDOFF 2026-07-19 (late) — queue #5 + #9 shipped; viewport-fine tier back ON by default

Continues `HANDOFF-2026-07-20-wind-close-marine-lessons-and-forward-plan.md` (§3 order:
#5 → #9 → re-enable tier → vortex levers). Baseline at start: `3e886348` (+docs `6c99356e`).

## 1. Queue #5 — native-upstream background recovery for the wind dynamic lane (`1bf55931`)

`backend/services/weather_pipeline/wind_native_recovery.py`. On a wind dynamic-lane failure
(exception ladder AND negative-cache hit in `viewport_service.py`), the request still serves its
instant stale/coarse fallback, and ONE background task fetches the SAME snapped bbox from the
model's native upstream — the proven bbox-parameterized cron fetchers (GFS→NOAA byte-range GRIB2,
ICON→DWD icosahedral, EURO→ECMWF Open Data) — then persists through the STANDARD pipeline
(`normalize_and_persist_layers` + `bg_process_remaining_hours_helper`), so provider labels, ICON
14d loop-extension stamping and dynamic-index registration are byte-identical. Next client
refetch upgrades from cache.

- Guards (all enumerated in `backend/tests/test_wind_native_viewport_fallback.py`, 8/8 ×3):
  kill `WIND_NATIVE_VIEWPORT_FALLBACK=0` · wind-only · **viewport-scope only** (never build a
  world-span dynamic product — §1.3 span-containment trap) · mapped models only · per-{model,bbox}
  dedup + 600 s cooldown · GLOBAL semaphore 1 (subprocess decodes full-globe GRIB regardless of
  bbox — 512 MB box).
- Env: `WIND_NATIVE_RECOVERY_CONCURRENCY/COOLDOWN_SEC/TIMEOUT_SEC/FORECAST_DAYS`
  (days default GFS 16 / ICON 5+extend / EURO 5-trimmed).
- Serve-path diagnostics: `native_recovery: spawned|none` in fallback grid diagnostics.
- `timeout_sec` pass-through added to the three thin wind service wrappers.
- **Hardening found by test forensics:** `run_fetcher_subprocess` now passes `stdin=DEVNULL`
  (inheriting a redirected stdin fails CreateProcess WinError 50 — pytest capture, daemons).
- **Test-isolation root:** `ProductStore._product_cache` is CLASS-level, filename-keyed — two
  tests persisting the same {model,hour,bbox} cross-serve in-memory products. Clear it per test.
- Evidence: gate 8/8 ×3 · wind+viewport+fetch_common net 98/98 ×3 · weather-pipeline sweep
  117/117. Real-subprocess boundary round-trip proven (stand-in fetcher script through the real
  plumbing); pygrib decode itself is Linux-only (verify on Render/runner after deploy: look for
  `[Wind Native Recovery] Spawned/COMPLETE` in logs when the fine lane rate-limits).

## 2. Queue #9 — BASE+OVERLAY two-texture wind engine (`639d5fce`)

Marine's BLEND-BOTH pattern ported to wind. `_windData` stays the **base** (all probes keep
working); `_windFine` is a resident viewport-fine grid rendered on top.

- **Filing** (`WebGLWindEngine.setWindData`, returns `'base'|'fine'`): a REGIONAL grid arriving
  while a GLOBAL base of the same model+hour is resident files as the overlay — base untouched.
  Anything else takes the legacy replace path; a replaced base drops an incompatible overlay.
  Compatibility = same model (source-first — must agree with the choke) + same hourOffset +
  valid_times within 90 min (the 3-hourly snap). Pure predicates exported for tests.
- **Heatmap**: base pass gains a complementary CUTOUT (fades out exactly where the overlay's
  feather fades in — no compounding-alpha rectangle; skipped for antimeridian-crossing fine
  boxes), then an overlay pass (same program/mesh, fine bounds/texture/decode/feather).
- **ADVECT_FS / DRAW_VS**: mirrored fine-overlay lookup — feather-BLENDED `mix(base, fine, w)`
  so velocity/colour are continuous at the seam; outside the box particles read the base (no
  data edge to fall off — clamp geometrically impossible). ADVECT stays theme-free.
- **Choke** (`WeatherEngine.commitWindData`): guarded pass-through — a non-covering grid of the
  same model+hour as a WORLD-SPAN covering grid commits through (engine files it as overlay).
  All four predicates source-pinned in the gate. Different hour/model still blocks (truth).
- Layer: overlay filings skip particle reseeds; empty-data path routes through
  `engine.clearWindData` (frees BOTH textures); dispose covers `_windFine`.
- Kill: `__RAW_DISABLE_WIND_BASE_OVERLAY__` (live-verified instant + reversible).
  Telemetry: `window.__WIND_FINE_OVERLAY__` (`active/bounds/cols/rows`).
- **Engages only when a regional grid commits over a resident global base** — always-global
  traffic is byte-identical by construction.
- Evidence: `windTwoTexture.test.js` 16/16 · full suite 1273/1273 ×3 · LIVE wire-proof on :3009
  (global 37×17 base → Gulf z6.5 fine 25×29 filed as overlay → pan to Atlantic: base stayed,
  NEW fine box swapped on top, coverage never dropped) · zoomclamp ladder 72/72 tier-OFF
  (grid 37×17 global every step, 0 blank, 0 clamp).

## 3. Viewport-fine tier default ON (this commit)

`backendWeatherServiceClientCoverage.js`: `__RAW_WIND_VIEWPORT_FINE__ !== false` (default ON;
`= false` opts out; `__RAW_DISABLE_WIND_VIEWPORT_FINE__` still hard-disables). The regression
shield test now pins the NEW contract (fine id by default, opt-out restores global bit-exactly).
Evidence: suite 1274/1274 ×3 · tier-ON zoomclamp ladder (see summary.json / session log).

## 4. Queue #2 — R-gated vortex levers (with three base+overlay completions it forced)

**Calibration (instrument-first; the live Gulf held NO vortex that day — analyzer verdict R
inside ≈ ambient):** synthetic both-sides via `probe_wind_vortex_synth.js` → analyzer.
Weak forming low (10 kn Vmax/120 km) annulus R p50 0.39 / p90 0.82 · strong invest (25 kn) core
4.7 · synthetic ambient p99 0.10 · real calm-field noise p90 0.24 · shear line ON-line 2.58
(KNOWN false positive — per-texel curl cannot tell shear from rotation without a ring integral;
linear-truth motion on a real shear feature is the accepted cost). → **gate smoothstep(0.25,
0.8, R)**, R = |curl|·Lcell/(speed+2) from 4 fine-texture taps, scaled by the seam feather fw.

**Levers (ADVECT_FS, fine-overlay branch ONLY — 10° base cells cannot resolve a vortex):**
gamma restore `gammaEff = mix(u_speed_gamma, 1.0, vortexGate)` (slow annulus air back to LINEAR
truth) + persistence `dropRate = max(dropRate*mix(1,0.35,gate), 0.002)` (arcs 2.0% → 5.9% of the
annulus circle per lifetime at annulus-median speed). Kill:
`__RAW_DISABLE_WIND_VORTEX_LEVERS__`. Cell-km carries the box's MEAN cosLat (one convention,
shared with the debug view). Diagnostic: `__GPU_DEBUG__ = {mode:'vortex'}` paints the live gate
as red on the overlay heatmap pass — use this to check gating on a REAL invest when one exists.

**Three completions the probe's failures forced (all live-verified):**
1. **PROMOTE** (`WebGLWindEngine.setWindData` verdict `base_promote`): on a cold enable at fine
   zoom the FINE product lands first and becomes base; a compatible GLOBAL arriving later now
   slides UNDER it (regional base MOVES to the overlay slot, texture preserved) instead of
   replacing the sharper data. Without it the two-texture engine stayed dormant all session.
2. **Explicit-global requests** (`windController._fetchWindDataInner`): a world-span bbox
   (≥350°) keeps its own bbox — the legacy viewport substitution rewrote it to the current
   viewport, which under the fine tier re-clamped to the FINE tile, so the "global base" fetch
   returned the fine product ("Committing GLOBAL base ... 425 vectors" = the smoking log).
3. **Bounded base-lane retry** (WeatherEngine): the cold-start global-base fetch was ONE-SHOT —
   a transient 429 left the session without a base until the 5-min refresh. Now ≤5 re-drives
   through attemptFetch (8 s apart).

**Verification:** `windVortexLevers.test.js` (source pins + NUMERIC CALIBRATION MIRROR of the
synth fields — drift in formula or constants breaks CI) · promote/incompat tests in
windTwoTexture · full suite 1283/1283 ×3 · `probe_wind_vortex_visual.js`: deterministic gate
view red-fraction core 0.243 vs ambient 0.000, behavioral A/B/A normalized 1.01→1.22→1.08
(reversible; lever effect 1.16 — persistence lowers GLOBAL turnover [fewer respawn teleports]
while concentrating annulus activity, exactly the intended read) · zoomclamp ladder (see log).
**Metric lesson:** wind-off-baseline pixel diffs SATURATE (the field wash changes every pixel)
— frame-pair diffs inside one state isolate particles; A/B/A + control-normalization kills the
SwiftShader drift confound that produced one false PASS and one false FAIL first.

## 5. Probe updates

`probe_wind_vortex_dump.js` prefers `_windFine`, parks at z6.5 (z6's 14° span never fires the
tier), and requires containment WITH ≥2° margin (a stale leftover box can contain the centre at
its very edge). `probe_wind_vortex_synth.js` + `probe_wind_vortex_visual.js` new (see §4).

## 5b. USER-CAUGHT mid-gesture clamp + the zoomburst mandate (`48ae0a4b`)

The user saw clamping during zoom in/out ON A BUILD WHERE THREE 72/72 LADDERS HAD JUST PASSED —
the ladder's jump+settle design cannot see mid-gesture states (the time-domain version of "an
average can't find a per-band failure"). **STANDING MANDATE: every wind/marine zoom verification
now includes `probe_wind_zoomburst.js`** — video + ~4/s frame+state pairs during ANIMATED
gestures; structural detector (resident grid exists but covers nothing = the visible rectangle)
vs cold-empty (nothing committed — bounded load window, not a failure); persistent-seam pixel
detector; ZB_PREWAIT_MS=2000 stress + ZB_BLOCK_GLOBAL_MS fault-injection variants.

Root (reproduced frame-for-frame): cold enable at fine zoom → FINE lands first and is the only
resident grid (global lost its race to a 429 storm) → zoom-out shows the box edge mid-gesture.
Fixes: **gesture-start base kick** (zoomstart/dragstart → attemptFetch when the committed grid
is non-world-span; backstop-prefetched global then PROMOTES within a frame) + first base retry
3 s. Post-fix: normal, stress and fault runs all 0 partial-data clamp frames. Fault run also
proved the SERIES lane independently feeds the base (defense in depth). #8 ladder hardening in
the same commit: per-key browsers, blank-leg retry (+ drill switch), real exit code.

## 5c. Light-wind chroma lever (composite-space respread; this commit)

The 07-20 correction upheld: the ≥18° LUT-space pins were PASSING while light's 0 kn and 3 kn
stops composited to the IDENTICAL hue 206° — post-alpha gaps compress ~4×, and the composite
hue only moves if ink CHROMA × ALPHA competes with the basemap's own chroma. Grid-searched
low-band stops (only <6 kn rows changed): LIGHT 0 kn vivid violet [0.50,0,0.70] → composite
233°, 3 kn ultramarine [0.10,0.20,0.68] → 215° (gaps 17.7°/17.7° at the SHIPPED alpha — the
prescribed baseA 0.35→0.42 raise proved unnecessary, so the three-site constant set is
untouched); DARK 0 kn violet [0.55,0.25,1.00] (gap 7.1°→21.4°, visibility delta +14%); BEACH
0 kn saturated rose. New GATE in windFieldLut.test.js pins COMPOSITE-space gaps ≥12° below
21 kn over the measured basemaps (dark 93,117,126 · light 168,214,222 · beach 150,190,200)
with the exact HEATMAP_FS alpha model. Verified: calculator reproduction of the 206°/206°
failure → candidate math → suite 1284/1284 ×3 (incl. casing-contrast auto-adaptation) →
probe_wind_themes A/B all 6 theme×device legs healthy with the new palette live.

## 5d. LATE-SESSION USER BAR (in flight at save time — see the task list + workflow)

The user's live review raised the bar beyond §5c: **"the wind color spectrum isn't wide enough
to show all the slow low level winds — ALL wind must be visible on all three themes."** The
chroma respread fixed hue gaps but the calm-band ALPHA (dark 0.13-0.35 effective below 7 kn) is
the binding constraint — REOPENED as a task. A workflow is deriving: per-theme baseAlpha raises
+ ramp steepening (7 kn → ~5 kn saturation) + wider low-band hue spreads, with composite
visibility floors AND a haze guard; plus an NDBC-buoy truth check of the served Gulf grid (the
user doubts the data — without fine data resident the 10° smear genuinely is not reality), plus
the three-site alpha sync map. ALSO: wide-zoom round 2 shipped in the working tree (DATA NEVER
FADES — round 1's overlay fade erased a live low and the user caught it; edge-dissolve widening
+ persistence-only fade instead), overlay hour-pairing widened ±90→±180 min (hourly base frames
vs 3-hourly fine products dropped the overlay at hours ≡2 mod 3), three-theme zoom series probe
9/9, model sweep (GFS/EURO/ICON) built but NOT yet run. **Everything since `4da586aa` is
UNCOMMITTED at save time** — suite 1287/1287 ×3 green on the working tree.

## 6. FRESH-CONTEXT QUEUE (final audit 2026-07-20 ~03:30Z — numbered, in order)

**State at close:** origin/dev `4b96d036`; suite 1287/1287 (re-verified fresh); prod backend
carries #5 (NDBC truth agent independently confirmed a FRESH fine Gulf product, 357 vectors,
no fallback). Sweeps green: 3 themes × 3 zooms 9/9 · 3 models (GFS/EURO/ICON) × 3 zooms 9/9.
NDBC truth: 38 buoy-grid pairs, median |Δspd| 2.7 kn, median Δdir 16° — the DATA is faithful;
**71% of the Gulf's current wind is below 12 kn** = the band the user says is under-visible.

1. **SLOW-WIND VISIBILITY, all 3 themes (task #8, REOPENED — user bar).** The calm-band ALPHA is
   the binding constraint, not hue. **DESIGN LANDED (workflow wf_1d124923-534, constraint-solved
   in composite space with visibility + saturation floors, monotone wheel, haze ceiling):**
   - **DARK: baseAlpha 0.28→0.44, ramp 7→5 kn** · 0 kn rgb(230,0,255) magenta-violet · 3 kn
     rgb(8,0,255) blue · 6 kn rgb(0,170,255) azure → min composite gap 34.5° (was 18.5),
     visΔ0 26.3 (was 10.4), visΔ3 42.3 (was 16.0). Dark NEEDS the alpha raise (0.28 tops out at
     26.9/14.7). Runner-up 0.40/5 if the user finds 0.44 hazy (31.6/21.0, 73% of haze ceiling).
   - **LIGHT: baseAlpha 0.35→0.42, ramp stays 7** · 0 kn rgb(137,0,235) violet · 3 kn
     rgb(2,0,133) indigo · 6 kn rgb(16,129,198) azure → min gap 21.2°, visΔ 45.1/80.1. Light is
     wheel-budget-bound (~22° max — the 75 kn wrap neighbor caps the calm hue).
   - **BEACH: NO alpha change** · 0 kn rgb(255,82,199) hot pink · 3 kn rgb(239,57,126)
     raspberry · 6 kn rgb(216,135,121) terracotta → min gap 52.8° (was 24.9), visΔ 25.0/42.5.
     Alpha raises evaluated and REJECTED (87-95% of haze ceiling for no gap gain).
   - The 7.0 ramp literal becomes a PER-THEME knot (dark 5, light/beach 7) — synced across
     HEATMAP_FS, DRAW_FS casing fieldA, and the windParticleContrast mirror simultaneously.
   Full metric tables + the constraint model in the workflow output
   (`tasks/w6su1f130.output` + `subagents/workflows/wf_1d124923-534/journal.jsonl`).
   The SYNC MAP (one commit, all sites): WebGLWindShaders HEATMAP_FS L~890-900 baseAlpha trio +
   7.0 ramp · DRAW_FS casing baseA mirror (~L728-734) · windParticleContrast.test.js fieldAlpha
   mirror · windFieldLut.test.js BASE_A maps (×2 tests) · HEATMAP_OPACITY set (engine L~526,
   co-load-bearing) · probe_wind_composite.js. Gate FIRST (visibility floors per stop at the NEW
   alphas), then stops, then 3-theme × 3-model sweep + zoomburst + eyes. Kill-switch the alpha
   change.
2. **Drift bugs found by the sync audit (quick, same commit as #1 or before):**
   probe_wind_composite.js still encodes dark 0.20 + 10 kn ramp (pre-07-19 — misleads any
   rerun); stale comments: WebGLWindShaders DRAW_FS L~720 says smoothstep(0,10) (code is 7.0),
   windParticleContrast L108 "fieldAlpha 0.10" (0.20-era).
3. **Wind global_mid cron tier (~2°) (task #9)** — the structural data-fidelity fix: mirror
   marine's mid_res_tier.py; NOAA-direct fetcher exists; resolver serves global→MID→fine;
   kills the 10° smear whenever the fine lane is cold. This is why the user "doesn't believe"
   the wind at uncovered viewports.
4. **Vortex R-gate window on a REAL invest** — `probe_wind_vortex_dump.js` → analyzer +
   `__GPU_DEBUG__={mode:'vortex'}` over a live system; confirm smoothstep(0.25, 0.8) against
   real-data R before trusting it (synthetic-calibrated only).
5. **Marine zoom-out orchestrator/ARBITER keystone** (07-20 §1.1) — the waves rectangle's true
   root (tiny-tile fade is a render-side mitigation, shipped `4da586aa`); stateful sequence
   harness first, then the commit choke, then default ON.
6. **Deploy watch**: `[Wind Native Recovery]` spawn/COMPLETE logs on Render; recovery
   cooldown/semaphore behavior under real traffic.
7. **Standing protocol for EVERY wind/marine visual change** (memory-mandated): suite ×3 ·
   zoomclamp ladder (alone) · zoomburst storm · 3-theme × 3-model zoom series · eyes on frames.
   DATA NEVER FADES; visibility floors in every palette gate; probes prefer `_windFine`.

1. **Vortex levers on a REAL invest**: when weather provides one, `probe_wind_vortex_dump.js` →
   analyzer on the live system + the `mode:'vortex'` debug view over it; confirm the 0.25–0.8
   window against real-data R, adjust only with evidence.
2. **#8 probe hardening** (blank-leg flake after ~30 GL contexts) — also: ladder runs contend
   badly with concurrent jest/dev-server load on this box (mobile legs took 80 min under load,
   ~15 min clean) — run ladders alone.
3. Light-wind chroma lever (composite-space gate FIRST — see 07-20 handoff §2).
4. Marine debt bank (07-20 handoff §1) — ARBITER Phase C first.
5. Deploy-side verification of #5 once dev merges: watch for `[Wind Native Recovery]` logs.
