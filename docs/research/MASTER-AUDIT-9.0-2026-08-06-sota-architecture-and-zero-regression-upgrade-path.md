# MASTER AUDIT 9.0 — 2026-08-06 · SOTA architecture audit & safe upgrade assessment

**Read-only.** No functional code was altered. Every number below was measured this session at
`f7a63d84` with `~/AppData/Local/Python/bin/python3.exe`; benchmark scripts live in the session
scratchpad and touch nothing in the tree.

Predecessors: `MASTER-AUDIT-8.0` (two hypotheses killed) · `7.0` (SOTA compared) · `6.0`.

---

## §0 THE HEADLINE — TWO OF THE BRIEF'S THREE UPGRADE VECTORS DO NOT SURVIVE MEASUREMENT

The audit brief asked for three SOTA vectors: **Zarr streaming**, **JAX/GPU-accelerated physics**,
and **GCN/nested nearshore grids**. Measured against this codebase:

| brief's vector | verdict | the measurement that decided it |
|---|---|---|
| JAX / neural emulator for the physics | ⛔ **NO HEADROOM** | the entire forecast chain for **779 spots × 168 hours = 1.24 s of CPU**. There is nothing to accelerate. |
| Zarr / cloud-optimized ingestion | ⚠️ **ALREADY BUILT — in the wrong place** | GRIB2 already streams via **HTTP Range requests off `.idx`** (~7 MB/step, not the whole file). The uncompressed-row-object problem is **downstream**, in the product store. |
| GCN / nested nearshore grids | ⚠️ **PREMATURE** | the nearshore inputs are not resolution-limited, they are **provenance-broken**: 57.7% of bed slopes are flatter than any real beach and 18.5% are outside their own formula's published validity range. A finer grid over a mislabelled quantity buys nothing. |

**The one real acceleration target the brief did not name:** a per-point Python loop in the GRIB
regrid. Measured **27.1× speedup, bit-identical output** (max |diff| 8.9e-16, NaN agreement
3000/3000), pure numpy, no new dependency. ~204 s saved per ingest run.

★ This repeats the lesson of Audit 8.0 (`"higher resolution" is a hypothesis, never a reason`) and
of the Vercel finding (`when a gate ANDs several conditions, measure every term before fixing one`):
**price the upgrade against the thing it would replace, before writing it.**

---

## SECTION 1 — CORE SYSTEM ARCHITECTURE GAPS

### 1.1 ⛔ HIGH — Synchronous HTTP on the async event loop, on the hot serving path

`routes/weather.py:450`, inside `async def get_spot_ratings`:

```
pre, pre_source, pre_served = select_precomputed_laddered(
    load_spot_ratings_l2_cached(), (w, s, e, n), model, valid_time)
```

`load_spot_ratings_l2_cached()` is a **synchronous** `requests.get()` to Supabase Storage with
`timeout=10` (`spot_ratings.py:492`), awaited by nothing and never wrapped in `to_thread`. Its TTL
is 300 s, so **once every 5 minutes the map-glyph endpoint blocks the entire worker's event loop**
for a full Supabase round trip — up to the 10 s timeout on a bad one. Every other in-flight request
on that worker stalls behind it.

The repo already knows the fix: **92 `to_thread`/`run_in_executor` sites** exist elsewhere. This one
was missed. Three sibling modules have the same shape (`buoy_calibration.py`,
`report_calibration.py`, `forecast_skill.py`), though those are cron-side and therefore harmless.

### 1.2 ⛔ HIGH — Every gridded product is JSON text over row-objects (the measured OOM root)

`store.py` documents the symptom in its own comments: a `global_mid` product is ~15,000 vectors
≈ 12 MB parsed, and **128 of them ≈ 1.5–1.9 GB — the exact resident plateau before all 29
`oomKilled` events on 2026-07-05.** `PRODUCT_CACHE_VECTOR_BUDGET=120000` exists solely to contain
this.

Measured independently this session at N = 15,000 vectors — and it reproduces store.py's figure:

| representation | wire | resident | bytes/vector | decode |
|---|---|---|---|---|
| JSON → `List[GridVector]` pydantic | 2.09 MB | **10.32 MB** | **688** | **64.9 ms** |
| JSON gzip -6 | 0.22 MB | — | — | — |
| numpy structured array / `.npy` | **0.38 MB** | **0.38 MB** | **25** | **4.9 ms** |
| **ratio** | **5.6×** | **27.5×** | **27.5×** | **13×** |

The cache budget in these units: 120,000 vectors = **83 MB as pydantic** (8 products) vs **3 MB as
numpy**. The same budget would hold **28× more**.

★ **The OOM root is the REPRESENTATION, not the data volume.** 2.09 MB of JSON inflating to 10.32 MB
resident is a 4.9× amplification that buys nothing — the payload is homogeneous numeric columns
being stored as heterogeneous Python objects.

⚠️ Nothing is gzipped at rest or in transit in this path, and `json` is used rather than `orjson`.

### 1.3 ⚠️ MEDIUM — Zero connection reuse in every GRIB2 fetcher

`requests.Session()` count across `noaa_gfs_wave`, `noaa_gfs_wind`, `noaa_gfs_pressure`,
`dwd_gwam`, `dwd_icon_wind`, `dwd_icon_pressure`, `ecmwf_opendata`: **0**. Every call is a bare
module-level `requests.get`/`.head` — a fresh TCP + TLS handshake each time. Each forecast step
makes 4 (one `.idx` GET + three coalesced range GETs).

Measured against the real upstream (`nomads.ncep.noaa.gov`, n=6 after DNS warm):

```
bare requests.head  : 480.6 ms/call
pooled Session.head : 134.1 ms/call
saving              : 346.5 ms/call  (3.6x)  ->  1.39 s per forecast step
```

A 14-day run is `range(0, 337, 3)` = **113 steps** ⇒ **~157 s wasted per run** on handshakes alone.
One line of code.

