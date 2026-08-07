# MASTER AUDIT 10.0 — 2026-08-07 · SOTA architecture audit & safe upgrade assessment

**Read-only.** No functional code was altered; `git diff --stat` against `c0c61bda` is empty apart
from the two `forecast_cache` JSONs and the two untracked `geometry_backfill` files that were dirty
at session start. Every number below was produced by execution at HEAD `c0c61bda`, either against
the live production backend (`raw-surf-antigravity.onrender.com`, serving
`2.0.0-stage-6f-v1-c0c61bda…`) or with `~/AppData/Local/Python/bin/python3.exe`.

Predecessors: `MASTER-AUDIT-9.0` (2026-08-06, same brief) · `HANDOFF-2026-08-07` (the session that
shipped the ensemble). **9.0's §6 plan is now fully resolved, shipped, or overturned — this audit
replaces it.**

---

## §0 THE HEADLINE — THE CAPABILITY THAT SHIPPED LAST NIGHT REACHES NOBODY, AND THE PHYSICS THREAD THE LAST THREE AUDITS ORGANISED AROUND BINDS ON 0.145% OF SERVED HOURS

### 0a. The brief's three SOTA vectors, priced for the second time

| brief's vector | verdict | the measurement |
|---|---|---|
| JAX / neural emulator | ⛔ **CLOSED, on stronger evidence than 9.0 — and 9.0's number was understated 3.2×** | 9.0 timed only the height half. Timing **both** mandated halves at HEAD: `estimate_surf_at` 10.97 µs + `compute_surf_rating` 10.24 µs + `rating_factors` 8.88 µs. Two independent runs — a direct one (19.01 µs/spot-hour → **2.50 s**) and a drift-cancelling interleaved one that also counts the **duplicate** `rating_factors` evaluation (ratio 2.79× the height half → **3.94 s**). **Take 3.94 s as the honest ceiling.** 9.0's 1.24 s was wrong by 3.2× and its **conclusion survives untouched**: 4 s of CPU for the entire global forecast. Nothing to accelerate. |
| Zarr / cloud-optimised ingestion | ⚠️ **STILL THE WRONG TOOL, and the real cost moved** | GRIB2 already streams by HTTP Range off `.idx`. 9.0 put the remaining cost in the product store's representation; the 08-07 session **closed that on measurement** (box is 2048 MB, plateau ~891 MB = 43%). What replaces it is not a format problem at all — see §1.1. |
| GCN / nested nearshore grids | ⛔ **NOW REFUTED BY A DENOMINATOR, not merely "premature"** | At the **median served spot-hour the depth grids do not enter the number at all**: replacing both shelf depth and break depth with an absurd 4000 m leaves the served height **bit-identical on 54.32%** of coastal served spot-hours (and 100.00% — 24,372 of 24,372 — on the `Kf==1.0 ∧ regime≠breaking` subset). A finer bathymetry improves an input that is multiplied by zero more than half the time. |

★ Same lesson as 8.0 and 9.0, third consecutive audit: **price the upgrade against the thing it
would replace.** What is new is that this time the *incumbent* physics thread failed the same test.

### 0b. The two findings that change what should be worked on

**1 — `forecast_confidence` reaches 0 of 1,103 served spots. Three gates in series, all closed.**
The 08-07 session shipped `decode → reduce → emit → point → rating → hub → screen` and recorded the
last link as done. Measured, the last three links are each independently blocked:

| # | gate | measured |
|---|---|---|
| **ROOT** | `sampler.py:154` — `speed_spread` is set at **1 of 10** `NormalizedPointDetail` sites in `sampler.py` (**1 of 24** backend-wide), the `exact_match` branch. `_find_surrounding_brackets` (`sampler.py:441-451`) returns a degenerate bracket only via `val <= coords[0]` / `val >= coords[-1]`; the bounds check at `sampler.py:69` has already clamped the point inside that interval, so those collapse to `==`. `exact_match` therefore needs the point at *both* axis extrema — one of the **4 grid corners**. | `exact_match` fired on **0 of 1,103** production-served spot_ids across 4 real ingested products; **0 of 35** independent live `/api/weather/point` probes, incl. 5 placed exactly on 0.25° nodes; **2 of 13** exact nodes on a synthetic axis collapse, and both are the endpoints. Resolution-independent: 0.00% at 0.25/0.5/1/2/10°. Corner control fires correctly. |
| latent 1 | `routes/weather.py:312` — `SpotRatingItem` declares 20 fields, not `forecast_confidence`; pydantic `extra='ignore'` strips it. | Of the **18** keys `rate_one_spot` emits, **exactly one** is dropped, and it is this one. Every sibling orthogonal axis (`geometry_readiness`, `directional_conflict`, `limiter`, `limiter_f`) *is* declared — the pattern was followed 4 times and missed on the 5th. |
| latent 2 | `routes/surf_data/conditions.py:119` — `GET /conditions/{spot_id}` rebuilds `current` from a hand-written **8-key dict literal**. `SpotConditions.js:140` fetches exactly this endpoint and both render sites gate on `current.forecast_confidence`. | AST: `current` has 8 keys, `forecast_confidence` absent; control `wave_height_ft` present and does render. |

⚠️ **Ordering matters and an adversarial pass corrected us on it.** The two wire gaps are *latent*,
not today's cause — **pydantic cannot strip a key that was never emitted**, and the root gate means
`_fc` is always `None`. So: fixing the sampler alone still shows nothing (two walls behind it);
fixing either wall alone changes nothing. **Root first, then both walls, or the fix reads as a
no-op.**

★ This settles `HANDOFF-2026-08-07 §10`'s first action item — *"load a EURO spot hub in a browser and
look"*. **Looking would have shown nothing, and would have been misread as "no ensemble at this spot
yet."** The handoff's own caveat (*"it will look uneven — by design"*) was a claim about code priced
without a denominator; measured, the denominator is zero.

**2 — The nearshore thread is optimising a term that almost never binds, while the highest-value
absent term is already sitting in the repo.**

Over **227,088 real served spot-hours** (250 sampled `shore_normals.json` coords × 912 h of real
Open-Meteo marine, through `resolve_surf_geometry` + `estimate_surf_at`):

| term | reach on served spot-hours |
|---|---|
| depth-limited breaking cap (γ, `GAMMA_MAX_STEEP`, Weggel slope, the 12.96 MB bed-slope asset, matrix items F/F′) | **0.145%** (329 of 227,088; 4 of 249 spots) |
| the slope→γ term specifically (`SURF_V3_SLOPE_GAMMA` A/B) | **0.09%** |
| wave setup (absent) | 0.145% |
| **tide (absent — input already in `tide.py:tide_state_at`, unwired to the height)** | **1.694%, median 45.6% height change, max 60.6%** |

**Tide is 19× the reach of the entire slope/γ thread**, needs no new data source, and is signed
(only lowering the cap binds: −1.5 m → 1.694%, +1.5 m → 0.145%).

**3 — And one live product defect that outranks both.** `surf_transform.py:401`:
`if not coastal: return float(Hs_m), 'open_ocean'` returns the **offshore significant height
byte-identically**, and no per-spot surface branches on that regime. Measured: `coastal=False` at
**18 of 1,386** geometry-resolved coordinates — the entire Barbados list (Soup Bowl, South Point,
Freights, Brandons, Cattlewash, Tropicana), the Maldives, Fernando de Noronha. Through the hub's own
`spot_conditions._breaking_ft`: **Soup Bowl at Hs 2.0 m → 6.6 ft, "Overhead", identical to the
offshore number**; control Pipeline (coastal) → 9.9 ft.

⛔ **That is CLAUDE.md's first binding rule failing in production** — *"NEVER report marine
`point.speed` as the surf height"* — at destination spots people fly to. All 18 carry
`shore_normal_src='etopo'`, a 463 m fit at that exact coordinate, so **the geometry struct asserts a
shoreline and no shoreline simultaneously.**

### 0c. How this audit was verified, and what verification killed

Six independent read-only dimensions, then an adversarial pass instructed to **refute** the
highest-severity findings and to default to refuted when it could not independently confirm. It
earned its cost — **2 of the first 4 findings put to it were struck down or cut**, and one of those
corrections reordered the whole remediation sequence:

