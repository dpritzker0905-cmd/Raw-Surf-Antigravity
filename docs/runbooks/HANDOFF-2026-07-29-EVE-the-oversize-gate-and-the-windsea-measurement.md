# HANDOFF 2026-07-29 EVE — the closeout that rated epic, and the chop that is 86% of the wave

**Continues `HANDOFF-2026-07-29-surf-physics-audit-and-the-missing-refraction.md`.** Read
[[standing-work-rules-user-mandate]] first.

Owner's brief: *"Lets get the weather simulation system features of this app working well. Keep
going in the queue."* Then, mid-session and decisively: *"Note: some big wave surf spots are for big
wave surfers."* — which caught a real defect in my first draft. See §2.

Shipped: `3304c909`. Backend 1214 passed (1 pre-existing unrelated failure), frontend **1535 passed
across 171 suites**, LOC ratchet green, ESLint clean.

---

## 1. ✅ QUEUE #1 DONE — THE RATING'S SIZE GATE HAD NO DESCENDING LIMB

`size_score` is monotonic non-decreasing and clamps at 1.0. Reproduced exactly on the LIVE default
path (clean offshore wind, head-on swell, Tp 14 s):

| surf | 2 ft | 3 ft | 4 ft | 6 ft | 12 ft | 25 ft | 35 ft | 60 ft | **100 ft** |
|---|---|---|---|---|---|---|---|---|---|
| score | 38.8 | 67.8 | **97.3** | 97.3 | 97.3 | 97.3 | 97.3 | 97.3 | **97.3 `epic`** |

⚠️ **Worse than the audit recorded** — the audit stopped at 35.5 ft; it does not stop. A 100 ft wave
scores `epic`.

★ **And flipping `RATING_LOCAL_SIZE` does NOT fix it** — I measured the local branch too. It only
MOVES the saturation point (ref 0.7 m saturates at 5.7 ft, ref 4.0 m at 32.8 ft); everything above
still collapses to one number. The audit's warning was right for a reason it did not state.

### The fix — `oversize_gate`, shaped after `wind_gate`
A separate MULTIPLICATIVE veto, not a reshape of `size_score`. Same problem class the repo already
solved once (`wind_gate`: an additive term with a floor cannot veto), so it is the same shape:
independently kill-switched (`RATING_OVERSIZE=0` / `window.__RAW_DISABLE_OVERSIZE__`), independently
tested, and it leaves `size_score` byte-identical — which is why all 4 pinned user calibration
anchors stay green and are **provably** inert (the gate returns exactly 1.0 at every anchor).

⚠️ **THE FLOOR IS 0.30, NEVER 0.** `rating_transform_grid` skips any cell scoring `<= 0`, so a
zeroing veto would **erase the coastal rating band from the map on exactly the biggest swells of the
year**. This is a landmine worth remembering for any future multiplicative factor.

---

## 2. ★★★ THE OWNER'S CORRECTION — "big wave surf spots are for big wave surfers"

My first draft used ONE absolute ceiling. My own end-to-end probe showed what that did:

```
Mavericks   24.7 ft -> "good"        (was epic)
Mavericks   31.1 ft -> "poor_fair"
```

Those are the days Mavericks exists for. ★ **A single ceiling is right for the ~97% of the catalogue
that is beach and reef breaks, and wrong for exactly the spots people look at.**

### Capacity is now resolved in THREE TIERS, most-trusted first

| tier | signal | why |
|---|---|---|
| 1 | `reference_size_m` — p80 good-day height from `spot_size_climatology` | the intended instrument: objective, global, auto-calibrating |
| 2 | `break_depth_m` — ETOPO nearshore depth, already resolved on every point call | a wave cannot stand taller than γ·depth |
| 3 | absolute pair (26 → 46 ft) | only when we know nothing about the spot |

**Tier 2 measured across ALL 1,773 catalogue spots — it ORDERS CORRECTLY:**
```
Cocoa Beach 15.1 ft < Jeffreys 23.0 < Trestles 23.8 < Uluwatu 24.3 < Pipeline 28.4
          < Waimea 30.5 < Nazare-Norte 53.7 < Mavericks 56.6 < Jaws 62.7 < Nazare 64.0
```

⚠️⚠️ **BUT ITS TAIL IS JUNK, so it is bounded at BOTH ends and fails OPEN.** 39.9% of spots have no
`break_depth_m` at all, and where the 15-arcsec grid cannot resolve a reef pass it samples the deep
water outside it: **Teahupo'o reads 273 m deep ⇒ a 699 ft "capacity"** (p90 = 42.9 m, max 783 m).
Clamped at 30 m (deeper than any real break: Nazaré 25.0, Jaws 24.5, Mavericks 22.1) and floored at
4 m so a shallow-or-wrong reading can never crush an ordinary day.

⚠️ **The absolute pair is deliberately LATE (26 ft)** because tier 2 is missing on real big-wave
spots — **Puerto Escondido-Zicatela, Todos Santos, Dungeons, Mullaghmore, Punta de Lobos and
Cloudbreak all lack `break_depth_m`**. Where the spot cannot be identified, under-penalising is the
fail-safe direction.

