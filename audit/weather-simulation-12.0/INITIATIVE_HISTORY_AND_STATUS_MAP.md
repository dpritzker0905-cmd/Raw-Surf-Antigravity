# INITIATIVE HISTORY AND STATUS MAP

`dev` @ `3ec3fd13` · 2026-08-12 · stages per §25 of the Audit 12.0 brief

---

## I-01 · ONE FORECAST COMPOSITION — **Completed / Stabilized**

**First proposed** 2026-07-28 (user mandate, now binding in `CLAUDE.md`).
**Problem:** the spot hub shipped the *offshore* significant wave height as surf height for months —
"2.4 ft" for chest-high surf. Measured offshore-vs-breaking divergence at the same coordinate and
hour ranged **−18.7% (Jeffreys Bay) to +92.7% (Trestles)**, signed both ways, so no constant could
correct it.
**Current authority:** `surf_point.resolve_surf_geometry` → `estimate_surf_at` →
`surf_rating.compute_surf_rating`, with **exactly one production write site** for `surf_height_m`
(`point_surf_augment.py:204`).
**Tests:** AST guard across all three rating surfaces; the sim control (12 m → 29.5 ft) reproduces
digit-for-digit.
**Legacy path:** none. The private physics copy was deleted at `0cae5d74` (2026-07-26).
**Remaining:** none. **Strategically correct: yes — this is the program's foundation.**

---

## I-02 · Refusal-over-fabrication semantics — **Active and Partially Validated**

Geometry refusals, coverage floors, `n ≥ 10` shape-metric refusal, monitor `REFUSE (exit 3) ≠ RED
(exit 1)`, spread refusing below 2 members, no-coverage 404s, `__renderable:false` safe-zero grids
the arbiter refuses as residents.
**Not yet universal:** `conditions.py` returns HTTP 200 with an error body at **9 sites**
(WS-CAN-0009); ICON `swell_2` `/point` still fabricates `200`-with-`0.0`.
**Verdict: keep extending. This is the platform's strongest defence against confidently-wrong
output.**

---

## I-03 · Release identity end to end — **Completed**

Backend `/api/health` embeds the full SHA; `update-sw-version.js` stamps the service worker and
`buildVersion.js`; `marineForensics.js` announces the build and cross-checks for stale bundles; and
since `512b1cb6..9fe18414`, `weatherTruthTracker.js:204` and `WeatherTelemetry.js:282` stamp
`build: BUILD_VERSION` on their payloads.
**Verified live today:** backend `…-69865877`, dev frontend `3ec3fd13` = HEAD.
⚠️ `421b7cf4` (2026-08-12) reveals a residual the initiative had missed: *local* builds were
shipping a 2026-06-05 SHA until a prebuild hook was added. Release identity was correct in CI and
wrong on a developer's machine.

---

## I-04 · Truth-layer honesty — **Completed** *(all three 11.2 "Critical" defects closed)*

| 11.2 finding | State at HEAD |
|---|---|
| RC-01 provenance class is a one-bit function of `isEstimated` | **Closed** — `TruthOverlay.js:274-286`, seven states incl. `NO DATA`, `UNVERIFIED SOURCE`, `RESOLUTION UNKNOWN` |
| RC-02 parity gate cannot distinguish agreement from absence | **Closed** — `forecastDiagnostics.js:288-354`, `parityStatus` / `unsampledReasons` third state |
| the ~10-week orphaned parity read | **Closed** — `forecastDiagnostics.js:48` now reads `webglSourceVectorCount`; history documented in-file at `:15-31` |

**This is the program's fastest and cleanest initiative: found blind on 08-11, closed and
independently re-verified on 08-12.**

---

## I-05 · Model-run identity — **Dual-Path Migration**

