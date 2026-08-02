# SOTA Architecture Audit & Zero-Regression Upgrade Roadmap

**Date:** 2026-08-01 · **Branch:** `dev` @ `1d269d97` · **Mode:** read-only. No functional code was
altered; this document is the only artifact produced.

**Scope audited:** the marine/wind ingestion lane (`backend/services/*_fetcher.py`,
`_fetch_common.py`), the pipeline core (`backend/services/weather_pipeline/*`, 78 modules), the
nearshore physics (`surf_transform`, `surf_point`, `bathymetry`, `surf_rating`), and the simulation
surface (`weather_sim_mcp`, `sim_*`).

---

## ⚠️ READ THIS FIRST — the brief's own Phase-2 hypothesis is refuted by measurement

The audit brief asks where physics equations "can be compiled or accelerated using JAX / PyTorch /
neural emulators to drastically cut execution time." **Measured on this repo, that would buy
approximately nothing, and it is the single most expensive wrong turn available here.**

| Work per precompute cycle (1,820 spots × 3 models × 2 frames) | Measured cost |
|---|---|
| **All nearshore physics** — `estimate_surf` × 10,920 @ 10.67 µs | **0.117 s** |
| **Product deserialization** — JSON + Pydantic, 23.0 ms per product load | **up to 8.4 min** |
| Cycle wall-clock budget (from `forecast-ingest.yml:36`) | ~65 min core, 165 min timeout |

The physics is **0.003 %** of the cycle. The forecast core is **I/O- and serialization-bound, not
FLOP-bound.** Every acceleration recommendation in this report therefore targets the *data plane*.
A JAX port of `surf_transform` is explicitly **not recommended** and is listed in §3 as a
negative-value change carrying real regression risk.

*Method: `estimate_surf` timed over 20,000 randomized physical inputs; product load timed over 20
iterations of the largest real product on disk (`euro_wind_wind_brazil_east_…`, 5,917 cells,
921 KB). Windows dev box — see the platform caveat in Gap 2.1.*

---

# Section 1 — Core System Architecture Gaps

## 1A. Ingestion & Data Pipeline

### Gap 1.1 — Products persist as JSON Array-of-Structs; there is no array store at all — **HIGH**
`schemas.NormalizedGrid.vectors: List[GridVector]` — every grid cell is a JSON object with 11 keys.

| Measured | Value |
|---|---|
| Bytes per cell | **159.3 B** (vs 24 B as float32) |
| Same product as `.npy` | 139 KB vs 921 KB — **6.6× smaller** |
| `json.loads` + `model_validate` | **23.0 ms** vs `np.load` 0.05 ms — **481× slower** |
| Local product corpus | **781 MB across 6,675 files** |

Worse, the payload is redundant: `lat`/`lng` are stored per cell despite `bounds`+`cols`+`rows`
making them derivable, and `u`/`v` are derivable from `speed`+`direction`. Truly independent data
is ~4 fields; the honest bloat is closer to **10×**.

This is the brief's "NetCDF → Zarr" vector, correctly re-aimed: **you never had NetCDF.** Note the
read side is already modern — `copernicus_global_fetcher.py:5` documents consuming CMEMS's
**map-chunked Zarr** upstream. The gap is entirely on your own persistence layer.

### Gap 1.2 — `manifest.json` is a 6.49 MB single-object registry rewritten on every mutation — **HIGH**
6,671 product entries in one blob, re-serialized and re-uploaded per mutation through a serial
one-thread executor (`store.py:51`), with a remote re-fetch before each upload for reconciliation
(`reconcile_manifest_products_for_upload`). The code itself documents that this is **not
compare-and-swap** (`store.py:161-166`) and that the design forces core+pilot ingestion into one
serial GitHub concurrency group — named in-code as "the root of the pending-run eviction cascade."

### Gap 1.3 — Zero HTTP retry or backoff in all four direct-GRIB fetchers — **HIGH**
Verified across `noaa_gfs_wave_fetcher`, `dwd_gwam_fetcher`, `ecmwf_opendata_fetcher`,
`noaa_gfs_*`: no `HTTPAdapter`, no `urllib3.Retry`, no `tenacity`, no backoff loop. A transient 5xx
or TCP reset on one forecast hour is caught at `noaa_gfs_wave_fetcher.py:366`, **None-filled, and
never retried** — the time axis stays aligned (good) but that hour is permanently empty for the
cycle.

The contrast is sharp and instructive: the *fallback* provider `open_meteo_provider.py:426-443`
implements a full 5-attempt 429 backoff. **The resilience lives on the path you are trying to leave,
not the path you actually run.**