### 1.4 ⚠️ MEDIUM — The ingest step loop is serial, and the deadline has almost no headroom

`noaa_gfs_wave_fetcher.py:307` iterates `for f in f_hours:` strictly serially, each step a blocking
`requests.get`. At the 2026-08-02 observed rate (14–17 s/step) a 113-step run is **~1,751 s against
a `NOAA_FETCH_BUDGET_S=2400` soft deadline — 27% headroom.**

That is precisely why the 08-02 incident happened: upstream merely *slowed* (8.8 → 14–17 s/step) and
the ceiling ran out. The steps are independent HTTP fetches; nothing about them requires serialism.

Budget arithmetic for one run, combining §1.3, §1.4 and §2.2:

| change | run time | headroom vs 2400 s |
|---|---|---|
| today | ~1,751 s | 27% |
| + connection reuse (§1.3) | ~1,594 s | 34% |
| + vectorized regrid (§2.2) | ~1,390 s | 42% |
| + step concurrency 4 (§1.4) | **~410 s** | **83%** |

### 1.5 ⚠️ MEDIUM — Deep nested loops concentrated in ingestion, unmeasured

AST scan (not grep — a `for` grep cannot tell a nest from two siblings) across 212 modules:
**225 nests in 71 files, 60 of depth ≥ 3.** The deepest are all ingestion:
`dwd_gwam_fetcher.py` (depth 5, 51 subscripts), `noaa_gfs_wave_fetcher.py` (depth 4, 58),
`noaa_gfs_wind_fetcher.py` (depth 4, 36), `dwd_icon_wind_fetcher.py` (depth 4, 35).

Only §2.2 has been priced. The other three lanes share the same shape and are very likely to carry
the same 27× — but that is a hypothesis, and this audit does not promote hypotheses.

### 1.6 ℹ️ LOW — `shelf_width_km` is an uncached triple-nested ring scan

`bathymetry.py:191-205`: up to 8 rings × per-cell scalar `int(grid[rr, cc])` on a memmap ≈ 289
element accesses. It *is* `lru_cache(200_000)`-wrapped so warm cost is ~0, but the cold path is the
slowest single geometry lookup and it is the only one written as element-at-a-time indexing rather
than a slice. Cosmetic today (see §2.1); worth noting only because it is the pattern of §2.2 in
miniature.

---

## SECTION 2 — COMPETITIVE ADVANTAGES & STRENGTHS (preserve these through any upgrade)

### 2.1 ★★★★ The physics chain is fast, correct, and singular — **do not touch it**

Measured end-to-end at HEAD:

| stage | cost |
|---|---|
| `resolve_surf_geometry` — cold (first call, loads assets) | 117 ms once, then 0.54 ms |
| `resolve_surf_geometry` — warm | **0.0101 ms** (min 0.0097 / max 0.0107) |
| `estimate_surf_at` with geometry reused | **9.4 µs/call** |
| `estimate_surf_at` re-resolving geometry | 21.1 µs/call |
| one spot × 168 forecast hours, geometry reused | **1.59 ms** |
| **779 served spots × 168 hours** | **1.24 s of CPU, total** |

**There is no CPU-bound physics on the serving path.** The AST scan confirms it structurally: of 225
nests, the only serving-path hits are `bathymetry.py` (lru_cached, 10 µs warm) and
`spot_ratings.py:615` — which is `asyncio.gather`, an I/O fan-out, not compute.

The measured 7.5–8.6 s/req live rating cost quoted throughout `routes/weather.py` is therefore
**~100% upstream I/O**. Any proposal to accelerate the *math* is optimizing 0.07% of the request.

### 2.2 ★★★ The ingestion architecture is already cloud-optimized where it counts

`noaa_gfs_wave_fetcher.py` fetches GRIB2 by parsing the sidecar `.idx`, selecting the 12 wave
messages it needs, and **coalescing them into 3 contiguous HTTP Range GETs (~7 MB)** instead of
downloading the step file. That is the same byte-range primitive Zarr and COG are built on. The
brief's "migrate to chunked cloud-optimized formats" is, for this lane, **already done**.

### 2.3 ★★★ The soft-deadline salvage pattern

`noaa_gfs_wave_fetcher.py:293-315` — after the 08-02 loss of a whole lane to an all-or-nothing hard
kill, the fetcher now owns an *internal* budget: hours are fetched **ascending** so truncation drops
the far tail and keeps near-term surf, the `times`/series alignment invariant is maintained across
the break, and `NOAA_FETCH_BUDGET_S=0` restores legacy behaviour. **A deadline that can salvage
beats one that can only kill.** This pattern should be copied to the other three GRIB lanes.

### 2.4 ★★★★ ONE FORECAST COMPOSITION actually holds at HEAD

`sim_rating.py:30` imports `estimate_surf_at, resolve_surf_geometry` from `surf_point` and
`surf_rating` at :37-41. The sim is a **consumer**, not a second implementation. Verified by import
graph, and pinned by four named guards, all present: `test_rating_composition_parity.py`,
`test_surf_point_parity.py`, `test_science_registry.py`,
`test_sim_every_surface_reads_the_served_curve.py`. Total suite: **450 test files.**

### 2.5 ★★★ `science_registry.py` — constants that carry their own provenance and validity

Every physics constant is declared with `value`, `units`, `source` (literature citation) and a
validity range, guarded by `test_science_registry.py`. This is how §3.3's finding was even
*possible* to make: the registry declares `WEGGEL_SLOPE_VALIDITY_HI = 0.07`, so the asset feeding
that formula could be checked against it. **Constants that state their own range let you audit the
data.** Add new constants here, never as bare literals.

### 2.6 ★★★ Refusal semantics — `None` is not `0.0`

`wave_physics.steepness()` returns `None`, never `0.0` or `inf`, for absent input, so a caller
cannot mistake "not sampled" for "perfectly flat". The breaking-limit check is a **physical law
(Michell 1893, H/L > 1/7)**, not a tuned range — it needs no calibration, cannot drift, and cannot
be satisfied by a plausible wrong number. This is the correct shape for a data guard.

