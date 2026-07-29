# SURF FORECASTING SCIENCE — the research catalogue

**Purpose.** Every external, citable fact this project's forecast science rests on, in one place, so
a claim can be checked against a source instead of against someone's recollection. Started
2026-07-29 on the owner's instruction to *"research farther online, catalog all your science
research."*

**How to use this.** `memory/THE-SURF-FORECAST-SCIENCE-canonical-chain.md` describes what our code
DOES. This file describes what the LITERATURE SAYS. Where they disagree, that gap is a finding —
§7 tracks the open ones.

⚠️ **Rule for this file: every claim carries a source.** If it has no citation it is a hypothesis and
belongs in §7, not in §1–6.

---

## 1. ★★★ WHAT "SURF HEIGHT" MEANS — the statistic, and we have it wrong

This is the single most consequential definition in the whole chain, and it is not the one we use.

| statistic | definition | ratio to H₁/₃ |
|---|---|---|
| H_rms | root-mean-square wave height | 0.706 |
| **H₁/₃ = Hs** | mean of the highest **third** — *what models output, what buoys report* | 1.000 |
| **H₁/₁₀** | mean of the highest **tenth** — ★ **the surf-forecasting standard** | **1.27** |
| H_max (N≈1000) | expected largest in a record | ≈1.86 |

> *"Each value represented the common though less frequent larger sets of breakers, nominally
> referred to as the **H1/10, or the average of the 10% highest waves**."*
> — University of Hawaii Sea Level Center, Oahu Surf Climatology

> *"For surf observations and forecasts, **H1/10 in peak face feet** is the operative standard."*
> — same source

Caldwell (2007), the standard published method for turning buoy data into a surf forecast, targets
exactly this: *"the resultant formula uses offshore wave height and period to estimate surf heights,
which represent the **H1/10** for zones of high refraction."*

★★★ **CONSEQUENCE FOR US.** `surf_transform.estimate_surf` consumes offshore **Hs** and applies
shoaling, friction and an exposure factor — all *linear amplitude ratios*, which preserve the
statistic. Its output is therefore a **significant** breaking height. `conditions_labels.py` then
maps that number onto a **face-height** ladder (4 ft = "Chest High"), and `surf_rating.size_score`
grades it against a 1.2 m reference. Both treat it as if it were H₁/₁₀.
⇒ **We under-report surf height by ~21 % (1 − 1/1.27) against the operative standard.**
Independently corroborated: `validate_nearshore_transform.py` scores us as an `Hs(nearshore) /
Hs(deep)` ratio against CDIP — both sides significant — so the output being Hs is not in doubt.

### 1a. ⚠️ THE CAVEAT THAT STOPS THIS BEING A BLIND ×1.27

The Rayleigh ratio holds **at the break point**, not inside saturated surf:

> *"As waves progress into shallower depths in the surf zone, the wave height distribution shifts
> from a Rayleigh distribution to a narrow Weibull distribution. In depth-limited surf there is a
> maximum limiting height, thus the distribution can be parameterised as a truncated distribution."*

But where we actually model, Rayleigh is excellent:

> *"Using locally measured Hrms, the Rayleigh distribution describes the measured central moments of
> **H1/3 and H1/10 with average errors of −0.2 % and −1.8 %**."*

⇒ **Apply the factor only where the depth-limited cap is NOT binding.** When the cap binds, the cap
itself (`breaker_index(Tp) · break_depth`, a γ·d *individual-wave* criterion) is already a
maximum-wave statistic — multiplying it again would double-count. See §6 for the mixed-convention
bug this exposes.

## 2. THE SURFER-FACING HEIGHT SCALES

| face height | body reference | our `conditions_label` |
|---|---|---|
| 1 ft | ankle–shin | Ankle High (1–2) |
| 2 ft | knee–thigh | Knee High (2–3) |
| 3 ft | waist–belly | Waist High (3–4) |
| 4 ft | chest–shoulder | Chest High (4–5) |
| 5 ft | head high | Head High (5–6) |
| 6 ft | 1 ft overhead | Overhead (6–10) |
| 10 ft | double overhead | Double Overhead (10–15) |
| 15 ft | triple overhead | Triple Overhead+ (15+) |

