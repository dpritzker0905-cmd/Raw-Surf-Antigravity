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

## 8. NEXT — ranked by feet of surf moved per unit of effort

1. ★★★ **REFRACTION / SHELTERING (Kr)** — `surf_transform.py:338-348`. ±1.5 ft; −1.0 ft at Trestles.
   Cheap global 80%: ray-cast the swell bearing against the land mask out to ~200 km (ETOPO + the
   land mask are already in the repo). Proper for California: CDIP MOP transfer functions.
   Should supersede the hand-tuned `surf_magnets.py`. ⚠️ SIGNED — validate both directions.
2. ★★★ **USE THE SWELL PARTITION, NOT TOTAL Hs** (§2) — up to +111% on windy days, four size rungs.
   `swell_1` already exists; this is plumbing.
3. ★★ **QUANTILE-MAP THE OFFSHORE INPUT** (§3) — needs the residual archive to fill first
   (see previous handoff §6; all five bands still under the 30-row / 10-buoy gate).
4. ★★ **Delete or fix `SURF_V3_KOMAR=0`** (§4) — 0 ft today, 96.7% of evaluations if flipped.
5. ★ **Shore-normal confidence + exposure floor** (§6) — coupled; do after 1.
6. **TIDE / MOON** — see §9 (worldwide audit).

### Carried over, unchanged
* **107 VARIANT duplicate pairs** — now reviewable in the admin console (Duplicate Review panel).
* **Calibration archive** — let it accumulate; read `report["archive"]` in ~a week.
* **155 misplaced spots**; **FR/ES/UK expansion** (2333 candidates, product decision).
* `weather_sim_mcp.py` at 753/800; `AdminSpotsPanel.js` now 672.

---

## 9. WORLDWIDE AUDIT (tide · moon · wind · direction · regions)

*(Filled in below when the second workflow completes — see §10 for what I verified by hand.)*

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