| finding | verdict | what changed |
|---|---|---|
| sampler `exact_match` gate | ✅ **CONFIRMED**, independent method + data source | sharpened to 1 of 24 backend sites, with the bounds-clamp reasoning made exact |
| `/conditions` 8-key literal | ✅ **CONFIRMED by executing the real handler** (not AST) | control `wave_height_ft`=5.3 survived; `/conditions/batch` drops it too |
| `SpotRatingItem` drop = HIGH | ⛔ **SEVERITY REFUTED** | *"Pydantic cannot strip a key that was never emitted."* Demoted to **latent**, and this is what put the sampler first in Phase 1 |
| `39.0 m` break depth is unbounded | ⛔ **REFUTED by a control the finder never ran** | 13.0% of already-shipped depths exceed it; it is the 87th percentile |

★ **Neither refutation came from re-reading the code — both came from a denominator.** That is the
same instrument that killed five proposals in the 08-07 session, and it is the reason this audit
promotes tide over γ and demotes its own second-loudest finding.

---

## SECTION 1 — CORE SYSTEM ARCHITECTURE GAPS

### 1.1 ⛔ CRITICAL — every GRIB product is `json.load`-ed on the serving event loop, nine lines below a correct offload

`_fetch_common.py:737`. `run_fetcher_subprocess` correctly offloads the subprocess via
`run_in_executor` (L728) and then does `with open(out) as f: data = json.load(f)` (L737-738)
directly on the loop. `AsyncIOScheduler` runs these jobs **inside the single uvicorn worker that
serves all API traffic** — `uvicorn server:app` carries no `--workers`, so there is exactly one
event loop.

Measured on the real payload built at documented `global_mid` scale (14,940 points × 16 series keys
× 113 valid times = 27,011,520 scalars, 235.3 MB on disk — built, not extrapolated):

```
trial 1:  json.load = 7.271 s
trial 2:  json.load = 7.089 s
```

**Denominator: the repo's own production figure for the hot map endpoint is `/spot-ratings` 264 ms
warm. A single `global_mid` ingest stalls every in-flight request by ~7 s.**

★ This is the exact class the 08-07 session fixed one instance of (`6dd720eb`, the L2 read — measured
0 of ~100 co-tenant ticks). **A fix applied at the site of the incident is not a fix applied to the
class**, for the fourth recorded time in this repo.

### 1.2 ⛔ CRITICAL — the ensemble reaches zero served spots (three gates, §0b)

Full detail in §0b. Root: `sampler.py:154`. Note the contract in `schemas.py:144-148` states
*"Populated ONLY where a single vector is the source (exact match / **NEAREST**)"* — but the three
`nearest_*` branches (`sampler.py:352, 375, 407`) and `nearest_scalar_fallback` do **not** set it.
**The documented contract is wider than the implementation, which makes the fix well-scoped and
low-risk:** those branches are single-vector reads with semantics identical to `exact_match`.

### 1.3 ⛔ HIGH — 18 catalogued spots publish the offshore height as the surf height

§0b item 3. `surf_transform.py:401` / `surf_point.resolve_surf_geometry:75`.

### 1.4 ⛔ HIGH — the minimum-coverage floor cannot fire on the failure mode it was written for

`noaa_gfs_wave_fetcher.py:564`. The floor is `if truncated_at is not None:` — and `truncated_at` is
set **only** by the soft-deadline break (L362). When steps fail from upstream 429/503/short-range or
malformed GRIB, `truncated_at` stays `None` and the floor is never evaluated. Worse, when it *is*
evaluated, `covered_h = (len(times)-1)*3` counts **failed** steps, because the except branch appends
to `times` too (L538).

Proven by driving the real `fetch_global_coarse` with a `sys.modules` stub:

```
CASE A (control) all 113 steps succeed      -> 0.0% null,  horizon claims 336 h
CASE B upstream 503s every step but the 1st -> 99.1% NULL, horizon claims 336 h, floor never ran
```

**A 99.1%-null product ships claiming a 336 h horizon and, carrying a newer run stamp, supersedes a
healthy one.** The floor's own comment states exactly this stake.

### 1.5 ⛔ HIGH — the wire-contract guard is structurally blind to the idiom this repo uses for "absent unless it binds"

`tests/test_spot_rating_wire_contract.py:131`. `_producer_return_keys()` collects
`{k.value for k in sub.value.keys if isinstance(k, ast.Constant)}`. **A `**` entry in an `ast.Dict`
has `key = None`** — so the guard cannot see any key added by dict-unpacking, and `**({...} if x else {})`
is precisely how this repo expresses an absent-unless-binding field. Run verbatim it sees **17 keys,
`forecast_confidence` not among them**; its setup floor `len(produced) >= 10` has 7 keys of slack and
never fires.

**This is why three independent breaks shipped green.** The guard built to catch exactly this defect
could not see the field.

### 1.6 ⛔ HIGH — the frontend confidence suite tests a copy of the component, not the component

`frontend/src/components/SpotConditions.confidence.test.js`. It imports only
`@testing-library/react` and `../utils/themeTokens`; it **re-declares** `CONFIDENCE_TEXT`,
`confidenceDot` and `confidenceLabel` locally and renders its own `<Dot>`. Absence check:
`git ls-files frontend/src | grep test | xargs grep -ln SpotConditions` returns **nothing** — no
frontend test anywhere imports the shipped component. **Deleting the confidence block from
`SpotConditions.js` would leave the suite green.**

### 1.7 ⛔ HIGH — an untracked overlay silently corrupts the *measuring* lane by a full rating level

`services/weather_pipeline/data/shore_normals_overlay.json` — written 2026-07-31 23:22 as a side
effect of the geometry backfill's `persist_overlay()`, gitignored (`.gitignore:347`), never
committed, and **read by `shore_normal_asset` on the serving path**.

```
WITH the local overlay -> break_depth_m = 39.0 / 11.4 / 3.8 / 11.0 / 10.0
CONTROL, empty overlay -> break_depth_m = None at ALL FIVE   <- what production has
end-to-end (5 coords x 4 swells): height identical in 20/20; at the big-swell cell the
RATING differs by 32.6 points and one full level
```

⚠️ **This repo's entire method is local measurement.** A defect in the measuring lane is worse than
one in the measured lane — a rule this repo has already recorded. *(It does not affect this audit's
numbers: none of the 5 coordinates is among those quoted, and the Pipeline control below replicates
its recorded anchor exactly.)*

### 1.8 ⚠️ MEDIUM — the ICON/weather lane has been stale for 11.6 h with a green fetcher and a red pager, unreported

Live, measured this session:

```
/api/health/data           status=warn
  8 lanes           age 1.8 - 2.4 h   ok
  ICON/weather      age 11.6 h        ALERT: lags freshest by 9.7h
manifest last update 02:00:28Z; ICON/weather newest run_time 2026-08-06T15:57:43Z (61 products)
```

Yet that lane's own SUMMARY at 01:38:07Z reported `steps_ok=61 steps_failed=0 … wrote=yes`, and 61
`Atomic save complete` lines followed. The Data Health Monitor has failed **every run since 08-06
16:30Z** (4 consecutive), through a 30-commit session, and appears in no handoff.

### 1.8a FORENSICS — narrowed to a lost update on a shared manifest, but NOT closed

Established by execution against the two run logs, in order:

```
00:48Z  pilots run 31135928399 starts; reads the manifest at 00:50Z
00:55Z  main ingest 31136310361 starts
01:18Z  main writes GFS/marine global_mid          -> SURVIVED in the served manifest
01:38Z  main writes ICON/weather: "Ingested 61 ICON Pressure global coarse grid files"  -> LOST
01:40Z  main uploads its manifest (its LAST upload, i.e. the write WAS published)
02:00Z  PILOTS uploads (six uploads 01:59:40-02:00:26) — LAST WRITER, and the served one
02:20Z  main ingest ends
```

