# FINDING 2026-08-03 — the rating ceiling is a CONJUNCTION, and 0.6 is a ceiling not a contribution

**Unblocked by** `54304ad8` (the `limiter` field reached the wire). **Measured live**, `source=live`,
n=200 global spots, `/api/weather/spot-ratings`. **Derived** from `surf_rating.py`'s own constants.

---

## §1 THE DERIVATION — from the constants, not from a fit

```
score = 100 × size_gate × swell_exposure × sea_clean × tide_fit × breaker_type
              × wind_gate × oversize_gate × period_gate × (0.60·wind + 0.40·period)
_REF_ANCHOR_SCORE = 0.6      _REF_SAT_MULT = 2.5
```

`size_score` is **0.6 at the spot's own TYPICAL day** and reaches 1.0 only at 2.5× it. Every other
term is in [0,1] and can therefore only *reduce*. So:

| outcome | what it requires |
|---|---|
| a spot's **typical day** | ≤ **60** — `fair_good` — *even with all eight other factors at exactly 1.0* |
| **`good`** (70) | surf ≥ **1.38×** the spot's typical day **AND all eight others at exactly 1.0** |
| **`epic`** (84) | surf ≥ **1.90×** the spot's typical day **AND all eight others at exactly 1.0** |

★★★ **0.6 IS NOT A CONTRIBUTION, IT IS A CEILING.** The design intent — recorded 2026-07-30 — was
that a typical day should "rate mid-scale (fair-ish once wind/period multiply in)". But in a
multiplicative chain nothing multiplies *up*. The anchor sets the maximum the whole score can reach
on a typical day, and the remaining eight terms then subtract from it.

**The requirement is a CONJUNCTION over nine independent terms**, and that is why the ceiling is so
hard: it is not one constant being wrong, it is nine things having to be simultaneously perfect.

## §2 THE LIVE DISTRIBUTION — what each term actually removes

`limiter` = argmin(factors); `limiter_f` = that factor's value. n=200, global, `source=live`:

| limiter | share | `limiter_f` min / **p50** / max |
|---|---|---|
| `size_gate` | **46.5%** (93) | 0.138 / **0.512** / 0.743 |
| `swell_exposure` | **31.0%** (62) | 0.100 / **0.126** / 0.662 |
| `wind_period_blend` | 21.5% (43) | 0.244 / **0.461** / 0.766 |
| `period_gate` | 1.0% (2) | 0.250 / 0.312 / 0.312 |

**Scores: min 0.5 · p50 22.0 · max 69.9 · `good` count 0.**

- For the 46.5% limited by size, the implied ceiling is **100 × 0.512 ≈ 51** even with everything
  else perfect. Median actual is 22.0, so the other terms remove roughly another 57% on top.
- Where the blend limits, `100×blend` p50 = 46.1 against an actual p50 of 23.9 — **a further 21-point
  median cost from the other factors**.

## §3 TWO HYPOTHESES KILLED BY MEASUREMENT, BEFORE ANY CODE

⛔ **"The exposure floor is the degraded-geometry problem in disguise."** FALSE. Cross-tab of
`limiter` × `geometry_readiness`:

| | full | degraded | blind |
|---|---|---|---|
| exposure-limited | 44 | 18 | 0 |
| **rate within that geometry class** | **33.6%** | **26.9%** | — |

Degraded geometry is **less** likely to be exposure-limited, not more. Of the 31 spots pinned at the
**exact 0.10 exposure floor**, **20 have `full` geometry** and 11 degraded. The two populations are
not the same one.

⛔ **"`wind_period_blend` is the dominant limiter."** That was said one turn earlier from a
**Florida–Gulf** sample (46.2%). Globally it is **21.5%** and third. The regional and global
histograms nearly invert. *Same error class as the `hours=0` control: one mode sampled, generalised.*

## §4 A STANDING STRIKE NEEDS QUALIFYING

Earlier today `CAP_UNCONFIRMED` was struck as the reason the app cannot say `good`, on 0/200 spots
capped. On this sample **1 of 200 was capped**: *Liwa-Liwa, `raw_score` 72.6 → served 69.9,
`confirmed: None`.* Its raw score **cleared `good`** and the gate removed it.

⇒ The strike stands in magnitude — the cap explains ~0.5%, not the ceiling — but **"the gate is
inert" is no longer literally true.** As the score distribution rises, the cap begins to bind, and
it will bind on exactly the spots the work is trying to create.

## §5 WHAT THIS MEANS FOR THE NEXT CHANGE

The leverage is **not** a single constant. Three distinct, separately-testable levers:

1. **The conjunction itself.** Nine multiplicative terms means the joint probability of all being
   ~1.0 is vanishing. A `min`/soft-min or a weighted geometric mean over the *quality* terms would
   preserve "any veto can kill" while not requiring perfection everywhere. **This is the structural
   lever and the highest-risk one** — every one of those terms encodes a historical outage.
2. **`_REF_ANCHOR_SCORE = 0.6`.** Raising it lifts the typical-day ceiling directly and linearly.
   Cheapest to test, and it moves every spot. ⚠️ Must be A/B'd against the owner anchors
   (`R_FL ∈ [0.65, 0.85] m`), not against "does it look nicer".
3. **The 0.10 `swell_exposure` floor.** 15.5% of served spots sit exactly on it. Whether that is
   physically right at this hour is **not yet established** — it needs a directional check against
   the actual swell bearings, not an assumption either way.

⛔ **DO NOT tune more than one of these at a time.** They multiply, so two simultaneous changes
cannot be attributed, and the recorded `SURF_HEIGHT_H110` landmine (**"NEVER flip one alone ⇒ +25.5%
too high — BOTH OR NEITHER"**) is the same shape.

⚠️ Before touching any of it: `surf_rating.py` is at **760 LOC against an 800 ceiling**.