### Gap 1.4 — No connection reuse: a fresh TLS handshake per range request — **MEDIUM**
`grep "requests.Session()" services/` returns **zero hits**. `noaa_gfs_wave_fetcher` issues
1 `.idx` GET + 3 coalesced range GETs per forecast hour × 113 hours ≈ **450 cold connections per
global product**, each paying DNS + TCP + TLS. A module-level `Session` with a pooled
`HTTPAdapter` is a two-line change.

### Gap 1.5 — Silent cycle-staleness in `_pick_cycle` — **MEDIUM**
`noaa_gfs_wave_fetcher.py:163-169`: two `requests.head` calls inside `try: … except Exception:
continue`. A network blip while probing the newest cycle silently falls through to a 6-hours-older
run, and **nothing in the output distinguishes "newest cycle" from "degraded to older."** Same shape
as the recorded provenance class — a number that does not say what it is.

### Gap 1.6 — Fetcher IPC is JSON-over-tempfile through a subprocess — **MEDIUM**
`_fetch_common.run_fetcher_subprocess` spawns `python -OO <fetcher>`, which writes its full decoded
result as JSON to `tempfile.gettempdir()`, which the parent then re-parses. A global coarse marine
product is ~629 cells × 113 steps × 16 series ≈ **1.1 M floats round-tripped as text.** The
subprocess boundary itself is well-justified (GRIB stack isolation, memory ceiling); the
*serialization format across it* is not.

### Gap 1.7 — No backpressure mechanism; rationing is by rotation, and rotation caused a live incident — **MEDIUM**
There is no rate limiter, adaptive throttle, or queue depth control on the direct fetchers.
Load is managed by `WORLDWIDE_REGIONS_PER_CYCLE` rotation, which `noaa_gfs_wave_fetcher.py:218-227`
records as having left `uk_ireland` and `east_australia` on an **18.7-day-old run**, degrading
`uk_ireland` to an 8× coarser grid and pushing `east_australia` onto per-request live upstream
fetches on the 1-CPU serve box. Mitigated by the multi-bbox single-pass port; the underlying
"rationing instead of backpressure" architecture remains.

## 1B. Core Simulation & Compute

### Gap 2.1 — 9 `os.environ.get()` calls inside every `estimate_surf()` — **MEDIUM (correctness-adjacent)**
Instrumented, exact, platform-independent count: **9 flag reads per call**
(`SURF_V3_SHELF_RECAL`, `SURF_SHELF_CF_SCALE`, `SURF_SHELF_KF_FLOOR`, `SURF_BREAK_DEPTH`,
`SURF_V3_SLOPE_GAMMA`, `SURF_V3_KOMAR`, `SURF_V3_JACK_MAX`, `SURF_V3_EXPOSURE`,
`SURF_HEIGHT_H110`), including a `float()` parse of `SURF_SHELF_CF_SCALE` per call.

On this Windows dev box `os.environ.get` costs 828 ns (the `os._Environ` wrapper upper-cases every
key) = **7.45 µs of the 10.67 µs call — 70 %.** ⚠️ **Platform caveat, stated explicitly: production
runs Linux, where the wrapper path is `fsencode` and cheaper. I could not measure Linux here.**
Priced at plain-`dict` speed (60 ns, measured) the flags would still be ~14 % of the call. The
*count* is the finding; the *unit price* needs one measurement on the deploy target.

The real cost is not the microseconds — it is that a per-call environment read makes the physics
**non-deterministic with respect to process environment mutation mid-run**, and defeats any future
vectorization or compilation of this function.

### Gap 2.2 — Only 4 of 78 pipeline modules import numpy — **MEDIUM**
`bathymetry`, `ocean_access`, `shore_normal_fit`, `sim_boot`. The entire composition,
interpolation, rating and transform chain is **pure scalar Python**. Consequences:
- `sampler._find_nearest_vector` (`sampler.py:453`) is an **O(N) linear scan** over every grid
  vector — 5,917 iterations per fallback on a large product.
- `surf_transform_grid` and `rating_transform_grid` are per-cell Python loops invoking the full
  physics chain plus three injected bathymetry closures, each wrapped in its own `try/except`.
- Bilinear interpolation (`sampler.py:225-283`) is scalar, recomputed per point.

### Gap 2.3 — The block-mean fetcher core is a triple-nested Python loop over a regular lattice — **MEDIUM**
`noaa_gfs_wave_fetcher.py:324-361`: `for om in OM_ORDER (12–16) → for rid in regions → for pi in
points`, each iteration slicing a 40×40 native block and reducing it in numpy. For a global product
that is ~**852,000 Python-level calls per cycle**, each doing several small numpy ops — the regime
where numpy overhead dominates numpy benefit.

