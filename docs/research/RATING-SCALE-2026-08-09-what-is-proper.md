# Is our rating scale proper? — external sources, then our own served distribution

Researched 2026-08-09 after the owner named an **eight**-level ladder including "very good", which
this estate does not have. Method: check the reference implementation first, then measure what we
actually serve, because internal consistency is not evidence.

---

## 1. THE LADDER — seven is right, and the owner's eight is a REAL scale we don't use

There are **two** Surfline scales, and both exist:

| | levels | where |
|---|---|---|
| **Legacy 1–10** | 2 VERY POOR · 3 POOR · 4 POOR-FAIR · 5 FAIR · 6 FAIR-GOOD · 7 GOOD · **8 VERY GOOD** · **9 GOOD-EPIC** · 10 EPIC | their older *Rating of Surf Heights and Quality* page |
| **Current** | *"7 ratings from VERY POOR to EPIC"* | Surfline Support, *Surf Ratings & Colors* |

Our `LEVELS` = `very_poor, poor, poor_fair, fair, fair_good, good, epic` — **identical to the current
seven**. The owner's eight-level list with "very good" is the LEGACY ladder, not an invention.
⇒ **Adopting it is a product decision, not a bug fix.** It costs a new bucket edge plus a colour, and
`_BUCKETS` (backend), `RATING_LEVELS`/`RATING_COLOR` (frontend) and `getRatingColor` +
`getRatingColorSmooth` (shader) must all move together — the 2026-08-09 band-vs-glyph work is the
standing demonstration of what happens when two of those drift apart.

⭐ **The legacy definitions are worth reading even if we keep seven**, because they are anchored to
something observable rather than to an abstract score:

> POOR = 30% FAIR waves · POOR-FAIR = 50% FAIR · FAIR = 70% rideable · FAIR-GOOD = 30% GOOD ·
> GOOD = 50% GOOD · VERY GOOD = 70% GOOD · GOOD-EPIC = 50% EPIC · EPIC = 70% EPIC

Each rung is *the fraction of waves that reach the next tier*. That is a recursive, countable
definition. Ours is `score < 14`, `< 28`, `< 42` … — see §3.

## 2. WHAT THE MODEL IS ALLOWED TO SAY — we already mirror the reference

> "Good & Epic ratings are so rare, and need to be **manually applied by a human forecaster**."
> "At most spots, the current version of model condition ratings uses **surf height and wind
> conditions**" — Surfline Support / LOTUS.

Two consequences, both checkable, both **confirmed at HEAD by production measurement** (the
`surf_transform` tag on a live rated grid, 2026-08-09):

| principle | our status |
|---|---|
| model never assigns Good/Epic | ✅ `RATING_OBS_GATE` — measured **`obs_gate: true`** in production |
| ratings relative to the spot's potential | ✅ `RATING_LOCAL_SIZE` — measured **`local_size: true`** |
| composition richer than height+wind | ✅ ours is size + period + wind (tide wired, dark) |

⚠️ **`STATE-OF-THE-ART-surf-rating-2026-07-30.md` still marks BOTH of those "⚠️ built, OFF".** They
are ON. Same stale-claim class as the wind legend and the go/no-go's "flip the flag" prose — a
document that describes a decision made weeks ago as still pending. Corrected here, not there,
because that file is a dated snapshot.

## 3. ⛔ THE ACTUAL DEFECT: THE BUCKET EDGES ARE UNANCHORED, AND THE SCALE IS BOTTOM-LOADED

`_BUCKETS = 14 / 28 / 42 / 56 / 70 / 84` is an exactly even seven-way split of 0–100 (100/7 = 14.3).
There is **no justifying comment anywhere in the repo** — unlike almost every other constant in the
chain, which carries its derivation. It is a partition of an abstract score, while Surfline's rungs
are a partition of *observed waves*.

**Measured — 496 served spot-scores, 10 global viewports, one hour (2026-08-09T18:00Z):**

| level | bucket | n | share |
|---|---|---|---|
| very_poor | [0,14) | 189 | **38.1%** |
| poor | [14,28) | 199 | **40.1%** |
| poor_fair | [28,42) | 79 | 15.9% |
| fair | [42,56) | 24 | 4.8% |
| fair_good | [56,70) | 5 | 1.0% |
| good | [70,84) | 0 | **0.0%** |
| epic | [84,100) | 0 | **0.0%** |

min 0.2 · p10 2.7 · median **17.1** · p90 34.3 · **max 67.4**

Read it in two halves, because they are different findings:

