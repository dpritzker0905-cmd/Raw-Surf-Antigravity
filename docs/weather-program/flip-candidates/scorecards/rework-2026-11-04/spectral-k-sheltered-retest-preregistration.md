# Pre-registration: SURF_SPECTRAL_K sheltered scope, FRESH-WINDOW re-test (#727), 2026-11-05

Written and committed BEFORE any score of these windows exists. Author: claude, on #727's branch
`claude/rework-spectral-k-sheltered`. It replaces the 2026-11-04 scoring (`spectral-k-sheltered-preregistration.md`,
Actions run 41939357144) as the binding test for this PR. That run is not evidence for a flip, for four reasons:

1. **The scope was chosen after looking at the data.** Avila was singled out from round-7 and #706 results that had
   already been inspected.
2. **Its windows overlap earlier tests.** W1 = 2024-12 and W4 = 2025-10 are round 7's windows; W26 sits inside round
   7's 2026-10-06..31.
3. **The PASS was too thin.** It rested on 168 moved pairs at one buoy (285p1), over 14 days and 1 spatial block, with
   the days treated as independent.
4. **The harm at Rodeo was on record and was called "advisory".** Rodeo's breaking-height proxy (hb_proxy at 142p1)
   was worse (−0.233 m; W4 worse after Holm).

Until this test passes, the flag stays `'0'`.

## The candidate (unchanged, no tuning)

The code at this commit runs with `SURF_SPECTRAL_K=1` and `SURF_SPECTRAL_K_ALL_SPOTS='0'`. It applies the 2026-11-04
physical rule exactly as written:

- the point is OUTSIDE the Bight polygon;
- K's Hs ratio for a 1 m, 14 s, 290° reference swell (flux shoaling from 500 m) is below **0.5**.

Neither the threshold nor the rule changes in this re-test.

## The evaluation set, fixed by that rule (geometry only, computed before scoring)

Evaluated = every station in `backend/scripts/eval_harness_stations_ca.json` whose rows the candidate can move. This was
computed from the committed K table and the polygon, with no truth read:

| quantity | station | why it moves | K entry (shelter ratio) |
|---|---|---|---|
| hs_station | 285p1 Avila | buoy K entry SL145 in scope | 0.365 |
| hb_proxy | 142p1, anchored at Rodeo Beach | spot entry MA053 in scope | 0.467 |
| hb_proxy | 285p1, anchored at Pismo Beach Pier | spot entry SL093 in scope | 0.454 |

- Every other station's anchor is either out of scope (Bight) or has no entry.
- **Fort Point (SF069, 0.256) has no truth station, so it is not tested.** It is stated here rather than inferred.
- If any other station moves, the gate reports it and it is scored like the rest.

## Windows (fresh: none in rounds 5-7, W26, or #706)

Used before and excluded:

| period | used by |
|---|---|
| 2024-12 | round 7 W1 |
| 2025-03 | round 7 W2 |
| 2025-07 | round 7 W3 |
| 2025-10 | round 7 W4 |
| 2026-10-06..31 | round 7 W26 |
| 2026-10-06..15 | #706's window |
| 2026-10-17..30 | the 2026-11-04 W26 |

The scored windows:

| tag | targets (6-hourly, leads 24/48/72 h) | truth expected (CDIP inventory 2026-11-04, round 7) |
|---|---|---|
| **F1** | 2025-01-15T00Z .. 2025-02-28T18Z (45 days, winter) | 142p1 historic; no 285p1 (deployed 2026-09-21) |
| **F2** | 2025-11-01T00Z .. 2025-12-15T18Z (45 days, early winter) | 142p1 historic; no 285p1 |
| **F3** | 2026-09-22T00Z .. 2026-10-05T18Z (14 days) | 285p1 realtime from 2026-09-21T20Z; 142p1 only 10-02..10-05 |

- **F3 is the only fresh Avila data that exists.** It ends the day before every earlier Avila window begins. Weather
  persistence across that boundary is a stated limit.
- If 285p1 yields fewer than 14 distinct UTC target days, hs_station is not computable. The verdict is then REFUSED and
  the flag stays OFF. No window is extended or added after scoring.

## Runner

- `.github/workflows/rework-score.yml`, with the declaration `spectral-k-sheltered.score.json` (`"protocol": "storm-v1"`).
- Per window, `eval_backfill.py prefetch` (byte-range NOAA AWS archive), then `eval_harness.py run`:
  - pygrib + pgrb2 wind (production parity);
  - truth = CDIP/NDBC through `eval_reference.fetch_station` (realtime, then archive);
  - two arms only: served (= kill switch, `'0'`) and `SURF_SPECTRAL_K=1`. #706's all-spots arm is not rerun.