**Half shipped:** `grid_series_helper.py:58-63` copies `run_time` / `upstream_provider` /
`estimate_basis` onto frames; `:428-434` adds `run_census` with `mixed_runs`. Audit 11.1 records it
catching a real mixed page in production within hours.
**Half absent:** `run_time` is still the **ingest wall clock**. Proven live today —
`/api/weather/point` returned `run_time: 2026-08-12T12:59:41Z` for product
`gfs_marine_waves_hawaii_20260812T180000Z.json`. *An 18Z cycle cannot exist at 12:59Z.*
`_build_product_filename` (`store_helpers.py:81-86`) still keys `valid_time` only.
**Remaining:** thread `cycle_dt` as `run_time`, keep wall-clock as `ingested_at`, add a run
component to the L1 filename. **(WS-CAN-0005)**

---

## I-06 · The instrument loop — **Active but Unvalidated as a gate**

Built 2026-08-08/09: skill ledger with keep-earliest eviction, accuracy monitor able to go RED,
persistence baseline, request telemetry, non-saturated height anchor.
**Every clock it was waiting on has now closed:** the monitor's cron self-fires (8 consecutive
scheduled successes); `SCORED_GRACE` (08-12T06:00Z) passed with `scored=919`; the calibration census
is green; request telemetry is live in production with 47 routes tracked.
⛔ **And the moment the clocks closed, the instrument produced its verdict: the product loses to a
free public model at all three leads — while the gate reports `OK`.** The loop is complete and its
criterion is wrong. **(WS-CAN-0026 — the authorized mission.)**

---

## I-07 · Ocean-mask cost reduction ("Gate 6") — **Active and Partially Validated**

**Cost model, cross-validated** (`69865877`): 46.7 ms/call (classifier 60%, downsample 25%,
`getImageData` 10%), ~1.1 calls/s static and ~2.0/s panning, ~51 ms/s sustained — counter × per-call
agreeing with CPU-profile self-time to within 11%, production and local agreeing to within 11%.
**Two levers:** the verdict cache (`e6033e2b`, 88% static hit / 21% panning, live A/B with a 0%
control arm) — **shipped, correct, and now provably guarded** (RV-04); and the settle debounce
(`85e3f1fb`, ~27% of panning classifier cost) — **deliberately default-OFF.**
⚠️ The debounce is a *visible-behaviour* change behind a perf flag: a deferral leaves the mask
un-suppressed for that frame. Its author's stop condition — a human must watch a pan — is correct.
**Do not promote it without that.**
⭐ The handoff carries **six retractions**, five from the same move: reporting what a neighbouring
artifact implied instead of measuring the thing. The three figures that survived were all predicted
first, then observed.

---

## I-08 · Single animation / RAF authority — **Dual-Path**

Historical belief *"multiple competing RAF hooks"* was corrected by 11.0 to 3–4 concurrent loops
with **exactly one violation**: `WeatherTelemetry.js:397,399` calls `requestAnimationFrame(loop)`
with **zero `cancelAnimationFrame` anywhere in the file** — a module-import side effect that runs on
every screen of the app forever. Still open at HEAD. **(WS-CAN-0022)**

---

## I-09 · Commit-arbiter consolidation — **Prototype, shipping dark**

`arbiterDecide` is the pure, `window`-free, **3000-fixture differential-tested** extraction that
should replace the 19-if / 8-bypass-gate guard chain. It ships behind `__RAW_MARINE_ARBITER__`
while the branch-heavy chain remains live. A shadow divergence ring exists.
**Next step is a measurement, not a flip:** read `arb_shadow_diverge` first. **(WS-CAN-0043,
Benchmark First.)**

---

## I-10 · Executed-GL / pixel testing — **Prototype, unreachable by CI**

`ece2c36a` shipped a real `readPixels` oracle at
`frontend/e2e/weather-simulation.spec.js:541-578` plus `pngPixels.js`. Line 578 is
**`test.fixme(...)`**, with an in-file comment: *"ships as DOCUMENTED WORK-IN-PROGRESS, never reds
CI."* One `test.fixme` against five live `test(` calls in that file.
⚠️ This is the program's own catalogued trap — a `grep "^\s*test("` census misses `test.fixme(`
entirely. **Complete or delete; a test that cannot fail occupies the slot of one that could.**
**(WS-CAN-0018 / 0019)**

---

## I-11 · Client→server telemetry uplink — **Designed, not built**

