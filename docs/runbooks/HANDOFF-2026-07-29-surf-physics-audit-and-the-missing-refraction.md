# HANDOFF 2026-07-29 — THE SURF PHYSICS AUDIT: what is right, what is wrong, and by how many feet

**Continues `HANDOFF-2026-07-28-sim-identity-and-the-blind-admin.md`.** Read
[[standing-work-rules-user-mandate]] first.

The owner asked: *"I need to double check the science behind all the wave heights. I honestly am not
certain if you're right or wrong… we need this to be state of the art."* Then: *"run it worldwide…
tide, wind, swell, period, direction of swell, moon phases all affect it. Dig deeper."*

Two multi-agent audits were run (40 agents / 4.5M tokens on the first). **Every headline claim below
was re-derived by hand afterwards**, because the first time I "verified" this I did it wrong — see §0.

---

## 0. ⚠️ READ THIS FIRST — HOW I VERIFIED IT WRONG THE FIRST TIME

I doubted the model's Trestles number (+92.7% offshore→breaking) and "checked" it by computing
Komar & Gaughan (1972) independently. It agreed to a few percent, so I told the owner the model was
fine and my suspicion was wrong.

★★ **THAT CHECK COULD NOT HAVE FAILED.** Komar's relation needs the **equivalent unrefracted
deep-water height** `H0' = Kr·H0`. Our model feeds it **raw offshore Hs**, i.e. assumes `Kr = 1.0`.
When I computed Komar by hand I fed it raw Hs too. **I verified the formula's transcription against
itself and called it validation.** Same family as "26 green unit tests proved nothing" — a check
structurally incapable of going red.

**The lesson to carry: when validating a formula, the INPUT convention is part of the formula.**

---

## 1. ★★★ THE HEADLINE — THE TRANSFORM OVER-PREDICTS WHERE SWELL IS SHELTERED

**Trestles at 4.6 ft is wrong. Measured truth ≈ 3.0 ft.** Not from another formula — from
instruments:

| source | pairs | median nearshore/offshore |
|---|---|---|
| CDIP **MOP D1210** (Trestles, 10 m) vs CDIP buoy **045** (223 m), 2000–2025 | **293,263 hourly** | **0.859** |
| Pure buoy-to-buoy, no model anywhere: CDIP **100** (572 m) → CDIP **153** (17 m) | **99,630 hourly** | **0.840** |

SoCal swell **loses 14–27%** reaching the nearshore, then regains it on the last leg. Our model
assumes it only ever gains. Nearshore exceeds offshore in just **13%** of hours.

### The root cause — ONE MISSING COEFFICIENT, not a broken formula
`surf_transform.py:14` **declares it**: *"Refraction (Kr, needs a per-point shore-normal) and bottom
friction are deliberate PHASE-2 refinements."* Phase 2 never came.

**Re-derived by hand from the repo's own functions (independent of the agents):**
```
Ks(Tp=15 s, d=10 m)         = 1.1375          (repo's shoaling_coefficient)
implied Kr = 0.859 / 1.1375 = 0.755           ← matches the audit exactly
chain: 2.40 ft offshore → 2.06 ft @10 m → 2.8–3.0 ft breaking   (×1.17–1.24)
our model:                                      4.62 ft          (×1.925)
```
⇒ over-prediction ≈ **1.5×** at Trestles. Applying Kr closes ~85% of it.

⚠️⚠️ **Kr IS SIGNED — DO NOT APPLY IT AS A BLANKET REDUCTION.** Trestles is 0.755 because the
Channel Islands shadow it; a canyon-focused spot (Mavericks) is **> 1**. Adding refraction makes
some spots smaller and some **bigger**.

⚠️ Trestles currently sits **within 4% of `SURF_V3_JACK_MAX = 2.0`** — an arbitrary cap is the only
thing holding the number down. The model is pinned against a guardrail.

---

## 2. ★★★ WIND-SEA CONTAMINATION — found by hand, possibly the bigger DAY-TO-DAY error

The transform is handed `layer="waves"` = **TOTAL Hs** (wind sea + swell) together with the **swell**
peak period, so wind chop is amplified as if it were groundswell.

