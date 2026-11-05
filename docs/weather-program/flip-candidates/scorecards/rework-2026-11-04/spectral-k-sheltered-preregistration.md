# Pre-registration: SURF_SPECTRAL_K, sheltered scope (rework of #706), 2026-11-04

Written and committed BEFORE any score of this variant exists. Author: claude, branch
`claude/rework-spectral-k-sheltered` (dev df713415 + #706 aeadafb). Brief: the lead's rework task after round 7
(PR #722). The owner approved scoring on GitHub Actions ("Yes", 2026-11-04).

## Why a rework

Round 7 (`../round7/history-gate-2026-11-04.json`): SSK hs_station pooled +0.015 m [two-way -0.008, 0.043], FAIL;
hb_proxy worse after Holm in W26, W4 and the Bight. On top of the Bight Hs consensus (BHC) the combined arm fell from
+0.124 (BHC alone) to +0.066, and the per-station gain dropped at EVERY K station in the Bight (103p1, 153p1, 201p1,
262p1, 264p1, 284p1). Diagnosis: the one-point K's `sea_et` carries no island sheltering (the #706 split check: x1.4-1.7
over-transfer at San Diego), and its apparent gain compensated the chain-wide low bias that BHC now fixes. The one
place #706's fresh window showed transfer physics rather than cancellation was **Avila (285p1)**, a HEADLAND-sheltered
buoy outside the Bight: served bias +0.473 -> -0.025.

## The variant (one spec, no tuning)

`SURF_SPECTRAL_K=1` with the new `SURF_SPECTRAL_K_ALL_SPOTS` at its default `'0'` (sheltered scope): K applies only at table entries
that are

1. OUTSIDE the Bight polygon (`bight_hs_consensus.inside_bight` at the entry's MOP point), and
2. HEADLAND-SHELTERED: K's Hs ratio for a reference open-ocean swell (1 m, Tp 14 s, from 290 deg, JONSWAP 3.3 x
   cos^2s s = 25) against flux shoaling alone from 500 m to the MOP depth is below **0.5**
   (`spectral_k_serving.shelter_ratio`, `SHELTER_MAX_RATIO`).

Both inputs are geometry (CDIP's published ray coefficients and the polygon); no truth was read to set them. The 0.5
threshold means "the headland removes more than half the height of the dominant NW groundswell". Computed on the
committed table (50 entries) before scoring, the rule selects exactly:

| entry | MOP point | ratio (290 deg, 14 s) |
|---|---|---|
| Rodeo Beach (spot) | 37.829, -122.548 | 0.47 |
| Fort Point (spot) | 37.809, -122.481 | 0.26 |
| Pismo Beach Pier (spot) | 35.133, -120.656 | 0.45 |
| 285p1 Avila (station) | 35.164, -120.737 | 0.36 |

Nearest misses (not in scope): Steamer Lane 0.53, Cayucos Pier 0.63, Davenport 0.67. Every Bight entry is out of scope
by rule 1, whatever its ratio. `SURF_SPECTRAL_K_ALL_SPOTS=1` restores #706's scope (scored alongside, as the reproduction
of round 7's failing arm; it is NOT a candidate).

**On top of BHC:** every in-scope point and the read points they use (central 35.50 N 122.25 W, bay 37.25 N 123.50 W)
lie outside the BHC polygon, so BHC is the identity on every row this variant moves. The replay therefore needs no
EURO substitution for the candidate; stated, not assumed: the gate reports which stations moved.

## Scoring (binding)

- Harness: `backend/scripts/eval_harness.py run` on `backend/scripts/eval_harness_stations_ca.json` (8 CA CDIP
  nearshore + 2 NDBC, includes 285p1), leads 24/48/72, 6-hourly targets, GFS-Wave + pgrb2 wind from the AWS archive,
  pygrib (production parity), truth = CDIP realtime/archive + NDBC realtime/historical.
- Windows: **W1** 2024-12-01..12-28, **W4** 2025-10-01..10-28, **W26** 2026-10-17..10-30 (recent 14 days, settled).
- Arms: `SURF_SPECTRAL_K=1` (candidate, scope sheltered) and `SURF_SPECTRAL_K=1,SURF_SPECTRAL_K_ALL_SPOTS=1` (reference
  reproduction, not a candidate).
- Gate: `backend/scripts/rework_gate.py`: pooled D-066 two-way block x day CI on hs_station (primary), >= 14 UTC days,
  unmoved stations left out; PASS = lower bound > 0 AND no season/region stratum worse after Holm AND the one-sided p
  survives Holm across the candidate arms. Advisory: hb_proxy (the depth-limited proxy), station-cluster CI.
- Controls on served pairs: null REFUSED, x0.8 PASS, x1.25 FAIL, else every verdict INVALID.
- Expected scope: ONE station (285p1), ONE block, so the binding CI is the day-factor t interval. Stated in advance:
  a pass is a pass at Avila, not a California claim.

## Outcomes, decided now

- PASS: `SURF_SPECTRAL_K` ships default ON (scope sheltered) with the `'0'` kill switch, registered in
  `runtime_flags.GUARDED`, SCOREBOARD row, DECISIONS entry, log, ledger fragment. Serving cost (#706 section 4) is
  limited to the 3 in-scope spots.
- FAIL or REFUSED: stays OFF; this PR then records the result and the diagnosis.