### 2.7 ★★ Fail-open contracts and universal kill switches

`resolve_surf_geometry` lets the three **base** bathymetry lookups raise (no honest estimate exists
without them) and individually swallows the four **enrichment** lookups. Every physics change ships
with a documented kill switch (`SURF_GAMMA_FIELD_CEILING`, `SURF_REFRACTION_KR`,
`MARINE_PHYSICS_VALIDITY`, `SURF_V3_SLOPE_GAMMA`, `NOAA_FETCH_BUDGET_S`, …). Backpressure exists:
**8 `asyncio.Semaphore` sites** plus the vector-weighted cache budget.

---

## SECTION 3 — NEARSHORE FINDINGS (Phase 3) AND THE REGRESSION RISK MATRIX

### 3.1 What is actually implemented

Shoaling (linear-theory `Ks`), depth-limited breaking with a **period-dependent** γ (Carini et al.
2021 field values, 0.63–0.81), bottom friction (`shelf_dissipation`, on by default), refraction
(`REFRACTION_KR = 0.797`), directional exposure, sub-grid magnets, and Iribarren breaker type
(built, gated off). The bathymetry ladder:

| input | asset | resolution |
|---|---|---|
| shelf depth / coastal / shelf width | `etopo_depth_0p25.npy` (2.0 MB) | 0.25° ≈ **28 km** |
| shore normal + break depth | `shore_normals.json` (ETOPO 2022 15s) | **~463 m** ✅ sub-km |
| bed slope | `etopo_slope_0p1.npy` (**12.96 MB**) | 0.1° ≈ **11 km** |

### 3.2 ⛔ The bed-slope asset is a category error — measured, n = 1386

`bathymetry.py:27-29` refuses to derive slope from the 0.25° grid, and states why: *"a 28 km
baseline slope is shelf-scale, not the surf-zone beach slope the Iribarren needs, and would
systematically misclassify breaker type."* **The asset it uses instead is 0.1° = 11 km — the same
defect in kind, 2.5× less bad.** Its own meta confirms it: `|grad(depth)| max-pooled to 0.1°`.

Population over every coordinate in `shore_normals.json`:

```
p50 0.0074   p90 0.1348   p95 0.2039   max 0.3426
flatter than 0.01 (flatter than any real surf beach) : 57.7%
above WEGGEL_SLOPE_VALIDITY_HI = 0.07                : 18.5%
```

Only **~24% falls in the plausible surf-zone band (0.01–0.07)**. Nearly one coordinate in five is
outside the published validity range of the formula consuming it — a range this repo's own
`science_registry.py` declares. This corroborates, at population scale, the per-spot record
(3.3× too steep at Pipeline, 28× too flat at Nazaré).

⚠️ Two stale statements at HEAD, both refuted by execution: the docstring's *"Absent by default →
`bed_slope_at` returns None"* is **false** — the asset is bundled and answered at **1386 of 1386**.

### 3.3 ⭐⭐⭐ NEW — the slope term is inert **by PERIOD**, not by slope

The record held that the slope term went inert above m ≈ 0.0039. The operative axis is different and
sharper. Measured, 1386 coords × 6 periods, `breaker_index(Tp, slope)` vs `breaker_index(Tp, None)`:

| Tp (s) | γ no-slope | coords moved | max \|Δγ\| |
|---|---|---|---|
| 6.0 | 0.6585 | **100.0%** | 0.1515 |
| 8.0 | 0.7125 | **100.0%** | 0.0975 |
| 10.5 | 0.7800 | **100.0%** | 0.0300 |
| 13.0 | 0.8100 | **0.0%** | 0.0000 |
| 16.0 | 0.8100 | **0.0%** | 0.0000 |
| 20.0 | 0.8100 | **0.0%** | 0.0000 |

**Control (causation, not correlation):** with `SURF_GAMMA_FIELD_CEILING=0` (legacy ceilings) the
slope moved γ in **8316 of 8316 = 100%** of cases at *every* period. So the 2026-08-05 γ ceiling drop
to 0.81 is what killed it — and it killed it **exactly in the groundswell regime (Tp ≥ 13 s) that
surf forecasting cares most about**, while leaving it fully live for short-period windchop.

The asset's other consumer, `iribarren → breaker_xi`, is gated `RATING_BREAKER_TYPE` **default
`"0"`** in `rate_one_spot`, so it reaches **0 served spots**. A 12.96 MB asset, bundled since
2026-06-29, whose two consumers are respectively switched off and ceiling-saturated where it matters.

### 3.4 ⚠️ Geometry coverage gaps

```
shore_normals.json : 1386 entries of 1820 considered = 76.2% gate pass
  with a nearshore break depth            : 1087 (78.4%)
  WITHOUT (depth-limited cap has no input):  299 (21.6%)
estimator self-measured spread: p50 11.6 deg, p90 30.2 deg, gate max 40 deg
break depth: p10 4.8 m, p50 11.1 m, p90 55.5 m, max 1004.0 m
```

**`max = 1004 m` is not a break depth.** γ·1004 ≈ 813 m of wave — inert, never binding, but it is
"no cap" wearing a depth's name. The p90 of 55.5 m is likewise far outside any surf break.
21.6% of the asset's own entries give the depth-limited cap **no input at all**.

★ On the brief's "does bathymetry resolution match modern sub-kilometer capabilities" — the **shore
normal already is sub-km (463 m) and is the strongest geometry input the chain has.** The gap is
slope and break depth, not bearing. A nested high-resolution grid or GCN would be layered over an
input that is mislabelled before it is under-resolved.

### 3.5 REGRESSION RISK MATRIX

