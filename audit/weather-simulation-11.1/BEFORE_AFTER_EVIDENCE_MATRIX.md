# BEFORE-AND-AFTER EVIDENCE MATRIX

Controlled comparisons only. Where conditions could not be matched, the mismatch is disclosed and
the result is classified **Inconclusive**, never "improved".

**Baseline** `c9a0e9fc` (Report 11.0, 2026-08-09) · **Current** `8be9dd56` (2026-08-10 13:32 −0400)

---

## A · SCIENTIFIC BEHAVIOUR — the decisive controlled A/B

**Conditions held identical:** same machine, same interpreter
(`~/AppData/Local/Python/bin/python3.exe`, 3.14), same spot (Pipeline 21.665 / −158.053), same
inputs (Tp 14 s, dir 315°, wind 5 kt / 270°), same call signature, no network. The baseline ran in
an **isolated git worktree** at `c9a0e9fc`; the primary working tree was never modified.

| swell | baseline ft | HEAD ft | baseline score | HEAD score |
|---:|---:|---:|---:|---:|
| 0.5 m | 3.3 | **3.3** | 68.1 | **68.1** |
| 1.0 m | 5.8 | **5.8** | 84.5 | **84.5** |
| 4.0 m | 17.6 | **17.6** | 84.5 | **84.5** |
| 8.0 m | 30.6 | **30.6** | 55.7 | **55.7** |
| 12.0 m | 29.5 | **29.5** | 59.8 | **59.8** |

> **Trend: UNCHANGED. Confidence: HIGH.**
> **103 commits — four of them inside the physics/rating subsystem — moved not one served number.**
> This is the single most important result in the audit: every performance, observability, legend
> and CI change in the window is scientifically inert, which is exactly what the mandate requires.

### A.1 — the documented control itself is stale (pre-existing, not a regression)

`CLAUDE.md` states the sim control as `0.5 → 3.3 ft / 69.7 · 1 → 5.8 / 86.5 · 4 → 17.6 / 86.5 ·
8 → 30.6 / 57.0 · 12 → 29.5 / 61.2`.

**Heights reproduce exactly. Every quality figure is 1.3–2.0 points high, at HEAD *and* at the 11.0
baseline.** `allow_reference_lookup` True/False makes no difference, so it is not the moving size
climatology. The drift therefore predates the 11.0 baseline and is **out of scope for this window's
verdict** — but it is a live landmine: the next reader who runs the control will read a false
regression. Classified **Stale documentation**, and carried into the next packet's non-goals as a
one-line correction.

---

## B · CAPACITY BEHAVIOUR — the decisive controlled A/B

**Conditions:** identical URL (`model=GFS&domain=marine&layer=waves&bbox=-180,-85,180,85&hours=0,3,…,141`),
identical live host, `Accept-Encoding: identity`, plateau verified flat before each treatment.

| | pre-fix `e32342a7` (recorded) | post-fix `0d9149b7` (**claimed**) | **HEAD `8be9dd56` (measured, this audit)** |
|---|---:|---:|---:|
| RSS delta | +170.3 MB | **+0.0 MB** | **+156.7 / +201.6 / +812.8 MB** |
| peak delta | +157.1 MB | **+0.0 MB** | **+0.0 † / +124.1 / +800.2 MB** |
| wire | 6.67 MB | 5.09 MB | 4.33 / 5.20 / 5.05 MB |
| frames | 26 | 35 | 30 / 36 / 35 |
| wall | 29.3 s | 26.3 s | 26.3 / 27.9 / 26.7 s |
| `vectors_before_bound` | ~390,000 | 525,805 | **450,690 / 540,828 / 525,805** |
| `bounded_at` | — | `build` | `build` (all three) |

† +0.0 only because that process's peak (1,737.9 MB) already stood 174 MB **above** the
post-request RSS. **A high-water mark cannot rise past itself.**

**Control that attributes the cost (T-CAP-03, small arm first so the bias runs against the
conclusion):**

| arm | cells/frame | wire | RSS Δ | peak Δ |
|---|---:|---:|---:|---:|
| small bbox (Florida ~5°) | 165 | 1.17 MB | **+5.7 MB** | +0.0 MB |
| global bbox | 966 | 5.05 MB | **+812.8 MB** | **+800.2 MB** |

> **Trend: REGRESSED against the claim; UNCHANGED against reality. Confidence: HIGH.**
> The wire improved ~25 % and latency roughly halved. The resident cost — the quantity the OOM
> arithmetic is made of — did not move.

**Disclosed mismatch:** the T-CAP-03 global arm ran at 3 m 38 s uptime, so an unknown fraction of
+812.8 MB is residual boot prefetch. T-CAP-01 (4 h uptime, 0.0 MB drift over 40 s) and T-CAP-02
(+1.0 MB drift over 213 s) are the figures the finding rests on.

---

