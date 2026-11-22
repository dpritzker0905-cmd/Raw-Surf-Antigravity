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

## 19:30Z: shipped ON, advisor fixes

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
