# 2026-11-24 · reliability lane, PR 3: frame-set freshness (report only) and no fail-green publish steps

Evidence: inspection 2026-11-23 finding 5. The marine, wind and rated frame sets had no freshness monitor and no client
age check, and their publish steps run with continue-on-error.

## Measured first (read-only `gh api`; instruments in the reliability notes)

- **Continue-on-error steps:** 28 in `forecast-ingest-pilots.yml` (job `ingest-pilots`) and 2 in `forecast-ingest.yml`.
- **Masked failures:**
  - The jobs API reports a masked step as `success`, so it shows 0 failed steps. The check-run annotations ("Process
    completed with exit code 1") are the instrument that sees them.
  - Pilots: 5 of the last 60 green runs (since 2026-11-10T05:01Z) had a step exit non-zero.
  - Core: 1 of the last 60 green runs (since 2026-11-15T15:40Z).
  - Steps named from the logs that are still kept:
    - pilots 43239161836 (11-12): "Publish raster static frames (ICON pressure)";
    - core 44678349923 (11-20 05:02Z, during the credential outage): "Rebuild the lane-window static wind frames"
      ("GFS/wind/wind/global_mid: only 120/193 authoritative entries have a frame ... nothing uploaded").
- **Frame-set ages** (public `v1/latest.json`, 2026-11-24 ~03:10Z, 259 sets, 221 non-raster):

  | model / family | sets | run age range or median |
  |---|---|---|
  | GFS marine | 80 | 15.2 h |
  | GFS rated | 80 | 15.2-27.2 h (median 21.2), up to 12 h behind its marine set |
  | ICON marine | 48 | 15.2 h |
  | ICON rated | 3 | up to 27.2 h |
  | EURO marine | 22 | 15.2-27.2 h (the Copernicus-sourced layers, inspection item 10) |
  | CMEMS | 2 | 27.2 h |

  Against the bounds below, 60 of the 80 GFS rated sets are stale.

## What changed

- `scripts/publish_outcome_gate.py` is the last step of both ingest jobs (`if: !cancelled()`). It reads
  `toJSON(steps)` and ends the run RED, naming each step whose outcome is failure but whose conclusion is success. Every
  continue-on-error step got an id, so the gate can see it. The other steps still run, and precompute triggers on any
  conclusion. Kill (warn and stay green): repo variable `PUBLISH_FAIL_GREEN_OK=1`.
- `scripts/frame_set_freshness.py` runs in the Data Health Monitor, REPORT ONLY. Bounds: GFS 18 h; EURO, ICON and
  ECMWF_ENS 30 h; CMEMS 48 h; each overridable with `FRAME_STALE_HOURS_<MODEL>`. It reports per model and family, and
  how far each rated set trails its marine set.

## Next

- Read a week of the report, then decide whether the bounds page.
- Separately: why the GFS rated sets trail marine by a cycle or two (the rated publish runs inside pilots; a
  precompute or rated-publish lag).
