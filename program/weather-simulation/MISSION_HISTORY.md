# MISSION HISTORY — Program 13.0

---

## Mission 1 — Geometry-quality disclosure

| | |
|---|---|
| **Date** | 2026-08-14 |
| **Objective** | WS-OBJ-207 |
| **Canonical task** | WS-CAN-0062 |
| **Supporting** | WS-OBJ-401, WS-OBJ-502 |
| **Baseline** | `1f4e5149` on `dev` |
| **Commit** | see `CURRENT_EXECUTION_STATE.json` |
| **Result** | **Verified Complete** |
| **Gate effect** | Gate 1 — one objective closed; gate remains OPEN |

### Why this mission was selected

Audit 12.2's authorized mission (`WS-CAN-0066`) was **already complete** — `a1b5aac3`, floor raised
`886094ce`. Per program rule §10 the path was re-derived: `UPDATED_CRITICAL_PATH.md` position ② is
the provenance visit, of whose three parts only `WS-CAN-0062` passed the readiness gate
(`Current Blocker: none`). The other two are blocked — see `BLOCKERS_AND_DECISIONS.md` D-2.

### What went wrong during the mission, and what caught it

**I added an undeclared science switch, and only the FULL guards lane found it.**

The kill switch `RATING_GEOMETRY_CAVEAT` was added to `spot_ratings.py` — a rating surface — without
declaring it in `_RATING_FLAGS` (`routes/admin/surf_forecast.py`). The focused suite (10 tests) and
the four surrounding contract suites (145 tests) were **all green**. The failure appeared only in
`test_flag_lane_parity.py::test_every_science_switch_a_rating_surface_reads_is_declared_in_the_registry`,
at ~12% of a 152-file lane:

```
RATING_GEOMETRY_CAVEAT (read by spot_ratings.py)
```

⚠️ **The registry's own comment, dated 2026-08-04, describes this exact omission by a previous
author** — *"I ADDED THIS FLAG IN THREE SURFACES AND DID NOT DECLARE IT. The full suite caught it
here, nothing else did."* Ten days later, same omission, different author.

**⇒ It is a property of the workflow, not of an author: a new `os.environ.get` in a rating surface is
a REGISTRY EDIT, and no targeted test run will tell you.** An undeclared switch is invisible to the
admin panel and to every other lane guard, which is how a flag comes to be on in one lane and off in
another.

**Resolution:** declared, with the measured behaviour and the reason. **The guard was not weakened,
exempted, or narrowed** — its coverage floor (`>= 27` visible flags) is shrink-only by contract.

---

# CLOSURE CERTIFICATE — WS-OBJ-207

**Objective ID:** WS-OBJ-207 — Geometry-quality disclosure
**Objective:** *"A degraded or blind geometry spot says so."*
**Canonical Tasks:** WS-CAN-0062

**Implementation Commits:** `fix(weather): [WS-OBJ-207 / WS-CAN-0062]` — see
`CURRENT_EXECUTION_STATE.json` for the SHA.

**Active Runtime Path:**
`GET /api/weather/spot-ratings` → `spot_ratings.rate_one_spot` (live lane) **and** the cron
precompute → Supabase L2 `spot_ratings/latest.json` → `spotRatingsCdn.js` / `spotRatingsClient.js` →
`MapMarkerLayers.js:281-285`. One producer serves both lanes (the parity rule), so one repair covers
both. Verified end-to-end in a running browser, not inferred.

**Tests:** `backend/tests/test_spot_rating_geometry_disclosure.py` — 10 tests, guards lane.
They drive the real `rate_one_spot`; none asserts on `inspect.getsource`.

- Known-bad tree: **4 failed** — including the behavioural pair naming the byte-identical strings.
- Repaired tree: **10 passed**.
- Repair-disabled (`RATING_GEOMETRY_CAVEAT=0`): **2 failed** — the two behavioural tests, and only
  those. The guard fails in the correct direction and for the correct reason.

**Browser Evidence:** local frontend → local repaired backend (`127.0.0.1:8000` confirmed in
`performance.getEntriesByType('resource')`; both CDN and prod-backend lanes had to be overridden
first — D-3). Map settled (`isMoving() === false`, z10.5) before reading. Kennedy Space Center
(degraded) popup rendered:

```
Kennedy Space Center · Poor to Fair
2.6 ft · 7s period
↓ Tide -1.4 ft falling
~2.6 ft surf, 7s period, 1kt offshore wind, coarse shore detail · HIGH CONF
```

