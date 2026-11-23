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
| 8729840 Pensacola | −0.002 | 0.043 | 0.042 | 163.7 (8 of 22 unmatched) | FAIL t | FAIL t |
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
