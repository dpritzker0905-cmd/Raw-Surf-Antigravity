# 2026-11-11: Fable, the live guardrail's nearshore reach, statistics V2 and controls

Session: the Fable repair lead. The task came from the coordinating session after the owner's 06:48 EST "keep moving on
best path toward state of the art". Branch `fable/guardrail-nearshore`, cut from #773 (`fable/nearshore-truth-arm`)
with `origin/dev` merged. Offline only: no Render, no storage writes, no secrets.

## What the live guardrail could and could not see

#773 already gives `flag_guardrail.py` the `hb_proxy` quantity through `evaluate()`: WORSE on either quantity strikes.

What it did not do was say when a flag cannot be seen. `eval_replay.replay_arm` does not refuse the `UNREPLAYABLE`
flags. So `SURF_NEARSHORE_MOP`, `SURF_BIGHT_HS_CONSENSUS` and `RATING_OBS_GATE` ran as the baseline, read NO_CHANGE and
looked watched. The same holds for flags confined to another surface: the hub, the map band, the consensus build and
#772's callers.

Every guarded flag now carries a COVERAGE class:

| class | meaning | flags on dev |
|---|---|---|
| replay | scored by evidence (both quantities) | SURF_TIDE_DEPTH, SURF_EXPOSURE_RECONCILED |
| rating | moves the quality score only; no observed rating exists | RATING_LOCAL_SIZE, RATING_BREAKER_TYPE |
| volume | judged by its send cap | ALERTS_FORECAST_WINDOWS |
| blind | the replay cannot exercise it | SURF_NEARSHORE_MOP, SURF_BIGHT_HS_CONSENSUS, RATING_OBS_GATE, SPOT_HUB_RATE_ONE_SPOT, CONSENSUS_DIRECTION_VECTOR |

Pre-declared for open PRs:
- `SURF_SEA_INPUTS_EVERY_CALLER` (#772) and `RATING_BAND_ONE_CHAIN` (#776) are blind;
- `SHORE_NORMAL_MOP_CALIBRATED` (#780) is replay.

A test fails when a newly guarded flag declares nothing.

**So only 2 of the 10 guarded flags on dev can be turned off by evidence today.** Making the blind ones visible needs
surface replay arms and MOP forecast archives (see "Next").

## Statistics: measured before changing

`scripts/guardrail_null_rate.py` simulates synthetic AR(1) loss differentials with a single member and three pairs per hour.
- Grid: rho 0 to 0.95; T of 28, 56 and 84 hours; 400 simulations per cell.
- Nulls: no change, and ON worse by exactly the margin.
- Power is measured at 0.03 m of harm.
- Rates are per RUN: an untestable run cannot kill a fix.
- Evidence: `evidence/2026-11-11-guardrail-null-rate.json`.

**The old rule's false-WORSE rate, T 28** (the live window is a 14-day window at 12 h steps):

| rho | 0 | 0.5 | 0.7 | 0.9 | 0.95 |
|---|---|---|---|---|---|
| false-WORSE | 1.3% | 5.2% | 9.5% | 21% | 28% |

The researcher's "bootstrap primary" (circular block, Politis-White block) measured the same: 22% at rho 0.9.
Doubling the block did not help. So it was not adopted as written.

**Adopted** (Coroneo & Iacone 2020, JAE; Lazarus, Lewis, Stock & Watson 2018, JBES):
- The decision is the fixed-smoothing DM: an EWC long-run variance with nu = floor(0.4 T^(2/3)) and Student-t(nu).
- It must agree with the circular-bootstrap CI, using the Politis-White / Patton-Politis-White block.
- The block is a pure-Python port of `arch.bootstrap.optimal_block_length`. It equals arch 8.0.0 to 7e-15 on 24 AR(1)
  series.
- The t CDF equals scipy to 1e-15.
- NW-HAC DM is still reported as secondary, with its lag at least the block.
- MSE and CRPS are reported beside MAE. For a point forecast, CRPS equals MAE.
- Kill switch: `GUARDRAIL_STATS_V2=0`.

**The new rule's rates, T 28 (old rule in brackets):**

| rho | 0 | 0.5 | 0.7 | 0.9 | 0.95 |
|---|---|---|---|---|---|
| false-WORSE | 1.0% (1.3) | 2.8% (5.2) | 5.5% (9.5) | 12% (21) | 20% (28) |
| power at 0.03 m harm | 66% (79) | 41% (58) | 35% (53) | — | — |

At T 84 the power cost is small: rho 0.5, 79% against 83%.

**Limits:**
- At rho >= 0.9 power is about equal to the false rate, so no test discriminates there.
- An effective-sample guard was tried and rejected: it moved the rate by less than 5 points, because EWC with few
  cosines cannot see the slow drift.
- **Where the real series sit:** every recorded member chose block 4, the floor, so their first insignificant lag
  was at most 4 at 6 h steps. That means rho_6h is about 0.7 or less, and rho_12h about 0.5 or less. H1/10 reached 7,
  about 0.85. The live guardrail is therefore in the regime where V2 holds its size.

## Controls (pinned)

Fixture: `tests/fixtures/guardrail_controls_2026-11-11.json`.
- **Negative control (#781): no exposure.** As a candidate, hb_proxy gain is -0.103 m, CI [-0.128, -0.084]. The
  guardrail strikes it, then disables it after 24 h.
- **Positive control (#773): H1/10.** Gain +0.265 m, CI [0.232, 0.294]. The guardrail leaves it alone.
- **Synthetic analogues:** built at the recorded effects and 1.5x their recorded uncertainty, AR(1) rho 0.7, 5 seeds.
  They give the same verdicts.

## Open, named

- **hs_station prefers no exposure.** In the negative-control run it reads today's exposure as WORSE than none
  (0.027 m). Because `combine()` takes WORSE from either quantity, a flag correct on breaking height can be struck by
  `hs_station`. This needs its own look before any exposure-class flag goes live.
- **Recommended, not changed:** a 6 h step for the live window, which would give T about 56 (power at 0.03 m harm:
  65% against 41% at rho 0.5). It doubles the job's range downloads against its 900 cap.
- **Not used: LongCat submit, SubQ and Reflection.** The paid calls wait for David's per-payload word in this
  session; Reflection's server limits it to requests the user makes by name.

## Next

1. Surface replay arms: replay the hub (`spot_conditions`) and the band (`band_chain`) heights at the nearshore anchors
   through `hb_proxy`, once #772 and #776 land. That turns three blind flags into replay flags.
2. `SURF_NEARSHORE_MOP`: replay it from the `mop-nearshore-ingest.yml` run artifacts (actions:read, no Render).
3. Decide the `hs_station` / `hb_proxy` disagreement on exposure-class flags (DECISIONS-level: coordinator and David).