The frontend has 474 `window.__*` globals, three bounded rings, lineage hashing and a build
self-check. The **only** client→server transport in the entire system is `TruthOverlay.js:141`, a
60 s-throttled truth-violation POST. Both halves of a real uplink already exist
(`getDiagnosticReport()` / `forensicSummary()` client-side; the route and the `request_telemetry`
aggregation pattern server-side).
**Every hard frontend incident in the runbooks was diagnosed by asking a user to paste console
output.** **(WS-CAN-0020)**

---

## I-12 · Frame-rate measurement — **Wrong Direction, corrected**

Audit 11.2 discovered that `requestAnimationFrame` delivers ~1 frame per 5 s in an unfocused browser
pane and **retracted every FPS reading in the program.** That was the right call and it is why no
GPU-modernization decision can currently be graded.
**Successor:** a headed Playwright frame harness with a visible viewport — the 4 browser projects
already exist in the config. **(WS-CAN-0037, blocked on WS-CAN-0027.)**

---

## I-13 · GPU projection authority / antimeridian — **Active and Fully Validated**

Exact Web Mercator per-vertex transform with the correct `85.051129` clamp; mid-cell interpolation
error ≤ 0.1 km at 0.25° and ≤ 3.9 km at 2°; bearing 45 and pitch 45 both preserve max = 2.571
exactly; 0 NaN across 7 geographies.
⭐ **11.2 published `G2-01` as CRITICAL — *"the marine field does not render at the antimeridian"* —
and then refuted it itself.** The blank screenshot was a settle-time artifact (blank at 10 s,
painted by 20 s); `__RAW_GPU__.wrapCull` reads `needWrap=true` at 179.6°E exactly as designed. The
superseded text is preserved in the gate matrix rather than deleted.
**The lesson, now a program rule: a blank screenshot is a READINESS question. Compare time-to-paint,
never rendered-vs-blank.**
**Residual:** synthetic canonical fields (uniform E/W/N/S, vortex, checkerboard) have never been run
through the real render path, so row reversal / UV flip / handedness are unverified **in either
direction**. The session that scoped it called this *"the largest true unknown in the system."*
**(WS-CAN-0028)**

---

## I-14 · Data / numerical / nearshore modernization — **Superseded, priced and rejected 3× each**

Zarr / Kerchunk / COG / Dask · JAX / CuPy / GPU / Numba · SWAN / FVCOM / GNN / nested grids / AMR ·
KD-trees for the wind lookup · closed-form dispersion · finer bathymetry as an accuracy lever.
Load-bearing premises re-verified at 11.0: **4 s CPU global forecast**; Range-streamed ingestion;
0.72% vs 16.83%.
⭐ **The crosswalk preserves the objective, not the technology.** "Add Zarr" was never the task —
*"reduce forecast-data access latency"* was. That objective survives, and the measured latency root
is `grid_series` composition, not the storage format.
**(WS-CAN-0046 / 0047 / 0048 — Reject.)**

---

## I-15 · Nearshore physics — **Active and Partially Validated**

Six processes genuinely modelled: shoaling, refraction (`REFRACTION_KR = 0.797`), depth-limited
breaking (γ = 0.81), the H1/10 convention, exposure, and the tide waiver.
**The height pair shipped 2026-08-05** — γ → 0.81 + `REFRACTION_KR` + `SURF_HEIGHT_H110` ON, with a
control: legacy-restore must give Pipeline 45.52 ft, shipped gives 29.50 ft.
**Binding constraint is input coverage, not physics** — 0.25° tile availability, break depth, shore
normals — the same conclusion for the **third audit running**. γ binds on only 0.145% of served
spot-hours; tide has ~19× the reach.
⚠️ **Two live scientific residuals**, both visible in today's production point payload:
`directional_conflict` shows the **dual floor** (`quality_exposure: 0.1` vs
`height_exposure_factor: 0.595`), and the close-zoom rating band still over-reads the spot glyph by
**2.3–2.7×** with the binding sub-term not yet isolated. **Do not tune either lane first.**
**(WS-CAN-0024)**