| # | proposed change | regression risk | automated guardrail required before merge |
|---|---|---|---|
| A | `to_thread` the sync L2 read (§1.1) | **LOW** | Assert `get_spot_ratings` completes with a stubbed 8 s L2 read while a concurrent request returns < 500 ms. Today that test fails. |
| B | `requests.Session()` in GRIB fetchers (§1.3) | **LOW** | Existing fetcher tests (`test_noaa_gfs_marine.py`, `test_fetch_common.py`) must pass byte-identically; add a fixture asserting the emitted product hashes equal the pre-change run. |
| C | Vectorize the regrid block-mean (§2.2/4) | **MEDIUM** | **Differential test against the scalar implementation** over ≥3000 random (r,c) incl. NaN-masked and column-wrap cases; require max abs diff < 1e-9 **and exact NaN agreement**. Measured today: 8.9e-16 / 3000-of-3000. Keep the scalar function as the oracle — do not delete it. |
| D | Step concurrency in ingest (§1.4) | **MEDIUM** | Pin the `times`/series **alignment invariant** (equal length, ascending, no gaps) — the soft-deadline branch already maintains it and concurrency is the way to break it. Plus a product-hash equality test vs a serial run. |
| E | Columnar product representation (§1.2) | **HIGH** | Dual-write + shadow-read: build both, assert field-by-field equality on every served product for ≥1 full ingest cycle before any read flips. Add an RSS ceiling assertion to CI. The `is_valid`/`dir_confidence`/`phys_speed` **optional-None serialization semantics** (`_omit_none_extras`) are the specific trap — a struct array has no "absent". |
| F | Flip `RATING_BREAKER_TYPE` on (§3.3) | **HIGH** | ⛔ **Blocked on F′.** Would push an out-of-validity slope (18.5% of coords) into a live score. Requires the owner-anchor harness + a served-score delta census first. |
| F′ | Rebuild bed slope at true surf-zone resolution | **HIGH** | Distribution guardrail: assert the rebuilt population is ≥X% inside 0.01–0.07 and ≤Y% above `WEGGEL_SLOPE_VALIDITY_HI`, i.e. bake §3.2's census into a test so the next asset cannot regress silently. |
| G | γ / refraction / H110 constants | **CRITICAL** | ⛔ Do not touch in this workstream. Legacy-restore control must give Pipeline **45.52 ft**; the shipped pair gives **29.5 ft**. `test_science_registry.py` + the owner-anchor harness — which is **blind to directional change** (a 47% height cut moves all five anchors by 0.0), so it is necessary and *not sufficient*. |
| H | JAX / neural emulator | **N/A — DO NOT BUILD** | Refuted by §2.1: 1.24 s of CPU for the entire global forecast. There is no regression risk because there is no upgrade. |

---

## SECTION 4 — INCREMENTAL "ZERO-REGRESSION" UPGRADE PATH

Ordered by **measured value ÷ measured risk**. Every phase is independently shippable and
independently revertible. Nothing here touches the physics constants.

### Phase 0 — one-line, zero-risk (≈1 hour)

1. **`to_thread` the L2 read** in `get_spot_ratings` (§1.1, risk A). Removes an event-loop stall
   from the hot path.
2. **`requests.Session()`** in the five GRIB fetchers (§1.3, risk B). Measured **−157 s per ingest
   run**.

No flag needed — both are behaviour-preserving by construction, and B is covered by existing
byte-identity tests.

### Phase 1 — the one real acceleration, behind a flag (≈1 day)

3. **Vectorize the regrid block-mean** (§2.2, risk C), behind `FETCH_VECTOR_BLOCKMEAN=1`, default
   **off**. Measured **27.1× (212 s → 7.8 s per run), max |diff| 8.9e-16, NaN agreement 3000/3000**.
   Ship the differential test *first*, keep the scalar function as the permanent oracle, run one
   full ingest cycle with the flag on in shadow, compare product hashes, then flip the default.

   ★ This is pure numpy against arrays the fetcher has already decoded. **No JAX, no torch, no GPU,
   no new dependency, no change to any physical formula.**

### Phase 2 — ingest concurrency (≈1–2 days)