Because the coarse cells sit on a **regular lattice aligned to the native grid**, this is a pure
block-reduce: one strided `reshape(-1, half*2, -1, half*2).mean(axis=(1,3))` per variable per step
replaces the whole nest. This is the one place where vectorization has a large, real payoff — and
notably it is in **ingestion**, not in the physics the brief pointed at.

### Gap 2.4 — `precompute_spot_ratings` has no CPU parallelism — **MEDIUM**
`spot_ratings.py:493-558` is a single-threaded asyncio loop. `asyncio.Semaphore(8)` bounds
*I/O* concurrency; all CPU work executes on one event-loop thread. No multiprocessing, no compute
thread pool.

### Gap 2.5 — Product-cache thrash from loop ordering — **MEDIUM, cheap to fix**
`_PRODUCT_CACHE_VECTOR_BUDGET = 120,000` vectors (`store.py:279`) holds roughly **20** large
regional products. The precompute iterates `for model → for hour → gather(all spots)`, so the 8
in-flight spots span arbitrary regions and evict each other's products. Sorting spots by
region/tile before the `gather` is a pure-ordering change with no output effect.

### Gap 2.6 — `wavenumber()` returns unconverged results silently — **LOW**
`surf_transform.py:82-95` iterates Newton up to 60 times and returns `k` whether or not it
converged, with no flag. Measured convergence on 10 realistic (Tp, depth) pairs: **mean 4.3
iterations, max 6** — so the loop is healthy today and this is latent, not active.

Closed-form alternatives exist and were validated against this solver: **Guo (2002)**
`kh = y(1−e^{−y^{n/2}})^{−1/n}`, n = 2.4908, matched Newton to a **worst-case 0.72 % relative
error** across Tp 5–22 s, depth 1–463 m. Given §2.1's finding that physics is 0.003 % of the cycle,
this is a **robustness** option, not a performance one.

### Gap 2.7 — `CLAUDE.md`'s indexing note is stale — **LOW (documentation)**
It states `weather_sim_mcp.py` "is height-blind (calculates `quality_score` from wind/swell
alignment/period, ignoring `swell_h`)." That is no longer true: `weather_sim_mcp.py:14` now imports
from `sim_rating`, which delegates to production `compute_surf_rating` + `estimate_surf_at`. A
binding rules file asserting a resolved defect will mislead the next reader.

## 1C. Nearshore Wave & Surf Microphysics

### Gap 3.1 — Runtime bathymetry is ETOPO**1** at 0.25° (27.75 km); the repo already proves 463 m is free — **HIGH — the highest-leverage gap in the system**

| Asset | Source | Resolution | Feeds |
|---|---|---|---|
| `etopo_depth_0p25.npy` | ETOPO1 via ERDDAP, stride 15 | **0.25° ≈ 27.75 km** | `shelf_depth_at`, `is_coastal`, `shelf_width_km`, `shore_normal_at` |
| `etopo_slope_0p1.npy` | ETOPO1 stride 3, max-pooled | 0.1° ≈ 11 km | `bed_slope_at` (breaker type; gated off by default) |
| `shore_normals.json` | **ETOPO 2022 v1 15s, ~463 m** | **463 m** | `shore_normal_asset.shore_normal_at`, `break_depth_at` |

The 15-arc-second path **already exists in this repo, is CC0 public domain, and is already
built in CI** (`build-shore-normals.yml`). It is simply confined to a 45 KB per-spot JSON asset.
Measured coverage of that asset:

- **1,386 of 1,820 spots (76.2 %)** have a fine shore normal; **434 (23.8 %) have none.**
- **1,087 of 1,820 (59.7 %)** have a `break_depth_m`; **40.3 % fall back to legacy behaviour.**
- Fitted spread p50 **11.6°**, p90 **30.2°**, max 40.0° (the gate ceiling).

So: **shelf depth, shelf width, and the coastal gate run on 27.75 km bathymetry at 100 % of spots**,
and the shore normal — which the recorded Jacobian identifies as the dominant sensitivity
(+22.3° ⇒ 6.0 rating points; +45° ⇒ 23.6) — runs on a **±0.75° = ±83 km window** at the 23.8 % of
spots the asset misses. `surf_point.py:79-81` states the consequence in-code: the coarse grid
"decides which way a beach faces from a 7×7 window 194.6 km across, which is why Pipeline and
Sunset both read 0.0 on a coast facing ~325-335."

This is the brief's "does bathymetry resolution match modern sub-kilometre capabilities" question.
Answer: **partially, at 60–76 % of spots, for two of six geometric inputs.**