The caveat wraps to a second line inside the 220 px box without clipping. Note the readout now shows
`HIGH CONF` **and** `coarse shore detail` together — the pin is trusted, the geometry is not, and the
reader can finally see both. Screenshot in `evidence/browser/`. No weather- or rating-related console
errors (the only errors were pre-existing 401s from the unauthenticated feed route).

**Scientific Evidence:** the disclosure is inert with respect to the forecast.
`evidence/scientific-validation/WS-CAN-0062-disclosure-matrix.txt` — with everything held constant
except the verdict:

| verdict | score | level | why |
|---|---|---|---|
| `full` | 93.4 | epic | `~3.9 ft surf, 13s period, 4kt offshore wind` |
| `degraded` | 93.4 | epic | `… , coarse shore detail` |
| `blind` | 93.4 | epic | `… , shore direction unknown` |
| `None` | 93.4 | epic | *(unchanged — refuses to guess)* |

Score, level and `surf_height_m` identical across all four; pinned by
`test_the_score_and_level_are_IDENTICAL_across_every_verdict`.

**Live "before" measurement:** production, 2026-08-14T18:00Z, n=87 (`evidence/network/`).
`geometry_readiness {full: 68, degraded: 19}`. **8 distinct `why` strings were shared across both
full and degraded geometry** — e.g. `~1.5 ft surf, 9s period, 7kt onshore wind, falling tide` served
for Pepper Park (full, high) *and* South Beach Park–Vero (degraded, medium); Kennedy Space Center
(degraded) was byte-identical to Playalinda Beach (full). Replaying the shipped `caveat()` over that
same payload: **19 of 87 spots gain a disclosure, 68 unchanged.**

**Architecture Authority:** readiness vocabulary keeps **one** owner —
`spot_geometry_readiness` (`BLIND`/`DEGRADED`/`FULL`, `summarize()`, now `caveat()`).
`rate_one_spot` remains the single reference implementation and gained **one** consumption site.
Authority counts unchanged: producers of `why` **1 → 1**; readiness vocabulary owners **1 → 1**;
rating composition paths **1 → 1**. No new cache, state owner, flag lane or fallback.

**Regression Guardrails:** the 10 tests above, plus the pre-existing
`test_spot_rating_wire_contract.py` chokepoint (no undeclared key) and
`test_rating_composition_parity.py` (no surface may supply a factor the reference does not).
`test_the_verified_pin_still_reads_high__THE_CONTROL` specifically guards the rejected design: if
anyone later couples `confidence` to geometry, it goes red and says why.

**Rollback:** revert the guarded block in `spot_ratings.py`. Blast radius is one string in one
payload — no forecast quantity, no render path, no endpoint contract, no frontend behaviour.
Runtime kill switch without a deploy: `RATING_GEOMETRY_CAVEAT=0`.

**Known Limitations — what this closure does NOT establish:**

1. **It does not reach production *users* yet.** The backend deploys from `dev`, so the change is
   production-live on the API; but the production **frontend** has been frozen at a 2026-05-20
   artifact for 85 days (`WS-CAN-0039`, owner-gated). The rendered improvement is proven on a local
   build, not on production's shipped bundle. This is delivered *capability*, not yet delivered
   *user value*, and is counted that way.
2. **The `degraded` wording is verdict-level, not cause-level.** `DEGRADED` covers three causes —
   coarse 0.25° normal, missing break depth, non-coastal — and the payload carries only the verdict.
   "coarse shore detail" is true for all three but names none. Naming the cause needs the assessment
   dict on the wire; not attempted.
3. **`geometryReadiness` remains dead in the frontend.** `spotRatingsClient.js:66` maps it and no
   component consumes it. The disclosure reaches the user through `why` instead. Deliberate — a new
   render path would land on the frozen shelf — but the dead mapping is still dead.
4. **No mobile/theme verification.** No frontend code changed, so the three-themes and device
   mandates were not engaged; this was not independently re-verified.
5. **Local environment is not CI.** python 3.14 vs declared 3.12, 28 of 46 pins differing. Local
   results are evidence about this box.

**Reopen Trigger:** a product decision to render a single blended trust score; or `geometry_readiness`
gaining a fourth verdict (`caveat()` would silently return `None` for it — by design, but it would
then under-disclose); or the frontend unfreezing, at which point rendering `geometryReadiness`
explicitly becomes worth revisiting.

**Closure Date:** 2026-08-14
