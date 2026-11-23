# Gate: served-wave-verify-v1
Stamp: 2026-11-22 (research lead; DESIGN AND PRE-REGISTRATION ONLY. Nothing is built, nothing is dispatched, and no record exists. Collection needs David's word: it adds a workflow and storage writes.)
Candidate: a point archive of the SERVED wave frames. At publish time, each newly published GFS / EURO / ICON wave run is sampled at a frozen list of buoys. The records are scored later against buoy observations, so the wave forecasts we serve can be verified after the fact (Q9, #1166: the public store keeps only the latest 2 GFS-Wave runs, so the 24-48 h bin was n = 0).
Metric: per (model, variable, lead bin, region): bias, RMSE, scatter index (RMSE / mean observed), and for directions the circular mean absolute error. Each cell carries n and its status (section 6).
Pass threshold: an ACCEPTANCE gate for the archive, not a skill threshold. The archive is accepted when all of these hold: decoder parity (section 4), the golden fixture (section 7), coverage over the first 14 days of collection (section 8) and the storage budget (section 9). No skill number decides anything here.
Controls: decoder parity on a frozen frame (Python vs the client's `decodeFieldCore`); a golden fixture with hand-checked expected scores; a planted bias (+0.20 m on one model's Hs in the fixture) that the scorer must report; a status-code census (every expected record accounted for).
Decision rule: accepted archive → rolling skill tables published (section 10). Using those tables for consensus weighting is OUT OF SCOPE: it needs its own gate, with caps and hysteresis. CDIP rows are EXAM-only and can never feed weighting (section 3).
Unmeasured items: EURO swell partitions (EURO swell exists only at 10° today, not in the served wave set); any model or set not in `frame_set.SETS` at freeze; the `/point` path that the hub and rating read (a different serve path from the frames: section 12).
Served change: none. The sampler only reads published frames and writes records to a separate store.

## 1. Why a point archive (decided)
- The options were:
  - (a) keep full frames;
  - (b) a point archive;
  - (c) verify upstream model output only;
  - (d) wait.
- SubQ (model confidence 0.998, a ranking weight, not a statistic), Reflection and LongCat (relayed by the director) all chose (b).
- **Reasoning recorded here:**
  - (a) costs about 56 KB per frame × every lead × every run, kept forever.
  - (c) scores NOAA/ECMWF/DWD, not what we serve after our decode, quantisation, land mask and blends.
  - (d) leaves Q9's n = 0 permanent.

## 2. Where the sampler runs
- **Placement:** a separate GitHub Actions job (`served-wave-verify-sample`) that `needs:` the publish job in `forecast-ingest-pilots.yml`. It reads only what the publish job wrote to the PUBLIC `weather-frames` bucket (the immutable run index plus that run's frames), through the same anonymous public read the client uses.
  - It never uses the service-role key to READ frames.
  - Its only write is the record store (section 9).
- **It cannot block or slow the publish.** It runs after the publish, `continue-on-error: true`, with its own timeout (10 min), and never touches the Render box.
  - A failed sampling run writes a `sampler_fail` row (section 5), so a gap is visible.
- **Trigger:** once per newly published run per model (keyed by `run_hash`). A run already sampled is skipped, so re-publishes are idempotent.
- **Kill switch:** repository variable `SERVED_WAVE_VERIFY=0` skips the job. The default is `0` until David's word; then it is set to `1`.

## 3. Frozen buoy list
- **File:** `docs/weather-program/gates/served-wave-verify-v1-buoys.json`, versioned (`buoy_list_version`). `buoy_list_hash` is the SHA-256 of its canonical JSON, and both go in every record.
- **Size and spread:** about 100 stations. Target counts per region:
  - US West 20, US East 15, Gulf 8, Hawaii 8, Alaska 5;
  - Canada Pacific and Atlantic 8 (ECCC buoys mirrored by NDBC);
  - Caribbean / Puerto Rico 6;
  - open-ocean NDBC/TAO-adjacent wave buoys 10;
  - the remainder chosen to cover gaps.
- **Selection rule:** an active NDBC station reporting WVHT; depth >= 20 m, unless it is named as a NEARSHORE stratum; distinct WMO ID. Each station is tagged:
  - `region`;
  - `depth_m`;
  - `sheltered` (inside a bay or behind an island, by the build's rule written in the list file);
  - `source` (`ndbc` | `cdip`);
  - `exam_only` (true for every CDIP station).
- **CDIP:** CDIP stations may be sampled and scored. They are EXAM only, under the standing rule:
  - their scores are reported in a separate `exam` table;
  - they never enter a pooled cell;
  - they never feed consensus weighting or any fitted parameter.
- **Freeze:** the list is committed, and the advisor gates it, before the first record. A change is a new `buoy_list_version`. Scores never pool across versions unless the station is identical in both.

## 4. Decoder parity (LongCat's top risk)
- The sampler must report what the client renders. The client decodes frames with `decodeFieldCore` (`frontend/src/components/map/ownRasterDecode.js`). The backend encoder is `services/frame_binary.py` (magic `RSWF`, encoding version 1).
- **Chosen path:** the sampler runs the client's own decoder in Node (the repo's `.node-version`, 24.22.1), importing `ownRasterDecode.js` unchanged. A Python reimplementation would be a second decoder to keep in sync.
- **CI parity test** (required before collection):
  - one frozen frame per frame set (GFS waves, swell_1, swell_2, wind_waves; ICON waves, swell_1, wind_waves; EURO waves) is committed as a fixture;
  - the Node sampler's values at 50 fixed nodes per frame must equal `frame_binary`'s decode bit-for-bit for integer bands, and within `frame_binary.TOLERANCE` for decoded floats;
  - a mismatch fails CI.
- **Versioning:** every record carries `decoder_version`, the git blob SHA of `ownRasterDecode.js` at sampling time. A decoder change starts a new segment: scores across a decoder change are reported per segment, never pooled silently.

## 5. Cell rule
- **Grid snapshot:** for each (model, frame set, tier), the frame header's grid (cols, rows, bounds, node order) plus its land/missing mask define a `grid_hash` (SHA-256 of the header geometry and the mask bitmap).
- **Buoy → cell:** the nearest WET cell (a cell whose Hs is not the missing value in the snapshot's mask), by great-circle distance from the buoy to the cell centre.
  - **Tie-break** (equal distance to 1e-6 km): the lower row index, then the lower column index.
  - **Maximum distance:** 0.75 × the cell diagonal of that grid (about 26 km for 0.25°). Beyond it the buoy gets `distance_exceeded` and NO substitute cell.
- **Cache:** the (buoy → cell index, cell lat/lon, distance_km) table is computed once per `grid_hash` and stored beside the records. A new grid hash recomputes it, and the change is logged.

## 6. Record (one per model, run, buoy, lead)

| Field | Content |
|---|---|
| `model`, `frame_set`, `tier` | e.g. `gfs`, `waves`, `global_mid` |
| `run_time`, `valid_time`, `lead_h` | from the frame header (`runEpoch`, `validEpoch`) |
| `buoy_id`, `buoy_list_version`, `buoy_list_hash` | |
| `cell_row`, `cell_col`, `cell_lat`, `cell_lon`, `distance_km` | from the cache |
| `hs_m`, `tp_s` and/or `tm_s` (as served), `dir_deg` | the `waves` set, decoded |
| `swell1_*`, `swell2_*`, `windwave_*` (height, period, direction) | where the model's served sets carry them; else absent, never zero |
| `run_hash`, `frame_hash` (SHA-256 of the frame object), `grid_hash`, `decoder_version`, `sampler_version` | provenance |
| `status` | `ok` \| `cell_masked` \| `distance_exceeded` \| `sampler_fail` |

- **Who sets which status:**
  - The sampler writes `ok`, `cell_masked` (the cached cell is missing in this frame), `distance_exceeded` and `sampler_fail`.
  - `buoy_qc_fail` and `no_obs` are set by the SCORER on the joined row. The raw record is never edited.
- **Leads sampled:** every published frame step up to 240 h. Steps beyond 240 h are not sampled in v1.

## 7. Scorer
- **Observations:** NDBC realtime2 standard meteorological (`.txt`) and spectral summary (`.spec`) files, fetched once per buoy per day by the scorer job, never at sampling time.
  - Mapping: WVHT → Hs, DPD → Tp, APD → Tm, MWD → direction. Swell and wind-wave partitions use SwH/SwP/SwD and WWH/WWP/WWD from `.spec`.
  - The partition definitions differ between the model and NDBC, so partition scores are labelled "indicative".
- **QC:**
  - NDBC missing codes (99.00, 999, 9999) are dropped.
  - Hs outside 0-25 m is dropped.
  - A value equal to the previous 6 consecutive values is a stuck sensor and is flagged.
  - Directions are used only when Hs >= 0.3 m.
  - A flagged observation → `buoy_qc_fail`.
- **Collocation:** the observation nearest the valid time within ±30 min. None → `no_obs`.
- **Lead bins:** [0,24), [24,48), [48,72), [72,120), [120,168), [168,240) h. The edges are written here and fixed.
- **Metrics:** for each bin:
  - bias = mean(f - o) and RMSE;
  - scatter index = RMSE / mean(o) (Hs and periods);
  - for direction: the circular error `((f - o + 180) mod 360) - 180`, giving its mean absolute value and its circular mean.
- **Breakdown:** model × variable × lead bin × region, plus a pooled `all regions` row. CDIP is in the separate exam table.
- **Minimum n:** a cell needs n >= 100 collocated `ok` pairs from >= 3 buoys and >= 10 distinct runs. Below that it reads `insufficient` with its n shown, never 0 and never blank.
- **Golden fixture (CI):**
  - one archived run's records (a real sampled run, frozen), one NDBC response per buoy for the same window, and the expected score table, computed by hand in a notebook committed beside it;
  - the scorer must reproduce that table to 1e-9;
  - the planted control (+0.20 m added to that run's Hs) must move the bias by +0.20 m and leave the other models' rows unchanged.

## 8. Coverage acceptance (first 14 days of collection)
- **Census:** for each model, (records written) = (runs published) × (buoys on the list) × (sampled leads). Every expected record is either written with a status or counted as a `sampler_fail`. No unaccounted gap is allowed.
- **Reach:** `ok` must be at least 80 % of records for GFS and ICON and 70 % for EURO (coarser grid near coasts). The shortfall is broken down by status.
- **Q9 bin:** the [24,48) bin must reach `n >= 100` for GFS by day 14. This is the bin Q9 could not fill.
- If coverage fails, the archive is not accepted. The fault is fixed and the 14 days restart. No skill table is published from an unaccepted archive.

## 9. Storage (estimate; measured in the first week and reported)
- **Assumptions:**
  - runs per day: GFS 4, EURO 4, ICON 2 → 10;
  - about 100 buoys;
  - about 70 sampled steps per run to 240 h (hourly early, 3-hourly later; the mix differs by model);
  - about 250 bytes per JSON record.
- **Volume:**
  - 10 × 100 × 70 ≈ 70,000 records per day, about 2.1 M per month;
  - about 525 MB per month raw JSON, about 60-100 MB per month as gzipped JSONL (one object per model-run);
  - the score tables are under 1 MB per month.
- **Retention:**
  - raw records for 36 months (about 2-3.6 GB at the estimate), then pruned by a dated job;
  - score tables and the buoy / grid / decoder version tables kept indefinitely.
- **Store:** a new path prefix `verify/served-wave/v1/` in a non-public bucket, written by the Actions job with the publish job's existing storage secret (`SUPABASE_SERVICE_ROLE_KEY`, by name only), used for this WRITE only. It is never written from the Render box.
- **Budget check:** if the measured first-week volume exceeds 2× the estimate, collection pauses and the director is told before it continues.

## 10. Output
- Rolling skill tables (30-day and 90-day windows, updated daily): model × lead bin × region × variable, with n and status, published as JSON beside the records.
- **What they may be used for:** reading, the Truth/HUD diagnostics, and later gates.
- **What they may not be used for:** consensus weighting. That needs its own gate (caps, hysteresis, a held-out window, CDIP excluded). These tables are its input, never its decision.

## 11. Known limits, written now
- **Representativeness.** A buoy measures a point; a cell is 0.1°-0.25° (EURO coarser). Near coasts and islands the nearest wet cell can sit in different water than the buoy. `distance_km` and the `sheltered` and `depth_m` tags are reported, and sheltered buoys are a separate stratum, never pooled with exposed ones.
- **Sensor changes.** NDBC hull, payload or software changes can shift a buoy's statistics. The scorer reads station metadata monthly and logs a change. A changed station starts a new segment.
- **Partitions.** Model partitions (swell_1, swell_2, wind waves) and NDBC's split of the spectrum are defined differently. Partition scores are indicative, not verdicts.
- **Served ≠ point.** The frames are what the MAP draws. The hub and the rating read `/point` and the surf chain (nearshore BREAKING height), so this archive verifies offshore served frames, not surf height.
- **Quantisation.** Frames are quantised by the encoder, so scores include that error. That is intended, because it is what users see.
- **Seasonality.** The first windows are northern winter. The rolling tables show their window; no season is extrapolated.

## 12. Not in v1
- Steps past 240 h; EURO swell partitions; regional tiers other than the one named per set at freeze (the build names one tier per set, the one the map shows at zoom 3-6); `/point` verification; any use for weighting.