Measured at Cocoa Beach Pier (0.6 m real swell, Tp 12 s, adding wind sea in quadrature):

| swell | wind sea | model shows | true rideable | over |
|---|---|---|---|---|
| 0.6 m | 0.0 | 2.94 ft `Knee High` | 2.94 ft | 0% |
| 0.6 m | 1.0 m | 5.00 ft `Head High` | 2.94 ft | **+70%** |
| 0.6 m | 1.4 m | **6.19 ft `Overhead`** | 2.94 ft `Knee High` | **+111%** |

★ **Four size rungs, and it is worst exactly on blown-out days** — when wind sea dominates is
precisely when the model shouts "Overhead". Compounds with §1 (both positive biases).
★ **`swell_1` is ALREADY in the pipeline** — `spot_conditions` fetches it for display but never
feeds it to the transform. The fix is plumbing, not new science.

---

## 2b. ★★★ THE STRUCTURAL FINDING — THE MODEL IS DEPTH-BLIND 97.5% OF THE TIME

**Measured by hand across 220 random catalogue spots × 5 conditions = 1,100 evaluations:**

| | |
|---|---|
| `break_depth_m` present | 137 (**62.3%**) |
| `break_depth_m` MISSING | 83 (**37.7%**) |
| evaluations hitting the depth-limited (`breaking`) regime | **27 of 1,100 = 2.45%** |

★★ In the `SURF_V3_KOMAR` path the height is `min(Hb, jack_max·Hs)` where `Hb` is **Komar &
Gaughan — a BULK DEEP-WATER formula taking only offshore Hs and period**. Local depth enters ONLY
through the cap, and **the cap binds 2.45% of the time.** So for ~97.5% of forecasts the local
bathymetry does not influence the height at all.

**This unifies several loose observations and reframes the roadmap:**
1. ⛔ **TIDE CANNOT MATTER in the current architecture.** Adding a tidal depth offset would change
   nothing 97.5% of the time. "Add tide" is therefore **not a small patch** — the height must first
   be made genuinely depth-dependent. Same for **moon/spring-neap**, which only modulates tide.
2. A 1 m reef and a 15 m beach break receive the **same height** for the same offshore swell
   (modulo the exposure factor and magnets).
3. It explains the 2026-07-27 finding *"the cap was DEAD — bound on 0 of 395 spots"* — it is still
   nearly dead at **2.45%**, even after `break_depth_m` was added.
4. The ETOPO shore-normal asset work still matters — but for the **exposure factor and the RATING**,
   not for the height.

⇒ **Honest characterisation: this is a competent BULK predictor with correct arithmetic and largely
cosmetic local geometry — not yet a nearshore transformation model.** Reaching "state of the art"
means making the height depend on local depth and refraction, which is items 1–2 of §8.

---

## 3. ★★ THE INPUT IS COMPRESSED BEFORE THE TRANSFORM EVEN RUNS

Against 60 unique NDBC buoys: bias **+0.237 m (+66%) below 0.5 m**, ~0 at 0.5–1.0 m,
**−0.543 m (−22.6%) above 2.0 m**. OLS slope **0.707**. The headline bias (−0.079 m) is a lie of
cancellation.

★★ **Komar's exponent COMPOUNDS it in the same direction** — surf ∝ H0^0.8, so amplification is
**×2.23 at 1 ft offshore but only ×1.23 at 20 ft**. This is a mathematical necessity of a sub-unity
exponent, and it **independently explains the previously-unexplained compression** recorded
2026-07-26 (`c41d0879`). ⇒ needs **quantile mapping** at the serve boundary, not a bias term.

---

## 4. ⚠️ `SURF_V3_KOMAR=0` IS NOT A ROLLBACK — IT IS DIFFERENT PHYSICS

Both legacy branches (`surf_transform.py:349,351`) call
`shoaling_coefficient(Tp_s, depth_m)` — the **shelf** depth (p50 157–234 m), never
`break_depth_m` (p50 11.1 m, wired only to the cap at `:334-336`).

