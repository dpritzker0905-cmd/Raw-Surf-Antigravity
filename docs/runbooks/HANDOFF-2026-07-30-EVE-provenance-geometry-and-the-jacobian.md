# HANDOFF 2026-07-30 EVE — provenance, geometry that scales, and the measured Jacobian

**Continues `HANDOFF-2026-07-30-the-sim-one-composition-and-the-time-dimension.md`.**
Read [[standing-work-rules-user-mandate]] first, then
`memory/THE-SURF-FORECAST-SCIENCE-canonical-chain.md` (the spine) and
`memory/JACOBIAN-the-shore-normal-dominates-2026-07-30.md` (what to fix).

**Branch `dev`, tree clean, EVERYTHING PUSHED** — `origin/dev` == `e058ea49`.
Backend **1,389 passed**, 2,928 skipped. LOC ratchet green. One pre-existing unrelated failure:
`test_media_privacy_contracts.py::test_protected_grom_media_...` (confirmed pre-existing).

| commit | what |
|---|---|
| `812aec73` | self-audit — I quoted a worst-case tide point as typical (71.5% → 41.0%) |
| `e637d6dc` | the spectral transform had no data path |
| `a6280572` | pinning a spot gave it no geometry until a human clicked a button |
| `7b686b84` | handoff |
| `4d69e62a` | the manifest could not say whether EURO came from ECMWF or open-meteo |
| `8ce65c95` | a coarse shore normal was served to 14 decimal places and called nothing |
| `e058ea49` | the gate is all-or-nothing, but the two measurements are not |

---

## 0. ★★★ THE ONE-PARAGRAPH SUMMARY

Not one recurring defect in this app has been a physics error — the audit record says *"30 items
CONFIRMED CORRECT — the arithmetic is not the problem."* Every real failure has been **provenance or
composition**. This session made the forecast **self-describing** (it can now say where a number
came from and what it is standing on), proved with a measured Jacobian that **the shore normal
dominates every other input**, and found that **geometry is the only per-spot input that does not
travel with the spot**. Three of my own claims were killed by measurement along the way; all three
corrections are recorded below.

---

## 1. ★★★ THE MEASURED JACOBIAN — what to improve, with numbers

From a realistic base (1.5 m / 14 s / 5 m/s light offshore / head-on, score 89.5), perturbing one
input by a REALISTIC error:

| input | realistic error | **Δ score** |
|---|---|---|
| **shore normal** | **+22.3° — its MEASURED median error** | **6.0** |
| **shore normal** | **+45° — 26.6% of spots are worse** | **23.6** |
| Tp | +10% | 2.7 |
| wind | +10% | 1.3 |
| **offshore Hs** | **+10%** | **0.0** |

★ **Leverage = sensitivity × uncertainty, and the shore normal wins on both axes.** Hs/Tp/wind come
from buoy-calibrated global models; the shore normal is fitted and is median 22.3° off.

### Two second-order results that change priorities
1. ⚠️⚠️ **Offshore Hs accuracy is worth 0.0 points above chest-high.** `size_score` SATURATES at the
   global 1.2 m default, so partitions / Kr / calibration buy nothing *in the score* until
   `RATING_LOCAL_SIZE` ships with a real climatology blob — and that blob is **absent**
   (`load_size_climatology_l2_cached()` returns None, verified). **Local size calibration is the
   unlock that makes all the height work count.**
2. **All four test spots returned IDENTICAL sensitivities.** The rating's structure is
   spot-INDEPENDENT because geometry barely enters except via the shore normal.

### Stage decomposition (offshore 2.0 m / 14 s, head-on)
| spot | shelf m | Kf | Ks | out/Hs |
|---|---|---|---|---|
| Mavericks | 101.5 | 0.963 | 0.959 | 1.49 |
| Cocoa Beach Pier | 24.0 | **0.731** | 0.957 | **1.19** |
| Lower Trestles | 729.5 | 1.000 | 1.000 | 1.53 |
| Pipeline | 2534.5 | 1.000 | 1.000 | 1.53 |

★★ **Trestles and Pipeline produce a byte-identical 3.063** — both shelves so deep that friction AND
shoaling are inert, and the cap never binds. Two different breaks, one number: depth-blindness made
concrete. At most spots the transform is ~a constant 1.5× on Hs.

