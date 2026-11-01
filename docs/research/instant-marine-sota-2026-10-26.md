# Instant, correct marine layers: state-of-the-art levers (research, 2026-10-26)

**From the researcher session, for the lead session and the build sessions.** This is a docs-only change: no product
code, no flag, and no request to the live backend. Every claim carries a tag:

- **[measured]**: read from this repo's code at `dev` `4b8563851`, or measured by the program and cited to its record.
- **[cited]**: a primary source this session read, linked.
- **[cited-2]**: a secondary source, or the program's earlier research notes.
- **[inferred]**: reasoning, not evidence.

The owner's goal, 2026-10-26: *"All marine layers need to be instant. Work perfectly. Display correct data."* The layers are
the wave-height heatmap, the crest particles and the surf-rating band, for GFS / EURO / ICON x waves / swell_1 / wind_waves,
on the 14-day timeline.

## 1. Summary

- **The four owner failures of 2026-10-26 have five code roots, and two of them are new to the program's notes.**
  - **New: band ON takes the frame store out completely.** `staticEligible` returns false whenever the rating band is on
    (`staticFrames.js:494`: "rating grids are a server transform"). So with the band on, no scrub step for any model or
    zoom comes from the frame store [measured].
    - The owner's ICON z5.21 session ran with the band on (`[FORENSIC-SNAP] ... rating true band true`). This is a second
      cause beside the lead's "crops are GFS-only".
  - **New: EURO/ICON crops refuse every regional overlap.** `staticFrameCrop.js:186-188` refuses a EURO/ICON crop on ANY
    overlap with a regional product, because those models carry estimated regional tails the server serves at every width
    [measured].
  - **The blank is a 2-second timer.** The switch hold bridges 2 s and then "blanks honestly"
    (`marineTransitionCoordinator.js:126-129`, `SWITCH_HOLD_TTL_MS_DEFAULT = 2000`). EURO h328 is an un-framed estimated
    hour, so it took longer than that [measured].
  - **The band linger comes from two things together** [measured]:
    - a source-ranked abort gate that never lets a toggle release a scrub fetch (`useMarineDataFetcherCore.js:858-862`);
    - a rating texture that holds scores in the height byte (`WebGLMarineTextureEncoder.js:314`), so the honest heights are
      not on the GPU when the band turns off.
- **The state of the art separates the render decision from the data request** [cited]:
  - MapLibre applies `visibility` and custom-layer uniforms on the next animation frame;
  - deck.gl keeps old tile content until new content loads;
  - earth.nullschool keeps the old field on screen and withdraws its label while a new product loads;
  - WeatherLayers GL blends in data space before the palette;
  - webgl-wind and WeatherLayers keep particles and swap the field under them.
- **The top five levers, in rank order** (section 4):
  - **L1** the band as a uniform flip;
  - **L2** a model switch that holds until replaced, labelled by what is drawn;
  - **L3** closing EURO/ICON's CDN coverage holes;
  - **L4** request lanes keyed on the target, not the trigger;
  - **L5** rating frames on the CDN, computed by the same Python chain.
  - Each has an offline acceptance test (section 5).
  - L1, L2 and L4 are client-only and move no served number.
  - L3 is mostly a flag that #548 built (`FRAME_TAIL_DOWNLOAD`).
  - L5 is publisher work, parity-gated.
- **Two data findings for "display correct data"** [measured + cited]:
  - **GFS-Wave is real every hour to f120**, but `noaa_gfs_wave_fetcher.py:382` keeps every 3rd hour.
  - **ECMWF open data has real EURO waves every 6 h to 360 h**, but `ecmwf_opendata_fetcher.py:172,367` stops at 240 h,
    and the app blends an "estimate" for 246-336 h.
  - Both are served-number changes for the owner (L6).
  - Interpolation (L7) then covers only the remaining 3 h gaps, labelled.

## 2. The contract these levers are measured against

From the lead's "instant" contract (instant-everything, 2026-10-22) [cited-2], with the sources this session re-read.

| Rule | Number | Basis |
|---|---|---|
| Tap / step | p50 <= 50 ms, p95 <= 100 ms | 0.1 s response limit; tap latency JND (Deber et al., CHI 2015) [cited-2] |
| Drag / held key | <= 33 ms a step, or skip to the latest | drag JND; Swift et al., CHI 2012 (a low-res stand-in was as good as full res while scrubbing) [cited-2] |
| Frame | <= 16.7 ms, no spike > 50 ms | 60 Hz [cited-2] |
| Never a blank frame | 0 | Rensink, O'Regan & Clark: 240 ms images with an 80 ms blank between them made changes "extremely difficult" to see, some taking 20 s ([abstract](https://www2.psych.ubc.ca/~rensink/publications/abs.96.2.html), [cited]; Psychological Science 8:368-373, 1997) |
| No flashing | <= 3 flashes/s over a large area | WCAG 2.3.1: a flash is "a pair of opposing changes in relative luminance of 10% or more" over more than 25% of any 10-degree field ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html), [cited]); a blank-then-redraw at key-repeat rate over the ocean is such a pair [inferred] |
| Swap | hard swap next frame, or a <= 100 ms DATA-space blend; never a pixel cross-fade of a moving field | Battersby & Goldsberry 2010; Heer & Robertson 2007 (section 6.5) [cited] |
| Loading words | none before ~300 ms; a looped indicator only past ~1 s | NN/g progress indicators; React's stale-content pattern (section 6.1) [cited] |

## 3. The owner's symptoms, traced to code [measured]

Console: shared notes `owner-manual-test-2026-10-26/console-0840.txt` (the lead's excerpt).

### S1. The band stays on for seconds after it is turned off

1. **The toggle is a fetch, and the gate never lets it release a scrub.**
   - The toggle dispatches `flavor_toggle` through ONE slot. `useMarineDataFetcherCore.js:858-862` keeps any in-flight
     source matching `manual|timeline|scrub` against any other source:
     `[Abort-Gate] Preserving high-priority fetch (timeline_scrub) against low-priority request (flavor_toggle)`.
   - The kill `__RAW_DISABLE_FLAVOR_TOGGLE_VIEWPORT__` reclassifies the toggle as `manual`. The same gate also ranks
     `manual` high, so an A/B of a new gate must account for it.
2. **The rating grid replaces the heights with scores.**
   - A rating grid writes SCORES into the texture's height byte (`WebGLMarineTextureEncoder.js:314`, `hScale = 10` for
     rating grids).
   - The REVERSE gate (`WebGLMarineEngine.js:1560-1569`) then keeps painting the band until an honest grid commits, so
     scores are never drawn on the height ramp. That gate is correct, and the cause of the linger.
