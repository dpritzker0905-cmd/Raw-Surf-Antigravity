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
