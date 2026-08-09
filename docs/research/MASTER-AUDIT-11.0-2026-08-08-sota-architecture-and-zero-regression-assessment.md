# MASTER AUDIT 11.0 — 2026-08-08 · SOTA architecture, numerics, pipeline & nearshore audit

**Scope:** read-only. No file under `backend/`, `frontend/`, `.github/`, `render.yaml` or any config was
modified, and no production state was mutated. Measurement harnesses were written to a scratchpad
outside the repo.

**Method:** twelve independent read-only audit dimensions, each followed by an adversarial verifier
instructed to *refute* the dimension's highest-severity findings using a **different method** and a
**stated control**, then a completeness critic that swept for uncovered subsystems. 34 agents,
0 errors. Every severity in Section 3 is the **verifier's corrected severity**, not the finder's.

**Baseline:** HEAD `b5afda92` at launch; several agents observed `1e37b003` mid-run (one commit later,
touching `science_registry.py` and `surf_rating.py` only — no finding below is affected).

---

## §0 WHAT THIS AUDIT IS FOR, AND WHAT IT REFUSED TO DO

Two SOTA architecture audits already exist (`MASTER-AUDIT-9.0`, `MASTER-AUDIT-10.0`), and 10.0 is
one day old. Re-deriving them would have been the failure mode, so the first dimension was
**"status of every prior finding at HEAD"**. That was the right call: **10 of 10.0's 16 Section-1
gaps are FIXED**, which means a naive re-audit would have reported ten closed defects as open.

Three threads stay closed on their existing evidence, and this audit **did not reopen them**:

| thread | status | why it stays closed |
|---|---|---|
| JAX / GPU / Numba / neural emulator | **CLOSED** | The entire global forecast is ~3.94 s of CPU. Confirmed again: the real serving cost is *lookup and scan*, not arithmetic. |
| Zarr / cloud-optimised ingestion | **CLOSED** | GRIB2 already streams via HTTP Range off `.idx` — a genuinely cloud-optimised access pattern. |
| Nested grids / AMR / SWAN / GCN coastal models | **CLOSED, and re-measured** | Finer bathymetry is the **lowest-value resolution lever by >20×** (Section 8). |

**What replaces them is not a technology.** Every one of the five highest-leverage items below is a
*composition, reach, or measurement* defect. That is the third consecutive audit to reach that
conclusion, and it is now the strongest signal in the record about where this platform's risk lives.

---

## SECTION 1 — EXECUTIVE ARCHITECTURE SUMMARY

| dimension | rating | one-line justification |
|---|---|---|
| **Architecture maturity** | **Strong** | ONE FORECAST COMPOSITION genuinely holds — `surf_height_m` has exactly **one** production write site backend-wide, and three rating surfaces agree numerically under a `settrace` control proving all three ran. |
| **Numerical / physics maturity** | **Strong** | Dispersion solve converges to machine precision (worst relative residual **6.3e-16** over 210 (Tp, depth) pairs, 0 non-convergences). Constants carry provenance and validity ranges. Two composition-seam defects, no kernel defects. |
| **Performance maturity** | **Adequate** | No algorithmic crisis, but four CPU blocks of identical shape run bare on the serving event loop, and `/grid_series?surf=1` costs **20× surf=0** in production. |
| **Data-pipeline maturity** | **Adequate** | Fetch half is good (Range streaming, pooling in 6/6 fetchers, real refusal semantics). Plumbing half has no byte-count validation, no checksums, and a manifest guard that fails open silently. |
| **Nearshore modelling maturity** | **Adequate** | Six processes modelled for real; refraction is one global scalar; eight processes absent. **The binding constraint is input coverage, not physics.** |
| **Validation maturity** | **Lagging** | Real machinery exists (8,208 buoy residuals, 60 buoys, an operational metric set that refuses below n=10) — but the skill ledger has scored **0 rows since 2026-08-04**, and **0 of 8 scheduled workflows can go red on a forecast-accuracy regression**. |
| **Observability maturity** | **Critical** | **Zero runtime telemetry.** No OpenTelemetry, Prometheus, statsd, Sentry or structlog anywhere in `backend/`; none in `requirements.txt`; no `/metrics` route. This is why all thirteen audit passes had to hand-build harnesses. |

### The five highest-leverage improvements

1. **Restore the forecast-skill ledger (P0).** `forecast_skill.py:37,159-176` — the pending cap evicts
   rows before their target hour arrives. Production GitHub Actions logs show `scored=0` on every
   sampled run since **2026-08-04T12:36Z**; a pre-fan-out control run (30839909407, 08-03T19:53Z)
   shows `ledgered=354 scored=296` with all three leads populated. **Until this is fixed, the platform
   cannot answer "did this upgrade make the forecast better?" — which makes every other item on this
   list unverifiable.** ~10 lines, LOW regression risk.

2. **Add minimal runtime telemetry (P0).** A ~40-line ASGI middleware recording
   `(route template, status, elapsed_ms)` into a bounded in-process histogram, exposed on the
   **existing** `/api/health` payload. Not an APM. This is the missing denominator behind roughly a
   third of this audit's "not quantified" caveats.

3. **Fix the four event-loop blocks and the serial batch route (P1).** All LOW risk, all
   bit-identical: index `manifest.products` by `(model, domain, layer)`; replace the per-cell wind
   linear scan with a numpy `argmin` (**measured bit-identical over 3,055 probes**, 12–50× faster);
   move `copy.deepcopy` after the skip decision it precedes; cap and parallelise `/conditions/batch`.

4. **Close the 16 open-ocean spots and the break-depth coverage gap (P1).** 16 live spots publish the
   **offshore significant height as the surf height** — CLAUDE.md's first binding rule, broken in
   production. Disjoint from the 18 that 10.0 fixed, because 10.0's census enumerated the asset and
   these spots fail *by being absent from it*.

5. **Fix the JS/Python rating mirror before `SURF_PARTITIONS` is ever flipped (P1).** The client
   mirror is missing Python's `MIN_SWELL_ENERGY_SHARE=0.50` refusal — a **63.5-point** divergence,
   proven causal by a kill-switch control (level drift 5,501/34,035 → **0/34,035** at
   `RATING_MIN_SWELL_ENERGY_SHARE=0`). Dormant only because the flag is off.

---

## SECTION 2 — CURRENT ARCHITECTURE MAP

```
EXTERNAL SOURCES
  NOAA GFS wave/wind/pressure ...... noaa-gfs-bdp-pds.s3.amazonaws.com (GRIB2, HTTP Range off .idx)
  DWD ICON + GWAM .................. opendata.dwd.de/weather/{nwp,maritime} (GRIB2)
  ECMWF open-data (EURO) ........... ecmwf_opendata_fetcher.py — deterministic + a SEPARATE swh-only
                                     ensemble retrieve (5 members; the mean is discarded)
  Copernicus / CMEMS ............... copernicus_fetcher.py, copernicus_global_fetcher.py
  Open-Meteo forecast + marine ..... api/marine-api.open-meteo.com (also the competitor skill lane)
  NDBC buoys ....................... buoy_calibration.py (observations, 60 buoys)
        |
INGESTION  (GitHub Actions, decoupled; forecast-ingest cron '15 */4 * * *' = 6 runs/day)
  fetchers -> _fetch_common (pooling, sanitisation) -> _fetch_blockmean_vec (vectorised block reduce,
  bit-identical BY DELEGATION to the scalar path) -> normalizer -> schemas
        |
STORAGE   two tiers + one shared mutable index
  L1  ephemeral disk on the Render serve box   (~920 product files observed live)
  L2  Supabase Storage `weather-products`      (pretty-printed JSON)
  index: manifest.json — 16,132 entries / 12.2 MB compact / 16.1 MB uploaded
         + S2 run-keyed immutable copy + Postgres CAS pointer (parallel lane)
  guards: designated-writer gate, writer attribution, anti-clobber merge reconcile
        |
FORECAST PROCESSING / PHYSICS   ← THE MANDATED CHAIN, and it holds
  surf_point.resolve_surf_geometry(lat,lng) -> SurfGeometry
      depth (shelf median, FRICTION only) | shelf_width | coastal | shore_normal + PROVENANCE
      | magnet | break_depth (ETOPO ~463 m, the BREAKING CAP only) | nearshore | match_km
  surf_transform.estimate_surf(...)  -> nearshore BREAKING height
      Kf shelf friction -> shoaling Ks -> refraction Kr=0.797 -> exposure -> depth-limited cap
      (gamma 0.63/0.81) -> H1/10 convention (1.27)
  surf_rating.compute_surf_rating(...) -> 0-100 quality + rating_factors decomposition
  point_surf_augment.py:204 — THE ONE production write site for `surf_height_m`
        |
DISTRIBUTION
  /api/weather/{point,grid,grid_series,spot-ratings,products,status,capabilities,buoy-calibration}
  /api/conditions/{spot_id}, /conditions/batch, /conditions/forecast/{spot_id}
  /explore/spot-details  (the route the spot hub actually uses — returns 17/17 producer keys)
  363 pydantic BaseModels under backend/routes; 37 carry response_model=
        |
CLIENT
  React + WebGL marine engine; score/physics texture split; caller-aware global-grid cache guard;
  a hand-maintained JS mirror of surf_rating.py for the map infobox (parity-gated on 6 of 12 args)
```