**Verified by hand:** `transform_surf(2.0, 14.0, 200)` returns **exactly 2.0** — Ks = 1.000, so the
"legacy" branch returns the offshore Hs **bit-for-bit, relabelled as breaking height**.

* Impact today: **0 ft** (the flag is on everywhere).
* If anyone flips it: **96.7% of 9,072 spot×scenario evaluations change the size rung**; median
  −35%. Trestles 10.05 ft `Double Overhead` → 6.56 ft `Overhead`.
* The textbook shoaling chain in `transform_surf:146-175` **has no production caller** (tests only).

⇒ It is a **mislabelled landmine**, not a safe revert. Delete it or pass `break_depth_m`.

---

## 5. ✅ WHAT IS DEFINITELY CORRECT — 30 confirmed items, do not touch

| what | verdict |
|---|---|
| Linear dispersion + Newton solver (`:73-93`) | exact — worst error **2.7e-16** vs independent bisection over 169 cases, Tp 3–30 s, depth 0.02–11,000 m |
| Shoaling coefficient / group velocity / n-ratio (`:126-143`) | exact — **3.5e-16**; independently reproduces textbook Ks minimum **0.912993** at d/L0 = 0.15916, Green's law to −0.16% |
| Three different deep-water cutoffs (kd > 20/10/8) | **not a bug** — largest discarded residual 0.05% = **0.003 ft on a 6 ft wave** |
| Komar & Gaughan transcription | faithful to **0.6%** — the formula is right, only its INPUT is wrong |
| **Deep-water limit** (my own test) | ratio → **1.000** at 200 m+; it does NOT amplify where it shouldn't |
| **Short-period chop** (my own test) | ×0.95 at 3 s → ×1.28 at 8 s — no blow-up |
| **The RATING kills blocked swell** (my own test) | Pipeline from the S: **9.5/100 `very_poor`** vs 94.8 `epic` from the NW |

★ **The module's arithmetic is not the problem. What gets handed to it is.**

---

## 6. ⚠️ THE HEIGHT AND THE RATING DISAGREE ON BLOCKED SWELL

`_height_exposure_factor` (`:275-286`) floors at **0.595** — its docstring says so:
`exposure floor (0.10) maps to 0.595`. So a swell arriving from **directly behind the beach** still
yields 59.5% of head-on height.

**My own measurement — Pipeline, 2.0 m / 14 s:**
| swell from | height | label | rating |
|---|---|---|---|
| 325° (real NW window) | 10.05 ft | Double Overhead | 94.8 `epic` |
| 180° (**blocked by Oahu**) | **5.98 ft** | **Overhead** | **9.5 `very_poor`** |

⇒ On a flat summer day the hub reads **"Overhead" next to "very_poor"** — the two halves of the same
forecast contradicting each other. ★ **And §7 of the previous handoff made that height PROMINENT.**

★ **WHY it was built that way (do not just delete the floor):** the shore normal is not reliable
enough to trust a hard cutoff. Measured by hand (my expected values are estimates, not authority):
Pipeline 0.0° error, Hossegor 0.5°, Chicama 10.5°, Teahupo'o 13.0°, **Mavericks 44.9°,
Uluwatu 72.5°**. **Zeroing a 90°-off swell when the normal is 72° wrong blacks out a working spot.**
⇒ The fix is **coupled**: qualify the normal's confidence, then let exposure → 0 only where
confidence is high. A design change, not a constant.

---

## 7. ✅ SHIPPED THIS SESSION (`902f47a9`) — AND ITS HONEST LIMIT

The spot hub / infoboxes / alerts were a **second forecast composition** reporting **offshore Hs** as
the surf height. Now unified onto `surf_point` (details in the previous handoff §7e).

⚠️⚠️ **THIS MADE THE HUB CONSISTENT, NOT YET ACCURATE.** At Trestles it moves the hub from
**−20%** (raw offshore, 2.4 ft vs ~3.0 truth) to **+53%** (unrefracted breaking, 4.6 ft).
★ The argument for shipping it anyway: there is now **ONE number and ONE place to fix it** — Kr
corrects the map, the sim, the hub, the infoboxes and the alerts simultaneously. Before, each
surface was wrong differently.

