# HANDOFF 2026-07-31 NIGHT — the sim gained a SPACE dimension, and its own parity check found the gate

**Read [[standing-work-rules-user-mandate]] first (rules 9-13), then the spine
(`memory/THE-SURF-FORECAST-SCIENCE-canonical-chain.md`) and
`memory/sim-the-space-dimension-and-the-gate-asymmetry-2026-07-31.md`.**
Continues `START-HERE-2026-08-01-the-direction-arc.md`, whose §1 (the waves arrow) and §4 queue are
**untouched and still open** — this session was the *weather simulation* brief.

Branch `dev`, `8ef6d8a0` → `a99a93b4`, everything committed, **NOT pushed** (`git push origin dev`).
**Backend suite 1,647 passed / 0 failed** on a stable tree (1,601 before; +46 new). LOC ratchet clean
(`weather_sim_mcp.py` 792 → 743).
⚠️ The MCP server must be RESTARTED to expose `find_best_spot` — a running stdio server holds the
tool list it booted with.

| commit | what |
|---|---|
| `8ef6d8a0` | the sim could say WHICH HOUR but never WHICH SPOT |
| `a63962e9` | *(cherry-pick)* sim_explain carried its OWN knots constant — **it was never on dev** |
| `e6d4b5b9` | SEVEN copies of the knots constant, and one fix that never reached dev |
| `41983709` | the parity block graded the height and never the score — so it never saw the gate |
| `75411144` | the probe counted divergences; now it says which are real |

---

## 0. ★ WHAT I MEASURED BEFORE CHANGING ANYTHING — and the answer is GREEN

`backend/scripts/sim_health_probe.py` (new, committed — the sim↔glyph check has been done by hand
twice and thrown away twice). 32 spots, 8 coasts: **4 LEVEL differences, of which exactly ONE is
real.**

    Moss Landing  good 83.9 vs epic 95.9   → observation_gate      (a real asymmetry, §2)
    Sebastian Inlet ×3  poor vs poor_fair  → provenance_only       (NOT a defect, §1)

⇒ **the sim's composition is sound.** This session was therefore features + honesty, not a rescue —
the same conclusion the 2026-07-30 session reached, now with an instrument that will reach it again
without a human re-deriving it.

## 1. ⚠️⚠️ THREE OF THE FOUR WERE THE CLOCK, NOT THE PHYSICS — and nothing in the payload could say so

The precomputed glyph frame is built by the cron from whatever model run was current THEN; the sim's
live point call reads the newest. Same hour, different forecast. Forcing the LIVE path (an hour past
the frame ladder and beyond the ±6 h stale rung, so both sides read the same products):

    Sebastian Inlet, five spots, live:  glyph 40.4 40.9 40.6 40.3 40.2
                                        sim   40.4 40.9 40.6 40.3 40.2     delta 0.00 on every one

⛔ **The glyph payload carries no `run_time`.** This could only be settled by forcing a live compute.
Same class as *products carry no builder SHA*.

### ✅ CLOSED `2e81bcf5` — and both obvious designs were wrong
* **ONE field would describe half the score.** Marine and wind are ingested by different jobs and
  shared a run at **0 of 4** spots measured (Mavericks 07:27 vs 08:10; Bells Beach 04:07 vs 14:44).
  ⇒ `run_time` (marine) **and** `wind_run_time`.
* **A FRAME-level field would be wrong.** Run time varies PER SPOT — the point resolver serves
  regional products on independent cadences. At one valid_time: Pipeline **14:08Z**
  (`gfs_marine_waves_hawaii`) vs Sebastian Inlet **21:40Z the previous day**
  (`gfs_marine_waves_florida_east_coast`) — **17 h apart inside one frame.**
* ★ **So it is INTERNED.** Run times are per-PRODUCT (~20 products for ~900 spots) and the L2 object
  is fetched off the CDN by every client on every map load. Measured on a realistic frame:
  raw ISO pair **+30.1%** (+87 B/spot) vs interned **+3.4%** (+10 B/spot) — **+459 KB against
  +52 KB** across the object. Frame holds the distinct pairs, spots hold an index, the endpoint
  expands on read. ⚠️ Expansion **copies** — `select_precomputed` reads the process-wide cached L2
  object, and writing into it is the one-writer violation this repo has already paid for.
* `sim_health_probe --attribute` now compares runs first and only falls back to the live
  discriminator for older frames.

### ⚠️ ADJACENT FINDING the field surfaced on its FIRST use — not fixed, spawned
**Hawaii's wind product is built from a model run 75 HOURS OLD** (`gfs_wind_wind_hawaii`, run
`2026-07-28T14:40Z`) while every other region is 3-9.5 h. Its `valid_time` is CURRENT, so nothing
else flags it: **North Shore ratings have been scoring wind from a 3-day-old forecast**, and wind is
0.60 of the quality blend with a multiplicative veto. ★ `timeline_slot_census.py --fail-on-dead`
does not catch it — that guard checks `valid_time` COVERAGE, not RUN AGE. Marine at the same
coordinate is current, so it is wind-specific, not a region outage.

