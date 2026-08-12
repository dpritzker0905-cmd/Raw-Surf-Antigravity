# CURRENT STATE MATURITY SCORECARD

`dev` @ `3ec3fd13` · 2026-08-12

**Ratings:** Verified Stable · Strong but Incompletely Verified · Active and Unverified · Partial ·
Transitional Dual Path · Regressed · Blocked · Not Started · Unable to Determine

⚠️ **No single percentage is given.** The axes are not commensurable: a projection defect and a
missing recording are both "one open item," and they are not the same kind of risk.

---

## A. Correctness

| Axis | Rating | Decisive evidence |
|---|---|---|
| Unit / direction / grid-orientation correctness | **Verified Stable** | `WeatherNormalizer` is the single authority; sort south→north row-major, ±180 wrap, antimeridian column mirrored |
| Forecast composition (height + quality) | **Verified Stable** | One chain, one write site (`point_surf_augment.py:204`), AST-guarded across 3 rating surfaces |
| Projection | **Verified Stable** | 11.2 certification: exact per-vertex Web Mercator, clamp 85.051129, mid-cell error ≤0.1 km at 0.25°, 0 NaN across 7 geographies — *including a self-refuted false positive* |
| Data-source provenance | **Strong but Incompletely Verified** | Live point payload carries `product_id`, `upstream_provider`, `source_dataset`, `is_estimated`, `geometry_readiness`, `shore_normal_source`, `reference_size_m` |
| **Model-run identity** | **Partial** | Live: `run_time 2026-08-12T12:59:41Z` on an `…20260812T180000Z` product. Provably ingest time |
| **Resolution disclosure** | **Partial** | Live: `resolution: null` on a fully-resolved authoritative native response; the client derives a fallback |
| **Product selection determinism** | **Unable to Determine** | 11.2 RC-03: 0.64/6.8 → 0.44/3.1 → 0.64/6.8 at a fixed coordinate. Not re-measured here |
| Forecast-time correctness | **Partial** | Hour zero has three disagreeing owners; the scrubber label never reads the served frame |
| JS/Python rating parity | **Strong but Incompletely Verified** | Refusal ported (`surfRating.js:116`); the parity gate still passes only 6 of 12 args |

## B. Stability and lifecycle

| Axis | Rating | Evidence |
|---|---|---|
| State ownership | **Strong but Incompletely Verified** | One forecast-hour owner + 6 one-way mirrors |
| Async cancellation | **Verified Stable** | Monotonic request ids + live-target identity + coalesce-hour resolution, verified line-by-line |
| Animation lifecycle | **Strong but Incompletely Verified** | 11.2 Gate 4 **PASS** — *"good, don't refactor it."* One violation remains (`WeatherTelemetry.js:397,399`, no cancel path) |
| GPU lifecycle | **Strong but Incompletely Verified** | Historical concern fixed; the (c) encoder rollback never independently re-verified |
| Worker architecture | **Verified Stable** | `onerror`/`onmessageerror` + re-create on next use |
| Caching / service worker | **Verified Stable** | Model-keyed caches; SW stamp + stale-bundle self-check verified live |
| Remount stability | **Strong but Incompletely Verified** | Deactivation-retain still lacks a reactivation regression test |
| **Memory stability** | **Partial** | Live: `peak_rss 1780.9 MB` of `limit 2048.0 MB` = **87.0%**. OOM *kills* are closed (26, all pre-fix, zero in 10.9 h). *Headroom* is not |

## C. Performance and capacity

| Axis | Rating | Evidence |
|---|---|---|
| Backend latency | **Partial** | Live: `grid_series` p50 **5.0 s**, p99 **31.1 s**, **49 of 133 (36.8%) over 10 s**. Overall p50 250 ms, p99 52.2 s, 72 of 1,481 over 10 s |
| Backend error rate | **Verified Stable** | **0 × 5xx across 1,481 requests**, 47 routes tracked |
| Cold start | **Partial** | `/api/health` itself p99 **15.7 s** — the endpoint an uptime probe would watch |
| Mask classifier cost | **Strong but Incompletely Verified** | Cross-validated: 46.7 ms/call, ~51 ms/s sustained, counter × per-call vs CPU profile agreeing within 11% |
| **Frame rate** | **Unable to Determine** | Unmeasurable in the browser pane (RAF ~1 frame / 5 s). All program FPS readings retracted |
| Capacity headroom | **Partial** | 11.1: the serve box spends essentially its whole memory headroom on a single client settle. 87.0% today is consistent with that |

## D. Testing