### Result — same engine, same day, each spot on its own bathymetry
| spot | ceiling | 12 ft | 20 ft | 25 ft | 35 ft | 50 ft |
|---|---|---|---|---|---|---|
| Mavericks (22.1 m) | 45.2 ft | epic | epic | epic | epic | **epic** |
| Nazaré (25.0 m) | 51.2 ft | epic | epic | epic | epic | **epic** |
| Jaws (24.5 m) | 50.2 ft | epic | epic | epic | epic | **epic** |
| Pipeline (11.1 m) | 22.7 ft | epic | epic | epic | fair | poor_fair |
| **Cocoa Beach (5.9 m)** | 13.1 ft | epic | **fair** | **poor_fair** | poor_fair | poor_fair |

**Blast radius on the live catalogue: 0 of 428 spots** (global max today 3.73 m). It fires on storm
swells, not ordinary days — which also means it cannot be A/B'd against live data until one arrives.

### ★★ CALIBRATION REJECTED MY FIRST INSTRUMENT (again)
I tried `surf_spots.difficulty` as the capacity signal and **calibrated it against known answers
before trusting it. It failed:**
* **`Mavericks`, `Jaws (Peahi)`, `Waimea Bay`, `Pipeline` → all NULL.** `Todos Santos` → `intermediate`.
* `expert` is populated with **Skeleton Bay, La Gravière, Teahupo'o, El Quemao** — expert because they
  are **hollow and shallow**, not because they are big.
⇒ **`difficulty` measures DANGER, not SIZE CAPACITY.** (It is also case-inconsistent —
`expert`/`Expert`, `advanced`/`Advanced` — the same trap as the `Mavericks`/`mavericks` identity bug.)

---

## 3. ✅ THE WEATHER SIM — two fixes

### 3a. `simulate_weather_change` gated the ARITHMETIC, not the mutation
The tool returned `Unauthorized` **before computing anything**, so its own advertised purpose —
*"simulates how changing weather and swell vectors will alter wave quality and surf height"* — was
unreachable without ALSO writing `condition_reports` (read by 4 backend routes + 6 frontend
surfaces) and staging an override that **outranks the live forecast** on every later read.
★ **Its docstring already said "must be `admin` to mutate" — the code was stricter than its own
contract.** Computing is pure, so a non-admin now gets the full answer with `persisted: false` and
provably stages nothing. Every write stays exactly as gated as before.

### 3b. `size_verdict` + `rideable_ceiling_ft`
A low score from 40 kt of onshore slop and a low score from 35 ft of unrideable closeout are
different answers to *"should I paddle out?"*. Closed vocabulary (pinned by test):
`within_range` · `at_the_upper_limit` · `too_big_to_ride`.

⚠️ **The running MCP server process holds the pre-change module** — these need a host restart to be
visible through the MCP tools. Verified instead by running the real tool functions end-to-end in a
fresh process with the live catalogue (§6).

---

## 4. ★★★ NEW MEASUREMENT — WIND-SEA CONTAMINATION, LIVE, WORSE THAN PREDICTED

The audit predicted this from a synthetic scenario. **I measured it against production, per spot,
at `2026-07-28T16:00Z`.** The transform is handed `layer="waves"` (TOTAL Hs) with a blended period:

| spot | total Hs / Tp | swell_1 Hs / Tp | wind_waves Hs / Tp | ww energy | SERVED → SWELL-ONLY |
|---|---|---|---|---|---|
| **Ocean Beach SF** | 1.579 / 12.0 | 0.637 / 14.1 | 1.628 / 6.75 | **86.7%** | **7.25 ft `fair_good` → 3.53 ft `poor_fair` (+105.4%)** |
| **Mavericks** | 1.661 / 10.9 | 0.626 / 15.7 | 1.572 / 6.75 | **86.3%** | 6.95 → 3.88 ft (**+79.4%**) |
| Bondi | 1.532 / 11.1 | 0.951 / 10.7 | 1.280 / 5.84 | 64.4% | 4.40 → 2.96 ft (+48.3%) |
| Lower Trestles | 0.901 / 16.7 | 0.694 / 16.7 | 0.170 / 1.87 | 5.7% | 5.56 → 4.44 ft (+25.2%) |
| Cocoa Beach Pier | 0.367 / 7.7 | 0.320 / 7.7 | 0.130 / 2.31 | 14.2% | 1.86 → 1.67 ft (+10.9%) |
| **Hossegor** | 0.571 / 7.0 | **0.664** / 8.3 | 0.284 / 5.42 | 15.5% | 1.66 → 2.69 ft (**−38.1%**) |

★ At Mavericks **86% of the wave energy is 6.75-second chop arriving 83° off the groundswell**, and
the model shoals all of it as if it were the 15.7 s swell.

⚠️⚠️ **IT IS SIGNED BOTH WAYS, AND THE PARTITIONS DO NOT RECONCILE WITH THE TOTAL.** At Hossegor
`swell_1` (0.664 m) **exceeds** the total Hs (0.571 m), which is not physically possible in
quadrature. **A naive swap to `swell_1` is therefore NOT safe** — it needs a reconciliation guard.
This is new; the audit assumed the swap was pure plumbing.

