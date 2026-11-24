# 2026-11-22 claude-tide-mllw: US tide display above MLLW (branch claude/tide-mllw-us)

Started by the director session after David's typed word "Yes, build MLLW". The research basis is Q6 (#1144). The
branch is stacked on #1138 (head aba9a172e), which is stacked on the merged #1132.

## What was built

The method and the measurements are in `research/tide-mllw-us-method-2026-11-22.md`.

- **`tide_datum.datum_for` / `display_m`.** This is the one display composition. The display is level − M + D (our
  A + D, NOAA's prediction frame). D comes, in order, from: our 19-year NTDE computation, then a CO-OPS sheet within
  2 km, then an agreeing interpolation. Where none applies, the point stays on local MSL with a reason. The physics
  is untouched: `tide_state.height_m` stays MSL.
- **`tide_us_region`**: the US boundary, with border points pinned on both sides.
- **CI build**: `own_rules.d_ntde` and `build_series.compute_d` write `d` per US key into the table. `tide_own`
  carries `m` and `d` into the `am` series.
- **Surfaces:**
  - `/point-tide`: `datum_info` plus shifted series, events and heights, with `height_msl_m` kept.
  - `/tides`: `datum`, plus `height_msl` on each tide.
  - The rating tide: `display_height_m`, `datum`, `datum_src`, added only at MLLW points.
  - Spot series: `td` is the display value, and a new `tdd` column marks MLLW.
  - Client: the readout, the hub block, the card row, the glyph line and the chart all name the datum, the source,
    the MSL line and "minus tide".
- **Flag `SURF_TIDE_MLLW_US`.** Registered in `runtime_flags`, `_RATING_FLAGS`, and `flag_guardrail.COVERAGE` (as
  BLIND: display only, so the replay cannot see it). Client kill: `window.__RAW_DISABLE_TIDE_MLLW__`.

## Measured (instruments cited)

- **Station sheets.** `loo_check.py`, over 2,114 US stations:
  - nearest sheet ≤ 2 km: 0.017 m median, 0.097 m p90;
  - interpolation: 0.0185 m median, 0.101 m p90; refused at 993 stations.
- **Epoch.** `epoch_check.py`, over 153 stations: |ΔD| 0.007 m median and 0.055 m maximum; ΔMSL +0.056 m median.
- **Model source.** G3t item 4: 0.0135 m median. Not re-run here; PyFES runs in CI only.
- **M, the term removed.** G3t: 0.067–0.150 m across 26 gauges.
- **Tests.** Backend `test_tide_datum.py`: 63 pass. The tide, flag and spot-series suites pass on Python 3.12
  locally. Frontend: map, spot-hub and src/tests give 533 suites and 7,487 tests, with one pin updated (the
  kill-switch inventory).

## Not measured

- The served shift at the actual spot keys: the table is in the private bucket. Per-region shift estimates from the
  station D distribution (D − M):

  | Region | D median (m) | Approximate shift (m) |
  |---|---|---|
  | Caribbean | 0.126 | +0.03 |
  | Gulf | 0.258 | +0.13 |
  | Hawaii | 0.270 | +0.17 |
  | Pacific territories | 0.392 | +0.30 |
  | East | 0.653 | +0.55 |
  | West | 1.130 | +1.05 |
  | Alaska | 1.784 | +1.65 |

  The first CI build after merge reports how many US keys have `d`. That is owed.
- The model source's per-key values: they do not exist until CI runs `compute_d` (30 min a day budget). Until then,
  US points use a gauge or interpolation, or stay on MSL.

## Rollout

David's choice was put to him through the director on 2026-11-22: ON with guardrails, or staged dark. The code
default is "0" until his word comes; the SCOREBOARD row records which.

## 17:02Z: shipped ON, advisor fixes

**Owner's word, relayed by the director: "Ship it on".** `SURF_TIDE_MLLW_US` now defaults to `"1"` in `runtime_flags`
and `_RATING_FLAGS`, with the D-065 guardrails:
- the kill switch `"0"`;
- the client kill `window.__RAW_DISABLE_TIDE_MLLW__`;
- the MSL figure kept as the second line;
- COVERAGE declared BLIND (display only).

Ledger: `ledger.d/claude--tide-mllw-us.jsonl:2`.

**Frame.** The display stays A + D, as the director and advisor recommend; David has not answered yet. The long label
now says the number is built the way NOAA's predictions are, so it should match a NOAA tide table. It also says the
water typically runs M cm higher at that point (the point's own M), which the MSL line shows. If David picks A + M + D,
only `offset_m`, the long label, `mean_level_removed_m` and the row numbers change.

**Director asks:**
- **The browser Open-Meteo tide fallback is removed (D-082).** `tideClient.ensureTideState`, `getCachedTideState` and
  `tideStateFromSeries` are deleted. The glyph card shows the payload tide only; with no payload tide there is no tide
  line. A test pins that the module has no Open-Meteo URL.
- **One label set:** "above local MSL" / "above local mean sea level", and "above MLLW" / "above MLLW (NOAA chart
  datum)". The readout footer, the card note and its aria, and the chart caption are unified.
- **The post composer's tide field reads "ft above MLLW"** (the auto-fill is NOAA MLLW). No backfill of stored posts.
  A stored datum column would need a schema change and is a follow-up.
- **The sim:** nothing renders `height_m`, so it is left as it is.

**Advisor asks:**
- **Interpolation that disagrees now falls back to MSL with the named reason `interpolation-disagrees`.**
- **Parity instrument.** It compares our hourly display (served event finder) with CO-OPS MLLW hilo predictions at
  the 26 G3t gauges over 7 days, in two D variants (model and sheet). Built as `scripts/tide_datum/parity_coops.py`
  and `.github/workflows/tide-mllw-parity.yml`, a one-shot run started by a tag `tide-mllw-parity-*`. **Not yet run:**
  it needs the director's or owner's word to push the tag. The CO-OPS read was smoke-tested locally on 9410660 (Los
  Angeles): its next-day predictions include a −0.319 m low, a real minus tide.
- **Shift at the actual spot keys, measured offline.** `spot_shift.py` ran on the committed catalogue snapshot (no
  live call). M is the nearest G3t gauge's value, and no model D exists yet. Of 253 US keys, 152 shift now; 101 stay
  on MSL until the model D fills. Median shift:

  | Region | Shift (m) |
  |---|---|
  | West | +0.78 |
  | East | +0.53 |
  | Gulf | +0.18 |
  | Hawaii | +0.16 |
  | Caribbean | +0.09 |

  The exact per-key line prints in every `tide-own-series` build summary after merge (new step, no credential).
- **CO-OPS datums are never read per request.** They are a committed table carrying its source URL and `built_at`
  date. They are refreshed by the read-only script `fetch_coops_datums.py`, not by a scheduled CI job; datums change
  only on NOAA's epoch updates.

## 2026-11-23 01:18Z: interim frame A + M + D (owner's word)

**Owner's word, typed in the director session:** "Yes interim, however double check first". The director ran the
double-check first: CO-OPS monthly means at 16 US gauges, year-round. A + M + D was closer at 16/16, with a median
|error| of 0.024 m against 0.136 m for A + D. The advisors also agreed (SubQ ship 0.997; Reflection ship, keep M as the
2016–2025 mean with no trend; LongCat: the math is right).

**What changed on #1149:**
- The display frame is A + M + D: `offset_m` = D, and the key `mean_level_removed_m` becomes `mean_level_included_m`.
- The long label names the rise and says today's anomaly is excluded. The compact pair (card, glyph, chart) says the
  same.
- New infobox chip: "Tide + avg sea-level rise" (`MLLW_CHIP`, `TideReadout.js:62`). Its `title` carries the full text.
  The footer keeps "above MLLW (NOAA chart datum)".

**Pre-push checks (the director's list):**
1. `git grep mean_level_removed_m` in backend and frontend: 0 hits. Every `offset_m` reader adds or subtracts it
   generically, so all are correct with offset_m = D:
   - `tide_datum.display_m`;
   - `weather_point_tide` `height_msl_m`;
   - `TideReadout` `mslNow`;
   - `tideDatum.shownHeight` and `pointTideForDisplay` (the client kill);
   - the card, glyph, chart and spot series, through `display_height_m`, `td` and `tdd`.
2. No stored product or cache carries an MLLW payload with the old offset. `dev` has no MLLW code at all (no
   `display_height_m`, `tdd` or `SURF_TIDE_MLLW_US`), so no precompute, series build or ratings file was ever written
   with one. The client caches tide payloads in memory only; `localStorage` holds only kill flags. No schema field is
   needed.
3. The chip short form is as given.
4. A SCOREBOARD row was added (01:18Z).

**Tests:**
- Backend tide, spot-series and flag-parity files: 444 pass, 56 skipped.
- Frontend map, spot-hub and src/tests: 538 suites, 7,555 tests pass.

**Still waiting:** the parity-run tag needs David's separate word.

## 2026-11-23 01:14Z: parity run dispatched (owner's word)

**Owner's word, typed in the director session:** "Yes, run it". The director pushed the tag `tide-mllw-parity-1` at
`5719af7be`; this lane did not push it. The run is `tide-mllw-parity.yml` run 45093427404, queued 01:14:29Z. It compares
our hourly A + D (D from the model and from the CO-OPS sheet) with NOAA CO-OPS MLLW High/Low predictions at the 26 G3t
gauges over 7 days.

- The frame does not matter for this run: it measures A + D against NOAA's predictions, and M plays no part.
- No numeric pass bar was registered for it. The advisor's condition 1 on #1144 was the epoch correction, not a parity
  tolerance. The result is reported as measured, beside D's own measured accuracy (model 0.0135 m median; sheet ≤ 2 km
  0.017 m).
- **Expected seasonal offset.** NOAA's predictions carry the full seasonal cycle in their SA/SSA, at 0.044–0.094 m
  amplitude at the six frame-check gauges (CO-OPS harcon). Our FES2022b A carries only the atlas Sa/Ssa, which the M1
  log found mostly lacks the weather-driven and steric seasonal cycle. So a late-November height bias of a few
  centimetres, of either sign by gauge, is expected and is not a datum error. At San Diego, for example, SA 0.076 m at
  phase 180.5° gives about +0.035 m in late November.
- The run is watched read-only. It will not be re-tagged or re-run on failure.

## 2026-11-23 01:32Z: S_g frozen in the log, before the parity artifact is opened

The advisor stamped the #1149 parity bar at 01:26:12Z (PARITY-BAR and PARITY-BAR-RULING in the gate file, read from
the director). S_g is a DIAGNOSTIC there, not part of the verdict. This is the table from
`research/tide-mllw-parity-seasonal-2026-11-23.json`: S_g is the window mean of NOAA SA/SSA minus FES Sa/Ssa (FES taken as about 0),
over 2026-11-23..30, built 01:27:19Z. The artifact `tide-mllw-parity` of run 45093427404 has NOT been opened at the
time of this commit. Since our A + D lacks NOAA's seasonal term, our − NOAA is expected near −S_g at each gauge.