**What is now fact, not inference:** the save succeeded (`Ingested 61`, `count > 0`, so
`prune_superseded_products` also ran); the main ingest *did* publish a manifest 2m47s later; the
**pilots run does not ingest ICON Pressure at all** (its lanes are GWAM, EURO-Waves, GFS-Wind,
ICON-Wind, EURO-Wind and regional GFS-Wave); and `manifest_written_by` names the pilots run.
⇒ **Two overlapping workflows read-modify-write one shared L2 manifest, and the last writer wins.**

⚠️ **AND THE OBVIOUS RACE STORY IS REFUTED BY ITS OWN CONTROL.** If the pilots simply overwrote with
a view read at 00:50Z, the main ingest's **01:18Z GFS/marine** write would have been lost too — and
it survived. So something lane-specific is also at work, and every simple version of "the pilots
clobbered it" fails that control. **I am not naming a mechanism I cannot discriminate.**

**The decisive instrument, unchanged:** log the manifest's per-lane `run_time` immediately before and
after each publish, in both workflows, for one cycle. That separates "the upload never contained the
lane" from "a later upload dropped it" in a single run — and no amount of further log archaeology
will, because neither workflow currently records what it published.

⚠️ **Do not fix before that measurement.** A serialisation lock or a merge-on-write both look
obvious and would each be a guess at which of two failure shapes is real.

★ The class is real regardless: **the lane SUMMARY grades the FETCH; nothing grades the PUBLISH.**

### 1.9 ⚠️ MEDIUM — the ensemble's second retrieve ignores the deterministic retrieve's own salvage

`ecmwf_opendata_fetcher.py:408`. The deterministic path retries with `[s for s in steps_full if s <= 144]`
on failure (L330); the ensemble unconditionally passes `ensemble_spec(steps_full)`.

```
06/18 cycle, full retrieve raises:
  deterministic ACTUALLY requests : 49 steps, max 144 h
  ensemble      ACTUALLY requests : 65 steps, max 240 h   <- 16 steps just proven unavailable
```

Scope is bounded and stated: only the **global** EURO wave lane (`forecast_days=10`);
`fetch_euro_marine_waves_regions` defaults to `forecast_days=2` (all steps ≤144) and is immune. The
failure is swallowed by `except Exception` writing one stderr line, so **a broken ensemble fetch is
indistinguishable from a product that simply has no ensemble** — which, given §1.2, is every product.

### 1.10 ⚠️ MEDIUM — one unguarded `asyncio.gather` at 8.3× its siblings' cap on the same 1-CPU box

`routes/explore_discover/explore.py:477`. AST scan: 5 splat `asyncio.gather` sites; four pair with a
semaphore, this one does not. Width 50 vs the siblings' documented 6 — `weather.py:306-308` states
the reason verbatim: *"Concurrency is bounded for the 1-CPU serve box."*

### 1.11 ℹ️ LOW — `geometry_backfill.sql` is 30 statements, not the 413 the queue records

⚠️ **This entry was cut down by adversarial verification; the reduced version is what survives.**

`grep -c '^UPDATE'` = **30** (18 `not_coastal_placement` + 12 fit outcomes), all 30 carrying the
idempotency guard, against `"queue": 413` in the sibling JSON. **413 is the queue size, not the
statement count** — `HANDOFF-2026-08-07 §6` item 6 records it as "413 statements". That is the whole
finding: a documentation correction to a known queue item.

⛔ **REFUTED — what does *not* survive.** The first pass flagged `break_depth_m = 39.0` as an
unbounded "nearshore break depth". A control it never ran kills that: in the **git-tracked**
`shore_normals.json`, **141 of 1,087 already-shipped break depths (13.0%) are ≥ 39.0 m** — 39.0 sits
at the **87th percentile** (p50 11.10, p90 55.50, max 1004.00). It is ordinary for this asset, not an
outlier, and the "no `_MAX_TRUSTWORTHY_DEPTH_M`" observation is a re-report of 9.0 §3.4's already-
recorded *"max = 1004 m is not a break depth"*.

★ **The class, worth more than the finding:** an alarming-looking value in a generated artifact is
not a defect until it is compared against the distribution already shipping. **The cheapest
discriminator was a percentile.**

**Recommendation: delete both files anyway** — untracked, 7.3% complete, generated before 4 commits
of geometry change (incl. `a9bd6e35`, which split `BEARING_RADIUS_KM` from `MATCH_RADIUS_KM`), and
`needs_geometry_refresh` has **no scheduled consumer** (referenced only by its own definition and
this script). The generator is committed and can regenerate at HEAD. This is housekeeping, not risk.

### 1.12 ⛔ HIGH — the loop guard for the vectorization that shipped yesterday executes **zero** interior points

`tests/test_vector_blockmean_loop_shadow.py:91`. Instrumented `_interior_mask` during the real
pytest run:

```
calls 434 | points through the batch forms 31,128 | INTERIOR 18 (0.06%) | DELEGATED 31,110 (99.94%)
   ...and all 18 interior points come from the control's own direct half=2 call, not the fetch loop
_interior_mask(12, 24, half=60) -> interior 0 / 12
CONTROL - production is the exact complement:
   global coarse res 10, half 20 -> 612/612 = 100.0% interior
```

**The guard covers 0% of the code path that produces 100% of production's regridded values**, across
all three real resolutions. Its unique claim — *"the real `fetch_global_coarse`, both flag states,
byte-identical payloads"* — is true only of the delegated branch. This is the third instrument in
this repo found to test nothing, and it is guarding the flag flipped `bafb5903`.

⚠️ Note this does **not** impeach §2.2: the independent differential (8,400 reductions, interior
points forced) is what establishes the math is right. It impeaches the *wiring* guard, not the math.

### 1.13 ⛔ HIGH — `rating_transform_grid` is a per-cell physics loop inside the request, on the event loop

`grid_resolver_surf.py:100`. Measured directly at each size (cold, never-seen coordinates — not
extrapolated):

```
   841 cells  0.218 s      5,041 cells  0.499 s
19,881 cells  3.977 s     80,089 cells 18.313 s        warm re-run of the same coords: 0.403 s
```

Attribution over 20,164 fresh coordinates — **the cost is 100% cold bathymetry lookup, not math**:
`is_coastal` 151.0 µs cold vs 0.92 warm (163×), `shelf_depth_at` 217.6 vs 0.58 (**375×**),
`shelf_width_km` 212.6 vs 0.34 (**624×**), `shore_normal_at` 147.9 vs 0.26 (**574×**).

**Denominator: 2.912 s is 14.6% of `GRID_SERIES_DEADLINE_S` (20 s), consumed before a byte is
serialised, and 1.42 s of it is a synchronous blocking call inside an `async def`** — §1.1's class
again, at a third site.

★ **This is the first genuinely CPU-adjacent serving-path hot loop any audit here has found — and it
still is not physics.** It is cold-cache geometry I/O. The fix is warming or bulk-vectorising the
bathymetry lookups, not accelerating an equation.

### 1.14 ⚠️ MEDIUM — `FETCH_VECTOR_BLOCKMEAN` buys nothing on the lane it is enabled for, and the win is in the lanes it is not

The asked measurement, both previously-unpriced lanes, at real native grid dimensions
(721×1440, 30% NaN, both paths warmed, min-of-5):

| lane / resolution | speedup | Δ per run |
|---|---|---|
| NOAA global **coarse** (half=20, 612 pts) | **0.99×** (5 trials: 1.00/0.92/1.04/0.98/0.99) | none, +80 MB transient peak |
| `dwd_gwam` global coarse (half=20, 57 steps) | **0.8×** | **−2.6 s** |
| `dwd_gwam` **global_mid** (half=4, 14,940 pts) | **10.6×** | **+198.1 s** |
| `dwd_gwam` pilot (half=1, 609 pts) | **47.4×** | +2.1 s |
| `ecmwf_opendata` (mid-res) | — | remainder of **~291 s/run total** |

⛔ **And it kills the tempting version of the change: 11 of the 14 call sites are in the coarse
lanes, where wiring it returns −2.6 s.** The entire ~291 s available is in the **mid-res** lanes.

### 1.15 ℹ️ LOW — "bit-identical by construction" is false, and the parity guard sits on its own noise floor