3. **Result:** the band turns off only after the stuck scrub fetch finishes AND an honest grid arrives. Worst seen:
   `Stranded fetch-pending released (idle 18.0s ...)`.

### S2. ICON (and EURO) not instant at mid zoom; far jumps wait on /grid

1. **Band ON excludes the frame store** (`staticFrames.js:494`). Every step with the band on goes to `/grid` or
   `/grid_series` with `surf=1`. The precompute note in shared notes estimates a live ICON surf page at 10-25 s of the
   one-CPU box per view [cited-2].
2. **A EURO/ICON mid-zoom crop is refused on any overlap with a regional product** (`staticFrameCrop.js:186-188`). The crop
   then waits on `/grid_series`, as in `fromSeries=true`, dims 91x40, `storedProductId null`. GFS refuses only when the
   server might serve the regional tile instead.
3. **ICON past 168 h is never shown from the store** (`marineFrameStoreRuntime.js:531`, miss `icon_blend_hour`). The
   production path draws a client blend there unless `REACT_APP_ICON_STORED_TAIL` is set.
4. **The far-jump lag** (`rendered hour=29, requested hour=250 ... Fetch already in-flight`, x10+) is the same gate as S1:
   an in-flight request for a stale target holds the slot.

### S3. Switching to EURO clears the heatmap

1. `clearBuffers` (`WebGLMarineEngine.js:3154`) ran right before `Active model lock target set to: EURO`, and the next frame
   logged `render returned early! ... _waveData: false`.
2. The switch hold that should bridge this expires after `SWITCH_HOLD_TTL_MS_DEFAULT = 2000`, and its comment says it
   "bridges ~2s then blanks honestly" (`marineTransitionCoordinator.js:126-129`).
3. EURO h328 is in the estimated tail, which is not on the CDN (S4). No warm frame existed, `/grid` took longer than 2 s,
   and the screen went blank.

### S4. EURO's CDN set lacks the estimated tail past 240 h

- `forecast-ingest-pilots.yml:166`: `FRAME_TAIL_DOWNLOAD` defaults to `'0'`. #548 built the tail download dark, "no served
  number moves" (shared notes `ICON-estimated-tail-not-framed-2026-10-24.md`, UPDATE 2026-10-25).
- With the flag at `'0'`, every EURO hour past ~240 h and every ICON hour past 168 h is a `/grid` round trip.
- **Underneath:** EURO's 246-336 h tail is an estimate only because the fetcher stops at 240 h
  (`ecmwf_opendata_fetcher.py:172,367`). ECMWF open data publishes real waves every 6 h to 360 h (section 6.5).

### S5. "Nearest stored forecast ... beyond native range" reads as a fault

- The wording is honest (`drawnFrameReadout.js:108`).
- The marine engine has no temporal interpolation, so an off-lattice hour always shows a neighbour.
- **For GFS before 120 h, the neighbour is not even needed:** the real hour exists upstream and the fetcher drops it
  (`noaa_gfs_wave_fetcher.py:382`, `range(0, max_f + 1, 3)`).

## 4. Ranked levers

**How to read the table:**

- **Served?:** whether a served number moves.
  - **no**: ships ON with a kill switch.
  - **visual**: ships ON with a kill switch, owner A/B.
  - **SERVED**: dark, the owner flips (D-001).
- **Suggested owner sessions:** IS = instant-scrub (frame store, model toggles, labels); SF = static-frames (CDN
  publisher, parity); RZ = instant-scrub-real-zooms (mid zoom, rating band).
- Gains are against section 2.