---

## 8. ⛔ THE QUEUE — ranked by feet of surf moved per unit of effort

**✅ DONE THIS SESSION:** #0 below. Everything else is open.

0. ✅ **GFS fabricated zeros** (§9a) — *fixed*, `point_resolution.py`, kill
   `MARINE_ZERO_IS_NO_COVERAGE=0`. Was the single highest-value change: turned "flat" into honest
   no-coverage at ~6% of spots for the hours outside the cached grid window.
1. ★★★ **THE SIZE GATE SATURATES AT ~4 ft** (§9b) — `surf_rating.py:63-91`. **All 1,773 spots**,
   up to 3 rating levels, and a **safety** issue at size. ⚠️ Must ship WITH an oversize penalty,
   not just `RATING_LOCAL_SIZE=1`. **Cheapest large win now that #0 is done.**
2. ★★★ **REFRACTION / SHELTERING (Kr)** (§1 + §9e-b) — `surf_transform.py:338-348`. ±1.5 ft;
   −1.0 ft at Trestles; dominant error for ~130 island spots. Cheap global 80%: ray-cast the swell
   bearing against the land mask to ~200 km (ETOPO + land mask already in repo). Proper for
   California: CDIP MOP transfer functions. Should supersede hand-tuned `surf_magnets.py`.
   ⚠️⚠️ **SIGNED** — Trestles 0.755, Mavericks >1. Validate BOTH directions or it will make spots worse.
3. ★★★ **USE THE SWELL PARTITION, NOT TOTAL Hs** (§2) — up to **+111%**, four size rungs, worst on
   blown-out days. `swell_1` already flows through the pipeline; this is plumbing, not science.
4. ★★ **MAKE THE HEIGHT DEPTH-DEPENDENT** (§2b) — the enabling change for tide/moon. Today the cap
   binds 2.45% of the time, so depth (and therefore tide) cannot matter.
5. ★★ **TIDE** (§9c) — ~480 spots / 27% of catalogue; Thurso 43-point, 3-level, twice daily.
   ⚠️ Needs #4 first for height; `best_tide` populated on only **2.1%** of spots, so it also needs a
   data backfill. **MOON** (§9d) is a small rider on this: stop dividing out the spring–neap
   amplitude in `tide.py:76-81`.
6. ★★ **Shore normals** (§9e-c) — 434 spots with none, 337 low-confidence. Gates #2 and the
   exposure floor. ⇒ then tighten the 0.595 floor toward 0.2–0.3 (§6) **coupled with confidence**.
7. ★★ **QUANTILE-MAP THE OFFSHORE INPUT** (§3) — blocked on the residual archive filling
   (all five bands still under the 30-row / 10-buoy gate).
8. ★ **Delete or fix `SURF_V3_KOMAR=0`** (§4) — 0 ft today, 96.7% of evaluations if flipped.
9. ★ **Period floor lets 4-second chop rate "good"** (§9f).

### Carried over, unchanged
* **107 VARIANT duplicate pairs** — now reviewable in the admin console (Duplicate Review panel).
* **Calibration archive** — let it accumulate; read `report["archive"]` in ~a week.
* **155 misplaced spots**; **FR/ES/UK expansion** (2333 candidates, product decision).
* `weather_sim_mcp.py` at 753/800; `AdminSpotsPanel.js` now 672.

---

## 9. WORLDWIDE AUDIT — 46 agents, 152 findings, 42 confirmed-correct, 13 survived refutation

### ★ THE VERDICT
> **"Not state of the art. A professional-grade core wired to amateur-grade inputs."**

Of the six factors the owner named: **wind** is the best-implemented; **height** and **period** are
modelled but gated badly; **tide**, **moon** and (largely) **direction** are dark.
⚠️ In two situations the app is **worse than a naive baseline**: a GFS mask hole (says *flat* on a
5 ft day) and any wave over 4 ft (says *epic* on a 35 ft closeout).

