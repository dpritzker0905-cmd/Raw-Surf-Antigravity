# 2026-11-22 wind long-range v2: build PR 1 (session `local_318ba0a1`, branch `claude/wind-long-range-v2-build`)

Task (director): build, dark, with tests and floor fragments, what the frozen registration needs; nothing runs before the owner's word. Registration `gates/wind-long-range-v2.md` (gate PASS 8ea5fd219) is not edited. Findings go in `gates/wind-long-range-v2-amendment-1.md`.

## Built (backend/scripts, all `wind_lr2_*`)
`runs` (FIT 4-day 00Z list, TEST 90 runs, missed-freeze rule, bins, centres, regions), `collect` (AIGEFS/GEFS/IFS ENS member readers, drop-never-fill, shard, no network at import), `truth` (FIT/TEST truth sources, snapshots, pairing), `clim` (ERA5 by-hour interpolation, CDS request, attribution), `fit` (ridge toward the raw pool, leave-block-out CV, lead interpolation, GF, sha256 freeze), `stats` (moving-block bootstrap, Holm, F1 20 / F3 6 / F1c, gatekeeping, floors, control primitives). 42 tests, none touches the network.

## Found while building (listings only, no forecast values)
- GEFS 0.25 deg member files stop at f240; past that only 0.5 deg (`pgrb2ap5`), gust in `pgrb2bp5`. Amendment A1.
- No `CDS_API_KEY` in this session, and `10m_wind_speed` in the by-hour ERA5 product is unverified. Amendment A2: collection must not start until that is checked; a failure needs a further amendment.

## Not built (second build PR, before any freeze): amendment A5.
## Record: nothing collected, fitted or scored; no served number changed; no secret value in any file.

## Build PR 2 (branch `claude/wind-long-range-v2-build2`, stacked on #1139)
Added `wind_lr2_geo` (ETOPO mask, no-land-crossing, marine-exposed rule), `wind_lr2_rows` (row table, imported `wq*wg`, native changes, fit rows), `wind_lr2_score` (F1/F3/F1c, G4 seam and bin edges, G5 halves by run, G6 regions, controls on rows, the one scored decision with floors/freeze/disjointness), `wind_lr2_run` (pair, fit, freeze, score) and three dispatch-only workflows (collect, snapshots, analyse), each requiring `owner_word_ref`. 19 tests (synthetic rows with a known answer: skilled arms PASS and all controls hold; short collection VOID; freeze mismatch VOID; unskilled arms FAIL and open the CLIM_SERVE gate; a leaky shuffle voids). Readings and remaining gaps: amendment A5/A6. Nothing run against real data.

## Gust truth build change (amendment G1, PR on top of #1142)
Changed the CODE, not the registration: `wind_lr2_rows.station_truth_fn` now builds the gust truth as amendment G1 fixes it: the 6 h window max of NDBC GST (each hour the report nearest the hour within +-10 min, all six present, none filled), adjusted to 10 m by the log law, only at NDBC stations with 1 m <= z <= 50 m. ASOS stations, and NDBC stations outside that height range, carry NaN gust, so they are outside the GF fit and the gust score. This removes `gust_absent_is_wind` (an absent ASOS gust imputed as the wind, which censored gust truth low) from the v2 path; the older `wind_lr_obs.gust_window` is untouched (the #939-era scorers still use it). On the GF mismatch the gust-labels lane found: registration section 2 said "member median of the arm's gust"; `wind_lr2_fit.fit_cell` fits `median(observed gust / calibrated speed)`. Amendment 1 A4 had already changed the REGISTRATION side to the code's form (one definition for every arm, AIGEFS included), so the code stays and the doc was already the side that changed; amendment G1 now fixes which observed gust it is. 8 tests in `test_wind_lr2_gust_truth.py`.
