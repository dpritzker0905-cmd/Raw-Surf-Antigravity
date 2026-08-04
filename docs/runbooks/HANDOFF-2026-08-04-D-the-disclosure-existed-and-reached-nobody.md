# HANDOFF 2026-08-04-D — the disclosure existed, and it reached nobody

**One line:** the arc's #1 critical had a shipped disclosure that lived only on an MCP tool; the
surfaces a surfer reads carried nothing. Measured **0 of 1005** served spots. Now on all four
surfaces, both response models, and all three client whitelists — with the guards mutation-tested,
which is how I found that my own first guard had a hole.

---

## §0 METHOD, AND WHAT WOULD MAKE THIS REPORT WRONG

Every number below is measured, and each instrument carries a control that could have exonerated the
suspect. What would falsify the headline:

* if `/spot-ratings` had carried `directional_conflict` on any spot ⇒ "does not reach the user" is
  wrong. **Control C2 tested exactly this** by checking a SIBLING field (`model_agreement`, shipped
  in the same arc): it was present on 1005/1005, so the payload demonstrably *can* carry a
  disclosure. Had C2 also come back absent, the claim would have shrunk to "this payload carries no
  disclosures", which is a different and smaller finding.
* if the limiter field were a constant ⇒ the census reads noise, not a distribution. **Control C1**
  asserts ≥2 distinct limiters; it saw 5.
* the floor count is a **LOWER BOUND**, stated as `>=` everywhere. `limiter` is an ARGMIN, so a spot
  sitting on the exposure floor while some *other* factor is lower is invisible to it. Spots in the
  75.7–90° band bind too and are likewise uncounted.

⚠️ **Not verified:** the field is not yet visible in production. It rides on `rate_one_spot`, and
`/spot-ratings` served `source: "precomputed"` — existing L2 frames predate this change. It appears
after deploy **and** the next precompute run. I did not observe it live on the wire.

---

## §1 TRIAGE — where the queue actually stood

MASTER-AUDIT-2.0's queue, re-checked against HEAD rather than against the handoff that wrote it:

| # | item | state |
|---|---|---|
| 2 | refuse impossible waves at ingest | ✅ `a8de625e` |
| 3 | publish spread | ✅ `dfaebc9f` (`model_agreement`) |
| 1 | reconcile the two directional floors | prerequisites ✅ (`dd972351` publish, `310dcfa6` harness); **reconcile gated on ERA5** |
| 4 | ERA5 campaign | running, healthy — 23/150 this batch, 20 banked, per-spot 260–413 s |
| 5 | promote `dev`→`main` | **still 104 commits behind, since 2026-08-02** |

So item 1's *only never-blocked step* was the one nobody had finished: the disclosure. That is what
this session did.

★ The ERA5 log now carries wall-clock timestamps (`22:53:42Z [20/150] …`), so the next stall can be
diagnosed without inferring from file mtimes.

---

## §2 ⛔⛔ THE FINDING — a caveat on the least-visible surface in the product

`dd972351` shipped `directional_conflict`. Grepped for its call sites:

```
sim_rating.py:397   _conflict = wave_physics.directional_conflict(swell_dir, shore_normal)
```

**One call site. `sim_rating` feeds `weather_sim_mcp.py` — an MCP tool.** The map glyphs, the spot
hub and the infobox — every surface a surfer actually reads — carried nothing, while the defect
itself was measured *on the served payload*, not in the sim.

### Measured, n=1005 distinct spots, union of 8 viewports, one served frame (22:00Z)

| | |
|---|---|
| carrying `directional_conflict` | **0 / 1005** |
| carrying `model_agreement` (sibling, same arc) | **1005 / 1005** |
| at the exposure floor (`limiter=swell_exposure`, `f=0.100`) | **155 / 1005 = 15.4%** (lower bound) |
| limiter histogram | size_gate 47.8% · swell_exposure 26.5% · wind_period_blend 24.8% · period_gate 0.6% · oversize_gate 0.4% |

Worst instances — biggest height served while the quality chain says the swell is blocked:

