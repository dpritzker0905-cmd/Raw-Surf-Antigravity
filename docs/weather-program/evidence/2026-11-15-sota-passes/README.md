# Evidence: SOTA research passes 1 to 5 (2026-11-15)

Companion to `docs/weather-program/log/2026-11-15-researcher-sota-passes-1-5.md`. Public data only (NDBC realtime2 and
historical stdmet and spectral files; Open-Meteo marine API, model `ncep_gfswave025`, analysis best-estimate fields).
Python 3 standard library only. Each script writes its summary JSON next to itself.

## Run order

Each script imports the earlier ones, so run them from this folder in this order.

1. `d1_direction.py`: pass 1, 2026 realtime2 window, direction and height, 24 h persistence. Shared helpers live here.
2. `d2_multiyear.py`: pass 2, 2025 stdmet against the model, land-mark rule, lead-24 fields where present.
3. `d3_pass3.py`: pass 3, leave-one-quarter-out, bias by observed and forecast height.
4. `d4_holdout.py`: pass 4 and 5a, station offsets fit on 2024 and tested on 2025.
5. `d5_swell.py`: pass 5b, realtime2 `.spec` SwD like-for-like against model swell direction (threshold 0.5 m).
   `d5_emin.py` is the same test at 1.0 m: `EMIN=1.0 python d5_emin.py`.
6. `d6_shape.py`: pass 5c, height shape and forecast-side selection. It builds `d6_rows.json` on first run (about
   11 MB, not committed) and reads it on later runs.
7. `d7_gap_check.py`: archive-gap check (2024 null hours by month) and live Open-Meteo probes at 46086, 41043, 51003
   with a 2025 control.
8. `d8_checks.py`: land probe at an inland cell and the reverse holdout (fit 2025, test the 2024 hours that exist).

## Notes

- The `.spec` columns are read from the names row. In the current realtime2 format SwD is column 10 (not 11). A header
  guard stops the run if the layout changes, so a wrong column cannot write numbers.
- Open-Meteo `ncep_gfswave025` returns null wave height and period at every probed cell from 2024-01-01 to about
  2024-06-18. The pass-2 land rule treats null as land, so the 2024 fits in passes 4 and 5a cover June 19 to December
  31 only (log, F1). The 2025 control has no gap.
- The scripts do not cache downloads, except `d6_shape.py`, which caches the hourly pairs in `d6_rows.json`.
- The blind replication (log section "Blind replication") was run from a separate folder outside the repo and is not
  part of this evidence.