| # | Lever | Owner symptom | Expected gain vs the contract | Risk | Served? | Owner | Evidence |
|---|---|---|---|---|---|---|---|
| **L1** | **The band is a render decision.** OFF flips `u_surfMode` and shows an honest frame already on the GPU (frame store, regional bundle, or the honest slot kept when the band went ON); no fetch on OFF. Stage B: rating scores in their own channel beside the honest height | S1 | OFF: seconds (18 s worst) -> next frame, p95 <= 33 ms; 0 network asks on OFF | Low. Keep the REVERSE gate as the fallback, so scores never draw on the height ramp | no | RZ (band) + IS (store show) | MapLibre `triggerRepaint` / `isHidden` source; Cesium `preloadWhenHidden`; section 6.2 |
| **L2** | **A model switch holds until it is replaced.** No 2 s blank: an A/B slot flips binding + label in one commit after the new frame is drawn once. Label, legend and readouts read the DRAWN slot's stamp. "Showing ICON · EURO loading" after 300 ms (aria-live polite). Same-model coarse stand-in warmed in idle | S3 | Blank frames on a slow switch 1+ -> 0; first correct-model pixel p95 <= 100 ms with the stand-in (warm #458 path already 12 ms p95 offline) | Low-medium. A held foreign frame must never carry the new label: the slot stamp is mandatory | no (label) / visual (stand-in) | IS | earth.nullschool `showGridDetails(null)`; deck.gl `reloadAll` "use cached layers until new content is loaded"; MapLibre `'expired'` tiles; Song & Szafir 2019; section 6.1 |
| **L3** | **Close EURO/ICON's CDN holes.** (a) `FRAME_TAIL_DOWNLOAD=1` (#548, dark); (b) make the EURO/ICON crop rule exact per hour instead of refusing any regional overlap, or publish the estimated regional tails as bundles; (c) one ICON >168 h product: the stored tail or the client blend, not both | S2, S4, S3 (no warm EURO tail frame) | EURO 240-336 h and ICON 168-336 h: `/grid` (world 0.85-1.5 s, D-050 watch) -> CDN 0.34-0.71 s -> resident <= 17 ms; mid-zoom EURO/ICON series pages -> crops | (a) low, one live read; (b) medium, product-choice parity; (c) SERVED if the two ICON products differ | (a) no; (b) no if parity; (c) SERVED | SF (a, b), IS (b client, c) | #548; `staticFrameCrop.js:186-188`; `marineFrameStoreRuntime.js:531` |
| **L4** | **Request lanes keyed on the target.** Replace `isHighPriority(source)` with "keep an in-flight request only while its target (model, layer, hour, flavour, snapped box) is still wanted". Render-control actions never enter the slot. Interactive lane latest-wins with an epoch checked at commit; a superseded `/grid` is detached (self-caches), at most 1 detached; background lane `priority:'low'`, cap 4 | S1 wedge, S2 far jumps | The next target's request starts within 1 frame instead of after a stale round trip (seconds); the 18 s wedge class -> 0 | Medium-high. It is the dispatch core (dedupe, pan replay, detach). Detached `/grid` still costs box CPU: cap it | no | IS | RxJS `switchMap`/`exhaustMap`; TanStack Query cancellation; loaders.gl RequestScheduler; Starlette `is_disconnected`; section 6.3 |
| **L5** | **Rating frames on the CDN, from the SAME chain.** The publisher calls the backend's `surf_rating` transform per run for the pilot boxes and the mid-zoom crops, parity-gated node by node against `/grid surf=1` on the real resolver. The client stops refusing `surf` for sets that have them | S2 (band on), S1 stage B | Band-ON scrub: `/grid surf=1` (10-25 s box CPU per cold ICON page) -> store p95 <= 17 ms; box load off the request path | Medium. ONE FORECAST COMPOSITION: no client re-derivation, so parity is the gate; 2-9 Actions-minutes and 1-8 MB per run (estimate) | no if parity is exact; else SERVED | SF + RZ | shared notes `precompute-surf-frames-cost-estimate-2026-10-24.md`; L-S lessons on synthetic parity |
| L6 | **Ingest the real model hours the fetchers drop.** (a) GFS-Wave hourly f001-f120 (`noaa_gfs_wave_fetcher.py:382` keeps every 3rd hour; upstream is hourly to f120); (b) EURO waves to 360 h (`ecmwf_opendata_fetcher.py:172,367` stops at 240 h; upstream is 6-hourly 150-360 h), replacing the blended 246-336 h tail with model output | S5 (GFS days 1-5), S4/S3 (EURO tail) | GFS: 121 real frames to 120 h instead of 41, so 0 "nearest" labels there; EURO: 16 real steps replace the blend | (a) ingest time and bucket up to ~1.7x (Actions, not the box); (b) touches the LOCKED extension contract | **SERVED** (both): dark, SCOREBOARD row, owner | SF + ingest | section 6.5 table (NCEP, ECMWF listings) |
| L7 | **Labelled time interpolation, plus model-hour ticks.** Clamped temporal Catmull-Rom (or PCHIP) for height, Hs²-weighted unit vectors for direction (nearest step if the ends differ > 60 deg or the field is a peak direction), nearest step for period. Same model and run only, gaps <= 3 h. Three-state label in words; real model hours as scrubber ticks | S5 | Off-lattice hours: MAE ~1/3 of hold, 15-30% under linear (program hold-out); "nearest stored forecast" gone for interpolable hours | Storm peaks flatten at 6 h; honest only with the label | SERVED (time display): dark; ticks: no | IS | program hold-outs (time-interpolation-holdout-2026-10-20); Song & Szafir; section 6.5 |
| L8 | **Far jumps draw something true at once.** Landmark frames always resident (every 6 h: 57 frames ~3.1 MB; every 24 h: 15 frames ~0.8 MB per set); a jump draws the nearest resident frame, labelled with its own hour, then refines. Phone window direction- and velocity-aware (about +12/-4 instead of +-8; stride during a drag; destination +-2 first on release) | S2 far jumps, phones | First pixel <= 33 ms on any jump; ForeCache's analogue: average 984 -> 185 ms at k = 5 | Label honesty: it is the existing "nearest stored" wording | no | IS | ForeCache (SIGMOD 2016); deck.gl `best-available`; HLS I-frames; Cesium; section 6.4 |
| L9 | **Precision and channels.** R16F height in metres (no per-upload scale), unit-vector direction (RG8_SNORM or RG16F), the score in its own channel | enabler for L1 stage B; terraces | Height error 31 mm -> 3.9 mm at 8-16 m; no 16 m clip; height memory halves | Readouts sampled from the texture move: check, dark if so; `UNPACK_ALIGNMENT` 1 | visual / SERVED if a readout moves | IS | Khronos ES 3.0 refpages; IEEE half spacing; section 6.6 |
| L10 | **Phones and first use.** A per-frame upload budget (about 2 ms JS and 256 KB on phones), row-banded global uploads, idle warm-up of programs x VAO x blend x target formats (Android has KHR_parallel_shader_compile on 0.3% of reports), a device memory budget and a crash-reload breadcrumb | first-toggle stalls, iOS reload loops | No frame > 50 ms after warm-up; no jetsam loop | Budgets are inferred: calibrate on devices | no | IS | Unity async upload (2 ms default); web3dsurvey; WebKit bug 300782; section 6.6 |
| L11 | **A <= 100 ms data-space blend on a swap** (two resident textures, `mix(value)` then palette; hard cut over land/no-data and while dragging) | flash on cut | Every frame on the legend; 1 extra texel fetch for ~6 frames | Grids and masks differ between models | visual (owner A/B) | IS | WeatherLayers `pixel.glsl`; Battersby & Goldsberry; Heer & Robertson |
| L12 | **Crest particles keep their positions through a switch** (bind the new field; normal renewal; staggered ages if a reseed is unavoidable) | "restart" jolt | 0 extra motion onsets at a switch | About one trail lifetime of the old field; check today's crest behaviour first | visual | IS | webgl-wind `setWind`; WeatherLayers particle layer; nullschool `randomize({age})` |

**Why this order** [inferred]:

- **L1 and L2** are the "work perfectly" failures the owner sees every session. They are client-only and cheap.
- **L3** is mostly a flag that has been built and is waiting. It also removes the cold case behind S3.
- **L4** fixes the worst measured number (an 18 s wedge), but it touches the dispatch core, so it goes after the cheap
  wins and under the full harness matrix.