| Axis | Rating | Evidence |
|---|---|---|
| Logic / unit coverage | **Verified Stable** | Frontend 209 suites / 1,949 tests; 11.4 ran the full map surface at 1351/1351 across 129 suites |
| Mutation-verified guards | **Verified Stable** | 46/46 guard matrices; and **RV-04 this audit: M8/M9 both caught** |
| Golden / differential estate | **Verified Stable** | 4,320-row goldens byte-current; the arbiter's 3000-fixture differential; the verbatim-old-scan argmin differential |
| **Optical output (executed GL / pixels)** | **Not Started** | The oracle exists at `weather-simulation.spec.js:578` and is `test.fixme` — *"never reds CI"* |
| **Canonical synthetic fields** | **Not Started** | Row reversal / UV flip / handedness unverified **in either direction** |
| **Runtime media evidence** | **Not Started** | 0 videos, 0 screenshots on disk, 0 traces, 0 HARs, 0 heap snapshots, 0 CPU profiles across 4 audits |
| E2E | **Strong but Incompletely Verified** | Green today on push; historically 65% of runs cancelled, fixed at `bed6c08c` |

## E. Observability

| Axis | Rating | Evidence |
|---|---|---|
| Backend request telemetry | **Verified Stable** | Live in production, 47 routes, template-keyed, `MAX_ROUTES=200` not saturated |
| Frontend instrumentation depth | **Verified Stable** | 12-stage truth lineage + `chainCancelled`, FNV hashes, 3 bounded rings, 4-tab HUD via `?diag=1` |
| Truth-layer honesty | **Verified Stable** | All three 11.2 Criticals closed and re-verified at HEAD |
| Release identity in payloads | **Verified Stable** | `build: BUILD_VERSION` on truth + telemetry |
| **Fabricated status surfaces** | **Partial** | 2 of 3 fixed; `system.py:208` `error_rate = 0.5  # Placeholder` still live |
| **Client→server transport** | **Not Started** | One throttled POST is the entire uplink |
| Scheduled-workflow health | **Verified Stable** | **All 14 workflows green** at 2026-08-12, including 8 consecutive self-fired accuracy-monitor crons |

## F. Scientific validity

| Axis | Rating | Evidence |
|---|---|---|
| Observation loop | **Verified Stable** | 60-buoy NDBC residual loop; ledger `scored=919`, 34,841 scored rows this month; the `SCORED_GRACE` clock is **closed** |
| Absolute accuracy | **Active and Unverified** | height MAE 0.176 m (warn 0.30 / red 0.40) — inside bounds |
| **Relative skill** | ⛔ **Regressed as a gate** | **8 of 12 paired head-to-heads read `WE LOSE` while the gate reports `OK`.** vs Open-Meteo at all 3 leads (n≈1,700–1,800); vs persistence at +24 h; vs our own EURO lane at all 3 leads |
| Calibration governance | **Strong but Incompletely Verified** | Census green; registry ratchet built; the bound question is owner-gated. **Never widen** |
| Offshore forecast capability | **Partial** | 9–25 km global wave products with honest snapping provenance; "EURO" resolves to three upstreams |
| Nearshore capability | **Partial** | 6 processes modelled; binding constraint is input coverage, 3rd audit running. Two live residuals: the dual floor (0.1 vs 0.595 in today's payload) and the 2.3–2.7× band/glyph over-read |
| Uncertainty quantification | **Partial** | ECMWF 5-member spread reaches 2 rendering components and **zero of six sim tools** |

## G. Program discipline

| Axis | Rating | Evidence |
|---|---|---|
| Audit evidence completeness | ⛔ **Regressed** | 5 audits, 0 media artifacts, and a directory named `react-scan/` containing a research note |
| Version identity | ⛔ **Regressed** | 3 documents numbered 11.0, 2 numbered 11.2, 0 numbered 11.3 |
| Gate continuity | ⛔ **Regressed** | 11.2 gates 1–8 by domain vs 11.4 gates A–I by dimension; **no gate has a history** |
| Packet freshness | ⛔ **Regressed** | 3 consecutive implementation packets superseded before use |
| Honesty of disclosure | ⭐ **Verified Stable** | Every audit disclosed what it did not run. **The one claim that failed verification here was pessimistic, not optimistic** |
| Self-refutation discipline | ⭐ **Verified Stable** | 11.2 published a CRITICAL and refuted it; retracted every FPS reading program-wide; `ecfc1077` caught its own tautology |
| Working-tree hygiene | **Regressed** | 1 stale worktree at 11.0 → **6** at HEAD |

---

## Summary counts

| | Verified Stable | Strong, Incompletely Verified | Partial | Active & Unverified | Not Started | Regressed | Unable to Determine |
|---|---|---|---|---|---|---|---|
| **n** | 19 | 10 | 11 | 1 | 4 | 5 | 2 |

**The shape of the answer:** the largest cluster is Verified Stable, and every one of the five
Regressed entries is in **program discipline or evidence**, not in the product. **The code is
healthier than the paperwork.** The single product-side red is the accuracy *gate* — not the
accuracy *measurement*, which works fine and is exactly what exposed the problem.