| Gauge | NOAA SA amplitude (m) / phase (°) | NOAA SSA amplitude (m) / phase (°) | S_g, window 11-23 (m) | S_g, window 11-24 (m) |
|---|---|---|---|---|
| 1611400 Nawiliwili | 0.053 / 181.1 | 0.000 / 0.0 | +0.0230 | +0.0221 |
| 1612340 Honolulu | 0.048 / 177.7 | 0.000 / 0.0 | +0.0182 | +0.0174 |
| 1615680 Kahului, Kahului Harbor | 0.048 / 179.2 | 0.000 / 0.0 | +0.0193 | +0.0186 |
| 1617760 Hilo, Hilo Bay, Kuhio Bay | 0.046 / 188.2 | 0.000 / 0.0 | +0.0249 | +0.0242 |
| 8443970 Boston | 0.049 / 136.3 | 0.022 / 97.5 | +0.0023 | +0.0011 |
| 8452660 Newport | 0.061 / 145.3 | 0.016 / 75.1 | -0.0017 | -0.0032 |
| 8531680 Sandy Hook | 0.098 / 142.3 | 0.036 / 71.6 | -0.0039 | -0.0066 |
| 8534720 Atlantic City | 0.097 / 149.5 | 0.041 / 60.7 | +0.0039 | +0.0009 |
| 8651370 Duck | 0.090 / 170.0 | 0.054 / 44.1 | +0.0257 | +0.0224 |
| 8658163 Wrightsville Beach | 0.108 / 165.0 | 0.059 / 50.3 | +0.0277 | +0.0238 |
| 8665530 Charleston | 0.101 / 173.2 | 0.076 / 49.2 | +0.0419 | +0.0376 |
| 8720030 Fernandina Beach | 0.111 / 184.8 | 0.088 / 49.0 | +0.0669 | +0.0622 |
| 8722670 Lake Worth Pier, Atlantic Ocean | 0.079 / 204.5 | 0.054 / 68.4 | +0.0846 | +0.0820 |
| 8723214 Virginia Key | 0.092 / 194.1 | 0.064 / 60.5 | +0.0790 | +0.0756 |
| 8726724 Clearwater Beach | 0.107 / 153.2 | 0.042 / 47.4 | +0.0007 | -0.0026 |
| 8729840 Pensacola | 0.113 / 150.4 | 0.054 / 49.1 | -0.0021 | -0.0059 |
| 8771510 Galveston Pleasure Pier | 0.077 / 157.4 | 0.090 / 55.2 | +0.0249 | +0.0206 |
| 9410230 La Jolla | 0.079 / 175.7 | 0.016 / 261.0 | +0.0171 | +0.0162 |
| 9410660 Los Angeles | 0.066 / 184.4 | 0.000 / 0.0 | +0.0320 | +0.0310 |
| 9413450 Monterey | 0.062 / 198.5 | 0.020 / 264.6 | +0.0285 | +0.0282 |
| 9415020 Point Reyes | 0.059 / 213.3 | 0.035 / 263.3 | +0.0264 | +0.0267 |
| 9419750 Crescent City | 0.071 / 261.4 | 0.041 / 262.1 | +0.0412 | +0.0426 |
| 9435380 South Beach | 0.122 / 285.9 | 0.027 / 234.0 | +0.0866 | +0.0889 |
| 9443090 Neah Bay | 0.122 / 684.0 | 0.017 / 193.9 | +0.0318 | +0.0344 |
| 9751639 Charlotte Amalie | 0.064 / 181.2 | 0.016 / 46.0 | +0.0293 | +0.0277 |
| 9755371 San Juan, La Puntilla, San Juan Bay | 0.055 / 181.4 | 0.015 / 38.3 | +0.0234 | +0.0221 |

