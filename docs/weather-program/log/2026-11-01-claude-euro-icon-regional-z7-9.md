# 2026-11-01 (claude, item 11): EURO and ICON at zoom 7-9, and the #414 re-measure

Branch `claude/stoic-solomon-366747` from dev 340e70c07. Started by the lead (local_d6b521eb) for item 11 of the owner's
"instant everywhere" program. Offline only (the harness in `frontend/scripts/offline-backend`); the live backend was never
asked. Not pushed: pushes are held for Codex's PR664 window.

## Ask

- Make EURO and ICON instant at zoom 7-9. Measured offline 10-28: an ICON model switch 894 ms; z9 open ocean, hours
  141-155, 3.8-8.3 s for EURO and GFS alike, waiting on the dynamic viewport `/grid`; Florida z9 inside a pilot tile draws
  from the store in 1-20 ms.
- Trace the server path first; then choose between cropping frames the client already holds (ships ON with a kill switch
  if no served number changes) and publishing new EURO/ICON regional frame sets (built hidden).
- Re-measure #414 (sliced land-mask repaints, off by default) on current dev and say keep or close.

## The server path at z7-9, traced (grid_resolver.resolve_grid)

1. `MARINE_REGIONAL_TILE_FIRST` (on live since D-051, GFS only): a box a GFS pilot tile fully covers is served from it.
2. Steps 1-2, the dynamic cache keyed on the snapped box (1 deg GFS, 2 deg EURO/ICON).
3. Step 3, a covering regional manifest item. EURO/ICON have 0.25-deg pilot tiles on 14 boxes
   (`get_all_pilot_regions`: REGIONAL_CONFIGS + WORLDWIDE_COASTAL_REGIONS): EURO waves (ECMWF wave stream), ICON
   waves/swell_1/wind_waves (DWD GWAM). Their native horizon is `*_MARINE_PILOT_FORECAST_DAYS` (default 2); the flagship
   boxes also carry the core lane's estimated tails (`ingest_euro/icon_marine_extended_estimates`).
4. Step 3.6, the mid tier: the 2-deg `global_mid` clipped to the viewport with a 2-deg pad, served at once, plus a
   background sharpen to a 0.25-deg dynamic product for spans up to 8 deg (`MARINE_MID_REVAL_MAX_SPAN`).
5. Step 4, the upstream dynamic fetch (Open-Meteo for GFS/ICON, Copernicus for EURO), normalised per hour.

So inside a pilot box EURO/ICON have the same two-source problem GFS had before D-051: the dynamic cache answers when it is
warm, the stored tile when it is cold. Outside every pilot box (open ocean) nothing finer than the 2-deg mid exists until the
dynamic lane builds the hour.

## Choice

- **Client crops: rejected for z7-9.** The only frames the client holds are the 2-deg world frames. At z9 the view is
  about 2 deg wide, so a crop draws 2-3 flat cells; the client today deliberately holds the previous sharp hour instead
  (the SWR ladder re-asks until the 0.25-deg product lands). Drawing the crop would be a visual and served change, not a
  latency one.
- **EURO/ICON regional frame sets: built**, hidden, with the server half dark, mirroring GFS (D-051).
- **Open ocean z9 is not fixed by either option** (see "Open ocean" below).

## What changed (all dark or hidden; nothing a user sees moves until both halves flip together)

- **Server, served number, DARK:** `MARINE_REGIONAL_TILE_FIRST_EURO_ICON` (default `0`, registered in `_RATING_FLAGS`).
  `regional_tile_first.py` applies the GFS rule to EURO waves and ICON waves/swell_1/wind_waves (`OTHER_MODEL_LAYERS`),
  with one difference: EURO/ICON skip the "snapped box inside the data" test. Their 2-deg snap crosses an odd-degree tile
  edge on most coastal views (the owner's Florida z9 box -81.65..-79.58 snaps east to -78, past the tile's -79), and a box
  tile-first serves never reads the dynamic cache, so the shared-key risk that test guards against cannot reach it. The
  margin-0 cover of the served window still decides. The ICON live series lane is skipped only inside the 14 EURO/ICON
  boxes (never the GFS-only extras). The GFS flag alone never turns EURO/ICON on, and the new flag never touches GFS. The
  dark diff (`maybe_log_diff`) now also samples EURO/ICON while their flag is off (same 5% sample, same 30/h cap).