40 fresh seeds of the parity suite's own fixture shape: bit-identical rate ranges **41.4%
(`partition_conf`) to 79.9% (`direction_block`)**, not 100%. `multi_dir` exceeds the suite's
`TOL = 1e-12` on **3 of 40 seeds (7.5%)**, max observed 1.08e-12.

**No served value is at risk** — the 4-dp payload quantum is 5e-5, eight orders above the largest
observed difference. The cost is a 7.5%-per-reseed false-failure rate on the only guard covering the
batch math, plus a documented claim a successor would reasonably rely on.

### 1.16 ℹ️ THE CLASS BEHIND §1.2's latent gates — 351 of 353 route response models silently drop undeclared keys

AST over `backend/routes/`: **353** pydantic `BaseModel`s, **2** declare an `extra` policy. Pydantic
v2's default is `extra='ignore'`, so every one of the other 351 discards producer keys it does not
declare, with no error and no log line.

⚠️ **Stated as a mechanism, not an exposure** — per this repo's own rule. Only one instance is known
to bind (§1.2 latent 1). The value of the count is that it says **the fix is a contract-test pattern,
not a one-line field addition** — which is what `test_spot_rating_wire_contract.py` already exists to
be, and which §1.5 shows cannot currently see the idiom.

---

## SECTION 2 — COMPETITIVE ADVANTAGES & STRENGTHS (preserve these through any upgrade)

### 2.1 ★★★★ The composition chain is fast, correct, singular, and it replicates — **do not touch it**

| stage | measured at HEAD |
|---|---|
| `resolve_surf_geometry` cold | 190.96 ms once |
| `resolve_surf_geometry` warm | **0.0139 ms** |
| `estimate_surf_at`, geometry reused | **10.97 µs** |
| `compute_surf_rating` | **8.03 µs** |
| `rating_factors` (**evaluated twice per spot**) | 8.88 µs |
| **full composition per spot-hour** | 19.01 µs direct · 2.79× the height half interleaved |
| **779 served spots × 168 h** | **2.50 – 3.94 s of CPU, total** |

⚠️ **Two of our own numbers disagree, and the gap is informative rather than an error.** The direct
run (2.50 s) counts each stage once; the interleaved run (3.94 s) also counts the **duplicate
`rating_factors`** — 1.16 s, **29% of the whole chain's CPU**, recomputing nine factors the call one
line above already produced (`spot_ratings.py:186`). Quote **3.94 s** as the ceiling. It changes
nothing about the conclusion and it is the only known avoidable waste in the chain.

**Control:** Pipeline at 12 m / 18 s / 315° returns **29.50 ft** — matching the recorded post-fix
anchor exactly (legacy-restore would give 45.52 ft). The shipped γ 0.81 + `REFRACTION_KR` 0.797 pair
has not drifted.

### 2.2 ★★★★ The vectorized regrid holds under an *independent* adversarial differential

Not the author's parity suite — 8,400 block reductions per function across 60 random grids, NaN
fractions 0/0.1/0.35/0.8/0.98, planted antipodal cancellation, planted all-NaN and zero-height
blocks, forced edge+interior point sets, wrap and non-wrap, `half=1..3`:

```
NaN-classification mismatches : 0
conf_present mismatches       : 0     (the None-vs-0.0 confidence contract holds)
max |vec - scalar| : height 8.882e-16 · dir 1.137e-13 deg · multi_d 6.359e-13 deg
```

The scalar oracle is retained (`FETCH_VECTOR_BLOCKMEAN=0`) and the flag is read **per call**
(`noaa_gfs_wave_fetcher.py:65`), not at import — so it is genuinely flippable at runtime.

### 2.3 ★★★★ The highest prior-probability defect in the new code is **not** present

The obvious way to get the ensemble wrong is to divide an **offshore** standard deviation by a
**breaking** mean — inflating the percentage by a geometry factor this repo has measured at −18.7% to
+92.7%. Both call sites pair the spread with the offshore height:
`spot_ratings.py:103` (`offshore_h = marine.point.speed`) and `spot_conditions.py:449`. No breaking
height reaches either ratio. **This was designed correctly and deserves to be said.**

### 2.4 ★★★ Refusal semantics are real, not decorative — under adversarial controls

```
spread_from_members: []->None  None->None  [1.5]->None  [1.5, nan]->None
                     [1.0,2.0,inf] -> (1.5, 0.5, 2)     <- inf dropped, n honestly reported as 2
```

Likewise `wave_physics.steepness()` returns `None` never `0.0`, and the 299 missing break depths are
a **deliberate refusal** below `_MIN_TRUSTWORTHY_DEPTH_M = 3.0`, not a gap.
⚠️ One asymmetry to note: two identical finite members yield `(1.5, 0.0, 2)`, which grades `high` at
0% relative spread — defensible, but the member **count** is computed and then discarded at emit, so
a consumer cannot tell an n=2 spread from an n=5 one.

### 2.5 ★★★ ONE FORECAST COMPOSITION genuinely holds, and 9.0's censuses replicate exactly

Every surface reaches the height through `surf_point.estimate_surf_at`; the sim is a consumer, not a
second implementation. And all three of 9.0's nearshore censuses replicate at HEAD by execution:
bed slope p50 0.0074 / p90 0.1348 / <0.01 = 57.7% / >0.07 = 18.5%; break depth 1087 with, **299 null
= 21.6%**; readiness **full 1074 / degraded 312 / blind 0**. *(A census that replicates is worth
recording — it means the 9.0 numbers can still be quoted.)*

### 2.6 ★★★ `science_registry.py` — constants that carry provenance **and** their own contradiction

Every constant declares `value`, `units`, `source` and a validity range. It also **documents its own
strongest self-contradiction** (the `BATTJES_STIVE_GAMMA_MAX` entry) rather than hiding it. This is
what made §3.1's correction possible at all.

### 2.7 ★★★ The shore normal is the strongest geometry input **and** already sub-kilometre

It binds on 100% of served spot-hours and is a 463 m ETOPO-2022 fit (99.6% `etopo` inside the asset).
The brief's "does bathymetry match sub-km capabilities" question is answered: **the input that
matters already is sub-km; the ones that are coarse are the ones that barely bind.**

### 2.8 ★★★ The pooling fix landed in **6 of 6** eligible fetchers — and a naive scan says otherwise

This audit went looking for the repo's signature defect (a fix landing in 5 of 7) and **did not find
it**. Each of the six byte-range GRIB fetchers has exactly one `http_session()` call and **zero**
module-level `import requests`.

⚠️ **A scope-blind AST scan reports 4 "bare" `requests.get/head` calls per fetcher and is wrong.**
The name `requests` is **rebound** to the pooled session (`requests = http_session()`,
`noaa_gfs_wave_fetcher.py:281`) and threaded through as a parameter
(`def _pick_cycle(requests, ...)`). A scope-aware scan resolving the binding at each call site found
**BARE = 0 in all six**. `ecmwf_opendata` and `copernicus` make zero `requests.*` calls at all (they
use client libraries), so six is the whole eligible set.

★ **Worth recording as a method note: a rebound name defeats grep AND a naive AST scan.** Had this
audit trusted either, it would have reported a fix as half-landed when it was complete.

Likewise, **9.0 §1.1 is genuinely fixed** — a full AST scan of every `async def` in `routes/` and
`services/` found zero un-offloaded `requests.*` / `time.sleep` / `subprocess.*` on any serving path,
and `weather.py` alone now carries 10 `to_thread` wraps. §1.1 above is a **different site**, not a
re-report.

### 2.9 ★★ Tests were strengthened, not weakened, in the audited range

`test_websocket_endpoints_auth.py` moved from `pytest.raises((WebSocketDisconnect, Exception))`
(which is just `Exception`) to pinning `excinfo.value.code == 1008`; `MockWebSocket` gained
`close()`/`accept()` so "accepted then closed" is now distinguishable from "never accepted".
`test_ecmwf_period_bands_decode.py` correctly moved from `last_params` to `all_params`. There is no
third live site of the 512 MB memory-limit assumption.

---

## SECTION 3 — REGRESSION RISK MATRIX

