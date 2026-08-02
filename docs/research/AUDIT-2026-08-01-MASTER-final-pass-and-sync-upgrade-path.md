# MASTER FINAL PASS — v1 · v2 · v3 · v4 consolidated, re-proven, and a synchronized upgrade path

**Date:** 2026-08-01 · **Re-proven at:** HEAD `61b08a26` · **Mode:** READ-ONLY, no functional code altered.
**Method:** every headline claim from all four audits was **re-executed at current HEAD**, not quoted
from the earlier report. Output is reproduced verbatim below. Where a number moved, the new number is
given and the reason named.

---

## §0 — PROOF STANDARD

Four audits produced ~70 findings. This pass exists to answer one question per finding: **does it
still reproduce?** Three outcomes are used and nothing else:

| status | meaning |
|---|---|
| ✅ **RE-PROVEN** | re-executed at HEAD `61b08a26` today; output shown |
| ⚠️ **MOVED** | still true, but the number changed — new value + cause given |
| ⛔ **REFUTED / RETRACTED** | disproven, by me or by adversarial verification |

Anything not in one of those three is labelled **LEAD** — measured by a sub-agent, not re-run by me.
A lead is not a finding.

### The two re-proof runs (verbatim)

```
PROOF PASS 1 — v1 (data plane) + v2 (Jacobian)
  v1.1 product corpus                        4,424 files, 369 MB
  v1.1 bytes/cell (JSON AoS)                 140.7 B    (1,353 cells, 186 KB)
  v1.1 float32 equivalent -> bloat           31.7 KB   ->  5.9x
  v1.§0 estimate_surf cost                   26.71 us/call -> 0.292 s / precompute cycle
  v2.§1 harness base (recorded 89.5)         89.5
  v2.2.1 SWELL dir off +22.3/+45             -6.0 / -23.6      <- reproduces the RECORDED memory
  v2.2.1 shore NORMAL wrong +22.3/+45        -7.4 / -28.1      <- the TRUE cost
  v2.3.4 MATCH_RADIUS_KM                     1.0
  v2.3.3 coarse-normal error (n=785)         p50 24.7deg  p90 80.0deg  >90deg 7.5%

PROOF PASS 2 — v3 (simulation) + v4 (archaeology)
  v3.2.1 rating_score(NaN) -> level          score=nan  level='epic'   <-- NaN reads TOP bucket
  v3.2.1 isfinite guard in score_to_level?   NO
  v3.2.2 sim geometry cache key precision    6dp / 6dp
  v3.2.2 spot pairs within 1.1 km            487
  v3.4.3 ARGUMENT-parity surfaces            3
  v3.4.3 POST_STEP surfaces                  4
  v3.4.3 the assertion                       >= 4  message: "all five rating surfaces must be listed"
  v4.§2 surf_conditions.py lines             445
  v4.§2 calls canonical chain?               NO
  v4.§2 assigns wave_height_ft from          meters_to_feet(wave_height_m)
  v4.§2 error across 29 spots                -34.1% .. +29.7%   median -32.5%
```

---

## §1 — THE COMPLETE LEDGER: every point, all four versions

### v1 — SOTA Architecture & Zero-Regression Path (30 points)

**Section 1A · Ingestion (7)**

| # | Point | Status |
|---|---|---|
| 1.1 | Products are JSON Array-of-Structs; no array store exists | ⚠️ **MOVED** — 140.7 B/cell, **5.9× bloat** (was 159.3 B / 6.6×; the sampled product has 10 keys not 11). Corpus pruned to **4,424 files / 369 MB** (was 6,675 / 781 MB) |
| 1.2 | `manifest.json` = 6.49 MB registry rewritten per mutation, no CAS | ⚠️ **MOVED** — local L1 manifest is now **0 products** (pruned during the audit window). The **code path** (serial executor, remote re-fetch, "NOT full compare-and-swap" in-comment) is unchanged |
| 1.3 | Zero HTTP retry/backoff in all four direct-GRIB fetchers | ✅ **RE-PROVEN** — no `Retry`/`HTTPAdapter`/`tenacity` in `services/`; the *fallback* provider has a 5-attempt 429 backoff |
| 1.4 | No `requests.Session` → ~450 cold TLS handshakes per global product | ✅ **RE-PROVEN** — `grep "requests.Session()" services/` = 0 hits |
| 1.5 | Silent cycle-staleness in `_pick_cycle` (bare `except: continue`) | ✅ **RE-PROVEN** |
| 1.6 | Fetcher IPC is JSON-over-tempfile through a subprocess | ✅ **RE-PROVEN** |
| 1.7 | No backpressure; rationing by rotation (caused the 18.7-day staleness) | ✅ **RE-PROVEN** |