- **The empty top is CORRECT.** The obs gate caps unconfirmed spots at 69.9 and the global max was
  67.4 — under the cap, as designed. `good`/`epic` being unreachable without human confirmation is
  the reference implementation's behaviour, deliberately copied. **Do not "fix" this.**
- **The bottom is the problem.** 78.2% of served spot-hours fall in the bottom TWO rungs and 94.1%
  in the bottom THREE. Below the gate the usable range is 0–70, and inside it the mass sits at the
  bottom: the seven-level ladder behaves as a three-level ladder in practice, and the two rungs a
  surfer most wants distinguished — "is today better than yesterday" around the median of 17 — are
  squeezed into a 14-point slice that also contains 40% of the world.

⚠️ **FRAME, quoted because `/spot-ratings` is a viewport sample:** n=496, ONE hour, boreal summer,
10 regions. This is a distribution claim about *this hour*, not about the year. ★ The honest next
step is the same measurement over a retained multi-day series before any edge is moved — a scale
re-cut from one summer afternoon would be the overfit that `STATE-OF-THE-ART` was written to warn
about (five Florida anchors shipped worldwide).

## 3b. THE MULTI-DAY DISTRIBUTION — measured, and it says DO NOT CUT YET

The §3 single-hour sample has been replaced by a proper one: **13,166 scored spot-hours**, 29
valid_times at 6-hourly steps spanning **exactly 7.0 days**, **23 viewports (10 N + 13 S)**, 667
requests, **0 failures**, 454 distinct spots. Variance decomposition: 55.3% between (viewport, hour)
cells / 44.7% within, so the independent unit is nearer the cell than the spot-hour — quoted because
a naive n=13,166 would overstate the precision.

    p1 1.2 · p5 2.0 · p10 2.7 · p25 5.5 · p50 18.6 · p75 32.8 · p90 46.3 · p95 53.8 · p99 67.3
    max 69.9   (= the RATING_OBS_GATE cap, not a physical ceiling)
    very_poor 40.7 · poor 27.1 · poor_fair 18.2 · fair 10.2 · fair_good 3.8 · good 0.00 · epic 0.00

**85.7% in the bottom three levels. Zero of 13,166 rows reached 70.** The gate is live and working:
96 rows sit exactly on 69.9 and the largest *ungated* raw_score was 96.0 — the model does produce
good/epic scores; the gate withholds them, as designed.

### ⛔⛔ THE LEFT SPIKE IS ONE CLAMPED FACTOR, NOT WEATHER — so an edge cut would enshrine a defect

The payload publishes `limiter`/`limiter_f`, so the spike was ATTRIBUTED rather than assumed
(supplementary census n=1,816 at lead 0/48/96/162 h):

- **18.9% of ALL served spot-hours are pinned at the `swell_exposure` FLOOR (limiter_f = 0.10).**
- Within `very_poor`, `swell_exposure` is the binding factor on **70%** of rows.
- Those floored rows score **p50 2.9** while carrying **p50 1.21 m breaking height**; 127 of them
  (7.0% of everything scored) carry **>= 1.5 m (5 ft)** and still score p50 3.6.
- Live instance: **Jeffreys Bay, 2026-08-09T19:00Z, ~9.6 ft, 12 s, 15 kt cross-shore,
  geometry_readiness=full, limiter=swell_exposure, limiter_f=0.1 -> score 2.7 `very_poor`** — in
  J-Bay's prime season.
- **~28% of all served spot-hours are `very_poor` BECAUSE of that one floor.**

⭐ **This is the KNOWN dual-floor landmine, and this is the first measurement of its REACH.**
[[a-hard-switch-on-an-uncertain-input-2026-08-04]] already recorded the mechanism — quality
`swell_exposure` floors at **0.100** while height `_height_exposure_factor = 0.55 + 0.45*exposure`
floors at **0.595**, 5.95x apart, so one payload can say "9.6 ft" and "2.7 very_poor" at once — and
its recorded instance was a single 4.3 ft spot. It is not a corner case: it is a fifth of everything
served. ⛔ That memory's standing instruction still binds: **do not patch either floor alone — the
height is right BY CANCELLATION, and the fix is ERA5-gated.**

### The edge candidates, and why the recommended one is READY BUT GATED

The edges turned out to be **load-bearing after all**, which the §3 draft got wrong: the numbers
themselves are underived (they entered in `1ba30f57`, 2026-06-28, undocumented, and are NOT in
`science_registry.py`) — but `backend/tests/test_owner_calibration_anchors.py` is an executable
acceptance spec whose assertions are LEVEL-valued, so it is pinned to them. Every candidate was
replayed in-process against it (`_BUCKETS` monkeypatched; nothing in the repo modified):

