# 2026-11-18 — opus: ICON air temperature draws our own 0.125-degree DWD frames (ON, kill switch), off Open-Meteo

## Why
- #998's verification (log `2026-11-17-opus-raster-ship-on.md`): all five new sets publish at 100 %, but the client reads none
  of them by default, so ICON air temperature still draws Open-Meteo's `.om` copy (`openMeteoEndpoints.js`).
- Owner, 2026-11-18: "No user data should be open-meteo". Owner, 19:09Z: Open-Meteo is allowed as a FALLBACK only when nothing
  better exists.
- The director assigned this client change (2026-11-18). Scope: flip each layer and model to our own set where one is published
  and passes parity, ON with a kill switch, `.om` kept as the fallback; start with ICON temperature.
- Exit plan: `open-meteo-exit-plan-2026-11-18.md`, rows B2 / E2.

## Gate (pre-registered by the director's scope, read here against existing evidence)
The temperature row of the exit plan's table C:
- bias ≤ 0.3 K against the native field;
- every frame hour equals its label.

Evidence, none of it new in this PR:
1. **Parity with what users see today, `.om` `dwd_icon` `temperature_2m`.**
   - Source: log `2026-11-16-opus-icon-precip-0p125-cloud-temp.md`, "06:24Z: G1 option (a) result", instrument `g1a_gate.py`,
     run 2026-11-16 00Z, all 2879 x 1441 shared nodes, our encoded-then-decoded frame.
   - Exactly equal on 97.7 % / 97.8 % / 97.5 % of nodes at f006 / f048 / f120.
   - Median and p99 |difference| are 0.00 degC at every hour. The max is 6-7 degC on the ~2.3 % of nodes where the two pick a
     different nearest cell.
   - Positive control (`.om` of another hour): 1.5 % equal, median 1.15 degC. It fails, as it must.
   - The bias is therefore ≤ 0.3 K by these readings, though no mean signed error was computed.
2. **Frame hour equals its label.** Every frame's `valid_time` is the index entry's, or the client refuses the frame
   (`loadOwnOnly`, |Δ| ≤ 1 s; pinned by the new test). The live index today, 2026-11-18 12Z run, read 20:3xZ:
   - 61 frames, f000 → 2026-11-18T12Z and f180 → 2026-11-26T00Z;
   - each from DWD's `icon_global_icosahedral_single-level_2026111812_<fff>_T_2M.grib2.bz2`.
3. **Resolution.** 2880 x 1441 at 0.125 deg, as fine as the `.om` `dwd_icon` grid, so the no-regression rule holds.