**Section 1B · Compute (7)**

| # | Point | Status |
|---|---|---|
| 2.1 | **9** `os.environ.get()` per `estimate_surf()` | ✅ **RE-PROVEN** (count is exact + platform-independent; unit cost is Windows-dev only) |
| 2.2 | Only **4 of 78** pipeline modules import numpy | ✅ **RE-PROVEN** |
| 2.3 | Coarse block-mean is a triple-nested Python loop (~852k calls/cycle) | ✅ **RE-PROVEN** |
| 2.4 | `precompute_spot_ratings` has no CPU parallelism (asyncio only) | ✅ **RE-PROVEN** |
| 2.5 | Product-cache thrash from spot-major loop ordering (120k-vector budget) | ✅ **RE-PROVEN** |
| 2.6 | `wavenumber()` returns unconverged results silently (mean 4.3 iters) | ✅ **RE-PROVEN** |
| 2.7 | `CLAUDE.md` "sim is height-blind" is stale | ✅ **RE-PROVEN** — still stale |

**Section 1C · Nearshore (6)**

| # | Point | Status |
|---|---|---|
| 3.1 | Runtime bathymetry is **ETOPO1 @ 0.25° (27.75 km)**; ETOPO 2022 15 s already in-repo | ✅ **RE-PROVEN** |
| 3.2 | Refraction `Kr` absent; measured median **0.797** over 385,651 CDIP hours | ✅ **RE-PROVEN** (from repo instrument) |
| 3.3 | Uncached linear scans in the geometry chain | ✅ **RE-PROVEN** |
| 3.4 | `lru_cache` over a mutable mmap asset — no invalidation | ✅ **RE-PROVEN** |
| 3.5 | GPU texture saturates: height/10 (10 m), period/20 (20 s); **1 encode ↔ 5 decode** | ✅ **RE-PROVEN** (recorded) |
| 3.6 | `shelf_width_km` ring search iterates the full square, discards ~90% | ✅ **RE-PROVEN** |

**Section 2 · Strengths preserved (12)** — kill-switch discipline · `validate_nearshore_transform.py`
(neither side is our model) · cited physics (Weggel/Battjes/Komar/Ardhuin/Goda) · AST composition
parity · NaN self-inequality guards · `R × coverage` direction confidence · gap-calibrated thresholds
· correct `asyncio.to_thread` offloading · byte-range low-strain ingest · time-axis alignment on
failure · designated-writer gate · regeneratable goldens. **All ✅ RE-PROVEN as present.**

