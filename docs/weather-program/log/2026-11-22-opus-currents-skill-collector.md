# 2026-11-22 · opus · currents-skill-v1 collector and scorer (dark build; nothing dispatched)

Lane: started by the director (local_d6b521eb) on 2026-11-22. David was away, so this is a dark build only with no dispatch. It builds the collector and scorer for the registration `gates/currents-skill-v1.md`, which is in #1143 and was gated PASS at `7e7a34bc3`. Branch `claude/currents-skill-collector`, cut from `dev` `f6f5b456f`.

**Serves nothing.**
- No served number changes, so there is no SCOREBOARD row.
- No workflow runs without the owner's typed word. Both workflows are `workflow_dispatch` only and require `owner_word_ref`.
- No fetch was made from this machine except one read of ERDDAP metadata (the HF-radar dataset search, below).

## What was built

| Piece | File | Registration section |
|---|---|---|
| Collector | `backend/scripts/currents_skill_collect.py` | 2, 3, 9 |
| Arm readers + shared 25 h filter | `backend/scripts/currents_skill_arms.py` | 1, 4 |
| Truth readers | `backend/scripts/currents_skill_truth.py` | 3 |
| M1 / M2 rows | `backend/scripts/currents_skill_metrics.py` | 4 |
| Statistics | `backend/scripts/currents_skill_stats.py` | 5, 6 |
| Controls | `backend/scripts/currents_skill_controls.py` | 7 |
| Zones, geodesy | `backend/scripts/currents_skill_geo.py` | 3 (T2) |
| The one look | `backend/scripts/currents_skill_score.py` | 2, 5-8 |
| Archive (the wind-lr2 pattern) | `backend/scripts/currents_skill_archive.py` | 2 |
| Workflows | `.github/workflows/currents-skill-collect.yml`, `currents-skill-score.yml` | 2, 8, 9 |

**Collector modes:**
- `frames` copies every arm's published set (CMEMS_025, GIOPS_025, RTOFS_025) from the public `weather-frames` bucket.
  - It reads the current index and the previous one. Retention keeps two runs, which leaves a one-day margin for pass 2.
  - Each frame's sha256 is checked against its index entry.
  - A set that is not published is recorded as ABSENT.
- `native` reads CMEMS_083, the 1/12° subset, for the three US radar boxes only. It uses the same ARCO store the served set reads, fetching only the chunks that cover each box.
- `hfr` takes one ERDDAP request per region-day and saves a sparse npz per region: every hour, only the cells that ever hold a velocity, raw values. The dataset's `license`, `acknowledgement` and time range are saved verbatim.
- `drifters` runs the `copernicusmarine` toolbox with credentials passed by name.
- Every file written is listed with its sha256 in `MANIFEST.json`.

**Archive.** The archive copies everything to `weather-products/calibration/currents-skill/<run>-<attempt>/`. `SHA256SUMS` is written last. An archive without it is INCOMPLETE and is never read as evidence.

**Scorer:**
- verifies every archive, then pairs per arm;
- applies the missing-run, 50-init, 15% and floor rules;
- builds M1 rows: the shared hour mask, identical rows across the arms present, per-arm missing counts;
- builds M2 rows: RK4 at 1 h on the 25 h low-passed field, beaching scored, and STILL;
- runs the families with Holm per arm (better, worse, equivalence) and the halves rule;
- gives BETTER / COMPARABLE / WORSE / NOT SHOWN, G3 against PERSIST_<src>, and the 3- and 10-day block sensitivity;
- runs every control.