### Gap 3.2 — Known-missing physics, already measured, correctly not-guessed — **HIGH but well-characterized**
From `validate_nearshore_transform.py` over **385,651 QC-good CDIP swell hours, 10 sites**:
- Refraction `Kr` is **absent** (model assumes 1.0). Measured median **0.797**, range 0.612–1.031 ⇒
  the transform **over-predicts nearshore height ~25 % at the median site.**
- Snell over parallel contours does **not** explain it: predicted span 0.907–0.993, and
  **anti-correlated, r = −0.565.**
- `Kr` swings up to **1.75× at a fixed site** as a function of incoming swell direction — larger
  than Snell's entire between-site range.

⇒ The deficit is **directional and site-specific** (island blocking + 2-D focusing). This is
precisely the shape a **Graph Convolutional Network over the coastal boundary layer** — the brief's
Phase-3 vector — is well-posed for, and it is the one ML recommendation this audit endorses. See
§4 Phase 5.

### Gap 3.3 — Uncached linear scans inside the geometry chain — **LOW**
`resolve_surf_geometry` (`surf_point.py:57`) executes 7 in-function imports per call and invokes
`surf_magnets.shore_normal_override_at` / `magnet_factor_at`, both **uncached linear scans** over
their tables. The bathymetry lookups beneath are `lru_cache`d (200 k entries), and `sim_rating.py:75`
maintains a `_GEOMETRY_CACHE` — but the **reference path** (`spot_ratings` → `point_surf_augment`)
has no such memo, so geometry is re-resolved for every (spot × model × hour). This contradicts the
project mandate's own instruction to "resolve geometry ONCE per coordinate and reuse it across
forecast hours."

### Gap 3.4 — `lru_cache` on functions reading a mutable memory-mapped asset — **LOW, latent**
The five `@lru_cache(maxsize=200_000)` decorators in `bathymetry.py` sit on functions that read
`_grid`, loaded via `np.load(..., mmap_mode="r")`. If the asset is ever refreshed in-process, the
caches will not invalidate. `shore_normal_asset` gets this right and documents it
(`shore_normal_asset.py:149`, "⚠️ INVALIDATES THE MEMOISED LOOKUP, and that is not optional");
`bathymetry.py` has no equivalent.

### Gap 3.5 — GPU texture channels saturate inside the real surf range — **MEDIUM (display precision)**
Recorded and re-confirmed: `WebGLMarineTextureEncoder.js:348-349` encodes `B = height/10.0` and
`A = period/20.0`, so **height saturates above 10 m and period above 20 s** — both routinely
exceeded (Mavericks/Nazaré/Jaws; 22–25 s Pacific groundswell). The scale constants are duplicated
**1 encode ↔ 5 decode across 3 files**, so any ceiling change is a 6-site edit.

### Gap 3.6 — Ring search in `shelf_width_km` iterates the full square and discards ~90 % — **LOW**
`bathymetry.py:191-202`: `for rad in 1..8 → for dr in −rad..rad → for dc in −rad..rad` with
`if max(abs(dr),abs(dc)) != rad: continue`. Iterates ~2,000 cells to visit ~600 ring cells.
Vectorizable to a single masked numpy comparison; low priority because it is `lru_cache`d.

---

# Section 2 — Competitive Advantages & Strengths

**These must be preserved verbatim through any upgrade. Several are better than the SOTA
alternatives the brief proposes replacing them with.**

### 2.1 ⭐ The kill-switch discipline — *this is your zero-regression mechanism; it already exists*
Every physics change in `surf_transform.py` ships behind an env flag whose **default reproduces the
previous behaviour byte-identically**: `SURF_V3_KOMAR`, `SURF_V3_SHELF_RECAL`, `SURF_V3_EXPOSURE`,
`SURF_V3_MAGNETS`, `SURF_V3_SLOPE_GAMMA`, `SURF_BREAK_DEPTH`, `SURF_SHELF_KF_FLOOR`,
`SURF_HEIGHT_H110`. Section 4 does not invent a rollout mechanism — **it reuses this one.**
⚠️ The one thing to fix (Gap 2.1) is *where the flag is read*, never *that it exists*.

### 2.2 ⭐ `validate_nearshore_transform.py` — neither side of the comparison is our model
Scores the transform's **output** against CDIP instruments over 385,651 QC-good hours. Its own
docstring names the trap it was built to avoid: an earlier attempt "fed Komar the same raw Hs the
model uses, i.e. **checked the formula against itself**." This is the only instrument in the repo
that scores physics rather than wiring, and it is genuinely research-grade. **Preserve and extend;
never replace with a self-referential parity check.**

