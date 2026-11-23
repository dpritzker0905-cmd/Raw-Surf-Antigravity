# Gate: tide-parity-v2
Stamp: 2026-11-23 01:41Z. Rule text committed BEFORE any ETOPO value has been read for these gauges and before any v2 result exists. The gauge list (section 3) is computed from this rule and committed in a LATER commit.
Candidate (amendment 1, 2026-11-23 02:24Z): A's timing at OPEN_COAST gauges (the served event times). This is the TIMING gate (b) of the advisor's split ruling. Height is reported only, as a side figure; the datum gate (a), `gates/tide-datum-parity-v1.md`, owns height. Owner: the tide-MLLW lane (claude-tide-mllw).
Metric: #1171's signed instrument (`parity_coops.py` v2). Per event: signed height error (ours − NOAA) and signed time error (ours − NOAA, min). Medians, p90 and max, per D variant, TIDAL-BAND variant (each side's seasonal constituents removed) for height; time is the same in both bands.
Pass threshold: section 5, TIMING legs only (amendment 1): the 01:26:12Z v1 bar's time legs on OPEN_COAST (per variant median |time| ≤ 10 min and unmatched ≤ 2%; per gauge median |time| ≤ 20 min at ⌈0.923 n⌉ gauges), plus the SIGN check (median signed time error within ±10 min). The height legs are reported, not judged.
Controls: section 6. The served event finder on NOAA's own curve (finder_check.py) must reproduce NOAA's times; the original 26 gauges are reported unchanged beside the verdict.
Decision rule: section 5. Verdict on OPEN_COAST, on the served D variant; a non-served variant that fails is a limit. HARBOR_BAY is reported with its signed timing offset, as a limit, never as a pass.
Unmeasured items: section 7. Fernandina's 40 min (v1) is OPEN and unexplained; spots inside bays and harbours; leads beyond 7 days.
Served change: none from this gate. It tracks a served defect (A's event times, already served on dev under MSL) and does NOT decide #1149; it must be merged (registered) before #1149 merges (advisor's ruling (b)).

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

## 3. The gauge list (computed 2026-11-23 by `gauge_class.py`, rule unchanged)

The classifier reads ETOPO and CO-OPS station metadata only, no water levels and no predictions. Output:
`research/tide-parity-v2-gauge-class-2026-11-23.json`. The rule text was committed first (`0a6a5e9e9`, 01:41:18Z),
before any ETOPO cell was read.

