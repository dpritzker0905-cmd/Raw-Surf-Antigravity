# 2026-11-23 claude-tide-window-fix: the tide froze past ~72 h (branch claude/tide-window-fix)

Requested by the director after the research lead's bug hunt found it, and the lead verified it. The flag ships DARK
(`SURF_TIDE_WINDOW_FIX`, default "0"); turning it on needs the owner's word.

## The bug (reproduced by a failing test first)

- `tide.tide_norm_at` called `fetch_tide_hourly` with the default `forecast_days=3`.
- `tide_own.series_from_table` slices that window from 00Z today.
- `tide.tide_state_at` took the NEAREST sample with no maximum distance.

So every valid time past about 49–72 h got the LAST sample's height. With `SURF_TIDE_DEPTH` on, that stale height went
through `sea_inputs.resolve` into the depth-limited cap (`/point`, the precompute, the hub's 14-day plan). Through
`spot_ratings`, it also went into the rating's `tide_fit`.

`tests/test_tide_window.py`, before the fix, on a 12.42 h sinusoid:

| Lead | True (m) | Served (m) |
|---|---|---|
| +80 h | +0.541 | −1.467 |
| +120 h | −1.276 | −1.467 |
| +200 h | +0.905 | −1.467 |
| +330 h | −0.639 | −1.467 |

The served value is the frozen last sample, the lead's exact number.

## The fix (flag ON)

- `tide_norm_at` asks for a window that covers the valid time (`_days_covering`): at least 3 days, at most
  `TIDE_MAX_DAYS = 16`, the 14-day horizon plus margin; tide_own publishes about 90.
- `tide_state_at(max_gap_h=1.5)` returns None when the nearest sample is more than 1.5 h away. A valid time past the
  table then gets no tide, so the callers use their neutral η = 0 and tide factor, never a stale value.
- With the flag OFF, the code path is byte-for-byte today's, and a test pins that.

## Measured OFFLINE (`scripts/tide_window_cap_probe.py`; `research/tide-window-cap-probe-2026-11-23.json`)

The served table is private, so the tide is a stand-in: NOAA CO-OPS hourly predictions on MSL, read-only, at a gauge
near each spot. Everything after the fetch is the served chain: `sea_inputs.resolve` → `tide_norm_at` → η →
`surf_transform.effective_cap_depth` with the spot's own geometry. No live backend, no bucket.

| Spot (stand-in gauge) | +24 / +60 h | +80 h cap, off → on (true) | +200 h | +330 h |
|---|---|---|---|---|
| North Shore Oahu sweep point (Honolulu) | identical | 10.92 → 10.77 (10.77) | 10.92 → 11.14 (11.14) | 10.92 → 11.05 (11.05) |
| Windansea (La Jolla) | identical | 10.70 → 12.06 (12.07) | 10.70 → 11.72 (11.73) | 10.70 → 12.07 (12.07) |
| Ocean Beach SF (San Francisco) | identical | 8.00 → 8.89 (8.90) | 8.00 → 7.74 (7.74) | 8.00 → 9.37 (9.37) |
| Rockaway (Sandy Hook) | identical | 8.24 → 7.15 (7.15) | 8.24 → 8.33 (8.33) | 8.24 → 7.37 (7.37) |

- With the flag off, the cap depth is frozen from about +72 h, with errors up to 1.37 m.
- With it on, the cap depth equals the true-tide value at every lead.
- Inside 72 h, off and on are identical.

## Registration

| Where | Entry |
|---|---|
| `runtime_flags.GUARDED` | "0" |
| `_RATING_FLAGS` | "0", kill and description. `surf_forecast.py` stays at 800 lines by joining one wrapped line of the `SURF_TIDE_DEPTH` entry |
| `flag_guardrail.COVERAGE` | BLIND: the replay resolves its tide with `tide_state_at` on a by-date series, not `tide_norm_at` |
| CI floor | `.github/ci-floors.d/claude-tide-window-fix.chain.json` (+9 tests, +1 file) |

**Tests:** 472 tide, sea-input, spot-rating, flag, surf-point and eval-replay tests pass locally (22 skipped).

## 2026-11-23 02:14Z: shipped ON (owner's word)

**Owner's word, typed in the director session:** "Yes, turn it on". It answered "Turn on the tide-freeze fix
(SURF_TIDE_WINDOW_FIX) once #1178 merges?"

- **The flag:** `SURF_TIDE_WINDOW_FIX` now defaults to "1" in `runtime_flags.GUARDED` and `_RATING_FLAGS`, under D-065.
  The kill switch is "0", through the env or the runtime manifest. The flag is not in `NEVER_AUTO_DISABLE`, and a
  test pins that.
- **Parity:** green.
- **Guardrail:** BLIND, because the replay never calls `tide_norm_at`. So the post-merge check is one `/api/health`
  read plus one offline run of `scripts/tide_window_cap_probe.py`. No live sweep.
- **Tests:** `tests/test_tide_window.py` now has 10 tests. They pin that the default is ON and follows the valid time,
  and that the kill switch restores the old frozen value.
- **Records:** SCOREBOARD row (02:08Z) updated to ON; ledger `claude--tide-window-fix:2` (`flag_flip`).