| # | proposed change | regression risk | automated guardrail required **before** merge |
|---|---|---|---|
| **A** | `to_thread` the product `json.load` (§1.1) — 3 edits: `_fetch_common.py:737`, `noaa_marine_service`, sibling | **LOW** | Assert a co-tenant coroutine still ticks while a stubbed multi-second product read runs. Today that test fails. Same shape as the guard `6dd720eb` already added — **extend `test_event_loop_offload_guard.py` to ban the shape file-wide rather than at one site.** |
| **B** | Carry `speed_spread` on the three `nearest_*` sampler branches (§1.2 root) | **LOW** | An **executing** test: build a product whose vectors carry `speed_spread`, sample a real off-node spot coordinate through `PointSampler.sample_point`, assert `point.speed_spread is not None`, with the corner case as control. **0 of 40 tests in the arc do this today.** |
| **C** | Declare `forecast_confidence` on `SpotRatingItem`; add it to `/conditions`'s `current` (§1.2 latent) | **LOW** | Fix `_producer_return_keys` first (row D) — otherwise the guard still cannot see the field it is guarding. |
| **D** | Teach the wire-contract guard to see `**` unpack keys (§1.5) | **LOW** | `zip(keys, values)`; when `k is None`, `ast.walk` the value for nested `ast.Dict` and union their constant keys. Raise the setup floor from 10 to 17. Control: the guard must **fail at HEAD** before the row-C fix lands. |
| **E** | Make the coverage floor unconditional and count `steps_ok*3` (§1.4) | **MEDIUM** | Keep the two-case harness as a permanent test: all-succeed (control, must pass) and 503-every-step-but-one (must now refuse). Assert the refusal does **not** supersede the previous healthy product. |
| **F** | Import the real component in the frontend confidence test (§1.6) | **LOW** | Export `confidenceDot`/`confidenceLabel`/`CONFIDENCE_TEXT` and render real `<SpotConditions>` with a mocked client; assert the three theme dot classes are mutually distinct **through the component**. |
| **G** | Fix `coastal` for the 18 open-ocean spots (§0b.3) | **MEDIUM** | Owner-anchor harness **plus** a served-height delta census — the harness is blind to directional change. Assert Soup Bowl's breaking height ≠ its offshore height, with Pipeline as the unchanged control. **This moves served values: it is a correction, but it is a visible one.** |
| **H** | Wire tide into the depth cap (§0b.2) | **HIGH** | Behind a default-off flag. Offset **`_cap_depth` only**, never `depth_m` (a ~139 km median where a metre is meaningless). Guardrail: assert ≥98.3% of served spot-hours are bit-identical with the flag on and water level 0.0, and that the movers are exactly the cap-binding set. |
| **I** | Delete `shore_normals_overlay.json` (§1.7) and `geometry_backfill.{sql,json}` (§1.11) | **LOW** | A test that fails when an untracked, gitignored file on the `SHORE_NORMAL_*` overlay path is non-empty — so a local scratch overlay can never silently join a measurement run again. ⚠️ **Do NOT add a `_MAX_TRUSTWORTHY_DEPTH_M` guard on the strength of the 39.0 m value** — §1.11 shows 13.0% of shipped depths already exceed it; such a guard would refuse data that is currently served. |
| **J** | Thread the salvaged step list to `ensemble_spec` (§1.9) | **LOW** | Fetcher test whose fake raises on the first deterministic retrieve; assert the member request's step list equals the salvaged list and the SUMMARY distinguishes "skipped" from "absent". |
| **K** | Semaphore on `explore.py:477` (§1.10) | **LOW** | Match the sibling default so one box-wide number governs both. |
| **L** | Rebuild the bed slope at surf-zone resolution (9.0 row F′) | **N/A — DEPRIORITISED** | ⛔ **Reprioritised down by §3.1: it can change at most 0.09% of served spot-hours, and 9.0's proposed distribution guardrail would have been written against the wrong population entirely.** |
| **M** | γ / `REFRACTION_KR` / `SURF_HEIGHT_H110` | **CRITICAL** | ⛔ Do not touch. Legacy-restore control must give Pipeline **45.52 ft**; shipped gives **29.50 ft** (re-verified this session). Separate ERA5-gated workstream. |
| **O** | Make the vectorization loop guard exercise interior points (§1.12) | **LOW** | Assert `_interior_mask` yields >0 interior points during the fetch-loop test — i.e. instrument the guard's own coverage. It must **fail at HEAD** (18 of 31,128 = 0.06%, none from the loop). Raise the parity `TOL` off its noise floor (§1.15) or reduce the claim from "bit-identical" to a stated bound. |
| **P** | Warm / bulk-vectorise the bathymetry lookups behind `rating_transform_grid` (§1.13) | **MEDIUM** | Product-hash equality against the current per-cell path over ≥20,000 fresh coordinates, plus an assertion that the cold 80,089-cell case lands under a stated fraction of `GRID_SERIES_DEADLINE_S`. Offload the synchronous 1.42 s call as part of row A. |
| **Q** | Extend `FETCH_VECTOR_BLOCKMEAN` to the **mid-res** `dwd_gwam` / `ecmwf_opendata` lanes (§1.14) | **MEDIUM** | ~**291 s/run**, all of it in mid-res. ⛔ **Do not wire the coarse lanes** (11 of 14 call sites) — measured −2.6 s and +80 MB transient. Same differential-vs-oracle guard as the NOAA lane, with row O's interior-point coverage fixed first or the guard repeats the same blindness. |
| **R** | Drop the duplicate `rating_factors` evaluation (§2.1) | **MEDIUM** | 29% of chain CPU, but the chain is 4 s — **this is a tidiness item, not a performance one.** Guardrail: byte-identical served scores across the full spot set. Do not ship it as a "speedup". |
| **N** | JAX / GPU / neural emulator | **N/A — DO NOT BUILD** | 3.94 s of CPU for the entire global forecast, both halves, duplicate included. |

### 3.1 ⚠️ A CORRECTION TO MASTER-AUDIT-9.0 §3.2/§3.3 — it censused a slope the served chain never passes

`estimate_surf` feeds `breaker_index` a **live proxy**, `_slope_proxy = depth_m/(shelf_width_km*1000)`
(`surf_transform.py:465`) — **never** `bathymetry.bed_slope_at`. The 12.96 MB asset reaches
`breaker_index` at **zero call sites**.

| population | p50 | p90 | above `WEGGEL_SLOPE_VALIDITY_HI = 0.07` |
|---|---|---|---|
| **live proxy (what the formula actually receives)** | **0.0029** | 0.0709 | **10.1%** |
| bed-slope asset (what 9.0 censused) | 0.0074 | 0.1348 | 18.5% |

Paired n=1272, log-corr 0.789, proxy/bed ratio p10 0.08 / p50 0.36 / p90 3.01 — **an order of
magnitude apart in both directions.** So "18.5% out of validity" describes a quantity that is not the
one being fed to the Weggel-class formula; the real figure is 10.1%. **And 9.0's proposed F′
guardrail — "assert the rebuilt population is ≥X% inside 0.01–0.07" — would have passed while the
live input stayed out of range.**

---

## SECTION 4 — INCREMENTAL "ZERO-REGRESSION" UPGRADE PATH

Ordered by **(measured reach × confidence) ÷ (risk × cost)**. Every phase is independently shippable
and revertible. Nothing here touches a physics constant.
⚠️ **Every push to `dev` is a production backend deploy (5–30+ min) — batch each phase into one push.**

### PHASE 0 — the event-loop stall, and delete the two stale artifacts (~1–2 h) · **START HERE**

Row **A** (the 7.09 s `json.load` — the single largest measured latency defect at HEAD) and row **I**
(delete `geometry_backfill.{sql,json}` + the untracked overlay). A is behaviour-preserving by
construction; I removes a live corruption of the measuring lane. **Do I first** — every measurement
in Phase 1+ is taken on this workstation.

### PHASE 1 — make the ensemble reach a screen (~1 day) · rows **D → B → C → F**

**In that order, and the order is the point.** D first, because the guard must be able to see the
field before it can protect it (and must fail at HEAD to prove it). Then B (the root), then C (both
latent wire gaps together), then F (make the frontend test exercise the real component).