| Gauge | Class | d_path (km) | d_line (km) | detour | why |
|---|---|---|---|---|---|
| 1611400 Nawiliwili | **OPEN_COAST** | 1.92 | 1.78 | 1.079 | all three hold |
| 1612340 Honolulu | **HARBOR_BAY** | 2.02 | 1.9 | 1.063 | constriction |
| 1615680 Kahului, Kahului Harbor | **OPEN_COAST** | 1.85 | 1.85 | 1.0 | all three hold |
| 1617760 Hilo, Hilo Bay, Kuhio Bay | **OPEN_COAST** | 1.74 | 1.64 | 1.058 | all three hold |
| 8443970 Boston | **HARBOR_BAY** | 10.07 | 9.01 | 1.118 | d_path>8km, constriction |
| 8452660 Newport | **OPEN_COAST** | 1.39 | 1.39 | 1.0 | all three hold |
| 8531680 Sandy Hook | **HARBOR_BAY** | 6.99 | 5.52 | 1.267 | constriction |
| 8534720 Atlantic City | **HARBOR_BAY** | 12.37 | 11.34 | 1.091 | d_path>8km |
| 8651370 Duck | **OPEN_COAST** | 4.93 | 4.58 | 1.076 | all three hold |
| 8658163 Wrightsville Beach | **HARBOR_BAY** | 13.02 | 11.89 | 1.095 | d_path>8km |
| 8665530 Charleston | **UNCLASSIFIED** | None | None | None | no DEEP cell reachable through water within the box |
| 8720030 Fernandina Beach | **UNCLASSIFIED** | None | None | None | no DEEP cell reachable through water within the box |
| 8722670 Lake Worth Pier, Atlantic Ocean | **OPEN_COAST** | 1.66 | 1.66 | 1.0 | all three hold |
| 8723214 Virginia Key | **OPEN_COAST** | 7.51 | 7.51 | 1.0 | all three hold |
| 8726724 Clearwater Beach | **UNCLASSIFIED** | None | None | None | no DEEP cell reachable through water within the box |
| 8729840 Pensacola | **HARBOR_BAY** | 13.66 | 12.86 | 1.062 | d_path>8km, constriction |
| 8771510 Galveston Pleasure Pier | **UNCLASSIFIED** | None | None | None | no DEEP cell reachable through water within the box |
| 9410230 La Jolla | **OPEN_COAST** | 0.99 | 0.91 | 1.098 | all three hold |
| 9410660 Los Angeles | **HARBOR_BAY** | 1.16 | 1.16 | 1.0 | constriction |
| 9413450 Monterey | **OPEN_COAST** | 0.46 | 0.46 | 1.0 | all three hold |
| 9415020 Point Reyes | **HARBOR_BAY** | 2.6 | 2.36 | 1.101 | constriction |
| 9419750 Crescent City | **OPEN_COAST** | 2.08 | 1.96 | 1.061 | all three hold |
| 9435380 South Beach | **HARBOR_BAY** | 4.91 | 4.06 | 1.209 | constriction |
| 9443090 Neah Bay | **HARBOR_BAY** | 1.58 | 1.52 | 1.037 | constriction |
| 9751639 Charlotte Amalie | **OPEN_COAST** | 3.13 | 2.92 | 1.074 | all three hold |
| 9755371 San Juan, La Puntilla, San Juan Bay | **HARBOR_BAY** | 2.64 | 2.27 | 1.162 | constriction |

**Counts:** OPEN_COAST 11, HARBOR_BAY 11, UNCLASSIFIED 4. Since n = 11 ≥ 10, the gate is measurable. The per-gauge bar
needs ⌈0.923 × 11⌉ = **11 of 11**.

**Limits of the rule, seen in its output and disclosed here; the rule is NOT changed:**

1. **Wide shallow shelves.** The −20 m DEEP threshold sits far offshore on the Carolina, New Jersey and Gulf shelves.
   - Two open-ocean pier gauges come out HARBOR_BAY on distance alone (d_path > 8 km, no constriction): Atlantic City
     12.4 km and Wrightsville Beach 13.0 km.
   - Four gauges are UNCLASSIFIED, because no −20 m water lies inside the ±0.20° box: Charleston, Fernandina,
     Clearwater Beach and Galveston.
   - So the OPEN_COAST verdict covers no Gulf gauge and no Southeast gauge north of Lake Worth.
2. **Constriction** flags some gauges an observer might call open coast: Point Reyes, Neah Bay and South Beach. It also
   flags the expected harbours: Honolulu, Los Angeles and San Juan.
3. **Virginia Key is OPEN_COAST** by the rule (7.5 km straight to −20 m through Bear Cut, no detour, no constriction),
   even though NOAA's own predictions put the gauge 39 min behind the Miami harbour entrance (log, 01:38Z). The rule
   stands: Virginia Key is scored as OPEN_COAST, and if it fails, the failure counts.

**Applied to v1's already-seen numbers (disclosure, not a result):** OPEN_COAST would FAIL v1's per-gauge rule on both
D variants (the per-variant medians would pass):
- Nawiliwili, median time 21.2 min;
- Virginia Key, median time 43.4 min;
- the sheet D also misses at Duck, median height 0.136 m.

So the rule was not shaped to pass, and v2 is not expected to pass unless the signed instrument shows something v1's
could not.

