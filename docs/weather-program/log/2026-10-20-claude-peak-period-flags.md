# 2026-10-20 claude: peak period for the CMEMS and ICON lanes (two dark flags)

Branch `claude/peak-period-flags`, on `dev` b689984c3. Times UTC. Started from the lead session's task (forensics 2026-10-20,
ledger 1497): the surf chain is written for the PEAK period Tp, GFS serves PERPW and the ECMWF stream pp1d (peaks), but ICON
served tm10 and CMEMS served VTM10 (both the energy period Tm-1,0), and ICON's partitions served MEAN periods (mpts/mpww).

## 04:30Z: design

- **COPERNICUS_PEAK_PERIOD** (`services/cmems_period_map.py`): every CMEMS variable map is rewritten at call time,
  `("VTM10","wave_period") -> ("VTPK","wave_period") + ("VTM10","wave_period_tm10")`, in the global fetcher subprocess and
  the point/regional `_fetch_sync`; the normalizer's provenance names VTPK; `copernicus_validator` accepts a VTPK waves
  product (it required VTM10 by name: flipping without this would have rejected every CMEMS waves product). CMEMS has no
  partition peak period (only VTM01_SW1/SW2/WW), so partitions are unchanged, and that gap is reported, not hidden.
- **ICON_PEAK_PERIOD** (`services/gwam_peak_period.py`): ppts/ppww replace mpts/mpww for the partitions; the total is a
  SMOOTH blend `Tp = sum w_i Tp_i`, `w_i ~ (H_i^2 Tp_i)^p` (peak spectral density of similar-shape partitions), p =
  ICON_PEAK_PERIOD_SHARPNESS (default 2). Continuous in every input, the argmax as p -> inf, never a hard switch
  (Reflection's warning about near-equal bimodal seas). tm10 kept as `wave_period_tm10`; a missing partition leaves the
  other; both missing falls back to tm10 (counted).
- The lead's later advice (memory note 03:40Z, Reflection): feed swell and wind-sea partitions separately through
  `estimate_surf_partitioned`. That path is `SURF_PARTITIONS`, which is '0' in every lane, so served heights and ratings
  today read the TOTAL Hs and period; the ICON flag improves both the total and the partitions, so it is right either way.
- Registered: `_RATING_FLAGS` (3 entries), declared at default in forecast-ingest.yml, forecast-ingest-pilots.yml and
  precompute.yml with the same value (pinned by `tests/test_peak_period_flags.py`; the existing parity test only checks
  RATING_/SURF_/MARINE_/... prefixes). Render: COPERNICUS_PEAK_PERIOD must also be set on Render when flipped (the box
  serves the native CMEMS `/point`); ICON_PEAK_PERIOD is not a Render flag (no GWAM fetch on the box).

## Validation instrument

`backend/scripts/peak_period_validation.py` (new; S7 family): NDBC realtime2 DPD vs every period definition at buoys within
150 km of a catalogue spot; 3-hour continuity; and the production chain (resolve_surf_geometry + estimate_surf_at ->
compute_surf_rating, SURF_PARTITIONS off as served) at the tracked spot catalogue with old vs new total period, same Hs,
direction and wind. Sources: NDBC, Open-Meteo (`gwam` carries DWD's ppts/ppww as swell/wind_wave_peak_period), and CMEMS
in CI (`peak-period-validation.yml`, the only place with the Copernicus login). It never calls the Raw Surf backend.

## 05:58Z: ICON results (local run; NDBC + Open-Meteo `gwam`; no Raw Surf call)

Run: 30 days to 2026-10-20 05:49Z, 128 of 153 NDBC buoys within 150 km of a catalogue spot, 3-hourly pairs; served
impact at 899 catalogue spots (uniform half of the 1,773 active, Open-Meteo hourly budget) x hours 0/12/24/36/48/72.
Lead: Open-Meteo stitches each model's newest runs, so these are SHORT leads (0 to ~12 h). The +24 h corroboration is
SCOREBOARD S7 2026-10-03 (skill ledger): ICON period bias -1.704 s at +24 h, n=407, the same sign and size as here.

DPD error (MAE s, bias s), all pairs n=27,603 for ICON:

| candidate | all | height-agreeing | DPD < 8 s | DPD 8-12 s | DPD > 12 s | bimodal |
|---|---|---|---|---|---|---|
| ICON tm10 (served today) | 2.362 (-1.767) | 2.091 (-1.634) | **1.231 (+0.183)** | 1.796 (-1.454) | 4.497 (-4.496) | 3.096 (-2.099) |
| ICON blend p=1 | 1.826 (-0.033) | 1.608 (-0.028) | 1.894 (+1.226) | 1.608 (+0.054) | 2.061 (-1.629) | 2.873 (+0.510) |
| **ICON blend p=2 (flag default)** | **1.817 (+0.097)** | **1.598 (+0.116)** | 1.966 (+1.336) | **1.597 (+0.194)** | 1.962 (-1.491) | 2.885 (+1.220) |
| ICON blend p=4 | 1.821 (+0.133) | 1.603 (+0.158) | 1.998 (+1.371) | 1.601 (+0.229) | 1.932 (-1.450) | 2.947 (+1.601) |
| ICON argmax (hard switch) | 1.836 (+0.147) | 1.622 (+0.173) | 2.034 (+1.387) | 1.620 (+0.237) | 1.917 (-1.430) | 3.052 (+1.785) |
| ICON swell peak only | 1.932 (+0.532) | 1.715 (+0.648) | 2.394 (+2.053) | 1.639 (+0.586) | 1.814 (-1.321) | 3.137 (+2.245) |
| GFS PERPW (served) | 1.636 (+0.264) | 1.545 (+0.321) | 1.640 (+1.061) | 1.624 (+0.488) | 1.650 (-0.978) | 2.296 (+0.975) |
| EURO pp1d (ECMWF stream, served on coarse/mid) | 1.443 (-0.452) | 1.329 (-0.443) | 1.166 (+0.610) | 1.059 (-0.225) | 2.312 (-2.001) | 2.024 (-0.385) |
| MFWAM as Open-Meteo serves `wave_period` | 2.071 (-1.410) | 2.039 (-1.456) | 1.135 (+0.396) | 1.485 (-1.083) | 4.000 (-3.979) | 2.708 (-1.600) |

By region (MAE, bias), tm10 -> blend p=2: US Pacific 2.797 (-2.269) -> 1.916 (+0.217) n=12,201; US Atlantic 2.016 (-1.301)
-> 1.785 (+0.040); Gulf/Caribbean 1.688 (-1.354) -> 1.242 (-0.367); Hawaii 2.545 (-1.708) -> 2.288 (+0.261); other 2.163
(-1.522) -> 1.891 (+0.180). Better in every region.

**The weak spot: short wind seas.** With buoy DPD under 8 s, tm10 is the better number (1.231 vs 1.966): a modest swell
partition pulls the blend long (+1.3 s). The energy period happens to sit near the peak of a single short sea. This is the
case for feeding partitions separately (SURF_PARTITIONS) rather than ever trusting one scalar; it is reported, not tuned
away (tuning p to it would trade the 8-12 s and > 12 s bands, where the error is three times larger).

Continuity, 3-hour |dT| (p95 / p99 / share > 3 s): tm10 0.65 / 1.30 / 0.06%; blend p=1 1.90 / 5.09 / 2.9%; p=2 2.03 / 5.34 /
3.2%; p=4 2.20 / 5.48 / 3.5%; argmax 2.55 / 6.20 / 4.3%; GFS PERPW (served) 2.85 / 7.60 / 4.8%; buoy DPD itself 5.0 / 10.0 /
9.2%. The blend jumps less than a hard switch and less than the GFS period we already serve; tm10 is smooth because an
energy period is smooth by construction, which is also why it is wrong in long swell.

Served impact (ICON, p=2 vs tm10; production chain, SURF_PARTITIONS off; same Hs, direction, ICON wind): n=5,394 spot-hours.
Breaking height median +6.6% to +10.5% in every decile of today's height (p10 -0.5% to +3.0%, p90 +12.4% to +22.8%);
tails p01 -3.8%, p99 +28.7% (max +39.3%). Score median +1.2 to +4.5 points by decile (p01 -1.7, p99 +20.8). Level changes
1,433 (26.6%), nearly all one level up: good->epic 279, fair_good->good 270, poor_fair->fair 262, fair->fair_good 237,
poor->poor_fair 205, very_poor->poor 87. p=1: 25.0% level changes, p99 +27.3%; p=4: 27.0%, +30.0%.