### 9a. ★★★ #1 — GFS SERVES A FABRICATED ZERO AS AUTHORITATIVE (I reproduced and localised this)
**My own live measurement, Biarritz, GFS marine waves, hour by hour:**
```
02:00Z Hs 0.0    Tp 0.0   source=backend_direct_point  product_id=None   <-- FABRICATED
05:00Z Hs 0.0    Tp 0.0   source=backend_direct_point  product_id=None   <-- FABRICATED
08:00Z Hs 0.7401 Tp 7.40  source=grid_file  gfs_marine_waves_global_coarse_...T090000Z
11:00Z Hs 0.6809 Tp 7.24  source=grid_file  ...T120000Z
17:00Z Hs 0.5152 Tp 6.91  source=grid_file  ...T180000Z
20:00Z Hs 0.0    Tp 0.0   source=backend_direct_point  product_id=None   <-- FABRICATED
23:00Z Hs 0.0    Tp 0.0   source=backend_direct_point  product_id=None   <-- FABRICATED
```
★ **ROOT (mine, further than the audit got): the cached grid covers ~08–18Z. OUTSIDE that window
the DIRECT-POINT fallback returns 0.0/0.0/0.0 and stamps `is_forecast_authoritative=true`.**
**5 of 5 non-US spots** I sampled were zero at 05Z (Biarritz, Guéthary, Anglet, Busua GH, Barra da
Lagoa BR) while **EURO had 0.8–1.5 m of swell at the identical coordinate and hour**. The US spot
was unaffected. A user dragging the scrubber watches the swell blink out.
⇒ **✅ FIXED THIS SESSION** (`point_resolution.py`). The NULL guard already existed and said *"Do NOT
coerce to 0.0 and serve it as data"* — it just never caught a literal zero.
★ **THE PHYSICAL TELL: a dead-calm sea still has a PEAK PERIOD.** Height AND period simultaneously
zero is a mask signature, never a sea state. Kill: `MARINE_ZERO_IS_NO_COVERAGE=0`.
⚠️ Audit overreach corrected: it claimed the whole Black Sea/Caspian are dead. True of the API but
**the catalogue has 0 spots in either basin** — it is a point-query defect, not a listing defect.

### 9b. ★★★ #2 — THE RATING'S SIZE GATE SATURATES AT ~4 ft (I reproduced this exactly)
`surf_rating.py:63-91`; `_DEFAULT_REF_SIZE_M = 1.2`; `RATING_LOCAL_SIZE` defaults `"0"`.
**My own run, clean offshore wind, head-on swell, Tp 14 s:**
| surf | 2 ft | 3 ft | **4 ft** | 6 ft | 12 ft | 17.4 ft | 25 ft | **35.5 ft** |
|---|---|---|---|---|---|---|---|---|
| score | 38.8 | 67.8 | **94.8** | 94.8 | 94.8 | 94.8 | 94.8 | **94.8** |

Nazaré: 16.2 / 23.1 / 32.9 ft all score **97.5 `epic`**. ⚠️ **This is a safety problem**, not just
information loss — a 35 ft closeout is rated identically to a clean 4 ft day, at **all 1,773 spots**.
⚠️ The fix is NOT just flipping `RATING_LOCAL_SIZE`: the curve is monotonic to 1.0 with **no
oversize penalty**. Both must ship together (the repo's own memory records that flipping local size
alone makes a beginner beach outrank a point break).

### 9c. ★★★ TIDE — indefensible in ~27% of the catalogue
| region | spots | typical range |
|---|---|---|
| NE Atlantic Europe (PT/IE/FR/UK/ES) | **356** | 10–20 ft |
| Pacific Central & South America | ~124 | 8–13 ft (Costa Rica alone 41 spots @ ~10 ft) |
| Pacific NW / Alaska / Canada Maritimes | (within 630 N.American) | 10–25 ft |

⇒ **~480 of 1,773 spots (27%)** where tide is a first-order control on whether the wave breaks.
Thurso East: a measured **43-point, three-level ("fair"→"epic") overstatement, twice a day**.
★★ **AND THE FIX IS BIGGER THAN THE FLAG — this independently reproduces my §2b finding.** Even with
`RATING_TIDE=1` and full `best_tide` coverage, tide is only a *rating multiplier*; it would still not
move the **height**, because the break depth is static. Adding the tidal excursion to the break depth
would swing the height **6.6%–159.5%** across a cycle. ⇒ **tide requires §2b (depth-dependence) first.**

