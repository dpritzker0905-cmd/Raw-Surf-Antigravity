# FINDING 2026-08-14 — the rating said "HIGH CONF" on geometry it could not resolve

**WS-CAN-0062 / WS-OBJ-207** · Program 13.0 Mission 1 · rationale extracted from
`services/weather_pipeline/spot_ratings.py` under the 800-LOC ratchet (the ratchet measures our
documentation — the rule is *move* rationale, never delete it).

---

## The defect

`rate_one_spot` serves **three orthogonal confidences**, and the only one that reaches a rendered
surface is the one that cannot see the forecast's inputs.

| field | grades | rendered? |
|---|---|---|
| `confidence` | the **PIN** — `accuracy_flag` / `is_verified_peak` | ✅ `MapMarkerLayers.js:285` — *"· medium conf"* |
| `geometry_readiness` | the **INPUTS** — `full` / `degraded` / `blind` | ❌ mapped at `spotRatingsClient.js:66`, consumed by nothing |
| `forecast_confidence` | the **FORECAST** — ensemble spread | absent unless it binds |

`geometry_readiness` has been on the wire since `563f0f73`. Nothing a user sees has ever read it.

So a **verified** pin on **blind** geometry — where no shore normal resolved at all, and the forecast
therefore *"cannot tell which way the beach faces, so every swell direction scores the same"*
(`spot_geometry_readiness.summarize`) — rendered `high conf` beside a `why` string byte-identical to
a fully-surveyed spot's.

Per `spot_geometry_readiness`'s own measured header, inheriting the coarse bearing costs:

```
shore-normal error inherited   median 22.3 deg, p90 81.4 deg, max 179.4 deg
RATING LEVEL CHANGES           45.8% of evaluations, median jump 2 levels (max 6 of 7)
depth-limited breaking cap     lost at 78.4% of spots
```

## The measurement

**Live production, 2026-08-14T18:00Z, bbox Florida east coast, n=87** (`source: precomputed`).
`geometry_readiness {full: 68, degraded: 19}`.

**Eight distinct `why` strings were served byte-identically across BOTH full and degraded geometry.**
The sharpest pairs:

| `why` | spots |
|---|---|
| `~1.5 ft surf, 9s period, 7kt onshore wind, falling tide` | Pepper Park (**full**, high) · Round Island Park (**full**, high) · **South Beach Park–Vero (degraded, medium)** · **Riomar Point (degraded)** · **Conn Beach (degraded)** |
| `~1.5 ft surf, 8s period, 8kt onshore wind` | Playalinda Beach (**full**) · Pump House (**full**) · **Kennedy Space Center (degraded)** · **Cape Canaveral AFS (degraded)** |
| `~1.4 ft surf, 9s period, 7kt onshore wind` | Pelican Beach Park (**full**, high) · **Melbourne Beach (degraded, HIGH)** · Indialantic (**full**) |

Melbourne Beach is the worst case in the sample: `confidence: high` on `degraded` geometry, with
nothing anywhere in the payload a user reads to qualify it.

Earlier corroboration: LV-06 (n=24) found Kennedy Space Center (degraded) and Cape Canaveral (full)
both reporting `medium`; a post-12.0 census found **15 of 17 blind spots reporting `medium`**,
identical to full-geometry spots. ⚠️ Quote that census as *"of 1,052 sampled spots"*, never *"of the
estate"* — 4 of 6 regions hit the endpoint's `limit=200` cap, and an earlier 47% figure was retracted
at `f39e9cf5` for exactly that.

## Why `confidence` was NOT made a function of `geometry_readiness`

The canonical register's `Remaining Work` listed that option first. **It was rejected.**

1. **The three axes are orthogonal by design**, and `spot_ratings.py` records the decision in the
   `geometry_readiness` block. Folding readiness into `confidence` collapses two of them and destroys
   a distinction the wire already carries.
2. **It would silently change a served field's meaning with nothing on the wire to distinguish the
   old semantic from the new** — the one-quantity-two-meanings class that has `WS-CAN-0005` blocked
   (`run_time` means the ingest clock on 22,843 stored products and would mean the model cycle on new
   ones). Creating a second instance of the defect an adjacent task is blocked on is not a repair.
3. The register explicitly permitted the alternative: *"Make confidence **(or an explicit field)** a
   function of geometry_readiness."*

Enforced by `test_the_verified_pin_still_reads_high__THE_CONTROL`: `confidence` must remain `high`
across all four verdicts. If anyone couples them later, that test goes red and says why.

## The repair

An **additive** caveat appended to `why`:

| verdict | appended |
|---|---|
| `degraded` | `, coarse shore detail` |
| `blind` | `, shore direction unknown` |
| `full` | *nothing* |
| `None` (ungraded) | *nothing* |

**Why `why` and not a new payload key.** `why` is the only one of the three that reaches a user
today — the production frontend has been frozen at a 2026-05-20 artifact for 85 days
(`WS-CAN-0039`), so a new key would land on a shelf. `why` renders immediately.

**Why the vocabulary lives in `spot_geometry_readiness.caveat()`**, beside `summarize()`: that module
already owns the closed verdict vocabulary and its prose. A string literal in `spot_ratings` would
have been a second owner, and one verdict would eventually grow two phrasings (WS-OBJ-401).

**Why it says "detail" and not "angle".** `caveat()` is keyed on the verdict alone, because that is
all a rating payload carries. `DEGRADED` covers three causes — a coarse 0.25° normal, a missing break
depth, or a non-coastal classification — and two of them are not about the angle. The wording has to
stay true for all three.

**Why `None` refuses.** An ungraded spot (an older precomputed frame, or a resolve that failed) is
**not** a full one. Stamping either verdict on it fabricates a measurement — the WS-OBJ-506
measure-or-refuse shape this program has already closed three sites of.

## It discloses, it does not correct

With everything held constant except the verdict:

| verdict | score | level | `why` |
|---|---|---|---|
| `full` | 93.4 | epic | `~3.9 ft surf, 13s period, 4kt offshore wind` |
| `degraded` | 93.4 | epic | `… , coarse shore detail` |
| `blind` | 93.4 | epic | `… , shore direction unknown` |
| `None` | 93.4 | epic | *(unchanged)* |

A coarsely surveyed break is not a worse wave; it is the same wave, known less precisely. Folding
this into the 0-100 would penalise a spot for **our** survey coverage — the same verdict the repo
already reached for `forecast_confidence` and `RATING_LOCAL_SIZE`: a separate axis, not a multiplier.

Kill switch: `RATING_GEOMETRY_CAVEAT=0` restores the pre-fix string byte-for-byte.

## Replay over the live payload

Applying the shipped `caveat()` to the same 87-spot production response:
**19 spots gain a disclosure, 68 are unchanged.**

Full evidence index: `program/weather-simulation/IMPLEMENTATION_EVIDENCE_INDEX.csv`.