★ **Our ladder matches the industry face-height scale.** That is the good news and the bad news: the
labels are right, but they are being fed a significant height (§1).

**Hawaiian scale** is a *different* convention — measured from the back, ≈ half the face:
> *"The observations recorded in Hawaii scale were converted to peak face using a factor of 2 over
> the full range (0–40); for example, 10 Hawaii scale equals 20 peak face (feet)."*
⚠️ We do **not** use Hawaiian scale anywhere and should not start — but any Hawaii-sourced
observation or anchor must be doubled before comparison.

## 3. ★★ HOW THE INDUSTRY RATES QUALITY — and the one rule we don't implement

Surfline's public scale runs VERY POOR (2) → POOR (3) → POOR–FAIR (4) → FAIR (5) → FAIR–GOOD (6) →
GOOD (7) → VERY GOOD (8) → GOOD–EPIC (9) → EPIC (10). Ours is the same 7-level shape.

Two published rules matter:

1. ★★★ **"Good and Epic ratings can only be assigned by forecasters who have OBSERVED the
   conditions."** The industry reference does **not** let a model award its top ratings.
   ⇒ We have this built — `RATING_OBS_GATE`, *"Good/Epic observation gate + user-report weigh-in
   (Surfline hybrid)"* — and it is **default 0**. It is the direct structural answer to the owner's
   *"I wouldn't say 4 ft @ 9 s is epic."*
   ⚠️ But see §7.2: we have **14 usable observations in the entire production database**, so the gate
   would currently veto nearly every Good/Epic rather than moderate it.
2. **"Ratings are relative to each spot's potential… a 'Fair' at Pipeline will not look the same as
   a 'Fair' at an average beachbreak."** This is the principle behind `RATING_LOCAL_SIZE`
   (also default 0).

## 4. NEARSHORE TRANSFORMATION — the four processes

A nearshore model must account for **refraction + shoaling + bottom friction + depth-limited
breaking**. We implement shoaling, friction and breaking; **refraction is the missing one**, measured
at Kr median 0.797 over 385 k CDIP swell hours, with the dominant term a per-site offset unknown at
1,763 of 1,773 spots.

* Breaking is depth-induced at roughly **H ≈ 0.78–0.8 d** (γ, the breaker index). Our
  `breaker_index(Tp, slope)` is the slope-aware generalisation.
* Shoaling begins at **d < L/2** — why deep-shelf spots (Trestles, Pipeline) show Ks = 1.000.
* Bottom friction scales with shelf **width** and 1/sinh(kd) (Ardhuin 2003; Kurian 1987); ~90 %
  energy loss is a cited maximum, which is where our 0.316 floor comes from.

## 5. ENERGY — the physics, and why it is a diagnostic rather than a target

Deep-water wave energy flux per metre of crest:

```
P = (ρ g² / 64π) · Hs² · Te        Te ≈ 0.9 Tp for a JONSWAP sea      ⇒  P ∝ H²·T
```

★ Measured against our engine (2026-07-29): **Spearman ρ(P, score) = 0.749** over 36 (H,T) pairs.
⚠️⚠️ **Do not optimise the score toward energy.** A 10 ft 5-second storm sea has ~2.8× the energy
flux of a 4 ft 15-second groundswell and is unrideable. Energy measures *how much water is moving*,
not *how surfable it is*. Its value here was diagnostic: the divergence pattern exposed the
saturation defect in §6.

## 6. ⛔ WHERE OUR IMPLEMENTATION DIVERGES FROM THE LITERATURE

| # | divergence | status |
|---|---|---|
| 1 | **Surf height is Hs, standard is H₁/₁₀** (§1) — ~21 % under-read | ⛔ **OPEN — the largest single calibration error found to date** |
| 2 | **`size_score` saturates at 1.2 m** ⇒ 4/6/8/10/12 ft are byte-identical | ⛔ OPEN; `RATING_LOCAL_SIZE` is the built fix, default 0 |
| 3 | **Mixed conventions inside the transform**: shoaling/friction act on Hs (a *significant* statistic) but the breaking cap uses γ·d (an *individual-wave* criterion) | ⛔ OPEN — they are not the same statistic and are composed as if they were |
| 4 | **Good/Epic assigned by model, industry requires observation** (§3.1) | ⛔ OPEN; `RATING_OBS_GATE` built, default 0, and starved of data |
| 5 | **Refraction absent** (§4) | ⛔ known-missing, documented |
| 6 | Caldwell's formula is invalid below ~10 s period; Florida runs 4–8 s | ⚠️ do not import his coefficients for FL — the *convention* transfers, the *formula* does not |

