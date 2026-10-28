# Regression matrix: marine scrub, toggle, band, label, fill, mid-zoom and regional fixes (#387 to #595)

Written 2026-10-27 by the regression-sweep session (branch `claude/regression-sweep`). It answers the owner's ask of 2026-10-26,
relayed by the lead: "the most tests you've ever done. Look up all the testing and commits we've ever done before to avoid
regressions."

- **Measured build:** dev `4b8563851` (2026-10-26; client and backend from one checkout).
- **Rows:** every claim with a recorded number from each PR's body, its log and evidence, SCOREBOARD and LESSONS.
- **Where it ran:** offline on the synthetic harness on this PC (`frontend/scripts/offline-backend/`). No scenario touched the
  live box. Browser-pane tabs of a production build were left open idle twice, about 80 min in all; the log has the details.
- **Results:** the log is `log/2026-10-26-claude-regression-sweep.md`. The raw outputs are named per row and live in the session
  scratch (`r523/sw/out/`), not in git.
- **Dev moved during the sweep:** it is now `dcc514bf3`, which adds #596-#605. Section 3 runs the owner scenarios on
  `654a44c2c` (#598, the band-off fix) and `dcc514bf3` (#601, #602).

## Verdict

**No REGRESSED row.** Every re-runnable claim still meets its recorded criterion on dev `4b8563851`.

- **Same-window control for timing.** Store-show timings measured first at 20:00-21:25Z read 5-60x slower than recorded. A
  `5601b9d59` (#575-era) client and the tip were then interleaved T,B,T,B in the same window (00:15-00:56Z). Both builds showed
  the recorded numbers, so the slow reads were machine load, not code (section 1).
- **Nine instrument or build faults gave false readings**, false failures and two false passes. They are fixed or named in
  section 2. The worst two:
  - **The probes' hour-0 anchor.** It made Florida z9, Biscay z9 and Indonesia z8 read as missed and mislabelled whenever the
    app's hour 0 fell off the 3-hourly cadence. With hour 0 on the cadence the same rows pass (Biscay z9 p95 14 ms, the
    recorded value).
  - **A `git archive` build missing the dev deploy's `REACT_APP_ICON_STORED_TAIL` flag.** It made the new tip look like an ICON
    regression.
- **Candidate regressions, each bisected away:**
  - #492's hidden-layer minis with a bundle. The recorded 0 does not reproduce at #492's own merge commit.
  - The 429s under the 4-slot CDN limit. The same on the #575 build.
  - ICON far hours on the new tip. A build flag, not code.
- **The owner's four failures** are new scenarios in `scn_owner_1026.js` (section 3). They fail on `4b8563851`. On dev
  `dcc514bf3` with every tail set built, all four pass:
  - `band_off` by #598;
  - `euro_switch` by #602;
  - `euro_240` by the built tails (`FRAME_TAIL_DOWNLOAD=1`, not yet flipped live);
  - `icon_far` does not reproduce offline inside the stored tail. The owner's slow jumps went into the day-14 hold region.
- **Live parity with the box's flags.** Since 10-26 12:20Z the live box also runs the #588 donor flag and margin = 12 (D-053).
  Store M kept the flags of 01:31Z; the day-14 rows exercise the donor flag both ways.
- **Rows that cannot run offline** are marked NOT-RUNNABLE-OFFLINE: live reads, real NOAA wind, and Open-Meteo raster
  recordings. **Rows not run in this sweep** are marked NOT-RUN with the reason (mostly the `visual-lab/lab.js` flows and the
  wash, density and mask studies). Their unit pins are green.

## Legend

| verdict | meaning |
|---|---|
| PASS | meets the row's pass criterion; the number is given |
| PASS (rel.) | the effect holds against its control arm in the same window, but the absolute number is void (load window, or another store) |
| PASS (Jest) / PASS (pytest) | the unit pins are green in the full Jest run or the 17-file pytest run (section 1) |
| WATCH | passes, but a side number moved or a new observation is worth following |
| NOT-EXERCISED | the fixture never reached the state the row tests (reason given) |
| INCONCLUSIVE | the instrument's control arm has no teeth on this store |
| NOT-RUN | runnable offline, not run in this sweep (reason given) |
| NOT-RUNNABLE-OFFLINE | needs the live box or CDN, or inputs that are not on this disk |
| SUPERSEDED | the row's configuration no longer exists on dev |
| FAIL (owner) | the owner's 2026-10-26 failures: these must fail until fixed |

## 1. Setup

**Stores** (all `frontend/scripts/offline-backend/serve_synthetic.py` with the backend venv; ports checked against
`/__harness/identity` through `EXPECT_STORE` on every run):

| name | flags | env | port |
|---|---|---|---|
| **M** (main) | `--models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves --regions flagship --dynamic 1 --land-mask 1 --enclosed-seas 1` | `MARINE_GULF_FILL_MID_TARGETED=1 MARINE_REGIONAL_TILE_FIRST=1 FAR_EDGE_HOLD_PREFER_MID=1` (the live box's flags; `MARINE_GULF_FILL_DONOR_SERVED_TIME` stays dark) | 4192 |
| **C** (clean) | `--models GFS,ICON,EURO --regions florida_east_coast,hawaii,indonesia,us_southeast_midatlantic,us_northeast,france_biscay --dynamic 1` (no land mask) | `MARINE_REGIONAL_TILE_FIRST=1` | 4193 |
| **SIB** | `--models GFS --layers waves,swell_1,swell_2,wind_waves --regions florida_east_coast --dynamic 1` (#492's own store) | none | 4194 |
| **D14** | the real-CDN day-14 store from #584 (`day14_arms.py fetch`, copied once) | per arm | backend only |

**CDN copies** (`backend/scripts/publish_frame_images.py --store-dir <store> --out-dir <cdn> --only frames`, same env):
- `cdn`: M, every set built, every ICON/EURO tail included.
- `cdn_live`: M without the EURO estimated files and the ICON swell_1/wind_waves estimated files. That is what
  `FRAME_TAIL_DOWNLOAD=0` publishes: EURO waves 65 of 99 frames built, ICON swell_1/wind_waves 57 of 115.
- `cdn_clean` (C) and `cdn_sib` (SIB).

**Builds** (production `craco build`, `NODE_OPTIONS=--openssl-legacy-provider`, served by `serve_spa.js`):

| build | port | role |
|---|---|---|
| `4b8563851` | 3190 | measured; built with `REACT_APP_ICON_STORED_TAIL=true`, as the dev deploy is |
| `5601b9d59` (#575 merge) | 3191 | same-window control; built without the ICON flag (fault 6) |
| `654a44c2c` (dev now) | 3292 | owner scenarios after #598; `build_st` = with the ICON flag (the one reported) |

**Every scenario** takes `AB_BASE=http://127.0.0.1:<spa> PORT=<backend> EXPECT_STORE=<store> CDN_DIR=<cdn>`. Set
`CDN_PORT=4381` on `scn_model_toggle.js`, whose default 4192 is M's port. Port 4190 is a Fetch "bad port", so Node refuses it.

**Unit pins:**
- **Jest** ran on a dot-free mirror of `frontend/` at `4b8563851`; CRA finds no tests under `.claude/`.
  - Result: 7,161 of 7,166 tests, 552 of 557 suites.
  - The 5 red suites read files outside `frontend/` that the mirror lacked: `../backend`, `../program`, `../netlify.toml`.
    With those linked, 4 pass.
  - `netlifyIconStoredTailScope.test.js` times out spawning bash on this PC (ETIMEDOUT). It is green on hosted CI at
    `4b8563851`.
- **pytest** (from `backend/`): 17 files, **247 passed**. The files: `test_day14_end`, `test_frame_set_fill`,
  `test_coarse_gulf_fill_targeted`, `test_marine_ext_ceiling_margin`, `test_frame_binary`, `test_publish_frame_sets`,
  `test_coarse_gulf_fill_mid`, `test_flag_lane_parity`, `test_ecmwf_land_centre_block`, `test_fill_provenance_nodes`,
  `test_frame_parity_tolerance`, `test_coarse_fill_shared_vectors`, `test_frame_set_wind`, `test_frame_set_bundle`,
  `test_frame_set_raster`, `test_coarse_gulf_fill`, `test_coarse_fill_layers`.

**Timing validity:**
- Step timings count only when the idle two-rAF median is ≤ 40 ms (LESSONS L-O7). Every zoom-scrub session here read 31-33 ms.
- **The load window, 18:15-21:25Z.** Another session's Python process held about one core the whole time, and total CPU read
  54-79% with nothing of ours running.
  - `gpu_sync_ab` read 13.6-18.1 fps against 58.8-59.3 recorded.
  - Store shows read 77-756 ms against 6-16 recorded.
- **Same-window control** (00:15-00:56Z, T = `4b8563851`, B = `5601b9d59`, interleaved T,B,T,B):

| row | T p50/p95 | B p50/p95 | recorded |
|---|---|---|---|
| filled-world model clicks, world z3.2 (#575) | 1/50, 4/14 ms (12/12 store, ×2) | 5/15, 3/15 ms (12/12, ×2) | 6/9 ms |
| desktop on 3g, 30 steps (#455) | 0/16, 5/15 ms | 2/14, 4/14 ms | p95 16 |
| EURO waves world store scrub (#453) | 1/15, 4/14 ms | 9/110, 3/17 ms | 3/18 |
| model clicks at z4.2 owner window (#458) | 13/599, 8/515 ms | 11/553, 8/500 ms | 10/11 |

At z4.2 the p95 comes from the same two clicks in both builds: EURO at h168 is served by `/grid` in about 0.5 s, and ICON at
h168 (the estimated tail of this store) is never exact within 8 s. **The two builds behave the same, so nothing regressed
between #575 and the tip.**

## 2. Instrument faults found (and what was done)

1. **The zoom-scrub and model-toggle probes' hour-0 anchor** (`scn_zoom_scrub.js`, `scn_model_toggle.js`;
   `scn_owner_1026.js` copied the function). **Fixed on this branch.**
   - Since #538 (2026-10-24) the probes took hour 0 as `waveGrid.valid_time − hourOffset`.
   - The app snaps the asked time to the nearest stored product (`backendWeatherServiceClient` resolves the nearest
     manifest time). Whenever hour 0 is off the 3-hourly cadence and the hour-0 resident came from `/grid`, that value is
     the product's time, 1-2 h off. The probe's expected frames then shift, and correct frames read as missed or
     mislabelled.
   - Evidence, store C:
     - Florida z9 bundles-killed at 23:17Z (hour 0 = 23Z): 16/20 missed, 6,048 mislabel frames (4,721 "silent").
     - The same row at 23:47Z (hour 0 = 00Z): 0/10 missed, 0 mislabel.
     - Biscay z9 (21:30Z): cur 492 / noregional 956 silent. At 23:49Z: 0 / 0.
     - Indonesia z8 (21:35Z): 3,067 "stale". At 23:52Z: 0.
   - The app's own rule is `getSeriesAnchorMs()`, the rounded clock, unchanged since 2026-09-20.
   - The probes now read `__RAW_SELECTED_FRAME__.labelMs − hour` (= `getSeriesAnchorMs()`), falling back to the rounded
     clock.
2. **`visual-lab/gl_shadow_agreement.js`** recorded 0 captures: its `pressed('Waves')` flow never drew waves on this store.
   A direct probe of the same audit (`__RAW_GL_SHADOW_AUDIT__`) found 58 captures, 232 checks, 0 mismatches. Not fixed here:
   the scenario needs its Waves step re-pointed.
3. **Word-blind detectors.**
   - The "silent" regexes in the probes (`Loading|Verifying|does not match|pending|nearest|estimated`) predate #587's
     "Holding …" words. A held frame reads as silent there.
   - `scn_instant_second_pass.js`'s `silentStale` counter never reads the status line at all. Its 808 "silent" frames at
     target 336 are labelled.
   - Not changed here: the regexes are shared by several scenarios, and widening them is a separate, reviewable change.
4. **`scn_static_parity.mjs` cannot read regional bundle sets.** Its 1,848 (M) and 1,386 (C) meta mismatches all come from
   regional sets. Regional parity is `scn_regional_client_parity.mjs`'s job (rows #491/#535).
5. **Wheel keys.** The forecast wheel has no End key; its keys are arrows ±1, PageUp/PageDown ±24, Home. A scenario that
   pressed End stayed at hour 0 and passed falsely (`scn_owner_1026.js`'s first draft; fixed before any number here).
6. **Build flags.** The dev deploy builds with `REACT_APP_ICON_STORED_TAIL=true` (`netlify.toml`, branch deploys of `dev`), and
   so does the measured `4b8563851` build. A `git archive` build (no local `.env`) does not.
   - Without the flag, ICON past 240 h at z5 draws the client's estimated blend. It has no product id and no data time
     ("Estimated forecast: beyond ICON's native range"), so `icon_far` reads it as never exact.
   - The first `654a44c2c` build lacked the flag and looked like a regression (3 of 3 runs: ICON 240 h never exact).
   - #598's kill switch did not change it. The flag did: the same commit rebuilt with it (`build_st`) is the one in section 3.
   - The `5601b9d59` control build lacks the flag. Its rows are EURO/GFS, plus ICON clicks before the tail, and ICON at h168,
     which missed in both builds alike.
7. **`band_off` read the wrong signal for #598.** #598 hides the band through `ratingBandFade.bandMult = 0` while
   `ratingBand.active` stays true until the honest grid lands. The scenario now counts the band as painting only when it is
   active and `bandMult` is not 0. Runs before this fix use `active` alone.
   - The new rule exposed a second trap: right after the click, a scrub's own edge or resolution hold can zero the band for a
     frame and then let it paint again. The measured tip read "off at 3 ms" and then painted 1,194 more frames.
   - The case now also requires no painting frame after `BAND_MAX_MS`.
8. **`day14_arms.py` never set the drawn record's hour.** #587's held rule fires only when the drawn hour is the selection, so
   `day14_labels.mjs` read every held row as "Loading … still showing". Fixed on this branch: the record carries the asked hour, as
   the app's drawn record does.
9. **`scn_owner_1026.js` step timing and judging** (the first draft):
   - A multi-key step was timed from its FIRST key, so 20 presses 60 ms apart could never meet 100 ms. Steps are now timed from
     the last key.
   - Hours past the store's stored tail (run + 336 h) were judged, but the server holds the last frame there (the day-14 end, a
     separate issue). They are now recorded and not judged.
   - `euro_switch`'s fixed hour 328 drifted against the store's run as the clock moved (`SWITCH_AT=run+N` pins it).

## 3. The owner's four failures (2026-10-26 manual test, `owner-manual-test-2026-10-26/FINDINGS.md`)

New scenario: `frontend/scripts/offline-backend/scn_owner_1026.js`.
- Store M, `cdn_live`, owner window 844×390, dark.
- `CASES=band_off,icon_far,euro_switch,euro_240`.
- Each case prints PASS/FAIL, and the run exits 1 if any case fails.

| case | the owner saw | criterion (final scenario) | dev `4b8563851` (live-shaped CDN) | `654a44c2c` (+#598) | dev `dcc514bf3` (+#601, #602) | `dcc514bf3`, tails built (`cdn` = `FRAME_TAIL_DOWNLOAD=1`) |
|---|---|---|---|---|---|---|
| `band_off` | band on for seconds after OFF (one 18 s wedge) | band stops painting ≤ 100 ms after OFF and paints no frame after that; no stranded-fetch release | **FAIL**: first frame off at 4 ms (the scrub's own hold), then **1,189 painting frames** after 100 ms; the earlier `active`-only probe saw 1,493-1,499 frames, about 25 s | **PASS**: off at 14 ms, 0 frames after, no stranded fetch, 0 abort-gate lines | **PASS**: off at 6 ms, 0 frames | **PASS**: 14 ms, 0 frames |
| `icon_far` | ICON z5 far jumps not instant | every far jump exact ≤ 100 ms after its last key (store or series); hours past run+336 h are the hold region | **PASS offline** (not reproduced): 4-42 ms, also with a 340 ms CDN and a 1.5 s settle. The hold region (328): 3-8 ms when the last stored frame is resident; **2.1 s via `/grid`** with the 340 ms CDN, labelled "Holding Mon, Nov 9, 7 AM’s ICON forecast: beyond ICON’s native range" | PASS: 1-16 ms (hold 2.1 s via `/grid` with the 340 ms CDN) | PASS: 2-45 ms, every step from the store | PASS: 1-61 ms |
| `euro_switch` | the map blanks before EURO draws | 0 blank frames between the EURO click and the first EURO frame (world GFS h0 control) | **FAIL 8/8** (`SWITCH_AT=run+330` and `run+340`, ICON z5.21): **219-437 blank frames**, EURO at 3.7-7.4 s; control 0 blank | **FAIL 6 of 7**: 180-466 blank frames | **PASS 7/7**: **0 blank frames** (EURO at 4.3-6.0 s); the same-window `4b8563851` control: 269 blank | **PASS**: 0 blank, EURO at 4 ms |
| `euro_240` | EURO past ~240 h waits on `/grid` | every EURO step past 240 h and inside the stored tail exact ≤ 100 ms from the store | **FAIL**: via `/grid`, **1.8-2.9 s** per step at z3 and z5 | **FAIL**: 1.8-2.7 s | **FAIL**: 1.8-2.4 s via `/grid` | **PASS**: from the store, **1-17 ms** at z3 and z5 |

- **All four fail on the measured tip** (or, for `icon_far`, would fail in the live condition).
- **On dev `dcc514bf3` with every tail set built, all four pass** (exit 0):
  - `band_off` by #598;
  - `euro_switch` by #602 (mid-zoom model switch never blanks);
  - `euro_240` by the built tails (`FRAME_TAIL_DOWNLOAD=1`; #597 fixed its budget). The flag is not flipped on the live
    CDN, so the live-shaped arm still fails.
- **`icon_far` does not reproduce offline** inside the stored tail. The owner's slow jumps ("137 → 336", "242 → 336") land in the
  day-14 hold region. That is a `/grid` round trip unless the last stored frame is resident. On `dcc514bf3` (#601) every step,
  hold region included, came from the store.
- **WATCH:** in the scenario's rapid 250 → 328 step on `4b8563851`/`654a44c2c`, the resident read right after the exact frame had
  hour 23, 0 or −1 (a series frame). A paced sequence showed the held frame with the right words, so this may be a transient
  wrong-hour frame at the wheel's top. On `dcc514bf3` the step ends on the store frame.
- **Every number above** comes from the final scenario: band painting = `active` and `bandMult` ≠ 0, steps timed from the last
  key, `SWITCH_AT=run+340` unless named, store M, owner window 844×390, dark, builds with the dev deploy's ICON flag. Runs at
  03:30-04:57Z.

## 4. The matrix

Shorthand:
- `OB/` = `frontend/scripts/offline-backend/`, `VL/` = `frontend/scripts/visual-lab/`.
- `ZS` = `OB/scn_zoom_scrub.js`, `MT` = `OB/scn_model_toggle.js`, `SF` = `OB/scn_static_frames.js`,
  `SIB` = `OB/scn_sibling_toggle.js`.
- `K501` = the five `__RAW_DISABLE_SERIES_*` kills of #501. Recorded numbers cite the PR body unless a log is named.
- "PASS (Jest)" means the files named in the instrument column are inside the green full run.

### #387-#430

| PR | claim | instrument | recorded | re-run offline | 2026-10-26 | verdict |
|---|---|---|---|---|---|---|
| #387 `0607a7253` | wheel unmount ends the gesture; an old-model error never blanks the new one; parity needs drawn model+layer; wind's last drag hour settles | Jest `useMarineDataFetcherCore.race`, `ForecastWheel.unmount`, `weatherEngine.scrubEndSettle`, `marineRenderParity`, `marineSeekIdentity` | 76/76; 10 red with sources reverted | Jest | green | PASS (Jest) |
| #387 | out-of-order seeks 48→6→72→18 end on the direct-seek texture | `docs/audits/2026-10-18-weather-scrub-audit/evidence/scn_scrub_audit.js` `PHASES=race` | 19/20 hash match (dev 10/10) | GFS+ICON store, `PORT=4101 LAT_SERIES=2500 LAT_GRID=500 PHASES=race` | not run | NOT-RUN (audit script outside OB/, its own store and port) |
| #387 | F-02 "+1 h" is label-only, no refetch | same, `PHASES=seeks` | 4/4 identical | as above | not run | NOT-RUN |
| #391 `463a4d918` | visual lab baseline (identity, time-to-correct, stale, console, network) | `VL/lab.js` + `report.js` | silent ≤ 6-10 frames/step; layer 1.5-4.7 s; model 0.4-2.7 s | thin-bounds store with wind, `AB_DIAG=1 LAT_SERIES=2500 LAT_GRID=500` | not run | NOT-RUN (lab flows need the wind-layer store; not built this sweep) |
| #391 (+#389/#392/#393) | combined scrub fixes cut silent frames and switch time | `lab.js` all flows | silent 498-700 → 30-40/pass; wind worst 6.9 → 2.0 s; layer 5.4 → 2.1 s | as above | not run | NOT-RUN (as above) |
| #393 `a95633c8b` | a wind frame not at the selected hour is labelled | `lab.js FLOWS=icon_wind_scrub`; Jest `windHonestFast` (12) | +82/+115 h labelled | as above | Jest green | PASS (Jest); browser leg NOT-RUN |
| #393 | abort-rejects + same-target join cut wind time | `lab.js` A/B with 3 kills | +42 h 7.9 → 2.8 s | as above | not run | NOT-RUN |
| #393 | live wind abort churn gone | live | — | — | — | NOT-RUNNABLE-OFFLINE |
| #394 `9a68b49a4` | offset caches drop at the :30 anchor flip | Jest `offsetCacheAnchor` (6) | 6 tests | Jest | green | PASS (Jest) |
| #397 `461ed695f` | settled high zoom stops pulsing | `VL/settled_zoom_probe.js` (z12→14.5) vs `PROBE_FLAGS=…SCREEN_BOUNDED…,…PROPORTIONAL…` | swing 1.7-8.2 → 0.2-0.6; steps 0 | store M | fix arm 1 step (3 transitions); **pre-#397 control 0 steps** | INCONCLUSIVE (the control shows no pulse on this store) |
| #397 | bound applies z4-18 | Jest `waveSetScreenBound` | 5 tests | Jest | green | PASS (Jest) |
| #397 | live z14 / nightly SETTLED_STEP ≈ 0 | live, Marine Nightly zoomlab | — | — | — | NOT-RUNNABLE-OFFLINE |
| #402 `b240d7276` | GL-state shadow agrees with the driver | `VL/gl_shadow_agreement.js` | 12,280 checks, 0 mismatches | store M | scenario: 0 captures (instrument fault 2); direct probe: **58 captures, 232 checks, 0 mismatches** (marine) | PASS (marine; the wind engine was not drawn) |
| #402 | shadow saves 1.0-1.6 ms per engine per frame | `VL/gpu_sync_ab.js KILLS=__RAW_DISABLE_GL_STATE_SHADOW__` | marine 4.12 → 3.09 ms | `ARMS=off,on,off,on LAYER=waves` | not run (the #405 kills ran instead) | NOT-RUN |
| #402 | index, shadow, formatter identical | Jest `WebGLStateIsolation.shadow`, `manifestTimeIndex.parity`, `forecastReadout.formatCache` | green | Jest | green | PASS (Jest) |
| #402 | three hot functions leave the stalls | `lab.js FLOWS=erratic LAB_TRACE=1` + `VL/stall_profile.js` | 0 ms in stalls | lab store | not run | NOT-RUN |
| #405 `edced5395` | cached FBO status + attached-only teardown remove two GPU syncs | `VL/gpu_sync_ab.js` (default kills) | on 0.45/0.59 ms mean (p95 0.7/0.9); off 4.11/4.82; 58.8-59.3 fps | store M, `LAYER=waves ARMS=off,on,off,on` | load window: on **1.08/1.25** (p95 2.1/2.3) vs off **41.7/54.6** (p95 156/193), 13.6-18.1 fps. Quiet re-run (02:21-02:25Z): on **1.01/0.74 ms** mean (p95 3.0/1.3), frame 3.48/2.51 ms, 57.6-58.1 fps; off 14.11/8.28 (p95 38/27), 43.5-44.7 fps | PASS (rel.: off/on 11-14× against the recorded 9×. Both arms are 2-3× the recorded absolutes, so the on-arm ≤ 0.6 ms criterion is not met on this loaded PC) |
| #405 | no texture left attached, no GL error, a throw tears down once | `gpu_sync_ab.js CHECK=1 [THROW_ONCE=1]`; Jest `advFboSync` | 323 renders 0/0; teardown 1 | as above | `CHECK=1`: **668 renders, 0 attached after, 0 GL errors**; `THROW_ONCE=1`: 694 renders, 0 attached, 0 errors, thrown 1, teardown ran 1; Jest green | PASS |
| #408 `2f8cf224e` | land-mask fast paths byte-identical / identical resident textures / −34% ms per paint | `OB/scn_mask_capture.js` + `VL/mask_replay.js`; `OB/scn_mask_identity.js`; `OB/scn_mask_calls.js`; Jest `maskFastPaths` | 56 paints identical; 106.5 → 70.8 ms/paint | S1 store + `ne_10m_land.json` in the build, 3 themes | Jest green | PASS (Jest); browser legs NOT-RUN (40 MB captures per theme, a REF build) |
| #410 `60fc1954c` | the shader batch no longer blocks load | `lab.js FLOWS=model_switch_future` + `stall_profile.js FOCUS=WebGLProgramBatch`; Jest `WebGLProgramBatch` (54), `WebGLInit.asyncCompile` (28) | batch at load 594 → 3 ms | lab store | Jest green | PASS (Jest); lab leg NOT-RUN |
| #425 `a25aaa8ae` | the light/beach wash follows the BLEND BOTH law | `OB/scn_wash_alpha.js` + `wash_alpha.py` + `wind-color/wash-lut.mjs` | alphas per view ±0.03; residual ≤ 0.6 dE00 | S2 (`--vortex-peak 11`) store | not run | NOT-RUN (S2 store not built this sweep) |
| #426 `8392f25b8` | one `/products` per open; paint-while-pending; instant-keyed reuse | `lab.js` flows `open_waves`, `hour_steps`, `euro_steps`, `regional_page_steps`; Jest `marineRequestDiet`, `marineSeriesWhilePending`, `marineController.instantAlias`, `useMarineOrchestratorScrubCache.stepPage`, `useMarineScrubSettle.paintWhilePending` | `/products` 3 → 1; first draw 13.6 → 8.1 s | S1 store | Jest green | PASS (Jest); lab legs NOT-RUN; live diet counts NOT-RUNNABLE-OFFLINE |
| #427 `d84a94f26` | key-to-draw p95 ≤ 17.4 ms with layer-uniform scrubbing | `gpu-frames-bench/run.js`, `make_series.js`, `prefetch_sim.js` | p95 15.9-17.4 ms, 400/400 presses | no backend; frames dir | not run | NOT-RUN |
| #428 `23a91534f` | big-surf crest coverage cut per theme | `OB/scn_density_sweep.js` + `crest_coverage.py`; Jest `marineCrestDensity` | light −15.6/−19.4/−17.7%, beach and dark in band | S2 store, 3 themes | Jest green | PASS (Jest); browser leg NOT-RUN; `scn_label_zoom.js` needs third-party basemap tiles: NOT-RUNNABLE-OFFLINE |
| #429 `7ac4bff4e` | with every marine `/grid` failing, the settle check draws the landed series frame | `VL/settle_trace.js FAIL_GRID=1 SCN=open RUNS=3` | B 4.6-7.0 s, 8/8 via `series_settle`, `/grid` 1.0/open; A never draws | store M, `AB_DIAG=1 LAT_PRODUCTS=1500 LAT_SERIES=2500 LAT_GRID=1500` | load window: B **3/3 via `series_settle`** at 9.4/7.7/7.4 s, `/grid` 2/1/1; A drew once (8.7 s via `series_pending`). Quiet re-run (02:16-02:21Z): B **3/3 via `series_settle` at 5.8/6.3/6.0 s, `/grid` 1 per open**. A: drew at 8.2 s via `series_pending` in run 1, never in run 2, 20.5 s (not exact) in run 3 | PASS; WATCH: the kill arm draws through #426's `series_pending` lane in 1 of 3 runs (2 of 6 over both runs), so it is no longer a clean "never draws" control |
| #429 | a healthy load is unchanged | `settle_trace.js` without FAIL_GRID; `lab.js` A/B | 0 new re-drives | as above | not run | NOT-RUN |
| #429 | live map and arming wired | Jest `marineSettleLiveMap` | mutants red | Jest | green | PASS (Jest) |
| #430 `73e25a908` | calm seas keep the wash at close zoom (light/beach); dark byte-identical | `scn_wash_alpha.js`; Jest `marineCalmWashHold` (11) | light coast z10 0.40 → 0.83; beach 0.31 → 0.79 | S2 store | Jest green | PASS (Jest); browser leg NOT-RUN |
| #414 (open, not merged) | sliced land mask (dark) | — | — | — | — | out of scope (not on dev) |

### #441-#466

| PR | claim | instrument | recorded | re-run offline | 2026-10-26 | verdict |
|---|---|---|---|---|---|---|
| #441 `e96a274c6` | a stale world `/grid` is re-asked on a 1.5 s × 10, then 3-6-12-24-48 s ladder | `lab.js FLOWS=stale_world` + `/__lab/stale` + `VL/stale_summary.js`; Jest `useMarineRevalidation`, `marineRequestDiet`, `useMarineDataFetcherCore.swrBackoff`, `marineEmptyGridRetry` | 120 s stall: 21.2 → 7.1 re-asks/min | lab store | Jest green | PASS (Jest); lab leg NOT-RUN |
| #443 `b240401f8` | a world GFS waves scrub draws from CDN frames; the kill restores `/grid` | `SF ARMS=grid,store ROUNDS=1` | static arm 0 `/grid`, 259-734 ms; grid 1.7-3.2 s | store M, `cdn` | 23:14Z, clear of :30: store **p50/p95 1/9 ms, 0 missed, 0 backend asks**; grid p50/p95 58/6,493 ms, 5 `/grid` + 2 series. (The 18:27Z run crossed :30: 5 misses, anchor roll.) | PASS |
| #443 | the publisher lattice comes from outer cell centres | pytest `test_frame_binary`, `test_publish_frame_sets`; Jest `staticFrames` | 30/30 | pytest + Jest | green | PASS (pytest, Jest); live publish NOT-RUNNABLE-OFFLINE |
| #453 `6a03c442a` | every published set decodes equal to `/grid` at +0/+1/+2 h | `OB/scn_static_parity.mjs` | 27,522,136 nodes, 1,832 comparisons, 0 bad | `node OB/scn_static_parity.mjs <cdn> 4192 out.json` | M: **27,522,136 nodes, 1,832 comparisons, 0 bad** over 16 sets, filled ICON/EURO included (the 1,848 meta are regional sets: fault 4). C: 10,170,571 nodes, 677 comparisons, 0 bad | PASS |
| #453 | waves sets scrub from the store with no backend asks | `SF MODEL=EURO\|ICON LAYER=waves ARMS=grid,store` | EURO 3/18 ms, 0 req; ICON 6/1,045, 1 req | store M, `cdn` | EURO: same-window control **1/15, 4/14 ms**, 0 backend (load window 3/141). ICON: 13/246 ms; quiet re-run (02:32Z) **2/15 ms, 0 missed, 0 backend** | PASS |
| #453 | per-set kill, latest.json backoff, publisher gate | Jest `staticFrames`, `staticFrames.crop`; pytest `test_publish_frame_sets` | green | Jest + pytest | green | PASS (Jest, pytest); live parity NOT-RUNNABLE-OFFLINE |
| #454 `972be1e82` | a held world frame keeps full strength; the line admits it; a dot after 2.5 s | `lab.js` 4 flows; Jest `marineStaleHour`, `marineStaleHourLayer`, `WebGLMarineCustomLayer.staleHour`, `drawnFrameReadout` | dim 1,035 ms → 0 | lab store | Jest green | PASS (Jest); lab leg NOT-RUN |
| #455 `95ca652a5` | a 3g desktop gets the desktop tier and fills in idle time | `OB/scn_instant_second_pass.js ARMS=ect3g RANDOM_STEPS=20 CDN_LAT=340` | steps p50/p95 2/16 ms; 0 dim/stale/backend | store M, `cdn`, `REAL_INDEX` = its GFS index | same-window control **0/16, 5/15 ms** (B 2/14, 4/14), 0 missed, 0 dimmed, 0 silent-stale, 0 backend | PASS |
| #455 | 2g / Save-Data blocked; 3g phone stays constrained | Jest `marineFrameStore`, `marineFrameStoreRuntime` | 192/192 | Jest | green | PASS (Jest) |
| #456 `fc8cab3cc` | swell/wind-wave series frames encode land like `/grid` | Jest `marineFramePack.parity`, `useMarineWindData.isValid` | 0 differing texels | Jest | green | PASS (Jest) |
| #457 `8b396b116` | ≤ 4 in flight with AIMD; under a 4-concurrent CDN limit the run still fills | `scn_instant_second_pass.js CDN_RATE_LIMIT=4 ARMS=dark,light` | 429s 346-354 → 0; steps p95 13-16 ms; 113/113 landed | as above | load window: light p50/p95 12/97, 0 missed; dark 5 missed, all at target 336 (past this store's last frame); "808 silent-stale" is fault 3. Quiet re-run (02:33Z): light and dark **p50/p95 2/15 ms**, light 0 missed (dark's 5 all at 336); desktop tier, 115/115 resident (the store has 115 frames), fill about 9.5 s; **1-6 × 429 per session** (4/4, 5/5; the first run 1/6), AIMD cooled off once, max 4 in flight. The same-window #575 build: also 4 per session | PASS (fill and steps); WATCH: the 429s are not 0 as recorded (346-354 before #457), on the #575 build too, so not a recent change. This store plans more sets than the real copy did (121 planned, 170-190 asks) |
| #458 `7e2a17b05` | a world model click shows the stored frame at once, with no unadmitted wrong-model frames | `MT CDN_LAT=340 ARMS=on,off,on-light,on-beach,on-handheld ROUNDS=2` | on 11/12/12 ms, 20/20 store; off 429/1,195; silent 0 | store M, `cdn`, `CDN_PORT=4381` | on 16/148 ms (light 16/412, beach 53/116) in the load window, 18/20 store; off 982/1,327; handheld 677/1,124 (no store, as designed); **silent wrong-model 0 in every arm**. The 2 misses are click 7 (ICON at h168, this store's estimated tail) in every arm, off included | PASS (rel.; absolute timing is the load window; the same-window control at z4.2 shows tip = #575 build) |
| #458 | mid-zoom click shows the new model's clip | `MT ZOOM=5.5 VIEW=desktop` / `ZOOM=4.2 VIEW=owner MIN_COLS=10` | 10/11 ms, 19/20 store, silent 0 | as above | owner window, same-window control: **tip 13/599, 8/515 ms; #575 build 11/553, 8/500 ms**, 16/20 store, silent 0. The misses: ICON h168 (estimated tail) and EURO h168 (`/grid` ~0.5 s) in both builds | PASS (rel.); WATCH: EURO at h168 is not stored at mid zoom (owner failure 4's family) |
| #458 | runtime, seam, crop show/stash | Jest `marineFrameStoreRuntime.modelToggle` (22), `useMarineOrchestratorScrubCache.modelSwitch`, `marineFrameStoreCropShow` (17), `marineFramePack.parity`, `marineFramePrefetch` | 76/76 | Jest | green | PASS (Jest); live read NOT-RUNNABLE-OFFLINE |
| #459 `2c0c228a9` | at mid zoom a step shows the right clip at once and asks 0 `/grid` | `ZS VIEW=owner ZOOMS=3.9,4.4,4.8 ARMS=cur,nocropshow`; `VIEW=desktop ZOOMS=5` | z3.9 7/26 ms; /grid 0; mislabel 0; nocropshow 184-195 p50 | store M, `cdn` | cur p95 **15-28 ms**, 0 `/grid`, 0 mislabel; nocropshow p95 205-246 ms (control) | PASS |
| #459 | app crops equal the resolver's mid-tier clip | `OB/scn_static_crop_parity.mjs` | 382 crops, 206,860 nodes, 0 bad | `node … <cdn> 4192 300 out.json` (GFS); `MODEL=EURO LAYER=waves … 120` | GFS: **285 crops, 131,220 grid + 23,965 series nodes, 0 bad, 0 meta**; 70 boxes refused (the backend served all 70 mid-tier); exit 0. EURO: 99 crops, 46,329 + 11,212 nodes, 0 bad | PASS |
| #459 | crop pack byte-identical to the encoder | Jest `staticFrameCrop`, `marineFrameStoreCrop`, `marineGridSeries.staticCrop`, `staticFrames.crop` | 169/169 | Jest | green | PASS (Jest); live read NOT-RUNNABLE-OFFLINE |
| #460 `d1dbeed8b` | swell/wind-wave sets ride the series lane from static frames | `SF MODEL=GFS LAYER=swell_1 ARMS=grid,store` | store 43/237 ms, 0 req | store M, `cdn` | load window: store 128/391 ms, 0 backend. Quiet re-run (02:30Z): **store 36/265 ms, 0 missed, 0 backend** (grid arm 28/3,321 ms, 5 `/grid` + 2 series) | PASS (p95 265 ms against the recorded 237, one step, on this still-loaded PC) |
| #461 `57632973b` | plain EURO/ICON world boxes never come from static frames; crops stay static | Jest `staticFrames`, `staticFrames.crop`; `GUARD=1 scn_static_parity.mjs` | GUARD exit 0 | Jest; parity on M | Jest green; M parity (filled sets) 0 bad | PASS |
| #462 `547182620` | a masked fixture makes the world Gulf fill visible offline | `serve_synthetic --land-mask 1` without the MID env + parity | ICON/EURO 45,747 bad each, exit 1; GUARD exit 0 | a store without `MARINE_GULF_FILL_MID*` | not run | SUPERSEDED (D-050/D-052 serve the targeted fill; M carries it, and its filled sets are 0 bad) |
| #463 `efec1adfa` | `MARINE_GULF_FILL_MID=0` keeps the 10-deg tier only | pytest `test_coarse_gulf_fill_mid` | 6 tests | pytest | green | PASS (pytest); the '0' parity arm SUPERSEDED (never flipped; L-S23) |
| #464 `9f91c0101` | raster legends credit Open-Meteo / RainViewer accessibly | Jest `LayerDataCredit` (8) | green | Jest | green | PASS (Jest) |
| #465 `ff5b7066f` | after a mid-zoom scrub, a zoom-out shows the world frame by the end of the zoom | `OB/scn_zoom_out.js ARMS=cur,noclipcover,noresync VIEW=owner` | PR world by zoom end 4/4; noclipcover stuck | store M, `cdn` | cur 4.45 → 3.25 and → 3.6: **firstWorld 0 ms, minCovers 1, 0 rejects, 0 backstops, 0 backend**; noclipcover never reaches world (partial 39.9 s, rejects 1); noresync as cur | PASS |
| #465 | desktop build-ahead packs the run for the clip show | `ZS ZOOMS=3.9,4.4 ARMS=cur,noaheadrun` (+ desktop z5/z6) | p95 15/15 ms; noaheadrun 46/43 | store M | cur p95 15-28 ms, 0 mislabel; noaheadrun p95 68-77 ms (control) | PASS |
| #465 | guard and layer release, build-ahead | Jest `marineZoomOutRelease`, `marineFrameStoreCrop` | 5,470 pass | Jest | green | PASS (Jest); live read NOT-RUNNABLE-OFFLINE |
| #466 `91d2d890b` | a 60-80% regional tile is neither flagged empty nor cleared | Jest `marineZoomThresholds.coverFrac` | 39 suites | Jest | green | PASS (Jest) |

### #491-#545

| PR | claim | instrument | recorded | re-run offline | 2026-10-26 | verdict |
|---|---|---|---|---|---|---|
| #491 `2d7c062c9` | a box a pilot tile fully covers is served from the bundle, node-identical; partial covers go to the backend | `OB/scn_regional_client_parity.mjs` per layer | 4 layers × FL+SoCal: 0 bad, 0 meta, 0 false claims, 0 refused full covers, sha12 ok | `LAYER=<l> node … <cdn> <port> 300 out.json` | M, 4 layers each: **416 boxes×seams, 56 claimed, grid 18,074 + series 7,262 nodes, 0 bad, 0 meta, 0 false claims, 0 refused full covers, sha12 0**. C (6 tiles): 27,301 + 13,315 nodes, 0 bad, 0 false claims, **5 refused full covers** (`us_southeast_midatlantic` ×3, `france_biscay`, `us_northeast`: "window does not cover") | PASS; WATCH: 5 safe refusals on tiles #491 never measured |
| #491 | z9 Florida opening asks the backend 0 marine `/grid`+`/grid_series` | `ZS ZOOMS=9 CENTER=-80.6,28.1 VIEW=owner ARMS=cur,noregional` | owner 0 asks vs 10-11 | store C | 23:17Z: cur **0 / 0 waves asks**, p95 16 ms, 0 mislabel (noregional's misses there are fault 1); 23:47Z: cur 1 ask, p95 14, 0 mislabel; noregional 4, p95 81 | PASS; WATCH: one waves ask in some sessions (recorded 0) |
| #491 | a late manifest does not delay the first frame | `ZS … LAT_PRODUCTS=4000` | first frame 0.5-1.1 s, 0 asks | store C | cur first 1,389 ms, 1 waves ask, 0 missed; noregional 2,230 ms, 3 asks. Quiet re-run (02:35Z): **cur first frame 1,063 ms, 0 waves asks, p95 15 ms, 0 mislabel**; noregional 5,929 ms, 4 asks | PASS |
| #491 | failure backoff, unservable page not claimed, snapped box, sha12 fail-closed | Jest `marineGridSeries.regional`, `staticRegional`, `staticFrames.crop` | 12/12 mutants | Jest | green | PASS (Jest) |
| #491 (cell 13) | phone touch pans cause no ask amplification | `OB/scn_phone_net.js MODE=phone ARM=regional\|noregional` | ON 2 asks, OFF 3; max repeat 1; silent 0 | store C | ON: **2 `/grid_series` + 1 `/point`, max repeat 1, silent 0**, long frames 2 (max gap 110 ms); OFF: same asks, 7 long (117 ms) | PASS |
| #492 `4eac715a5` | hidden-layer toggles come from 1-hour minis; a toggle at 12 s is an instant cache hit | `SIB CASES=load,toggle@3000:wind_waves,toggle@12000:wind_waves ARMS=cur:…BUNDLES…,before:…+…IDLE_PAGES…` | toggle@12 s 813 → 30 ms; ready 5.7-6.4 s | store M, `cdn` | **toggle@12000 instant commit 14 ms** (before arm 840 ms) | PASS |
| #492 | with a bundle covering z9, hidden layers cost 0 `/grid_series` | `SIB CASES=load ARMS=cur,nob:__RAW_DISABLE_REGIONAL_BUNDLES__` | 0 per load; bundles off 10 | its own store (FL only, 4 layers, no mask) | M: cur asked 3 hidden minis (swell_1, swell_2, wind_waves), 0 pages, 900 ms box CPU; the `nob` arm timed out (60 s). Store SIB, the row's own: tip, #575 build, #492's OWN merge `4eac715a5` and the new tip all ask **3 hidden minis** (swell_1, swell_2, wind_waves; 900 ms modelled), 0 pages. Bundles killed: **10 `/grid_series`, hidden 3 pages + 3 minis, 12.9 s modelled**, the recorded "bundles off" exactly | NOT A REGRESSION (the recorded 0 does not reproduce at #492's own commit on its own store; it came from another setup). WATCH: hidden-layer minis are not served from the bundle |
| #492 | surf mode warms no hidden layer | `SIB SURF=1 MODEL=ICON CASES=load WATCH=120000 ARMS=cur,dev:…SURF_GATE…+…` | 2 hidden surf minis → 0 | store M | cur: **hidden-layer asks 0** (surfGated 9; 6 `/grid_series`, all visible waves); dev arm: 2 hidden minis (ICON swell_1, wind_waves) | PASS |
| #492 | warm decisions (minis first, pages one at a time, ICON never warms swell_2) | Jest `marineSiblingWarm`, `.chain`, `useMarineSeriesWarm`, `marineSiblingPrewarm`, `marineController.warmLanes` | 29/29 mutants | Jest | green | PASS (Jest) |
| #493 `1aa4c8605` | backoff, re-pin, timeout, priority, crypto gate; surf/ICON/EURO never claimed | Jest `marineGridSeries.regional`, `staticRegional`, `staticFrames.crop` | 21/21 guards | Jest | green | PASS (Jest) |
| #493 | owner z9 first frame and asks, bundle vs kill | as the #491 rows | 0.8-1.1 s / 0 asks vs 2.4-3.9 s / 7 | store C | as the #491 rows | as the #491 rows |
| #494 `8f476b20b` | live read of #491 at z9 FL | notes `live-read-491-regional-console.js` | 0 full pages, dynamicOnCovered 0 | — | — | NOT-RUNNABLE-OFFLINE |
| #497 `f096a22bf` | one repo variable per flag; ECMWF reach 4 validates only where ECMWF has sea | pytest `test_flag_lane_parity`, `test_ecmwf_land_centre_block` | 950 = 842/62/46 (real cycle) | pytest | green | PASS (pytest); real-cycle count NOT-RUNNABLE-OFFLINE |
| #500 `4686956ab` | the regional client DARK by default | Jest `staticRegional` | — | Jest | green (now pins DEFAULT_ON true: #552) | SUPERSEDED by #552; PASS (Jest) |
| #501 `1c27d69e1` | surf ICON z8 pans: snapped box, containing-page reuse, supersede, debounce, low priority | `SIB SURF=1 MODEL=ICON ZOOM=8 CENTER=-79.95,26.5 CASES=pans@20 PAN_GAP=3000 WATCH=70000 DRAIN=15000 COST_SURF_*` `ARMS=cur,dev:K501+__RAW_DISABLE_SETTLE_RELOAD_GUARD__` | cur 24 `/grid_series` (19/5), 6 boxes, 58 s CPU, drained 156 s; dev 113 | store M | **cur 8 `/grid_series`, 3 boxes, drained 79 s; dev 27, 6 boxes** | PASS (better than recorded) |
| #501 | a pan inside a cached page asks nothing | Jest `marineSeriesPanGuard`, `useMarineSeriesWarm`, `marineGridSeries`, `.antimeridian`, `marineSeriesWorkBounds` | 30/30 mutants | Jest | green | PASS (Jest) |
| #505 `3804154b3` | the settle reload of a held covering frame is budgeted | `SIB PAN STEPS=6 STEP_GAP=4000 DIAG=1 ARMS=cur,dev:…RELOAD_GUARD…+…PAGE_KEY…` | surf 98 → 44 asks, drained 400 → 89 s | store M | the #501 run above includes the reload guard in its dev arm (cur drains in 79 s); the STEPS=6 variant was not run | PASS (rel., via the #501 run); STEPS=6 leg NOT-RUN |
| #505 | reload-guard unit behaviour | Jest `useMarineScrubSettle.reloadGuard` | 11/11 mutants | Jest | green | PASS (Jest) |
| #501/#505 | live read | notes `live-read-501-505-2026-10-24.js` | owed, none recorded | — | — | NOT-RUNNABLE-OFFLINE |
| #502 `37c1d6f43` | `MARINE_FILL_PROVENANCE_NODES=1` stamps `filled_idx`; off byte-identical | pytest `test_fill_provenance_nodes` (9) | 9 tests | pytest | green | PASS (pytest); byte-cost row has no committed instrument |
| #535 `2ba8e5456` | z7-9 steps inside a pilot tile show from the GPU frame store | `ZS ARMS=noregional,regionalnostore,regional VIEW=desktop ZOOMS=9 CENTER=-80.6,28.1` (+ z7 SoCal) | z9 FL regional 1/16/16 ms | store C (M's land mask covers these views) | z9 FL owner window cur: **p95 16 ms, 7/20 via store, 0 missed, 0 mislabel**; desktop (02:37Z): **cur p95 12 ms, 3/10 via store, 0 missed, 0 mislabel**; noregional p95 55. z7 SoCal: C has no SoCal tile; M's mask covers it | PASS (z9 FL); z7 SoCal NOT-EXERCISED |
| #535 | window pack = real encoder; bundle = resolver | Jest `marineFrameStoreRegional` (+ real-frames fixture); parity as #491 | 0 bytes differ | Jest + parity | green; parity as #491 | PASS |
| #537 `35ec0b86f` | the wind tail page asks only what static frames can't serve; one non-stale wind `/grid` per key | `OB/scn_wind_toggle.js`; Jest `windGridSeries.static`, `windGridResponseCache` | tail 33 → 32 h; repeat 3 → 1 | real-wind store (NOAA GRIBs) | Jest green | PASS (Jest); browser legs NOT-RUNNABLE-OFFLINE (no real wind run on disk) |
| #538 `634f0ece1` | the lakes probe waits for a covering field: EURO lights the lake, GFS does not | `OB/scn_wave_lakes.js VIEWS=michigan8` + `lakes_pairs.js` | EURO 0.894, GFS 0.000 | `--wave-lakes 1` store + `ne_10m_lakes.json` | not run | NOT-RUN (lakes store not built this sweep) |
| #538 | z7+ probes read viewport product ids; z8 steps measurable | `ZS VIEW=owner ZOOMS=8 CENTER=-81.8,28.1 ARMS=cur,noregional` (+ Biscay z9) | FL z8 10/10 exact, p95 9 ms; Biscay p95 14 | store C | FL z8: **cur 20/20 exact, p95 21 ms, 0 mislabel, 0 stale** (14 series, 6 store); noregional 20/20, p95 55, 4 waves asks per session. Biscay z9 (hour 0 on cadence): **cur p95 14 ms**, 0 missed; noregional 0 missed, p95 1,302 | PASS |
| #540 `00dacbcb7` | air temperature from our own GFS frames, 0 Open-Meteo requests | `raster-lab/probe_own_frames.js LAYER=temperature`; Jest `ownRasterFrames`, `ownRasterLayer`, `staticFrames` | toggle ≤ ~450 ms; 0 `.om` | RR_DIR recording + own frames | Jest green | PASS (Jest); browser leg NOT-RUNNABLE-OFFLINE |
| #541 `c1309243c` | per-ask SWR ladder, per-page reload budget, siblings asked once | `MT REQLOG=1 CONLOG=1` on a `--stale-seconds 150` store; Jest `marineRequestDiet`, `useMarineRevalidation`, `useMarineScrubSettle.reloadGuard`, `marineSiblingWarm` | swell 95 → 66 asks, worst key 36 → 18 | lakes + stale store | Jest green | PASS (Jest); browser leg NOT-RUN |
| #542 `ba5938585` | D-050 EURO own values and targeted fill (live) | `gulf_probe.py` (live) | EURO 1,674 → 25 of 3,739 | proxy: M with `MARINE_GULF_FILL_MID_TARGETED=1` + parity; pytest `test_coarse_gulf_fill_targeted` | M filled sets 0 bad; pytest green | PASS (proxy); live NOT-RUNNABLE-OFFLINE |
| #543 `ccbdce0cf` | the no-progress cap engages when two residents alternate | Jest `marineSettleWatchdogs.clampProgress` | 0,0,1,2,3,4 | Jest | green | PASS (Jest); replay leg NOT-RUN |
| #545 `b5d3dab70` | z8 FL: the bundle makes steps instant, not model switches | `MT ZOOM=8 CENTER=-81.8,28.1 VIEW=owner ARMS=on [FLAGS=__RAW_DISABLE_REGIONAL_BUNDLES__]` | 0 silent; 0 lit lake; step 0-20 ms; toggle ≤ 100 ms is a known miss | store C, `CDN_PORT=4381` | 01:42-02:16Z, 2 sessions each: bundles on: **0 silent, 0 lit lake**, clicks p50/p95 503/7,962 ms (ICON/EURO 60-7,962, GFS 431-503), 0 from the store; the step after a click 2-71 ms (13 of 16 ≤ 17 ms; 40, 45, 71 after GFS clicks). Bundles off: 0 silent, 0 lit lake, 2,837/5,912 ms, steps 3-16 ms. Click 7 (ICON h168) and click 9's step are missed in both arms | PASS (0 silent, 0 lit lake); WATCH: toggles slower than recorded (0.4-3.9 s) and 3 post-click steps over 20 ms, under foreign CPU load (toggle time is a known miss) |

### #546-#595

| PR | claim | instrument | recorded | re-run offline | 2026-10-26 | verdict |
|---|---|---|---|---|---|---|
| #546 `3d2b98d9c` | cloud layer from our own frames, 0 Open-Meteo requests | `raster-lab/probe_own_frames.js LAYER=satellite`; Jest `ownRasterFrames`, `ownRasterLayer` | toggle ≤ ~300 ms | RR_DIR + frames | Jest green | PASS (Jest); browser and point-parity legs NOT-RUNNABLE-OFFLINE |
| #547 `c4f7dbe64` | the probe flags frames > 1.5 h from the label | `ZS VIEW=owner ZOOMS=8 CENTER=119.4,-4.5 ARMS=cur,noregional` | 0 stale, max lag 0 h, both arms | store C | hour 0 on the cadence (23:52Z): **0 stale, 0 stale-silent in both arms**; mislabel cur 0, noregional 537 (all labelled, 0 silent). Cur had 3/10 not exact within 8 s: the view crosses the tile's 120°E edge, so `/grid` builds a viewport product. No timing was claimed. The 21:35Z run's 3,067 "stale" frames were fault 1 | PASS |
| #548 `2e25321a4` | every ICON/EURO tail set builds and equals `/grid` | `OB/scn_static_parity.mjs` on a tails-built CDN | 0 bad of 27,522,136 nodes | M, `cdn` | 0 bad of 27,522,136 nodes (the #453 row) | PASS; the publisher's flag path itself changed in #597 (after this tip) |
| #548 | past the tail, the hold serves the 2-deg frame | `OB/day14_arms.py` arms 0/1 on D14; `OB/day14_labels.mjs` | arm 1 Gulf 66/70 at every day-14 hour | `python OB/day14_arms.py arm 1 --store <D14>` | arm 0: ICON/EURO +333/+336 h **10-deg (37×17), Gulf 4 nodes**; +312/+330 2-deg, Gulf 66. Arm 1: **181×83 at every day-13/14 hour, Gulf 66** for ICON and EURO (the recorded "66/70" read as 66 of 70) | PASS |
| #548 | hold tiers, rails, trim, tail downloads | pytest `test_day14_end` (22) | 22 | pytest | green | PASS (pytest); live flips NOT-RUNNABLE-OFFLINE |
| #552 `fee207ac2` | bundles ON: z7-9 pilot boxes scrub with no misses or mislabels; the kill returns them to `/grid` | `ZS ZOOMS=8 CENTER=-81.8,28.1` and `ZOOMS=9 CENTER=-3,45.6`, `ARMS=cur,noregional ROUNDS=2` | missed/mislabel/stale 0 in both arms; p95 9 / 14 ms | store C | FL z8: cur 0/20 missed, p95 21 ms, 0 mislabel, 0 stale; noregional 0/20 missed, 4 waves asks per session against cur's 1 (the kill bites). Biscay z9 (on cadence): cur p95 14 ms, 0/10; noregional 0/10 | PASS |
| #552 | phone pans and lossy network: no amplification, no wrong-model frames | `OB/scn_phone_net.js MODE=phone` and `MODE=net RTT=400 LOSS=0.01/0.05`, arms regional / noregional | silent 0; max repeat ≤ 1 | store C | phone: see the #491 cell 13 row. Loss 1%: regional 5 asks, max repeat 1, silent 0; noregional 8 asks, 1 failed, max repeat 1, silent 0. Loss 5%: regional 8 asks, 2 failed, max repeat 1, **silent 0**; noregional 17 asks, max repeat 2 (1 duplicate without a failure), silent 0 | PASS; WATCH: the bundles-killed arm repeated one ask at 5% loss |
| #552 | default arm, kill arm, kill beats opt-in | Jest `staticRegional`, `staticFrames.crop` | green | Jest | green | PASS (Jest); live gate NOT-RUNNABLE-OFFLINE |
| #553 `b1e174c5c` | the wind truth-tag hash is off the toggle path | `OB/scn_wind_toggle.js PROFILE=1` (real wind); Jest `windStaticFrames`, `windDarkRules` | 16 ms hash gone | real-wind store | Jest green | PASS (Jest); browser leg NOT-RUNNABLE-OFFLINE |
| #555 `264d57e05` | filled EURO/ICON world frames equal world `/grid`; filled sets take EURO world views off the box | `scn_static_parity.mjs`; `MT ZOOM=1.2 CDN_LAT=340 PLAN=EURO,GFS,EURO,GFS,ICON,EURO,GFS,EURO` ± `__RAW_DISABLE_STATIC_FILLED_WORLD__` | filled 0 bad; `/grid` 0 vs 2, series 1 vs 7 | M | filled sets 0 bad (the #453 row). Clicks: filled (preload arm) **0 `/grid`, 0 `/grid_series`**; filled killed 2 `/grid` + 6 `/grid_series`; silent 0 in all | PASS |
| #555 | publisher fill, donor and mode stamps; client fail-closed | pytest `test_frame_set_fill` (12); Jest `staticWorldFilled` | 9/9 + 4/4 mutants | pytest + Jest | green | PASS (pytest, Jest) |
| #560 `a90269eac` | the status line describes the drawn frame (exact = no words; ≤ 1 h "nearest"; else "Loading…") | scratch `scn_drawn_honesty.js` (never committed); proxy `ZS CENTER=-79.3,27.5 ZOOMS=8` stale-silent | fix 0 of 16 rows wrong | store C | proxy (02:38Z, the tile's east edge z8): **0/10 missed, 0 mislabel, 0 stale, 0 stale-silent**, p95 66 ms (5 store, 3 series, 2 grid). Every C and M zoom-scrub session: 0 stale-silent frames | PASS (proxy); Jest `drawnFrameTruth` PASS (Jest) |
| #560 | matrix cell 2: no mislabel at z3.9 | scratch `c2/scn_cell2.js` (never committed) | mislabel 0 | proxy: the #459 z3.9 sessions | 0 mislabel at z3.9 (waves) | PASS (proxy) |
| #571 `0c4041f98` | preloading the filled index cuts the cold first EURO click | `MT ZOOM=1.2 CDN_LAT=340 ROUNDS=2 PLAN=…` × (no flags / `…FILLED_INDEX_PRELOAD__` / `…STATIC_FILLED_WORLD__`), all with `…FILLED_WORLD_STORE__` | first click 1,302/1,389 → 868/842 ms | M, `cdn` | first EURO click: preload **1,034 / 934 ms**; no preload 1,421 / 1,696; `/grid` path 1,187 / 1,601. Later EURO clicks 406-645 ms; 0 EURO world asks with preload; silent 0 | PASS (rel.: preload < no-preload and < the `/grid` path; absolute 21:02-21:25Z, partly loaded) |
| #571 | preload rides latest.json; none under kills | Jest `staticWorldFilled` | 3/3 mutants | Jest | green | PASS (Jest) |
| #575 `5601b9d59` | the frame store shows the filled EURO/ICON world frame at the click | `MT ZOOM=3.2 PLAN=EURO,GFS,EURO,GFS,EURO,GFS ARMS=on` ± `FLAGS=__RAW_DISABLE_FILLED_WORLD_STORE__` | fix p50/p95 6/9 ms, 6/6 store; kill 455/682 | M, `cdn` | same-window control: **tip 1/50 and 4/14 ms, 12/12 store; #575 build 5/15 and 3/15**. Kill arm (load window): EURO 505-1,040 ms, not from the store. Silent 0 | PASS |
| #575 | filled-store acceptance and crop refusal | Jest `filledWorldStore`, `marineFrameStoreCropShow`, `marineFrameStoreRuntime.modelToggle` | 208 tests | Jest | green | PASS (Jest) |
| #577 `c4e0b57b1` | `MARINE_EXT_CEILING_MARGIN_H` bakes ICON/EURO tails past run+336 | pytest `test_marine_ext_ceiling_margin` (11) | 11 | pytest | green | PASS (pytest); post-flip live read NOT-RUNNABLE-OFFLINE |
| #578 `9e7ecd470` | a held frame says "Holding …", not "Loading" | Jest `drawnFrameHold` | 3 | Jest | green | PASS (Jest; the rule now lives in #587) |
| #581 `f69734e8e` | RESOLUTION leg: band held on a ≥ 1° rating grid, with the line | `OB/scn_rating_band.js ARMS=on,nofix SETTLE=10000` | 1° grids: fade 0, line shown; nofix paints | M, `cdn` | **1° grids held, line shown; nofix paints**; 0.5°/0.25° fade 1. (C has no 1° grid at these zooms: every settle at 0.25-0.5°, fade 1) | PASS |
| #581 | EDGE leg: band held while the resident covers < 98% after 1.5 s | `OB/scn_rating_band_edge.js THEME=dark\|light\|beach VIEW=desktop\|phone ARMS=on,nofix` | desktop 63.5%: edge 0, bandMult 0, line; phone 44.8% held; nofix seam | store C, `cdn_clean` | desktop dark/light/beach: **coverage 0.635, edgeFade 0, bandMult 0, held=edge, line shown; nofix paints** (×3). Light phone: **0.662 held, line**; covering grid lands → fade 1. Dark and beach phone: the covering grid landed before the 4 s sample. Re-run with the held read at 1.8 s: the resident still covered the shifted view (coverage 1, in the no-fix arm too), so no held state can arise there | PASS (desktop ×3, light phone); dark and beach phone NOT-EXERCISED (the store covers the phone pan) |
| #581 | fade legs and status line | Jest `marineRatingBandRes`, `ForecastTimeStatus` | 25 | Jest | green | PASS (Jest) |
| #587 `83a36acc6` | past a stored tail the line says the true data time ("Holding …") | scratch `tail/scn_tail_ring.js` (never committed); proxy `day14_labels.mjs`; Jest `drawnFrameHeld`, `drawnFrameHold`, `drawnFrameTruth` (234) | Holding lines in 4 phases | proxy on D14 (`day14_arms.py arm 1`, then `TZ=America/New_York node OB/day14_labels.mjs`) | Jest green. Proxy, first read: every held row "Loading Sun, Nov 8, 3 PM… still showing Sun, Nov 8, 1 PM", because `day14_arms.py` never set the drawn record's hour, which #587's held rule needs (fault 8). With the hour set (this branch): ICON +330/+333/+336 **"Holding Sun, Nov 8, 1 PM’s ICON forecast: beyond ICON’s native range"**, EURO +333/+336 "Holding … EURO forecast: beyond EURO’s range"; +312 and EURO +330 "Showing …: the nearest stored forecast" | PASS (Jest, proxy) |
| #588 `82bde66ae` | with `MARINE_GULF_FILL_DONOR_SERVED_TIME=1` the fill takes its GFS donor at the frame's own time | pytest `test_coarse_gulf_fill_targeted`; `day14_arms.py arm 1` ± flag | on: donor = served hour; held vs static 135/134 → 0 bad | D14 | pytest green. Arm 1, flag off: the held 18Z ICON/EURO frames take GFS donors at **21Z / 00Z / 03Z** (the asked hours); flag on: **18Z** (the served hour) at +330/+333/+336. The same as this morning's evidence run | PASS (pytest, real fields). Since 10-26 12:20Z the flag is ON on the live box (D-053; store M left it dark) |
| #592 `4e0044461` | one wind delivery per effect run | `OB/scn_wind_owner_batch.js ARMS=off,on ZOOM=8`; Jest `windDeliveryCoalesce`, `windDarkRules` | on: max 1 per phase | multi-model wind store | Jest green | PASS (Jest); browser leg NOT-RUN (no wind store built this sweep) |
| #595 `978195bc3` | lazy truth-tag census + replan after paint: faster first wind draw | `OB/scn_wind_toggle.js ARMS=cur,prdoff` (real wind); Jest `truthTagLazyCensus`, `windFramePrefetchReplan` | z2 69/96 vs 84/117 ms | real-wind store | Jest green | PASS (Jest); browser leg NOT-RUNNABLE-OFFLINE |

Out of scope (not weather or map, or no measurable claim): #495, #496, #498, #499, #503, #504, #536, #539, #544, #549, #550,
#551, #554, and #414 (open).

## 5. Re-running this matrix

1. Build the stores and CDN copies of section 1, the SPA, and serve each with `serve_spa.js`.
2. Keep every timing row off the :00 and :30 anchor roll. The sweep drivers wait until 6-7 min are clear.
3. Read each row's command from the "re-run offline" column, with the section 1 env.
4. Treat a timing that misses its recorded number as a claim only after a same-window control build (section 1) disagrees.
5. Read the idle two-rAF, and drop `anchorRolled` sessions.
6. Before trusting a "silent" count, read the status text the frame showed (`mid.status` in `ZS` output).