★ Only after all four does *"load a EURO spot hub and look"* become a meaningful action. Until then a
browser check returns a false negative.

**Then, and only then, the two open calibration questions become answerable:** the 15%/35% thresholds
are still `"calibrated": false`, and `forecast_skill.py` accruing paired leads is what would make them
defensible.

### PHASE 2 — the data-integrity guards that are currently unable to fire (~1–2 days) · rows **E, J, K**

E is the highest-value of the three: a 99.1%-null product that ships claiming a 336 h horizon and
supersedes a healthy one is a silent whole-lane data loss. J and K are small and go in the same push.

### PHASE 3 — the 18 open-ocean spots (~1 day, owner-visible) · row **G**

Bounded, enumerable, and it is CLAUDE.md's first binding rule failing in production. **This changes
served values at 18 spots** — it is a correction, not a regression, but it should ship with the delta
census attached and the owner told.

### PHASE 4 — tide into the depth cap (~3–5 days, flagged) · row **H**

The highest-reach absent nearshore term at **1.694% of served spot-hours, median 45.6%** — 19× the
slope/γ thread — with its input already in the repo. Default off, `_cap_depth` only, ≥98.3%
bit-identity assertion as the guardrail.

### PHASE 4b — the ingest speedup that is actually available (~2–3 days) · rows **O → Q**

**O before Q, and that ordering is the whole lesson of §1.12:** the guard that is supposed to protect
this change currently exercises 0.06% of the path, none of it from the fetch loop. Fix the guard's
coverage (it must fail at HEAD), *then* extend the flag — and only to the **mid-res** lanes, for
~**291 s/run**. Wiring the coarse lanes, where 11 of the 14 call sites live, measured **−2.6 s**.

### PHASE 5 — resolve the ICON/weather publish gap (~1 day of measurement first) · §1.8

⚠️ **Do not fix before measuring.** Log the manifest's per-lane `run_time` immediately before and
after each publish for one cycle; that single instrument distinguishes the last-writer-wins
hypothesis from every alternative. **The paging monitor has been correctly red for 11 h — the alert
is working; the response to it is what failed.**

### ⛔ EXPLICITLY NOT ON THIS PATH

- **JAX / PyTorch / neural emulation** — 2.50 s of CPU, both halves (§2.1).
- **GCN / nested nearshore grids / Zarr for products** — the depth grids are multiplied by zero on
  54.32% of coastal served spot-hours (§0a); the OOM they would have served was closed on 08-07.
- **Rebuilding the bed slope; flipping `RATING_BREAKER_TYPE`** — ≤0.09% reach (row L, §3.1).
- **Any change to γ, `REFRACTION_KR`, `SURF_HEIGHT_H110`** — row M.
- **Propagating the soft-deadline salvage** — closed 08-07; the six lanes run at 3.3–36.1% of kill.

### OWNER-GATED — unchanged, and none of them moved this session

| # | item | what it needs |
|---|---|---|
| 1 | Production frontend frozen at `3bd38a83` (2026-05-20); 6 of 6 `/api/*` 404 in prod | one Netlify dashboard screen |
| 2 | Vercel fails 8/8 prod + 6/6 preview | disconnect the integration |
| 3 | `RATING_LOCAL_SIZE` | a product decision (rarity axis, never a score multiplier) |
| 4 | Seeded `dev-mock-user-id` profile (`is_admin=True`, 100 credits) still a row in the production DB | owner action |

---

## §5a ⛔ LIVE ESCALATION DURING THIS SESSION — ICON/weather crossed the critical bound

A monitor armed at the start of this audit watched `/api/health/data` every 2 minutes. Over the
session the ICON/weather lane aged from **11.6 h → 12.1 h**, and at 12.0 h the pipeline status went
**`warn` → `critical`**:

```
03:2xZ  EURO/marine 2.4h | ICON/weather 11.6h | status=warn
...
04:0xZ  EURO/marine 2.9h | ICON/weather 12.1h | status=critical
```

This is §1.8 progressing in real time, not a new finding. It is **not caused by anything in this
session** — the lane has been stale since 2026-08-06 ~16:00Z and the Data Health Monitor has failed
every run since 16:30Z. But it now clears the repo's own paging bound, and the next ingest cycle is
the thing to watch.

★ **The alert worked. Every part of the response to it failed** — four consecutive red runs across a
30-commit session, in a repo whose own rule is that a stale blocker is invisible.

---

## §5b WHAT WAS FIXED IMMEDIATELY AFTER THIS AUDIT (same session, separate commits)

The audit is read-only; these landed after it, each with a guard that was **made to fail first**.

| row | what | evidence it is load-bearing |
|---|---|---|
| **D** | `_producer_return_keys` now recurses into `**` unpack values; floor 10 → 17 | the guard **failed at HEAD** naming `forecast_confidence` before any declaration was added |
| **B** | `speed_spread` carried on the three `nearest_*` sampler branches | mutation: setting it back to `None` fails the new test, naming `nearest_ocean_coarse_masked` |
| **C** | `forecast_confidence` declared on `SpotRatingItem`; added to `/conditions`'s `current` | mutation: renaming the key fails the new route test |
| **A** | `json.load` moved off the event loop at **3** GRIB-product sites (`_fetch_common`, `noaa_marine_service`, `copernicus_marine_service`) | AST scan of `json.load` inside `async def` without a thread boundary: **54 → 52**, and none of the three files remains |
| **I** | the three stale untracked artifacts retired to scratchpad | `resolve_surf_geometry` at the five overlay coordinates now returns what production returns |
| **G** | the 18 open-ocean spots — `coastal` promoted by fitted shore-normal evidence | mutation: **5 of 7 guards die** with the promotion removed, naming Soup Bowl, Kandooma and Noronha |
| **E** | the coverage floor made unconditional **and** given a metric that responds | mutation: fixing **only the gate** kills the identical 5 guards — both halves were required |
| **H** | tide reaches the depth-limited cap (physics only, `SURF_TIDE_DEPTH` default **OFF**) | **5,544 cells byte-identical** flag-on vs flag-off; 3 mutations, one of which found a hole in my own suite |
| **O** | the vectorization loop guard now enters the branch it guards | coverage **0.06% → 92.11%** interior, measured by instrumenting the real run; **zero production lines changed** |

**Row O — the guard was blind, and its own control was the reason.**
`half = max(1, round(resolution / 0.25 / 2))`, so the suite's 30° payload ran at **half=60** against a
12-row stub grid, where `r − 60 ≥ 0` can never hold. Instrumenting the real pytest run:

```
points through the batch form : 31,128
INTERIOR (vectorized)         :      18   (0.06%)   <- ALL 18 from a fixture control's own
DELEGATED (scalar)            : 31,110   (99.94%)      direct half=2 call, not the fetch loop
PRODUCTION, same function     :          100.0% interior at all three shipped resolutions
                                         (coarse half=20, global_mid half=4, pilot half=1)
```

**The guard for a flag that is ON in production covered 0% of the path producing 100% of
production's regridded values**, and its "shadow comparison" was the scalar path against itself.

★★★ **THE ROOT WAS THE CONTROL, NOT THE FIXTURE.** `test_the_harness_actually_exercises_both_batch_
branches` called `_interior_mask(..., half=2)` **hard-coded** and asserted the *grid* has an interior
at that half — true, and irrelevant. It answered *"could this grid have an interior at some half?"*
when the question was *"did the run take the interior branch?"* ⇒ **a guard that asserts on a proxy
for its subject instead of its subject.** The 18 interior points in the entire suite were the 9 that
control produced, twice — because an **orphaned duplicate** of it (a bare string literal in statement
position plus a repeat of the assertions) had been appended to a different test.

Fixed: the control now **derives `half` from the resolution** and additionally pins that the 30° case
still delegates; a new test **instruments the run** rather than the fixture; the duplicate is removed;
the module docstring's false claim is corrected. Mutation: reverting `_INTERIOR_RES` to 30° fails,
quoting *"entered the batch form 7,776 times and took the VECTORIZED branch ZERO times."*

