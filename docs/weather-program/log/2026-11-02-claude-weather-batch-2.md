# 2026-11-02 · claude · Weather batch 2 (#678 #683 #684 #685 #686, dark / test-only)

Session: a delegated subagent of the lead. Branch `claude/weather-batch-2`, cut from `origin/dev` at `4b3e27aa6`, then
`origin/dev` merged in again three times as dev moved: `cd09e4e3e` (#674 weather batch 1, #680/#681 science docs; no
backend test or floor change), `558a1a54f` (#687 grom, frontend only) and `6a00e7f6e` (#672 rated frames, chain +9 in
+1 file, which moved dev's chain map to 3044). Nothing merged to dev, nothing flipped, no live backend
call, no workflow dispatch, no Render/Netlify env change.

## What the batch carries

Each PR merged with `git merge --no-ff origin/<branch>`, in this order, so every PR's own commits survive:

| PR | Branch | What | Served numbers |
|---|---|---|---|
| #678 | `claude/upbeat-cori-222cde` | kill-switch coverage tests (3 Jest files) + routes-flags-not-in-registry parity (estate, 2 tests) | none: test-only |
| #683 | `claude/festive-edison-678e61` | validation gates v2 beside the v1 scored-rows gate (`gate_v2*.py`, `test_gate_v2.py`, 48 chain tests) | none: an offline gate |
| #684 | `claude/revision-refresh-honest-stale` | `PRODUCT_REVISION_REFRESH`: a cold download is checked against its registration, not tagged stale (D-064); +2 chain tests in `test_product_revision_refresh.py` | none until the Render flag flips (owner's word) |
| #685 | `claude/run-keyed-products-80f25b` | `PRODUCT_RUN_KEYED_NAMES` run-keyed immutable product object names, dark (`test_product_run_keys.py`, 26 chain tests) | none: default `'0'` |
| #686 | `claude/consensus-period-median` | `CONSENSUS_PERIOD_MEDIAN`, the member-median consensus period, dark and gated on `ICON_PEAK_PERIOD` (+35 chain tests in `test_consensus_product.py`) | none: default `'0'` |

## Conflicts and how they were resolved

- `.github/workflows/ci.yml` chain block and `backend/tests/test_ci_floor_staleness.py` `_FLOOR_SET_FROM["chain"]`
  (#683, #685, #686 each re-derived the chain lane from dev alone; same-lane collision, L-P39). Taken one side at each
  intermediate merge, then the chain and estate lanes were re-derived ONCE from dev with `rederive_floor.py` for the
  whole batch (below). The estate (#678) and guards (#678, +0 note) blocks auto-merged.
- `docs/weather-program/DECISIONS.md` (merging dev back in): dev's D-058 and #684's D-064 were appended at the same
  spot. Exact union, both kept, dev's D-058 first.
- Auto-merged, read by hand: `backend/services/weather_pipeline/store_helpers.py` (#684 cold-download check and #685
  run-keyed naming touch different hunks); `backend/routes/admin/surf_forecast.py` `_RATING_FLAGS` keeps BOTH new
  registrations (`PRODUCT_RUN_KEYED_NAMES`, `CONSENSUS_PERIOD_MEDIAN`); `forecast-ingest-pilots.yml` env keeps both
  declarations. No flag registration was dropped.
- Ledger fragments are per branch (`ledger.d/claude--*.jsonl`) and merged without conflict.
- A semantic collision git did not flag: #678's `frontend/src/tests/killSwitch.inventory.test.js` (every
  `__RAW_DISABLE_*__` in `components/map` must be TESTED or EXEMPT) met #674's four new switches once dev was merged
  back, and failed: `__RAW_DISABLE_COLD_PREVIEW__`, `__RAW_DISABLE_REGIONAL_PREWARM__`, `__RAW_DISABLE_VEIL_WORDS__`,
  `__RAW_DISABLE_WIND_TIME_BLEND__`. Each shipped in #674 with a focused test that sets the switch and asserts the
  prior behaviour (`marineColdPreview`, `staticRegionalPrewarm`, `marineColdVeil`, `windTimeBlend` /
  `forecastReadout.windBlend` tests), so they were added to `KILL_SWITCHES_TESTED`, citing those tests; the shrink-only
  EXEMPT list did not grow. Inventory plus those five files: 6 suites, 53 tests passed; `check_eslint.js` exit 0.
  The same happened again after #672 merged in (`__RAW_DISABLE_RATING_FRAMES__`, hosted run 41533937636: 1 failed of 8157
  Jest tests, only this one); `staticRatingFrames.test.js` sets the switch and asserts no static surf ask, so it is TESTED
  too. Every backend lane on that run read the projection exactly: guards 3351 / 213 files, chain 3155 / 187, estate 3408.

## Floors (re-derived from the combined branch)

Per-file counts, collected at the batch head vs the same file on dev (`pytest --collect-only`): `test_gate_v2.py` 48
(new), `test_product_run_keys.py` 26 (new), `test_consensus_product.py` 56 vs 21 = +35, `test_product_revision_refresh.py`
43 vs 41 = +2 (#684 had not moved the floor), `test_scored_rows_gate.py` 44 vs 44, `test_routes_flags_not_in_registry.py`
2 (new). Lane membership from `scripts/ci_test_lanes.py` (partition OK: guards 213, chain 186, estate 366 files).

`python backend/scripts/rederive_floor.py`, last re-run after #672 (base = max(dev's last green hosted read, dev's map)):

| Lane | Dev | Added | Set from | Floor (MIN_PASSED) | Files |
|---|---|---|---|---|---|
| guards | 3351 / 213 files (map 3351) | +0 | 3351 | 3345 → 3345 | 213 |
| chain | dev map 3044 (hosted 3035 + #672's 9) / 185 files | +48 (#683) +2 (#684) +26 (#685) +35 (#686) = +111, +2 files | 3155 | 3038 → 3149 | 185 → 187 |
| estate | 3406 (map 3406) | +2 (#678) | 3408 | 3404 → 3406 | n/a |

Hosted CI must read guards 3351, chain 3155, estate 3408 passed. Before #672 landed, hosted CI on head `82238ff7f`
(run 41525255530) read exactly the then-projection: guards 3351 / 213 files, chain 3146 / 186 files, estate 3408; Jest
624 suites / 8148 tests.

## Local verification (from `C:/t/wb2/backend`, the main checkout's venv)

- flake8 `--select=E9,F63,F7,F82`: clean. `check_file_size.py --max-lines 800`: 0 violations.
- pytest `test_ci_floor_staleness`, `test_flag_lane_parity`, `test_consensus_product`, `test_gate_v2`,
  `test_scored_rows_gate`, `test_product_revision_refresh`, `test_product_run_keys`, `test_routes_flags_not_in_registry`,
  `test_rederive_floor`: 301 passed.
- `memory_audit.py --docs-only`: 0 FAIL.

## After merge

Merge this PR as a MERGE COMMIT (not squash), so each PR's commits and fragments land as written; then close
#678 #683 #684 #685 #686 as landed. Flag flips stay with the owner (D-001): `PRODUCT_REVISION_REFRESH` (D-064, Render),
`PRODUCT_RUN_KEYED_NAMES`, `CONSENSUS_PERIOD_MEDIAN` (after `ICON_PEAK_PERIOD`).