4. **Bounded-concurrency step fetch** (§1.4, risk D), `NOAA_FETCH_CONCURRENCY` default `1`
   (= today's behaviour exactly), raise to 4 after the alignment-invariant test lands. Takes the run
   from ~1,751 s to **~410 s against the 2400 s deadline (83% headroom)** and makes the 08-02 class
   of incident structurally impossible. Copy the §2.3 soft-deadline salvage to the other three GRIB
   lanes while in there.

### Phase 3 — the columnar product, as a parallel shadow pipeline (≈1–2 weeks)

5. **Dual-write** every product as both JSON and `.npy`/`.npz` columnar (risk E). Read path untouched.
6. **Shadow-read** the columnar copy, assert field-by-field equality on every served product across a
   full ingest cycle, log divergences. The `_omit_none_extras` optional-field semantics are the known
   trap — a struct array has no "absent", so absence must be carried as an explicit validity mask.
7. **Flip the read** behind `PRODUCT_STORE_COLUMNAR=1`, per-lane, with the JSON path retained as
   fallback. Expected: **27.5× resident reduction, 13× faster decode, 5.6× smaller on the wire** —
   which retires the OOM containment that `PRODUCT_CACHE_VECTOR_BUDGET` exists to provide, and lets
   the same budget hold 28× more.

⭐ **This is where the brief's "Zarr" instinct is correct, but Zarr itself is the wrong tool** — these
are ~15k-row point series, not chunked N-D cubes. A structured `.npy` (or Parquet, if querying
matters later) captures the entire 27.5× with a fraction of the dependency surface. Revisit Zarr only
if products ever become true multi-dimensional grids at scale.

### Phase 4 — the nearshore, gated on data not code (≈2–4 weeks, owner-gated)

8. **Bake §3.2's distribution census into a test** (risk F′) before rebuilding anything, so the
   current asset's 57.7%-too-flat / 18.5%-out-of-range shape is a *recorded baseline* rather than a
   session finding.
9. **Rebuild the bed slope at true surf-zone resolution** from a nearshore source. The 463 m
   shore-normal asset proves the pipeline can carry sub-km geometry; the slope asset simply was never
   built at that scale.
10. **Only then** consider flipping `RATING_BREAKER_TYPE` (risk F), and re-run the §3.3 period sweep
    — because at Tp ≥ 13 s the γ ceiling currently makes any slope improvement invisible. **Fixing
    the slope without addressing the ceiling interaction ships an improvement nobody can observe.**

⛔ **Explicitly NOT on this path:** JAX/PyTorch/neural emulation (§2.1 — no headroom), GCN nearshore
grids (§3.4 — the inputs are mislabelled before they are under-resolved), and any change to γ,
`REFRACTION_KR` or `SURF_HEIGHT_H110` (risk G — a separate, ERA5-gated workstream).

---

## §5 SECOND PASS — what changed after reading the last ten contexts

Pass 1 (above) was written without reading the prior queue. Pass 2 read `MASTER-AUDIT-7.0`/`8.0`,
the last six handoffs and the last 25 commits, and then went back to the code. **Five findings
changed, and two of them change what should be worked on next.**

### 5.1 ✅ The event-loop stall is now PROVEN, not inferred

Pass 1 read the code and asserted a stall. Pass 2 reproduced it — the exact shape of
`routes/weather.py:450`, with a co-tenant coroutine standing in for every other in-flight request:

| variant | handler | co-tenant ticks served | worst stall |
|---|---|---|---|
| **as written** (sync call in `async def`) | 1.00 s | **0 of ~100** | — (no tick fired at all) |
| with `asyncio.to_thread` | 1.01 s | 60 of ~100 | 25 ms |

**100% starvation for the full duration of the blocking call.** The 40% shortfall in the fixed
variant is Windows 10 ms timer granularity, not starvation. Scaled to the real `timeout=10`, a bad
Supabase round trip freezes the worker for ten seconds, once per 300 s TTL per process.

### 5.2 ⛔⛔ NEW — the 08-02 salvage fix landed in **1 of 7** GRIB fetchers

§2.3 praised the soft-deadline salvage. Pass 2 checked whether it is the house pattern. It is not:

| lane | salvage |
|---|---|
| `noaa_gfs_wave_fetcher.py` | ✅ SALVAGE (6 refs) |
| `noaa_gfs_wind` · `noaa_gfs_pressure` · `dwd_gwam` · `dwd_icon_wind` · `dwd_icon_pressure` · `ecmwf_opendata` | ⛔ **ALL-OR-NOTHING** ×6 |

All seven run as subprocesses under an external hard kill (**10 `*_service.py` wrappers** spawn
them; `NOAA_FETCH_TIMEOUT_S=2700` is the wave lane's). **The 2026-08-02 incident — a slow-but-working
run killed mid-flight, every downloaded step discarded, a lane going 19.8 h stale — is still live in
six places.** The fix exists, is proven, and was never propagated.

★ **CLASS: a fix applied at the site of the incident is not a fix applied to the class.** Same shape
as the disclosure that reached 1 of 4 renderers (`f1bd00bd`) and the guard whose surface list named a
producer instead of a consumer.

### 5.3 ⛔ NEW — queue item 3's ensemble flag is a footgun, not a switch

`3a95f9a1` wired `ECMWF_WAVE_ENSEMBLE` (default `0`). The commit is honest that it wires only the
**request** (`retrieve_spec`) and the **reducer** (`spread_from_members`), both pure and tested.
Verified in pass 2: `number` appears **only** in `retrieve_spec:171`. The decode loop is still keyed
`by[rid][kind][vt]` with no member axis.

⇒ **Flipping that flag today fetches 8.1–40.7 MB/step of ensemble data and then lets 50 members
overwrite each other, serving whichever decoded last as if it were deterministic.** The result is
*wrong data*, not more data. And because the ECMWF lane is one of the six with **no salvage** (§5.2),
the extra volume also raises the all-or-nothing risk on the same run.

**Item 3 is therefore gated on §5.2, and its own next step is the member-keyed decode — not the flag.**

### 5.4 ⚠️ Queue item 4 is REFRAMED by measurement

The queue records item 4 as *"38% degraded geometry — shore normal dominates (7.4 / 28.1)"*.
Measured at HEAD over the 1,386 asset coordinates (the **best case** — every one passed the gate):

```
full       1074   77.5%
degraded    312   22.5%      <- actionable: 299
blind         0    0.0%
shore_normal_src:  etopo 1380 (99.6%)  |  override 6 (0.4%)
```

**Inside the asset the shore normal is essentially solved (99.6% `etopo`); what is missing is the
nearshore break depth — 299 spots, 21.6%.** "Shore normal dominates" is a statement about spots
**outside** the asset, which fall back to the coarse 0.25° bearing. So item 4 is two different jobs
with different costs, and the cheap one is not the one the queue names:

- **4a — extend asset COVERAGE** (spots not in the 1,386): the hard, open-ended half.
- **4b — backfill break DEPTH for 299 in-asset spots**: bounded, enumerable, and it is the input to
  the depth-limited cap that currently has none.

⚠️ Frame: 1,386 asset entries vs ~1,547 active spots (Audit 7.0). Overlap is unverified without the
live catalogue, so **22.5% is a floor on served degradation, not the served number.**

### 5.5 ⚠️ The vectorization win is no longer a hypothesis — it has ≥3 call sites

Pass 1 declined to promote it beyond the NOAA lane. Counting `energy_mean_*_block` call sites:
`noaa_gfs_wave` **16**, `dwd_gwam` **11**, `ecmwf_opendata` **3** (`noaa_gfs_wind` and
`dwd_icon_wind` 0 — they do not block-average). The same loop shape is in the ICON-marine and EURO
lanes. **Only the NOAA lane is priced (27.1×); the other two are structurally identical but
unmeasured.**

### 5.6 ℹ️ A stale generated artifact is sitting in the tree

`backend/scripts/geometry_backfill.{sql,json}` — untracked, generated **2026-08-01**, `"queue": 413`,
**`"moved": 0`**. 413 `UPDATE surf_spots SET geometry_reject_reason = …` statements, idempotently
guarded, never applied. Either run it or delete it; a generated artifact that has sat unapplied for
five days is the same invisible-blocker class the repo already has a rule for.

---

## §6 THE PLAN — what to work on next, in order

### 6.0 STATE CHANGES since the measurements above (parallel session, same tree)

A second session shipped 5 PRs to `dev` today. **`origin/dev` is 2 commits ahead of the measured
`f7a63d84` (`1b0060e0`, `b61c918a`) — and `git diff --stat f7a63d84..origin/dev -- backend/services/
backend/routes/` is EMPTY.** Every number in this audit stands; the new commits touch workflows,
`requirements.txt`, and one new script only.

What changes for the plan:

- ✅ **Queue item 9 (unauthorized WebSocket connects hang) is DONE.** Root cause was
  `verify_websocket_auth` raising `HTTPException` from a websocket route, so the handshake was
  answered with nothing at all. `test_websocket_endpoints_auth.py` is out of estate quarantine,
  which now holds only `test_debug_consciousness.py`.
- ⚠️ **Every phase below adds tests ⇒ raise `MIN_PASSED` in `backend-estate-coverage`.** Currently
  **285** on dev, **295** pending in PR #6. ⛔ Set it **from the gate's own printed reading**, never
  from a local count or a prediction — `ci.yml` records what happened both times that rule was broken.
- ✅ **Helps Phase 3:** `requirements.txt`'s 7 `>=` lines are now pinned, including **`pygrib` and
  `ecmwf-opendata`** — the two the ensemble work depends on. They had been re-resolving on every
  production deploy. Bump explicitly if a newer one is needed.
- ⚠️ **Local backend now 401s without a dev-auth signal.** Set one of `TESTING=1`, `ENV=development`,
  `NODE_ENV=development`, `ALLOW_DEV_MOCK_AUTH=true`. (Three guards read
  `if ENV != "production" and IS_PROD != "true"`; neither var is set on Render, so all three failed
  OPEN and `Bearer dev-mock-user-token` returned **HTTP 200 on the live backend**. Now fail-closed.)
  ⛔ **Still open for the owner: the seeded `dev-mock-user-id` profile — `is_admin=True`, 100
  withdrawable credits — is still a row in the production DB.**
- ⚠️ **GitHub Actions is platform-degraded** (`Failed to resolve action download info`, jobs queued
  15+ min then cancelled with zero step failures, confirmed with a no-Python control job).
  **A cancelled job with no failing step is not your change.** Verification for Phase 0 will be slow.

### 6.0a ⚠️ INTERPRETER CAVEAT on every timing in this audit

Measured on this workstation: **Python 3.14.4, numpy 2.4.4, pydantic 2.13.3.** Production and CI run
**3.12**. The conclusions transfer, and the reason is specific rather than hopeful:

- **Correctness** is already settled by the parallel session's `artifact-interpreter-parity`
  workflow — composition + `ocean_access` gave **byte-identical output on 3.11 / 3.12 / 3.14**.
- **§2.1 (1.24 s of CPU)** carries ~1–2 orders of magnitude of margin against the 7.5–8.6 s/req I/O
  cost. No plausible interpreter delta reaches that.
- **§2.2 (27.1×)** is a numpy-array reduction versus a Python-level loop; on a *slower* interpreter
  the ratio grows, it does not shrink.
- **§1.3 (346.5 ms/call)** is network, and **§5.1 (the stall)** is asyncio semantics. Neither is
  interpreter-sensitive.
- **§1.2 (688 B/vector)** is primarily a *pydantic-version* property. Worth re-measuring on 3.12
  before Phase 5 commits to the 27.5× figure — it is the one number where the interpreter and the
  library version could plausibly move the result by a meaningful fraction.

### 6.0b ✏️ A neighbouring claim, made precise

The parallel session recorded *"the rating chain uses no numpy at all"*. Measured — it is exactly
right for the rating and physics modules, and would be wrong if extended one step further:

```
surf_rating.py 0   surf_transform.py 0   surf_point.py 0   shore_normal_asset.py 0
bathymetry.py 13   <- and bathymetry IS step 1 of the mandated composition chain
```

So: the **rating/height math is pure scalar Python** (which is *why* §2.1 measures 9.4 µs/call), but
the **geometry half of the composition chain does use numpy**, in `bathymetry.py`. The useful
consequence: **Phase 5 (columnar products) cannot touch the rating chain at all** — it is a lower-risk
change than risk-matrix row E implies.



Ordered by **(measured value × confidence) ÷ (risk × cost)**. Every phase is independently shippable
and independently revertible. ⚠️ **Every push to `dev` is a production backend deploy (5–30+ min) —
batch each phase into one push.**

### PHASE 0 — two one-liners, ship together (~1–2 h) · **START HERE**

| # | change | evidence | risk |
|---|---|---|---|
| 0a | `asyncio.to_thread` the L2 read in `get_spot_ratings` | §5.1 — 0 of ~100 co-tenant ticks | **LOW** |
| 0b | `requests.Session()` in the 5 bare-`requests` GRIB fetchers | §1.3 — 346.5 ms/call, ~157 s/run | **LOW** |

Guardrail: 0a needs the concurrency test from risk-matrix row A (it fails today). 0b is covered by
existing byte-identity fetcher tests. Both are behaviour-preserving by construction.

### PHASE 1 — ⛔ **CLOSED ON MEASUREMENT, 2026-08-06.** The exposure is not there.

**I proposed this from a structural observation — "the salvage is in 1 of 7 fetchers" — and never
priced the risk. Priced now, from real production ingest logs, it does not survive.**

Every lane's actual elapsed time against its own hard kill (`run_fetcher_subprocess` defaults to
1800 s; the NOAA marine lane carries 2400 s soft / 2700 s hard). Pilots workflow, run 31105532037,
the pass where `global_mid` and the 2026-08-02 incident live:

| lane | steps | elapsed | hard kill | ceiling used |
|---|---|---|---|---|
| **NOAA GFS-Wave (`global_mid`)** | 113 | **1879.0 s** | 2400 soft | **78.3%** ✅ *already has salvage* |
| Copernicus Global *(coarse wf)* | 17 bands | 1099.2 s | 2400 | 45.8% |
| ECMWF EURO-Wind | 49 | 649.5 s | 1800 | 36.1% |
| DWD ICON-Wind | 61 | 475.9 s | 1800 | 26.4% |
| DWD GWAM | 57 | 414.7 s | 1800 | 23.0% |
| ECMWF EURO-Waves | 65 | 251.5 s | 1800 | 14.0% |
| NOAA GFS-Wind | 113 | 231.3 s | 1800 | 12.9% |
| DWD GWAM multi · GFS-Wind multi · EURO-Waves multi | 17–65 | 59–210 s | 1800 | 3.3–11.7% |

★★★ **THE SALVAGE IS ALREADY ON THE ONLY LANE THAT IS ANYWHERE NEAR ITS CEILING.** The six lanes I
proposed to fix run at **3.3%–36.1%** of their kill. Copying a four-part mechanism into them would be
pure cost against no measured risk.

**AND THE VOLATILITY CONFIRMS IT RATHER THAN UNDERMINING IT.** One reading is not a distribution, so
n=4 on the tightest lane: **1198.4 / 1228.4 / 1835.8 / 1879.0 s — a 1.57× swing** on identical code,
driven purely by upstream throughput. Applying that same 1.57× to every unsalvaged lane: EURO-Wind
→ ~1020 s (57% of 1800), Copernicus → ~1726 s (72% of 2400), ICON-Wind → ~747 s. **None breaches.**
The 2026-08-02 event was this volatility hitting the one lane whose runtime is already 3–8× its
siblings' — which is exactly, and only, where the salvage was put.

⚠️ **WHAT I GOT WRONG, NAMED SO IT IS NOT REPEATED.** §5.2 called this "the identical incident live in
six places". That claim was about **code shape**, and I wrote it as if it were about **risk**. It is
the third time in this repo that "propagate it / switch to it" was argued structurally and died to a
paired measurement (EWAM +46% MAE; `ecmwf` losing to GFS at 36% of coverage; now this).
⇒ ★★★ **A MISSING MECHANISM IS NOT AN EXPOSURE. Price the risk, not the asymmetry.**

⛔ Salvage also does **not** help against the external cancellations degrading Actions today: a
platform cancel kills the process outright, and a soft deadline the fetcher checks itself can never
observe it.

✅ **WHAT THIS REDIRECTS TO.** The 1879.0 s figure is **pre-pooling** (measured at `4b146165`). The
work already shipped and queued lands on exactly the volatile lane:

| | 113-step `global_mid` | margin vs 2400 s soft |
|---|---|---|
| observed max, pre-Phase-0 | 1879.0 s | 1.28× |
| − ~157 s connection pooling (**shipped, `6dd720eb`**) | ~1722 s | 1.39× |
| − ~204 s vectorized regrid (**Phase 2**) | **~1518 s** | **1.58×** |

**Phase 2 is therefore promoted: it is the highest-value remaining item, and it buys its margin on
the one lane that has ever run out of it.** No new instrument is needed to watch this — the fetcher's
SUMMARY already prints `truncated=no`.

### PHASE 2 — vectorize the regrid, behind a default-off flag (~1 day)

`FETCH_VECTOR_BLOCKMEAN=1`, default **off**. Differential test **first** (≥3000 random (r,c), NaN
mask, column wrap; require max abs diff < 1e-9 **and** exact NaN agreement — measured 8.9e-16 /
3000-of-3000). Keep the scalar function as the permanent oracle. NOAA lane first (priced: 212 s →
7.8 s), then price and extend to `dwd_gwam` and `ecmwf_opendata` (§5.5).

### PHASE 3 — finish the ensemble (queue item 3) (~2 days) · **gated on Phase 1**

The external consensus answer *and* our biggest untapped item are the same item, and half of it is
already built. Remaining work is named precisely by `3a95f9a1`:

1. **Key the decode loop by member** — `by[rid][kind][vt]` needs a member axis, or members overwrite
   (§5.3). ⛔ Do not flip the flag before this.
2. Emit spread into a served product via the already-tested `spread_from_members` (which correctly
   **refuses below 2 members** rather than reporting 0.0).
3. Start at `ECMWF_WAVE_ENSEMBLE_MEMBERS=10` (8.1 MB/step), not 50 (40.7 MB/step).

⚠️ Decode traps already identified and to be honoured: packing is template **5.42 (CCSDS/AEC)**, and
GRIB2 signed ints are **sign-magnitude, not two's complement**.
⚠️ `ecmwf.opendata` + `pygrib` do not import on the Windows box — this lands and is verified on Linux/CI.

### PHASE 4 — geometry break-depth backfill (queue item 4b) (~2–3 days)

Backfill the **299 enumerable in-asset spots with no nearshore break depth** (§5.4). Bounded, and it
feeds the depth-limited cap that currently has no input at those spots. Resolve §5.6's stale
`geometry_backfill.sql` in the same pass (apply or delete). Item **4a** (asset coverage) stays open.

⚠️ Guardrail: the owner-anchor harness is **blind to directional change** — necessary, not sufficient.

### PHASE 5 — the columnar product store (~1–2 weeks)

Dual-write → shadow-read → per-lane read flip (§1.2, risk E). **27.5× resident, 13× decode, 5.6×
wire**, retiring the OOM containment `PRODUCT_CACHE_VECTOR_BUDGET` exists to provide. Known trap:
`_omit_none_extras` optional-field semantics have no equivalent in a struct array — absence must
become an explicit validity mask.

### ✅ RESOLVED 2026-08-06 — the Arugam frame, and what it settles about item 2

Handoff 08-06-B left one unreconciled observation: Arugam Main Point served **3.9/100 on 5.1 ft /
10 s / 15 kt OFFSHORE**, while the 47.6-year ERA5 probe says 100% of its top-percentile hours are
*not* floored. Two hypotheses were on the table — (a) that frame was one of the 16.8% floored hours,
or (b) a **different** limiter bound it (`size_gate` limits 43% of served spots vs `swell_exposure`
28.5%). Reproduced through the production chain at the real geometry
(`shore_normal 100.0 etopo`, `break_depth 3.5 m`, match 0.31 km):

| Δθ (swell vs shore normal) | score | level | limiter |
|---|---|---|---|
| 0° (head-on) | **71.7** | good | `wind_period_blend` |
| 45° | 52.8 | fair | `wind_period_blend` |
| **≥90°** | **7.2** | very_poor | **`swell_exposure` 0.100** |

⇒ **(b) IS REFUTED.** `swell_exposure` is the limiter in every low-scoring case; `size_gate` never
binds here. **(a) is confirmed but INCOMPLETE**: at 10 s with offshore wind the floored exposure
bottoms the score at **7.2, not 3.9**. Scanning Tp 6–16 s × 0–30 kt × on/offshore, 3.9 *is* reachable
at 5.1 ft — minimum 0.6 — but only with floored exposure **plus** a short period or onshore wind.

⚠️ **So the recorded frame does not reproduce its own recorded score.** Either the logged inputs are
not what the engine saw, or the 3.9 came from a different hour. Worth knowing before that number is
quoted again — but it does not change the conclusion, because exposure is the limiter across the
whole low-score region either way.

★★★ **AND THE FRAME IS A CLEAN LIVE SPECIMEN OF ITEM 2.** At Δθ ≥ 90° the two chains disagree by
exactly the documented 3.54×, and the shipped disclosure fires:

```
dtheta >= 90  ->  quality_exposure 0.100   height_exposure_factor 0.595 (energy 0.354)   ratio 3.54
offshore 5.1 ft, dtheta 90-120  ->  breaking 1.32 m = 4.3 ft, score 7.2 "very_poor"
```

**4.3 ft rendered `very_poor`** — the height chain saying a third of the energy arrives while the
quality chain says a tenth, in one payload. Item 2 is real, it is correctly disclosed, and it stays
ERA5-gated for the reconciliation (the height is right *by cancellation*; flipping either floor alone
moves every head-on spot too).

### PREVIOUSLY RUNNING IN PARALLEL — the measurement above (now done)

Handoff 08-06-B left **one unreconciled observation**: Arugam Main Point served **3.9/100 on 5.1 ft /
10 s / 15 kt OFFSHORE**, while the 47.6-year ERA5 probe says 100% of its top-percentile hours are
*not* floored. Either that frame was one of the 16.8%, or a **different limiter** bound it
(`size_gate` limits 43% of served spots vs `swell_exposure` 28.5%). **Re-measure that one spot-hour
live before acting on ledger row 1.** Cost: minutes. It decides whether item 2 is real.

### OWNER-GATED — I cannot move these

| # | item | what it needs |
|---|---|---|
| 1 | **Production frontend frozen at `3bd38a83` (2026-05-20); 6 of 6 `/api/*` 404 in prod** | one Netlify dashboard screen — locked/pinned deploy or auto-publish off |
| 6 | Vercel fails on 8/8 prod + 6/6 preview deployments | disconnect the integration |
| 7 | `RATING_LOCAL_SIZE` | a product decision (category error as a score multiplier; use as a separate rarity axis) |

### CLOSED — do not reopen without new evidence

- **EWAM 5 km** — closed by measurement (Audit 8.0): GFS 25 km wins at 8 of 13 buoys; EWAM +46% MAE.
- **JAX / neural emulator / GPU** — closed by measurement (§2.1): 1.24 s of CPU for the whole global forecast.
- **GCN / nested nearshore grids** — premature (§3.2): the inputs are mislabelled before under-resolved.
- **Bed slope / `RATING_BREAKER_TYPE`** — ⚠️ *partially* reopened by §3.3: worthless at groundswell
  (γ ceiling saturates, 0% movement at Tp ≥ 13 s), but **fully live at Tp ≤ 10.5 s**. Not zero-value
  — short-period-value. Still gated on rebuilding the asset at true surf-zone resolution.
- **γ / `REFRACTION_KR` / `SURF_HEIGHT_H110`** — a separate ERA5-gated workstream. Do not touch here.

---

## §7 WHAT THIS AUDIT DID NOT COVER

Stated so it is not over-quoted:

- **Frontend / WebGL / shader path** — out of scope for a physics-and-ingestion brief.
- **The live serving latency split** was inferred from `routes/weather.py`'s own recorded figures
  (7.5–8.6 s/req) minus the measured 1.24 s global compute; it was **not** re-measured live, because
  local `.env` points at the wrong Supabase project (`weewaulkwfwlbhqemxma`, prod is
  `jnfbxcvcbtndtsvscppt`) and a local measurement would be misleading.
- **The slope and geometry census population is `shore_normals.json`'s 1386 gate-passed entries**,
  not the 779–1005 served spots and not a viewport sample. Quote it as that or not at all.
- **The 27.1× regrid speedup was measured on synthetic arrays** at documented global_mid scale
  (721×1440 native, 15,000 points, 30% NaN mask, half=2) against the real
  `energy_mean_height_block`. The other three GRIB lanes were **not** priced.
- **`dwd_gwam_fetcher.py` (depth-5 nest)** and the ICON/ECMWF lanes were structurally identified but
  not benchmarked.
- The §1.4 budget table extrapolates from the **08-02 observed 14–17 s/step**; upstream rate varies.