⚠️ **No production code changed.** The vectorization math was already correct — §2.2's independent
differential (8,400 reductions, max |diff| 8.9e-16) is what establishes that. This fixes the *wiring*
guard, which is the prerequisite for row Q.

### 5b.1 ⚠️ ROW Q RE-PRICED BEFORE BUILDING — and two of its premises do not replicate

Measured at HEAD on the **real per-lane variable mix** (not one reduction), 721×1440 native, 30% NaN,
both paths warmed, min-of-2, with `tracemalloc` on the gather:

| lane | half | npts | steps | speedup | **saved s/run** | peak MB |
|---|---|---|---|---|---|---|
| NOAA coarse | 20 | 612 | 113 | 1.10× | 1.5 | 24.5 |
| **NOAA global_mid** *(already wired)* | 4 | 14,940 | 113 | **12.51×** | **264.8** | 24.2 |
| GWAM coarse | 20 | 612 | 57 | 1.13× | 0.9 | 24.5 |
| **GWAM global_mid** | 4 | 14,940 | 57 | **10.10×** | **90.1** | 24.2 |
| GWAM pilot | 1 | 609 | 17 | 76.26× | 1.0 | 0.1 |
| EURO coarse | 20 | 612 | 65 | 1.16× | 0.7 | 24.5 |
| **EURO global_mid** | 4 | 14,940 | 65 | **9.26×** | **53.5** | 24.2 |

**1. The INCREMENTAL win is ~146 s/run, not 291 s.** The 412.5 s total includes NOAA's 264.8 s, which
is **already realised** — NOAA is the one lane already wired. Row Q's actual scope (GWAM + EURO) is
**≈146 s/run**, about half what was recorded.

**2. "Coarse loses (0.8×, −2.6 s)" does not replicate.** Coarse measures **1.10–1.16×** on every lane
— a small but positive win. ⇒ **The "mid-res only" gate the audit prescribed is unnecessary**, and
the design question it implied (gate on `half`? on point count?) dissolves: wire both fetchers
wholesale. *(The original 0.8× may have been a different reduction subset; `multi_dir_conf` is not in
this mix and its 80 MB transient is unre-measured.)*

**3. Memory is a non-issue at these sizes** — 24.2–24.5 MB peak for height+scalar, not the 80–191 MB
feared. ⚠️ `multi_dir_conf` was **not** measured here; price it before wiring that one.

⛔ **AND THE DENOMINATOR SAYS THIS IS NOT URGENT.** GWAM runs at **23%** of its 1800 s kill (414 s
observed) and EURO at **27%** (485.7 s, measured live this session). 146 s takes them to ~18% and
~24%. **The saving is real; the risk it removes is approximately zero**, because neither lane has
ever been near its ceiling. This is an efficiency item, not a reliability one — which is exactly the
distinction that killed five builds on 08-06, applied to a change I was about to make myself.

**Recommended scope when it is picked up:** wire `dwd_gwam_fetcher` first (90.1 s, and its four
reductions sit in one point loop at lines 256–265, the same shape NOAA already solves at 467–486),
then `ecmwf_opendata_fetcher` (53.5 s). ⛔ **Each needs its own loop-shadow guard with the row-O
coverage assertion** — a wiring change protected by a guard that never enters the branch is strictly
worse than no change.

**Row E — the Jacobian lens pointed at an INSTRUMENT rather than at physics.** The floor was both
**gated off** (only the soft deadline set `truncated_at`) *and* **blind** (`covered_h` counted
`times`, which the failure branch also appends to). Measured on the real loop with the deadline
deliberately never binding:

```
ok_steps  failed   covered_h(old)   null_frac      d(covered_h)/d(steps_failed) = +0.000
   113       0          336            0.0%        d(null%)    /d(steps_failed) = +0.885
     1     112          336           99.1%   <- shipped, claiming a 336 h horizon
```

★★★ **An instrument whose derivative with respect to its own subject is zero cannot detect it** —
and this was *proven*, not asserted: **mutation 2, fixing only the gate, kills the identical five
guards**, because the floor then computes 336 ≥ 120 and waves everything through. After: 20/5/1
ok-steps refuse; 60 (177 h of ladder) still ships, so the 08-02 salvage is preserved.
⚠️ **The floor exists in 1 of 9 fetchers and was deliberately NOT propagated** — six siblings can
also ship partial products, but that is a claim about code; the exposure needs each lane's observed
failure rate and prune semantics, and neither is measured.

**Row H — tide, the highest-reach absent term, shipped dark.**
Datum: `sea_level_height_msl` is signed metres about MSL and ETOPO break depths are MSL-referenced,
so `cap = γ·(d + η)` is consistent. The term is **sharply selective**, which is the evidence it is
modelled rather than fudged — measured `dFt/dη`:

| case | sensitivity |
|---|---|
| 2 m / 12 s on a **3.5 m** reef | **+1.416 ft/m** |
| 4 m / 16 s on a **3.5 m** reef | **+2.657 ft/m** |
| 6 m / 18 s at Pipeline's **11.1 m** | **0.000 — inert** |
| 2 m / 12 s at the **p90 55.5 m** | **0.000 — inert** |

Reach is asymmetric because only *lowering* the cap can newly bind: η −1.5 m moves **6.80%** of
sampled cells (median −34.7%), η +1.5 m moves **2.77%** (median +44.4%). ⚠️ That frame is 462 asset
coords × 5 conditions weighted toward bigger surf — **not** the served distribution the 1.694% came
from. The floor is **mandatory, not defensive**: retained break depths bottom out at exactly 3.0 m,
so a spring low past −3 m drives the cap negative and `min(H, cap)` returns a negative height.

⭐⭐⭐ **MUTATION TESTING FOUND A HOLE IN MY OWN GUARD, AND THE FIRST MUTATION TAUGHT MORE THAN IT
CAUGHT.** A leak of the offset into `depth_m` (the shelf-friction median) passed all ten tests. The
first attempt to reproduce it was a **no-op** — `shelf_dissipation` consumes `depth_m` ~86 lines
earlier, so a leak at the cap block is unreachable; only one placed *before* that call binds, which
is exactly the edit a future author would make. Discriminating case, found by measurement: shelf
20 m / width 150 km, where Kf is neither saturated nor floored (leak −0.1705 ft, correct code
0.0000). ⇒ ★★★ **A MUTATION THAT SURVIVES MAY MEAN YOUR TEST IS WEAK — OR THAT YOUR MUTATION WAS
NOT REACHABLE. CHECK WHICH BEFORE TRUSTING EITHER.**