★ External best practice agrees on the shape and names the gap: nearshore transformation =
refraction + shoaling + friction + depth-limited breaking. **We have three; refraction is missing** —
matching the measured Kr median 0.797 with the site offset unknown at 1,763 of 1,773 spots.

---

## 2. ★★★ PROVENANCE — two labels were lying

### 2a. `provider` says open-meteo for ECMWF, NOAA and DWD data (`4d69e62a`)
The owner asked *"EURO should not be on open-meteo"* and **the manifest could not say.**
`provider`=open-meteo, `upstream_provider`=open-meteo (a bare echo), `upstream_model`=`ecmwf_wam025`
— which names the MODEL, and Open-Meteo serves a model by that exact name. **Two different fetch
routes produced byte-identical manifests.**

⛔ **`provider` CANNOT be repurposed** — `normalizer.py:549` branches on it to choose
`source_dataset` AND the entire CMEMS variable mapping (`VHM0`/`VMDR`/`VTM10`).
✅ The truth already existed and was dropped: every direct fetcher stamps `__provider`
(`ecmwf`/`dwd`/`noaa`/`copernicus`) via `_fetch_common.make_point_dict`. `upstream_provider` now
carries it. **Self-correcting** — no marker means Open-Meteo genuinely served it.

### 2b. A coarse shore normal was served to 14 decimal places (`8ce65c95`)
Bondi served `shore_normal_deg = 111.54097591853844` with **no source, no break depth, no verdict**
— off the coarse grid, whose class is median 22.3° wrong. `assess_geometry` already graded it;
nothing assembled it. Now stamped in `point_surf_augment` (the single place `surf_height_m` is
produced) so glyphs, hub and sim inherit ONE verdict.

⚠️ **`geometry_readiness` ≠ `confidence`.** `confidence` grades the PIN; readiness grades the INPUTS.

⚠️ **The extraction that followed broke it and almost got away with it.** The ratchet blocked at 801
LOC, the surf block moved to `point_surf_augment.py`, the moved body still referenced `self`, and
the block's broad `except Exception` swallowed the `NameError` as a debug line — **the transform was
silently OFF while every response still validated.** Only
`test_resolve_point_attaches_surf_for_marine` caught it. A comment now says so at that `except`.

---

## 3. ★★★ GEOMETRY MUST TRAVEL WITH THE SPOT (the scaling answer)