- **Publisher, BUILT HIDDEN:** `FRAME_REGIONAL_BUNDLES_EURO_ICON` (repo variable, default `0`, passed by
  `forecast-ingest-pilots.yml`). `frame_set_bundle.OTHER_MODEL_SETS` = 56 sets (EURO waves + ICON x3 on 14 boxes), ordered
  after every GFS set so the budget stagger drops them first. Same codec, parity and coverage gate as GFS.
- **Client, DARK:** `staticRegional.regionalEuroIconOn()` (enable `window.__RAW_ENABLE_REGIONAL_EURO_ICON__`, kill
  `window.__RAW_DISABLE_REGIONAL_EURO_ICON__`, `REGIONAL_EURO_ICON_DEFAULT_ON = false`). `REGIONAL_MODELS` stays `['GFS']`
  (the D3 prewarm reads it as "a GFS selection"; the prewarm and `REGIONAL_BUNDLES_DEFAULT_ON` are untouched). EURO/ICON use
  only their 14 boxes for the pre-manifest pick. The GPU frame store's regional show takes EURO/ICON waves behind the same
  gate, and its ICON-past-168 blend guard now runs before the regional show.
- **Harness:** `scn_regional_client_parity.mjs` takes `MODEL`.

## Parity (offline, `scn_regional_client_parity.mjs`, 200 random z7-9 boxes + 4 edge boxes per tile, both server flags on)

| set | claimed box x seam | /grid nodes bad / meta | series nodes bad / meta | refused but server full regional | claimed but server not |
|---|---|---|---|---|---|
| EURO waves | 35 | 0 of 16,575 / 0 | 0 of 6,388 / 0 | 0 | 0 |
| ICON waves | 35 | 0 of 16,575 / 0 | 0 of 6,388 / 0 | 0 | 0 |
| ICON swell_1 | 35 | 0 of 16,575 / 0 | 0 of 6,388 / 0 | 0 | 0 |
| ICON wind_waves | 35 | 0 of 16,575 / 0 | 0 of 6,388 / 0 | 0 | 0 |

The compared hours include EURO's estimated regional frames (`*_estimated.json` products in the edge rows). Publisher:
115 frames per set, parity_bad 0, 19-37 KB per synthetic bundle, 1.3-4.6 s per set offline.

## Timings, before / after (offline, dev 340e70c07 + this branch, build `main.6ea821a1`)

Setup: `serve_synthetic.py --models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves --land-mask 1 --regions flagship
--dynamic 1 --euro-regional-estimated-after 42`; CDN = the publisher's copy with `FRAME_REGIONAL_BUNDLES_EURO_ICON=1`, served
at 340 ms per object (the live Cloudflare hit). **Before** = backend with `MARINE_REGIONAL_TILE_FIRST=1` only (live) and the
client gate off; **after** = both server flags on and `FLAGS=__RAW_ENABLE_REGIONAL_EURO_ICON__`. Instrument
`scn_model_toggle.js` (ms from the chip click to the exact product `/grid` serves for that model, hour and view, on the GPU;
then one wheel step on the new model). Both backends shared one store directory, so the "before" arm also met warm dynamic
products, as production does. Absolute numbers are this PC's (loaded; another session's `scn_cold_veil.js` ran from 20:30
EST, during the z8 "after" round 2): compare arms, not against live.

**Model switch, z8 Florida (CENTER -81.0,28.0, 1280 x 800), first visit to ICON/EURO at h0 and h24, 2 rounds:**

| arm | ms (8 clicks) | p50 | max |
|---|---|---|---|
| before | 3,775 5,491 5,496 5,878 5,924 7,224 8,524 8,559 | ~5,900 | 8,559 |
| after, round 1 | 1,028 1,185 1,217 1,287 | ~1,200 | 1,287 |
| after, round 2 (machine loaded) | 3,776 3,823 4,139, one miss | ~3,800 | miss |

Switches back to GFS took 0-23 ms from the GPU store in both arms. At h168 EURO and ICON missed in BOTH arms (see the
finding below).

