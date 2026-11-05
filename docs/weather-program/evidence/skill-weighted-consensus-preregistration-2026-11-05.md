# Pre-registration: skill-weighted CONSENSUS blend ("layer 3")

Committed and posted on the draft PR on 2026-11-05, **before any scoring**. No per-pair member data were read before
this was written, because this session could not reach any (see the session log
`log/2026-11-05-claude-skill-weighted-consensus.md` §1). The scoring session must not change anything below. If
something has to change, it adds a dated amendment under §9, and the amendment applies only to a test window that
starts after the amendment is committed.

## 1. What changes, and what does not

- **Only the CONSENSUS lane** (`consensus_ingest.py`, model `CONSENSUS`) changes: the equal GFS/EURO/ICON mean of
  offshore significant wave height becomes a per-region weighted mean. Period and direction are not changed by this
  pre-registration.
- **Members stay independent and individually served.** GFS, EURO and ICON are not touched. The model picker,
  RATING_OBS_GATE's ">= 2 of 3 agree" and the member spread read the members, not the blend. D-069
  (SURF_NEARSHORE_MOP on the EURO member) is untouched.
- **ONE FORECAST COMPOSITION:** the blend is an *input* (offshore Hs) to the shared chain
  (`surf_point.estimate_surf_at` -> `surf_rating.compute_surf_rating`). It is not a second path.
- The 14-day horizon and tier contract and the ICON/EURO extension blends are not touched.
- `bight_hs_consensus.py` (GFS+EURO, w 0.5, SURF_BIGHT_HS_CONSENSUS) is a separate GFS-member input and stays as is.

## 2. Blend formula

For region `r` and member `m` in {GFS (`raw_surf`), EURO (`raw_surf:EURO`), ICON (`raw_surf:ICON`)}:

```
MSE[m,r]  = mean over fit-window pairs in r of (forecast_m - observed)^2      (leads 24/48/72 pooled)
w_iv[m,r] = (1 / MSE[m,r]) / sum_k (1 / MSE[k,r])
n_eff[r]  = number of distinct (buoy, UTC day) blocks in r with all three members scored in the fit window
lambda[r] = 0                          if n_eff[r] < 10
          = n_eff[r] / (n_eff[r] + 30) otherwise
w[m,r]    = lambda[r] * w_iv[m,r] + (1 - lambda[r]) * 1/3
w[m,r]    = max(w[m,r], 0.10), then renormalized to sum to 1   (no member is ever dropped)
blend     = sum_m w[m,r] * Hs_m
```

- No debiasing. That is a separate candidate (`skill_consensus.debiased`) and is not part of this test.
- **Regions with no evidence get no change, by construction.** Where `lambda = 0`, or outside every region box (§4),
  the weights are exactly 1/3 each: today's CONSENSUS lane, bit for bit.
- The constants 10, 30 and 0.10 are fixed here and are not tuned.

## 3. Windows (disjoint)

| Window | Target-time range (UTC) | Use |
|---|---|---|
| Fit | 2026-10-06T00Z .. 2026-11-04T23Z (30 days) | weights only |
| Gap | 2026-11-05 .. 2026-11-05 | excluded, so a lead-72 forecast issued in the fit window cannot verify in the test window |
| **Test** | **2026-11-06T00Z .. 2026-11-26T23Z (21 days)** | verdict only |

The test window is entirely in the future at registration, so nobody can have seen it. It becomes scorable when the
72 h lead has verified and the archive has settled: **on or after 2026-11-30**. Weights are frozen from the fit
window before any test row is read, and written to a JSON file whose hash is printed before scoring.

## 4. Regions

Fit and test rows: the skill ledger's scored rows (`calibration/skill/scored-*`), with the region taken from the
NDBC id prefix (`skill_consensus.region_of`). The buoy must also lie inside that region's box below; rows from buoys
whose prefix and box disagree (e.g. Caribbean 41xxx/42xxx) are dropped, and `other` rows are excluded. Serving uses
the same boxes (a grid cell outside every box gets equal weights).

| Region | Prefix | Box (lat, lon) |
|---|---|---|
| atlantic_ne | 44 | 35..46 N, 77..60 W |
| atlantic_se | 41 | 24..35 N, 81.5..72 W |
| gulf | 42 | 18..31 N, 98..81.5 W |
| pacific_ne | 46 | 30..60 N, 135..115 W |
| hawaii | 51 | 15..25 N, 165..150 W |

## 5. Metrics

- **Primary:** paired difference `d = |blend - obs| - |equal - obs|` (m), on (buoy, target hour, lead) rows where all
  three members were scored. The comparison is the blend against the current equal-weight CONSENSUS lane, on
  identical rows.
- Secondary (reported, not gating): MAE, bias and RMSE of the blend, the equal mean and each member; the same split
  for observed Hs >= 3 m (`skill_consensus.BIG_SWELL_M`), paired; per lead.

## 6. Gate (verdict rule)

- **CI:** the storm-block bootstrap from `backend/scripts/rework_storm_gate.py` (PR #727, copied with attribution):
  moving 5-day blocks over UTC days; SE = max(moving-block SE, non-overlapping-block SE) x the lag-1 autocorrelation
  inflation `sqrt((1 + rho1) / (1 - rho1))` (rho1 of the daily mean d, floored at 0); 95% two-sided; 2,000 resamples;
  seed 20261105.
- **A region is scored only if** its test window has >= 4 non-overlapping 5-day blocks with data and >= 30
  station-days. Otherwise it is UNTESTABLE and **its weights are forced to 1/3 (no change)**. This is the minimum
  block count #727 recorded as missing (a block sign-flip null is ill-posed with ~3 blocks).
- **Holm** across the scored regions (one family, alpha 0.05) for "significantly worse" (CI of mean d above 0).
- **PASS** (implement, default ON) only if all of these hold:
  1. pooled mean d is not significantly worse (upper 95% bound <= 0.005 m materiality), and
  2. no scored region is significantly worse after Holm, and
  3. the null and positive controls (§7) behave.
  Reported as BETTER if the pooled upper bound is < 0, otherwise NOT_WORSE. "Not proven better" passes (D-065).
- **FAIL:** (1) or (2) fails, so the flag ships at `'0'` with the reason recorded.
- **REFUSED:** fewer than 14 test days with data pooled, no region scorable, or a control fails. Nothing ships.

## 7. Controls (run before the verdict is read)

- **Null A (identity):** set every weight to 1/3. Mean d must be exactly 0 in every region.
- **Null B (label shuffle):** before fitting, permute the member labels at random within each (buoy, day) block, fit,
  and score on the test window. Repeat 200 times. The share of runs where some region reads significantly BETTER or
  WORSE after Holm must be <= 10% (calibration of the CI). Above that, REFUSED.
- **Positive:** add +0.30 m to ICON in one region (gulf) in both windows. ICON's fitted weight there must fall below
  1/3, and that region's blend must read significantly BETTER than its equal mean. If not, REFUSED (the gate is blind).

## 8. If PASS: implementation contract

New D-065 guarded flag `CONSENSUS_SKILL_WEIGHTS` (code default `'1'`, kill switch `'0'`, which restores the equal
mean exactly), registered in `services/runtime_flags.GUARDED` and `_RATING_FLAGS`, lanes declare `''`. The weights
JSON (from §3) is committed. Tests cover these cases:
- outside every box, the result equals the equal mean;
- `lambda = 0` gives the equal mean;
- the weights sum to 1 with the 0.10 floor;
- the members are unchanged.

Also: re-derived CI floors, a SCOREBOARD row, a DECISIONS entry, the log and a ledger fragment.

## 9. Amendments

(none)