## The change (frontend only)
- `ownRasterFrames.js`:
  - ICON temperature key `ICON/weather/temperature/global_0p125`;
  - `DEFAULT_ON_MODELS = { temperature: ['ICON'] }`;
  - the temperature set decodes off the main thread (`workerDecode`, the own-only layers' worker);
  - a handheld node budget of four 0.125-degree frames (~66 MB of Float32). The ±1 window fits, and 0.25-degree sets never reach
    the budget.
- `staticRasterSets.js`: the 0.125 key is listed.
- **NO `.om` FALLBACK** (owner's word via the director, ~23:00Z: "cut Open-Meteo out of all user data; internal testing only",
  no `.om` fallback). The temperature set lists `ownOnlyModels: ['ICON']`, read through `ownOnlyFor(layer, model)`.
  - While ICON temperature's own frames are on, `useOwnRasterFrames` keeps the layer claimed. MapWebGL therefore never draws
    the Open-Meteo copy: not on a cold toggle, not on a missing set or index, not on a missing hour.
  - The status line shows "Air Temp: no published forecast yet" or "Air Temp: no forecast for this hour" (the gusts / currents
    rule).
  - Past ICON's 180 h the layer shows "no forecast for this hour". The `.om` `dwd_icon` also ends at ICON's horizon.
- **Kill:** `window.__RAW_DISABLE_RASTER_OWN_TEMPERATURE__ = true`. The global own-frames kill, the per-set kill and the
  static-frames global kill also work. Each stops our ICON frames, and the layer then shows "unavailable". **No kill returns it
  to `.om`.** The director, relaying the owner (2026-11-18): "no kill switch falls back to Open-Meteo, and that's the standard
  for every exit row". Pinned: under every kill, `useOwnRasterLayers` drops ICON `temperature` from the `.om` layer list, so
  MapWebGL and its temporal preloader never request it.
- GFS and EURO temperature are unchanged (OFF, `.om`).
- Frame size, measured: 2.65 MB gzipped (8.30 MB raw) per frame, against 1.1-5 MB per hour on the `.om` path
  (`2026-10-22-claude-raster-instant.md`).

## Not done here (next, per the director's scope)
- **Rain ICON (`precipitation_icon_0p125`):** published, gated in G2. It needs a client key and an ICON `rain` entry.
- **Cloud EURO (`cloud_cover_euro`) and ICON:** published (EURO); ICON's 0.125 set was reverted (#1014).
- **Fog all models:** decided as DEFAULT-OFF pending the owner (vote split 2026-11-14).
- **Water temp EURO and ICON:** water temp EURO and air temperature EURO were also left OFF pending the owner in that vote.
  The owner's 2026-11-18 rule may settle them; that is the director's call.
- **GFS temperature (0.5 deg) and GFS water temp (0.25 deg):** coarser than the `.om` gfs013. A 0.125-degree GFS set is needed
  first.
- **ICON-EU sets:** after these.
- **Post-deploy live check (D-080):** after merge, open the dev map with ICON + air temperature and confirm in the network panel
  that it reads the CDN frames and makes no `openmeteo.s3` request for temperature.

## Product GC sweeps read (PRODUCT_RUN_KEYED_NAMES, #1005 / #1020), core `forecast-ingest.yml`
Instrument: `gh run view <id> --log`, the `[Product GC]` line. Each sweep was checked for FUSE and `path not found` lines and
had none.

| run | event | sweep at | listed | referenced | marked | deleted | left | bulk batches |
|---|---|---|---|---|---|---|---|---|
| 44351331807 | workflow_dispatch | 18:09:12Z | 36,830 | 18,385 | 18,433 | 0 | 0 | 0 |
| 44356945782 | schedule | 20:01:27Z | 38,940 | 18,389 | 4,062 | 16,477 | 0 | 17 |

- `referenced` holds at ~18,385-18,389. That is within 0.1 % of the 11-17 sweeps, far from FUSE A's 0.8 ratio.
- The 18:09Z sweep deleted nothing: it marked this cycle's superseded objects inside the 2 h grace.
- The 20:01Z sweep deleted 16,477 of the 38,940 listed (42 %), under FUSE B's 60 % and the 25,000 cap.

## Rain ICON 0.125: ON, own frames only (branch `opus/icon-rain-0p125-client`, stacked on #1071)
The director's order after #1071: rain ICON 0.125 next.

**Set.** `ICON/weather/precipitation/global_0p125` (#956's `precipitation_icon_0p125`):
- DWD TOT_PREC differenced to a rate, hourly to 78 h, then 3-hourly to 180 h;
- area-averaged with 3 x 3 sampled sub-points onto 0.125 deg;
- live index, 2026-11-18 12Z run: 112 frames.

**Gate:** the director's precip row, mass ±1 % and peaks ≥ 90 %. Evidence is the G2 re-measure after the pick-map fix, in this
lane's 2026-11-16 log, §06:59Z, run 2026-11-16 00Z, five hours:
- Mass error: -0.095 / +0.008 / +0.075 / -0.085 / -0.056 % at f006 / f024 / f048 / f078 / f120. **PASS.**
- Median cell peak kept: 0.923 / 0.944 / 0.947 / 0.920 / 0.959. **PASS on the median.**
- **NOT MET on the tails.**
  - The p10 peak kept is 0.735-0.851.
  - The global maximum kept is 0.883 at f120 (0.902 at f078).
  - An area mean lowers single-cell peaks by design.
  - The reference is DWD's native cells, not the `.om` copy, whose remap was not measured here.
- **Single-cell mass is not exact** (sampled areas: median 5.8 %, p90 17 %). It must not be called "conservative".
- **Ingest time half: open.** It is owed from #998's steady-state step times.

Under the owner's rule the choice is this set or "unavailable" (no `.om`), so it ships ON. The tail limit is named for the
director and the advisor to accept or refuse.

**Change.**
- `rain.models.ICON`, `DEFAULT_ON_MODELS.rain = ['ICON']`, `ownOnlyModels: ['ICON']`, `workerDecode`.
- The static store lists the set.
- Past ICON's 180 h the GFS frame stands in, labelled as an estimate. That has been the rain layer's rule since 2026-11-12,
  the same as EURO.
- GFS and EURO rain are unchanged (dark, `.om`).

**Kill:** `window.__RAW_DISABLE_RASTER_OWN_RAIN__`, plus the own-frames, per-set and static-frames global kills. Each shows
"unavailable", and none requests `.om`. Pinned: under each, the `.om` layer list drops ICON rain and keeps GFS rain.

## EURO cloud: ON, own frames only (branch `opus/euro-cloud-client`, stacked on the rain branch, #1075)
The owner's word: "start the EURO cloud flip" (2026-11-18).

**Set.** `EURO/weather/cloud_cover/global_0p25` (#955's `cloud_cover_euro`):
- ECMWF open data `tcc` x 100, every point of its 0.25-degree grid (the `.om` `ecmwf_ifs025` grid);
- hours 0-144 by 3, then 150-240 by 6;
- live index, 2026-11-18 12Z run: 65 frames.

**Gate:** the director's cloud row, MAD ≤ 10 %. Evidence: G3, run 2026-11-15 12Z, in this lane's 2026-11-16 log, §05:51Z and
§07:17Z:
- All 1,038,240 nodes are within 0.5 pp of ECMWF's own field, decoded by its own lat/lon keys. That is the frame's
  quantisation, so the MAD is under 0.5 pp. **PASS.**
- The domain-mean difference is 0.015 pp.
- Placement: by the frame's declared grid, which is how the client draws it. Seeded negative controls (rolled 180 deg, flipped
  N-S) fail as they should.
- **OWED:** the registered visual pairs against GFS cloud (coast, the 0/180 seam, three themes, desktop and phone) were never
  made.

**Change.**
- `satellite.models.EURO` and `ownOnlyModels: ['EURO']`. `satellite` is already a default-on layer, so EURO is ON with no
  lever.
- The static store lists the set.
- Past EURO's 240 h there is no stand-in (this layer has no fallback model), so those hours say "unavailable".
- GFS cloud keeps today's behaviour: its kill still releases it to `.om`. ICON has no cloud set (#1014 reverted the 0.125 one)
  and keeps `.om`.

**Kill:** `window.__RAW_DISABLE_RASTER_OWN_SATELLITE__`, plus the own-frames, per-set and static-frames global kills. With
EURO picked, each shows "unavailable" and none requests `.om`. Pinned on the `.om` layer list.

**Under the owner's rule, still `.om` for cloud:**
- GFS cloud on a kill or a miss;
- ICON cloud everywhere.
Both are named for the director: GFS needs `ownOnlyModels` (one word); ICON needs a published set.

## 2026-11-19 ~01:40Z: the advisor's HOLD fixes on #1071, and NEXT WORK recorded at the owner's wind-down
**HOLD fixes on this PR** (the advisor, 00:57Z):
- **Credit.** An own-only model claimed with nothing drawn (killed, unpublished or pre-index) reports `'<MODEL>:idle'` to the
  engaged store. The credit names that model's source with no note, never "© Open-Meteo". The status line still reads it as
  truthy, so the "unavailable" readout stays.
- **Retry.** One failed index read no longer latches "unavailable" for the session. An own-only model retries every
  `OWN_ONLY_RETRY_MS` (60 s) while the layer is on. Kill: `window.__RAW_DISABLE_RASTER_OWN_RETRY__` (the latch, as before).
- **Comments.** Stale comments that said the temperature kill returns the `.om` path are corrected. A kill now shows
  "unavailable" for ICON.
- **For David** (the advisor asked that it be said plainly): with Open-Meteo gone, ICON air temperature is BLANK past h180 until
  the prediction below is built. The old `.om` path drew GFS there without saying so.

**NEXT WORK 1: the "ICON prediction" / "EURO prediction" past each model's horizon (owner rulings; NOT started, per the
wind-down).**

Owner words, typed in the director's session and relayed verbatim:
- ~01:20Z: "Yes, go with the Raw Surf prediction".
- ~01:30Z: "Yes, label it ICON prediction and EURO prediction".

This lane leads ONE shared module (per-layer parameters), built with the gfs-flux lane (local_fe5abe5f).

Design (the director's brief):
1. **Base past ~day 7:** a lead-time-weighted mean of free ENSEMBLE means: ECMWF ENS (15 d), GEFS (16 d), and AIFS-ENS where
   verified. The deterministic model's own last hours dominate near its horizon.
2. **Weights from measured skill.** The research lead's pre-registration is `raw-surf-prediction-review-and-prereg-2026-11-19.md`
   in shared notes:
   - weights non-negative, summing to 1, constant or linear in lead, chosen by CV inside TRAIN;
   - arms: plain GFS, each ensemble mean, and the blend;
   - gate: the blend beats BOTH GFS and the best single mean at ≥ 3 of 4 lead days, with no lead or region worse and
     temperature |ME| not worse; otherwise serve the best single mean;
   - truth: MRMS for rain, ASOS / ISD / NDBC for temperature, the GOES Clear Sky Mask for cloud;
   - a seam metric at each handover.
3. **Handover per variable:**
   - temperature: the model's last-hour offset carried forward, decaying over ~48 h;
   - cloud: a weight shift;
   - rain: probability-matched (PM) or LOCAL PM, never a plain average. Also report a calibrated P(≥ 1 mm / 6 h).
4. **Inputs:** all are OUR frames; no Open-Meteo.
5. **Label:** "ICON prediction" (days 8-14) or "EURO prediction" (days 11-14) in the legend and credit, in all three themes, as
   text. The infobox explains it, e.g. "ICON's last run, extended with Raw Surf's ensemble-weighted prediction (ECMWF ENS,
   GEFS)". The research lead adds: say past-horizon fields are smoother because they are less predictable.
6. **Kill:** ON with a window kill switch that shows "unavailable".
7. **One module,** so marine and wind can adopt the same name.

Order: the design note goes to the advisor and the research lead first, then the build. It fixes #1075's HOLD (ICON rain blank
past h180 by default, because the GFS stand-in only loads under the developer lever). #1075 and #1078 stay held until then.