**Model switch, z9 owner box (CENTER -80.6,28.1):** first visits before 1,007 / 1,484 / 2,355 / 4,641 ms (p50 ~1,920),
after 1,121 / 1,124 / 1,223 / 1,360 ms (p50 ~1,170); repeat visits 418-433 ms in both arms; the wheel step on the new
model right after the switch 1-15 ms in both arms.

**z9 open ocean (CENTER -75,30, hours 140-155, `scn_instant_contract.js`, 10 s window), unchanged by this branch (no tile
there):** GFS p50 10 / p95 7,750 ms with 5 of 16 steps never exact; EURO p50 10 / p95 7,363 with 11 of 16 never exact;
ICON p50 2,663 / p95 10,434 with 9 of 16 never exact. (p50/p95 over the steps that did reach the exact frame.)

## What the numbers say

- Inside a pilot box the EURO/ICON switch no longer waits on the box: ~5.9 s -> ~1.2 s here (live it was 894 ms, most of
  it the server). It is still not instant: the click starts the other model's index + bundle download (two CDN objects,
  ~0.7 s at 340 ms each) and the 350 ms coalescing window. Making it instant needs the other models' bundles warm before
  the click (the regional prewarm, which D3 owns: today GFS only) and the GPU store's model-toggle show to accept a
  regional window. Proposed to the lead, not built here.
- `scn_instant_contract.js` cannot judge in-tile steps: a series or bundle frame has no product id, so it reads "missed".
  Use `scn_model_toggle.js` / `scn_zoom_scrub.js` there.

## Finding (pre-existing, both arms): EURO/ICON at h168, z8 inside Florida, draw the 2-deg WORLD frame and stay there

- Forensic ring (`RING_ALL=1`, `REGTRACE=1`): the click's only commit is `icon_marine_waves_global_mid_20261109T030000Z_estimated`
  (181 x 83, spanLng 360, lane manual) at +1,180 ms; the regional bundle was read (5 bundles, 370 slices, 0 misses) but no
  regional frame was committed in 12 s. EURO the same (`euro_marine_waves_global_mid_20261109T000000Z`).
- `/grid` for the same box and hour serves the REGIONAL tile in both backends (`*_florida_east_coast_20261109T000000Z_estimated`,
  21 x 17). So the client asked a WORLD box at z8 for that hour; the label is right, the field is 2 deg instead of 0.25.
- Not caused by this branch (the "before" arm misses identically). Not chased here; for the lead to route (engine / fetch
  box selection).

## Open ocean (z9 outside every pilot box)

Neither option makes it instant with correct data. There the settled answer is the 0.25-deg dynamic product the server
builds per hour from an upstream fetch; the only frame the client holds is the 2-deg world frame (2-3 cells across a z9
view). Options, for the owner:
1. **More pilot coverage where people surf** (cheapest): the F-08 census put 41% of spots outside every 0.25-deg box; each
   GFS box is sliced from the whole-globe download already made, EURO/ICON boxes from their whole-globe passes.
2. **EURO/ICON pilot horizon** (`EURO_MARINE_PILOT_FORECAST_DAYS` / `ICON_MARINE_PILOT_FORECAST_DAYS`, default 2): today
   their bundles cover hours 0-48 outside the flagship boxes; past that /grid serves z7-9 as before.
3. **World 0.25-deg tiles** (the reference-site approach): estimated from the live Florida GFS bundle (324 KB per 113-frame
   run for ~42 sq deg), the world ocean is ~0.3 GB per run per layer per model, ~4 GB per cycle for 3 models x 4 layers.
   Not proportionate for open-ocean z9, which is rarely a surf view.

## Part B: #414 (sliced map-event land-mask paints) re-measured on current dev

- **Branch:** `origin/claude/landmask-offframe` merged with dev 340e70c07 locally as `claude/landmask-offframe-remeasure`
  (c8b49bba7, a subagent's worktree; not pushed). One dev change landed inside code the branch moved (#488's
  `stampMaskPatch`), carried into `marineMaskRefresh.js`; `maskPatchKeep.test.js` and `mask_replay.js` (waveLakes) adapted;
  the branch's ledger line (old seq 1543) dropped from the merge (it would fork the chain). With the flag off the diff to
  dev is the move plus the gated additions. Jest map + tests 443 suites / 6,217 tests green; eslint gate and LOC ratchet
  pass; build `main.5575ecfa`.