### ★★ AND THE PARTITION-AWARE MACHINERY IS ALREADY BUILT — AND COMPLETELY DARK
`surf_rating` has `dominant_swell_period`, `effective_swell_exposure` and `sea_cleanliness`, all
tested and documented. **`partitions=` is supplied by ZERO callers — backend or frontend.** The
rating half of this fix is written and simply not connected.

⛔ **DO NOT wire it into the sim alone.** The sim's contract is to *predict the app, not
out-calibrate it* (`test_local_size_reference_follows_the_production_flag`, and the `parity` block).
Wiring must happen in the SHARED chain (`spot_ratings` / `point_resolution`), behind a flag.
⚠️ Cost: `swell_1` + `wind_waves` are 2 extra point resolutions per spot. The 1-CPU serve box has a
**three-incident melt history** at 7.5-8.6 s/req — this must be costed against precompute, not
bolted onto the live lane.

---

## 5. ★★ QUEUE #9 CONFIRMED AND WORSE — 2-SECOND CHOP RATES "GOOD"
Measured (4 ft surf, light offshore, `period_quality` floors at 0.40):

| Tp | 2 s | 3 s | 4 s | 6 s | 8 s | 11 s |
|---|---|---|---|---|---|---|
| score | **76.0 `good`** | 76.0 | 76.0 | 76.0 | 81.3 | 89.3 `epic` |

★ **This is the SAME structural defect for the third time**: an additive term with a generous floor
cannot veto. `wind_gate` fixed it for wind, `oversize_gate` for size — **period still has it.** The
fix is the same shape: a multiplicative veto below the surfable period limit. Deliberately NOT
stacked into this session — a third rating change would have shipped with less verification than the
first two.

---

## 6. HOW THIS WAS VERIFIED (and one harness that was wrong first)

⚠️ **My first A/B harness could not have failed.** I built "two engines" by `importlib.reload`-ing
the module under different env values — but `oversize_gate` reads `os.environ` **inside the call**,
so both objects read the same flag. The delta column printed `+0.0` everywhere, including at 35 ft
where the unit test proved the gate bites. **Caught only because I printed a delta column.**
★ The §0 lesson from the previous handoff, in a new costume: *a check whose structure prevents it
from going red is not a check.* Fixed by toggling the flag AROUND each call, with two asserts that
fail loudly if the harness ever goes inert again.

Verified: 50 backend rating tests · 45 JS mirror tests (goldens shared with the backend) · 28 sim
tests · full suites both sides · live production `/spot-ratings` (428 spots, 6 regions) · live
`/api/weather/point` per layer · geometry resolved over all 1,773 catalogue spots · sim end-to-end
through the real tool functions with the live catalogue.

---

## 7. ⛔ THE QUEUE — updated

1. ✅ **SIZE GATE** — done this session, spot-aware.
2. ★★★ **REFRACTION / SHELTERING (Kr)** — unchanged; ±1.5 ft, **signed** (Trestles 0.755, Mavericks >1).
3. ★★★ **SWELL PARTITION** — §4. Now MEASURED live (+105% at Ocean Beach SF) and **re-scoped**: the
   rating half is already written and dark; the height half needs a reconciliation guard because the
   partitions can exceed the total; and the cost lands on precompute, not the live lane.
4. ★★ **DEPTH-DEPENDENT HEIGHT** — the enabling change for tide/moon.
5. ★★ **TIDE** (needs #4) · **MOON** (`tide.py:76-81` divides out spring-neap).
6. ★★ **Shore normals** — 434 spots with none.
7. ★★ **QUANTILE-MAP the offshore input** — still blocked on the residual archive.
8. ★ **Delete or fix `SURF_V3_KOMAR=0`.**
9. ★ **PERIOD FLOOR** — §5, confirmed at 2 s. Cheapest remaining item; the shape is already proven twice.
10. **NEW** ★★ **Backfill `break_depth_m`** — 39.9% missing, and missing on precisely the big-wave
    spots that most need tier 2. Also worth bounding the absurd tail at the ASSET level (Teahupo'o
    273 m), which would let the oversize clamp be tightened.

### Carried over, unchanged
* 107 VARIANT duplicate pairs (admin Duplicate Review panel) · calibration residual archive
  (all five bands still under the 30-row / 10-buoy gate) · 155 misplaced spots · FR/ES/UK expansion.
* ⚠️ `weather_sim_mcp.py` is now **789/800** — the next change to it needs an extraction first.
* ⚠️ `test_media_privacy_contracts.py::test_protected_grom_media_...` fails on `dev`, **pre-existing**
  (confirmed by stashing all of this session's changes). Spawned as its own task — it asserts a
  private-media authorization call that the grom-media route no longer contains, so it is either a
  stale contract test or a real regression of the 2026-07-25 security cutover.
* ⛔ The map still has been eyeballed at one viewport/zoom only; zoom ladders need `zoomlab.js`, run alone.