Archive starts for the research lead's TRAIN / TEST split:
- **Read:** the ECMWF open-data mirror on AWS (`ecmwf-forecasts`) starts 2023-01-18 (listing read 01:3xZ).
- **Not read** (the listing was stopped at the wind-down): GEFS (`noaa-gefs-pds`), GFS (`noaa-gfs-bdp-pds`), and AIFS-ENS
  (ECMWF open data; its atmospheric fields and start date are unverified).

**NEXT WORK 2: the rated-step FAIL in frames-budget counted run 2 (pilots 44249848808; NOT started).**
- Rated set seconds grew from 1,596 to 1,784 (+12 %); `global_mid_rated` from 97.7 to 124.2 s. The 12 GFS regional wind_waves
  rated bundles were skipped.
- Hypothesis, unmeasured: #1006's hourly GFS wind.
- Method: compare the rated step's per-set `frame_sets` report (seconds and frame counts) between runs 44083737083 and
  44249848808. The logs were downloaded once, but the grep for `"frame_sets"` returned no match, so the report's log line format
  must be found first. Then read counted runs 3 and 4.
- **It gates two writers:** the director's condition is that neither the coastal-band writer nor B1's writer merges until this
  is explained or the advisor re-sizes the budget. Send the verdict to the repair lead (local_ff1641e7) as well.
