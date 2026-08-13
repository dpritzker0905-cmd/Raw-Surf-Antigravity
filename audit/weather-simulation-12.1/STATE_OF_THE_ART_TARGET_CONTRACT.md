# STATE-OF-THE-ART TARGET CONTRACT — Audit 12.1

**What "state of the art" means *for this product*, defined as behaviour and architecture before any
technology is named.** Every row has a measurable acceptance criterion. Where the platform already
meets the criterion, that is stated — this contract is not a wish list.

⚠️ **The central discipline of this document:** three prior audits re-debated *technologies* and none
re-measured the *objectives* behind them. Every row below is written as an outcome. Technology
appears only in the "current best practice" column, and only as a candidate means.

---

## TIER 1 — RELIABLE CORE (Finish Line A)

These are not state-of-the-art claims. They are the price of admission.

| # | Target behaviour | Acceptance criterion | Status |
|---|---|---|---|
| A1 | Source-model identity is traceable | Every served payload names model, provider, upstream model and dataset | ✅ **MET** — verified LV-05/LV-06 |
| A2 | Model initialization time is correct | `run_time` equals a real model cycle; the ingest clock lives in a separate field | ❌ **FAILS** — four tiles share one wall clock to the microsecond (LV-05) |
| A3 | Valid time is correct and echoed | The response states the hour it actually served and the offset from the ask | ✅ **MET** — `served_valid_time` + `frame_offset_hours` (LV-06) |
| A4 | Units and direction conventions are correct | One normalization authority; no per-consumer conversion | ✅ **MET** — `WeatherNormalizer` |
| A5 | Grid orientation is correct | Row order and UV flip verified **in both directions** through the real render path | ⚠️ **UNVERIFIED** — WS-CAN-0028 never run |
| A6 | Projection is correct across supported geographies | Valid values at the antimeridian, high latitude, and both open oceans | ✅ **MET** — LV-05 |
| A7 | Every activated layer paints or refuses | No layer emits transparent tiles without a diagnosable reason | ❌ **FAILS** — every `om://` raster blanks at z2–z3 (WS-CAN-0061) |
| A8 | Scalar and vector layers align with the map | GPU projection authority per vertex | ✅ **MET** |
| A9 | Timeline, model and layer state stay synchronized | One authority per axis; hour-0 has one owner | ⚠️ **PARTIAL** — hour-0 has three owners |
| A10 | Stale async work cannot overwrite current state | Monotonic request ids + live-target guards | ✅ **MET** — verified line-by-line at 11.0 |
| A11 | Resource ownership is explicit | Every RAF, worker and GPU resource has a cancel/dispose path | ❌ **FAILS** — one RAF has none (LV-04) |
| A12 | Remounting does not multiply resources | Bounded churn; identity-guarded clears | ✅ **MET** — WS-CAN-0001 |
| A13 | Cursor, infobox, legend and field agree | Parity check that **refuses** on unsampled | ✅ **MET** — three-state `parityStatus` |
| A14 | Critical failures recover safely | Failure injection demonstrates detect → disclose → recover | ⚠️ **PARTIAL** — disclosure only |
| A15 | Critical regressions have deterministic tests | Every closed Critical has a mutation-proven guard | ⚠️ **PARTIAL** |
| A16 | Memory and requests are bounded | No route above 10 s at the median; peak RSS under an agreed bound | ❌ **FAILS** — one route at ~1 min p50 (LV-07) |
| A17 | A displayed number states how well it is known | Confidence varies with geometry readiness and resolution | ❌ **FAILS** — degraded and full both report `medium` (LV-06) |
| A18 | Users receive the tested artifact | Production build identity within one release of HEAD | ❌ **FAILS** — 85 days behind |

**Tier 1 score: 8 met (A1, A3, A4, A6, A8, A10, A12, A13) · 4 partial (A5, A9, A14, A15) ·
6 failing (A2, A7, A11, A16, A17, A18).**

---

## TIER 2 — STATE-OF-THE-ART CORE (Finish Line B)