### 2.3 ⭐ Literature-grounded physics with citations at the point of use
`surf_transform.py` cites Galvin 1968, Weggel 1972, Battjes 1974, Komar & Gaughan 1972, Kurian 1987,
Ardhuin 2003, Goda 2010, Harris 2018, Lin 2017, Zhang 2021, Chen 2022 — **at the constants they
justify.** `SHELF_KF_FLOOR = 0.316` is derived in-comment as `sqrt(1 − 0.90)` from Ardhuin's own
~90 % energy-loss ceiling. A neural emulator would replace auditable, citable physics with an
opaque surrogate. **Do not.**

### 2.4 ⭐ The one-composition invariant with an AST-level guard
`test_rating_composition_parity.py` AST-extracts each surface's `compute_surf_rating` call and forces
every surface to declare a position on every optional factor. Backed by the by-name-argument rule
(a positional call once stopped one argument short of `break_depth_m`: Mavericks +62.3, Trestles
−42.5). **This is the guardrail that makes a staged rollout safe at all.**

### 2.5 ⭐ Deliberate, correct NaN handling
`Hs_m != Hs_m` self-inequality guards, chosen because *"NaN passes `not x` AND `x <= 0`"* and an
unguarded NaN scored level `'epic'`. Present at `surf_transform.py:339` and in the partition gates.

### 2.6 ⭐ Honest confidence propagation on direction
`energy_mean_direction_block_partition_conf` computes `conf = R × coverage` rather than bare
resultant length `R`, because a partition existing in 1 of 64 subcells yields `R = 1.00` — a bearing
that "paints ~200 km of ocean with a direction that exists in 2-6 % of it." Measured, correct, and
carried end-to-end into the texture encoder. This is a **more honest uncertainty treatment than most
production wave models expose.**

### 2.7 ⭐ Calibrated thresholds split at natural gaps, not chosen
`PARTITION_MAX_TP_RATIO = 1.10` was placed in a measured distribution gap (noise cases 1.002–1.050;
real cases 1.116–1.330), explicitly replacing a boolean that "read ordinary ties as defects."
`PARTITION_MIN_QUAD_FRAC = 0.5` likewise sits below every measured legitimate deviation.

### 2.8 ⭐ Correct async offloading of blocking I/O
Consistent `asyncio.to_thread(store.load_product / get_manifest)` across `grid_resolver`,
`point_resolution`, `lattice_fill`, `far_edge_hold`, `icon_marine_extension`, `coarse_gulf_fill`.
The event loop is not blocked on disk. Keep.

### 2.9 ⭐ Low-strain ingestion design
Byte-range GRIB selection via `.idx` sidecars fetches ~7 MB of a 11.6 MB file, coalesced into 3
range GETs, one forecast hour resident at a time. CMEMS uses thin full-longitude latitude-band
subsets — **~90× lighter than tiling**, with `dask` deliberately pinned single-threaded to bound
memory. The *strategy* is excellent; only retry/pooling (Gaps 1.3, 1.4) are missing.

### 2.10 ⭐ Time-axis alignment on failure
`noaa_gfs_wave_fetcher.py:366-377` appends `None` for a failed step **across every region**, with an
in-code explanation that skipping would desync arrays from `times` and silently shift every later
value to the wrong timestamp. Correct, and rarer than it should be.

### 2.11 ⭐ Designated-writer gate + manifest reconciliation
`L2_WRITER` gating with in-code forensics of the live incident it prevents, plus
`reconcile_manifest_products_for_upload` with `exclude_keys` to avoid resurrecting pruned entries.
Honestly documented as "**NOT full compare-and-swap**" with its residual race named. Preserve the
honesty along with the code.

### 2.12 ⭐ Regeneratable goldens
`gen_rating_parity_goldens.py` produces 4,320 JS↔Python parity goldens in one command, pops
leaked env flags before generating, and documents its own blind spot (six positional args ⇒
default paths only). A regeneration procedure that lives in a chat log is not a procedure; this one
is a script.

---

# Section 3 — Regression Risk Matrix

Risk is to the **current baseline forecast output** — served surf height, rating score, and level.

