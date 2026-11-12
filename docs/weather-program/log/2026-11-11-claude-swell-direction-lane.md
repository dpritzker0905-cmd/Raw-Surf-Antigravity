# S8/S7 v2: swell direction and period graded paired, by coast, definitions never mixed

2026-11-12T02:40Z (session of 2026-11-11 US time). Branch `claude/s8-direction-period-paired` on dev `472b384f7`.
Owner of this file: this session only.

## 0. What was already there, and what was missing

STATE "Next fixes" item 4 asks for "an S8 swell-direction (and period) lane in the ledger ... then test a consensus
direction/period". Most of that exists: `skill_direction_period.py` (aeb72670, 2026-09-30) grades each lane's
`dir_deg` against NDBC MWD and `tp_s` against DPD per lane and lead, and `skill_direction_consensus.py` (#375) tests
blends. Read against that code, three gaps kept it from settling a decision:

1. **Period definitions were mixed.** Every lane's `tp_s` is graded against NDBC DPD (a PEAK period). GFS-Wave PERPW and
   ECMWF pp1d are peaks; DWD GWAM serves `tm10` (Tm-1,0, a MEAN) while `ICON_PEAK_PERIOD` is '0' (all three ingest
   lanes declare '0'). So ICON's "-2 s bias" in the ledger (SCOREBOARD 2026-10-17) is largely the definition, and the
   consensus period block averaged a mean into two peaks.
2. **No signed direction error.** MAE/median/RMS/p90 only; no circular bias.
3. **Unpaired per-lane tables, no coast split, persistence the only null.**

## 1. Built (measurement only, default OFF)

- `backend/services/weather_pipeline/skill_direction_period_paired.py`: every candidate graded on the SAME
  (buoy, target, lead) keys and the SAME verifying observation (head_to_head's parity rule), by lead and by coast
  (`skill_consensus.region_of`). Direction: MAE, **circular bias** (circular mean of forecast-minus-observed wrapped to
  [-180, 180); positive = forecast clockwise of the buoy), resultant, RMS, median, p90; unimodal split
  (|DPD-APD| <= 3 s). Period: one table PER KIND: `peak` vs DPD (exact), `tm10` vs APD (labelled
  `definition_exact: false`), `tm01`/`tm02` vs APD if a lane ever serves one. A member joins a kind table only if
  >= 80% of its window rows are that kind. Null controls on the same keys: persistence and per-buoy climatology
  (circular-mean MWD / mean DPD / mean APD over the rows older than the window, >= 20 obs). Consensus: equal circular
  mean of the three directions (GFS member's direction where they cancel, counted); per period kind, the equal mean of
  that kind's members only.
- `forecast_skill.run_skill_ledger`: behind `FORECAST_SKILL_DIRPER_PAIRED` (default '0'): rows gain `tp_kind` /
  `dir_kind`, persistence rows gain `tp_mean_s` (the buoy's APD), and `forecast_skill_direction_period.paired` is
  added, in its own try. Off: byte-identical rows and report.
- Registered in `_RATING_FLAGS` (where: forecast-ingest and precompute workflow env together; NOT Render). Not set in
  any workflow: arming it is a later, separate step.
- `backend/tests/test_skill_direction_period_paired.py`: 14 tests (chain lane; fragment
  `.github/ci-floors.d/claude-s8-direction-period-paired.chain.json`, +14 tests, +1 file).
- `backend/scripts/s8_direction_period_offline.py`: the offline reading below, built on the same report function, so
  it is also the lane's end-to-end test on real data.

## 2. First reading (offline, public archives only; no Raw Surf backend, no Supabase, no credentials)

Instrument: `python scripts/s8_direction_period_offline.py --out <dir> --gfs-aws-check 4` (defaults: targets
2026-10-03..2026-11-09 every 3 h, climatology from 2026-10-03..10-19, graded 2026-10-19T22Z..2026-11-09T21Z).
Truth: NDBC realtime2 WVHT/DPD/APD/MWD at 108 buoys within 100 km of a catalogue spot (direction graded at 92, which
report MWD; coasts pacific_ne 49, atlantic_ne 26, atlantic_se 23, hawaii 6, gulf 4). Forecasts: Open-Meteo's archived
previous runs of `ncep_gfswave025` (GFS), `ecmwf_wam025` (EURO), `dwd_gwam` (ICON); `_previous_dayN` = lead 24N h
up to 24N + run spacing. Evidence: `docs/weather-program/evidence/2026-11-11-s8-direction-period/`.

**Source check:** the GFS archive against NOAA's own GRIB (`noaa-gfs-bdp-pds`, 00Z cycles 2026-11-02..05,
f024/f048/f072 DIRPW/PERPW byte ranges) at the same buoys: median |diff| 0.23-0.27 deg and 0.01 s, n = 388 per lead.
The archive is the source data, and `previous_day1` at 00Z is the f024 of the run 24 h earlier.

**Direction vs MWD** (MAE deg / circular bias deg; obs Hs >= 0.3 m; n paired keys):

| lead | n | GFS | EURO | ICON | consensus | persistence | climatology |
|---|---|---|---|---|---|---|---|
| 24 h | 14,523 | 25.2 / +1.4 | 23.0 / +2.1 | 27.3 / -2.0 | **22.3** / +1.2 | 22.5 / -1.0 | 26.8 / -3.3 |
| 48 h | 14,399 | 25.3 / +1.0 | 23.1 / +1.9 | 27.6 / -3.4 | **22.4** / +0.5 | 27.7 / -1.9 | 26.9 / -3.2 |
| 72 h | 14,385 | 26.2 / +0.3 | 23.6 / +1.5 | 28.5 / -4.3 | **23.1** / -0.2 | 30.0 / -3.6 | 26.8 / -3.1 |

By coast at 24 h (MAE deg; n): atlantic_se (2,943) GFS **11.6**, EURO 16.9, ICON 20.0, consensus 14.8, persistence
12.7; pacific_ne (7,232) GFS 29.5, EURO 23.2, ICON 25.4, consensus **22.2**, persistence 20.8, climatology 22.4;
atlantic_ne (2,918) EURO **22.3**, GFS 23.4, consensus 22.8, persistence 35.7; gulf (436) GFS **20.1**, EURO 21.3;
hawaii (994) GFS 41.9, EURO 42.1, ICON 62.5, consensus 43.8, **persistence 24.6**, climatology 32.2. Signed biases are
coast-specific and cancel in the pooled number: EURO/ICON read 10 deg counter-clockwise on atlantic_se and EURO 9 deg
clockwise on pacific_ne. Unimodal seas (5,557 keys at 24 h): EURO 17.7, consensus 19.9, ICON 23.0, GFS 25.5.

**Peak period vs DPD** (like for like; MAE s / bias s): 24 h (n 14,323) GFS 1.57/+0.01, EURO **1.39**/-0.25,
consensus(GFS+EURO) **1.39**/-0.12, persistence 2.01/0.00, climatology 2.27/-0.72; 48 h (14,213) 1.59/+0.10,
1.41/-0.23, 1.41/-0.07, 2.38, 2.28; 72 h (14,205) 1.65/+0.16, 1.47/-0.26, 1.47/-0.05, 2.54, 2.28. ICON has no peak
period (tm10 only) and is not in this table.

**Tm-1,0 vs APD (NOT the same moment)**: 24 h (14,706) EURO mwp 2.23/+2.19, ICON tm10 2.23/+2.11, consensus 2.20/+2.15,
persistence 1.05, climatology 1.23 (48/72 h alike). Both models read ~+2.1 s over APD, the size Tm-1,0 exceeds Tm02,
and lose to both nulls; that is the definition, not skill, and the cell must not be read as a model ranking against
the buoy. It does say ICON's tm10 is as good as EURO's mwp on the same definition (2.23 vs 2.23 s).

**Buoy-cluster bootstrap** (whole buoys resampled, 2,000 reps; MAE difference, 95% interval):
- Direction, consensus minus EURO (best member): -0.69 [-2.44, +1.14] / -0.69 [-2.36, +1.09] / -0.52 [-2.24, +1.28]
  deg at 24/48/72 h. Consensus minus GFS: -2.9 [-7.0, +0.5] / -2.9 [-7.3, +0.5] / -3.1 [-7.5, +0.3].
- Direction, persistence minus EURO: -0.50 [-3.55, +2.21] at 24 h (a tie), +4.6 [+1.1, +7.9] at 48 h, +6.4 [+2.9, +9.7]
  at 72 h. Climatology minus EURO: +3.9 [+0.2, +7.4] / +3.7 [+0.0, +7.3] / +3.2 [-0.5, +6.6].
- Peak period, consensus minus EURO: -0.003 [-0.05, +0.05] s at every lead (a tie); EURO minus GFS -0.18 [-0.28, -0.08]
  s at every lead; persistence and climatology lose by 0.6-1.1 s, every interval above zero.

## 3. What it says

1. **Null control.** Peak period: every model beats persistence and climatology at every lead, CIs clear of zero.
   Direction: at 24 h persistence TIES the best member (22.5 vs 23.0 deg) and beats GFS (25.2) and ICON (27.3); from
   48 h the models win. Climatology (26.8 deg) beats ICON pooled at every lead and TIES GFS (GFS minus climatology
   -1.6 [-7.0, +4.7] deg at 24 h, -0.5 [-5.7, +5.7] at 72 h); it beats GFS on pacific_ne (22.4 vs 29.5) and hawaii. At hawaii persistence (24.6) beats every model by 17+ deg, which says the models'
   0.25-deg directions do not see what the island buoys see (island shadowing / refraction); hawaii is n = 6 buoys.
2. **Consensus vs members.** Direction: the equal circular mean has the lowest pooled MAE at every lead and a 0.57-0.58
   paired win rate against EURO, but the buoy-cluster interval straddles zero (-0.7 [-2.4, +1.1] deg): NOT shown to beat
   the best member. It does beat the served GFS direction by ~3 deg, interval just touching zero. By coast the winner
   changes (GFS on atlantic_se and gulf, EURO on atlantic_ne, consensus on pacific_ne), so a pooled verdict hides a
   coast rule. Period: the GFS+EURO peak mean ties EURO exactly; EURO beats GFS by 0.18 s with an interval clear of zero.
3. **Not a served change.** Nothing here moves a served number. Candidate next steps, each its own dark flag and
   owner decision (D-001): (a) a per-coast direction source (GFS on atlantic_se, the equal mean on pacific_ne), graded
   out of sample on the ledger once this lane is armed; (b) ICON_PEAK_PERIOD's flip would let ICON enter the peak
   table and the three-model peak consensus; (c) hawaii direction needs nearshore truth, not a blend.

## 4. Caveats

- Lead semantics: Open-Meteo previous runs, not the ledger's exact lead (lead 24N to 24N + 6/12 h); the source check
  shows that for GFS at 00Z the value is exactly f(24N). Persistence uses exactly 24N h, slightly favouring it.
- n counts hours, which are autocorrelated; read the buoy-cluster intervals, not n, for significance.
- Direction definitions: GFS DIRPW (peak) is like for like with MWD; EURO/ICON `mwd` are energy-mean directions,
  which is why the unimodal split is shown (EURO leads by more there).
- APD is Tm02; no lane serves Tm02, so no exact mean-period cell exists in this reading.
- Buoy-selected direction: 92 of 108 buoys report MWD; 1,943 key-hours per lead were flat (< 0.3 m) or missing MWD.
- Open-Meteo's archive is a third-party copy for EURO and ICON (only GFS was checked against the source GRIB).

## 5. Ledger

`ledger.d/claude--s8-direction-period-paired.jsonl:1`: the PR open line (draft PR #794). Nothing armed, dispatched, written to Supabase
or Render; no env var changed.