⚠️ **NO SERVING CALLER SUPPLIES A WATER LEVEL YET.** The physics is in and proven; the wiring
(feeding `tide.tide_state_at`'s `height_m` from `rate_one_spot` / `spot_conditions`) is a separate,
separately-priced step. A test records that state **by execution** and will fail the moment someone
wires it — which is exactly when the served delta census in row H must be run.

**Row G, measured in full — the mechanism, and the Jacobian that identifies it.**
`is_coastal` asks a **0.25° (~28 km)** mask whether any land sits within ±3 cells (~83 km). Measured:
**all 18 have land = 0 of 49 cells** — a small island does not fill a 28 km cell. Every one of the 18
carries `shore_normal_src='etopo'` with **`match_km = 0.00`**, a 463 m fit *at* the coordinate. **The
fine asset finds a shoreline at 0 km while the coarse mask finds none within 83 km, and the coarser
instrument was winning.**

★★★ **The forensic marker is the Jacobian, and it is why the guard asserts on it rather than on
values.** Before: `dFt/dHs` = **exactly 3.28084 ft/m, constant** — the metres→feet conversion, i.e.
the identity function, i.e. no transform ran. After: **4.676 → 3.190, decreasing** — shoaling
saturating toward a depth cap, and identical to the coastal control. A Jacobian assertion is
**scale-free**, so it survives the ERA5-gated constants moving; a hard-coded "6.6 ft" would not.

| census over all 1,386 asset coords | result |
|---|---|
| `coastal` promoted | **18 (1.30%)**, all `False → True`, all `etopo`, **0 demotions** |
| served height Δ | **+17.0% to +92.3%**, median **+45.8%**, **126 of 126 cells up, 0 down** |
| served score Δ | **+0 to +8.4**, level moves on **25%** of sampled conditions, all upward |
| the other **1,368** coords | **bit-identical in both height and score** |
| Pipeline anchor | **29.50 ft** — unmoved |

⚠️ **All 18 serve the same value afterwards** (9.56 ft at Hs 2.0 / Tp 12 on the normal) despite break
depths from **11.1 m to 352.0 m** — and a coastal control produces the identical number. That is not
the fix ignoring geometry; it is **§1.13 measured from another angle**: with the swell on the normal
and a deep shelf the chain reduces to Komar(Hs,Tp) × Kr and the depth grids do not enter.

⚠️ **The flag-lane parity guard caught an omission I made** — a rating surface may not read an
undeclared science switch. `SURF_COASTAL_FROM_SHORE_NORMAL` is now in `_RATING_FLAGS`; nothing else
caught it. ⚠️ `nearshore` is deliberately left alone: same mask at `radius_cells=1`, also false at
these 18, but `schemas.surf_nearshore` has **zero consumers** — no frontend reference, no backend
branch — so promoting it would change a value nothing reads.

⚠️ **REACH AFTER ROW B, WITH ITS DENOMINATOR — necessary, NOT sufficient.** `forecast_confidence`
goes from **0% → 20.0%** on the EURO/Iberia frame (n=30 live probes) and **0% → 4.8%** on GFS
`global_coarse` (n=1,103 served spot_ids). The majority path is **bilinear**, which refuses by
design. Carrying a bound there (max-over-corners, under its own field name) is an **owner decision**,
not a bug fix, and it is the single highest-leverage remaining item on this capability.

⚠️ **NOT fixed, and named rather than guessed:** the three `wind_ingestion.py` fallback-cache
`json.load` sites are the same class, but they are a colder path and **their payload size was never
measured** — so they are recorded, not fixed. Row E (the coverage floor), row G (the 18 open-ocean
spots) and row H (tide) are untouched.

---

## §5d ✅ VERIFIED LIVE — the first post-flip ingest ran, and the chain works end to end

Ingest `31151965864`, 05:51Z, at **`a6b443ec`** — the first cycle carrying both the ensemble flag and
this session's fixes. It succeeded, and it settles three items that were blocked all session.

**1. The EURO wave cost, finally measured on the Render box, not a CI runner:**
```
[ECMWF EURO-Waves] steps_ok=65 steps_failed=0  elapsed=485.7s   vs the 1800 s kill = 27% used
```
Comfortable. The 08-07 handoff's projection was ~569 s for the lane; the real figure is lower.

**2. The ensemble reaches served products.**

| product | run_time | vectors carrying `speed_spread` |
|---|---|---|
| `euro_marine_waves_global_mid` | 05:32Z | **798 of 924 (86.4%)** |
| `euro_marine_waves_florida_east_coast` | 06:19Z | **149 of 221 (67%)** |
| `euro_marine_waves_us_west_coast_socal` | 06:19Z | **96 of 153 (63%)** |

Spread at +7 d: min 0.020, **p50 0.164**, p90 0.517, max 1.253 m — matching the recorded CI figure
(p50 0.167 m at +120 h). ⚠️ `iberia_west` and `hawaii` are still the **pre-flip 01:46Z** tiles; they
refresh on the pilots cadence (03/11/19Z), so a European spot carries nothing until then.

**3. ⭐ THE ROW-B FIX IS WORKING IN PRODUCTION, AND THE PREDICTED REACH HELD.** Six real spots inside
spread-carrying tiles:
```
Fort Pierce FL      nearest_ocean_fallback   spread=0.0468   <- the path fixed in 57c657f9
Sebastian Inlet FL  bilinear_ocean_masked    spread=None
Deerfield Bch FL    bilinear_ocean_masked    spread=None
Trestles CA         bilinear_ocean_masked    spread=None
Blacks CA           bilinear                 spread=None
Huntington CA       bilinear_ocean_masked    spread=None
```
**1 of 6 = 16.7%**, inside the **4.8–20%** band predicted from the pre-fix census. Before the fix it
was **0 of 1,103**. The remaining ~83% is bilinear, which refuses **by design** — that is the owner
decision named in §5b, and it is now the only thing between here and full coverage.

⚠️ **A SEVENTH SAMPLER PATH SURFACED THAT THE AUDIT NEVER ENUMERATED: `direct_point_api`.** Where no
regional tile covers the requested valid_time, the resolver bypasses the grid entirely and queries
upstream per-point — so it can never carry spread regardless of what the product holds. Measured at
Peniche: `bilinear_ocean_masked` at +1 d, **`direct_point_api` at +3 d and beyond**. Any future reach
number must count it as a third category, not fold it into "interpolated".

### ✅ AND ICON/weather RECOVERED — which is itself the natural experiment §1.8a needed

Same cycle: ICON/weather went **14.2 h → 0.7 h, status `critical` → `ok`**, and
`manifest_written_by` is now `designated:gh-run-31151965864` — **the main ingest itself**, because the
pilots run (03/11/19Z) did not overlap this time. The 01:38Z write was lost when the pilots were the
last writer; the 06:0xZ write survived when they were not. **That is direct support for the
shared-manifest lost-update mechanism** — obtained for free, without the instrument. ⚠️ It still does
not explain why the 01:18Z `GFS/marine` write survived the same clobber, so the instrument in §1.8a
is still what closes it. And the defect will recur on the next overlapping cycle.

---

## §5c WHAT THIS AUDIT DID NOT COVER — stated so it is not over-quoted

- **The nearshore denominators are a 250-coordinate sample of `shore_normals.json`'s 1,386**
  (seed 20260807, 249 usable), not the 779–1,005 actually-served spots — local `.env` points at the
  wrong Supabase project. Quote it as that or not at all.
- **One season, one window.** 2026-07-07 → 08-13, 912 h/coord, boreal summer: served Hs p50 0.84 m,
  p90 1.76 m, max 6.60 m; wind p50 6.4 kt, p99 18.9, max 32.4. **The 0.145% cap-binding rate is
  conditional on sea size** (Hs<1.5 m → 0.00%; Hs 2–3 m → 2.38%; Hs>4 m → 1.92%) and would rise in a
  winter window. It would not rise by the ~19× needed to overtake tide.
- **The 1,103-spot reach denominator is from 9 viewport requests** to `/spot-ratings`, which is a
  viewport sample by construction.
- **All local timings are Windows / py3.14.4 / numpy 2.4.4**; production is Linux / py3.12. Ratios
  transfer; absolute seconds do not. The live figures (`/api/health`, `/api/health/data`,
  `/api/weather/point`, `/spot-ratings`) are production and carry no such caveat.
- **§1.8's mechanism is not established** — deliberately. See the named next measurement.
- **No post-flip EURO ingest had run at audit time.** `b648098d` deployed 02:52Z; the newest EURO
  marine product was built 01:46Z, 66 min earlier, and correctly carries no spread. The first
  post-flip cycles are the 03:45Z pilots and the 04:15Z main ingest. **Nothing in §1.2 depends on
  that** — all three gates are upstream of any product.
- **Frontend / WebGL / shader path** beyond the confidence component — out of scope.
- **The two previously-unpriced GRIB lanes are now priced** (§1.14) — and 9.0's hypothesis that they
  carry the same win was **half right in a way that matters**: 10.6–47.4× in the mid-res lanes,
  **0.8× in the coarse ones**, which is where most of the call sites are. Benchmarks are synthetic
  arrays at real native dimensions, not live GRIB pulls.
- **§1.13's `rating_transform_grid` timings are local**, and cold-cache behaviour is exactly the
  quantity most sensitive to machine and filesystem. The 163–624× cold/warm *ratios* are the robust
  part; the absolute 18.3 s at 80,089 cells is not.
- **The physics-performance dimension's timings were taken on a loaded box** — an isolated run
  reported `compute_surf_rating` at 103 µs where the next said 11 µs, which is why it used
  interleaved drift-cancelling blocks. Ratios are trustworthy; single absolute readings are not.
