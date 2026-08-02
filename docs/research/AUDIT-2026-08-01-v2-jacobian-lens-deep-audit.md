# SOTA Architecture Audit v2 — through the Jacobian Lens

**Date:** 2026-08-01 · **Branch:** `dev` @ `1d269d97` · **Mode:** read-only, no functional code altered.
**Supersedes:** `AUDIT-2026-08-01-sota-architecture-and-zero-regression-upgrade-path.md` (v1 ranked by
CPU cost; **v1's ranking was wrong** — see §0).

**Lens:** `leverage = sensitivity × uncertainty`. Rank work by how much it moves *the number a surfer
reads*, not by how modern it is or how much CPU it burns.

**Evidence standard applied:** every number below is measured on this machine or probed from a live
public endpoint. Where I could not verify something, it is marked **UNVERIFIED** and named as a
first step, not smoothed over.

---

## §0 — v1's ranking was wrong, and the Jacobian is why

v1 correctly measured that the physics costs **0.117 s per precompute cycle** vs **up to 8.4 min** of
JSON deserialization, and concluded: fix the data plane. That measurement stands. **The conclusion
drawn from it did not.**

CPU time is not the constraint *and neither is it the objective*. A 481× faster product load changes
**zero** forecast numbers. Re-ranked by leverage:

| Upgrade | Δ CPU | **Δ the number a surfer reads** |
|---|---|---|
| Binary/Zarr product store | −8 min/cycle | **0.0 points at every spot** |
| Manifest sharding | −ops risk | **0.0 points** |
| Shore-normal coverage | ~0 | **median −9.0 pts, LEVEL differs at 58.1% of spots** |
| Spectral/period decomposition | +4× | **−26.0 and −30.3 pts (2–3 levels) on recorded live seas** |

v1's Phase 2 (data plane) is **ops work with no accuracy return**. It is still worth doing — it buys
wall-clock headroom that Phases below *spend* — but it is a **means**, not an end, and it must not
sit ahead of the accuracy work. v2 re-sequences accordingly.

---

## §1 — Harness validation (two-sided reconstruction)

Before trusting any Jacobian number, the harness had to reproduce the recorded deployed values.

| spot | shore normal | src | break depth | surf (m) | score |
|---|---|---|---|---|---|
| Mavericks | 225.1° | etopo | 22.1 m | 2.361 | **89.5** |
| Cocoa Beach | 99.1° | etopo | 5.9 m | 1.894 | **89.5** |
| Lower Trestles | 219.0° | etopo | 9.3 m | 2.433 | **89.5** |
| Pipeline | 325.0° | override | 11.1 m | 2.433 | **89.5** |

All four reproduce the recorded base **89.5**, and every break depth matches the recorded stage table
(22.1 / 5.9 / 9.3 / 11.1) exactly. **Harness validated.**

---

## §2 — Four corrections to the recorded Jacobian

### 2.1 ⚠️ The recorded shore-normal figure measures the wrong quantity — it **understates by ~20%**

The recorded memory lists "shore normal +22.3° → 6.0 pts". My full-chain run gave **7.4**. I
hypothesised the difference was full-chain vs rating-only. **That hypothesis is DEAD** — measured,
both give −7.4 (under saturation the height path contributes 0). The real cause, proven by
decomposition:

| what is perturbed | +22.3° | +45° | factors touched |
|---|---|---|---|
| **A.** swell direction off, normal correct | **−6.0** | **−23.6** | `swell_exposure` only |
| **B.** shore NORMAL wrong (the actual defect) | **−7.4** | **−28.1** | `swell_exposure` **+ `wind_quality` + `wind_gate`** |

Column A reproduces the recorded 6.0 / 23.6 **exactly**. The recorded row measured *swell
misalignment against a correct normal* — but a wrong normal **also re-classifies the wind**
(`wind_quality` 0.8700 → 0.7667 at +45°). An offshore wind can be scored as cross-shore purely
because the coast's assumed aspect is wrong.

⇒ **The true cost of a wrong shore normal is 23% higher at the median error and 19% higher at +45°
than the repo's most-cited memory records.** The #1 Jacobian variable is *more* dominant than
believed.

### 2.2 ⚠️ "Offshore Hs accuracy is worth 0.0 points" is now **STALE and wrong**

That finding was true only because `size_score` saturated at the global 1.2 m reference.
**`RATING_LOCAL_SIZE` has been 1 in all three lanes since `3263031c`**, which un-saturates it.

| perturbation | LEGACY (what 07-30 measured) | **CURRENT (live)** |
|---|---|---|
| offshore Hs +10% | +0.0 everywhere | **+2.4 / +2.1 / +3.0** (Pipeline: **LEVEL changes**) |
| offshore Hs −10% | +0.0 everywhere | **−2.5 / −4.6 / −3.1** (Cocoa: **LEVEL changes**) |
| shelf depth ×0.5 | +0.0 everywhere | **−7.5 at Cocoa Beach (LEVEL changes)** |

⇒ Height accuracy, buoy calibration, partitions and the 0.25° shelf depth **all now move the score.**
The recorded priority order was written under saturation and no longer holds.
*(Lower Trestles reads 0.0 only because I had no recorded local reference for it — a limitation of my
input, not a fact about that spot.)*

### 2.3 ⚠️ "All spots return identical sensitivities" is now **FALSE**

Recorded: all four spots gave 89.5 and identical sensitivities. Measured now with local references:
**60.9 / 87.4 / 89.5 / 67.9** — base scores diverge, and so do the sensitivities. The Jacobian is
**no longer spot-independent**, so a single global priority order is no longer strictly correct.

### 2.4 ✅ Confirmed: `break_depth` is worth **0.0 at ordinary size**

`break_depth → None` costs **+0.0** at all four spots in **both** flag states. The depth-limited cap
is inert outside the oversize regime, exactly as designed. ⇒ **v1's emphasis on break-depth coverage
was misplaced for ordinary days.** It is an oversize-regime and big-wave-spot signal only.

---

## §3 — The catalogue census: both Jacobian axes, measured over 1,587 real spots

Source: local `backend/dev.db`, 1,587 spots (~90% of the ~1,773 production catalogue), resolved
against the bundled ETOPO + `shore_normals.json` assets in **2.4 s, zero network** (1.5 ms/spot).

### 3.1 The UNCERTAINTY axis — where the shore normal actually comes from

| source | spots | share | what it means |
|---|---|---|---|
| `etopo` | 802 | 50.5% | 463 m ETOPO 2022 fit |
| **`coarse`** | **754** | **47.5%** | **0.25° grid, ±83 km window** |
| `none` | 25 | 1.6% | no bearing at all |
| `override` | 6 | 0.4% | hand-audited ground truth |

`break_depth` **missing at 999/1,587 = 62.9%**. Shelf depth >200 m (bottom friction **inert**) at
**51.0%** of spots. Shelf depth p50 **240.5 m**, p90 **2,098 m** — a ~139 km median that is deep
enough to switch friction off at half the catalogue.

⚠️ **Honest caveat, stated rather than smoothed:** the recorded production census read etopo 76.4% /
coarse 22.2%. Mine reads 50.5% / 47.5%. I **cannot** attribute that gap without the production
catalogue — `dev.db` may be a different or older spot list. What I *can* measure is the discriminator.

### 3.2 The discriminator — this is not small pin-drift

`MATCH_RADIUS_KM = 1.0`. For the 779 spots outside it, distance to the nearest asset entry:

| p10 | **p50** | p90 | within 2× radius | >50 km |
|---|---|---|---|---|
| 1.56 km | **5.23 km** | 237.75 km | 118 (15.1%) | 168 (21.6%) |

The median unmatched spot is **5.23 km from the nearest asset entry — 5× the match radius.** So the
gap is *not* explained by pins nudging a few metres. Whatever the production number is, the
**mechanism** is what matters, and it is measurable here.

### 3.3 The SENSITIVITY axis — measured, not synthetic

For the **785 spots that carry both a coarse and a fine bearing**, I compared the two directly. No
assumed perturbation.

**How wrong the coarse bearing is** (vs the 463 m fit at the same coordinate):

| p10 | p25 | **median** | p75 | p90 | max | mean | >45° | **>90°** |
|---|---|---|---|---|---|---|---|---|
| 4.8° | 11.2° | **24.7°** | 50.1° | 80.0° | 178.1° | 35.4° | 29.6% | **7.5%** |

*(recorded: median 22.3°, >45° at 26.6% — my census confirms and slightly exceeds it)*

**>90° at 7.5% of spots means the coast is assumed to face the wrong way entirely** — offshore wind
scored as onshore.

**What it costs, scored end-to-end** (1.5 m / 14 s / 5 m/s offshore):

| flag state | median Δ | p10 Δ | mean \|Δ\| | **LEVEL differs** |
|---|---|---|---|---|
| legacy `ref=None` | −9.0 | −72.3 | 22.06 | **456/785 = 58.1%** |
| with a local ref | −9.9 | −73.4 | 22.99 | **510/785 = 65.0%** |

⚠️ This is measured on spots that *passed* the fit gate. Spots currently on coarse **failed** it
(`ambiguous_coastline`), so their coarse bearings are plausibly worse. Treat **58.1% as a lower
bound.**

### 3.4 ⭐ THE ROOT, NAMED

> **The single highest-leverage input in the entire forecast chain is served from a static JSON
> asset, matched by a 1.0 km radius, rebuilt only by manual `workflow_dispatch`, last built
> 2026-07-28 — while every other forecast input refreshes 6× per day.**

`build-shore-normals.yml` documents its own failure mode in its header: *"moved spots simply stop
matching the asset and fall back to the coarse value (safe, but they lose the fix)."* It is safe, it
is silent, and it is on the one variable that dominates the Jacobian on both axes.

This is the recorded **coverage class** — *a resource picked with no requirement that it contain what
it covers, degrading silently* — sitting on the #1 variable.

---

## §4 — Research: what is actually available (verified, not assumed)

### 4.1 ⭐ A permissive coastline vector exists — the ODbL blocker has a way around it

`scripts/validate_shore_normals_osm.py` already derives seaward bearings from **OSM coastline
winding** (land-left/water-right), needs no elevation data at all, and has already earned its keep:
it caught Outer Banks spots shipped at 273–290° facing *into Pamlico Sound* at 4.5° spread — i.e.
**maximum confidence while completely wrong** — and found Uluwatu **156.2° off** on the coarse value.
It is deliberately **measurement-only**, because OSM is **ODbL** and the repo holds zero `osm_id`.

**[GSHHG](https://www.soest.hawaii.edu/pwessel/gshhg/)** (Wessel & Smith, NOAA/U. Hawaii) is the
alternative that removes the licence objection:
- Amalgamated from **World Vector Shorelines, CIA WDBII, and Atlas of the Cryosphere — all public
  domain**; released under LGPL from v2.2.2 (v2.3.7, June 2017).
- Five resolution tiers, full-resolution shoreline as closed, self-consistent polygons.
- ⇒ The **same land-left winding trick works on any coastline polygon**, and GSHHG's licensing
  permits it as a *producer*, not just a validator.

⚠️ **UNVERIFIED and it matters:** GSHHG's page does not state full-resolution positional accuracy in
metres. WVS is nominally ~1:250,000. **Whether GSHHG resolves a 463 m ETOPO fit must be measured
before adopting it** — and the repo already owns the instrument to do it
(`validate_shore_normals_osm.py`, pointed at GSHHG, graded against the existing OSM column).

### 4.2 ⭐⭐ Six period bands are sitting on the endpoint this repo already fetches from

The recorded fact — *"ECMWF WAM has NO partitions on ANY path"* — is **CONFIRMED by live probe**: no
`shts` / `shww` / `mdts` / `mdww` / `mpts` / `mpww` in either stream. The memory is right.

But the probe found something the repo is not fetching. Live index probe,
`data.ecmwf.int/forecasts/20260801/12z`, HTTP 200 on all three:

| stream | params published |
|---|---|
| `ifs/wave` (13) | `swh mwd mwp pp1d mp2 cdww wmb` + **`h1012 h1214 h1417 h1721 h2125 h2530`** |
| `aifs-single/wave` (11) | `swh mwd mwp cdww wmb` + **`h1012 h1214 h1417 h1721 h2125 h2530`** |
| `aifs-single/oper` (33) | atmospheric only |

`h1012` = *significant wave height of all waves with periods 10–12 s*; likewise 12–14, 14–17, 17–21,
21–25, 25–30 s. **Six period-resolved wave heights, free, GRIB2, on the exact ECMWF Open Data
endpoint `ecmwf_opendata_fetcher.py` already talks to** — and `ecmwf-opendata>=0.3.3` is already in
`requirements.txt`. The repo currently pulls only `swh/mwp/pp1d/mwd`.

Two things this is worth:
1. **It is the missing period layer.** The recorded surfer-science says *"⛔no period layer (surfers
   filter ≥10 s)"*. These bands **are** the ≥10 s filter, straight from the model.
2. **It is a better decomposition than partitions for this chain.** `estimate_surf` is strongly
   non-linear in period — that is the entire reason `estimate_surf_partitioned` exists. Period bands
   are indexed *by the variable the transform is non-linear in*, and there are six of them, not three.

⚠️ **Limits, stated plainly:**
- Bands cover **≥10 s only**. Wind sea (<10 s) is not resolved — it is the residual of `swh`. For
  surf that may be the right split, but it is **not** a complete spectral decomposition.
- ⛔ **Band VALUES are UNVERIFIED.** No GRIB decoder is installed on this box (`pygrib`, `cfgrib`,
  `eccodes` all absent; a bundled-binary install failed). Message sizes of **705–791 KB** for a
  1,038,240-point grid (~5.7 bits/point) *indicate* populated fields — an all-missing field would
  compress to a few KB — **but that is an inference, not a value count.** The repo's own recorded
  scar is exactly this (*"OM marine-api returns timestamps over ALL-NULLS — count VALUES"*).
  **Decode and count non-null values is step 1 of any work here.**
- The authoritative ECMWF Confluence page states wave stream is *"not applicable for AIFS model"* —
  **the live endpoint contradicts it (HTTP 200 + a valid 11-param index).** The doc is stale; trust
  the probe, and re-probe before building.

### 4.3 AIFS v2 waves: ~10% better SWH, ≈ 1 day of lead time

[AIFS Single v1 went operational 25 Feb 2025; AIFS-ENS 1 Jul 2025; **v2 added the wave component,
live 12 May 2026**](https://www.ecmwf.int/en/about/media-centre/news/2026/ifs-cycle-50r1-aifsv2-live).
Per [the ECMWF paper](https://arxiv.org/html/2604.25559v1), AIFS Waves *"reduces the medium-range
forecast error for SWH by approximately 10% compared to ECMWF's operational wave forecasting system…
roughly one day in lead time, with gains across most regions."* 0.25° N320, 4 cycles/day. Known
weakness: reduced skill near the **sea-ice edge**.

⇒ A candidate EURO upgrade on a client the repo already has. Note it publishes **no `pp1d`** (peak
period) where `ifs/wave` does — a real schema difference to handle, not a drop-in swap.

### 4.4 Bathymetry: the repo's own fine asset is already the SOTA product

[ETOPO 2022 is 15 arc-sec and uses the GEBCO grids as its base
layer](https://essd.copernicus.org/articles/17/1835/2025/); [GEBCO publishes 15 arc-sec grids
annually (2022, 2024, 2025)](https://www.gebco.net/data-products/gridded-bathymetry-data). The
repo's `shore_normals.json` is already built from **"NOAA ETOPO 2022 v1 15s via ERDDAP (CC0 public
domain, ~463 m)"**.

⇒ **There is no better free global product to chase.** The gap is not the source — it is that the
runtime grid (`etopo_depth_0p25.npy`) is still **ETOPO1 strided to 0.25°**, while the modern source
is already wired into a different code path. This is a **plumbing** gap, not a data-availability gap.

### 4.5 Data plane: Icechunk is the current answer, but it is still ops work

[Icechunk](https://icechunk.io/) adds database-style **transactions** over Zarr v3 with full state in
object storage, readers isolated from concurrent writers via committed snapshots — which maps
directly onto §Gap 1.2 (the 6.49 MB `manifest.json` with **no compare-and-swap**, whose own code
comments name the lost-update race). [VirtualiZarr](https://virtualizarr.readthedocs.io/) writes
virtual references into Icechunk. ⇒ The manifest+product pair is a hand-rolled catalogue that
Icechunk solves as a product. **Still 0.0 forecast points — sequence it as enabling work.**

---

## §5 — The leverage table (this replaces v1's ranking)

| # | Lever | Sensitivity (measured) | Uncertainty (measured) | **Leverage** |
|---|---|---|---|---|
| **L1** | **Shore-normal coverage + refresh** | −7.4 @ median err; −28.1 @ +45°; **58.1% LEVEL change** | **47.5% on coarse**; median err **24.7°**; **7.5% >90°**; asset **manual-refresh** | **★★★★★** |
| **L2** | **Spectral / period decomposition** | **−26.0, −30.3 pts (2–3 levels)** on recorded live seas | EURO has **no** partitions; bands **unfetched**; values UNVERIFIED | **★★★★★** |
| **L3** | Shore-normal *accuracy* (GSHHG/OSM ground truth) | ≈ L1 per degree | fit gate is self-consistency only; 4.5°-spread bearings shipped **backwards** | ★★★★ |
| **L4** | Refraction `Kr` | model assumes 1.0; measured **median 0.797**, 1.75× swing at a fixed site | unknown at 1,763/1,773 spots | ★★★★ |
| **L5** | Offshore Hs / buoy calibration | **+2.4 / +2.1 / +3.0** (was 0.0 pre-`RATING_LOCAL_SIZE`) | few-% model class error | ★★★ |
| **L6** | Runtime bathymetry 0.25° → 15s | shelf depth ×0.5 = **−7.5 at Cocoa (LEVEL)**; inert at 51% (>200 m) | 27.75 km grid at 100% of spots | ★★★ |
| **L7** | AIFS v2 wave model | ~10% SWH error ⇒ ~1 day lead | ECMWF-measured, not by us | ★★★ |
| **L8** | Tp accuracy | +2.7 / −3.7 | few-% model class error | ★★ |
| **L9** | `break_depth` coverage | **0.0 at ordinary size** (confirmed both flag states) | missing at 62.9% | ★ (oversize only) |
| **L10** | Binary/Zarr store, retries, pooling, manifest | **0.0 forecast points** | — | ops only |
| **L11** | JAX/Torch physics port | 0.117 s/cycle ceiling | — | **negative — rejected** |

---

# Section 1 — Core System Architecture Gaps (re-ranked by leverage)

**1.1 ★★★★★ The #1 variable has no automatic refresh.** `shore_normals.json`, `MATCH_RADIUS_KM=1.0`,
`workflow_dispatch` only, last built 2026-07-28. 47.5% of the local catalogue is on the coarse
fallback; **LEVEL differs at 58.1%** of directly-comparable spots. A spot added or moved >1 km
silently loses the fix. *(Mitigation that exists and is good: `geometry_readiness` is stamped onto
the point response — the degradation is **recorded**, just not **repaired**.)*

**1.2 ★★★★★ EURO cannot decompose its sea, and the fix is unfetched on an endpoint already in use.**
`h1012…h2530` are published free on `ifs/wave` and `aifs-single/wave`. Pricing the decomposition on
recorded live seas: **Mavericks 81.3 `good` → 55.3 `fair`; Ocean Beach SF 84.2 `epic` → 53.9 `fair`.**
Today those chop-dominated seas ship as good/epic.

**1.3 ★★★★ The fit gate validates self-consistency, not correctness.** `shore_normal_fit` gates on
angular spread across windows. Recorded: Outer Banks shipped bearings into Pamlico Sound at **4.5°
spread = maximum confidence, completely wrong**. A self-consistent fit cannot detect a wrong sign.
The independent instrument exists (`validate_shore_normals_osm.py`) and is not in the build loop.

**1.4 ★★★★ Refraction is absent** (`Kr = 1.0`); measured median **0.797** over 385,651 CDIP hours,
**1.75× swing at a fixed site** by swell direction. Snell is anti-correlated (r = −0.565).

**1.5 ★★★ Runtime bathymetry is ETOPO1 @ 0.25°** while ETOPO 2022 15s is already used elsewhere in
the repo. Now materially leveraged post-`RATING_LOCAL_SIZE` (Cocoa −7.5, LEVEL change).

**1.6 ★★★ Nine `os.environ.get` per `estimate_surf`** — 9 exact, platform-independent; ~7.45 µs of
10.67 µs on Windows dev (**Linux unmeasured**). The real harm is non-determinism w.r.t. process env
and a barrier to any future vectorization.

**1.7 ★★ Ops gaps (v1, unchanged and still real, 0.0 forecast points):** JSON AoS products at
**159.3 B/cell** (6.6× larger, **481× slower** to load than `.npy`; 781 MB / 6,675 files); **6.49 MB
`manifest.json`** rewritten per mutation with **no CAS**; **zero HTTP retry/backoff** in all four
direct fetchers; **no `requests.Session`** (~450 cold TLS handshakes per global product); triple
nested Python loop in the coarse block-mean; product-cache thrash from spot-major loop ordering.

**1.8 ★ Stale documentation:** `CLAUDE.md` still calls `weather_sim_mcp.py` "height-blind" — it
delegates to `sim_rating` → production `compute_surf_rating`. And the recorded Jacobian memory
carries the three superseded figures corrected in §2.

---

# Section 2 — Competitive Advantages & Strengths

All twelve from v1 stand (kill-switch discipline · `validate_nearshore_transform.py` · cited physics
· AST composition-parity guard · NaN self-inequality guards · `R × coverage` direction confidence ·
gap-calibrated thresholds · correct async offloading · low-strain byte-range ingestion · time-axis
alignment on failure · designated-writer gate · regeneratable goldens). Three earn a promotion under
this lens:

**2.1 ⭐⭐ `geometry_readiness` — the degradation is already instrumented.** The system *knows* which
spots are on a coarse bearing and stamps it onto the point response. The Jacobian says that field is
tracking the single most important uncertainty in the product. **It should be driving an alert and a
rebuild trigger, not just riding along.** The hard part is done.

**2.2 ⭐⭐ `validate_shore_normals_osm.py` — an independent truth column that shares nothing with
ETOPO.** It documents the exact bug that made its own first version lie (averaging both shores of a
spit cancels; fixed by clustering to the nearest coast — Outer Banks 86° → 1°). This is the
instrument L3 needs, already written and already committed.

**2.3 ⭐⭐ The flag lane-parity discipline.** `SURF_PARTITIONS` is declared at `'0'` in both workflow
envs *specifically so the lane-parity guard can see it*. That is what makes every recommendation
below shippable inert.

---

# Section 3 — Regression Risk Matrix

| # | Upgrade | Risk | Why | Guardrail |
|---|---|---|---|---|
| **R1** | Automate shore-normal rebuild (schedule + on spot-table change) | **LOW** | Adds entries; committed asset already wins over coarse, so it can only *upgrade* a spot | Assert asset entry count is **monotonically non-decreasing**; diff bearings for existing entries and **fail on any change >5°** (a rebuild must not silently move a shipped bearing) |
| **R2** | Widen `MATCH_RADIUS_KM` 1.0 → 2.0 | **MEDIUM** | Recovers 15.1% of unmatched spots — but assigns a bearing fitted **up to 2 km away** | A/B the 118 affected spots against `validate_shore_normals_osm.py`. **Adopt only if OSM-graded error improves**; this is a candidate, not a recommendation |
| **R3** | GSHHG as a *producer* for missing bearings | **MEDIUM** | New geometry source at 47.5% of spots — a product event | Grade GSHHG vs OSM vs ETOPO head-to-head **first**. Adopt per-spot only where it beats coarse. Precedence below the committed ETOPO asset ⇒ displacement impossible |
| **R4** | Fetch `h1012…h2530`; wire to `estimate_surf_partitioned` | **HIGH — deliberate forecast change** | Priced at **−26 to −30 pts, 2–3 levels** on recorded seas. Correct, and large | **Step 1: decode and COUNT non-null values** (currently UNVERIFIED). Then spectral-closure test `sqrt(Σband²)/swh ≤ 1`. Ship behind a flag at `'0'` in **all three lanes**; full A/B census before flip |
| **R5** | Runtime bathymetry → ETOPO 2022 15s | **HIGH** | Moves shelf depth/width/coastal gate at 100% of spots | Full A/B census; gate the flip on `validate_nearshore_transform.py` **not worsening**; named exemplars inspected individually; budget the asset against the 512 MB box before building |
| **R6** | Learned/parameterised `Kr` | **MEDIUM** | **Adds** an absent term; failure mode is "turn it off" | Multiplicative, `1.0`-default, flag-gated (same shape as `magnet_factor`). Train on CDIP with **site-level hold-out, never hour-level**. Success = measured Kr → 1.0 on unseen sites |
| **R7** | AIFS v2 as EURO source | **MEDIUM** | Different model; **no `pp1d`**; weak at sea-ice edge | Shadow-ingest alongside ECMWF WAM for ≥3 cycles; diff at the spot level before any cutover |
| **R8** | Hoist env flags; Session+Retry; region-sort | **LOW** | Pure mechanism | v1's guardrails unchanged (bit-identical goldens, fault injection, set-equality) |
| **R9** | Binary store / Icechunk manifest | **MED / HIGH** | Ops only, 0.0 forecast points | v1's dual-write shadow guardrails unchanged |
| **R10** | JAX/Torch physics port | — | **0.117 s/cycle ceiling** | **Rejected on measurement** |

**Cross-cutting (from this repo's own scars):** assert what RAN (ratchet file+test counts, read the
**number** not the colour) · every differential needs a **known-failing control** · measure baselines
in a clean worktree at HEAD · a flag has a value **per lane** — flip ingest + precompute + Render
together · `assert len(vectors) == cols*rows` before deploy.

---

# Section 4 — Incremental "Zero-Regression" Upgrade Path

**Re-sequenced: accuracy first.** v1 put the data plane in Phase 2; the Jacobian says it buys zero
forecast points, so it moves behind the two five-star levers.

### Phase 0 — Verify the two unverified facts · ~2 days · zero risk
1. **Decode `h1012…h2530` and COUNT non-null values** over an ocean mask. Presence is verified; values
   are not. If they are sparse or null, L2 collapses and the whole sequence changes.
2. Re-run the geometry census against the **production** spot list to settle 50.5% vs the recorded
   76.4%.
3. Re-price the env-flag reads on **Linux**.
4. Land the per-stage timing census from v1 Phase 0.
- **Exit:** three facts settled. No code behaviour changed.

### Phase 1 — L1: make the #1 variable self-maintaining · ~1 week · **LOW risk**
- Schedule `build-shore-normals.yml` (weekly + on spot-table change) with R1's monotonicity and
  >5°-drift guards.
- Promote `geometry_readiness` from a passive stamp to an **alert**: fail the data-health monitor when
  the coarse share exceeds a ratchet.
- Land v1's Phase-1 free wins (R8) alongside — byte-identical output.
- **Exit:** coarse share is *measured every cycle and trending down*; no spot silently loses its
  bearing again. **This is the highest-leverage week available.**

### Phase 2 — L3: grade the bearings against independent truth · ~2 weeks · **LOW→MEDIUM**
- Put `validate_shore_normals_osm.py` **in the build loop** — every rebuild grades itself against a
  source sharing nothing with ETOPO.
- Evaluate **GSHHG** head-to-head (R3) and settle its unverified positional accuracy.
- Then, and only then, decide R2 (match radius) on measured evidence.
- **Exit:** every shipped bearing has an independent grade; the fit gate stops being self-referential.

### Phase 3 — L2: the decomposition · ~3 weeks · **HIGH risk, product event**
Gated on Phase 0.1 passing.
- Extend `ecmwf_opendata_fetcher` to pull the six bands; normalize as period-indexed trains.
- Spectral-closure test, then feed `estimate_surf_partitioned` on band centre periods.
- Ship inert (`'0'` in all three lanes); full A/B census; flip as an announced product event.
- **Exit:** EURO can decompose its sea; the ≥10 s period layer exists; chop-dominated seas stop
  shipping as epic.

### Phase 4 — The data plane · ~3–4 weeks · **MEDIUM→HIGH** (v1 Phases 2–3 unchanged)
Binary dual-write → shadow-read → one lane → cutover; then Icechunk/sharding for the manifest. Buys
the wall-clock headroom Phase 5 spends. **0.0 forecast points — sequenced accordingly.**

### Phase 5 — L6 + L4: bathymetry, then refraction · ~6 weeks · **HIGH**
ETOPO 2022 15s runtime grid (R5), then learned `Kr` (R6) — **in that order**, so `Kr` is trained
against the best available geometry rather than absorbing bathymetry error into its weights.

### Phase 6 — L7: evaluate AIFS v2 · ~2 weeks · **MEDIUM**
Shadow-ingest and diff. Deliberately last: a 10% SWH improvement is worth ~+0.3 score points at the
measured Hs sensitivity — **real, but an order of magnitude below L1 and L2.**

---

## Limits of this audit — stated, not buried

- **UNVERIFIED:** ECMWF period-band **values** (no GRIB decoder on this box; presence and payload size
  verified, value count not). This is Phase 0 step 1.
- **UNATTRIBUTED:** the 50.5% vs recorded 76.4% coverage gap. `dev.db` may differ from production. The
  *discriminator* (median 5.23 km vs a 1.0 km radius) and the *mechanism* are measured; the
  production percentage is not.
- **ASSUMED INPUT:** local size references for Mavericks (1.816 m), Pipeline (1.527 m), Cocoa (0.785 m)
  come from recorded cross-validated measurements, not a live blob (none on this box). Lower Trestles
  had none, which is why it reads 0.0 for Hs sensitivity — a limit of my input, not a fact.
- **SINGLE SEA STATE:** the 58.1% LEVEL-change census is at 1.5 m / 14 s / 5 m/s. The recorded
  45.8% figure spans multiple states. Both are large; they are not the same measurement.
- **PLATFORM:** all timings are Windows dev. Counts are platform-independent; unit costs are not.
- No production system was contacted; no live app payloads fetched. Public ECMWF open data was probed
  read-only.