**Any change to the rule** (for example, a shelf-independent "open water" test) must be a dated amendment made before
v2 data. It must say it came after this list was seen, and it needs the director's and the advisor's word. This lane
does not amend the rule on its own.

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

## 8. Amendment 1 (2026-11-23 02:24Z, before any v2 data): this is the TIMING gate (b)

**Why.** David typed "Yes, split it" (in the director's session), adopting the advisor's split ruling (RULING, gate file,
2026-11-23 02:17Z).
- The v1 bar tested the display's A + D as one unit. Its FAIL is real and stays on record as **FAIL-TIMING**.
- #1149 changes only D, a constant that moves no event, so it cannot cause or fix A's timing.
- The decision is therefore split, before any new data:
  - **(a)** the datum gate `gates/tide-datum-parity-v1.md` decides #1149, on heights;
  - **(b)** this gate tracks A's timing, the served event times, and does not block #1149.

**What changes here:**
- **Candidate:** A's timing at OPEN_COAST gauges (the served event times).
- **Verdict:** the timing legs only.
  - Per D variant: median |time| ≤ 10 min, unmatched ≤ 2%.
  - Per gauge: median |time| ≤ 20 min at ⌈0.923 n⌉ = 11 of 11 OPEN_COAST gauges.
  - Sign check: median signed time error within ±10 min.
  - Times are identical across D variants, so judging "the served D" here is a formality.
- **Height:** every height figure (tidal band and raw, per variant and per gauge) is REPORTED as a side figure. It is
  never in this verdict; gate (a) owns height.
- **Unchanged:** the classification rule, the gauge list, the finder VOID control, S_g, the HARBOR_BAY limit
  reporting, and the original 26 reported under the v1 bar.
- **Owner:** the tide-MLLW lane (claude-tide-mllw), which also owns a fix lane for the timing defect if this gate
  fails.
- **Ordering:** this gate is merged (registered) before #1149 merges, so the timing defect is tracked, not dropped.

## 9. The attribution table (LongCat's safeguard)

Each gauge's timing error beside NOAA's OWN gauge-vs-open-coast lag, so a timing miss can be attributed. The
comparator is chosen by rule, never by hand:
- An OPEN_COAST gauge is its own coast, so its lag is 0.
- Any other gauge uses the NEAREST NOAA tide-prediction station within 30 km that this gate's own rule classifies
  OPEN_COAST.

Instrument: `backend/scripts/tide_datum/timing_attribution.py`. Output:
`research/tide-parity-v2-timing-attribution-2026-11-23.json`. Window: v1's, 2026-11-23 → 11-30. The table is below.
v1's column is UNSIGNED, because v1's artifact holds only |error|. The SIGNED column is filled by v2's run.

| Gauge | Class | v1 median |time| (min, unsigned) | Our signed median time (min) | NOAA lag, gauge − comparator (min) | Comparator (by rule) |
|---|---|---|---|---|---|
| 1611400 Nawiliwili | OPEN_COAST | 21.2 | filled by v2 | 0.0 | itself |
| 1612340 Honolulu | HARBOR_BAY | 18.7 | filled by v2 | 72.0 | MOKU O LOE (1612480, 16.4 km) |
| 1615680 Kahului, Kahului Harbor | OPEN_COAST | 9.5 | filled by v2 | 0.0 | itself |
| 1617760 Hilo, Hilo Bay, Kuhio Bay | OPEN_COAST | 10.1 | filled by v2 | 0.0 | itself |
| 8443970 Boston | HARBOR_BAY | 4.5 | filled by v2 | -1.0 | Moon Head (8444312, 7.0 km) |
| 8452660 Newport | OPEN_COAST | 12.7 | filled by v2 | 0.0 | itself |
| 8531680 Sandy Hook | HARBOR_BAY | 25.2 | filled by v2 | -14.0 | Highlands, Route 36 bridge (8531712, 8.2 km) |
| 8534720 Atlantic City | HARBOR_BAY | 3.8 | filled by v2 | — | no OPEN_COAST prediction station within 30 km |
| 8651370 Duck | OPEN_COAST | 6.0 | filled by v2 | 0.0 | itself |
| 8658163 Wrightsville Beach | HARBOR_BAY | 2.9 | filled by v2 | — | no OPEN_COAST prediction station within 30 km |
| 8665530 Charleston | UNCLASSIFIED | 12.2 | filled by v2 | — | no OPEN_COAST prediction station within 30 km |
| 8720030 Fernandina Beach | UNCLASSIFIED | 39.8 | filled by v2 | — | no OPEN_COAST prediction station within 30 km |
| 8722670 Lake Worth Pier, Atlantic Ocean | OPEN_COAST | 2.4 | filled by v2 | 0.0 | itself |
| 8723214 Virginia Key | OPEN_COAST | 43.4 | filled by v2 | 0.0 | itself |
| 8726724 Clearwater Beach | UNCLASSIFIED | 10.0 | filled by v2 | — | no OPEN_COAST prediction station within 30 km |
| 8729840 Pensacola | HARBOR_BAY | 163.7 | filled by v2 | 189.0 | Pensacola Beach Pier (8729807, 10.8 km) |
| 8771510 Galveston Pleasure Pier | UNCLASSIFIED | 2.8 | filled by v2 | — | no OPEN_COAST prediction station within 30 km |
| 9410230 La Jolla | OPEN_COAST | 1.8 | filled by v2 | 0.0 | itself |
| 9410660 Los Angeles | HARBOR_BAY | 1.4 | filled by v2 | 0.0 | Cabrillo Beach (9410650, 1.5 km) |
| 9413450 Monterey | OPEN_COAST | 3.4 | filled by v2 | 0.0 | itself |
| 9415020 Point Reyes | HARBOR_BAY | 3.4 | filled by v2 | -53.0 | Bolinas Lagoon (9414958, 27.6 km) |
| 9419750 Crescent City | OPEN_COAST | 1.8 | filled by v2 | 0.0 | itself |
| 9435380 South Beach | HARBOR_BAY | 17.0 | filled by v2 | 14.5 | Depoe Bay (9435827, 20.5 km) |
| 9443090 Neah Bay | HARBOR_BAY | 5.3 | filled by v2 | 16.0 | Makah Bay (9442861, 9.7 km) |
| 9751639 Charlotte Amalie | OPEN_COAST | 11.2 | filled by v2 | 0.0 | itself |
| 9755371 San Juan, La Puntilla, San Juan Bay | HARBOR_BAY | 24.1 | filled by v2 | -10.5 | Boca de Cangrejos (9754986, 13.2 km) |

**Reading, as measured. The table is evidence, not a verdict.**

- **Pensacola is the only clean attribution.** NOAA's own predictions put the bay gauge +189 min behind Pensacola Beach
  Pier, and v1's |error| there was 163.7 min.
- **Two v1 misses are OPEN_COAST by the rule**, so the bay lag is 0 by definition and the misses stay UNATTRIBUTED:
  Nawiliwili (21.2 min) and Virginia Key (43.4 min). They count in this gate's verdict. An earlier hand-picked
  comparator (Government Cut) had suggested a 39 min bay lag at Virginia Key; that is not used, because comparators
  are chosen by rule.
- **Fernandina** (39.8 min) is UNCLASSIFIED, and no OPEN_COAST station lies within 30 km. It stays OPEN and
  unexplained.
- **The nearest-station rule picks some poor comparators.** They are kept, not replaced by hand:
  - Honolulu is paired with Moku o Loe in Kāne'ohe Bay, on the other side of O'ahu: lag 72 min against our 18.7.
  - Point Reyes is paired with Bolinas Lagoon: lag −53 min against our 3.4.
  - Where a NOAA lag and our error disagree like this, the comparator is suspect, not our tide.
- **The signed column is empty until v2.** Only signed errors can show whether ours leads the gauge by about NOAA's
  lag, which is what a bay-lag explanation predicts.
