# Gate: tide-parity-v2
Stamp: 2026-11-23 01:41Z. Rule text committed BEFORE any ETOPO value has been read for these gauges and before any v2 result exists. The gauge list (section 3) is computed from this rule and committed in a LATER commit.
Candidate: the US tide display above MLLW (`SURF_TIDE_MLLW_US`, #1149): timing and height of A + D against NOAA CO-OPS MLLW High/Low predictions, scored where the surf spots are: at OPEN_COAST gauges.
Metric: #1171's signed instrument (`parity_coops.py` v2). Per event: signed height error (ours − NOAA) and signed time error (ours − NOAA, min). Medians, p90 and max, per D variant, TIDAL-BAND variant (each side's seasonal constituents removed) for height; time is the same in both bands.
Pass threshold: section 5. The 01:26:12Z v1 bar, applied to OPEN_COAST, plus a SIGN check (median signed time error within ±10 min on OPEN_COAST).
Controls: section 6. The served event finder on NOAA's own curve (finder_check.py) must reproduce NOAA's times; the original 26 gauges are reported unchanged beside the verdict.
Decision rule: section 5. Verdict on OPEN_COAST, on the served D variant; a non-served variant that fails is a limit. HARBOR_BAY is reported with its signed timing offset, as a limit, never as a pass.
Unmeasured items: section 7. Fernandina's 40 min (v1) is OPEN and unexplained; spots inside bays and harbours; leads beyond 7 days.
Served change: none from this gate. #1149's merge decision stays with the advisor and David.

## 1. Disclosure: v1 FAILED, and why this split exists

`tide-mllw-parity-1` (run 45093427404, 2026-11-23) **FAILED** the advisor's bar stamped at 01:26:12Z, on per-gauge
TIMING: 19 of 26 gauges passed, and the bar needs 24. Both D variants passed the aggregate medians, and height passed
at 24 of 26 (log `2026-11-22-claude-tide-mllw.md`, 01:33Z; SCOREBOARD 2026-11-23 01:33Z).

After the result, this lane measured two things (log, 01:38Z):
- The served event finder is not the cause. On NOAA's own curve it gives a median of 1–2 min and nothing unmatched.
- At Pensacola and Virginia Key, NOAA's own predictions put the gauge about as far behind the open coast as our error.
  At Fernandina they do not.

**This split was motivated by v1's timing pattern.** That is exactly why the gauge classes come from a geometric rule
fixed here, before any v2 data, and never from v1's per-gauge results or from gauge names. Whatever the rule says about
a gauge stands, including where it puts a v1 failure on OPEN_COAST or a v1 pass on HARBOR_BAY.

## 2. The classification rule (fixed now)

**Data:** NOAA NCEI ETOPO 2022 15 arc-second bathymetry and topography (`ETOPO_2022_v1_15s`), read from NOAA
CoastWatch ERDDAP (`https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s`; the endpoint
`scripts/etopo15s_raster_probe.py` already uses). Full resolution, stride 1 (about 460 m), in a box of ±0.20° around
the gauge's CO-OPS coordinates. Cells are WATER where z < 0 m and DEEP where z ≤ −20 m.

**Steps, per gauge:**
1. **start** = the water cell nearest the gauge's coordinates.
2. **d_path** = the shortest 8-connected path through WATER cells from start to any DEEP cell, in km (the sum of
   great-circle steps between cell centres). **target** is the DEEP cell it reaches, and **d_line** is the
   great-circle distance from start to target.
3. **Constriction:** some cell on that path more than 1.0 km of path from start lies within 0.5 km (great-circle) of
   a land cell (z ≥ 0).

**A gauge is OPEN_COAST if and only if all of:**
- (a) d_path ≤ 8.0 km;
- (b) d_path ≤ 1.30 × d_line (no detour around a barrier island or spit);
- (c) no constriction (no inlet or channel narrower than about 1 km between the gauge and deep water).

**Every other gauge is HARBOR_BAY.** A gauge whose box cannot be read, or which has no DEEP cell in reach of water,
is UNCLASSIFIED. That is reported, and counts as not measured.

**Universe:** the 26 gauges of v1 (`own_rules.G3T_M`). No gauge is added or removed by name.

The thresholds (8 km, 1.30, 1.0 km, 0.5 km, −20 m) are fixed here and are not changed after the list is computed.
The classifier is `backend/scripts/tide_datum/gauge_class.py` (next commit). It implements exactly these steps, and
its output file records the class and the four numbers per gauge.

## 3. The gauge list

Computed by the rule in the next commit. Not yet computed at this stamp.

## 4. Data and instrument

- **Instrument:** `parity_coops.py` v2 (#1171): signed per-event rows, p90, and the tidal-band variants `model_tb` /
  `sheet_tb`. Window: 7 days from the run's UTC start day, as in v1.
- **Truth:** NOAA CO-OPS `predictions&interval=hilo&datum=MLLW&units=metric&time_zone=gmt`, read-only.
- **Run:** a new tag `tide-mllw-parity-2` on the merged or retargeted #1171. Starting it is a dispatch and needs
  David's typed word.

## 5. Bars and decision rule

On OPEN_COAST gauges, n = the number of measured OPEN_COAST gauges:

1. **Per D variant (tidal band for height):** median |height| ≤ 0.06 m, median |time| ≤ 10 min, unmatched ≤ 2%.
2. **Per gauge:** median |height| ≤ 0.10 m AND median |time| ≤ 20 min, at ≥ ⌈0.923 × n⌉ gauges. (0.923 = 24/26,
   the v1 proportion.)
3. **Sign:** the median SIGNED time error over all OPEN_COAST events lies within ±10 min.
4. **Minimum:** if n < 10, the verdict is NOT MEASURABLE (too few open-coast gauges), not a pass.

**Verdict:**
- PASS only if 1–3 hold on the SERVED D variant. Every variant is judged; a non-served variant that fails is a limit.
- HARBOR_BAY is reported per gauge, with its median signed time error, as a LIMIT (the display reads open-coast tide
  timing). It never contributes a pass.
- The ORIGINAL 26 gauges are scored by the v1 bar and reported unchanged beside the verdict. The raw (non-tidal-band)
  height errors are reported too.

## 6. Controls

- **Finder control:** `finder_check.py` on NOAA's own hourly curve at every OPEN_COAST gauge, in the same window. A
  median above 5 min at any gauge makes the run VOID: the finder, not the tide, would be under test.
- **Seasonal diagnostic:** S_g per gauge (`parity_seasonal.py`), frozen before the result is opened. Not part of the
  verdict.

## 7. Open items, named

- **Fernandina (8720030): OPEN.** v1 gave 39.8 min, but NOAA's own St. Marys Entrance North Jetty prediction is within
  3 min of the gauge, so bay lag does not explain it. It is not explained away here. Whatever class the rule gives
  Fernandina, its v2 signed error is reported by name. If it is OPEN_COAST and fails, the failure counts.
- Spots inside bays and harbours are not covered by an OPEN_COAST verdict.
- Leads beyond the 7-day window are not tested.