- **L5** is the only lever that makes band-ON scrubbing instant at all. It is publisher work behind a parity gate.
- **L6 and L7** are the "display correct data" half. They rank below the top five only because they are served-number
  changes that wait on the owner (and L6b touches the LOCKED extension contract), not because they matter less.
- **L8 onward** are refinements once the above hold.

## 5. Acceptance tests (offline only)

**Rules for every test** (from the program's LESSONS):

- **Offline only.** Use the offline backend (`serve_synthetic.py`), a local CDN copy (`CDN_DIR`, `CDN_LAT`) and the
  Playwright scenarios in `frontend/scripts/offline-backend/`. Never the live box.
- **Real frames.** Run every arm on a store built from REAL frames: synthetic stores have no masked cells and hid #453's
  defect.
- **Valid timing.** Measure an idle two-rAF first. Above ~40 ms the window is throttled, so report counts only.
- **Positive control.** Each test runs with a kill-switch arm that must FAIL it.

### T1 (L1): the band toggles on the next frame

- **Harness:** extend `scn_rating_band.js`, or add `scn_band_toggle.js`.
  - The mock holds every `surf=1` `/grid` open for 20 s, and a scrub is in flight.
  - Toggle the band OFF/ON 50 times at z5.2 (ICON, EURO, GFS) and z8 Florida, in all three themes.
- **Record:**
  - input -> the first rAF whose `__RAW_GPU__.ratingBand.active` equals the new state;
  - weather requests issued on OFF;
  - per rAF, whether a rating grid was drawn with `u_surfMode` 0;
  - the wave texture read back before ON and after OFF.
- **PASS:**
  - OFF p95 <= 33 ms when an honest frame for the drawn hour is resident;
  - 0 requests on OFF in that case;
  - 0 frames of scores on the height ramp;
  - the read-back bytes after OFF equal the store layer's bytes;
  - the status line says "loading wave heights" only when nothing honest is resident, and not before 300 ms.
- **Control:** the kill arm shows the seconds-long OFF.

### T2 (L2): a model switch never blanks and never mislabels

- **Harness:** `scn_model_toggle.js`, with EURO's backend and CDN delayed by 0.2 / 2 / 5 / 15 s. The plan must include
  EURO h328, an un-framed tail hour, plus 20 switches per model pair x waves / swell_1 / wind_waves.
- **Record per rAF:**
  - ocean-pixel coverage (three sentinel pixels, or a reduced read-back) against the pre-switch frame;
  - `[WebGLMarineEngine] render returned early ... _waveData: false` lines;
  - the drawn slot's model vs the legend, readout and infobox text (`silentChipNew` = a mislabel);
  - the loading text's first appearance.
- **PASS:**
  - 0 frames below 95% of the pre-switch coverage;
  - 0 early returns with marine active;
  - 0 `silentChipNew`;
  - loading text absent before 300 ms and present by 350 ms whenever the switch is still pending;
  - with the stand-in on, the first correct-model frame p95 <= 100 ms.
- **Control:** `__RAW_SWITCH_HOLD_TTL_MS__ = 2000` (today) must fail the 5 s and 15 s arms.

### T3 (L3): no `/grid` for any hour the CDN lists

- **Publish:** offline, run `publish_frame_images.py` with `FRAME_TAIL_DOWNLOAD=1` and `--tail-store-dir` on a REAL stored
  run (the 10-24/25 evidence runs).
- **Client:** jump into EURO h241-336 and ICON h169-336, at world zoom and at z4.6-5.3 over Florida and Biscay.
- **Record:**
  - weather asks per step;
  - the drawn product id;
  - for each hour, the product the offline resolver would serve.
- **PASS:**
  - 0 `/grid` or `/grid_series` asks for hours the index lists with a path;
  - drawn product id = the resolver's choice at 100% of steps;
  - step p95 <= 100 ms after the first CDN read, <= 17 ms when resident.
- **Control:** `FRAME_TAIL_DOWNLOAD=0` must show `/grid` asks.
- **Live:** one live read only, after the flip (the existing commitment pattern).

### T4 (L4): lanes, epochs, no wedge

- **Setup:** the mock holds a scrub `/grid` for 10 s. Then jump h29 -> h250 -> h336, toggle the band once on the way, and
  pan once.
- **Record:**
  - when each target's request is issued (frames after the input);
  - every commit with its epoch;
  - every `[Abort-Gate]` line;
  - detached requests in flight;
  - the drawn hour at the end.
- **PASS:**
  - the h336 request is issued <= 1 frame after the jump;
  - 0 commits from a stale epoch;
  - 0 "Preserving high-priority" lines for a render-control action;
  - <= 1 detached `/grid`;
  - drawn hour 336 within the mock latency + 100 ms;
  - the existing dedupe, pan-replay and detach tests stay green.
- **Control:** the gate's kill arm reproduces the wedge.

### T5 (L5): band-ON scrub from the CDN, numbers unchanged

1. **Publish** rating frames for the 19 pilot boxes and the crop lattice from a REAL stored run, all three models.
2. **Parity, offline:** compare node by node with `/grid surf=1` from the offline resolver at every published hour.
   - PASS: 0 bad nodes (score exact; the mask exactly equal).
   - Control: one perturbed transform input must fail parity.
3. **Client:** band ON, 50 steps at z5.2 and z8, three models.
   - PASS: 0 `surf=1` asks for listed hours; step p95 <= 100 ms (<= 17 ms when resident).
4. **Once on the real resolver path** (the LESSON from the regional flip): one live parity read of 3 boxes after the
   publish, with health probed before and after.

### Further tests for the data levers (L6, L7)

**T6 (L6): real hours in, nothing else moved.** Run in CI (Actions) against public NOAA/ECMWF data, never the box.

- **GFS:** ingest a cached run hourly f000-f120.
  - PASS: 121 frames at <= 120 h, each tagged as model output and mapped to its own `fNNN`; f003/f006... byte-identical to
    the 3-hourly baseline; ingest wall time <= 1.8x.
- **EURO:** fixture `.index` set for 00Z.
  - PASS: steps 246-360 h fetched, 6 h apart, tagged model output.
  - PASS: a 06Z run asks `stream=wave` and gets steps <= 144 h.
- **Report (not a gate):** the old estimated tail's MAE against the real 246-336 h steps. That is the SCOREBOARD row the
  owner's flip needs.

**T7a (L7, 3 h hold-out):** real hourly GFS, 3 regions x f000-f120, decimated to 3 h and scored on the held-out hours.

- PASS: Hs MAE <= 0.85 x linear and <= 0.35 x hold; storm-peak retention >= 0.94.
- PASS: no direction node > 90 deg off, and p99 angular error <= 30 deg on mean-direction fields.
- PASS: period equals the nearest step's.

**T7b (L7, 6 h hold-out):** real 3-hourly GFS f123-f384, decimated to 6 h.

- PASS: Hs MAE <= 0.5 x hold, and peak retention >= 0.75.
- If either fails, 6 h gaps keep the nearest step, with its label.

**T7c (L7, controls):**

- A constant field and a linear ramp are reproduced exactly.
- 350 deg and 10 deg blend to 0 deg, not 180.
- Endpoints of a different `run_time` or model are refused.
- Two identical frames return the frame itself.
- **Label harness (Jest/RTL):** 336 hourly ticks x 3 models x 3 themes x the three MapWeatherControls layouts.
  - Each state's chip and aria text are right.
  - Ticks render only at real steps.
  - No state is conveyed by colour alone.

## 6. Findings by research question

### 6.1 Model switch without a blank frame (Q1) and label rules

1. **earth.nullschool keeps the old pixels and withdraws the claim.** On a product change, `showGridDetails(null)` empties
   the layer and centre labels and shows "Downloading..." at once. The animation stops, but the overlay canvas is not
   cleared. `drawOverlay` clears and redraws in one synchronous call, so no frame is blank
   ([earth.js](https://github.com/cambecc/earth/blob/master/public/libs/earth/1.0.0/earth.js), [cited]).
2. **deck.gl TileLayer keeps cached content until new content loads.** `updateState` calls `tileset.reloadAll()` under the
   comment "use cached layers until new content is loaded". `Tile2DHeader` sets `content` only when the load finishes and
   drops superseded loads
   ([tile-layer.ts](https://github.com/visgl/deck.gl/blob/master/modules/geo-layers/src/tile-layer/tile-layer.ts),
   [tile-2d-header.ts](https://github.com/visgl/deck.gl/blob/master/modules/geo-layers/src/tileset-2d/tile-2d-header.ts),
   [cited]).
   - `refinementStrategy: 'best-available'` fills gaps from cached zoom levels "to minimize visual flashing"
     ([docs](https://deck.gl/docs/api-reference/geo-layers/tile-layer), [cited]).
3. **MapLibre keeps old tiles drawable, but has no stale label.**
   - `setTiles`/`setUrl` reload marks tiles `'expired'` (renderable) and keeps the old texture until the new image
     arrives. MapLibre has no stale label of its own.
   - v6.8.0 fixed a `setTiles` stale-URL race (#8323)
     ([tile_manager.ts](https://github.com/maplibre/maplibre-gl-js/blob/main/src/tile/tile_manager.ts),
     [release](https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.8.0), [cited]).
4. **Ventusky's "Automatic" mode switches between ICON and GFS under one label**
   ([help](https://www.ventusky.com/help), [cited]). No source was found for Windy's switch behaviour (its client is
   closed).
5. **Labels.** Song & Szafir (TVCG 2019): highlighting and annotating imputed values raised perceived quality and accuracy.
   Downplaying them (alpha) or removing information degraded both
   ([paper](https://par.nsf.gov/servlets/purl/10111567), DOI 10.1109/TVCG.2018.2864914, [cited]).
   - For Raw Surf: mark a held or foreign frame with WORDS, never by dimming the field, which moves every pixel off the
     legend [inferred].
6. **Timing.**
   - React's stale pattern dims only after a delay (`opacity 0.2s 0.2s`)
     ([useDeferredValue](https://react.dev/reference/react/useDeferredValue), [cited]).
   - NN/g: no looped indicator under ~1 s ([progress indicators](https://www.nngroup.com/articles/progress-indicators/),
     [cited]).
   - Rule [inferred]: the model chip moves at 0 ms. The identity label always names the DRAWN model. Pending words appear
     at ~300 ms, a looped indicator past ~1 s. On failure: "Showing GFS · EURO unavailable".

### 6.2 Overlay toggles (Q2): visibility vs data

1. **Hidden layers stay resident and are skipped next frame.**
   - `setLayoutProperty('visibility')` recomputes the layer's evaluated visibility synchronously. `Map.setLayoutProperty`
     ends in `_update(true)` -> `triggerRepaint()`, one coalesced `requestAnimationFrame`.
   - `painter.renderLayer` returns early for a hidden layer.
   - A custom layer has no source, so nothing reloads, and its GL resources stay allocated
     ([style_layer.ts v5.24.0](https://raw.githubusercontent.com/maplibre/maplibre-gl-js/v5.24.0/src/style/style_layer.ts),
     [map.ts v5.24.0](https://raw.githubusercontent.com/maplibre/maplibre-gl-js/v5.24.0/src/ui/map.ts),
     [painter.ts](https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/render/painter.ts), [cited]).
2. **The `render` event proves a flip was drawn; `idle` waits for sources too** (map.ts `_render` order, [cited]).
3. **A uniform set in a custom layer's `render()` applies to that draw, so a uniform flip costs one frame** [inferred from
   the above].
4. **Principle: decide rendering apart from fetching; keep both variants resident.** Cesium's `preloadWhenHidden` loads
   tiles "as if the tileset is visible but does not render them"
   ([Cesium3DTileset](https://cesium.com/learn/cesiumjs/ref-doc/Cesium3DTileset.html), [cited]). Raw Surf's band breaks
   this rule because scores overwrite heights (S1) [measured].

### 6.3 Request scheduling (Q2)

1. **Raw Surf's gate keys on the trigger, not the target.**
   - The gate behaves like RxJS `exhaustMap` ("ignores every new projected Observable if the previous ... has not yet
     completed"), keyed on the trigger.
   - Interactive state wants `switchMap`: only the most recent is wanted
     ([switchMap.ts](https://raw.githubusercontent.com/ReactiveX/rxjs/7.x/src/internal/operators/switchMap.ts), [cited]).
2. **Key requests on the target.** TanStack Query gives each query an `AbortSignal` aborted when it "becomes out-of-date or
   inactive". An unconsumed signal still lets the result land in the cache
   ([cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation), [cited]).
3. **Mature schedulers re-rank and cap.**
   - loaders.gl `RequestScheduler` re-evaluates `getPriority` when a slot opens, and a negative priority cancels
     ([docs](https://loaders.gl/docs/modules/loader-utils/api-reference/request-scheduler), [cited]).
   - deck.gl TileLayer `maxRequests` defaults to 6 ("for Chrome, the max is 6 per domain"; -1 on HTTP/2) [cited].
   - MapLibre caps image requests at 16, and at 8 per frame while moving
     ([config.ts](https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/util/config.ts), [cited]).
4. **Abort helpers.** `AbortSignal.any` and `AbortSignal.timeout` have been Baseline since 2024. `timeout` rejects with
   `TimeoutError` and counts active time only
   ([any](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static),
   [timeout](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static), [cited]).
5. **Detach `/grid`; don't abort it.** Starlette handlers keep running after a client disconnects unless they poll
   `request.is_disconnected()` ([docs](https://raw.githubusercontent.com/encode/starlette/master/docs/requests.md),
   [cited]). On the one-CPU box, detaching (self-caching) a superseded `/grid` therefore beats aborting it, and the number
   of detached requests must be capped [inferred]. #389's server-side cancel is the matching server half [cited-2].
6. **Scheduler support.** `scheduler.postTask` / `yield`: Chrome 94 / 129 and Firefox 142, not Safari.
   `requestIdleCallback`: not in shipping Safari, so phones need a `setTimeout`/`MessageChannel` idle shim
   ([BCD Scheduler](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Scheduler.json),
   [BCD Window](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Window.json), [cited]).

### 6.4 Far timeline jumps and caching (Q3)

1. **ForeCache** (Battle, Chang, Stonebraker, SIGMOD 2016): a cache hit took 19.5 ms against 984 ms for a miss. With k = 5
   prefetches the average was 185 ms (Momentum 349, Hotspot 360). Predicting "further than one move ahead did not actually
   improve accuracy"; every 1% of accuracy was worth ~10 ms
   ([paper](https://homes.cs.washington.edu/~leibatt/static/papers/forecache_cr_sigmod2016.pdf), [cited]).
2. **Video seeking has the same shape** [cited]:
   - hls.js buffers asymmetrically: 30 s ahead, all of it behind
     ([API.md](https://raw.githubusercontent.com/video-dev/hls.js/master/docs/API.md)).
   - HLS I-frame playlists exist "for trick play ... and scrubbing" ([RFC 8216](https://datatracker.ietf.org/doc/html/rfc8216)
     §4.3.3.6).
   - An MSE seek to an unbuffered position waits for an append ([Media Source Extensions](https://www.w3.org/TR/media-source-2/)).
   - Forecast analogue [inferred]: landmark hours that are always resident (L8).
3. **Cesium** culls requests while the camera moves, preloads the destination of a flight, and loads a low-resolution layer
   first (`progressiveResolutionHeightFraction` 0.3) (Cesium3DTileset, [cited]).
4. **Caching.**
   - Use the HTTP cache with versioned URLs and `max-age=31536000, immutable`. Chrome ignores `immutable`; Firefox and
     Safari honour it ([Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control),
     [BCD](https://raw.githubusercontent.com/mdn/browser-compat-data/main/http/headers/Cache-Control.json), [cited]).
   - Safari deletes ALL script-writable storage (IndexedDB, Cache API, service workers) after 7 days of use without
     interaction ([WebKit](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/), [cited]).
   - So decoded frames do not belong in IndexedDB. The HTTP cache is not script-writable and is untouched [inferred].
     This agrees with the program's earlier rejection of a Cache API store [cited-2].
5. **Memory.**
   - `navigator.deviceMemory` is Chromium-only, rounded and clamped [cited].
   - iOS publishes no WebGL ceiling. WebKit bug 300782 (iOS 18, open): texture-heavy pages are killed and reload in a loop,
     with NO `webglcontextlost` first ([bug](https://bugs.webkit.org/show_bug.cgi?id=300782), [cited]).
   - An iPhone 13 mini crashed after page memory rose from 180 to 338 MB
     ([bug 290623](https://bugs.webkit.org/show_bug.cgi?id=290623), [cited]).
   - So budget iOS conservatively (about 64-96 MB of our textures) and leave a `sessionStorage` breadcrumb to detect a
     crash-reload [inferred].

### 6.5 Temporal interpolation of wave fields (Q4) and perception of swaps (Q5)

**Already settled by the program (not redone):**

- On real hourly GFS-Wave, temporal Catmull-Rom beats linear by 15-30% MAE, and linear beats hold by ~3x.
- Optical-flow and group-speed advection LOSE to linear.
- Direction must blend on the unit circle (a naive degree average put 230 nodes > 90 deg off), and period must not blend
  (max error 9.1 s at a dominant-system switch).
- Storm peaks hold >= 0.944 at 3 h gaps vs 0.75-0.78 at 6 h.
- Source: memory time-interpolation-holdout-2026-10-20 and sota-research-2026-10-20 [cited-2].

**Which hours are real model output.** All three sources are instantaneous at their valid time, not period averages
[cited: below].

| Model / product | Real every hour until | Then | Upstream horizon | Raw Surf ingests | Source |
|---|---|---|---|---|---|
| GFS-Wave (WAVEWATCH III, GFSv16) | **f120** | 3 h to f384 | 384 h | **every 3rd hour only** (`noaa_gfs_wave_fetcher.py:382`) [measured] | [NCEP model description](https://polar.ncep.noaa.gov/waves/Model_Description.pdf); [AWS listing](https://noaa-gfs-bdp-pds.s3.amazonaws.com/?list-type=2&prefix=gfs.20261025/00/wave/gridded/gfswave.t00z.global.0p25.f1) (this session read it: f100-f120 hourly, then f123) [cited] |
| ECMWF IFS waves, open data (`stream=wave`) | no hourly | 3 h to 144 h, then **6 h to 360 h** (00/12Z); 06/18Z to 144 h | **360 h** | **stops at 240 h** (`ecmwf_opendata_fetcher.py:172,367`) [measured] | [open data](https://www.ecmwf.int/en/forecasts/datasets/open-data); [listing 2026-10-25 00Z](https://data.ecmwf.int/forecasts/20261025/00z/ifs/0p25/wave/) (this session read it: 85 steps, 246-360 h every 6 h present) [cited] |
| CMEMS GLO WAV 001_027 (MFWAM) | no hourly | 3 h ("3-hourly instantaneous") | 240 h | EURO family | [PUM](https://documentation.marine.copernicus.eu/PUM/CMEMS-GLO-PUM-001-027.pdf) [cited-2: research agent] |
| DWD GWAM (ICON-forced WAM) | no hourly | 3 h to 174 h | 174 h | 0-174 h every 3 h, then the estimated tail (`dwd_gwam_fetcher.py:220-226`) | [DWD open data](https://opendata.dwd.de/weather/maritime/wave_models/gwam/grib/00/swh/) [cited-2: research agent] |

**What this changes** [measured + cited]:

1. **Two of every three real GFS hours in days 1-5 are discarded at ingest.** "Nearest stored forecast" on GFS before
   120 h points at data that exists upstream. STATE recorded the gap in 2026-09 ("off-frame hours snap by 1 h"). The wind
   lane has an hourly GFS path built (`FRAME_WIND_GFS_HOURLY`, default `'0'`, `forecast-ingest-pilots.yml:130`); the marine
   lane has none.
2. **EURO's 246-336 h "estimated" tail could be real 6-hourly model output.** ECMWF publishes those steps; our fetcher stops
   at 240 h. This touches the LOCKED 14-day extension contract (CLAUDE.md, "never rebuild the ICON/EURO extension blends"),
   so it is the owner's decision, dark, with a SCOREBOARD row.
3. **Check (ingest owner):** since IFS Cy50r1, ECMWF's 06/18Z waves sit under `stream=wave`, replacing `scwv`. The fetcher's
   comment says the client "maps 06/18 cycles to scwv itself" (`ecmwf_opendata_fetcher.py:61`). Whether that mapping still
   resolves is UNVERIFIED [inferred].

**What the wave models themselves do in time** [cited-2: research agent, from the primary documents]:

- **WAVEWATCH III** (v6.07 manual) interpolates its input wind linearly in speed and direction ("turning the wind ... over
  the smallest angle"), and its boundary spectra linearly in time.
- **ecWAM** nesting matches a linear interpolation of the mean parameters.
- So blending the wave state inside a 3 h gap makes the same class of assumption the operational models make [inferred].
- **ECMWF says** "many users interpolate the 3- and 6-hourly data they receive from ECMWF to provide hourly weather
  forecasts" ([ECMWF](https://www.ecmwf.int/node/25307)).
- **No wave service was found that documents or labels interpolated wave frames.** Windy interpolates satellite frames only,
  behind a "Smooth satellite animation" toggle.

**Variable rules** [cited-2 + inferred]:

- **GFS direction is a PEAK direction** (DIRPW; the WW3 GRIB2 table maps peak direction to 10,0,10), so it can jump between
  swell systems like Tp. ECMWF `mwd`, GWAM `mwd` and CMEMS `VMDR` are energy-weighted vector means and change smoothly.
  - So interpolate direction as Hs²-weighted unit vectors.
  - Fall back to the nearest step when the two endpoints differ by more than ~60 deg, or the field is a peak direction.
- **Peak period is discrete by construction** (ECMWF IFS CY50r1 Part VII §10.3.3; WW3's parabolic peak fit). Take it from
  the nearest real step, as the program measured (max error 9.1 s).
- **Coarser output misses storm peaks.** Dentale et al., ICCE 2016: "the longer the sampling interval, the lower is the
  number of events which are above a given threshold". This agrees with the program's 0.944 (3 h) vs 0.75-0.78 (6 h).

**The labelling rule this supports** [inferred from Song & Szafir and the above]:

- Interpolate only between two real steps of the SAME model and run. Never across runs or models, never into an estimated
  tail.
- Gaps <= 3 h: height and direction. 6 h gaps only if the 6 h hold-out passes (T7b). Never over 6 h.
- Three states, in words, never by colour or dimming alone:
  - a model hour (no chip);
  - "Interpolated · GFS 06Z run, between 12:00 and 15:00";
  - "Estimate · beyond EURO's model range".
- Real model hours shown as ticks on the scrubber.

**Perception of swaps** [cited]:

- **Heer & Robertson (InfoVis 2007):** "intermediate interpolation states remain valid data graphics"
  ([paper](https://idl.cs.washington.edu/files/2007-AnimatedTransitions-InfoVis.pdf)).
- **Battersby & Goldsberry (Cartographic Perspectives 65, 2010):** blended class colours "are undefined according to the
  legend". On unclassed maps, smooth frames "remain loyal to the continuous legend"
  ([article](https://cartographicperspectives.org/index.php/journal/article/view/cp65-battersby-goldsberry)).
- **Robertson et al. 2008:** transition animation keeps users in context; trend animation was error-prone for analysis
  ([paper](https://faculty.cc.gatech.edu/~stasko/papers/infovis08-anim.pdf)).
- **The rule** [inferred]: blend VALUES, then apply the palette (WeatherLayers GL does exactly this: `mix(pixel, pixel2,
  imageWeight)` before `applyPalette`, [pixel.glsl](https://github.com/weatherlayers/weatherlayers-gl/blob/main/src/deck/_utils/pixel.glsl),
  [cited]).
  - Never cross-fade RGB: off-legend colours on a non-linear ramp, and a double image of moving crests.
  - Never fade to or from transparent: that is a blank.
  - A hard cut with no blank is an acceptable fallback (Rensink).

**Particles** [cited]:

- **mapbox/webgl-wind:** `setWind` replaces only the wind texture; particle state lives on
  ([index.js](https://github.com/mapbox/webgl-wind/blob/master/src/index.js)).
- **WeatherLayers GL:** a change to `image`/`image2`/`imageWeight` advects the existing particles; only `numParticles`,
  `maxAge`, `width` or `visible` rebuild them
  ([particle-line-layer.ts](https://github.com/weatherlayers/weatherlayers-gl/blob/main/src/deck/layers/particle-layer/particle-line-layer.ts)).
- **earth.nullschool** reseeds with random ages so the new population does not pulse (earth.js).
- No study was found showing that a global respawn reads as a "restart". That rests on motion-onset capture (Abrams &
  Christ 2003) [cited-2].

### 6.6 GPU techniques (Q6)

1. **Limits** (OpenGL ES 3.0 floor
   [glGet](https://registry.khronos.org/OpenGL-Refpages/es3.0/html/glGet.xhtml), [cited]; field reports, undated,
   [web3dsurvey](https://web3dsurvey.com/webgl2/parameters/MAX_ARRAY_TEXTURE_LAYERS), [cited]):
   - the floor is `MAX_ARRAY_TEXTURE_LAYERS >= 256`;
   - in the field, >= 2048 on desktop and iOS, and >= 256 on all Android reports;
   - so one array per (model, variable) holding 113 layers fits everywhere, and three models in one array (339) does not.
2. **Allocation and swap** [cited]:
   - allocate with `texStorage` once, then `texSubImage`
     ([MDN best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices));
   - sync objects never signal in the frame they are issued
     ([WebGL 2.0 spec](https://registry.khronos.org/webgl/specs/latest/2.0/)), so a fence-gated A/B swap costs at least one
     frame, which is within the tap contract [inferred].
3. **Precision.**
   - R16F spacing is 2^-7 m in [8, 16) and 2^-6 m in [16, 32), so the max error is 3.9 mm (7.8 mm above 16 m), against
     31 mm for today's 16 m byte [cited: half-precision spacing; inferred arithmetic].
   - EXT_texture_norm16 reaches only 48.7% of Android reports, so don't depend on it
     ([web3dsurvey](https://web3dsurvey.com/webgl2/extensions/EXT_texture_norm16), [cited]).
   - An angle byte filters wrongly across 359/0. A unit vector (RG8_SNORM, filterable) errs <= 0.32 deg [inferred].
   - The copy path needs a colour-renderable layer. 16F needs EXT_color_buffer_float, on 99.96% of reports
     ([web3dsurvey](https://web3dsurvey.com/webgl2/extensions/EXT_color_buffer_float), [cited]).
4. **Uploads.**
   - Chrome copies every texture upload into shared memory for the GPU process. The transfer buffer starts at 64 KiB
     ([shared_memory_limits.h](https://chromium.googlesource.com/chromium/src/+/main/gpu/command_buffer/client/shared_memory_limits.h),
     [cited]). A 60 KB world layer fits it; a 4 MB global layer does not [inferred].
   - PBOs do not remove that copy [inferred]. Spreading uploads "only spreads the call" (Khronos list, [cited]).
   - Unity defaults to a 2 ms per-frame upload slice and warns that more hitches
     ([Unity](https://unity.com/blog/engine-platform/understanding-the-async-upload-pipeline), [cited]).
   - No per-MB mobile benchmark was found.
5. **Shader compile.**
   - KHR_parallel_shader_compile coverage is Windows 91%, macOS 93%, iOS 98.6%, **Android 0.3%**, Firefox 0.7%
     ([web3dsurvey](https://web3dsurvey.com/webgl2/extensions/KHR_parallel_shader_compile), [cited]). So every first
     compile blocks on Android: warm up in idle.
   - ANGLE D3D11 recompiles per vertex-attribute setup, so link with the real VAO bound (Khronos list, [cited]).
   - MapLibre compiles its programs lazily at draw time ([painter.ts](https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/render/painter.ts),
     [cited]).
6. **Memory per layer** [inferred arithmetic; driver padding not measured]:

| Frame | Format | Per layer | 113 layers |
|---|---|---|---|
| World 181x83 | R16F | 30.0 KB | 3.4 MB |
| World 181x83 | RG16F / RGBA8 | 60.1 KB | 6.8 MB |
| Crop 160x120 | R16F | 38.4 KB | 4.3 MB |
| Global 1440x721 | R16F | 2.08 MB | 235 MB (a sliding window on phones) |

## 7. Not found, and open questions for the build sessions

- **No primary source** was found for:
  - Windy's or Ventusky's model-switch behaviour;
  - Metal pipeline-state stalls on first draw;
  - Safari's WebGL upload path;
  - per-MB mobile upload throughput;
  - whether Chrome persists a page's WebGL programs across sessions.
- **Rensink:** the 1997 paper's PDF was an image scan this session could not read. Its 80 ms / 240 ms timing is from the
  authors' 1996 abstract.
- **Open for RZ / SF (L1 stage B):** does the `surf=1` `/grid` JSON carry the honest height per node beside the score? If
  not, the rating frames (L5) should carry both, so one texture serves band ON and OFF.
- **Open for IS (L12):** what do the marine crest particles do on a model switch today? The wind layer clears its trails
  by design (`WebGLWindLayer.js`). Read the marine path before building L12.
- **Open for the owner (L3c, L6, L7):**
  - ICON past 168 h: the stored estimated tail or the client blend (one product, not two);
  - real GFS hours to f120 and real EURO steps to 360 h (served numbers; L6b touches the LOCKED extension contract);
  - labelled interpolation for the remaining off-lattice hours.
- **Not found:** a cost and access answer for ECMWF's licensed hourly waves (Set II, hourly to T+90). Not needed if L6 and
  L7 hold.
- **Unreadable PDFs:** the NWS NBM v4 and NDFD notices (hourly grids interpolated from coarser steps) were read only through
  search excerpts [cited-2].

## 8. Method and tools

- **Code:** read at `dev` `4b8563851` (Grep and Read).
- **Research:** four parallel research agents (WebSearch/WebFetch; MapLibre via the Context7 connector `mcp__23f05bb0`,
  since the `context7` plugin server failed to connect). Their full reports were kept in this session's scratchpad. This
  session re-read the WCAG 2.3.1 Understanding page, Rensink's abstract, the GFS-Wave AWS listing, the ECMWF open-data wave
  listing, and every code line cited above.
- **Skills:** `hyperframes-animation` (video composition: nothing on data-field swaps) and `mapbox-data-visualization-
  patterns` (its animation reference is `setData` per step: nothing to adopt).
- **Box load:** no request to the Render box, and no live-site load.
