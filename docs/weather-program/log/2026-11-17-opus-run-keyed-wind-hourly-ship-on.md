# 2026-11-17 — opus: PRODUCT_RUN_KEYED_NAMES and FRAME_WIND_GFS_HOURLY ship ON (the owner's yes)

Session: the frame-carry side session. The owner answered in this session at 08:36 EST: "Yes, both". He was asked whether to
turn on hourly GFS wind and run-keyed product names, after being told that the run-keyed rollout changes a Render setting first
and then watches storage cleanup. Written 13:55Z.

## PRODUCT_RUN_KEYED_NAMES, in the order of its own rollout (log 2026-11-01-claude-run-keyed-products.md, "Migration")

1. **Render env first (done).** `PRODUCT_RUN_KEYED_NAMES=1` was set on srv-d7fhiu7lk1mc73debje0 at 13:47Z.
   - It triggered deploy dep-dbu5lurm8hqs73e6s6dg, live 13:50:10Z, at 2fcbd8153 (#1003).
   - The previous live deploy was 38c9060fc (#1000). The only server change carried along is 5 lines in the offline
     wind-hindcast `ens_wind_fetch.py`.
   - `/api/health`: 200 in 1.28 s at 13:46:28Z (before), 200 in 0.69 s at 13:51:24Z (after).
   - On the box, the flag drives only the disk sweep, which sheds run-keyed files the manifest no longer names. It is
     harmless while no run-keyed names exist.
2. **The writers (this PR).** forecast-ingest, forecast-ingest-pilots and precompute default `'1'`; the kill switch is the
   repository variable `PRODUCT_RUN_KEYED_NAMES = '0'`, which is David's word, or a revert of this PR.
   - `test_only_the_canonical_on_value_enables_it` proves '0' (and unset at code level) saves the legacy name, the
     pre-flip output.
   - The code default (`product_run_keys.enabled`, the registry's "0") stays off. Only the three writers and the box turn
     it on, so tests and local runs keep legacy names.
3. **Measure after merge, as the rollout says** (owed; this session does it):
   - one GFS pilot box on the live box across two runs: its `run_time` follows the manifest within one restore;
   - `Product object GC: {...}` in the ingest log;
   - the storage object count flat across cycles;
   - 0 "Stored product path not found" for run-keyed names.
   **Rollback:** the repo variable to '0'. The Render flag may stay on. Leftover run-keyed objects stay until
   `scripts/sweep_orphaned_l2.py --delete --yes`.
   **Storage before:** weather-products 60.55 GB / 25,288 objects (read-only aggregate, 2026-11-17 ~06:45Z).

## FRAME_WIND_GFS_HOURLY: its own PR, under D-065

It moves a served number: the wind between the 3-hourly steps becomes NOAA's own hourly field to f120, so the ratings that
read wind at those hours move too. So it ships with its code default ON, a kill switch, its registration in `_RATING_FLAGS`, a
SCOREBOARD row, and the default-on history filter before merge. It also adds about 80 hourly wind frames to the FRAMES
step, inside #996's 1,500 s. The first pilots run after it merges rebuilds the wind set with new hours, so under the
frames-budget plan's item 3 it is excluded and named before its gate lines are read.