| candidate | edges | anchors | "epic unreachable below 9 s" |
|---|---|---|---|
| current | 14/28/42/56/70/84 | **6/6** | holds |
| A equal-population | (recomputed) | 3/6 | **BREAKS** (Tp 7 s reaches 78.7 -> epic) |
| B / C | — | 5/6 | — |
| D | — | 4/6 | **BREAKS** |
| **E recut-bottom-only** | **7/22/42/56/70/84** | **6/6** | holds |

**E is the only data-driven candidate that keeps the acceptance spec whole.** It cuts only the two
edges no anchor depends on, at the 1/3 and 2/3 quantiles of the sub-42 mass (86% of served rows),
turning 40.7/27.1/18.2 into **28.7/27.8/29.5**, and leaves 42/56/70/84 — and therefore the obs
gate's 69.9/83.9 arithmetic — untouched.

⛔ **It is NOT shipped, for two measured reasons:**
1. **Both of E's new edges are positioned by the spike that the `swell_exposure` floor manufactures.**
   Cut now and the scale is calibrated to a defect; fix the floor afterwards and the edges are wrong
   again. Fix the floor FIRST, re-measure, then cut.
2. **Lead-time drift would contaminate the cut.** p50 by lead day runs 21.5 / 20.3 / 19.9 / 19.9 /
   17.4 / 12.6 / 16.5 / 17.6 while **p90 RISES 44.2 -> 50.2** — the distribution WIDENS with lead
   time. Equal-population edges recomputed on day 0-1 vs day 5-7 move the 3/7 edge by **34%**, and
   E's own bottom edges move (9.5, 24.6) -> (5.4, 18.8). A single cut has to declare which lead
   window it is calibrated for.

## 4. WHAT "PROPER" WOULD MEAN HERE

1. **Keep seven** unless the owner wants the legacy ladder; the current reference uses seven.
2. **Anchor the edges to something countable.** Surfline's rungs are wave fractions; ours could be
   anchored to the served distribution (equal-population quantiles) or to the rideability physics
   already in the chain (`_HMIN_RIDEABLE_M`, the three vetoes). Either is defensible; an equal
   split of an abstract 0–100 is the one option with no argument behind it.
3. ⛔ **Do not re-cut the edges before the multi-day distribution exists**, and never in the same
   change as a composition fix — the two would be uninterpretable together.
4. **The real gap is unchanged and is not the scale**: Surfline's advantage is 35 years of
   observations re-training the model. Our equivalent (`RATING_OBS_GATE` + user reports) is now ON;
   the feedback loop that *learns* from them is still absent.

## Sources

- Surfline Support — [Surf Ratings & Colors](https://support.surfline.com/hc/en-us/articles/36277684017819-Surf-Ratings-Colors)
- Surfline — [Rating of Surf Heights and Quality](https://www.surfline.com/surf-science/rating-of-surf-heights-and-quality_31942/) (legacy 1–10 definitions)
- Surfline — [Updates to Surfline's Rating of Surf Heights and Quality](https://www.surfline.com/surf-news/surflines-rating-surf-heights-quality/1417)
- Surfline Support — [What is LOTUS?](https://support.surfline.com/hc/en-us/articles/4410495359643-What-is-LOTUS)
- Surfline Labs — [Machine Learning for Surf Forecasting](https://medium.com/surfline-labs/machine-learning-for-surf-forecasting-4a007f13b3e3)
- Magicseaweed — [A Quick Forecast Tutorial](https://magicseaweed.com/docs/forecasting/66/a-quick-forecast-tutorial/10123/) (0–5 stars: solid = swell power, greyed = wind penalty — the same veto shape as ours)
- Coastal Engineering Proceedings — [Deep learning object detection applied to surfing wave quality](https://icce-ojs-tamu.tdl.org/icce/article/view/12664)
- Journal of Coastal Research — [Research-Based Surfing Literature for Coastal Management](https://bioone.org/journals/journal-of-coastal-research/volume-2009/issue-253/07-0958.1/Research-Based-Surfing-Literature-for-Coastal-Management-and-the-Science/10.2112/07-0958.1.full) (Hutt/Black/Mead skill classification; peel angle + breaking intensity as quality metrics)
- Prior internal: `docs/research/STATE-OF-THE-ART-surf-rating-2026-07-30.md` (Global Surf Index, Espejo et al. 2014; Rodríguez-Pérez et al. 2020 surfability thresholds)
