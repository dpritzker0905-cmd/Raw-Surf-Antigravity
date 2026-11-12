# Hawaii direction gate: artefact or real? (move 5, 2026-11-12)

Owner: move 5 session (side session of the weather advisor; task from the director, gap-map item 5's gate).
Scope: offline, public archives only (NDBC realtime2, NOAA GFS-Wave on AWS, Open-Meteo previous runs as in S8). No served
number changes, no flag, no env, no live backend call. Append-only; later sections add to this one.

## 0. Pre-registration (written and committed BEFORE any error was computed)

### Keys
The S8 "hawaii" set is the buoys with an NDBC id starting `51` within 100 km of a catalogue spot
(`skill_consensus.region_of` maps the id prefix, nothing else). Read from
`docs/weather-program/evidence/2026-11-11-s8-direction-period/s8_offline.json` (`meta.buoys`): 51201, 51202, 51206,
51211, 51212, 51214. Positions from NDBC `station_table` (not from any error): 51201 Waimea Bay (21.671, -158.118),
51202 Mokapu Point (21.414, -157.681), 51206 Hilo (19.779, -154.970), 51211 Pearl Harbor Entrance (21.297, -157.959),
51212 Barbers Point (21.323, -158.149), **51214 at (-14.296, -170.875), which is American Samoa, not Hawaii.** The id
prefix puts Samoa in "hawaii". That is a membership fact, found before any score.

### Classes (fixed here; not revised after seeing errors)
Window is November, so the dominant swell is North Pacific, from N to NW (the researcher's pre-registration uses the same
geography). Class is by whether the buoy has open ocean in the N-NW-NE sectors:
- exposed: 51201 (north shore), 51202 (windward east Oahu), 51206 (windward Hilo);
- sheltered: 51211 (Pearl Harbor entrance, south shore, harbour), 51212 (Barbers Point, south-west tip, Oahu shields N);
- not Hawaii: 51214 (Samoa), reported on its own, excluded from both classes.

### Instruments, same keys
Keys are (buoy, valid hour, 24 h lead), window 2026-10-19..2026-11-09 (targets), as in S8.
- BULK (the S8 key): GFS-Wave direction (Open-Meteo `ncep_gfswave025` previous_day1, `wave_direction` = DIRPW) against
  buoy MWD at the valid hour; persistence = buoy MWD 24 h earlier; Hs gate 0.3 m on the observed.
- PARTITION (this instrument): GFS-Wave swell slot 1 direction (AWS GRIB, cycle 24 h before) against the observed
  primary swell train from the buoy spectra (Hs >= 0.5 m); persistence = observed primary train at issue time.
- RANK-FREE: slot 1 against the closest observed swell train (the oracle that removes rank/identity error).
Rows are identical across columns where a key has all three; unmatched keys are counted and reported.

### Hypotheses and decision rules
- H1 (the researcher's, kept verbatim): for the exposed class at 24 h, GFS direction error exceeds persistence under the
  BULK key. Supported only if the buoy-cluster bootstrap 95% interval of (GFS - persistence) lies entirely above zero.
  Six or five buoys cannot confirm; this can refute cheaply and can only suggest otherwise.
- ARTEFACT, any one of: (a) the bulk result is driven by 51214 (drops out of significance or flips when it is removed);
  (b) PARTITION or RANK-FREE ordering reverses the bulk ordering (GFS no worse than persistence on the train key);
  (c) the effect appears equally in the sheltered class and not in the exposed (then it is not shadowing).
- REAL (shadowing signature) needs all of: GFS worse than persistence on BULK, PARTITION and RANK-FREE for the exposed
  class; a signed error whose sign depends on the observed direction sector (N-NW versus E) rather than on lead alone;
  and the 180-degree control not explaining it. Otherwise report UNRESOLVED, with the missing evidence named.
- Controls: persistence is the null that cannot be beaten by chance at long lags; a 180-degree flip control; a positive
  control by seeding a known 30 degree rotation into the model column and recovering it; a leave-one-buoy-out table.
- Stop rule (from the researcher): if the exposed interval includes zero, record H1 as not supported at n = 3 exposed
  and do not add buoys to rescue it.

### Amendment A (written after the BULK lane ran, before any PARTITION error was computed)
The bulk lane ran first and reproduced #794's Hawaii row (see section 1). The partition lane then returned zero keys: the
six buoys are PacIOOS-operated and their NDBC standard-met files carry NO wind columns (wind map empty for all six), and
`partitioner.trains` refuses to label swell without a wind ("a period guess is not a label"). That is a limit of the
instrument at these buoys, found before any partition score. Fix, fixed here: label wind sea by wave age with a MODELLED
10 m wind (Open-Meteo, hourly, at the buoy coordinate, m/s) in place of the missing observation; sensitivity label: swell =
partitions with Tp >= 10 s. Both are reported. If the two labels disagree on the ordering of GFS and persistence, the
partition lane is UNRESOLVED and says so. The modelled wind makes the train truth softer than at the wind-equipped
buoys; the result is a check on the bulk finding, not an independent truth of equal quality.

## 1. Results (offline, 24 h lead, targets 2026-10-19..11-09; evidence `evidence/2026-11-12-hawaii-gate/`)

Instruments: `backend/scripts/partition_truth/hawaii_gate.py` (bulk key = #794's, via its own `ndbc_hourly` and
`om_previous_runs`; partition key = this instrument) and `hawaii_regional_check.py`. Tests: `tests/test_hawaii_gate.py` (5).
Direction MAE in degrees. "pers" = buoy MWD 24 h earlier; "clim" = circular-mean MWD of the 3 weeks before the window.

**Reproduction.** Six keys, n = 1,042: GFS 42.8, EURO 41.9, ICON 62.5, equal consensus 44.4, persistence 24.7, against #794's
41.9 / 42.1 / 62.5 / 43.8 / 24.6. Same finding, same data path.

| set (buoys, n) | GFS | EURO | ICON | cons | pers | clim |
|---|---|---|---|---|---|---|
| all six as S8 (6, 1,042) | 42.8 | 41.9 | 62.5 | 44.4 | 24.7 | - |
| Hawaii five, Samoa out (5, 874) | 42.7 | 33.5 | 64.1 | 41.7 | 22.4 | 31.4 |
| exposed 51201/51202/51206 (3, 528) | 35.6 | 29.3 | 33.5 | 28.2 | 23.9 | 31.8 |
| sheltered 51211/51212 (2, 346) | 53.5 | 39.8 | 110.9 | 62.3 | 20.0 | 30.8 |
| Samoa 51214 (1, 168) | 43.2 | 85.6 | 54.1 | 58.7 | 37.2 | - |

- **Membership is not the cause.** 51214 is American Samoa (NDBC station record: "King-Poloa, American Samoa"); dropping it
  moves GFS 42.8 to 42.7 and persistence 24.7 to 22.4. The `51` prefix rule in `region_of` mislabels it: a latent bug for any
  "hawaii" figure, but it did not make this one.
- **Not "every model loses".** EURO beats persistence at 51202 (14.0 vs 20.6) and ICON at 51206 (25.6 vs 30.5). GFS beats
  it nowhere.
- **Persistence is a strong baseline here, and GFS is worse than a constant.** Persistence beats climatology by 9 deg
  (buoy-cluster interval -15.2..-4.6): the buoy MWD barely moves in 24 h. GFS is 11.4 deg worse than climatology on the five
  (interval -2.7..+32.7); on the exposed three +3.8 (1.4..5.4).
- **H1 (researcher's: consensus vs persistence, exposed class), buoy-cluster 95%:** +4.3 deg (-2.2..+15.5). The interval
  includes zero, so by the pre-registered rule H1 is **not supported at n = 3**; the stop rule applies, no buoys added. GFS
  alone is +11.7 (8.5..15.6) with all three buoys positive (+10.9, +8.5, +15.6); three buoys is thin (sign test p = 0.125
  one-sided). The day-block bootstrap agrees in direction (consensus +4.3, 0.4..7.6).
- **Sector split (exposed, bulk).** Observed MWD in N-NW (285-20): GFS 27.0 vs persistence 27.9 (bias +11.9), n = 268, so the
  model is as good as persistence on the North Pacific swell sector. Observed MWD in E-NE-SE (20-170): GFS 44.4 vs 19.8
  (bias -42.8), n = 260. The whole gap sits in the keys where the buoy's dominant direction is easterly.

**Partition lane (this instrument).** The six PacIOOS buoys carry no wind in their NDBC files (amendment A), so wind sea is
labelled by wave age with a modelled 10 m wind (Open-Meteo), and by a Tp >= 10 s rule as sensitivity. Keys: 211 (age) /
165 (tp10) of the five-buoy keys that have a 00/12Z cycle and an observed primary train.

| exposed (3 buoys) | label age (n 132) | label tp10 (n 104) |
|---|---|---|
| slot 1 vs primary train | 39.0 | 23.6 |
| persistence of the train | 19.7 | 25.8 |
| slot 1 vs closest observed train (rank-free) | 13.2 (null, shuffled slot 1: 19.3) | 19.4 (null 28.3) |
| train N-NW (n 45 / 88): slot 1, rank-free, pers | 16.9, 11.2, 28.6 | 19.9, 17.9, 22.7 |
| train E-NE-SE (n 87 / 16): slot 1, rank-free, pers | 50.5, 14.2, 15.1 | 43.5, 27.3, 42.6 |

- The two labels **disagree** on exposed GFS vs persistence (age: +19.3 worse, interval 9.7..31.9; tp10: -3.1, -11.6..+2.2).
  By the pre-registered rule the partition lane is **unresolved** for the whole class. They **agree** on one thing: on N-NW
  swell trains slot 1 beats persistence of the train (16.9 vs 28.6, and 19.9 vs 22.7).
- Rank-free matching beats its shuffled null in both labels (13.2 vs 19.3, 19.4 vs 28.3): model directions carry real train
  information; the closest-of-k oracle is flattered by k, which the null accounts for.
- Sheltered (2 buoys), both labels: slot 1 is worse than persistence by 36.7 (age) and 31.6 (tp10); rank-free is near its
  null (37.4 vs 43.1, 44.9 vs 67.3). The model's open-ocean direction says little about the harbour and south-coast buoys.
- Regional check (`hawaii_regional_check.py`, informational: PacIOOS `ww3_hawaii` "best" is an analysis-style splice, not a
  24 h forecast, so it is set against GFS's own best estimate at the same hours): exposed mean MAE GFS 36.2 to regional 31.5;
  sheltered 54.0 to 55.4. Signed biases collapse on the windward buoys (51202 -27 to +5, 51206 -33 to -3) but the scatter
  stays; at the sheltered buoys a 0.05 deg run is no closer (51211 66 to 46, 51212 42 to 65).

**Controls.** Positive: a seeded +30 deg rotation is recovered as 30.0 (circular mean). Null: shuffling GFS direction among
days of the same buoy raises MAE (exposed 35.6 to 41.7; five-buoy 42.7 to 56.1), so GFS carries some skill. 180-degree flip:
137-144 against 43 observed, so the convention is not reversed. Leave-one-buoy-out on the five: GFS minus persistence stays
+11.9..+23.4 with the interval above zero in all five cuts. The interpreter used is not the declared CI environment (4
declared packages absent); the unit tests cover pure helpers only.

## 2. Verdict

Applying the section 0 rules as written:

1. **Exposed class (windward and north shore): ARTEFACT, of the truth key and train identity, not of membership.** Rule (b)
   fires: rank-free matching reverses the order (13.2 < 19.7 in the age label; tp10 slot 1 23.6 < 25.8), and on the N-NW
   swell sector the model beats persistence under both labels and ties it under the bulk key (27.0 vs 27.9). The bulk
   deficit sits in keys where the buoy's dominant direction is easterly, where GFS is rotated about 43 deg. At those keys the
   MWD follows the dominant period at a coastal buoy (local or lee sea), which persistence tracks and a swell forecast does
   not. "Persistence beats the models" says the key is not a swell-direction key at these buoys.
2. **Sheltered class (Pearl Harbor entrance, Barbers Point): REAL, unsized.** GFS is worse than persistence and than
   climatology under both keys and both labels, and the regional run does not repair it. n = 2 buoys, one at a harbour
   entrance: what is real is that the open-ocean direction is not representative there (sheltering and refraction at the
   buoy), not a number that transfers to spots. Rule (c) as written (effect only in the sheltered class) does not fire,
   because GFS also trails persistence on the exposed class under the bulk key.
3. **The pooled Hawaii row of #794 should not be read as a swell-direction failure.** It mixes a mislabelled Samoa buoy, a
   harbour buoy, and keys whose truth is the local easterly sea.

What would fix it, in order of evidence: (i) the S8 Hawaii row needs a coast key that excludes 51214, and a per-train or
MWD-sector key, before anyone acts on it; (ii) a regional model (PacIOOS) removes the signed bias at windward buoys
(about 25-30 deg) but not the scatter, so it is a bias fix and not a direction fix; (iii) a nearshore transfer is the only
route that addresses the 2-buoy REAL part, and its truth needs wind-equipped spectral Hawaii buoys (CDIP stations), whose
licence is unresolved (researcher section 6). None of these is built here.

## 3. What this cannot say

- Three exposed and two sheltered buoys; every interval is conditional on that. No buoy was added to rescue anything.
- The partition truth uses a MODELLED wind for the wave-age label, with a period rule as sensitivity; the two disagree on
  the exposed class, so that lane cannot decide it alone. The MWD is the dominant-period direction at a coastal buoy.
- GFS is the Open-Meteo archive (bulk) and the AWS GRIB slot 1 (partition); #794's own AWS cross-check covers the
  archive-vs-source question for the bulk key.
- The regional check is not a 24 h forecast skill. PacIOOS licence: free use, not legal use.
- No spot-level or rating claim; nothing here moves a served number.

## 4. Second opinions and tools

- **Reflection (`ask_reflection`): NOT used.** Its server instructions say to call it only when the user asks to consult
  Reflection or Beam, and it sends selected context to an external service. The request came from the director session,
  not from David in chat. Recorded as not done and offered to David; no Reflection output exists to quote.
- NDBC MCP: station records for 51214 (American Samoa, PacIOOS) and 51206 (Hilo, PacIOOS) settled the membership question.
  ERDDAP MCP: `ww3_hawaii` dataset info (coverage 2011-06-21 to now, 0.05 deg, "best" splice). The ww3 MCP compares wave
  height with a buoy only and the SeaLegs MCP serves buoy observations already read from NDBC, so neither added direction
  evidence and neither was used.