## 2026-11-23 01:33Z: parity run 45093427404, verdict under the stamped bar: FAIL (timing, per gauge)

**Order of events:**
- The advisor stamped the bar (PARITY-BAR, PARITY-BAR-RULING) at 01:26:12Z, before any result.
- S_g was frozen: research note commit at 01:28:03Z; this log at 01:32:16Z (`36ffe0675`).
- The artifact `tide-mllw-parity` (`tide_mllw_parity.json`, generated 01:27:49Z) was opened after that. It is copied to
  `research/tide-mllw-parity-run-45093427404.json`.

**The bar, scored from the artifact as built:**

| D variant | median \|height\| (≤ 0.06 m) | median \|time\| (≤ 10 min) | unmatched (≤ 2%) | gauges with median \|h\| ≤ 0.10 m AND median \|t\| ≤ 20 min (≥ 24 of 26) | Verdict |
|---|---|---|---|---|---|
| model (our 19-yr NTDE D; the served first source once CI fills it) | 0.0462 PASS | 8.4 PASS | 8 / 661 = 1.2% PASS | **19 / 26 FAIL** (height alone 24 / 26; time alone 20 / 26) | **FAIL** |
| sheet (CO-OPS sheet D; the served gauge source) | 0.0361 PASS | 8.3 PASS | 8 / 661 = 1.2% PASS | **19 / 26 FAIL** (height alone 24 / 26; time alone 20 / 26) | **FAIL** |

**Per gauge**, with S_g as a DIAGNOSTIC only. S_g is the mean of NOAA's seasonal SA/SSA over the window. Our A + D
lacks it, so ours − NOAA is expected near −S_g.