- **Setup:** `serve_synthetic.py --thin-bounds 1 --dynamic 1 --models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves,wind
  --regions flagship` (+ `MARINE_REGIONAL_TILE_FIRST=1`, as live), one build, arms interleaved, ON = `LAB_KILLS=__RAW_SLICED_LAND_MASK__`.

| instrument | OFF | ON | 10-20 (OFF -> ON) |
|---|---|---|---|
| `scn_mask_calls` (3 runs/arm, step medians summed): mask CPU inside map-event tasks | 1,148 ms | 89 ms (-92%) | 1,032 -> 97 |
| same: long-task time | 3,256 ms | 2,074 ms (-36%) | 3,310 -> 1,694 (-49%) |
| same: worst long task | 767 ms | 625 ms | |
| same: mask request -> upload (sliced) | (today: in the event task) | median 267 ms, max 526 ms (21 jobs) | 186-642 ms |
| `lab.js pan_zoom_future` + `stall_profile.js`, **static frames ON** (production shape), 8 runs/arm: total stall time median | 3,182 ms | 3,083 ms (-3%; spreads 2,723-4,086 vs 1,930-4,273) | 4,255 -> 2,445 (-43%, static frames off) |
| same: worst stall, median of runs | 362 ms | 499 ms | 480 -> 331 |
| same: "land mask build" stage in stalls, median | 1,013 ms | 732 ms | 1,502 -> 423 |
| `mask_replay.js SLICED=1` vs dev's painter, 3 themes x 16 paints x 2 reps | | 48/48 byte-identical, same verdicts and receipts | 56/56 |

**Verdict: close #414.** The map-event paints still leave the event tasks (-92%) and stay byte-identical, but on today's dev
that no longer shows up as less stall time where users feel it: with static frames on, total stall time moved -3% (inside
the run-to-run spread) and the worst stall got longer, while the mask still lands 0.27 s (up to 0.53 s) late. Since 10-20
dev made the mask cheaper on its own (#408, #482's caches, the mask stash), and the stalls left are MapLibre, shader compile,
grid -> texture and the data-commit rasterize (`renderMaskToCanvas`, ~480-530 ms in stalls in both arms), which #414 does not
touch. A 3,300-line move of the painter for a change inside the noise is not worth its review and merge risk. If a future
profile shows map-event paints back on top, the merged branch is kept locally (c8b49bba7) and its instruments run as above.
The next mask lever, if any, is the commit-path rasterize.
- **#414 closed by the lead on this verdict (2026-11-01 ~02:27Z).** Key re-measure numbers at dev 340e70c07: map-event mask CPU
  1,148 -> 89 ms, long tasks 3,256 -> 2,074 ms, but total stall time with static frames on 3,182 -> 3,083 ms (-3%, n=8, inside
  the spread), worst stall 362 -> 499 ms, mask 0.27 s late (max 0.53 s), replay 48/48 byte-identical.

## Update 22:10 EST: ON by default (D-059)
- Owner (via the lead): measured features ship ON with a kill switch. All three halves now default ON: Render
  `MARINE_REGIONAL_TILE_FIRST_EURO_ICON` (kill `0`), repo variable / code `FRAME_REGIONAL_BUNDLES_EURO_ICON` (kill `0`), client
  `REGIONAL_EURO_ICON_DEFAULT_ON = true` (kill `window.__RAW_DISABLE_REGIONAL_EURO_ICON__`). Registry default `1`.
- Tests moved with it: the off-by-default pins became on-by-default plus kill pins; `test_frame_set_bundle.py`'s GFS-sets pin and
  `test_grid_series_provider_ownership.py` (it exercises ICON's live series lane with a Florida box, which tile-first now skips by
  design) set the EURO/ICON kill so they keep testing what they test. Resolver-path pytest files: 1,085 passed (one local sqlite
  failure, `test_weather_sim_mcp`, fails on plain dev too). Ledger fragment lines 4 (decision) and 5 (commitment: live read +
  SCOREBOARD row after deploy).