★ Two honesty fixes fell out and both shipped:
* `/api/weather/spot-ratings` now carries **`served_valid_time` + `frame_offset_hours`**. It echoed
  the hour that was ASKED FOR whatever frame served it, and the stale ladder reaches 6 h. The grid
  response has carried both all along; spot-ratings was the outlier.
  ★★ **A check whose two sides do not share a `valid_time` is measuring the clock, not the physics**
  — the artifact that had the obs gate capping 59.9% of good/epic on a cross-model mismatch.
* The probe **refuses to report a parity number** against a deploy that cannot say which hour it
  served (`--allow-unknown-hour` to override, and every affected row is labelled). ⚠️ It is
  currently refusing against production — the field ships on the next deploy of `dev`.

## 2. ⛔⛔ THE ONE REAL FINDING: the observation gate runs at 3 surfaces and not at the 2 a surfer reads

| surface | gates? |
|---|---|
| precompute → glyph payload · live spot-ratings route · map rating band | ✅ |
| **spot hub (`spot_conditions`) · weather sim (`sim_rating`)** | ❌ |

Live: Moss Landing serves **83.9 `good`** with `raw_score` **95.9** and `confirmed: 'good'`; the sim
says **95.9 `epic`**. Heights agree to 0.59%. The map and the sim give different answers for the
same spot at the same hour.

⚠️⚠️ **`test_rating_composition_parity.py` is STRUCTURALLY BLIND to it.** That guard AST-extracts each
surface's `rating_score(...)` call and makes every surface declare a position on every optional
input — and the gate is a step **AFTER** that call, so there is no argument to declare.
★ **A guard that inspects one shape cannot report a defect of another shape; no alarm is not no
defect.** (Same as the marine vortex moving to a tier `isMagnifiedCoarseField` bails on.)

**Shipped:** `sim_observed` reads the app's own served rating and puts it in `parity.quality` —
served score/level, the delta, `level_differs`, and when `raw_score > score` an `observation_gate`
block naming the cap, the confirmation that unlocked it, and `matches_ungated_model_score` so a
delta the gate explains is distinguishable from one it does not.
★ It learns the gate is on **by OBSERVING** (`raw_score` beside `score`), never by reading its own
env — `RATING_OBS_GATE` has a value **per lane** ('1' on Render, unset locally).
⛔ **It does NOT re-derive the gate and must not**: `confirm` needs cross-model agreement over the
whole precomputed blob plus fresh reports.

**⛔ NOT FIXED — the decision is the owner's.** Should the hub and the sim ALSO gate? Arguments:
* FOR: one composition, one answer. A surfer reading "epic" in the sim and seeing "good" on the map
  has been told two things.
* AGAINST: the sim is a *model* tool — reporting the model's own verdict beside the app's gated one
  is arguably more informative than hiding it. And the sim cannot compute `confirm` without either
  4 extra HTTP requests per spot or reading the glyph endpoint on every answer.
* The middle path now shipped: **report both, name the cause.** Escalate to gating only if the
  owner wants the sim to answer "what will the app show" rather than "what does the model say".

## 3. ✅ THE FEATURE: `find_best_spot` — the sim's missing SPACE dimension

`find_best_window` answers which HOUR at one spot. `find_best_spot(near, radius_km, valid_time, top)`
answers which SPOT at one hour — the question a surfer with six local breaks actually asks.

★★★ **This is where the per-spot geometry finally shows up.** Neighbouring breaks see the same
offshore sea; what separates them is their own shore normal. Live at Santa Cruz:
**Moss Landing 95.9 `epic` against Steamer Lane 9.8 `very_poor`, 25 km apart, entirely on
`swell_exposure` 0.974 vs 0.100.** A single-spot answer can never make that visible.

### ⛔ AND RANKING INVERTS THE HOUSE "FAIL OPEN" RULE — measured before building
`swell_exposure` returns a neutral 1.0 with no shore normal. Right for one spot (`None` = mean LEVEL
error **4.12** vs **1.04** for the coarse bearing). **Wrong for a ranking, because the failure is
SIGNED — it can only push a score UP.** Counterfactual, 48 spots on 4 coasts, same coordinate, same
sea, bearing removed:

    blindness RAISES the score at 39 of 48, lowers at 9
    median +8.45   mean +29.81   max +88.6      LEVEL CHANGES at 32/48 (66.7%)
    Steamer Lane 9.8 very_poor → 98.4 epic  ·  Pipeline 6.8 → 62.1 fair_good

