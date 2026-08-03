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

---

## §6 THE EXPOSURE FLOOR — a suspect REMOVED, and two instruments that could not answer

Lever 3 of §5 said the 0.10 `swell_exposure` floor (15.5% of served spots, pinned exactly) was
"not yet established" as right or wrong. It is now **partly established, and the news is good.**

### The physics is correct where it can be checked independently

Fetched shore normals and swell bearings for four floor-pinned spots (`/api/weather/point`):

| spot | shore normal (seaward) | swell FROM | off-normal | geometry |
|---|---|---|---|---|
| Backdoor (Oahu N shore) | 325.0° | 65.2° | **100.2°** | full |
| Laniakea (Oahu N shore) | 315.2° | 63.5° | **108.3°** | full |
| Anchor Point (Morocco) | 212.0° | 344.0° | **132.0°** | full |
| Cayucos Pier (California) | 191.0° | 302.4° | **111.4°** | full |

Backdoor and Laniakea are **correct and the floor is right**: an **ENE (65°) trade swell physically
cannot reach a NW-facing (325°) shore**, and this is August — south-swell season, when Oahu's North
Shore is flat. The model is describing reality, not failing.

### An objective seaward test — all four normals PASS

Point-in-polygon against `ne_50m_land.json` (1,421 polygons), sampling 10/20/30 km along the normal
and along its reverse. **A seaward normal must find ocean ahead and land behind.**

| spot | seaward ocean | reverse land | verdict |
|---|---|---|---|
| Backdoor · Laniakea · Anchor Point · Cayucos Pier | 3/3 each | 3/3 each | **OK** |

⇒ **"The exposure floor is caused by backwards shore normals" is REMOVED as a suspect.**
⚠️ **Necessary, not sufficient.** This rules out a *reversed* normal; it cannot rule out one that is
off by tens of degrees while still pointing at open water. That case needs a coastline-tangent fit,
not a land test.

### ⛔ TWO INSTRUMENTS FAILED FIRST, AND THE CONTROL CAUGHT BOTH

1. **`/api/weather/point` at ±8 km** returned marine data on *both* sides of every spot — it snaps to
   the nearest ocean cell rather than returning null on land. Cannot discriminate. Void.
2. **`bathymetry.depth_at()`** reported **382 m for INLAND Oahu**. Its own docstring says it "prefers
   the nearest OCEAN cell within a small window when the exact cell is land" — a bathymetry lookup
   with a land fallback, not a land mask. It scored **Backdoor — the known-correct control —
   as BACKWARDS**, and would have produced the headline "3 of 4 shore normals are reversed."

★★★ **THE KNOWN-GOOD CONTROL IS WHAT SAVED THIS.** Without Backdoor in the set, a confidently wrong,
high-impact claim about the dominant geometry term would have shipped. Both failures are the same
shape as the day's others: *an instrument that answers when it cannot know.* The third instrument was
only trusted **after** five land/sea controls passed.

### What this does to the levers

**Lever 3 is de-prioritised.** The floor is legitimate on the cases that can be checked, and no
evidence of a reversed-normal population survives. Remaining exposure work needs a *magnitude* test
(is the bearing accurate?), not a *sign* test — and that is a different, larger instrument.

⇒ **Lever 2 (`_REF_ANCHOR_SCORE`) is now the cheapest remaining test**, and `size_gate` is the
dominant limiter at **46.5%**, so it is also the one with the most reach.

---

## §7 LEVER 2 IS EXHAUSTED — measured against the owner's own constraint suite, before any change

`test_owner_calibration_anchors.py` already encodes the owner's constraints as a two-sided test:
`4 ft @ 9 s must NOT be epic` **and** `7 ft @ 11 s MUST be epic`. It is the A/B harness, and it was
already green. So lever 2 could be swept without writing anything.

### The permitted range is 0.05 wide

| `_REF_ANCHOR_SCORE` | owner anchor suite |
|---|---|
| **0.60** (shipped) | **10/10 OK** |
| **0.65** | **10/10 OK** |
| 0.70 | **BREAKS 2** — `FL 4 ft @ 9 s is NOT epic`, and the small-end pair |
| 0.75 · 0.80 | same two breaks |

Above 0.65 the 4 ft Florida day reads `epic` again — **the owner's original 2026-07-29 complaint.**

### And the 0.05 that IS permitted changes no level at all

Florida, reference 0.75 m, perfect wind and exposure:

| anchor case | 0.60 | 0.65 | Δ |
|---|---|---|---|
| FL 2–3 ft @ 9 s | 50.8 `fair` | 54.9 `fair` | +4.1 |
| FL 3–4 ft @ 9 s | 59.9 `fair_good` | 62.9 `fair_good` | +3.0 |
| FL 4 ft @ 9 s | 64.4 `fair_good` | 66.9 `fair_good` | +2.5 |
| FL 6–8 ft @ 11 s | 89.3 `epic` | 89.3 `epic` | **+0.0** |
| FL 8–10 ft @ 12 s | 87.9 `epic` | 87.9 `epic` | **+0.0** |

**Not one case crosses a level boundary.** The big days do not move *at all*, because at 7 ft against
a 0.75 m reference the size term is already saturated (h/ref = 2.84 > `_REF_SAT_MULT` 2.5) — the
anchor only has authority below saturation.

Secondary effects: typical-day ceiling 60 → 65; `good` needs 1.38× → **1.21×** typical; `epic`
1.90× → 1.81×.

⇒ **LEVER 2 IS EXHAUSTED.** It is permitted at 0.65, moves nothing across a level in the owner's own
anchors, and every point it would add above 70 on the live set is **removed again by
`CAP_UNCONFIRMED = 69.9`**. Shipping it would be motion, not progress. **No code changed.**

## §8 THE JACOBIAN RE-RANKS — and my own strike is about to become wrong

With lever 3 removed (§6) and lever 2 exhausted (§7), two things remain, and they compose:

**1. The conjunction (lever 1).** Nine multiplicative terms, all of which must be ≈1.0 simultaneously.
This is the structural answer and the highest-risk change; every term encodes a historical outage.

**2. ⚠️ THE OBSERVATION GATE — which I struck TWICE today as "inert", and which becomes THE binding
constraint the moment anything lifts scores.** `CAP_UNCONFIRMED = 69.9` caps any spot whose
`confirmed` is None. Measured this session: **`confirmed` was `None` on 200 of 200 spots**, and the
one spot whose raw score cleared `good` (Liwa-Liwa, 72.6) was capped straight back to 69.9.

> The strike was correct *at the time* — with scores below 70 the cap could not bind. But it is a
> statement about the current distribution, **not about the mechanism.** Lift the distribution by any
> means and the gate is waiting at 69.9 for ~100% of spots.

⇒ **THE NEXT MEASUREMENT IS WHY `confirmed` IS NEVER SET.** `internal_confirmation` needs ≥2 of 3
models agreeing within `CONFIRM_TIME_TOLERANCE_H = 3.0`, and the recorded landmine is that **the
models do not share a `valid_time`** (measured: GFS 15/18, EURO+ICON 13/16). If confirmation can
never fire, `CAP_UNCONFIRMED` is an absolute ceiling at 69.9 **regardless of every other lever**, and
no amount of calibration or physics can make the product say `good`.

★ That is now the highest-Jacobian open question in the rating, and it is a *reachability* question —
the same shape as the recorded `break_depth` tier-2 lesson: **check reachability BEFORE tuning any
constant behind it.**