## C · SERVING PERFORMANCE

| metric | Report 11.0 | HEAD | trend | confidence |
|---|---|---|---|---|
| `grid_series` p90 | 32 s (live telemetry) | **16.0 s** (n=8) | **Improved** | MEDIUM (small n) |
| `/api/surf-spots` p50 | 26 s (pre-OOM-fix) | **250 ms** (n=25) | **Improved** | MEDIUM |
| 5xx | — | **0 / 404** | Stable | HIGH |
| resident plateau | 1,650–1,706 MB | **1,563.6 MB** @ 4 h | Improved (modest) | HIGH |
| peak % of cgroup cap | ~83 % | **84.9 %** | **Unchanged** | HIGH |

---

## D · TEST / CI BEHAVIOUR

| metric | Report 11.0 | HEAD | trend | confidence |
|---|---|---|---|---|
| frontend suites / tests | 178 / 1,640 (CI note) | **209 / 1,949, all green** | **Improved** | HIGH (independently rerun) |
| backend test files | 475 | 484 | Improved | HIGH |
| backend files selected by *no* CI lane | 340 of 482 (71 %) | reduced — composition lane 49 → **141 files** | **Improved** | HIGH |
| first regression caught by the widened lane | — | `4cb9c3c6` → `c4d1c7f8`, within hours | **Improved** | HIGH |
| E2E completion rate | **26 of 40 CANCELLED (65 %)** | first post-fix run **SUCCESS**; docs commits fire no run | **Improved** | MEDIUM (n = 1, not yet on a code commit) |
| E2E pixel oracle | `test.fixme` | **still `test.fixme`** (+6 `test.skip`) | **Unchanged** | HIGH |
| e2e spec files | 2 | 2 | Unchanged | HIGH |
| CI at HEAD (full-SHA resolved) | all green | **all green** | Stable | HIGH |

---

## E · FORECAST SKILL — paired, at HEAD

Source: Forecast Accuracy Monitor run `31426692621`, 2026-08-10T19:57Z, running against `8be9dd56`.

| paired comparison | n | ours | theirs | Δ | win | verdict |
|---|---:|---:|---:|---:|---:|---|
| vs `open_meteo_marine` +24 h | 790 | 0.201 | **0.151** | +0.050 | 39 % | **WE LOSE** |
| vs `open_meteo_marine` +48 h | 799 | 0.243 | **0.164** | +0.079 | 36 % | **WE LOSE** |
| vs `open_meteo_marine` +72 h | 714 | 0.245 | **0.164** | +0.081 | 37 % | **WE LOSE** |
| vs `persistence` +24 h | 530 | **0.181** | 0.199 | −0.017 | 51 % | we win |
| vs `raw_surf:EURO` +24 h | 658 | 0.185 | **0.172** | +0.013 | 47 % | **WE LOSE** |
| vs `raw_surf:ICON` +24 h | 658 | **0.185** | 0.327 | −0.142 | 75 % | we win |

Gate headline: `height MAE 0.152 m over n=60 buoys` vs `warn 0.30 / red 0.40` → **GREEN**.

> **Trend: UNCHANGED (the losses) / CORRECTED (the persistence claim). Confidence: HIGH.**
> The 08-10 audit's "the forecast is losing to persistence / negative skill" headline is
> **refuted** by the paired control that the very next commit (`60f724d0`) shipped: on the same 530
> buoy-hours we win by 0.017 m. The structural criticism it accompanied — *the gate's population is
> not the product's lane* — **stands unchanged**: a green gate coexists with losing to a free
> competitor at every horizon.

---

## F · LIFECYCLE / RENDER OWNERSHIP — live at HEAD

| quantity | Report 11.0 | HEAD (localhost:3009/map) | trend |
|---|---|---|---|
| WebGL contexts | 1 | **1** | Stable |
| canvases | 1 + fallbacks when tripped | **1** (`maplibregl-canvas`), no fallback canvas | Stable (healthy path) |
| engine inits per boot | 1 (guarded) | **1** (`__MARINE_CHURN__.counts`) | Stable |
| `webglMarineFailed` | — | `false` | Healthy |
| `droppedFrameCounter` | — | 0 | — |
| `activeRafCount` | 3 loops claimed | **1** (engine's own counter, no layer active) | Inconclusive |
| uncancellable FPS rAF loop | present | **present** (`WeatherTelemetry.js:397,399`) | **Unchanged** |

---

## G · VISUAL / ANIMATION BEHAVIOUR

**BLOCKED — no comparison possible.** `document.visibilityState === "hidden"`,
`document.hasFocus() === false`, **0 rAF ticks in 1.5 s**. Every frame-based comparison in this
environment would measure the browser's background throttle rather than the application. No video,
freeze, particle-continuity or projection-by-geography claim is made anywhere in this report. See
`OPEN_EVIDENCE_GAPS.md` G-02.
