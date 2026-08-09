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