| Gauge | S_g (m) | model median \|h\| (m) | sheet median \|h\| (m) | median \|t\| (min) | model | sheet |
|---|---|---|---|---|---|---|
| 1611400 Nawiliwili | +0.023 | 0.011 | 0.023 | 21.2 | FAIL t | FAIL t |
| 1612340 Honolulu | +0.018 | 0.015 | 0.023 | 18.7 | PASS | PASS |
| 1615680 Kahului | +0.019 | 0.034 | 0.021 | 9.5 | PASS | PASS |
| 1617760 Hilo | +0.025 | 0.031 | 0.041 | 10.1 | PASS | PASS |
| 8443970 Boston | +0.002 | 0.088 | 0.037 | 4.5 | PASS | PASS |
| 8452660 Newport | −0.002 | 0.034 | 0.030 | 12.7 | PASS | PASS |
| 8531680 Sandy Hook | −0.004 | 0.060 | 0.052 | 25.2 | FAIL t | FAIL t |
| 8534720 Atlantic City | +0.004 | 0.057 | 0.013 | 3.8 | PASS | PASS |
| 8651370 Duck | +0.026 | 0.091 | 0.136 | 6.0 | PASS | FAIL h |
| 8658163 Wrightsville Beach | +0.028 | 0.047 | 0.034 | 2.9 | PASS | PASS |
| 8665530 Charleston | +0.042 | 0.055 | 0.041 | 12.2 | PASS | PASS |
| 8720030 Fernandina Beach | +0.067 | 0.122 | 0.044 | 39.8 | FAIL h t | FAIL t |
| 8722670 Lake Worth Pier | +0.085 | 0.096 | 0.093 | 2.4 | PASS | PASS |
| 8723214 Virginia Key | +0.079 | 0.078 | 0.142 | 43.4 | FAIL t | FAIL h t |
| 8726724 Clearwater Beach | +0.001 | 0.013 | 0.014 | 10.0 | PASS | PASS |
| 8729840 Pensacola | −0.002 | 0.043 | 0.042 | 163.7 (8 of 14 NOAA events unmatched) | FAIL t | FAIL t |
| 8771510 Galveston | +0.025 | 0.048 | 0.040 | 2.8 | PASS | PASS |
| 9410230 La Jolla | +0.017 | 0.019 | 0.013 | 1.8 | PASS | PASS |
| 9410660 Los Angeles | +0.032 | 0.044 | 0.028 | 1.4 | PASS | PASS |
| 9413450 Monterey | +0.029 | 0.039 | 0.035 | 3.4 | PASS | PASS |
| 9415020 Point Reyes | +0.026 | 0.064 | 0.039 | 3.4 | PASS | PASS |
| 9419750 Crescent City | +0.041 | 0.043 | 0.039 | 1.8 | PASS | PASS |
| 9435380 South Beach | +0.087 | 0.134 | 0.092 | 17.0 | FAIL h | PASS |
| 9443090 Neah Bay | +0.032 | 0.054 | 0.054 | 5.3 | PASS | PASS |
| 9751639 Charlotte Amalie | +0.029 | 0.016 | 0.024 | 11.2 | PASS | PASS |
| 9755371 San Juan | +0.023 | 0.058 | 0.036 | 24.1 | FAIL t | FAIL t |

