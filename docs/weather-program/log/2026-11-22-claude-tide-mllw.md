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
