# 2026-11-15 Fable: one arm added to the 11-30 bias-correction test (rule only, nothing computed)

Session: Fable repair lead (`e372475c`). Branch `fable/idw-bias-arm-prereg`, cut from `dev` `b01a1a74c`.
Changes no served number, no flag, no workflow, no code. This file is a rule.

## 2026-11-15 23:00Z Why this exists, and when it was added

The director relayed an amendment to Brief 8 from the senior research lead (2026-11-15 17:57 EST; the owner approved the
plan at 16:14 EST, "Yes to all", as relayed by the director; not typed in this session). Brief 8 ranks the bias
correction on the hole-free copy of the OCF report, scorable 2026-11-30. The amendment adds ONE arm.

**This arm was added on 2026-11-15, after the other arms were registered** (`log/2026-11-13-claude-move4-prereg.md`,
R1 to R4). It is registered before any row with a target time on or after 2026-11-16 has been read by anyone in this
lane, and before the 11-30 report exists.

**What prompted it (reported to me, not measured by me, and not on forecasts):** the research helper's pre-registered
work on the lead-0 wave ANALYSIS at 16 offshore buoys. A per-buoy mean offset gained 0.048 m and beat all 1,000
station-label swaps. Predicted for a held-out buoy by inverse distance from same-coast neighbours, 76% of it was kept:
0.036 m [0.032, 0.040], with 0.1% of null draws reaching that. I have not read the helper's script or its parameters.

**What I know that could bend this rule (disclosed).** I know the result above, so I expect the arm to help offshore.
I have not seen any 24/48/72 h result for it. Every parameter below is my choice, fixed now without sight of the
helper's values; if the helper's differ, that is recorded as a difference, and this rule is not changed to match after
2026-11-16 00:00Z.

## The arm: `ocf_idw`

The same form as `ocf_region` in `backend/services/weather_pipeline/skill_ocf.py`; only the bias estimate differs.

- **Pairs, split, members, leads:** exactly as `ocf_report`: (buoy, target hour, lead) where all three members were
  scored; held out by time (the last `HOLDOUT_DAYS`); leads 24, 48, 72 h; `HOLE_BUOYS` excluded from every pair, so
  from the fit and from the score (pinned by the test in #932).
- **Per-buoy training bias.** For each member, lead and buoy: the mean of (forecast - observation) over that buoy's
  TRAINING pairs. A buoy with fewer than 20 training pairs at that lead gives no bias and is not a neighbour.
- **Bias predicted for a held-out pair at buoy b, never from b itself.** The inverse-distance mean of the training
  biases of the OTHER buoys on b's coast (`region_of`), weight 1 / d^2, d the great-circle distance in km between
  station positions, floored at 1 km. Leave-self-out is the point: a surf spot has no buoy, so the arm is only
  useful if a neighbour's error predicts this place's.
- **Reach.** Neighbours within 500 km only. With no qualifying neighbour, the pair takes the `ocf_region` bias, and
  the count of such fallbacks is printed per lead. If more than half of a lead's held-out pairs fall back, that lead
  is reported as NOT TESTED for this arm (it would be scoring `ocf_region` under another name).
- **Forecast.** Each member minus its predicted bias, clipped at 0, then the equal mean of the three.
- **Station positions.** NDBC station metadata, pulled once and printed with the run. A buoy with no position is not a
  neighbour and its pairs fall back.

## Pass rule: the same as the other arms, no new freedom

Scored on the `without_hole_buoys` copy, on the report dated 2026-11-30 or the first one after it.
1. Better than served at EVERY lead, with the day-block interval of the MAE gain above 0 (R1's `gate_met_ci` form:
   2,000 draws over target days).
2. No region worse than served by more than 0.01 m.
3. Hole buoys excluded (above).
4. GFS stays the served source in Hawaii whatever this arm shows there.

It is ONE more arm in a table that already has five variants beside served. No correction for the extra comparison is
applied; the report must say that six variants were compared and that this one was added late.

## Controls, fixed now

- **Null (must NOT pass).** The same arm with the training biases shuffled among the buoys of each coast (seed
  20261130, 200 shuffles). If the real arm's pooled gain at any lead is not above the 97.5th percentile of the
  shuffled gains, the arm is NOT SHOWN at that lead even if rule 1 holds: a gain that survives shuffling is the
  coast mean, which `ocf_region` already has.
- **Against `ocf_region` directly.** The paired gain of `ocf_idw` over `ocf_region`, same interval. Reported, not a
  gate: it says whether distance adds anything to the coast mean.
- **Positive control (must be recovered).** +0.30 m added to every member at the buoys of one coast in the training
  rows AND the held-out rows; the arm must remove at least 0.25 m of it at each lead on that coast. If not, the run is
  INVALID and no verdict is given.

## Verdicts

PASS (rules 1 to 3 at every lead, null beaten, control recovered), NOT SHOWN, NOT TESTED (thin or mostly fallback),
INVALID (control failed). A lead under `MIN_TEST` held-out pairs prints its n and a status, never a number.

## Limits, stated now

- Shown so far on the lead-0 analysis only; not on forecasts.
- Not shown nearshore. The helper owes a gain-versus-distance-to-nearest-buoy test; until it exists, a PASS here says
  nothing about a surf spot far from any buoy.
- Offshore buoys are the truth; nothing here tests breaking height.
- One season, one hold-out week.
- A PASS is not a served change. Serving it would be a served-number change under D-065: the owner's word, a kill
  switch, a SCOREBOARD row, and the served fit would need the hole-buoy exclusion the report copy has.

## Not done here

The arm is not built. It needs code in `skill_ocf.py` (a variant and the station positions) and tests, before
2026-11-30; whose lane that file is in is the director's call. No ledger row of mine claims a result.