| spot | served | score | geometry | caveat |
|---|---|---|---|---|
| Fafa Island | **6.2 ft** | 4.6 very_poor | **full** | ABSENT |
| Avana Passage | 5.9 ft | 2.8 very_poor | full | ABSENT |
| Uoleva Island | 5.7 ft | 2.7 very_poor | full | ABSENT |

⇒ **Not the degraded-geometry story.** These are full-geometry spots.

### The infobox, independently

`/point` at Cayucos Pier (35.442, −120.915), the spot the census flagged:

```
surf_height_m      = 1.041  (3.4 ft)
shore_normal_deg   = 191.0
point.direction    = 300.55      =>  dtheta = 109.6 deg   (binds: >= 75.73)
geometry_readiness = full
directional_conflict = None
```

---

## §3 THE ARITHMETIC, CHARACTERISED FROM THE SHIPPED FUNCTIONS

Computed offline from `swell_exposure` and `_height_exposure_factor` (no network, no docstring):

| Δθ | quality q | height h | h² (energy) | ratio h²/q |
|---|---|---|---|---|
| 0° | 1.000 | 1.000 | 1.000 | 1.00 |
| 60° | 0.550 | 0.798 | 0.636 | 1.16 |
| **75.73°** | — | — | — | **1.50 ← binds** |
| 90°+ | 0.100 | 0.595 | 0.354 | **3.54 (saturates)** |

Past 90° **both** factors are flat on their floors, so the disagreement is *bounded* at 3.54×.

★ **This reconciles three numbers memory carries separately, and they are not in conflict — they have
different reference points:**

* **3.54×** — our two chains against *each other* (the internal contradiction). Matches the harness
  pin in `310dcfa6` exactly.
* **~27×** — the height chain against *spectral truth*: 0.354 vs a spectral flux of 0.013 at Δθ=100°.
* **~7.7×** — the quality chain against spectral truth: 0.100 vs 0.013.

⇒ Both floors are too generous; the height is far more so. **Do not patch either alone** — the height
is currently right BY CANCELLATION against a second error, and every owner anchor is head-on, so the
existing A/B is blind to a directional change.

---

## §4 WHAT SHIPPED — disclose, do not correct