⇒ a geometry-blind spot is ranked **LAST** whatever it scores, kept in `series` and labelled. The
guard is mutation-verified: delete it from the rank key and the blind cove wins the test.

Three more failure modes a ranking has that a single answer does not, all handled and all firing
live: **false precision** (top two inside the coarse bearing's ~6.0-point resolving power → says
"not distinguishable"; fires at Cocoa Beach where all 12 spots sit within 4 points) · **burying a
point break** (exposure floors past 90° off and there is no refraction term — 6 of 12 Santa Cruz
spots incl. the Lane; disclosed per-row as `exposure_floored`) · **a silently cut candidate set**
(truncation names the radius at which the answer WOULD be complete).

Live: 12 spots in 5-6 s cold, 0.0 s warm. Unknown name / ambiguous name / mid-ocean coordinate /
malformed hour each answer with their own error.

## 4. ✅ THE KNOTS CONSTANT — closed, and bigger than the ledger said

* **`c3907570` was NEVER ON `dev`.** It sat on `claude/sharp-jang-334fba`, not an ancestor of HEAD,
  while memory recorded it ✅FIXED. ⇒ ★ **rule 10 one level lower: not "is it deployed" but "is the
  commit on the branch that ships" — `git merge-base --is-ancestor`.** Cherry-picked.
* **SEVEN copies, not three** — the audit missed `normalizer.py` ×2 (the INGEST that stamps knots,
  the other half of the same round trip), `spot_ratings.py:56`, and `partitions_rating_ab.py` (an
  A/B instrument carrying the constant it would need to be blind to). ⚠️ a regex pinned to
  `1.943844` walks past `1.94384`; match any precision.
* **The "product event" fear is DEAD**: over **30,200 live wind cells** the truncated constant flips
  the verdict at **0** of them (4-decimal values; the flip window is 3.4e-6 kt wide).
* ★★ **Deriving the inverse does NOT make a float round trip exact** — 1,221 of 6,001 swept speeds
  still differ in the last ulp. It removes the **BIAS**, and a biased error is what turns noise into
  a reproducible verdict. **`kt * KT_TO_MS` and `kt / MS_TO_KT` differ by 1 ulp and 9 of 6,001
  straddle the score's 1-decimal rounding** ⇒ **ONE EXPRESSION, not just one constant**: every
  surface multiplies by `SR.KT_TO_MS`, pinned by an AST guard. Both guards mutation-verified.

## 5. ⛔ THE QUEUE FROM HERE

1. **Stamp `run_time` into the precomputed spot-ratings frame** (§1). Small, and it makes every
   future sim↔glyph divergence attributable from the artifact alone.
2. **Owner decision: should the hub and the sim apply the observation gate?** (§2). Everything
   needed to decide is now measurable — `parity.quality` names the cost per spot.
3. **Extend `test_rating_composition_parity.py` to POST-`rating_score` steps** so a fourth
   surface-asymmetry of this shape cannot hide again.
4. Carried from `START-HERE-2026-08-01` and untouched: the **waves-arrow vs infobox** direction arc
   (§1 there, still the #1 open item) · `geometry_reject_reason` backfill → reconcile job → overlay
   rehydrate · climatology → gonogo → `RATING_LOCAL_SIZE` · skill verdict → the 4,000-spot expansion
   · Kr + H1/10 **together** · `SURF_PARTITIONS` flip (3 lanes together).
5. **A PERIOD layer** and **an infobox that decomposes** remain the two product gaps the surfer
   research named (`START-HERE-2026-08-01` §3b).

## 6. ★ METHOD NOTES

1. ★★★ **Measuring the hypothesis before building killed the expensive version of two changes.**
   The blind-geometry counterfactual was run BEFORE `find_best_spot` had a rank key, and it decided
   the design. The 30,200-cell wind sweep was run BEFORE touching `KT_TO_MS`, and it turned a
   "product event needing an A/B and three lanes" into a three-line fix.
2. ★★★ **A divergence COUNT is not a finding; an ATTRIBUTION is.** 4 differences, 1 real. Without
   the live-path discriminator the instrument would have reported a 4× exaggeration of the problem
   and sent the next session chasing Florida.
3. ★★ **Never run the full suite in the background while editing source.** Two "failures" were
   `inspect.getsource` tests reading files I was editing mid-run. Both pass on a stable tree.
4. ★★ **Extract to make room BEFORE the ratchet blocks you** (again). `weather_sim_mcp.py` 792 → 742
   via `sim_briefing` + `sim_boot`. ⚠️ the warm-up CALL stays at module scope — that is what makes it
   the main thread and keeps the 2026-07-27 first-call deadlock fixed.
5. ★ **A guard that cannot go red is decoration** — every new guard here was mutation-verified by
   reintroducing the defect and watching it fail.