### 9d. ★★★ MOON — the signal is measured, then explicitly DIVIDED OUT (verified by hand)
No surfer rates a session by lunar phase; what matters is its consequence — the **spring–neap cycle,
±40% tidal range every ~2 weeks**, which on a macrotidal coast exceeds most swells.
`tide.py` pulls a real hourly sea-level series that **contains** spring–neap. Then `tide_state_at`
(**`tide.py:76-81`**, I read it) computes `lo`/`hi` as the local ±window min/max and normalises into
that band:
```python
lo = hi = height
for i, dt in enumerate(parsed):
    if abs((dt - req).total_seconds()) <= window_h * 3600:
        lo = min(lo, levels[i]); hi = max(hi, levels[i])
norm = normalize_tide(height, lo, hi)
```
⇒ **a 0.9 m neap and a 4.5 m spring BOTH map to 0.0–1.0.** The returned dict has `height_m` but not
the amplitude, so nothing downstream can recover it.
★ **The moon's real effect is present in the data and deleted in code.** Fix is small: also return
the absolute window amplitude, let `tide_fit` scale with it, and feed the excursion into break depth.

### 9e. SWELL DIRECTION — two failures, one severe
* **(a) Exposure floor 0.595** — see §6. Deliberate fail-open, but far too generous; **0.2–0.3
  retention** would keep the fail-open property without inventing waves.
* **(b) ⚠️ NO OBSTRUCTION MODEL AT ALL** — the chain asks "what angle to the shore normal", never
  "is there 400 km of Sumatra in the way". **Dominant directional error for ~130 island/archipelago
  spots**, and much larger than (a). This is the same gap as the missing **Kr** in §1.
* **(c) The normal itself:** ETOPO asset holds **1,386 of 1,820** ⇒ **434 spots (23.8%) have NO
  high-resolution normal**; of those that do, **337 (24.3%) carry spread > 20°**, 216 > 25°
  (p50 11.6°, p90 30.1°, max 40° = the gate). ⇒ shadowing work is downstream of fixing this.
★ "The direction channel is **silently** wrong — nothing in the UI tells the user the model does not
know which way the beach faces."

### 9f. Also confirmed by the worldwide pass
* **42 findings marked CORRECT** — the cross-shelf friction model, the wind offshore/onshore
  decomposition (**the best-implemented factor in the model**), and the period ingestion all check out.
* ⚠️ The quality curve has a **period floor that lets 4-second chop rate "good"**.
* **`best_tide` is populated on only 2.1% of spots** — so even switching `RATING_TIDE=1` would do
  almost nothing without a data backfill.

## 9g. ⚠️ WHERE THE AUDITS OVERREACHED — corrected, so nobody acts on them
* **"The whole Black Sea and Caspian are permanently zero."** True of the point API, but **the
  catalogue holds 0 spots in either basin** (0 Black Sea, 0 Caspian, 50 Mediterranean). It is a
  point-query defect, not a spot-listing defect.
* **Shore-normal "true bearing" errors at Fistral and Nazaré** were inherited from the first audit
  and **not independently re-sourced** — treat the exact degree values as MEDIUM confidence.
  Likewise my own §6 table (Mavericks 44.9°, Uluwatu 72.5°) uses MY estimates of the true bearing,
  not an authority. The *existence* of large errors is solid; the specific numbers are not.
* **The ~6% GFS-zero spot count** is extrapolated from n=150 (95% CI ≈ 50–195 spots). The mechanism
  is certain; the count is loose.

---

## 10. VERIFIED BY HAND BEFORE THE WORLDWIDE AUDIT REPORTED

* **Tide is NOT in the surf height at all** — zero references in `surf_transform.py` /
  `surf_point.py`. The breaking cap uses static ETOPO depth with no tidal offset.
* **Tide IS in the rating but gated OFF** (`RATING_TIDE` default `"0"`), and `best_tide` is consumed
  only inside that gated-off path.
