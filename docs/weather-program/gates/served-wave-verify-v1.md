# Gate: served-wave-verify-v1
Stamp: 2026-11-22 (research lead; DESIGN AND PRE-REGISTRATION ONLY. Nothing is built, nothing is dispatched, and no record exists. Collection needs David's word: it adds a workflow and storage writes.)
Candidate: the program's ONE point archive (section 0), first filled by its `served` purpose: a point archive of the SERVED wave frames. At publish time, each newly published GFS / EURO / ICON wave run is sampled at a frozen list of buoys. The records are scored later against buoy observations, so the wave forecasts we serve can be verified after the fact (Q9, #1166: the public store keeps only the latest 2 GFS-Wave runs, so the 24-48 h bin was n = 0).
Metric: per (model, variable, lead bin, region): bias, RMSE, scatter index (RMSE / mean observed), and for directions the circular mean absolute error. Each cell carries n and its status (section 6).
Pass threshold: an ACCEPTANCE gate for the archive, not a skill threshold. The archive is accepted when all of these hold: decoder parity (section 4), the golden fixture (section 7), coverage over the first 14 days of collection (section 8) and the storage budget (section 9). No skill number decides anything here.
Controls: decoder parity on a frozen frame (Python vs the client's `decodeFieldCore`); a golden fixture with hand-checked expected scores; a planted bias (+0.20 m on one model's Hs in the fixture) that the scorer must report; a status-code census (every expected record accounted for).
Decision rule: accepted archive → rolling skill tables published (section 10). Using those tables for consensus weighting is OUT OF SCOPE: it needs its own gate, with caps and hysteresis. CDIP rows are EXAM-only and can never feed weighting (section 3).
Unmeasured items: every tier other than the ONE named per set in section 2a (the 0.25° regional bundles are not scored in v1); the Gulf-filled `global_mid_filled` variants; any model or set not named in section 2a at freeze; the `/point` path that the hub and rating read (a different serve path from the frames: section 12).
Served change: none. The sampler only reads published frames and writes records to a separate store.

## 0. One point archive for the program (director, 2026-11-22)
- **Why:** #1156 (branch `claude/nearshore-moplite-archive-job`) builds its own forward archive (`nearshore_lite/archive.py`, `scripts/nearshore_lite_archive.py`, `.github/workflows/nearshore-lite-archive.yml`). It holds one canonical-JSON file per 00Z init with `SHA256SUMS`, EURO member only, leads 0-72 h, served offshore partitions plus `eta_m`, and NDBC truth snapshots.
  - Two archives would drift apart in buoy set, QC, timestamp convention and retention. (LongCat flagged this; read from the branch 2026-11-22, read only.)
- **Rule:** this gate defines the ONE point archive. Every point-forecast record in the program goes into it, tagged with `purpose`:
  - `served`: this gate;
  - `nearshore_eval`: #1156 and gate `nearshore-moplite-v1`;
  - a later purpose is added by amendment, never by a second store.

### 0.1 Shared parts
| Part | Shared rule |
|---|---|
| Buoy list | ONE frozen file (`served-wave-verify-v1-buoys.json`, section 3). Each station has a `purposes` tag. The nearshore stations are the subset chosen by #1156's registered rules (`truth.select_stations`: directional, 10-40 m, not USACE FRF Duck, not assimilated into the driving model, no unresolved harbour structure within 1 km), tagged `nearshore_eval`. CDIP is `exam_only` under both purposes. |
| QC | ONE module. It adopts #1156's `truth.py` rules: the text sentinel `MM` is global, and numeric fills are rejected by PER-FIELD ranges (WVHT 0-30 m, DPD 1-40 s, MWD 0-360°), so a valid 99° MWD is never dropped. Plus the stuck-sensor flag (section 7), and directions only when Hs >= 0.3 m. Collocation is `truth.at_hour`: nearest within ±30 min. |
| Truth snapshots | ONE immutable, hashed daily copy of each listed station's NDBC realtime2 text (`truth.snapshot`). It is written by the scorer job for every station on the list, shared by both purposes, and kept indefinitely. This closes the 45-day realtime2 gap for every purpose. |
| Time and lead | All UTC. `run_time` = the model init time (ISO 8601, `Z`). `valid_time` = run + lead. `lead_h` = an integer number of hours, valid minus run. A file is named by its run in ISO basic form (`20270115T0000Z`), as #1156 does. |
| File and integrity | One immutable gzipped JSONL (canonical JSON, sorted keys) per (purpose, model, run). Re-writing an existing file is refused, as in #1156's `archive_init`. Each prefix has a `SHA256SUMS`, and a weekly `verify_archive` run reports a mismatch, a missing file or an unlisted file. |
| Store | ONE prefix, `verify/point-archive/v1/<purpose>/<model>/`, in a non-public bucket (section 9). Truth snapshots are under `verify/point-archive/v1/truth/<station>/`. |
| Members | Every model member (GFS, EURO, ICON) is its own record, under both purposes. A blend is never stored instead of its members. A blend, if one is ever needed, is a separate record with `model = blend:<name>` plus its member list, and never replaces the members. |

### 0.2 Shared record core (schema `point-archive/1`)
- **Every record:** `schema`, `purpose`, `model`, `run_time`, `valid_time`, `lead_h`, `station_id` (or `target_id` with its linked `station_id`), `buoy_list_version`, `buoy_list_hash`, `status`, `writer_version`, `run_hash`.
- **Wave fields:** a bulk block (`hs_m`, `tp_s`, `tm_s`, `dir_deg`, as available) and `partitions`: a list of `{kind, h, tp, dir}`. This is #1156's shape, with `kind` in `swell_1 | swell_2 | wind_waves | total`. A partition the source does not carry is absent, never zero.
- **Purpose fields:**
  - `served`: the cell, frame, grid and decoder fields of section 6.
  - `nearshore_eval`: `arm` (`CHAIN`, `LITE`, ... as registered), `eta_m`, the `eta_slice_sha256`, `tide_table_generated_at`, the coefficient freeze hash, and `owner_word_ref`.

### 0.3 Retention per purpose
- `served`: raw records for 36 months (section 9).
- `nearshore_eval`: kept until that gate's result is committed, plus 36 months, so the registered result can be reproduced. Never pruned while its gate is open.
- Truth snapshots, score tables, and the buoy, grid and decoder version tables: indefinitely.
- **Durability:** the archive is NOT on the frame store's retention path. The frame publisher keeps the latest 2 runs and prunes the rest; it must never touch `verify/`, including the public score tables under `weather-frames/verify/`. The build adds a CI test asserting that the publisher's prune deletes only under its own set prefixes. A prune of `verify/` happens only by the dated retention job, per purpose, and it logs what it removed.

### 0.4 What #1156 must change (a follow-up for the nearshore lane; this gate does not touch #1156)
1. Write through the shared writer into `verify/point-archive/v1/nearshore_eval/<member>/`, schema `point-archive/1`, with `purpose = nearshore_eval`. It currently writes `nearshore-lite-archive/1` files to the job runner's `out_dir`, which does not outlive the job.
2. Add `run_time`, `valid_time` and integer `lead_h` per record, and name files by run in ISO basic form. It already has `init` and `lead_h`.
3. Read its stations from the shared frozen buoy list (the `nearshore_eval` tag), not from the dispatch input `stations`. Its `select_stations` rules become that tag's registered rule in the list file.
4. Use the shared QC and truth-snapshot module. Its `truth.py` becomes that module, moved to a shared location, so the two purposes cannot diverge.
5. Write truth snapshots once into the shared `truth/` prefix, not under its own `out_dir/truth`.
6. Record each member as its own record. `member = "EURO"` stays explicit, and any added member is a separate file. No blend replaces a member.
7. Keep what is already right and shared: immutability (refuse to re-archive), `SHA256SUMS` with `verify_archive`, `missing_run` (dropped for all arms), and the owner-word dispatch gate.

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
- **Hook (read 2026-11-22, `dev`):** every sampled wave set is published by ONE job, `ingest-pilots` in `.github/workflows/forecast-ingest-pilots.yml`, step "Publish static forecast frames" (`scripts/publish_frame_images.py`). That workflow runs on `schedule` (cron `45 3,11,19 * * *`, 3 times a day) and `workflow_dispatch`.
  - This holds for GFS, EURO and ICON alike. The core lane (`forecast-ingest.yml`) bakes the ICON/EURO 14-day tails but does not publish these world sets.
  - Because the publisher runs 3 times a day, a model run is sampled only if one of those publishes carried it. Runs the publisher skipped are counted, not invented (section 8).
- **Placement:** a separate job, `served-wave-verify-sample`, in the same workflow with `needs: ingest-pilots` and `if: always()`. It is not a `workflow_run` trigger, so it sees the exact publish it follows. It reads only what the publish job wrote to the PUBLIC `weather-frames` bucket (the immutable run index plus that run's frames), through the same anonymous public read the client uses.
  - It never uses the service-role key to READ frames.
  - Its only write is the record store (section 9).
- **It cannot block or slow the publish.** It runs after the publish, `continue-on-error: true`, with its own timeout (10 min), and never touches the Render box.
  - A failed sampling run writes a `sampler_fail` row (section 5), so a gap is visible.
- **Trigger:** once per newly published run per model (keyed by `run_hash`). A run already sampled is skipped, so re-publishes are idempotent.
- **Kill switch:** repository variable `SERVED_WAVE_VERIFY=0` skips the job. The default is `0` until David's word; then it is set to `1`.

## 2a. The ONE tier sampled per set (named now, advisor, 2026-11-22)
All sampled sets use the WORLD tier `global_mid` (2°, the plain set, not `_filled`), read from `frame_set.SETS` / `EURO_SWELL_SETS` on `dev` 2026-11-22:

| Model | Sets sampled (tier `global_mid`) |
|---|---|
| GFS | `waves`, `swell_1`, `swell_2`, `wind_waves` |
| ICON | `waves`, `swell_1`, `wind_waves` (ICON `swell_2` is a client-side blend, not a frame) |
| EURO | `waves`; `swell_1`, `swell_2`, `wind_waves` while `FRAME_EURO_SWELL_SETS` is `1` (its default) |

- **Why the world tier:** it is the only tier published for all three models over the whole globe, so every buoy has an expected record and the census is simple.
- **Its cost:** 2° is coarse near coasts. The 0.25° regional bundles that the map shows at close zoom are NOT scored in v1 (section 11). Adding them is a v2 amendment, with their own expected-count rule.
- **Gulf fill:** EURO and ICON world views can show the Gulf-filled variant (`global_mid_filled`). It differs only in Gulf of Mexico cells. Gulf buoys are tagged, and that difference is a named limit.

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
  - **Maximum distance:** 0.75 × the cell diagonal of that grid (roughly 200-240 km for the 2° world tier sampled in v1; about 26 km for a 0.25° grid). Beyond it the buoy gets `distance_exceeded` and NO substitute cell.
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
| `status` | `ok` \| `out_of_domain` \| `cell_masked` \| `distance_exceeded` \| `sampler_fail` |

- **Who sets which status:**
  - The sampler writes `ok`, `out_of_domain` (the buoy lies outside the frame's bounds), `cell_masked` (the cached cell is missing in this frame), `distance_exceeded` and `sampler_fail`.
  - `buoy_qc_fail` and `no_obs` are set by the SCORER on the joined row. The raw record is never edited.
- **Leads sampled:** every published frame step up to 240 h. Steps beyond 240 h are not sampled in v1.

## 7. Scorer
- **Observations:** NDBC realtime2 standard meteorological (`.txt`) and spectral summary (`.spec`) files, fetched once per buoy per day by the scorer job, never at sampling time.
  - Mapping: WVHT → Hs, DPD → Tp, APD → Tm, MWD → direction. Swell and wind-wave partitions use SwH/SwP/SwD and WWH/WWP/WWD from `.spec`.
  - The partition definitions differ between the model and NDBC, so partition scores are labelled "indicative".
- **QC:**
  - The shared QC of section 0.1: the text sentinel `MM` is dropped everywhere, and numeric fills are rejected by per-field ranges (WVHT 0-30 m, DPD 1-40 s, APD 1-40 s, MWD 0-360°). This replaces this draft's earlier global list of 99.00 / 999 / 9999, which would have turned a valid 99° MWD into a hole.
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
  - **until collection starts:** a hand-built SYNTHETIC fixture (records and NDBC responses written by hand, labelled synthetic), because no real sampled run exists yet. It is replaced by a real archived run (frozen) in the first PR after collection starts;
  - the fixture holds one run's records, one NDBC response per buoy for the same window, and the expected score table, computed by hand in a notebook committed beside it;
  - the scorer must reproduce that table to 1e-9;
  - the planted control (+0.20 m added to that run's Hs) must move the bias by +0.20 m and leave the other models' rows unchanged.

## 7a. Scorer workflow and readability
- **Workflow:** a new `.github/workflows/served-wave-verify-score.yml`, `schedule` cron `30 6 * * *` (daily, away from the pilots' :45 slots), plus `workflow_dispatch`. It has its own concurrency group and never runs on the Render box. Kill switch: the same `SERVED_WAVE_VERIFY` variable.
- **Score tables are public, raw records are not.** The tables (section 10) are published to a public read-only path: the `weather-frames` bucket, prefix `verify/served-wave/v1/scores/`. A dated snapshot is also committed weekly to the repo under `docs/weather-program/evidence/served-wave-verify/`, so sessions read them without any key.
- **Statuses the scorer adds:** `buoy_qc_fail` and `no_obs`. A `no_obs` row carries its cause:
  - `no_report`: the buoy did not report within ±30 min;
  - `fetch_gap`: the scorer could not fetch the file, or the time was past NDBC realtime2's 45-day window when the scorer ran.

## 8. Coverage acceptance (first 14 days of collection)
- **Census, by domain:** for each (model, set, tier), the EXPECTED count = (runs published) × (buoys inside that set's frame bounds) × (sampled leads). Buoys outside the bounds are written once per run as `out_of_domain` and are not in the expected count. With the world tier (section 2a) every buoy is inside, so `out_of_domain` should be 0 in v1. A non-zero count is reported as a fault. Every expected record is either written with a status or counted as a `sampler_fail`. No unaccounted gap is allowed.
- **Reach:** `ok` must be at least 80 % of records for GFS and ICON and 70 % for EURO (coarser grid near coasts). The shortfall is broken down by status.
- **Q9 bin:** the [24,48) bin must reach `n >= 100` for GFS by day 14. This is the bin Q9 could not fill.
- If coverage fails, the archive is not accepted. The fault is fixed and the 14 days restart. No skill table is published from an unaccepted archive.

## 9. Storage (estimate; measured in the first week and reported)
- **Assumptions:**
  - runs per day: at most 3 per model (the publisher runs 3 times a day), so at most 9;
  - about 100 buoys;
  - about 70 sampled steps per run to 240 h (hourly early, 3-hourly later; the mix differs by model);
  - the swell and wind-wave sets ride in the same record, so they add fields, not records;
  - about 250 bytes per JSON record.
- **Volume:**
  - at most 9 × 100 × 70 ≈ 63,000 records per day, about 1.9 M per month (the figures below keep the earlier 10-run figure as headroom);
  - about 525 MB per month raw JSON, about 60-100 MB per month as gzipped JSONL (one object per model-run);
  - the score tables are under 1 MB per month.
- **Retention:**
  - raw records for 36 months (about 2-3.6 GB at the estimate), then pruned by a dated job;
  - score tables and the buoy / grid / decoder version tables kept indefinitely.
- **Store:** the shared prefix `verify/point-archive/v1/served/<model>/` (section 0.1) in a non-public bucket, written by the Actions job with the publish job's existing storage secret (`SUPABASE_SERVICE_ROLE_KEY`, by name only), used for this WRITE only. It is never written from the Render box.
- **Budget check:** if the measured first-week volume exceeds 2× the estimate, collection pauses and the director is told before it continues.
- **Quota and cost (a limit, owed before the dispatch request):** 2-3.6 GB over 36 months must be checked against the Supabase project's storage quota and its cost, and written into the request that goes to David, before he is asked for his word.
- **Who reads raw records:** only the CI scorer job (section 7a), with the secret held in GitHub Actions. No session holding the service-role key reads them, and they are never published.

## 10. Output
- Rolling skill tables (30-day and 90-day windows, updated daily): model × lead bin × region × variable, with n and status, published as JSON beside the records.
- **What they may be used for:** reading, the Truth/HUD diagnostics, and later gates.
- **What they may not be used for:** consensus weighting. That needs its own gate (caps, hysteresis, a held-out window, CDIP excluded). These tables are its input, never its decision.

## 11. Known limits, written now
- **Representativeness.** A buoy measures a point; a v1 cell is 2° (section 2a). Near coasts and islands the nearest wet cell can sit in different water than the buoy. `distance_km` and the `sheltered` and `depth_m` tags are reported, and sheltered buoys are a separate stratum, never pooled with exposed ones.
- **Sensor changes.** NDBC hull, payload or software changes can shift a buoy's statistics. The scorer reads station metadata monthly and logs a change. A changed station starts a new segment.
- **Partitions.** Model partitions (swell_1, swell_2, wind waves) and NDBC's split of the spectrum are defined differently. Partition scores are indicative, not verdicts.
- **Served ≠ point.** The frames are what the MAP draws. The hub and the rating read `/point` and the surf chain (nearshore BREAKING height), so this archive verifies offshore served frames, not surf height.
- **Quantisation.** Frames are quantised by the encoder, so scores include that error. That is intended, because it is what users see.
- **Seasonality.** The first windows are northern winter. The rolling tables show their window; no season is extrapolated.

- **n ≥ 100 is descriptive.** It is a floor for showing a number, not for inference. Pairs share runs, days and weather, so they are autocorrelated. Any inferential use (a difference, an interval, a weighting) needs a block bootstrap that resamples whole runs and whole days, registered in its own gate.
- **NDBC retention.** realtime2 keeps about 45 days, so a scorer outage longer than that loses observations for good. Those rows are `no_obs` with cause `fetch_gap`, never dropped silently. A long outage is reported with its date span.
- **Coarse tier.** The world tier is 2°, so its maximum match distance (0.75 × the cell diagonal) is roughly 200-240 km at low latitudes. Scores describe the 2° field users see at world zoom, not the close-zoom regional frames.

- **Correlated members.** GFS, EURO and ICON share ancestry, observations and often initial-condition information, so their errors are correlated. Naive inverse-variance weighting from these tables would be overconfident. Any skill weighting must model the error covariance between members (or shrink toward equal weights), registered in its own gate.
- **Buoys are a floor, not a target.** Passing at offshore buoys is necessary, not sufficient. Buoys are not surf spots, and nothing here measures surf height or quality at a break.
- **The nearshore comparison is partition-resolved.** The `nearshore_eval` purpose stores and scores partitions (`kind`), not bulk Hs alone. A bulk-only score cannot tell a swell fix from a wind-sea compensation.
- **Own durability.** The archive is not on the 2-run frame retention path (section 0.3). Its integrity comes from immutable files, `SHA256SUMS` and the weekly verify. A loss is logged and never back-filled from a later run.

## 12. Not in v1
- Steps past 240 h; every tier other than `global_mid` (section 2a); the `_filled` variants; `/point` verification; any use for weighting.