**What the failure is, as measured (no claim beyond the artifact):**
1. **The verdict fails on TIMING.** Six gauges are over 20 min, identically in both D variants: Nawiliwili 21, San Juan
   24, Sandy Hook 25, Fernandina 40, Virginia Key 43, and Pensacola 164 (with 8 unmatched).
   - Time errors come from A (FES2022b at the gauge) and the served event finder, not from D: D shifts every height
     by a constant and moves no event.
   - So these timing errors are in the tide that `dev` already serves under the MSL label (#1132), and #1149 neither
     adds nor removes them.
   - Pensacola's tide is mainly diurnal with a small range, where the High/Low pairing is ambiguous. That accounts
     for its 164 min median and its 8 unmatched events.
2. **Height passes:** both medians are under 0.06 m, and both variants hold 24 / 26 gauges per gauge, exactly at the
   line.
   - The per-gauge height misses are: model at Fernandina (0.122) and South Beach (0.134); sheet at Duck (0.136) and
     Virginia Key (0.142).
   - At Lake Worth (0.096 / 0.093 against S_g 0.085) and South Beach (0.134 / 0.092 against 0.087), the error is
     about S_g, so the season NOAA's predictions carry is the leading term. That is a diagnostic reading, not part of
     the verdict.
   - The sheet D at Duck (0.539) and Virginia Key (0.342) and the model D at Boston and Fernandina differ by about
     0.06–0.13 m from the other source, which accounts for those misses.
3. **The instrument fix (#1171)** was to become required only if HEIGHT failed. Height did not fail, so it stays a
   follow-up, per the director's ruling. Nothing was re-tagged or re-run.

## 2026-11-23 01:38Z: where the parity timing misses come from (measured; no served change)

The director asked whether the served event finder has a timing bug, since timing is what failed the parity bar. Both
instruments below are read-only CO-OPS calls, run over the parity window 2026-11-23..30.

**1. The finder is NOT the cause.** `scripts/tide_datum/finder_check.py` gives the served `tide.tide_extrema` NOAA's
OWN prediction curve and compares its events with NOAA's own High/Low times (`research/tide-mllw-finder-check-2026-11-23.json`).
- The curve was sampled hourly (as served) and every 6 min, at the six failing gauges and two passing controls.
- **Hourly:** median |time error| 1.0–2.0 min, max 7.6 min, no unmatched events, at every gauge. That includes
  Pensacola: 14 of 14 events matched, median 1.5 min, max 3.1 min.
- **6 min:** median 0.5–1.0 min.

So the 21–164 min misses come from the tide model A (FES2022b at the gauge coordinates), not from the finder. A
finder change would be the wrong fix, and none is made.

**2. Are the failing gauges inside bays whose tide lags the open coast?** `scripts/tide_datum/gauge_vs_coast.py`
compares NOAA's own hilo at each failing gauge with a nearby NOAA prediction station nearer the open coast
(`research/tide-mllw-gauge-vs-coast-2026-11-23.json`). Lag is the gauge's time minus the coast station's, from NOAA's
own predictions:

| Failing gauge | Parity median \|time\| (min) | Open-coast comparator | NOAA's own lag, gauge − coast (min) | Reading |
|---|---|---|---|---|
| Pensacola (bay) | 163.7 | 8729807 Pensacola Beach Pier (Gulf front) | +189 | consistent: the bay gauge runs about 3 h behind the Gulf front |
| Virginia Key (Bear Cut) | 43.4 | 8723178 Government Cut, Miami Harbor entrance | +39 | consistent |
| San Juan (harbour) | 24.1 | 9754986 Boca de Cangrejos | −10.5 | partial |
| Fernandina (Amelia River) | 39.8 | 8679997 St. Marys Entrance, North Jetty | +3 | NOT explained: the entrance is within 3 min of the gauge, but our error is 40 min |
| Sandy Hook (Fort Hancock) | 25.2 | 8531804 Sea Bright | −67 | inconclusive: Sea Bright is a subordinate station and reads 67 min BEHIND the gauge, so it is a poor open-coast comparator |
| control: Lake Worth Pier (open coast; passed, 2.4 min) | 2.4 | itself | 0 | — |

**What this shows, and what it does not:**
- **What it shows:** at Pensacola and Virginia Key, NOAA's own predictions put the gauge about as far behind the open
  coast as our error. That is the signature of an open-ocean atlas tide read against a bay gauge.
- **What it does not show:** the sign. The run's artifact holds ABSOLUTE errors only, so it cannot say that ours
  leads; #1171's signed per-event rows would.
- **What stays unexplained:** Fernandina's 40 min, Sandy Hook's 25 min and San Juan's 24 min. They could be FES2022b's
  phase at those coordinates, or the comparator choice; neither is established here.
- **The verdict stands.** The stamped bar's gauge set and verdict are NOT changed by this. Choosing different gauges
  after seeing the result would not be a test.
- **What a fair next test needs:** a pre-registered gauge set that separates open-coast gauges (where surf spots
  are) from harbour gauges, scored with #1171's signed instrument, on a new tag with David's word.

## 2026-11-23 02:56Z: datum parity run dispatched (owner's word); §9's timing disclosed

**Owner's word, typed in the director session:** "Yes, run it", for the datum parity run. The director pushed the tag
`tide-mllw-parity-datum-1` at #1171's head `e427002d7` at 02:52:46Z; this lane did not push it. The run is 45102683907
(`tide-mllw-parity.yml`), queued. The gate is `gates/tide-datum-parity-v1.md` (#1183), with the verdict on the model D.

**Timing of #1183's amendments:**

| Amendment | Committed | Relative to dispatch (02:52:46Z) |
|---|---|---|
| §8, the MEASURED rule | `5e2fc6549`, 02:51Z | before; verified by the director |
| §9, VOID controls made runnable | `d8d01b9af` 02:53:10Z; stamp fix `0642ad04b` 02:53:57Z | AFTER, by about 24 s; before any data was read |

The director has asked the advisor whether §9 stands. Until the advisor rules, the run's artifact stays UNOPENED, even
after it completes. If §9 is rejected, the run is VOID under section 4's original controls: the instrument has no
planted-D option, and the finder check does not measure heights. A re-run would then need a new tag and David's word.

The finder height extension (`finder_check.py --all26`, heights) is committed on this branch at `238f11ac9`
(02:55Z), before any result.

## 2026-11-23 03:06Z: the TWL design (#1167, tide-twl-v1) put to SubQ and Reflection (advisory)

The director relayed David's ask: every lane uses SubQ and Reflection, and tests thoroughly. Both received the same
three questions with public context only: the design, the bars, and the measured West Coast residual. No credentials
and no private table values were sent. Their answers are advisory external content.

| Model | Call |
|---|---|
| SubQ | `subq-savant-1.4`, medium effort. A first high-effort call ran out of output tokens on reasoning and returned nothing |
| Reflection | `Beam-1.0-501B-A23B`, high effort |

### Q1: the MLLW ↔ NAVD88 chain

**Both:** stay on MLLW at stage 1, with r = observed_MLLW − (A + D). NAVD88 adds nothing for corrections at the gauges.
It becomes necessary only when leaving that frame:
- stage-2 interpolation of r to spots;
- blending with STOFS/ETSS, CMEMS or other products on a different vertical reference;
- land or inundation thresholds.

At that point, convert per station (VDatum or the geoid), then convert the result back to MLLW.

**Reflection's warning:** if D (computed vs sheet), FES's MSL reference and any NAVD88 conversion are mixed, r absorbs
datum error, and the gate measures datum mismatch rather than TWL skill.

### Q2: which gauges

**Both:** do not decide on OPEN_COAST only.
- SubQ: all gauges for the primary verdict, with the strata as a pre-specified sensitivity, and the 4 unclassified
  gauges kept in and shown separately.
- Reflection: all 30 gauges, stratified by exposure class.

Their reason: the rule's misclassification and its unclassified gauges would bias an OPEN_COAST-only subset.

### Q3: the primary metric (they disagree)

- **Reflection:** absolute RMSE per lead against the BETTER of r24 persistence and the 60-day anchor. A percent cut
  against A + D can pass just by removing a persistent offset.
- **SubQ:** lead-weighted RMSE skill against A + D, with the 6–72 h and 7–14 d cuts as pass/fail. Bias, the two
  simple-benchmark guardrails and the storm bar are hard constraints.

**Both say these are missing:**
- a pre-declared aggregation and uncertainty plan: gauge weighting, rolling-origin confidence intervals, and a 3–7 d
  lead bin (the leads jump from 72 h to 168 h);
- a two-sided tail or peak metric: over-reads as well as under-reads.

### This lane's decision

These are recommendations. They become a dated amendment 5 to #1167 only with the director's and the advisor's word,
before any TWL data.

- **Q1: no change.** The gate already keeps stage 1 on MLLW. Stage 2 (section 9 there) gets a sentence: a per-station
  MLLW ↔ NAVD88 conversion at the blending boundary, and back.
- **Q2: no change needed for the TWL gate.** #1167 already judges every gauge per stratum, and serving is per stratum.
  Its 30 gauges are not filtered by the OPEN_COAST rule; that rule belongs to the timing gate #1179.
- **Q3: adopt Reflection's framing as PRIMARY.**
  - Per gauge and lead bin, the RMSE of TWL must beat the better of PERSIST24 and ANCHOR, with a rolling-origin
    bootstrap 90% interval that excludes "no better".
  - The cut against A + D stays as a secondary bar.
  - Add a 120 h lead.
  - Add a two-sided storm-hour metric: the mean signed error, the under-read share and the over-read share.
  - Add an aggregation rule: per gauge, no pooling across gauges.

**Why Reflection's framing:** this window's +0.3–0.4 m persistent offset is exactly the case where beating A + D
proves little and beating persistence proves skill.

## 2026-11-23 03:38Z: dev merged in (#1178, #923 and others); the #923 overlay datum work #1149 owed

**The merge (`b606fdc29`) is conflict resolution only.** #1178 (the tide-window fix, ON) and #923 (the tide overlay)
are now on dev.
- **`tide.py`:** both flag paths of `tide_norm_at` keep the window fix and #1149's MLLW display fields, through one
  helper.
- **Card, hub, chart and series:** dev's ft/m-following tide text plus #1149's datum word.
- **Kept on both sides:** both kill switches, and the SCOREBOARD rows.

**The #923 overlay work, done as a separate commit** (owed under the PR body's "Owed when #923 lands" section):
1. **Same path as the infobox.** `tideOverlayModel.tideMarkerModel` now reads the payload through
   `pointTideForDisplay`, exactly as `TideReadout` does. With the client kill `__RAW_DISABLE_TIDE_MLLW__` on or off,
   marker and infobox show the same height in the same named datum. Pinned by two new cases in
   `tideOverlay.parity.test.js`.
2. **The datum is named.** The marker's text and `aria-label` carry `datum.short` ("above MLLW" / "above local MSL"),
   in all three themes, using the theme's own muted class.
3. **Wording.**
   - The overlay's code header now says "heights above MLLW (NOAA chart datum) at US points and above local mean sea
     level elsewhere".
   - #923's session log line "FES2022 + the altimetry mean level, above local MSL"
     (`log/2026-11-15-claude-tide-overlay.md:183`) is **superseded by this entry** for US points. That log is another
     session's and append-only, so it is not edited.
   - The FES2022 / AVISO + Copernicus credit text is unchanged.
4. **Stale pins and lists.**
   - dev's new ft/m tide-row test pinned the pre-#1149 label "Tide (model estimate, mean sea level)". Updated to the
     unified "above local MSL".
   - `tideOverlayModel.js` is added to the blind-quality scanner's PURE list: it is a pure model with no JSX, and its
     renderer sits under MapWebGL, which records exposure.

**Tests:** Jest (map, spot-hub, src/tests) 541 suites and 7,613 tests pass; the eslint ratchet shows no increase.

## 2026-11-23 04:42Z: datum parity run 45102683907, VOID (the planted-D identity control failed)

**Run.** It completed at 04:41:10Z, conclusion success. The parity step started at 04:38:14Z on 2026-11-23, so its
window is 11-23 → 11-30, the same window the finder control was run on.
- The artifact was opened once, after condition (a) was pushed (`76b0fe98f`) and the run had completed.
- It was scored by the committed scorer, `datum_gate_score.py` at `d196498c4`, committed before the run.
- Saved as `research/tide-datum-parity-run-45102683907.json`, with the score in
  `research/tide-datum-parity-score-45102683907.json`.

**Controls (#1183 §9; VOID-only by the advisor's ruling (b)):**
- **Finder heights:** PASS. The largest per-gauge median |h| on NOAA's own curve is 0.0017 m (limit 0.01).
- **Planted-D identity:** **FAIL**, at 23 of 25 measured gauges.
  - Heights: (sheet − model) signed differences equal d_sheet − d_model within 0.001 m at most gauges. The exceptions
    are Nawiliwili (0.006 m), Duck (0.016 m) and Lake Worth (0.017 m).
  - Times: the paired event times differ by 0.1–2.3 min, against the 0.1-min tolerance.
  - **Likely cause** (diagnosis, not a re-score): `parity_coops.py` rounds the hourly display series to 1 mm after
    adding D (`round(x + d, 3)`). Two different D values round differently, and the finder's parabolic vertex then moves
    on flat-topped turns. §9's tolerance (0.1 min, 0.002 m) was set tighter than that rounding allows. That is this
    lane's specification error, made after the tag.

**Verdict: VOID.** Under the advisor's ruling (b), a failed control means a new tag plus David's word, never a re-read
of the bar.

**MEASURED (§8):** every gauge matched all its NOAA events except Pensacola, which matched 6 of 14 (43%) and is NOT
MEASURED. Counts per gauge are in the score JSON.

**Bar figures, RECORDED ONLY. This is not a verdict, and is not to be read as one:**

| Variant | median \|h\| | p90 \|h\| | gauges ≤ 0.10 m | median signed |
|---|---|---|---|---|
| model (tidal band) | 0.0262 m | 0.090 m | 25 / 26 | −0.0149 m |
| sheet (tidal band) | 0.0213 m | 0.0774 m | 24 / 26 | +0.0007 m |

**Proposed for the re-run** (needs the director, the advisor and David):
- remove the 1 mm rounding in `parity_coops.py` before the event finder, in #1171, so the identity can hold exactly;
- keep §9's tolerances unchanged;
- a new tag.

## 2026-11-23 11:59Z: datum re-run 45169199337: controls PASS; verdict FAIL (model D's p90 leg)

**The run.** Tag `tide-mllw-parity-datum-2` on #1171's `cefbba914` (unrounded instrument), pushed on the owner's
"Yes, re-run it" after the advisor's PASS on #1183 and #1171. It completed at 11:58:07Z, conclusion success.
- The parity step started 2026-11-23 11:55:58Z, so the window (11-23 → 11-30) equals the committed finder control's.
- The artifact was opened once.
- Controls ran first; the bar was opened only after both passed.
- Scored once by the committed scorer (`d196498c4`). Saved as `research/tide-datum-parity-run-45169199337.json` and
  `research/tide-datum-parity-score-45169199337.json`.

**Controls (§9):**
- **Planted-D identity:** PASS, and EXACT at all 25 measured gauges: paired time difference 0.0 min, height residual
  0.0 m. The one-line fix removed the VOID's cause.
- **Finder heights:** PASS (0.0017 m).

**MEASURED (§8):** every gauge 100% except Pensacola, 6 of 14, NOT MEASURED. That counts as a per-gauge FAIL.

**Bar (§3), tidal band; the verdict is on the MODEL D:**

| Variant | median \|h\| ≤ 0.03 | p90 \|h\| ≤ 0.08 | per gauge ≤ 0.10 at ≥ 24 of 26 | median signed within ±0.02 | Result |
|---|---|---|---|---|---|
| **model (verdict)** | 0.0261 PASS | **0.0903 FAIL** | 25 / 26 PASS | −0.0151 PASS | **FAIL** |
| sheet (reported; a limit only) | 0.0213 PASS | 0.0777 PASS | 24 / 26 PASS (Duck 0.1405 and Pensacola miss) | +0.0008 PASS | would pass |

**VERDICT: FAIL.** The model D variant fails the p90 leg by 0.010 m. Under amendment 3 there is NO further re-run.

**Beside the VOID run 45102683907:** its recorded, not-a-verdict figures were model 0.0262 / 0.090 / 25 / −0.0149 and
sheet 0.0213 / 0.0774 / 24 / +0.0007. The re-run reproduces them within 0.001 m, so the rounding moved event timing in
the identity check, not the height distribution.

**Where the model's p90 tail comes from (diagnosis, not a re-score).** Events above the model p90 cluster at three
gauges: Virginia Key (13; d_model 0.406 vs sheet 0.342), Duck (13; 0.407 vs 0.539) and Boston (13; 1.489 vs 1.586).
- At Boston the model D sits 0.10 m below the sheet, and the sheet variant's median there is 0.038 against the
  model's 0.086.
- At Duck the sheet misses too (0.14).
- So the model D's error concentrates at a few East Coast gauges, where our 19-year D departs from the station sheet
  by 0.06–0.13 m.

**What this decides.** By #1183, #1149's datum gate (a) FAILED on the served model D. Whether #1149 is held, or its D
source order changed (for example, the sheet first wherever a sheet is within 2 km, which this run reports as passing
at the gauges), is for the advisor and David. Any such change is a new gate, not a re-read of this one.

## 2026-11-23 12:08Z: #1149 stays HELD; the hybrid-D gate pre-registered as #1210 (tide-datum-parity-v2)

**The director's decision** (SubQ and Reflection agree; David's standing rule is the SOTA consensus): #1149 stays HELD,
and nothing ships with a caveat. A new gate tests hybrid D: the NOAA sheet within 2 km, else our 19-year D.

**Held-out stations, frozen by rule** before the gate text: `scripts/tide_datum/heldout_select.py` at `665ca6521`
(12:02Z). Output: `research/tide-datum-parity-v2-heldout.json` and the CO-OPS station-list snapshot.
- 1,110 eligible stations, excluding every station this program has read.
- Strata: NEIGHBOR (pool 96) and MODEL (pool 1,014). 20 drawn from each, seed 20261124.
- Scored leave-one-out: a station's own sheet is never used.

**Gate:** #1210, `gates/tide-datum-parity-v2.md`, stamped 12:05Z.
- Window fixed at 2026-12-01 → 12-08.
- #1183's bar, unchanged.
- The primary is an INTERSECTION: each stratum must pass.
- Donors are never deciding stations; replacements are capped at 5 per stratum.
- New placebo control: D + 0.10 m must FAIL.
- No re-run.

**Advisory review, public context only:** SubQ and Reflection answered; the gate's §8 records what was adopted and why.
Both flagged the pooled primary masking a stratum, and HARKing. LongCat's request was built (preview `payload_sha256`
5b5a833d…) but NOT sent, because its tool requires the user's own approval of that hash.

## 2026-11-24 15:08Z: datum gate v2 dispatched (owner's word); finder control committed BEFORE the artifact

**Dispatch.** The owner answered "Yes, tag and run (Recommended)" to "Tag and run it?" in the director session, at
about 15:05Z. The director pushed the annotated tag `tide-datum-parity-v2-1` on #1171's `1d92f7564` at 15:05:44Z. It
cites #1270's §§9–11 as fixed at `689cddc33`.
- The run is 45421486227 (`tide-mllw-parity.yml`).
- Ledger: dispatch `:7`; commitment `:8`, due 2026-11-25T00:00Z: score once and record the verdict.
- The advisor's limits: L1, the tag cites #1270 at `689cddc33`; L2, score strictly, with NO re-run; L3, #1171 stays
  held with #1149.

**What the run reads.** NOAA CO-OPS PREDICTIONS only: High/Low on MLLW, plus `harcon.json` for SA/SSA. It reads no
measured water level and no `hourly_height`, confirmed in the tagged code. Harmonic predictions for 2026-12-01..08 are
already published, so the earliest valid run date is 2026-11-24, as the gate's §3 says. No window observation exists
or is read.

**Finder control (§5), committed before the artifact is opened.** `finder_check.py --stations` at the tagged
`1d92f7564`, window 2026-12-01 → 12-08, all 50 scored stations (deciding plus 5 reserves per stratum).
- Hourly, as served: the largest per-station median |h| is **0.0043 m** (limit 0.01); none over.
- Every station had NOAA events; the largest median |t| is 10.1 min (timing is reported, not judged here).
- `research/tide-datum-parity-v2-finder-2026-12-01.json`.

## 2026-11-24 15:13Z: datum gate v2 (run 45421486227): controls PASS; verdict FAIL

**Run and procedure.**
- The run completed at 15:12:10Z, conclusion success, AFTER the finder control was committed (15:08:34Z, `642e43213`).
- The artifact records `window_start` 2026-12-01, mode `v2-heldout-loo`, 7 days, 50 stations, and no station errors,
  so no replacement was needed.
- The artifact was opened once, and scored once with `datum_v2_score.py` at the tagged `1d92f7564`. The first
  invocation crashed at import, before reading any data, because Python's `-I` mode leaves the script folder off the
  import path. The single scoring is the second invocation.
- Saved as `research/tide-datum-parity-v2-run-45421486227.json` and `research/tide-datum-parity-v2-score-45421486227.json`.

**Controls (§5, §§9–11), all PASS, run first:**
- **Finder:** the largest per-station median |h| is 0.0043 m.
- **Planted-D identity:** tested at 17 NEIGHBOR stations, exact.
- **Placebo shift identity:** exactly +0.100 m in both strata, on 453 and 378 paired events.

**MEASURED (§8 and §11):** NEIGHBOR 18 of 20, MODEL 15 of 20. Both are below 19, so by §11 the run is FAIL on
measurability alone. Five MODEL and two NEIGHBOR deciding stations matched under 70% of NOAA's events, in Gulf, Texas,
Alaska and North Carolina sounds.

**Bar (§4, the hybrid, tidal band, per stratum):**

| Stratum | median \|h\| ≤ 0.03 | p90 ≤ 0.08 | per station ≥ 19 of 20 | signed within ±0.02 | Result |
|---|---|---|---|---|---|
| NEIGHBOR | 0.0606 FAIL | 0.3126 FAIL | 13 FAIL | −0.0146 pass | **FAIL** |
| MODEL | 0.0542 FAIL | 0.3231 FAIL | 12 FAIL | −0.0095 pass | **FAIL** |

**VERDICT: FAIL** (the intersection fails in both strata, by the bar and by measurability). There is NO re-run (§4).

**Reported only, not the verdict:**
- **Model D** does better than the neighbour sheet in the NEIGHBOR stratum: median 0.046 against 0.064, and 15 against
  12 stations passing.
- **The p90 tail of about 0.3 m** comes from estuary and harbour stations where our A misses badly, whatever the D:
  Randalls Island, East River (0.56 m), Provorotni Island, Alaska (1.51 m), St Lucie Inlet, North Beach Causeway,
  Colonial Beach on the Potomac.
- **At Randalls Island the neighbour sheet's D** (1.03 m, 1.4 km away) and our model D (1.56 m) differ by 0.53 m: a
  2 km neighbour in a tidal strait is not the station's datum.
- **Donor distances:** 19 donors, 0.21–1.90 km (median 1.37 km); none co-located.

**What it decides.** #1149 stays HELD: the datum gate v2 FAILED.
- The held-out type-R stations are mostly estuaries, rivers and harbours, the same limit §7 names. There, the
  failure is dominated by the tide A, not by the choice of D.
- Under the gate there is no re-run. Any further datum work is a NEW pre-registered gate, for example one restricted
  to open-coast stations by a frozen rule, or with an A-side improvement first. That is for the director, the advisor
  and the owner.