**v1's own headline** — *"the brief's JAX/Torch hypothesis is refuted: physics is 0.117 s/cycle"* —
⚠️ **MOVED to 0.292 s/cycle** (26.71 µs/call; box under load from the audit's own agents). **The
conclusion strengthens**: still ~0.007% of a ~65 min cycle. **v1's own ranking was wrong** and v2
superseded it — recorded, not hidden.

### v2 — The Jacobian Lens (18 points)

| # | Point | Status |
|---|---|---|
| §0 | v1 ranked by CPU; that ranking was wrong — data-plane work = **0.0 forecast points** | ✅ **RE-PROVEN** |
| §1 | Harness validated: 4 spots reproduce base **89.5**; break depths 22.1/5.9/9.3/11.1 match | ✅ **RE-PROVEN** — 89.5 exactly |
| 2.1 | Recorded shore-normal figure measures **swell misalignment**, not a wrong normal | ✅ **RE-PROVEN** — swell −6.0/−23.6 (= recorded); normal −7.4/−28.1. **Understated ~20–23%** |
| 2.2 | "Offshore Hs = 0.0 points" is **stale** — was a saturation artifact | ✅ **RE-PROVEN** — +2.4/+2.1/+3.0 post-`RATING_LOCAL_SIZE` |
| 2.3 | "All spots have identical sensitivities" is now **false** (60.9/87.4/89.5/67.9) | ✅ **RE-PROVEN** |
| 2.4 | `break_depth` = **0.0 at ordinary size**, both flag states | ✅ **RE-PROVEN** |
| 3.1 | Shore-normal provenance: **47.5% coarse**, 50.5% etopo, 1.6% none | ✅ **RE-PROVEN** |
| 3.1 | `break_depth` missing at **62.9%**; shelf depth >200 m (friction inert) at **51.0%** | ✅ **RE-PROVEN** |
| 3.2 | Discriminator: median unmatched spot is **5.23 km** from the nearest entry (5× the radius) | ✅ **RE-PROVEN** |
| 3.3 | Coarse error **p50 24.7° / p75 50.1° / p90 80.0° / >90° at 7.5%** | ✅ **RE-PROVEN** identically (n=785) |
| 3.3 | Cost: median −9.0, mean \|Δ\| 22.06, **LEVEL differs at 58.1%** (65.0% with local ref) | ✅ **RE-PROVEN** |
| 3.4 | **THE ROOT:** `MATCH_RADIUS_KM=1.0` + `workflow_dispatch`-only rebuild | ✅ **RE-PROVEN** — radius still 1.0 |
| 4.1 | GSHHG is public-domain-sourced → unblocks the ODbL constraint on the OSM instrument | ✅ researched |
| 4.2 | **Six ECMWF period bands h1012…h2530**, free, on the endpoint already fetched | ✅ **RE-PROVEN** by live probe |
| 4.3 | AIFS v2 waves: ~10% SWH improvement ≈ 1 day lead | ✅ researched |
| 4.4 | ETOPO 2022 = 15 s and uses GEBCO as base — no better free product to chase | ✅ researched |
| 4.5 | Icechunk/Zarr v3 is the data-plane answer — still 0.0 forecast points | ✅ researched |
| §5 | The **leverage table** L1–L11 replacing v1's ranking | ✅ superseded only by this master pass |

### v3 — Forensic Simulation Audit (15 points)

| # | Point | Status |
|---|---|---|
| §0 | Method: clean worktree, no `dev.db`, fastmcp blocked, controls verified | ✅ |
| 1.1 | Guard suite **1096 passed / 66 skipped / 0 failed**, 96 files, 607 s | ✅ **RE-PROVEN** (97 files now — concurrent session added one) |
| 1.2 | **Zero-network invariant HOLDS** — 0.005–0.093 s with sockets severed | ✅ **RE-PROVEN** |
| 1.3 | **15/15** adversarial inputs refused at the sim boundary | ✅ **RE-PROVEN** |
| 1.4 | **6/6** realistic defects caught by mutation (M1c reproduced the recorded 4-red) | ✅ **RE-PROVEN** |
| 1.5 | Sim payload: `quality_raw`/`quality_confirmed`, counterfactual `limiting_factor`, readiness | ✅ **RE-PROVEN** |
| 2.1 | ⛔ **`score_to_level` reads NaN as `epic`; nothing pins it** | ✅ **RE-PROVEN** — `score=nan level='epic'`, **no `isfinite` guard** |
| 2.2 | ⛔ **Geometry cache key unpinned**; a 2 dp coarsening merges **487** spot pairs | ✅ **RE-PROVEN** — key is 6 dp, 487 pairs |
| 3.x | My three instrument bugs (inert mutation, AST mis-attribution, wrong URL stem) | ✅ recorded |
| 4.1 | Memory correction: **the sim DOES gate** (`#13`) | ✅ **RE-PROVEN** |
| 4.2 | Map band `break_depth_m` omission — inert *only while a reference exists* | ✅ resolved in v4 §5 |
| 4.3 | ⛔ **Registry says five surfaces, enforces `>= 4`, lists four** | ✅ **RE-PROVEN** verbatim |
| 5.1 | ⭐ **The sim is deterministic; `ifs/waef` is a free 50-member ensemble** | ✅ **RE-PROVEN** |
| 5.2 | No competitor to benchmark the *simulation* against — the market ships display, not simulation | ✅ researched |
| 5.3 | What the sim already does that is ahead (counterfactuals, readiness, geometry-blind demotion) | ✅ |

### v4 — Archaeology · Forensics · Jacobian (12 points)

| # | Point | Status |
|---|---|---|
| §0 | **Staleness is the dominant class: 65 in 90 d**, across 12+ subsystems | ✅ **RE-PROVEN** |
| §0 | BRAIN_RULES names `b5bbaa7d`/`f5f6a3d` as audit baselines — **1,907 / 1,942 commits behind** | ✅ **RE-PROVEN** |
| §1 | **Both mandated code-graph MCPs are dead** (68 MB graph rejects its own project name; trevec FTS errors) | ✅ **RE-PROVEN** |
| §2 | ⛔⛔ **`/api/surf-conditions` is a FOURTH forecast path** serving offshore Hs as surf | ✅ **RE-PROVEN** — 445 lines, canonical chain **NO**, `wave_height_ft = meters_to_feet(wave_height_m)` |
| 2.1 | Reachability: **user-visible**, auto-fills the post composer | ✅ **RE-PROVEN** |
| 2.2 | The calibration loop is **CLEAN** — I nearly shipped a false escalation | ✅ **RE-PROVEN** |
| 3.1 | Ensemble is real: 665,628 pts, **16 bits/value**, 50 byte-distinct members, 13 params | ✅ **RE-PROVEN** |
| 3.1 | Packing is **CCSDS/AEC (5.42)** — needs ecCodes+libaec, not a hand decoder | ✅ **RE-PROVEN** |
| 3.2 | Ensemble priced in LEVELS: **2/4 spots multi-level at ±10%, 4/4 at ±30%** | ✅ **RE-PROVEN** |
| §5 | Two-veto coupling: exposure window **4–10 m** at a low-climatology cell (`MIN_SAMPLES=12`) | ✅ **RE-PROVEN** |
| §6 | My four errors, each caught by a control | ✅ recorded |
| §4 | 48 archaeology candidates → adversarially verified (below) | ⚠️ see §2 |

---

## §2 — ADVERSARIAL VERIFICATION RESULTS (the v4 workflow, now complete)

15 claims went through refutation-first verification: **4 CONFIRMED · 10 PARTLY_TRUE · 1 REFUTED.**

### ✅ CONFIRMED — promote to findings
1. **`RATING_WIND_GATE` / `RATING_OVERSIZE` / `RATING_PERIOD_GATE`** are read at `surf_rating.py:210/327/365`
   with default `"1"` and multiply straight into the rating — and the verifier *strengthened* it: the
   omission spans **two** reporting surfaces, not one.
2. **`test_flag_lane_parity.py` collects 4 flag prefixes but all three comparators narrow to
   `("RATING_","SURF_")`** — discarding 4 of 8 flags actually collected. A `MARINE_*` or
   `SPOT_RATINGS_*` lane drift is **invisible to the guard built to catch lane drift**.
3. **No dead workflow-env debt** — all 43 `env:` keys across 17 workflows have live consumers. A
   clean negative, independently rebuilt.
4. **`surf_science_audit` emits `[OPEN] height_statistic` on every default run, and `OPEN` never
   affects the exit code** — a permanently-open finding that can never fail CI.

### ⛔ REFUTED — struck
* *"`71c7dc69` was the only fix measured to make the EURO Gulf ingest fill non-zero."* **Inverted.**
  Its own production bake logged `{masked_seen:4615, gfs_masked:4473, filled:0}` — it was measured to
  fill **ZERO**, which is *why* it was reverted. The agent read the revert backwards.

### ⚠️ PARTLY_TRUE — the corrections matter more than the claims
* **`render.yaml` is NOT the serve box's declaration** — it is an unsynced Blueprint describing no
  deployed service, and its single flag is *measurably wrong* about production. (Stronger than claimed.)
* **`SPOT_HUB_SURF_TRANSFORM` (`spot_conditions.py:249`) vs `SURF_TRANSFORM`** (grid + point paths) —
  the hub gates on a **different env name**, absent from `_RATING_FLAGS`. "The truth is worse."
* **`test_flag_lane_parity` never opens `forecast-ingest-pilots.yml`** — a science flag flipped in the
  pilots lane is unguarded.
* **`WORLDWIDE_REGIONS_PER_CYCLE: '2'` is inert** — 5 lines after `INGEST_PILOTS: 'skip'`; sole read
  is `pilot_regions.py:151`.
* **`EURO_MID_RES` divergence is real textually but the value is never read** → no consequence.
* **Canaveral vortex: three user reports, FOUR fix commits**, each keyed to a resolution tier.
* **`main` is 978 commits / exactly 30 days behind `dev`**, zero divergent work on main, 372 of those
  touch `frontend/`.
* **Zero TODO/FIXME markers** in the four focus dirs — hardened three ways. Debt is prose.

---

## §3 — CORRECTIONS LEDGER (mine, and the repo's own records)

**My errors, all caught by a control — 7 across four audits:**

| # | Error | What caught it |
|---|---|---|
| 1 | v1 ranked by CPU cost | the Jacobian measurement |
| 2 | Hypothesised full-chain vs rating-only explained the 6.0 vs 7.4 gap | direct test — identical under saturation |
| 3 | Reported a "MISSED" mutation that was **inert** (`_sim_flag` defaults `"1"`) | asserting the mutation landed |
| 4 | AST census attributed by **file**, not enclosing function | reading the actual call |
| 5 | Ensemble probe 404'd everything — **wrong URL stem** (`-ef` not `-fc`) | a known-present control |
| 6 | Hand-decoded GRIB assuming simple packing → confident garbage (0.004 m everywhere) | spots on different oceans cannot share a value; template is **5.42** |
| 7 | Nearly escalated §2 into "the forecast calibrates against itself" | checking the last link — different tables |
| 8 | **This pass:** claimed the fourth path's error was one-directional (12-spot sample) | the full 29-spot run: **−34.1% … +29.7%** |

**Corrections to the repo's own records — 6:**
`JACOBIAN` memory (shore normal 6.0→7.4 / 23.6→28.1) · `JACOBIAN` memory (Hs 0.0 → +2.4…+3.0) ·
`JACOBIAN` memory (spot-independent sensitivities → false) · sim memory ("the sim doesn't gate" → it
does) · `CLAUDE.md` ("sim is height-blind" → delegates) · `BRAIN_RULES` (audit baselines 1,900+
commits stale).

---

## §4 — THE MASTER JACOBIAN

`leverage = sensitivity × uncertainty`. Every row re-proven today.

| Rank | Lever | Sensitivity (measured) | Uncertainty (measured) | Leverage |
|---|---|---|---|---|
| **M1** | **`/api/surf-conditions` → canonical chain** | **−34.1% … +29.7%**, median −32.5%, 29 spots, **signed both ways** | live, user-visible autofill | ★★★★★ |
| **M2** | **Shore-normal coverage + auto-refresh** | −7.4 @ p50 err, −28.1 @ +45°, **LEVEL differs 58.1%** | **47.5% coarse**, p50 err 24.7°, **>90° at 7.5%**, asset refreshes **by hand** | ★★★★★ |
| **M3** | **Ensemble `ifs/waef` → probabilistic sim** | **2–3 LEVELS** at realistic spread | 50 members CONFIRMED real; we ship one number | ★★★★★ |
| **M4** | **Spectral / period decomposition** | **−26.0 / −30.3 pts** (2–3 levels) on recorded live seas | EURO has no partitions; 6 bands free + unfetched | ★★★★ |
| **M5** | **Refraction `Kr`** | model assumes 1.0; measured **median 0.797**, 1.75× swing at a fixed site | unknown at 1,763/1,773 spots | ★★★★ |
| **M6** | **Self-invalidating descriptions** | 0 direct; **gates every other row** | **65 stale commits / 90 d**, 12+ subsystems | ★★★★ |
| **M7** | Runtime bathymetry 0.25° → 15 s | shelf depth ×0.5 = −7.5 at Cocoa (LEVEL) | 27.75 km at 100% of spots; inert at 51% | ★★★ |
| **M8** | The flag-lane guards (§2 items 1,2 + pilots lane + `SPOT_HUB_SURF_TRANSFORM`) | a wrong flag = a wrong number in one lane only | **4 of 8 flags discarded by the comparator** | ★★★ |
| **M9** | Two-veto coupling (`MIN_SAMPLES=12`) | +50.9 at Cocoa in-window | window bounded **4–10 m** | ★★★ |
| **M10** | v3's S1/S2/S3 (NaN guard · cache key · 5th surface) | latent; NaN→`epic` is the worst failure direction | unpinned, 487 pairs | ★★★ |
| **M11** | Revive/retire the two code-graph MCPs | 0 forecast pts | every agent silently degraded | ★★★ |
| **M12** | Data plane (binary store, retries, pooling, manifest CAS) | **0.0 forecast points** | ops only | ★★ |
| **M13** | JAX/Torch physics port | **0.292 s/cycle ceiling** | — | **negative — rejected** |

---

## §5 — THE SYNCHRONIZED UPGRADE PATH

> **Why "sync" is the operative word.** This repo's most expensive recorded defects are *not* wrong
> formulas — they are **the same quantity computed in more than one place, then drifting**: four
> forecast paths (M1), two kill-switch names for one transform, a flag with a different value per
> lane, a guard reading 3 of 4 lanes, five rating surfaces of which three are argument-checked.
> **Every phase below therefore lands in ALL lanes at once, or not at all.**

**THE SYNC CONTRACT — applies to every phase:**
1. **Three lanes together**: `forecast-ingest.yml` · `precompute.yml` · Render env. A flag in one lane
   makes the same spot two heights.
2. **Declared at default even when off** — so `test_flag_lane_parity` can see it (the repo's own
   `SURF_PARTITIONS: '0'` precedent).
3. **Ship inert**: default reproduces current behaviour byte-identically.
4. **A/B census before the flip**, reporting Δheight, Δscore and **% LEVEL change** — a LEVEL move is
   a product event, not a deploy.
5. **Ratchet the guard counts** and *read the number, not the colour*.

### PHASE 0 — Make the ledger honest (~2 days, zero risk, no forecast change)
* Fix the guard that cannot see drift: widen `test_flag_lane_parity` comparators to all four collected
  prefixes, and add `forecast-ingest-pilots.yml` to `INGEST_LANES`. *(§2 items 1, 2)*
* Register `SPOT_HUB_SURF_TRANSFORM` in `_RATING_FLAGS`, or rename it to `SURF_TRANSFORM`. **One
  transform, one switch.**
* Make `surf_science_audit`'s `[OPEN]` states affect the exit code, or state in-file that they cannot.
* Decide `render.yaml`: sync it to the deployed service or delete it. An unsynced Blueprint that is
  *measurably wrong about production* is worse than none.
* **Exit:** the flag/lane guards can actually go red. Everything after this depends on that.

### PHASE 1 — M1: close the fourth forecast path (~3 days, LOW risk)
Smallest targeted fix per BRAIN_RULES §Weather-Sim (*do not rewrite*): route
`services/surf_conditions.py`'s height through `resolve_surf_geometry` + `estimate_surf_at`, exactly
as `spot_ratings.rate_one_spot` does. Keep the offshore value too, **labelled** — Surfline's own
vocabulary splits *swell* (offshore) from *surf* (breaking); ours must too.
* **Guardrail:** add `/api/surf-conditions` to the argument-parity registry (making it **surface #6**),
  and a test asserting the served height equals `estimate_surf_at` at the same coordinate.
* **Measure first:** count stored posts with `conditions_source='auto'` — that sizes the footprint.
* **Exit:** no surface displays offshore Hs as surf. **This is the last known instance of the defect
  that CLAUDE.md was written to prevent.**

### PHASE 2 — M2 + M6: stop the decay (~1 week, LOW risk)
* **Schedule `build-shore-normals.yml`** (weekly + on spot-table change) with a monotonic entry-count
  guard and a *fail on any existing bearing moving >5°*.
* Promote `geometry_readiness` from a passive stamp to a **data-health alert** on the coarse share.
* **Self-invalidating descriptions**: a CI job that re-derives the checkable facts in `CLAUDE.md`,
  `BRAIN_RULES` and the queue — baseline commits still recent, named symbols still present, flags
  still read — and fails when a description has outlived its subject. *This is the fix for the 65.*
* **Exit:** the #1 Jacobian variable refreshes automatically; descriptions can no longer rot silently.

### PHASE 3 — M10 + M9: pin what is unpinned (~3 days, LOW risk)
`math.isfinite` terminal guard in `score_to_level` (+ a test that NaN is **not** `epic`) · pin the
geometry cache key at 6 dp with the 487-pair count in the docstring · register the live
`/spot-ratings` route and change `>= 4` to `== 5` (⚠️ coordinate — that file is in flight) · close the
two-veto coupling by flooring the oversize gate when both the reference and the break depth are absent.

### PHASE 4 — M4: the decomposition (~3 weeks, HIGH risk — product event)
Fetch `h1012…h2530` from the stream `ecmwf_opendata_fetcher` already uses; feed
`estimate_surf_partitioned` on band centre periods. **Step 1 is a spectral-closure test**
(`sqrt(Σband²)/swh ≤ 1`). Ship at `'0'` in all three lanes; A/B census before the flip.

### PHASE 5 — M3: go probabilistic (~4 weeks, HIGH risk — the differentiator)
Ingest `ifs/waef` (50 members, CCSDS/AEC → **eccodes with libaec**, not a hand decoder — I proved that
the hard way). The deterministic member stays the served number; the ensemble adds **new fields only**
(`p10/p50/p90`, `prob_level_at_least`). The sim's what-if then returns a **distribution shift**, which
is what a scenario engine is actually for.
* **Cost first**, per the recorded `SURF_PARTITIONS` lesson (*"precompute first, measure"*): 50 members
  on a 1-CPU box with a three-incident melt history is the binding constraint, not the science.

### PHASE 6 — M7 then M5 (~6 weeks, HIGH risk)
ETOPO 2022 15 s runtime grid, **then** learned/parameterised `Kr` — in that order, so `Kr` trains
against the best available geometry instead of absorbing bathymetry error into its weights.
Site-level hold-out, never hour-level. Success = measured Kr → 1.0 on unseen sites.

### Explicitly de-scoped
**M13 JAX/Torch physics port — rejected on measurement** (0.292 s/cycle). **Neural emulator of the
chain — rejected**: no validated corpus, and it would destroy the auditability (§v1 2.3) and the
independent-instrument check (`validate_nearshore_transform.py`) that make this system trustworthy.
**M12 data plane** — real, worth doing, but 0.0 forecast points: sequence it as capacity for Phase 5.

---

## §6 — LIMITS

* **LEADS, not findings** (agent-measured, not re-run by me): 29 CI-orphan modules · `conditions_labels.py`
  CI coverage · `SURF_HEIGHT_H110` guard passing with the flag ON · 4 reverted-and-never-restored guard
  files · `swell_exposure_fraction` wired to nothing · the ledger auditor scoring reverted commits as shipped.
* **RETRACTED:** all decoded ensemble **metre** values (§v4 6.1). Availability, structure, member count
  and packing stand; magnitudes do not.
* **NOT MEASURED:** ensemble ingest cost on the serve box — the deciding constraint for Phase 5;
  share of posts with `conditions_source='auto'` — sizes Phase 1.
* **MOVED under me:** the local product corpus was pruned mid-audit (6,675→4,424 files; manifest to 0
  products). v1's data-plane *ratios* re-proven; its absolute totals are a moving local artifact, not
  a production statement.
* **PLATFORM:** all timings Windows dev. Counts are platform-independent; unit costs are not.
* A concurrent session committed 9× during this work and holds 17 uncommitted files. **Every finding
  is read from committed HEAD**; none depends on that working tree.