## 7. OPEN QUESTIONS — hypotheses, explicitly NOT established

1. **Does correcting §1 break the owner's calibration anchors?** The 1.2 m reference was tuned
   against today's (Hs) numbers, so raising every height by 27 % without re-expressing the reference
   shifts every level up. §1 and §6.2 must be fixed **together**, and solved against the anchors.
2. **The observation gate cannot be evaluated.** 189 `condition_reports`, **3** with a wave height;
   4 `surf_reports`. Total usable ground truth ≈ **14 observations**. Any claim that our heights
   match reality is currently unfalsifiable from user data.
3. **Is the saturated-surf-zone correction needed in Florida?** FL's wide shallow shelf is where the
   depth cap is most likely to bind, which is exactly where the ×1.27 must NOT be applied. Measured:
   the cap did not bind at Cocoa Beach at Hs 2.0 m / Tp 14 s — but it has not been swept.

---

## SOURCES

* [University of Hawaii Sea Level Center — Oahu Surf Climatology](https://uhslc.soest.hawaii.edu/outreach/climo/oahu_surf_climatlogy.html) — the H₁/₁₀ definition and the Hawaii-scale ×2 conversion
* [Caldwell (2007), *An Empirical Method for Estimating Surf Heights from Deepwater Significant Wave Heights and Peak Periods*, J. Coastal Research 23(5)](https://bioone.org/journals/journal-of-coastal-research/volume-23/issue-5/04-0397R.1/An-Empirical-Method-for-Estimating-Surf-Heights-from-Deepwater-Significant/10.2112/04-0397R.1.short) · [eScholarship copy](https://escholarship.org/uc/item/61t4k7z7)
* [UHSLC — Why Do Surf Heights in Hawaii Vary So Greatly?](https://uhslc.soest.hawaii.edu/outreach/vary/why_surf_varies.html)
* [Surfline — Rating of Surf Heights and Quality](https://www.surfline.com/surf-news/surflines-rating-surf-heights-quality/1417) · [Surf Ratings & Colors](https://support.surfline.com/hc/en-us/articles/36277684017819-Surf-Ratings-Colors) · [What is LOLA](https://www.surfline.com/surf-science/what-is-lola---forecaster-blog_61031/)
* [Wikipedia — Hawaiian scale](https://en.wikipedia.org/wiki/Hawaiian_scale) · [Surfertoday — What is the Hawaiian wave scale](https://www.surfertoday.com/surfing/what-is-the-hawaiian-wave-scale)
* [Thornton & Guza (1983), *Transformation of wave height distribution*, JGR Oceans](https://agupubs.onlinelibrary.wiley.com/doi/10.1029/JC088iC10p05925)
* [Goda (2010), *Reanalysis of Regular and Random Breaking Wave Statistics*](https://www.ancientportsantiques.com/wp-content/uploads/Documents/ENGINEERING/Maritime/BW/WaveBreaking-Goda2010.pdf) — Rayleigh accuracy for H₁/₃ and H₁/₁₀
* [Parameterization of nearshore wave breaker index (arXiv 2104.00208)](https://arxiv.org/pdf/2104.00208)
* [Coastal Wiki — Wave transformation](https://www.coastalwiki.org/wiki/Wave_transformation) · [Shallow-water wave theory](https://www.coastalwiki.org/wiki/Shallow-water_wave_theory)
* [ECMWF — Modeling nearshore wave processes](https://www.ecmwf.int/sites/default/files/elibrary/2012/12901-modeling-nearshore-wave-processes.pdf)
* [OceanFit — Wave body height vs face wave height](https://oceanfit.com.au/education/wave-height-is-it-5-feet-head-high-or-overhead/)