Geometry lives in **three places, none of which is the spot**: the git-committed asset (manual
`workflow_dispatch`), the runtime overlay (**ephemeral — Render's disk is lost on redeploy**), and
the coarse grid (**median 22.3° wrong**).

★★★ **`surf_spots` has 32 columns and ZERO geometry** (verified against production
`information_schema`). **Nothing resolves geometry on create** — a grep of
`backend/routes/surf_spots/` returns empty across `admin_create_spot`, `spot_seeding` and ~8
`expand_*.py` importers. ★ `admin_create_spot` DOES already run a `land_check`, so the hook exists.

### Measured state of the whole catalogue (1,773 spots, zero network)
**full 1,054 (59.4%) · degraded 699 (39.4%) · blind 20 (1.1%) · actionable 707 (39.9%)**
sources: etopo 1,354 (76.4%) · **coarse 393 (22.2%)** · none 20 · override 6
missing: **break_depth 707 (39.9%)** · fine_shore_normal 393 (22.2%) · coastal 35 · normal 20

### Moved pins have no staleness guard
**290 spots have moved; 197 by more than the 1 km match radius; median move 2.5 km.** Lookup is by
coordinate, so a moved pin either matches its OLD neighbour's entry or nothing — silently, either
way. Among the 33 largest movers, **48.5% lack a fine normal vs 23.3% catalogue-wide**.
⚠️ Honest caveat: the big movers cluster in Peru/Chile/Brazil batches at ~3.7–5.1 km, which looks
like a systematic re-import, so the 2.1× is **suggestive, not clean**. The architectural gap —
nothing links a coordinate change to geometry invalidation — stands on its own.

### ⇒ The path (steps 1–2 need a PRODUCTION SCHEMA CHANGE — owner's call, not taken)
1. Columns on `surf_spots`: `shore_normal_deg`, `shore_normal_spread_deg`, `break_depth_m`,
   `geometry_source`, `geometry_resolved_at`, **`geometry_lat`/`geometry_lng`**,
   `geometry_reject_reason`. `geometry_resolved_at IS NULL` makes unresolved a QUERYABLE state;
   `geometry_reject_reason` puts the 38% placement rejections in the product, not a CI-only CSV.
2. **`geometry_lat`/`geometry_lng` are the staleness guard** — a pin that has moved from where its
   fit was taken re-queues itself.
3. Resolve on write, off the request path, beside the existing `land_check`.
4. One reconcile job — ⚠️ **for NEW and MOVED spots only** (see §4).
5. ⚠️ **KEEP THE HOT PATH DB-FREE** — `shore_normal_asset` is file/L2-backed so the CI precompute
   runs with no `DATABASE_URL`; a DB coupling there once **zeroed every rating**. Resolver WRITES
   the DB; a periodic export materialises it into the asset.
6. Carry it to the precompute via the single `select=` in `fetch_active_spots_via_rest`, passed
   **by NAME** into `rate_one_spot`.

---

## 4. ★★★ THE TEST THAT BROKE MY OWN PLAN, AND WHAT IT FOUND INSTEAD (`e058ea49`)

I claimed *"707 actionable spots ≈ 0.7 h at 6 workers — best ratio available."* The owner asked me
to test before executing. `resolve_one` had **never been run against real ERDDAP** — every test used
fakes. Live on Bondi:

```
elapsed 22.5 s  — the resolver WORKS end to end
fit:   normal 97.9°, spread 48.0°, break_depth 21.0 m
gate:  REJECTED — ambiguous_coastline   (MAX_SPREAD_DEG = 40.0)
after: still degraded / coarse — NOTHING published
```

★★★ **A spot with no asset entry is a spot the gate ALREADY REJECTED.** Same `measure()` +
`accepted()`, same coordinates, deterministic fit ⇒ re-running reproduces the rejection. **The
backfill would have burned 4.3 h of a public NOAA endpoint to publish ~nothing.**

### What it revealed: the gate is all-or-nothing, the measurements are not
The rejected fit still carried `break_depth_m = 21.0` for a spot with **no depth at all**.
`nearshore_depth_m` takes only the elevation grid and coordinate — **it never sees the bearing
fit** — and self-gates below `_MIN_TRUSTWORTHY_DEPTH_M = 3.0`, excluding swash/reef-flat cells.

Gate now split by what each clause judges:
* **PLACEMENT** (`not_on_open_ocean_*`, `spot_misplaced*`) → the pin is wrong ⇒ publish NOTHING.
* **BEARING-ONLY** (`ambiguous_coastline`, `too_few_windows`) → publish the DEPTH, withhold the bearing.
⚠️ **ALLOW-list, not deny-list** — a new placement clause must not slip through. Unknown ⇒ nothing.
⚠️ `no_shoreline_in_window` excluded: no coastline found makes a "nearshore" depth doubtful too.

⚠️ **THE SAFETY PROPERTY, verified live**: a depth-only entry cannot blank a bearing.
`resolve_surf_geometry` only overwrites the coarse normal when the asset returns a NON-None one
(`surf_point.py` `if _fine is not None:`) — pinned by a test, because a `None` normal disables the
directional gate entirely (**mean LEVEL error 4.12 vs 1.04** for merely-coarse).

LIVE after: `depth_only`, bearing **111.54 → 111.54 byte-identical, still 'coarse'**,
missing `['fine_shore_normal','break_depth']` → `['fine_shore_normal']`.

### ✅ THE INDEPENDENCE CAVEAT — I flagged it unresolved, then resolved it
Worry: `ambiguous_coastline` may correlate with complex bathymetry, making the depth unrepresentative.

**Proof 1 — depth does not degrade with spread** (committed asset, 1,087 entries with a depth):

| spread | n | median depth | p90 |
|---|---|---|---|
| 0–10° | 478 | 11.0 m | 46.2 |
| 10–20° | 357 | 11.3 m | 50.0 |
| 20–30° | 153 | 10.6 m | 90.0 |
| 30–40° | 98 | 15.0 m | **134.0** |

★ **Pearson r(spread, depth) = +0.0403** over n=1,087 — essentially zero.
⚠️ Nuance: the top band's **variance** grows (p90 46 → 134 m). Not biased, but noisier.

**Proof 2 — ★★ I compared Bondi to the WRONG control.** 21.0 m looked generous next to Mavericks'
22.1 m, but that is a different coast. Bondi's **12 nearest gate-PASSED neighbours**: median 12.5 m,
range 3.0–36.4 m — and the two within ~1.5 km read **17.0 m at spread 34.7°** and **13.0 m at
39.9°**, both barely inside the gate. **The 40° threshold is a cliff, not a physical boundary.**
⇒ **Compare a spot to its NEIGHBOURS, not to a famous spot elsewhere.**

★ Also corrected: the asset holds **1,386** entries (not 1,354), only **1,087 (78.4%)** with a
depth ⇒ **299 asset entries have a bearing but NO depth**, a second gap this split addresses.

---

## 5. ⚠️ EURO "BLANK DAY" — correctly attributed, STILL OPEN (queue #7, user-reported)

**NOT a wrong provider and NOT a fixed date.** ECMWF's own step list is **3-hourly→144 h then
6-hourly→240 h**. The scrubber walks a uniform 3-hourly grid, and the estimated filler only starts
*past the end* of native coverage (`scheduler_helpers.py:681`, `p.valid_time_start > anchor_time`).
⇒ every odd-3 slot between +144 h and ~+204 h has **no product at any global tier** — measured
**10 dead slots, all ≡ 3 (mod 6)** — walking forward a day per day, which is why it read as
"Sat blank, Fri/Sun fine". ★ **Gated on a HORIZON when the defect is a CADENCE.**

★ Bonus: this explains the partition mismatch — the total (`waves`) is **ECMWF WAM 0.25°** while the
partitions are **CMEMS 0.083°**. *Different models*, so quadrature was never going to close. That
independently justifies `reconcile_partitions`.

Three options, in my order: (3) make the series honest about a 6-hourly source → (1) extend the
filler to in-band gaps (needs interpolation, not the persistence blend) → (2) serve-time
interpolation (real per-cell compute on a 1-CPU box with melt history).

---

## 6. ⛔ THE QUEUE

1. ★★★ **Local size climatology** (`RATING_LOCAL_SIZE` + a real blob) — **the unlock**: without it,
   height accuracy is worth 0.0 points to the score.
2. ★★★ **EURO cadence seam** (§5) — the only USER-REPORTED defect open.
3. ★★★ **Geometry in the DB** (§3) — needs a production schema change; owner's call.
4. ★★ **Refraction / Kr site offset** — the one missing physical process per the literature.
5. ★★ Depth-dependence — would give the transform something to say at the 97.5% of spots where it
   is a constant multiplier.
6. ★ Wire `partitions` into the RATING (`dominant_swell_period`, `sea_cleanliness`) — the HEIGHT
   half shipped `e637d6dc`, still `SURF_PARTITIONS=0`; decide rollout by measuring in precompute.
7. ⚠️ Thread a spot id into the hub for `reference_size_m` (spawned; 59.1% level divergence if the
   flag flips).
8. ⚠️ Tide times render in the VIEWER's timezone. · ⚠️ Friction inert at ~46%. ·
   ⚠️ Sim name resolution misses accents (`Nazaré`, `Tofino`, `Taghazout`).

### Carried over
`weather_sim_mcp.py` **769/800** — sibling module for the next addition. `point_resolution.py` 736.
`MEMORY.md` **19.2 KB** against a 24.4 KB read limit — compact before it is close.
**mem0 is METERED** — local files first, then trevec/codebase-memory; mem0 last.

---

## 7. ★ METHOD NOTES — three of my own claims died this session

1. ★★★ **Do not correct a suspect label by trusting another label.** I "corrected" the owner on EURO
   using `source_dataset`, which names the MODEL that both routes share. Verify against the code
   that WRITES it.
2. ★★★ **Sweep a bounded factor before quoting a number off it.** I reported a worst-case tide point
   (71.5%) as the typical cost; swept, it is 41.0%.
3. ★★★ **Compare a spot to its NEIGHBOURS, not to a famous spot on another coast.** Bondi's depth
   looked wrong against Mavericks and is normal against its own beach.
4. ★★ **A broad `except Exception` hides CODING errors, not just data ones** — it swallowed a
   `NameError` and silently disabled the surf transform while everything still validated.
5. ★★ **A field that cannot distinguish the thing it is named for is worse than no field** — it
   reads as an answer.
6. ★ **A source-grep assertion must know every shape it can take** — mine matched only a literal
   `"__provider": "ecmwf"` and falsely reported the ECMWF fetcher broken; it stamps via a helper.
7. ★ **Test the riskiest assumption against the real dependency before planning around it.**
   `resolve_one` passed 28 tests with fakes and published nothing on its first real call.