| # | Proposed upgrade | Risk | Why | Required automated guardrail |
|---|---|---|---|---|
| **U1** | Hoist the 9 env flags out of `estimate_surf` to module-level constants resolved once at import (Gap 2.1) | **LOW** | Pure evaluation-time move. Only behaviour change: mid-process env mutation stops taking effect — which is *desirable*, and which tests may currently rely on. | Extend `test_surf_v3.py` with an explicit `reload_flags()` hook; assert every flag's ON and OFF branch still reachable. **Golden check: `estimate_surf` output must be bit-identical across 20k randomized inputs before/after.** |
| **U2** | `requests.Session` + `HTTPAdapter(max_retries=Retry(...))` in all 4 direct fetchers (Gaps 1.3, 1.4) | **LOW** | Transport-only; decoded values unchanged. Retries can only *convert a None-filled hour into data*. | Fetcher golden test at fixed cycle: decoded arrays byte-identical. Add a fault-injection test (mock 503 → assert retry → assert non-None). Assert `steps_failed` is **monotonically non-increasing** vs the pre-change baseline. |
| **U3** | Sort spots by region/tile before `gather` in `precompute_spot_ratings` (Gap 2.5) | **LOW** | Ordering-only; each spot's rating is independent. | Assert the precompute frame is **set-equal** to baseline (order-insensitive compare on `spot_id`). Log cache hit-rate before/after as the success metric. |
| **U4** | Vectorized block-reduce replacing the triple loop in the coarse fetchers (Gap 2.3) | **MEDIUM** | Same arithmetic, different float summation order ⇒ last-ULP drift. Edge/pole/wrap and all-NaN degenerate blocks are where reimplementations break. | Existing `test_noaa_wave_blockmean.py` + `test_partition_direction_coverage.py` extended with a **differential test**: old vs new over a real decoded GRIB, `assert allclose(rtol=1e-9)` **plus explicit equality of the NaN/fallback masks**. Must include a **known-degenerate control block** (all-land, all-calm, antimeridian-wrapping). |
| **U5** | Binary array store (`.npy`/Zarr) for grid products, dual-write behind a flag (Gap 1.1) | **MEDIUM-HIGH** | Touches the artifact every consumer reads. `float32` narrowing vs current JSON decimals is a real numeric change. Sparse `None`/`is_valid` semantics must survive the round-trip exactly. | **Shadow-read differential in CI**: load both formats for the same product, assert every field equal within the serialized precision (JSON already rounds to 4 dp — encode `float32` and assert `round(x,4)` equality). Guard `is_valid`, `dir_confidence: None`, and the `phys_speed`-omitted-when-None serializer contract explicitly. Ratchet the **existing composition-suite floor** (`ci.yml:333`, `MIN_FILES, MIN_PASSED = 96, 1090`). |
| **U6** | Manifest sharding / CAS preconditions (Gap 1.2) | **HIGH** | The manifest is the registry every serve path resolves through. A partial write is a live outage; the repo has already logged one clobber incident. | Never migrate in place. **Dual-write shadow manifest** for ≥3 full cycles, with a CI job diffing shard-union vs monolith product-for-product. Keep `L2_WRITER` gating. Cut over only after a clean diff streak, with instant revert. |
| **U7** | Upgrade runtime bathymetry ETOPO1 0.25° → ETOPO 2022 15s (Gap 3.1) | **HIGH — this is a deliberate forecast change, not a refactor** | Changes `shelf_depth_at`, `shelf_width_km`, `is_coastal`, `shore_normal_at` at **every spot**. Recorded precedent: shore normal off by 22.3° median moves **rating LEVEL on 45.8 %** of evaluations. **This will move numbers, and that is the point.** | Treat as a **product event**, not a deploy. Flag `BATHY_ETOPO2022=0` default. Mandatory pre-flip A/B census across all 1,820 spots × 3 models reporting Δheight, Δscore, **% LEVEL change**, and per-region breakdown. Validate against `validate_nearshore_transform.py` — **the new asset must not worsen measured Kr**. Named exemplars (Pipeline, Sunset, Mavericks, Trestles, J-Bay, Salthill) must be inspected individually — the recorded lesson is that *only named exemplars could validate the last curve change*. |
| **U8** | Closed-form Guo (2002) dispersion replacing Newton (Gap 2.6) | **MEDIUM — and not worth it** | 0.72 % worst-case `k` error propagates into `Ks`, `Kf`, and the breaking cap. Buys ~0 wall-clock (physics is 0.003 % of cycle). | If pursued at all: flag-gated, with a differential over the full (Tp, depth) operating envelope asserting Δsurf_height < 0.1 %. **Recommendation: don't. Instead add a converged-flag to the existing Newton loop — same robustness, zero numeric risk.** |
| **U9** | JAX / PyTorch / Numba port of `surf_transform` | **HIGH RISK, NEGATIVE VALUE — do not do this** | Measured ceiling: **0.117 s per cycle.** Would replace auditable cited physics with a compiled surrogate, add a heavyweight dependency to a 512 MB serve box, and introduce float-precision and JIT-warmup variance into the one chain the whole product depends on. | N/A — **rejected on measurement.** Recorded here so it is not re-proposed. |
| **U10** | Neural emulator replacing the physics chain | **UNACCEPTABLE at current state** | You do not yet have the labelled corpus to train or validate one, and it would destroy §2.3's auditability and §2.2's independent-instrument validation. | N/A — rejected. Revisit only after U11 gives a measured residual to learn. |
| **U11** | GCN / learned refraction `Kr` over the coastal boundary layer (Gap 3.2) | **MEDIUM — the one ML vector worth pursuing** | It **adds a currently-absent term** (`Kr = 1.0` today) rather than replacing working physics, so its failure mode is bounded: turn it off and you are exactly where you are now. | Ship as a **multiplicative, flag-gated, `1.0`-defaulted** factor — structurally identical to `magnet_factor`. Train on CDIP; **hold out entire sites, never hours** (adjacent hours are autocorrelated and would leak). Success metric is `validate_nearshore_transform.py`'s measured Kr moving toward 1.0, **not** training loss. |