| # | Target behaviour | Acceptance criterion | Current best practice (candidate means) | Status |
|---|---|---|---|---|
| B1 | One authority per critical responsibility | Zero rows marked Accidental Duplicate or Bypass | explicit ownership maps, reducer extraction | ⚠️ 3 duplicates + 3 bypasses |
| B2 | Every migration has an exit condition | Each dual path carries a dated arm-or-delete decision | shadow-diverge telemetry, dated flags | ❌ **0 of 3 have one** |
| B3 | Capacity is measured, not guessed | Per-route p50/p99 under sustained load, with a stated envelope | RED/USE method, request telemetry | ⚠️ cumulative telemetry only |
| B4 | Rendering is measurably efficient | Frame-time distribution measurable at all | headed frame harness | ❌ frame rate **unmeasurable** |
| B5 | Observability exposes model, time, cache, worker, renderer, resource state | Client state reaches a server without asking a user | fixed-cardinality client telemetry | ❌ one throttled POST, **and it fabricates a field** |
| B6 | No surface reports a number it did not measure | Zero placeholder constants reach a consumer | measure-or-refuse; null over default | ❌ 2 sites live |
| B7 | Forecast output is objectively validated | A gate that grades paired skill and can page | paired scoring vs persistence + a public reference | ✅ **MET** — certificate issued |
| B8 | Regression protection can actually fail | No test in the estate is structurally unable to fail | mutation testing, pixel oracles in CI | ⚠️ `test.fixme` occupies the pixel slot |
| B9 | A temporal defect can be seen | A failing browser run retains a video artifact | Playwright `video: 'retain-on-failure'` | ❌ **no video key** — blocker just cleared |
| B10 | Major layers behave consistently across models | Same composition per hour regardless of model | one per-hour lane | ⚠️ ICON >168 h dual path |
| B11 | Adverse network and lifecycle conditions are handled | Worker crash, context loss, partial data all recover | explicit lifecycle contracts | ⚠️ partial |
| B12 | New architecture can be shadow-tested and rolled back | Every risky change has a kill switch and a control arm | flags + differential fixtures + A/B | ✅ **MET** — the program's strongest habit |
| B13 | Optimization does not change scientific meaning | A before/after control at identical inputs | byte-diff at fixed `valid_time` | ✅ **MET** — RV-03/RV-06 pattern is exemplary |
| B14 | Data integrity is verifiable end to end | A truncated product cannot register as authoritative | content hashing + Range/length validation | ❌ absent |
| B15 | The platform is maintainable without forensic reconstruction | One register, one gate taxonomy, IDs that persist | ADRs, canonical registers | ⚠️ improving; 6 orphaned findings this cycle |

**Tier 2 score: 3 met (B7, B12, B13) · 6 partial (B1, B3, B8, B10, B11, B15) ·
6 failing (B2, B4, B5, B6, B9, B14).**

---

## TIER 3 — ADVANCED DIFFERENTIATION (Finish Line C)

**None of these is a prerequisite for Tier 1 or Tier 2.** Recording that explicitly is the point of
this tier: three audits' worth of scope expansion came from treating Tier 3 items as blockers.

| # | Capability | Prerequisite | Decision |
|---|---|---|---|
| C1 | Higher-resolution input coverage (0.25° tiles) | cadence measurement | **PROCEED after one measurement** — the largest measured accuracy lever |
| C2 | Tide interaction (`SURF_TIDE_DEPTH`) | break-depth completion + positive control | **OWNER** — ~19× the reach of γ |
| C3 | Local break calibration | a growing observation dataset | DEFER |
| C4 | Forecast bias correction / blending | a validated baseline | **DEFER — blocked at the premise** |
| C5 | Nested coastal grids / SWAN / FVCOM | deterministic selection **and** coverage | **REJECT** (3×) |
| C6 | Learned downscaling / neural emulation / GNN | C4 first | **REJECT / DEFER** (3×) |
| C7 | WebGPU / OffscreenCanvas | a frame harness **and** a measured bottleneck | **DEFER** |
| C8 | Zarr / Kerchunk / COG / Dask | a measured access-latency bottleneck | **REJECT** (3×) |

---

## What the platform is already state of the art at

Recorded so it is not re-litigated:

- **Range-streamed GRIB2 ingestion off `.idx`** — 0.72% of bytes vs 16.83% for the naive path.
- **A single normalization authority** — order, units, ±180 wrap and the antimeridian mirror in one
  place, with no per-consumer conversion anywhere downstream.
- **WebGL2 custom MapLibre layers with exact per-vertex Web Mercator** — ≤ 0.1 km mid-cell error at
  0.25°, correct `85.051129` clamp, world-copy offsets, 0 NaN across 7 geographies.
- **Refusal-over-fabrication as a design principle**, applied at ~8 distinct seams.
- **Release identity end to end** — health SHA, SW stamp, GPU build, truth/telemetry payload stamps.
- **A science registry with a ratchet** — constants cannot drift as bare literals.
- **Kill-switch-and-control-arm discipline** — every risky change ships with a rollback and a
  measurable control. This is genuinely better than industry norm and it is why the program has
  **zero code regressions across three consecutive audits**.

---

## The one honest summary

**The platform's science is stronger than its self-description, and its instruments are now stronger
than both.** Nothing on the Tier 1 failing list is a physics problem. A2, A7, A11, A16, A17 and A18
are, respectively: a field that carries the wrong clock, a string comparison, a missing
`cancelAnimationFrame`, one slow route, a missing disclosure, and one owner decision.

**None of them requires new technology. All of them require finishing.**