Four surfaces (CLAUDE.md's ONE FORECAST COMPOSITION list), two response models, three client
whitelists. Absent unless it binds, mirroring `model_agreement`/`display_adjustment`. Kill switch
`RATING_DIRECTIONAL_CONFLICT=0`. Nothing in any rating chain branches on it.

| layer | file | why there |
|---|---|---|
| map glyphs | `spot_ratings.rate_one_spot` | the reference implementation; precompute uses the same call, so live/precomputed stay in parity |
| infobox | `point_surf_augment` | **stamped where `surf_height_m` is produced** — the caveat can never describe a height nobody served |
| spot hub | `spot_conditions` | a surface a surfer reads (same argument that moved the observation gate there) |
| sim | `sim_rating` | already had it (`dd972351`) |
| boundary | `SpotRatingItem`, `NormalizedPointResponse` | **Pydantic drops undeclared keys** — the `6da4c16e` defect |
| client | the 3 point whitelists | **the `e8b38e42` defect** — served and dropped before render |

`services/surf_conditions.py` produces a breaking height but **no quality score**, so there are not
two numbers to contradict. Correctly out of scope, not an omission.

---

## §5 ⭐ WHAT THE MUTANTS CAUGHT THAT GREEN DID NOT

31 tests passed on my first version. A mutation harness then found a real hole **in my own guard**:

```
[CAUGHT]         M1 undeclare the field on the response model
[*** SURVIVED ***] M2 producer stops returning it
```

**Why M2 survived.** My "chokepoint" test compared `produced − declared` — it fires when a field is
ADDED to the producer and never declared. It is blind to the reverse: delete the key from
`rate_one_spot` and `produced` merely *shrinks*, `dropped` stays empty, every test stays green, and
the field serialises as `null` on every spot forever. The fixture-based tests cannot see it either —
`_item()` is hand-written, so it proves what the MODEL accepts, never what the PRODUCER sends.

⇒ **A producer↔boundary differential is ONE-DIRECTIONAL.** Closed with `PRODUCER_MUST_RETURN`.
Final: **7/7 mutants caught**, baseline restored green.

### And the frontend guard did not do what it said

`pointFieldWhitelistParity.test.js` opens by arguing that per-field pins cannot catch this class and
claiming *"This test compares the three field SETS"*. **It does not.** Every assertion was a
per-field pin against a hand-written list of four. My field would have passed had I added it to one
mapper of three.

Measured why the author probably stopped there:

```
union 44 fields   ·   31 (70%) are NOT in all three
```

Set-equality would fail on 31 fields on day one and be switched off by the second reader. So the
discriminator is narrower: **the defect's signature is a field in EXACTLY TWO of three.** Twelve exist
today; they are pinned as a measured baseline so the **thirteenth** fails, and the docstring now says
what the file actually does.

⛔ I did **not** adjudicate those twelve. Several may be real drops (`surf_nearshore`, `valid_time`,
`source` are the suspicious ones); each needs its own measurement. A pre-existing failure is not a
licence to stop looking — it is the next task, not this one.

---

## §6 LEDGER #2 RE-FRAMED — the 413 are not a backlog

I went after "38% degraded geometry" as the dominant Jacobian term and found the framing wrong.

`backfill_geometry_reject_reasons.py`'s own docstring: a 24-spot sample measured that **every one had
been deliberately REJECTED by the fit gate**. The 413 are recorded rejections missing a *reason*, not
un-attempted work. The Jul 31 run's 12 fits:

| outcome | n | dominant reason |
|---|---|---|
| published | **0** | — |
| depth_only | 5 | `ambiguous_coastline` |
| rejected | 7 | `ambiguous_coastline` (4), `spot_misplaced`, `no_shoreline_in_window`, `not_on_open_ocean_no_ocean` |

**9 of 12 (75%) hit `ambiguous_coastline`.** So "run 395 more fits" is the wrong lever — it would burn
~2.4 h of ERDDAP to reproduce known rejections. The artifact's actual value is recording the reasons
so the queue stops re-churning 413 × ~22 s every cycle.

⚠️ n=12 is small and I did **not** establish the gate's base publish rate, so "the fit gate rejects
nearly everything here" is a hypothesis, not a finding. That measurement is the next step if anyone
ranks this item again.

---

## §7 WHAT I DID NOT DO

* **No UI rendering.** The field reaches the API payload and the client object; **no component
  renders it**. Neither do its siblings — the frontend consumes `model_agreement` in 0 files. Making
  a surfer *see* it is a product/UX decision, and the cheapest honest version is appending to the
  `why` string (the one line users actually read). **That is your call, not mine.**
* **Not observed live.** Needs deploy + a precompute run (§0).
* **The reconciliation itself** — still gated on ERA5 (~8% covered).
* **The twelve 2-of-3 fields** — pinned, not adjudicated (§5).
* **`dev` → `main`** — 104 commits, none of this week's fixes are in production.

---

## §8 INSTRUMENTS ADDED

| instrument | question | control |
|---|---|---|
| `directional_conflict_reach_census.py` | does the contradiction reach the user? | C1 limiter is a distribution (≥2 values); C2 a sibling disclosure IS present — else the claim shrinks |
| `test_spot_rating_wire_contract.py` (extended) | does the producer↔boundary contract hold **both ways**? | an undeclared key must still be dropped; the differential must flag a planted key |
| `test_directional_conflict_disclosure.py` (extended) | do the point boundary and all four surfaces carry it? | a control file that must NOT mention the field, so "string present" still discriminates |
| `pointFieldWhitelistParity.test.js` (extended) | can a new field reach two mappers of three? | the baseline must stay non-empty, or the ratchet is vacuous |

★ Every guard here was mutation-tested. The one that mattered — M2 — was caught by a mutant and by
nothing else.