- Public data only. The live Raw Surf backend is never called (the harness's network guard refuses it).

## Metrics

- **Gain** per pair: d = |served − obs| − |candidate − obs| in metres (positive = candidate better), on:
  - `hs_station`: the buoy-depth Hs instrument vs the buoy;
  - `hb_proxy`: the anchor spot's breaking height vs the buoy-derived depth-limited proxy.
- **Reported** for each: pooled, per spot, per band, per season; bias and MAE before → after.

## The gate: `backend/scripts/rework_storm_gate.py`, protocol `storm-v1`

**Interval.** D-066's two-way bootstrap (`eval_twoway`), with one change: the independent-day factor becomes a
**moving block of 5 consecutive UTC days** (storm block).
- Spatial blocks: complete linkage at ≤ 100 km, unchanged from D-066.
- Day blocks are drawn within each window, ceil(n / 5) per window.
- Interval = mean ± t(0.975, G − 1) · √(G / (G − 1)) · SE, where G = number of storm blocks drawn.
- SE = the LARGER of two bootstrap SDs (same replicate count):
  - moving blocks;
  - the window's own non-overlapping 5-day blocks.

  A moving block alone under-covered dependence that comes in whole 5-day chunks: a sign-flip null falsely passed
  10.5% in the build.
- SE is then inflated by √((1 + r₁) / (1 − r₁)), where r₁ = the lag-1 autocorrelation of consecutive non-overlapping
  5-day block means (clipped to 0..0.9).
- At least 14 distinct UTC days are required, else REFUSED.

**PASS requires ALL of:**
1. **Gain:** pooled hs_station storm-block CI lower bound > 0.
2. **Breaking height not worse:** pooled hb_proxy one-sided p_worse ≥ 0.05.
3. **No stratum worse:** Holm (α 0.05) on "worse" across every computable stratum of BOTH quantities finds nothing.
   The strata are:
   - spot = each moved station;
   - lead band = 24 / 48 / 72 h;
   - height band = observed < 1 m / 1-2 m / ≥ 2 m;
   - season = F1 / F2 / F3.
4. **Rodeo not worse (named, UNADJUSTED):** hb_proxy at 142p1 one-sided p_worse ≥ 0.05. Rodeo is singled out because
   its harm is already on record.
5. **Controls behave** on each binding quantity, on the reference's own moved-station pairs. Otherwise the verdict is
   INVALID.
   - identical forecast → REFUSED;
   - ×0.8 error → PASS;
   - ×1.25 error → FAIL;
   - **sign-flip null**: each (spatial block, fixed 5-day block) of the REAL candidate gains flipped at random, 200
     sets → false pass ≤ 5%.
6. **Synthetic calibration holds** (`calibrate()`, seeded), else INVALID.
   - Layouts: 14 days with 1 block, and the scored shape (45 + 45 + 14 days) with 2 blocks.
   - Binding nulls must falsely pass ≤ 5% on EVERY layout: iid day shocks, AR(1) ρ 0.6 day shocks, AR(1) ρ 0.6
     block × day shocks, and a mixed null.
   - A 4-null-SD effect must pass ≥ 80% of the time on the full fresh layout.
   - On the 14-day layout, power is reported only. 14 days are 3 storm blocks, and low power can only make a PASS
     harder.
   - Measured at this commit (300 sets, seed 20261105):

     | layout | binding false pass | power |
     |---|---|---|
     | 14 days, 1 block | ≤ 2.0% | 79% (reported) |
     | full fresh, 2 blocks | ≤ 3.0% | 96% |

   - How L = 5 was chosen, on synthetic data only and before any score:
     - L = 4 reached 83% power at 14 days, but its mixed ρ 0.6 null falsely passed 5.7%;
     - L = 3 falsely passed up to 7.3%;
     - false-pass control was preferred over power.

**Stated limit.** AR(1) ρ 0.8 nulls (about 9-day correlated stretches) are advisory. A 3-5 day block cannot carry
that much persistence. They measured 0.7-6.0% at this commit, and up to 17% with a moving block alone.

## Outcomes, decided now

- **PASS:**
  - `SURF_SPECTRAL_K` code default `'1'`, with `'0'` as the kill switch;
  - added to `runtime_flags.GUARDED` (so `flag-guardrail.yml` watches it), with `_RATING_FLAGS` and every lane
    deferring with `''`;
  - a SCOREBOARD row at the bottom dated 2026-11-05, a DECISIONS entry, the log and a ledger fragment.
  - The claim is limited to what was tested: hs at one buoy (Avila) and breaking-height proxies at Rodeo and Pismo.
    It is not a California claim.
- **FAIL, REFUSED or INVALID:**
  - the default stays `'0'`; the result and the reasons are recorded in this PR and the log;
  - the bar does not move, and nothing is rescoped after seeing the result. A new scope would need a new
    pre-registration and new data.
