# What the state of the art actually is, and what it says we should do next

Researched 2026-07-30 against published industry and academic sources, then measured against our own
live production data. Written because a calibration constant was changed by fitting five Florida
anchors and shipping it worldwide, which is how you overfit, and the fix deserved external
validation rather than internal consistency.

---

## 1. What the industry does

**Surfline — the reference implementation.** From their own support documentation:

> **"Ratings are relative to each spot's potential.** Ratings take into account regional and
> spot-specific nuances. A 'Fair' rating at Pipeline, for example, will not look the same as a
> 'Fair' rating at an average beachbreak."

> **"Good & Epic ratings are so rare, and need to be manually applied by a human forecaster."**
> **"Good and Epic ratings can only be assigned by forecasters who have observed the conditions."**

> "For spots we don't issue regular observations or have smart cams, our current condition rating is
> a basic potential calculation ... simply based on surf height and wind conditions. Without regular
> forecaster input, they will not account for tides or key spot dynamics."

Their model (LOTUS) is trained on **25 years of surf reports and 20 years of camera streams**, with
**35 years and hundreds of thousands of observations** feeding a machine-learning system, and expert
forecasters making multiple daily observations that correct and re-train it.

Three things follow, and all three are checkable against our engine:

| their principle | our status |
|---|---|
| 7 levels, VERY POOR → EPIC | ✅ identical ladder |
| ratings relative to each spot's potential | ⚠️ built (`RATING_LOCAL_SIZE`), **OFF** |
| **the model NEVER assigns Good/Epic** | ⚠️ built (`RATING_OBS_GATE`), **OFF** |
| observations re-train the model | ⛔ **absent — the real gap** |

**Academic.** The published standardised index is the **Global Surf Index** (Espejo, Losada &
Méndez 2014, *Global and Planetary Change* 121:19–25), and it is explicitly *"developed on the basis
of expert judgment"* — so calibrating a quality index against a domain expert is the method, not a
shortcut. Separately, surf**ability** thresholds are absolute rather than relative:
Rodríguez-Pérez et al. (*JMSE* 8(8):599, 2020) validated buoy records against real logged surf
sessions and found median Hm0 of **0.9 m on a surfed day vs 0.4 m unsurfed**, median Tp **6.9 s vs
5.1 s**. The correct architecture is therefore a **hybrid** — an absolute floor for "is it surfable"
and a spot-relative scale for "how good" — which is what this engine already does via
`_HMIN_RIDEABLE_M` plus the three multiplicative vetoes.

---

## 2. The measurement that decides the order of work

Both dormant flags move us toward the standard. They are not equivalent, measured over the same
10,526–10,638 persisted spot-hours in the live blob:

| | spot-hours changed | shape of the change |
|---|---|---|
| **`RATING_OBS_GATE`** | **325 — 3.1%** | top of the scale only. epic 525→414, good 589→441, fair_good +259. **Nothing at or below `fair` moves at all.** |
| `RATING_LOCAL_SIZE` | 4,369 — **41.1%** | 4,177 down vs 192 up, median −3.8, p10 −25.4 |

★ **77% of good/epic survives the observation gate** (1,114 → 855) because of the internal
corroboration path — `rating_confirmation.internal_confirmation` treats **≥2 of GFS/EURO/ICON
independently scoring good/epic** as the confirmation, so a genuine swell that every model sees keeps
its rating and only single-model over-excitement is capped. That is precisely the owner's complaint:
*"I wouldn't say 4 ft @ 9 s is epic."*

⚠️ The gate is NOT starved. Memory recorded it as blocked on "~14 usable observations", which is true
only of the user-report path. The virtual-forecaster path needs no reports and the precompute already
rates every spot with all three models.

---

## 3. Recommendation, in order

**1. `RATING_OBS_GATE` first.** It is the industry rule verbatim, it has a 3.1% blast radius against
41%, it touches only the top two levels, it directly fixes the stated complaint, and it is
flag-reversible. Caps: unconfirmed → 69.9 (`fair_good`, exactly Surfline's model ceiling),
good-confirmed → 83.9, epic-confirmed → uncapped.

**2. `RATING_LOCAL_SIZE` second**, separately, so the two are not confounded and each can be judged.
It is correct and validated (100% spot coverage, median reference 1.14 m vs the legacy 1.2 m constant
so it redistributes rather than shifts, healthier clamping than the old p80) but it is a large,
visible change and it deserves its own before/after.

**3. Then the actual gap: a feedback loop.** Surfline's advantage is not a better formula, it is
35 years of labelled observations continuously re-training the model. We write
`REPORT_CALIBRATION` snapshots to an L2 archive and **nothing reads them back**. Closing that loop —
even crudely, as a per-spot bias correction learned from reports — is worth more than any further
tuning of the curve, because every constant in this engine is currently a guess validated once
rather than a parameter that improves.

---

## 4. Two honest caveats

⚠️ **The anchor test scores the gate at 3/5, not 5/5**, because it evaluates the *unconfirmed* case
and caps the two "pumping 6-8/8-10 ft = epic" anchors to `fair_good`. In production those days should
carry 2+ model agreement and survive — but this is **unverified for Florida specifically**, because
Florida has **zero** spot-hours above `poor_fair` in the current frames (flat late July). It should
be re-checked on a real swell before assuming.

⚠️ **The gate trades over-calling for under-calling.** A genuine epic day seen by only one model reads
`fair_good`. That is the deliberate trade Surfline makes, and the user-report path is what unlocks it
— which means the report loop in §3 is not optional if the gate ships.

---

## Sources

- Surfline Support — [Surf Ratings & Colors](https://support.surfline.com/hc/en-us/articles/36277684017819-Surf-Ratings-Colors)
- Surfline Support — [What is LOTUS?](https://support.surfline.com/hc/en-us/articles/4410495359643-What-is-LOTUS)
- Surfline Labs — [Surf Forecast Accuracy](https://medium.com/surfline-labs/surf-forecast-accuracy-b563605f104c)
- Espejo, Losada & Méndez (2014) — [Surfing wave climate variability](https://www.sciencedirect.com/science/article/abs/pii/S0921818114001192), *Global and Planetary Change* 121:19–25
- Rodríguez-Pérez et al. (2020) — [Expected Distribution of Surfing Days in the Iberian Peninsula](https://www.mdpi.com/2077-1312/8/8/599), *JMSE* 8(8):599