## Cross-cutting guardrail requirements — non-negotiable, drawn from this repo's own scar tissue

1. **Assert what RAN, not that it was green.** A 12-test guard once landed and the gate still
   reported byte-identical counts — a guard that runs nowhere is indistinguishable from a guard that
   passes. Every new suite must ratchet the **file and test counts** in `ci.yml`, and the counts must
   be **read as numbers**, not as a green check.
2. **Every differential needs a known-failing control.** Five separate confident PASSES in this
   repo's history measured nothing. A differential that cannot go red has not been demonstrated to
   work.
3. **Measure the baseline in a clean `git worktree` at `HEAD`**, never in a shared working tree —
   a concurrent session's mid-edit has already produced one false red.
4. **A flag has a value PER LANE.** `SURF_PARTITIONS`, `RATING_LOCAL_SIZE` etc. must be flipped in
   `forecast-ingest.yml`, `precompute.yml`, **and** Render env together, or the same spot renders two
   different heights. Read the **served payload**, never the local process env.
5. **Grid transforms must assert `len(vectors) == cols * rows` before deploy.**

---

# Section 4 — Incremental "Zero-Regression" Upgrade Path

**Sequencing principle:** *earn the measurement budget before spending it.* Phases 1–2 are pure
mechanism with no output change; they fund the wall-clock and confidence needed for Phases 3–5,
which do change numbers.

### Phase 0 — Instrument before touching anything · ~2 days · **zero risk**
Nothing here changes behaviour; everything here is a prerequisite for claiming any later change was
safe.
- Land a per-stage timing census for one ingest + one precompute cycle: fetch / decode / block-mean
  / normalize / serialize / upload / point-resolve / rate. **Confirm on Linux that
  deserialization dominates and physics does not** — my numbers are Windows-dev.
- Re-measure `os.environ.get` on the deploy target to price Gap 2.1 honestly.
- Add product-cache hit-rate and `steps_failed` to the existing health telemetry.
- **Exit criterion:** a committed baseline profile. Every later phase quotes deltas against it.

### Phase 1 — Free wins, no output change · ~3 days · **LOW risk** — U1, U2, U3
- **U1** hoist flags to module constants + `reload_flags()` test hook.
- **U2** pooled `Session` + `Retry` in all four fetchers.
- **U3** region-sort spots before `gather`.
- **Guardrail:** 20k-input bit-identical golden on `estimate_surf`; order-insensitive frame equality
  on the precompute; fetcher decode goldens.
- **Exit criterion:** all three land with **byte-identical forecast output** and a measured drop in
  `steps_failed` and cycle wall-clock. If output is not identical, stop — something else is wrong.

### Phase 2 — The data plane · ~2–3 weeks · **MEDIUM risk** — U4, U5
This is where the real performance is, and it is all serialization.
1. **U4 first** (contained, one module): vectorized block-reduce behind
   `NOAA_COARSE_BLOCKMEAN_VEC=0`, differential-tested against the existing loop on a real GRIB with
   degenerate controls.
2. **U5 as a parallel shadow pipeline** — the brief's own preferred shape, and the right one here:
   - `PRODUCT_BINARY_WRITE=1` **dual-writes** `.npy`/Zarr alongside every JSON product. JSON stays
     authoritative. Zero read-path risk.
   - CI job loads both and asserts field equality at the 4 dp JSON already rounds to, plus explicit
     `is_valid` / `None` / omitted-`phys_speed` contract checks.
   - Only after a clean streak: `PRODUCT_BINARY_READ=1` flips *reads* on **one non-critical lane**
     (suggest the `mid_res_tier` path), monitored for a full cycle.
   - JSON write is removed **last**, and only after the binary path has served every lane.