* **`best_swell` is never used in physics** — passed through to API responses only. The per-spot
  swell window exists as data and is ignored.
* **Moon phase: entirely absent** (the only "Moon" in the backend is "Half Moon Bay" in a docstring).
  Spring/neap doubles tidal range on a ~14.8-day cycle, so it modulates any tide term added later.
* **The transform consumes `layer="waves"` (TOTAL Hs)**, not `swell_1` — see §2.

---

## 11. SESSION STATE — for a fresh context picking this up

**Branch `dev`, tree clean, all CI green.** Commits this session (newest last):

| commit | what |
|---|---|
| `f845fedc` | sim spot identity — one name → one production spot |
| `5f0085fd` | sim `valid_time` — forecast a future hour (+168 h) |
| `48b923b3` | admin: 401 rendered as "0 spots"; LOC ratchet red 8 commits |
| `c91e9530` | importer dedupe: name+proximity, not distance alone |
| `da25f7c4` | `triage_duplicate_spots.py` — the 47 the merge tool can't see |
| `f58187a4` | `dedup_surf_spots.py` FK list missing `surf_log_entries` (8 CASCADE) |
| `29368b2b` | **Duplicate Review panel** in the admin console (live, self-verifying) |
| `902f47a9` | **spot hub / infoboxes / alerts** onto the one forecast chain |
| `222d8255` | this audit's findings |
| *(pending)* | **GFS fabricated-zero guard** + `test_marine_zero_is_no_coverage.py` |

**Production data changed (owner-approved, reversible):** 47 duplicate pairs merged, **1818 → 1773
active spots**. Snapshot `surf_spots_dupe_backup_20260728` (1821 rows); rollback SQL in the
2026-07-28 handoff §7c.

### HOW THE OWNER VERIFIES THINGS NOW (they asked; this was the answer)
* **Duplicates** — admin console → Spots → **Duplicate Review**. Recomputes live from the DB on
  every open, so it is both the worklist AND the proof a merge worked. `IDENTICAL` should read **0**.
* **Catalogue** — the map shows **1773**; search `Teahup` returns exactly two real breaks.
* **Sim** — `get_weather_forecast(spot, valid_time=...)` reports `spot_source` and a `parity` block.

### ⚠️ THE ONE THING TO TELL THEM FIRST
`902f47a9` made the spot hub **consistent, not yet accurate**. At Trestles it moved the hub from
**−20%** (raw offshore) to **+53%** (unrefracted breaking, 4.6 ft vs ~3.0 measured). It was shipped
because there is now ONE number and ONE place to fix it — **Kr (§8 item 2) corrects the map, sim,
hub, infoboxes and alerts simultaneously.** It is reversible if the owner prefers.

### CARRIED OVER, UNCHANGED
* **107 VARIANT duplicate pairs** — reviewable in the admin panel; needs human judgement.
* **Calibration residual archive** — accumulating; read `report["archive"]` in ~a week. All five
  bands still under the 30-row / 10-buoy gate.
* **155 misplaced spots** (75 have GNS proposals, 89 need `refinements.py`).
* **FR/ES/UK expansion** — 2333 candidates; a product decision, not a technical block.
* `weather_sim_mcp.py` **753/800**; `AdminSpotsPanel.js` **672**; both under the ratchet.
* ⛔ **The map has been eyeballed at one viewport/zoom only.** Zoom ladders + marine layers still
  need the `zoomlab.js` protocol, run alone.

### ★ METHOD NOTES WORTH KEEPING
1. ★★ **When validating a formula, the INPUT CONVENTION is part of the formula.** I "verified" Komar
   by feeding it the same wrong input the model uses (§0).
2. **Ship the SURFACE, not the list** — a review list in a chat log makes the assistant the mechanism.
3. **Verify FK lists from `information_schema`, never a hardcoded constant** — 8 of 23 CASCADE.
4. **A green CI on a docs-only commit says nothing about the code gates** (`paths:` filters).
5. **Calibrate an instrument against a known answer before trusting it on new data** — it rejected
   the first duplicate classifier and the first shore-normal instrument.