**Failure domains.** Supabase down → L1 continues serving until the box restarts. One model lane
fails → the lane degrades honestly (`far_edge_hold`, wind gates, product selection). The **single
shared mutable `manifest.json` is the one true single point of failure**; it is guarded, and the
guard fails open (§3.9).

---

## SECTION 3 — CORE SYSTEM ARCHITECTURE GAPS

Sorted by impact. **Severity is the verifier's corrected severity.** Where a verifier struck down or
demoted the finder, that is stated — those corrections are the most valuable output here.

---

### 3.1 ⛔ HIGH · CONFIRMED — The forecast-skill ledger has scored zero rows in production since 2026-08-04

- **Location:** `backend/services/weather_pipeline/forecast_skill.py:37` (`PENDING_MAX_ENTRIES`), `159-176` (`merge_pending`)
- **Current behavior:** Pending forecast rows are evicted before their target hour arrives, so they are never scored against the observation.
- **Evidence:** The finder simulated it (0.7% scored vs an **84.0% uncapped positive control**). The verifier replaced the simulation with **production GitHub Actions logs** and found it worse: a pre-fan-out control run (`30839909407`, 2026-08-03T19:53Z) logs `ledgered=354 scored=296` with **all three leads populated**; every sampled run since 2026-08-04T12:36Z logs `scored=0`.
- **Impact:** All three lead buckets (+24/+48/+72 h) are dead. The live production report at 2026-08-08T18:08:50Z carries **no `forecast_skill` block at all**.
- **Why it matters:** `MASTER-AUDIT-10.0:549` and the 08-07 handoff both prescribe *"calibrate the thresholds against `forecast_skill.py` once leads accrue."* **That plan has been unexecutable for four days.**
- **Confidence:** High · **Regression risk of the fix:** LOW
- **Direction:** Do not simply raise the cap — it is a bandwidth budget on an object downloaded and re-uploaded every cron run. Make eviction order match the scoring need (evict furthest-future first), or segment pending by lead as the scored archive is already segmented by month.

---

### 3.2 ⛔ HIGH · CONFIRMED — The scheduler dispatches sync jobs on the event loop; in-process ingestion cannot run, and reports SUCCESS

- **Location:** `backend/scheduler/base.py:54-57` (`_run_tracked_job`), root cause at `base.py:87-95` (`tracked()`)
- **Current behavior:** `tracked()` returns an `async def _wrapped`, which makes `iscoroutinefunction` true for every job; non-coroutine jobs are then called inline on the loop. `ingest_marine_forecast_task` raises `RuntimeError: Cannot run the event loop while another loop is running`, never runs its body, and is still recorded `last_run_status='success'` / `last_run_error=None` in the admin Jobs tab.
- **Evidence:** Verifier reproduced through a different route and ran **two controls** — Control A varied the *registration* (not the caller, which is what the finder varied), isolating the fault to `tracked()`; Control B showed the same status-write path reporting a genuine success identically.
- **Severity correction:** finder said Critical; verifier demoted to **High** — the decoupled CI runner (`scripts/ingest_forecast_ci.py`) is the shipped ingestion topology, so the in-process branch is a fallback, not the primary path.
- **Impact:** The in-process branch is deterministically broken (not probabilistic), and **the failure is invisible in the operator surface built to show it**.
- **Direction:** `await asyncio.to_thread(coro_func)` at `base.py:57`. A worker thread has no running loop, so `run_until_complete` becomes legal again. Separately, make the status write reflect the exception.

---

### 3.3 ⛔ HIGH · CONFIRMED — `/conditions/batch` is uncapped and strictly serial

- **Location:** `backend/routes/surf_data/conditions.py:42-78` (`get_batch_conditions`)
- **Current behavior:** A bare `for spot_id in ids:` with one awaited DB call and one awaited upstream resolution per iteration. `spot_ids: str = ""` carries no constraint.
- **Evidence:** Executed at n=250 → **250 serial DB round trips + 250 serial upstream resolutions in one HTTP request**, measured **95.9× slower** than the `asyncio.gather` equivalent. Three controls passed, including a positive concurrency control proving the harness detects parallelism when present.
- **Verifier amendment:** "unbounded" → bounded only *incidentally* by h11's 16,384-byte request head, giving a ceiling of ~435 uuid ids per request. The route is **mounted, unauthenticated, and behind no rate limiter or load shed**.
- **Impact:** Serving-perf independently measured **0.431 s per additional spot** in production; 60 ids extrapolates to ~26 s on one worker, past the Netlify proxy window the repo already tuned `OVERALL_DEADLINE` against.
- **Direction:** Copy the three limits `/spot-ratings` already has one file away — a server-side cap, one `select(...).where(SurfSpot.id.in_(ids))`, and a bounded-concurrency gather.
- ⚠️ **Reported twice** (serving-perf F4, api-contracts F1) as independent NEW findings. **It is one defect.**

---

### 3.4 ⛔ HIGH · CONFIRMED — The per-cell wind sampler is an O(cells × wind_vectors) Python scan, and the module's own cost comment is wrong

- **Location:** `backend/services/weather_pipeline/surf_rating.py:741-748`; the sole production injection is the closure at `grid_resolver_surf.py:225-242`
- **Current behavior:** `rating_transform_grid` calls the injected `wind_fn` once per rated cell; that function is an uncached pure-Python nearest-neighbour linear scan over the whole wind grid.
- **Evidence:** Two dimensions found it independently. Measured **+0.616 s on a 2,533-cell frame**, **8.9× the entire warm cost of all other per-cell work**. Three controls, including a constant-returning `wind_fn` proving the harness is not charging the scan for call overhead (Δ +0.003 s).
- **CONTRADICTS-PRIOR:** MASTER-AUDIT-9.0/10.0 concluded — and `grid_resolver_surf.py:106-116` and `test_event_loop_offload_guard.py:69-76` record verbatim — that the residual cost is cold bathymetry and the fix is the thread. **The bathymetry half is confirmed; the "not vectorising" half is refuted by the warm control arm.** The four bathymetry functions are `@lru_cache(maxsize=200_000)` and process-global, so they warm across requests; the sampler is rebuilt per request and never warms.
- **Direction:** Hoist coords into two numpy arrays once, then `argmin` per cell. **Mathematical equivalence: BIT-IDENTICAL, and measured rather than asserted** — 3,055 probes, 12× (M=629) / 21× (M=1000) / 50× (M=2500) faster.
- ⚠️ The two dimensions report "95.4% of warm cost" and "8.9× the warm cost" on frames neither described in the other's terms. **They jointly refute 10.0 §1.13, which is the load-bearing part; do not quote the two percentages together.**

---

### 3.5 ⛔ HIGH · CONFIRMED — 16 live spots publish the OFFSHORE significant height as the surf height