- **Exit criterion:** binary reads serving ≥1 lane with identical output and the 481× load
  improvement realized end-to-end. Product corpus should fall from ~781 MB toward ~120 MB.

### Phase 3 — Manifest concurrency · ~2 weeks · **HIGH risk** — U6
Deliberately *after* Phase 2, because a smaller product corpus makes a sharded manifest smaller and
the migration cheaper.
- Dual-write a sharded manifest for ≥3 full cycles with a CI diff job (shard-union vs monolith,
  product-for-product). `L2_WRITER` gating unchanged. Cut over only on a clean diff streak, with
  instant revert.
- **Exit criterion:** core and pilot ingestion can leave the shared serial GitHub concurrency group
  without lost updates — which is the actual business goal behind this phase.

### Phase 4 — Bathymetry resolution · ~3 weeks · **HIGH risk — a product event, not a deploy** — U7
Do **not** start this before Phase 0's baseline and Phase 1's flag hygiene are landed.
1. Build `etopo2022_depth_15s` via the **existing** `build-shore-normals.yml` machinery (the source,
   licence, and ERDDAP access are already proven in-repo). Expect a materially larger asset —
   size/memory budget it against the 512 MB serve box **before** building, and plan for a
   coarsened-but-still-sub-km tier (e.g. 30″) if 15″ does not fit resident.
2. Land it **inert** behind `BATHY_ETOPO2022=0`, wired but unread. Ship the wiring separately from
   the flip.
3. Run the full A/B census: 1,820 spots × 3 models, reporting Δheight, Δscore, **% LEVEL change**,
   per-region breakdown, and the named exemplars individually.
4. Score the new asset with `validate_nearshore_transform.py`. **Gate the flip on measured Kr not
   worsening.**
5. Flip **all three lanes together** (`forecast-ingest.yml`, `precompute.yml`, Render env) as a
   announced product event.
- **Exit criterion:** the 23.8 % of spots with no fine shore normal and the 40.3 % with no break
  depth both shrink materially, with a measured, published rating-level delta.

### Phase 5 — Learned refraction · ~6 weeks · **MEDIUM risk, highest scientific upside** — U11
Only after Phase 4, because `Kr` must be learned against the *best available* geometry or it will
absorb bathymetry error into the model weights.
- Ship as a multiplicative factor defaulting to `1.0`, structurally identical to `magnet_factor` —
  off is exactly today's behaviour.
- Train on CDIP with **site-level hold-out** (never hour-level).
- Success metric is `validate_nearshore_transform.py`'s measured Kr moving toward 1.0 on **held-out
  sites**, not training loss.
- **Exit criterion:** the measured median 0.797 over-prediction narrows on sites the model never saw.

### Explicitly de-scoped, with reasons
- **U9 JAX/Torch/Numba port of the physics** — refuted by measurement (0.117 s/cycle). Rejected.
- **U10 neural emulator of the forecast chain** — no validated corpus; would destroy auditability
  and the independent-instrument check. Rejected at current state.
- **U8 closed-form dispersion** — negligible gain, non-zero numeric risk. Replace with a
  converged-flag on the existing Newton loop instead.

### Suggested near-term backlog additions (small, out of phase order)
Gap 2.7 (stale `CLAUDE.md` note) · Gap 3.3 (memoize `resolve_surf_geometry` on the reference path,
mirroring `sim_rating._GEOMETRY_CACHE` — this also satisfies the project mandate's own
"resolve once per coordinate" rule) · Gap 3.4 (document or wire `bathymetry` cache invalidation) ·
Gap 1.5 (stamp the selected cycle age into the product so a degraded probe is visible).

---

## Assumptions and limits of this audit

- **All timings are from a Windows dev box.** The count-based findings (9 env reads/call, 159.3 B/cell,
  6,671 manifest products, 1,386/1,820 asset coverage, absence of `Session`/`Retry`) are exact and
  platform-independent. The *unit costs* (828 ns env lookup, 23.0 ms product load, 10.67 µs
  `estimate_surf`) need one confirmation run on Linux — that is Phase 0's first task.
- **`~65 min core` is quoted from `forecast-ingest.yml:36`**, not measured by me.
- **No production system was contacted**; no live payloads were fetched. Every number comes from
  reading source, measuring local artifacts, or micro-benchmarking imported functions.
- **The frontend was not audited** beyond confirming the recorded GPU-encoder ceilings (Gap 3.5).