**Reported items NOT built in this PR** (listed in the report's `not_built`): PERSIST_OBS, CMEMS_1H, SMOC, complex correlation, D0 RMSE, the HFRNet 25 h RTV cross-check, and the European radar totals. All are reported-only. None gates.

## Checks

Tests (57, all estate lane; `ci_test_lanes.py --lane estate` lists all 5 files):

| File | Tests | What they pin |
|---|---|---|
| `test_currents_skill_stats.py` | 13 | Holm, blocks, null = 0, RMSE ratio, TOST in/out of margin, labels, floors, VOID |
| `test_currents_skill_rows.py` | 17 | frame decode (2-byte and one-byte), bilinear, time weights, 25 h filter removes an M2 tide, mask, identical rows, plants, RK4, beaching, STILL, Liu-Weisberg, zones |
| `test_currents_skill_io.py` | 9 | frame copy with sha refusals, native chunk reads, HFR URL / sparse snapshot / validity rule / 70% presence, drifter QC / binning / 20 h rule, archive + download + INCOMPLETE |
| `test_currents_skill_score.py` | 9 | a 60-init synthetic TEST: GIOPS equals the truth, so it is BETTER at every lead; >15% dropped VOIDs the run; each control fires on a planted defect |
| `test_currents_skill_workflows.py` | 9 | dispatch-only, owner word, no `${{` in `run:`, secrets by name in `supabase-service` only, archive with sha256 |

Gates:
- **Floor fragment:** `.github/ci-floors.d/claude-currents-skill-collector.estate.json` (+57).
- **Lint and size:** `flake8 --select=E9,F63,F7,F82` is clean. Every new file is under 800 lines; the largest is the collector, at about 410.

## Cost per run (estimated, not measured; nothing was dispatched)

| Mode | Pulled | Kept | Notes |
|---|---|---|---|
| frames | about 3 × 31 frames, each 0.4-1.1 MB gzipped: about 50-100 MB a day (two runs per set) | the same | |
| native | about 2 chunks × 2 variables × 31 steps × 3 boxes; each chunk is 512 × 2048 float32 (blosc), about 1-4 MB | about 5 MB of npz a day | |
| hfr | to be measured on the first dispatch | sparse npz | about 9 requests per region; the East Coast grid is the largest |

## AMENDMENT QUESTIONS (ambiguities found while building; the builder's reading is in place, the advisor decides)

- **A1, which frames to score.** "What the map serves" for CMEMS / GIOPS / RTOFS is now the one-byte frame: a 0.02 kn speed band plus ONE flow direction per 2 × 2 block, in 5.6° steps (#1137).
  - Built: each node's vector is its own band speed along its block's direction. That is exactly what the particles draw.
  - Alternative: the collector rebuilds full-precision u/v from source at each init. That is a second fetch per source, not what the map serves.
  - If the direction byte is killed (`FRAME_RASTER_DIR_BYTE=0`), a frame has no vector and the step is missing.
- **A2, the first scored step.** Section 1 says every arm's first served step is 6 h. In fact CMEMS (0-240 h) and RTOFS (0-192 h) also publish 0 h.
  - Built: every arm is scored from 6 h, and PERSIST holds the 6 h step for all arms (equal footing).
- **A3, the start of M2's filtered field.** At lead hours 0-7, fewer than 20 hours of any arm's field exist in the 25 h window, because steps start at 6 h.
  - Built: the window is truncated to the defined hours (`need=1`), identically for every arm.
  - Alternatives: seed at +12 h, or require 20 hours (then no particle moves before about 8 h).
- **A4, zone precedence.** The registration does not order the zones.
  - Built: the listed order, COAST50 > SHELF > WBC > EQ > OPEN. A Gulf Stream point 30 km off Cape Hatteras is therefore COAST50.
- **A5, the bathymetry source.** The registration names ETOPO 2022.
  - Built: the repo's ETOPO1 0.25° asset (`services/weather_pipeline/data/etopo_depth_0p25.npy`), with the coast distance taken as the distance to the nearest land cell centre.
  - ETOPO 2022 15 s would need a fetch (the wind-lr2 `EtopoMask` pattern).
- **A6, drifter hours.** Fixes are binned to the nearest hour. An hour with no fix is missing and never interpolated. Only QC flag 1 counts as good.
  - Argos-tracked drifters (fixes 1-2 h apart) may fail the 20-of-25 rule often. Should flag 2 ("probably good") count, and should gaps of 1 h or less be interpolated?
- **A7, COMPARABLE versus WORSE.** A cell can pass TOST (inside ±10%) and also be significantly worse.
  - Built: precedence BETTER > COMPARABLE > WORSE, with `worse_significant` reported beside every label.
- **A8, the collection horizon.** The D7 window (centre 168 h, ±12 h) needs steps to 180 h. Section 2 says "leads 0-168".
  - Built: collect to 180 h; an init is complete with every step from 6 to 168 h, and D7 rows need the steps to 180 h.
- **A9, dataset IDs.**
  - CoastWatch now lists the US West and East mirrors only as `ucsdHfrW6_Lon0360` / `ucsdHfrE6_Lon0360` (searched 2026-11-22; `ucsdHfrW6` returns 404).
  - The PRVI mirror `ucsdHfrP6` reads from `.../dodsC/hfradar_prvi_6km`, not `hfradar_usprvi_6km`.
  - Built with the live IDs. Hawaii's PacIOOS ID `hfradar_ushi_6km` is still unconfirmed (confirm at freeze).
- **A10, the arm for the direction plants.** Section 7 names GIOPS_025 for the speed plants only.
  - Built: the direction plants also rotate GIOPS_025, on the same 15% of rows per init (seed `[20261122, init]`).
  - The speed plant is added to the filtered row vector. The direction plant is applied before the low-pass, as written.
- **A11, the daily cadence under "dispatch-only".** Retention keeps two runs, so a daily `frames` + `native` collection needs a dispatch at least every other day for 60 days.
  - Can one owner word cover the whole TEST window?
  - Or should a schedule be added behind a repo variable after the owner's word? The director asked for dispatch-only; this is the open cost of that choice.
- **A12, CMEMS_083 under M2.** The native subsets cover only the three US radar boxes. A drifter seeded outside them is missing for CMEMS_083, not STILL.
  - CMEMS_083's M2 zones will therefore be thin, and are likely "insufficient" outside COAST50 / SHELF.

## Open before any dispatch (owner's word)

1. The advisor reads this build: the director sends the head.
2. Answers to A1-A12, as an amendment file if any reading changes.
3. The freeze record (section 9):
   - the HFRNet attributes;
   - the drifter subset names and product version;
   - RTOFS tides;
   - RTOFS ≥ 7 daily runs. RTOFS is dark today (`FRAME_RASTER_CURRENTS_RTOFS` unset), so it is ABSENT unless it publishes first.
   - GIOPS is dark too (`FRAME_RASTER_CURRENTS_GIOPS` unset). The collector copies only PUBLISHED sets, so GIOPS_025 has no
     rows until its publisher is switched on. That is an owner decision: it publishes frames, though it changes no served number.
4. David's word for each dispatch.