- **Location:** `backend/services/weather_pipeline/surf_point.py:176-180` (coastal promotion) + `bathymetry.is_coastal`; the return at `surf_transform.py:407-408` is `if not coastal: return float(Hs_m), 'open_ocean'`
- **Current behavior:** Coastal promotion gates on `src.startswith("etopo")` or `"override"`. All 16 spots carry `src='none'`, so the promotion cannot fire and the offshore height is returned byte-identically.
- **Evidence:** Measured `output == input` on **16 of 16**, with **three controls** — four known-coastal spots transformed in both directions (Jeffreys Bay 1.5000→1.4098, Pipeline 1.5000→1.4655 with its override normal 325.0), proving the transform runs elsewhere.
- **Impact:** 16 of 1,773 served spots (**0.90%**). With the coastal bit alone flipped, every one moves **+64.2%** at Hs 1.5 m / Tp 14 s — *identically*, because all 16 also lack a shore normal and a break depth. **That uniformity is itself the proof that flipping the bit alone is not the fix.**
- **STATUS-UPDATE:** The 18 spots MASTER-AUDIT-10.0 named **are fixed**. These 16 are a **disjoint set its census could not see**, because that census enumerated the 1,386 asset coordinates and every spot here fails precisely by being absent from the asset. ★ A census that enumerates the asset cannot find the population the asset is missing.
- **Direction:** Extend the ETOPO 2022 15s build to emit a per-coordinate **land-present bit** alongside bearing and break depth. Do **not** flip `coastal` from the existing predicate and do **not** touch `bathymetry.is_coastal`.

---

### 3.6 ⛔ HIGH · CONFIRMED — The observation gate runs an O(N) haversine scan AND a blocking 10 s HTTP GET on the event loop

*Found by the completeness critic — no dimension opened the file.*

- **Location:** `backend/services/weather_pipeline/rating_confirmation.py:67-120`, `131-149`; blocking GET at `spot_ratings.py:508-517`; unconditional call site at `spot_conditions.py:412-427` inside `async def resolve_spot_conditions_impl`
- **Current behavior:** Every spot-conditions request performs an unconditional per-spot haversine scan over all spots, plus an inline `timeout=10` HTTP GET of the L2 ratings object, both on the loop.
- **Impact:** 0.96–1.82 ms of pure loop occupancy per request from the haversine alone; at the 250-spot batch size of §3.3 that is **0.24–0.46 s of blocked loop on top of** the 250 serial round trips.
- **Note:** `RATING_OBS_GATE` is ON in both ingest lanes and sits directly upstream of the memory queue's #1 open question.
- **Direction:** Wrap the L2 load in `asyncio.to_thread` — `grid_resolver_surf.py:103` already does exactly this for `_build_observation_gate`, so the precedent exists and is guarded.

---

### 3.7 ⛔ HIGH · CONFIRMED — No scheduled workflow can go red on a forecast-accuracy regression

- **Location:** `.github/workflows/data-health-monitor.yml:16,48-87` + the 8-workflow schedule census
- **Current behavior:** Every standing alert is about **freshness, presence or drift**. None is about accuracy.
- **Impact:** **0 of 8** scheduled workflows can detect an accuracy regression. The one continuously computed accuracy number (`height_mae_m`, n=60 buoys/run, 8,208 archived pairs) has **no threshold, no trend check and no consumer**.
- **Compounding:** Both permanent verification archives are **write-only in automation** — `SKILL_SCORED_PREFIX` and `RESIDUAL_HISTORY_PREFIX` have 2 archives and **0 automated readers**.
- **Direction:** One `forecast-accuracy-monitor` workflow, sibling of `data-health-monitor`, same cadence and same read-only secrets, gating on the residual archive.

---

### 3.8 ⚠️ MEDIUM · CONFIRMED — The H1/10 convention is applied on only one side of the depth-limited cap

- **Location:** `backend/services/weather_pipeline/surf_transform.py:517-527`
- **Current behavior:** `if H >= cap: return float(cap), 'breaking'` compares and returns the **un-converted** significant height, while the fall-through at `:527` multiplies by `H110_OVER_HS = 1.27`. The served height therefore **exceeds its own γ·d ceiling by up to 27.0%**, then drops **discontinuously by 21.1%** as the cap engages — non-monotonic in offshore Hs.
- **Evidence:** Reproduced at **7 of 7** spots with a resolved break depth. **Negative control:** `SURF_HEIGHT_H110=0` → max output exactly 1.0000× cap, 0 samples over cap. Verifier's attempt to refute via an upstream mask **failed**.
- **Severity correction:** finder said High; verifier demoted to **Medium** — the violating band is the narrow adjacent band `H ∈ (cap/1.27, cap]`, and the cap itself binds on only 0.145% of served spot-hours.
- ⛔ **Do NOT touch `REFRACTION_KR` or the `SURF_HEIGHT_H110` flag** — they are a validated pair.
- **Direction:** Fix the seam in one place: convert first, then compare. `H_out = to_surf_convention(H, regime)`, then `if H_out >= cap: return cap, 'breaking'`. This also reconciles `estimate_surf` with `estimate_surf_partitioned`, which currently saturate **26.7% apart** on the same sea (§3.13) — one fix, two defects. **Regression risk: HIGH** (changes served heights); flag it and census it first.

---

### 3.9 ⚠️ MEDIUM · CONFIRMED — The anti-clobber manifest reconcile fails open, silently, with no log, no counter and no test

- **Location:** `backend/services/weather_pipeline/store.py:108-144`, `147-219`
- **Current behavior:** On **any** manifest-fetch failure the guard returns 0 and uploads the local snapshot as-is — i.e. it degrades into exactly the clobber it was built to prevent.
- **Evidence:** Verifier executed it (the finder only read it): pointer lane down + legacy GET raising `ReadTimeout` → `folded=0`, `manifest.products` unchanged, and **zero log records emitted**. Not even the outer `logger.warning` at `:217` — the timeout is swallowed by the inner `except Exception: return None` at `:138-139`.
- **Verifier correction:** **Delete the "12.2 MB against a 15 s budget / ≥6.5 Mbit/s" argument entirely** — a control inserting a 20 s inter-read gap showed the timeout is per-read, not total.
- **Impact:** The effectiveness of the guard for 10.0 §1.8a is **unobservable**.
- **Direction:** Make the failure loud and counted *before* changing behaviour — a module counter surfaced next to `manifest_written_by` in `/api/health/data`.

---

### 3.10 ⚠️ MEDIUM · CONFIRMED — The JS rating mirror is missing Python's swell-energy refusal (dormant landmine)

- **Location:** `frontend/src/components/map/surfRating.js:112-126` (`effectiveSwellExposure`) vs `surf_rating.py:444,474-476`
- **Evidence:** Both engines executed over 60,000 matched inputs spanning the six arguments the goldens never vary. Four control partition-sets agree to the documented rounding artefact; the two sets below `MIN_SWELL_ENERGY_SHARE=0.50` drift up to **63.5 score points**. **Kill-switch control is decisive:** at `RATING_MIN_SWELL_ENERGY_SHARE=0`, level drift collapses from 5,501/34,035 to **0/34,035** in every one of 20 share buckets — causal attribution, not correlation.
- **Companion defect:** the parity gate (`frontend/src/__tests__/ratingParity.test.js:39`) passes **6 of 12** arguments and is GREEN while this drift exists. Its generator's stated justification (`gen_rating_parity_goldens.py:22-25`, *"it is the shape the JS mirror is called with"*) is **false at HEAD**.
- **Impact:** Zero today — `SURF_PARTITIONS='0'` in code and in all three declared lanes. **The impact is on the flip**, and those workflows' own comments prescribe *"flip ONLY together"* while naming three lanes, **none of them the frontend**.
- **Direction:** Port the refusal; put the constant in the science registry; extend the golden grid to straddle the 0.50 boundary (0.4525/0.50/0.5525 are the discriminating points).

---

### 3.11 ⚠️ MEDIUM · CONFIRMED — 46.8% of the live manifest is past its stated retention

- **Location:** `backend/scheduler/forecast.py:226-237`
- ⛔ **The finder's headline was REFUTED by the verifier**, and the correction matters: the finder claimed the prune is *unreachable* in the production topology. It is reached — `scripts/ingest_forecast_ci.py:72` calls `ingest_marine_forecast_task()`, and the prune block is inside it. **Corrected claim: the prune executes every cycle and does not take effect.**
- **Impact:** 7,553 of 16,132 entries (46.8%) past a 2-day policy; oldest 19 days. 12.2 MB compact / 16.1 MB uploaded / ~63.5 MB resident as parsed pydantic objects (tracemalloc on the live manifest). A further **32.5% of every upload is whitespace** (`indent=2`).
- **Direction:** Diagnose why the prune no-ops before moving it. Independently: drop `indent=2` on the L2 dump and add gzip `Content-Encoding` — at the 30-min restore cadence alone the read side is ~586 MB/day/instance.

---

### 3.12 ⚠️ MEDIUM · CONFIRMED — The relative swell-aim angle flips the displayed rating level on ~50% of cells

- **Location:** `backend/services/weather_pipeline/surf_point.py:78-120` (shore-normal precedence)
- ★ **The verifier corrected the causal attribution, and this is the most important correction in the audit.** The finder blamed the shore normal. Perturbing the **swell direction** by the identical magnitude — leaving the shore normal untouched — gives **50.04%** flips against the normal's 50.16%. **The unstable quantity is the relative angle `swell_from − shore_normal`, not either term.**
- **Controls:** null control (±0.0°) → 0.00% flips in every provenance bucket; override-sourced spots → 0.00% both times.
- **Consequence for the roadmap:** improving the shore normal alone buys roughly half of what the finding implied, because upstream swell-direction error enters identically. **Price both terms before funding either.**
- **Related:** `swell_exposure` **is** a hard switch on an uncertain input (49.42% of cells sit on its 0.10 floor; 9.82% cross it under the fit's own spread) — **but replacing it with a physically correct cos-2s spectral law moves the flip rate only 48.29% → 46.79%.** ⛔ **This refutes the standing queue headline *"the gate is a SYMPTOM — root = the `swell_exposure` CLIFF"*: the law's shape accounts for 1.5 pp of a 48 pp instability. The cliff is an amplifier; the aim angle is the root.**

---

### 3.13 ⚠️ MEDIUM · CONFIRMED — Assorted contract, storage and refusal defects

| # | finding | location | note |
|---|---|---|---|
| a | `estimate_surf` and `estimate_surf_partitioned` apply the cap in **different statistics** — 26.7% apart at saturation | `surf_transform.py:517-527` vs `590-595` | Reach **zero** today (`SURF_PARTITIONS=0`). Pre-flip landmine; fixed as a side effect of §3.8. |
| b | `swell_period` is **fabricated at the route** — it is `wave_period` under a different physical name | `conditions.py:125` | The forecast tab's `swell_period` render site is dead on 100% of rows. |
| c | Upstream failure returns **HTTP 200** with an `{"error": ...}` body | `conditions.py:144-149` | A dead forecast is indistinguishable from a healthy one at the status-code layer. |
| d | Two sibling `/point` refusal builders disagree on absent-vs-zero | `route_helpers.py:470-509` | ICON swell_2 returns 200 with `0.0`; `grid_miss` correctly returns null. Partially contradicts 10.0 §2.4. |
| e | L1 product files are **never revalidated or evicted**, and the filename omits `run_time` | `store.py:668-708` | A newer model run is silently ignored while health reports the lane fresh. |
| f | `supabase_product_count` is the Storage list **default page size**, not a count — permanently pinned at 99 | `store.py:426-441` | The only field that could detect manifest/L2 divergence; that capability is currently zero. |
| g | The spot-ratings L2 object is a **single mutable key** overwritten unconditionally by two independently scheduled writers | `spot_ratings.py:33,470-477` | `generated_at` exists and is unused; p90 scheduling gap 369 min vs 240 nominal. |
| h | No byte-count or Range-honored validation on **3 of 3** byte-range fetchers | `noaa_gfs_wave_fetcher.py:248-253` | A 206 returning 8 bytes, and an HTTP 200 with Range ignored, both counted 9 of 9 steps OK. GRIB guard is a **lower bound only**. |
| i | A product is registered in the manifest **whether or not its L2 upload succeeded**, with no retry | `store_helpers.py:283-295` | 2 of 2 save paths register before confirming; 1 sweeper covers only the opposite direction. |
| j | `/conditions/forecast/{spot_id}` documents a premium paywall the code does not enforce | `conditions.py:152-176` | Edge-layer enforcement not verified. |
| k | `/conditions/{spot_id}` drops **9 of 17** producer keys at a hand-written literal | `conditions.py:119-141` | ⚠️ Verifier demoted to **Low**: the spot hub does **not** use this route — `/explore/spot-details` returns 17/17. |

---

### 3.14 ℹ️ LOW-BUT-STRUCTURAL — Three absences with no mechanism at all

1. **No runtime telemetry** (`requirements.txt`, `server.py:483-486`, `routes/health.py`) — 0 metrics, 0 traces, 0 percentile latencies, 0 time-series.
2. **No shadow execution and no canary.** The one rollout evaluator (`routes/admin/p2.py:533-580`) has **zero callers** — and its precedence is inverted: a user on **both** the target and exclude lists is **INCLUDED** (`p2.py:555-561`). Fix that before wiring any canary.
3. **No end-to-end product checksum.** Nobody grepped for one; this is the natural join of §3.13h and §3.13e, made in separate dimensions and never composed.

---

### 3.15 ℹ️ CORRECTIONS TO PRIOR AUDITS

| prior claim | corrected |
|---|---|
| 10.0 §1.16: *"2 of 353 route response models declare an `extra` policy"* | **0 of 363.** The two are `from_attributes=True` (ORM mode), not an extra policy. `353` is what a naive utf-8 reader returns after **silently dropping 5 BOM-prefixed files**; BOM-tolerant it is **363**. Settled with one script after two dimensions contradicted each other. ★ The audit's own scanner reproduced the class of bug the audit exists to find. |
| 10.0 §1.16's implied exposure | The mechanism is **inert on 96.2% of routes** — only 37 of 984 decorators declare `response_model=`. The boundary that actually binds is the **hand-written dict whitelist**, where both confirmed victims live. |
| 10.0 §1.13 / row P: *"warm / bulk-vectorise the bathymetry lookups"* | **Names the wrong target.** Bathymetry is already 315–641× cached; the uncached **wind scan** is 8.9× larger warm (§3.4). |
| 10.0 §5b.2: *"GWAM attempted and REVERTED, untouched at HEAD"* | **Stale — GWAM landed post-audit.** `ecmwf_opendata` still regrids point-by-point at two sites, one of them **inside the now-ON ensemble loop**, which the audit's pricing predates. |
| 10.0 §1.8a: manifest lost update *"narrowed, NOT closed"* | **Closed at its real root** by `3c25228e` — a key collision inside the anti-clobber merge, a mechanism the roadmap did not prescribe. |
| Memory: *"`weather_sim_mcp.py` is a 3-spot MOCK"* | **Stale at HEAD.** `MOCK_SPOTS = sim_spots.CATALOG_DEFAULTS`. The live landmine is different: `sim_spots.DB_PATH` points at repo-root `dev.db`, which the resolution dimension measured as **1.93× and 1.63× divergent** from the served catalogue. |

---

## SECTION 4 — COMPETITIVE ADVANTAGES & STRENGTHS (preserve through any upgrade)

### 4.1 ★★★★ ONE FORECAST COMPOSITION is real, singular, and verified by execution
- **Location:** `surf_point.py:65-236`; the single write site `point_surf_augment.py:204`; `test_surf_point_parity.py`
- **Why it works:** `surf_height_m` has **exactly one** production write site backend-wide. Three rating surfaces agree numerically under a `settrace` control that proves all three actually ran (34 tests green). CLAUDE.md's recorded sim control reproduced **digit-for-digit** at HEAD: Pipeline 0.5/1/4/8/12 m → 3.3/5.8/17.6/30.6/**29.5** ft.
- **Preserve because:** this is the property that makes every other number in the system trustworthy, and the repo has three recorded incidents of a second forecast path.
- **Threat:** any "just for this screen" endpoint; any client-side re-derivation (§3.10 is one that already exists).

### 4.2 ★★★★ `science_registry.py` — constants that carry provenance, validity ranges, and their own contradiction
- **Location:** `science_registry.py:52-378`; `test_science_registry.py`; `test_science_registry_coverage.py`
- **Why it works:** 20 tests green; 14 constants (up from 11 at freeze); the coverage ratchet measures 48 chain constants / 9 registered by scan / 39 grandfathered / **29 DEBT**, already ratcheted down from 32 the day it was built. The first registration found **its own citation misquoted** (Ardhuin 2003 says 93%, the comment said 90%).
- **Threat:** any library swap that drops provenance metadata; adding a bare literal instead of a registry entry.

### 4.3 ★★★★ Guards that REFUSE rather than emit a plausible wrong number
- **Location:** `shore_normal_fit.py:250-301` (`nearshore_depth_m`, `_MIN_WATER_CELL_M` / `_MIN_TRUSTWORTHY_DEPTH_M`); `noaa_gfs_wave_fetcher.py:592-609` (coverage floor); `forecast_skill.py:242-300` (refuses below n=10); `data_health.py:39-41`
- **Why it works:** verified under adversarial controls in two independent dimensions. The coverage floor's docstring even **refuses to generalise itself without a denominator**.

### 4.4 ★★★ Bit-identical BY DELEGATION, not by reimplementation
- **Location:** `_fetch_blockmean_vec.py:26-60` (`_interior_mask` and the delegation contract), `38-46`, `72-77`
- **Why it works:** the vectorised regrid delegates its edge cases to the original scalar function rather than re-deriving them. This is the correct pattern for *every* acceleration in Section 9 Phase 2.

### 4.5 ★★★ Two radii for two different physical quantities, each independently calibrated
- **Location:** `shore_normal_asset.py:37-113` (`MATCH_RADIUS_KM=1.0`, `BEARING_RADIUS_KM=3.0`), `385-398`
- **Threat:** a tidy-up that unifies them. They are different because the physics is different, and the code says so.

### 4.6 ★★★ Genuinely cloud-optimised ingestion already
- **Location:** `noaa_gfs_wave_fetcher.py:217-253,370-376` and 5 siblings
- **Why it works:** HTTP Range streaming off the `.idx` sidecar pulls a few KB instead of a multi-GB GRIB. Pooling landed in **6 of 6** eligible fetchers — verified at the call site, because a rebound name (`requests = http_session()`) makes a naive scan say otherwise.
- ⛔ **This is why Zarr is Rejected.** The problem it solves is already solved.

### 4.7 ★★★ Memory ceilings expressed as a size budget after a measured OOM
- **Location:** `store.py:277-295,739-753`; `mid_res_tier.py:189-208`
- **Why it works:** bounded by **both** a count limit and a vector budget — an item count would not have prevented the incident that produced it.

### 4.8 ★★★ Other preservation candidates
`far_edge_hold.py:34-105` (bounded, tail-gated, honestly **relabelled** rather than blank); the designated-writer gate + attribution (`store.py:53-105`, a live-incident fix verifiably working today); `route_helpers.py:260-270` (`filter_grid_to_bbox` deliberately **refuses** to deep-copy); the caller-aware global-grid cache guard (`useMarineDataFetcherHelpers.js:269-321`); the score/physics texture split that stops the client re-deriving either half; `bathymetry.py:50` (mmap'd int16 behind four 200k LRUs); the 4,320-row rating golden set, regenerated in memory and found **byte-current at HEAD (0/4320 drifted)**.

---

## SECTION 5 — STATE-OF-THE-ART OPPORTUNITY MATRIX

| Upgrade | Current limitation | Expected benefit | Complexity | Confidence | Recommendation |
|---|---|---|---|---|---|
| numpy `argmin` for the wind sampler | O(cells×M) Python scan, 8.9× warm cost | 12–50× on the dominant warm term, **bit-identical** | Low | High | **Adopt** |
| Manifest index by `(model,domain,layer)` | 16,132-row linear scan, duplicated in 2 functions | 1,238 rows instead of 16,132 | Low | High | **Adopt** |
| Move `deepcopy` after the skip decision | 119 ms/world-frame copy precedes the skip | −119 ms median, no semantic change | Low | High | **Adopt** |
| Cap + parallelise `/conditions/batch` | 250 ids → 250 serial round trips | 95.9× at n=250; closes an unauthenticated amplification | Low | High | **Adopt** |
| ASGI latency middleware on `/api/health` | **Zero runtime telemetry** | Makes every "not quantified" caveat closable | Low | High | **Adopt** |
| Persistence + climatology reference in the skill ledger | Only baseline is a competitor lane, itself broken | Real skill scores; zero extra requests | Low | High | **Adopt** |
| Lead-segmented pending store + eviction instrument | §3.1 | Restores the platform's ability to measure itself | Low | High | **Adopt** |
| Compact JSON + gzip on the manifest upload | 32.5% whitespace, ~586 MB/day/instance read side | ~10× on a homogeneous-record JSON | Low | High | **Adopt** |
| External uptime probe replacing GitHub cron | keep-warm fires at **5.4%** of nominal, 100%-green history | The only lever that changes the number | Low | High | **Adopt** |
| Byte-count + Range-honored assertions | 3 of 3 fetchers, 0 assertions | Detects silent truncation | Low | High | **Adopt** |
| Shape-based (AST) event-loop guard | Guard bans 2 names + 4 loaders; the **shape** is unguarded | Catches the next instance, not the last one | Low | High | **Adopt** |
| ETOPO 463 m raster as the **land mask** for `is_coastal` | 27.8 km mask cannot see a coral atoll (§3.5) | Closes a CLAUDE.md rule violation | Medium | High | **Adopt** |
| Raise 0.25° tile coverage beyond 10 bboxes | **55.22%** of served spots have no 0.25° tile | Median 21.0% height delta per the repo's own tier measurement; download cost is region-independent | Medium | High | **Adopt** |
| Full-chain golden snapshot (geometry+height+rating) | 131 of 131 value tests blind to a 10% height error | Phase 0 baseline protection | Medium | High | **Adopt** |
| Complete the break-depth asset over uncovered spots | Cap dead where no break depth exists | Multiplies tide's reach by ~39× | Medium | High | **Adopt** |
| Cap the **converted** height in `estimate_surf` | §3.8 | Removes a 27% ceiling violation + a 26.7% path divergence | Low | High | **Prototype** (flag + census) |
| Confirm-then-register on L2 upload | §3.13i | Eliminates dangling manifest entries | Medium | High | **Prototype** |
| Reliability diagram / Brier score for the categorical rating | Rating quality is validated against nothing | First real quality metric | Medium | Medium | **Prototype** |
| Wire `ocean_access.swell_exposure_fraction` (shadowing) | Built, validated, **never called** | Replaces a flat 0.10 floor where flux is 0.0000 | Low | Medium | **Prototype** |
| Standing mutation-testing job scoped to guard files | Guards have caught defects in themselves — twice | Keeps the ratchets honest | High | Medium | **Prototype** |
| Property-based testing of the JS mirror | Goldens cover 6 of 12 args | Catches §3.10's class, not its instance | Low | High | **Adopt** |
| Coalesce the 12 per-step byte ranges | 13 HTTP calls/step, not the documented 4 | Docstring is **3.25× wrong**; win unmeasured | Medium | Medium | **Benchmark First** |
| Remove the 2×2 over-smoothing at the 0.25° tier | `max(1, int(round(res/0.25/2.0)))` forces a 2×2 block mean **at the finest tier** | Nominal 27.8 km is served at 55.7 km | Medium | Medium | **Benchmark First** |
| Half-float (R16F) grid textures | 8-bit clamps: height saturates 10 m, period 20 s | Animation fidelity only — neither touches served numbers | Medium | Low | **Benchmark First** |
| Higher-res bathymetry (GEBCO 15″ / CUDEM) | — | **0.72%** mean height error vs 16.83% for shore normal | Medium | High | **Defer** |
| Directional spreading (cos-2s) replacing the 0.10 floor | Floor is 1.48× generous at Δθ=90° | Bias, yes; **stability, no** (1.5 pp of 48 pp) | Medium | High | **Defer** |
| Spectral / per-partition transform | `SURF_PARTITIONS` off in all lanes | 4× marine fetch cost; mirror drift unfixed | Low | High | **Defer** |
| Satellite altimeter verification (Sentinel-3/6) | Buoys are point-sparse | Spatially complete truth | High | Low | **Defer** |
| Learned nearshore transfer function | 184 labels, **0.00/day for 47 days** | — | Very High | Low | **Defer** |
| Postgres-backed manifest replacing the blob | §3.9, §3.11 | Real transactions | Very High | Low | **Defer** |
| Zarr / COG / Kerchunk / Dask | GRIB2 **already** streams by Range | None demonstrated | Very High | High | **Reject** |
| JAX / CuPy / GPU / Numba / neural emulator | Whole global forecast ≈ 3.94 s CPU | None | Very High | High | **Reject** |
| Nested grids / AMR / sub-km grids / SWAN / FVCOM / GCN | Input models are 0.25°–10°; you cannot downscale absent information | None demonstrated | Very High | High | **Reject** |
| cKDTree/BallTree for the wind lookup | M ≈ 629–2,500 | `argmin` already wins; a tree adds a dependency and build cost | Medium | High | **Reject** |
| Closed-form dispersion (Hunt 1979) | Newton solve residual **6.3e-16**, ≤10 iterations | Nothing to gain, precision to lose | Medium | High | **Reject** |
| numpy SoA for grid vectors | — | Touches every schema and route | Very High | Low | **Reject** |
| Repo-wide `extra='forbid'` | Inert on 96.2% of routes | Behaviour change on live clients | High | Low | **Reject** |

---

## SECTION 6 — REGRESSION RISK MATRIX

| Upgrade | Regression risk | Failure mode | Guardrail | Rollback |
|---|---|---|---|---|
| numpy `argmin` wind sampler | **LOW** | Different nearest cell at exact ties | Bit-identical differential over ≥3,000 probes (**already run**) | Revert one function |
| Manifest index | **LOW** | Bucket key omits a dimension → wrong product | Differential: indexed vs linear over the live manifest, assert identical selection | `MANIFEST_INDEX=0` |
| deepcopy relocation | **LOW** | Shared mutable `diagnostics` leaks to the cached product | ⚠️ **Verifier flagged this**: the copy does real containment work on the skip branch. Assert cached product unmutated after a skip | Revert |
| `/conditions/batch` cap+gather | **LOW** | Clients relying on >cap ids break | Ship the cap and gather separately; log rejected sizes first | Raise cap |
| Telemetry middleware | **LOW** | Overhead on every request | Bounded histogram, no I/O on the request path; A/B the p50 | Remove middleware |
| Skill-ledger eviction fix | **LOW** | Pending object grows unbounded | Assert bytes and row count per lead after each run | Restore cap |
| Manifest gzip/compact | **LOW** | A consumer parses formatting | Round-trip equality test before/after | Restore `indent=2` |
| Range/byte assertions | **LOW** | A legitimately short final range trips it | Assert only when `end is not None`; run one full cycle in warn-only mode | Downgrade to warn |
| Shape-based event-loop guard | **LOW** | False positives on legitimate sync helpers | Explicit named allowlist so the count can only go down | Revert test |
| ETOPO land mask for `is_coastal` | **MEDIUM** | Wrongly promotes an open-ocean point → 64% height change | ⛔ Do **not** flip `coastal` from the existing predicate. Census all 1,773 spots before/after; the 16 must move and **nothing else may** | `SURF_COASTAL_FROM_SHORE_NORMAL=0` |
| More 0.25° tiles | **MEDIUM** | Product selection ties (§ point resolver ranks by time then bbox area, **never resolution**) | Fix the tie-break first, then sweep a spot sample before/after | Remove bbox |
| Break-depth completion | **MEDIUM** | New depths activate the cap where it was dead | Per-spot before/after census; the cap should engage **only** in the breaking regime | Asset is additive — revert the file |
| Confirm-then-register | **MEDIUM** | A slow-but-successful upload gets dropped | Warn-only for one full cycle, counting would-be drops | Revert helper |
| L1 freshness validation | **MEDIUM** | Re-download storm on every request | Compare against the already-resident manifest `run_time`; cap re-downloads per cycle | Revert |
| **Cap the converted height** | ⛔ **HIGH** | **Served heights change for real users in the band below the cap** | Flag-gated; served-delta census on a **winter/large-swell frame** with the η=−6 m positive control that proved the harness can see anything; owner sign-off | Env flag |
| `SURF_TIDE_DEPTH` flip | ⛔ **HIGH** | One-sided low-water downgrade | ⛔ Do **not** flip on the 08-07 census (0 of 172) — that frame was Hs p50 0.58 m, inside the band where the cap cannot bind. **A 0% result is worthless without a positive control.** | Env flag |
| `SURF_PARTITIONS` flip | ⛔ **VERY HIGH** | §3.10's 63.5-point client drift goes live; §3.13a's 26.7% path divergence goes live; 4× marine fetch cost | Fix the mirror **and** the cap seam first; flip all three lanes together | Env flag ×3 |
| `RATING_BREAKER_TYPE` flip | ⛔ **HIGH** | 76.19% of spot slopes fall **outside** the consuming formula's cited validity band | Do not enable against the 0.1° asset | Env flag |

---

## SECTION 7 — PERFORMANCE HOTSPOT RANKING

No invented numbers. Absolute seconds are Windows/py3.14/numpy2.4 unless marked **production**; ratios transfer, absolutes do not.

| # | Component | Location | Type | Evidence | Optimisation potential | Profiling method |
|---|---|---|---|---|---|---|
| 1 | `/grid_series?surf=1` | `grid_series_helper.py:433-439` | Composite | **Production, interleaved control:** 7.4–7.7 s vs 0.37–0.46 s for surf=0 — **20×** | Large; delta did **not** double 4→8 frames, so do not model as 1.8 s × N | Per-frame timing inside `resolve_grid` |
| 2 | Per-cell wind sampler | `surf_rating.py:741-748` → `grid_resolver_surf.py:225-242` | CPU / algorithmic | +0.616 s on 2,533 cells; 8.9× all other warm work; 3 controls | 12–50×, **bit-identical** | `cProfile` on `rating_transform_grid` with a constant-`wind_fn` control |
| 3 | Manifest linear scan | `point_resolution.py:322-338`, `705-721` | CPU / algorithmic | 11.3–14.7 ms × 22 per hub request; scaling control proves time ∝ P | 13× fewer rows | Instrument the dyn-index hit rate — **the missing denominator** |
| 4 | `copy.deepcopy` before the skip | `grid_resolver_surf.py:40-41` vs `60-64` | Memory / CPU | **Production:** +119 ms median world frame; 196 ms at 15,023 vectors | ~119 ms/frame | Compare `SURF_TRANSFORM=0` (5.05 ms) vs on (89.64 ms) |
| 5 | `/conditions/batch` | `conditions.py:42-78` | I/O serialisation | 250 ids → 250 serial DB + 250 serial upstream; 95.9× vs gather | ~95× | Count awaits per request |
| 6 | Observation gate | `rating_confirmation.py:67-120`; `spot_ratings.py:508-517` | CPU + blocking I/O | 0.96–1.82 ms haversine + a `timeout=10` GET inline | Full removal from the loop | Wrap and re-measure |
| 7 | `coarse_gulf_fill` | `coarse_gulf_fill.py:97,118-144` | CPU | ~207 ms/`/grid` request at production cell counts (4,689 of 15,023 masked) | Memoisable — both product ids are immutable-per-filename | Time the fill against total warm latency (~1.0–1.1 s) |
| 8 | Cold bathymetry | `bathymetry.py` (4 LRUs) | I/O (page faults) | 5.93 s per 10,000 fresh coords; **593× cold/warm**; 99.8% of the cold path | Warm-on-start over the served coordinate set | tracemalloc + `lru_cache.cache_info()` |
| 9 | `PointSampler.sample_point` | `sampler.py:37,62,122` | CPU | Rebuilds 3 O(N) index structures per call; ~22 ms/hub request at N=1,353 | Memoisable per `product_id` | Ranked last deliberately |

⚠️ **The single missing instrument for all nine is a request-volume denominator.** Nothing here can be converted into "share of the box's time" until §3.14's telemetry exists.

---

## SECTION 8 — FORECAST ACCURACY OPPORTUNITIES (ranked separately from performance)

| # | Opportunity | Variable improved | Required data | Validation | Downside | Confidence |
|---|---|---|---|---|---|---|
| 1 | **Restore the skill ledger** (§3.1) | *All* — it is the measuring instrument | Already accruing | Its own positive control (84.0%) | None | **High** |
| 2 | **0.25° tile coverage** — 55.22% of served spots have no fine tile; 88.61% are outside a flagship box | Offshore Hs/Tp/direction at 979 spots | Additional bboxes; **download cost is region-independent** — the multi-bbox single-pass already landed | Per-spot tier delta (repo's own median 21.0%) | Ingest time, product-store growth | **High** |
| 3 | **The offshore input-compression error** — bias +0.352 m at 0–0.5 m falling monotonically to −0.415 m at 2.5–10 m, while the aggregate (−0.118 m) hides all of it | Offshore Hs — the input **every** downstream transform multiplies | 8,208 residuals / 60 buoys, already archived | Per-band MAE before/after | ⚠️ **Verifier caveat, load-bearing:** `stratified_height_bias` conditions on the **observed** height, which induces a regression-to-the-mean artefact. A positive control with a genuinely compressing model (0.75×truth) produced a *steeper, non-saturating* signature — so the real compression is **smaller than the raw bands suggest**. Condition on the *model* height before acting. | **Medium** |
| 4 | **Break-depth coverage** — the cap binds 1.279% where a depth exists vs 0.033% where it does not (**39×**) | Breaking height in large surf | Re-run `resolve_spot_geometry` over uncovered spots | Per-spot before/after; cap must engage only in the breaking regime | Activates a cap that was dead | **High** |
| 5 | **The 16 open-ocean spots** (§3.5) | Surf height at 0.90% of spots, currently **wrong by construction** | ETOPO land bit | 16 must move, nothing else may | — | **High** |
| 6 | **Wind residual — parsed, unit-tested, scored nowhere** (`buoy_calibration.py:204-224` vs the loop at `:419`) | Wind speed/direction error | Already in the payload being parsed | The existing residual harness | Zero extra network requests | **High** |
| 7 | **Persistence + climatology baselines** | Skill interpretation | `report["spots"][i]["residual"]["buoy_wvht_m"]` already present | Flows through `skill_summary` unchanged | ~10 lines, no fetch | **High** |
| 8 | **The shore-normal / swell-aim angle** (§3.12) | Rating level on ~50% of cells | OSM/GSHHG vector shoreline; better swell direction | The fit's own OSM validation table | ⛔ **Halve the expected benefit** — the swell direction contributes equally | **Medium** |
| 9 | **Coastal shadowing** — built, validated, never called | Exposure where spectral flux is 0.0000 but the floor grants 10% | Compute once per spot in the existing offline fit | Against the 49.42% floor population | Offline cost only | **Medium** |
| 10 | **Learned nearshore transform** | Breaking height | ⛔ **184 labels total, 2.33/day historically, 0.00/day over the last 47 days** | — | Reaching `MIN_ROWS_TO_FIT=30` across 5 bands × 10 spots would take years at the historical rate; **never** at the current one | **Reject for now** |

⛔ **On the height quantile map:** a dimension reported the evidence gate as newly MET. **The verifier refuted it** — gate 1 (`MIN_ROWS_TO_FIT`/`MIN_BUOYS_TO_FIT`) is not what gates shipping; `fit_quantile_map.py` hard-refuses `--upload`, and the one commit that created the module records **per-band MAE regressions in 2 of 5 bands** on live 07-30 data. **Do not wire it.**

---

## SECTION 9 — INCREMENTAL ZERO-REGRESSION UPGRADE ROADMAP

### PHASE 0 — Baseline protection · **START HERE. Nothing else may precede it.**
1. **Fix the skill-ledger eviction** (§3.1). Without it there is no "did this help?" — and every later phase is unverifiable.
2. **Telemetry middleware** on the existing `/api/health` (§3.14). ~40 lines.
3. **Full-chain golden snapshot** — geometry + breaking height + rating at fixed spots, fixed inputs. ⚠️ The current anchor (`test_small_island_coastal_promotion.py:133-149`) sits in the **depth-saturated** regime: Pipeline reads 29.50 ft at both `Kr=0.797` and `Kr=1.0`, so **a 10% systematic height error is invisible to 131 of 131 value tests**. Add the non-saturated anchor — Pipeline 2 m / 14 s = 10.11 ft, which moves 25.4% across the Kr range.
4. **Persistence + climatology baselines** in the ledger.
5. **Shape-based (AST) event-loop guard** replacing the name list, with an explicit allowlist.
6. **Accuracy monitor workflow** that can go red.

### PHASE 1 — Low-risk optimisations (no forecast mathematics changes)
numpy `argmin` wind sampler · manifest index · deepcopy relocation · `/conditions/batch` cap+gather · observation gate off the loop · `coarse_gulf_fill` memoise+thread · manifest gzip/compact · Range byte assertions · external uptime probe · **and fix the inverted exclude precedence at `p2.py:555-561` before anyone builds a canary on it.**

### PHASE 2 — Numerical acceleration behind flags
Only what preserves equivalence. The house pattern is already proven: **delegate edge cases to the scalar function** (`_fetch_blockmean_vec.py:26-60`). Candidates: ring-only `shelf_width_km` (bit-identical *provided visitation order is preserved* — the accumulator uses a strict `dist < best`); bulk bathymetry warm-on-start. ⛔ **No JAX, no GPU, no Numba** — the whole global forecast is ~3.94 s of CPU.

### PHASE 3 — Data architecture (shadow first)
Confirm-then-register on L2 upload · L1 freshness validation against manifest `run_time` · diagnose why the retention prune no-ops · CAS for `spot_ratings/latest.json`. ⛔ **No Zarr.**

### PHASE 4 — Coastal inputs (the only "resolution" work that pays)
ETOPO land mask for `is_coastal` (closes §3.5) · break-depth completion · **0.25° tile coverage** — fix the point resolver's tie-break (`point_resolution.py:344-359` ranks by time then bbox area, **never by resolution**) before adding tiles · benchmark removing the 2×2 over-smoothing at the finest tier. ⛔ **No nested grids, no AMR, no SWAN.**

### PHASE 5 — Physics seams and flags (owner-gated, each with a census)
Cap the converted height (§3.8) · then `SURF_TIDE_DEPTH` on a **winter frame with a positive control** · fix the JS mirror and extend the golden grid **before** `SURF_PARTITIONS` is considered · wire coastal shadowing.

### PHASE 6 — ML, only after Phase 0 exists
Reliability diagram / Brier score for the categorical rating first (it needs no new data). The residual correction stays **blocked** on its own fitter's NO-GO. ⛔ **No neural emulator, no GNN.** The deterministic chain remains the live path in every case.

---

## SECTION 10 — PRIORITISATION

Scores 1–5. **Complexity, Regression Risk and Operational Cost are costs — lower is better.**

| Initiative | Fcst Acc | User | Perf | Rel | Cx | Regr | OpCost | Conf | **Priority** |
|---|---|---|---|---|---|---|---|---|---|
| Fix skill-ledger eviction | 5 | 1 | 1 | 3 | 1 | 1 | 1 | 5 | **P0** |
| Telemetry middleware | 2 | 1 | 2 | 5 | 1 | 1 | 1 | 5 | **P0** |
| Full-chain golden + non-saturated anchor | 5 | 1 | 1 | 5 | 2 | 1 | 1 | 5 | **P0** |
| Accuracy monitor that can go red | 5 | 2 | 1 | 5 | 2 | 1 | 1 | 5 | **P0** |
| Scheduler `to_thread` + honest status | 2 | 2 | 3 | 5 | 1 | 1 | 1 | 5 | **P0** |
| `/conditions/batch` cap + gather | 1 | 4 | 5 | 5 | 1 | 1 | 1 | 5 | **P1** |
| numpy `argmin` wind sampler | 1 | 4 | 5 | 2 | 1 | 1 | 1 | 5 | **P1** |
| Manifest index | 1 | 4 | 4 | 2 | 1 | 1 | 1 | 5 | **P1** |
| deepcopy relocation | 1 | 3 | 4 | 2 | 1 | 2 | 1 | 4 | **P1** |
| Observation gate off the loop | 1 | 3 | 4 | 3 | 1 | 1 | 1 | 5 | **P1** |
| The 16 open-ocean spots | 5 | 5 | 1 | 3 | 3 | 3 | 2 | 5 | **P1** |
| JS mirror + golden grid | 2 | 4 | 1 | 4 | 2 | 1 | 1 | 5 | **P1** |
| External uptime probe | 1 | 4 | 3 | 5 | 1 | 1 | 2 | 5 | **P1** |
| Persistence + climatology baselines | 4 | 1 | 1 | 3 | 1 | 1 | 1 | 5 | **P1** |
| Manifest gzip/compact + retention | 1 | 2 | 3 | 4 | 1 | 1 | 1 | 5 | **P1** |
| Range/byte + confirm-then-register | 2 | 2 | 1 | 5 | 2 | 2 | 1 | 4 | **P1** |
| 0.25° tile coverage (+ tie-break first) | 5 | 5 | 2 | 3 | 3 | 3 | 3 | 4 | **P2** |
| Break-depth completion | 4 | 4 | 1 | 2 | 3 | 3 | 2 | 4 | **P2** |
| ETOPO land mask | 4 | 4 | 1 | 3 | 3 | 3 | 2 | 4 | **P2** |
| Cap the converted height | 3 | 3 | 1 | 2 | 2 | 5 | 1 | 4 | **P2** |
| Wind residual wiring | 3 | 1 | 1 | 2 | 1 | 1 | 1 | 5 | **P2** |
| L1 freshness validation | 2 | 3 | 2 | 4 | 3 | 3 | 1 | 4 | **P2** |
| Reliability diagram / Brier | 4 | 2 | 1 | 2 | 3 | 1 | 1 | 3 | **P2** |
| Shadow execution for the science chain | 3 | 1 | 1 | 4 | 4 | 2 | 2 | 3 | **P2** |
| `SURF_TIDE_DEPTH` flip | 3 | 3 | 1 | 1 | 1 | 5 | 1 | 3 | **P3** |
| Coastal shadowing wiring | 2 | 2 | 1 | 1 | 2 | 3 | 1 | 3 | **P3** |
| Directional spreading (cos-2s) | 2 | 2 | 1 | 1 | 3 | 4 | 1 | 3 | **P3** |
| Half-float textures | 1 | 2 | 2 | 1 | 3 | 2 | 1 | 2 | **P3** |
| `SURF_PARTITIONS` flip | 3 | 3 | 1 | 1 | 3 | 5 | 4 | 2 | **P3** |
| Higher-res bathymetry | 1 | 1 | 1 | 1 | 3 | 3 | 3 | 4 | **P4** |
| Learned nearshore transform | 3 | 3 | 1 | 1 | 5 | 4 | 3 | 1 | **P4** |
| Zarr / JAX / GPU / nested grids / SWAN / GCN | 1 | 1 | 1 | 1 | 5 | 5 | 5 | 5 | **P4** |

---

## SECTION 11 — FINAL ARCHITECT RECOMMENDATION

**KEEP (do not touch).** The composition chain and its single write site. `science_registry.py` and its ratchet. The refusal semantics — all of them, they are verified real under adversarial control. The Newton dispersion solve (6.3e-16). The γ / Kr / H1-10 constants **as a pinned set**. Delegation-based vectorisation. The two calibrated radii. HTTP Range streaming off `.idx`. The size-budget memory ceilings. `far_edge_hold`. The designated-writer gate.

**OPTIMIZE (same architecture, better execution).** The four event-loop blocks. The serial batch route. The manifest representation (32.5% whitespace, 46.8% expired). The wind sampler. Cold bathymetry warming.

**MODERNIZE (genuinely absent capability, not novelty).** Runtime telemetry. An accuracy monitor that can go red. A full-chain golden snapshot. External uptime probing. A shape-based event-loop guard.

**PROTOTYPE (flag + census + owner sign-off).** The cap/convention seam. Break-depth completion. The ETOPO land mask. 0.25° tile expansion. Shadow execution for the science chain. Categorical reliability scoring.

**AVOID.** Zarr/COG/Kerchunk/Dask. JAX/CuPy/GPU/Numba/neural emulation. Nested grids, AMR, sub-km grids, SWAN, FVCOM, GCN. Repo-wide `extra='forbid'`. A KD-tree for the wind lookup. Closed-form dispersion. numpy SoA for grid vectors.

---

### If I were personally accountable for preventing production regressions

**I would authorize, in this exact order:**

1. **Skill-ledger eviction fix, telemetry middleware, full-chain golden with a non-saturated anchor, and an accuracy monitor that can go red.** I would not authorize a single line of the rest until these four exist. This system has real physics and no ability to tell whether a change helped — and it has been in that state, unnoticed, since 2026-08-04. Everything else on the list is a bet placed blind until this is done.
2. **The scheduler `to_thread` fix and honest job status.** A job that fails and reports success corrupts every future diagnosis.
3. **The Phase 1 low-risk block** — all bit-identical or behaviour-preserving, all with LOW rollback cost, and one of them (`/conditions/batch`) is an unauthenticated amplification vector.
4. **The 16 open-ocean spots**, because it is CLAUDE.md's first binding rule failing in production — but via the **ETOPO land bit**, never by flipping `coastal` from the existing predicate, and with a census asserting that exactly those 16 move.
5. **The JS mirror and its golden grid**, before anyone can flip `SURF_PARTITIONS`.
6. **Then, and only then, the 0.25° tile expansion** — the largest genuine accuracy lever in the system, at 55.22% of served spots — with the point resolver's tie-break fixed first.

**I would reject outright:** Zarr, JAX, GPU, neural emulators, nested coastal grids, AMR, SWAN and GCN. All eight have now been priced against the thing they would replace by three consecutive audits, and all eight lose. The entire global forecast is four seconds of CPU; a finer bathymetry improves an input that contributes **0.72%** where the shore normal contributes **16.83%**; and the ingestion is already streaming kilobytes off a sidecar index.

**I would defer, with a stated reason rather than a shrug:** the learned nearshore transform (184 labels, and **zero new ones in 47 days** — the dataset is not growing, which is the finding, not the model choice), the height quantile map (**its own fitter says NO-GO**), and every flag flip whose census was taken on a frame where the term could not physically bind.

**And I would add one standing work rule:** *a census that enumerates an asset cannot find the population the asset is missing.* That is how 10.0's 18 open-ocean spots got fixed while these 16 stayed broken, and it is the same shape as the ensemble reaching zero screens. **Enumerate the served population, then ask what is absent from it — never the reverse.**

---

## §12 WHAT THIS AUDIT DID NOT ESTABLISH — stated so it is not over-quoted

- ⛔ **No pass obtained production credentials or read the Render dashboard.** Thirteen passes, none attempted it. It gates `SURF_TIDE_DEPTH`, `SURF_PARTITIONS`, `RATING_BREAKER_TYPE`, `RATING_OBS_GATE`, `DISABLE_FORECAST_SCHEDULER`, `L2_WRITER` and the `PREFETCH_*` family. **It is one screen and would resolve or bound at least six findings across five dimensions.** Highest-value unclosed item in the audit, and it requires no code.
- **28.5% of `backend/services/weather_pipeline/` (~8,100 LOC, 31 of 83 modules) was never opened by any dimension.** The critic opened 6. Unaudited and load-bearing: `estimator.py` (652 LOC, live on the EURO point path), `capabilities.py` (662), `viewport_helper.py` (631), `spot_size_climatology.py` (479), plus seven ingestion lanes.
- **The weather-sim subsystem (~4,000 LOC) was examined by zero of twelve dimensions**, despite a standing mandate to advance it every session. Only its stale MEMORY claim was corrected.
- **All local timings are Windows / py3.14.4 / numpy 2.4.4**; production is Linux / py3.12, and the repo's own parity check reports 28 of 46 pins differing. **Ratios transfer; absolute seconds do not.** Figures marked **production** were taken against the live box and carry no such caveat.
- **Nearshore coverage was enumerated against a grep list, not a process list** — six modules read in full out of ~90 in the package.
- **Cost figures are a model, not a bill.** Every one is a measured object size × a declared cadence.
- **Ingestion backpressure under cycle overrun was not measured.** `timeout-minutes: 165` against an every-4-hours cron means overlap is possible and its semantics are unexamined.
- **No end-to-end product checksum was searched for.** Nobody grepped.
- ⚠️ **Harness contamination found and reported:** a registered git worktree at `.claude/worktrees/gracious-cannon-e4aed4` holds a full 1,100-file checkout at commit `ac08781d` (124 files / 13,966 lines from HEAD) **inside the working tree**, and Bash `grep -r` from the repo root reads it. Dimensions did not record which grep tool they used, so an unknown subset of line-number claims may derive from it. **Work rule: repo-wide searches must use the Grep tool (ripgrep, honours excludes) or a Bash grep scoped explicitly to `backend/`, `frontend/src/`, `.github/`.**
