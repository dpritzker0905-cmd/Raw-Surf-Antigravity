# 2026-10-26 (claude, GPU-frames session): EURO/ICON at mid zoom scrub from the store, and the instant-contract harness

Branch `claude/midzoom-plain-crops` from dev 714389a8d. Client only (`marineFrameStoreRuntime.js`, `staticFrames.js`,
`staticWorldFillGuard.js`) plus an offline scenario. No served number changes. Kill: `window.__RAW_DISABLE_PLAIN_SET_CROPS__ = true`.

## Ask

- **The owner**, live 2026-10-26 ~12:40Z (bundle 4e004446): "instant scrubbing not working, showing nearest stored forecast beyond
  native range (using icon). ... Euro had delays scrubbing. GFS seemed to work the best. All marine layers need to be instant."
- **The lead (A):** "ICON and EURO at mid-zoom (z4.6-5.3) scrub from /grid_series pages, not the frame store. ... Make EURO/ICON
  mid-zoom crops come from the filled world sets exactly as GFS's do (M3/#459), with the same parity gates (the targeted modes are
  equal since D-052)."

## What the parity gate says: the PLAIN set, not the filled one

- **The server Gulf-fills only a WORLD-span grid.** `coarse_gulf_fill.fill_coarse_enclosed_sea_from_gfs_served` returns any product
  whose span is under 350 deg as stored, in every mode (`coarse_gulf_fill.py:186-193`). So a mid-zoom `/grid` clip of EURO/ICON is
  the plain stored global_mid product, windowed.
- **So the filled set is the wrong source for a crop.** A crop of it would paint the Gulf fill into a view that `/grid` serves
  unfilled. The right source is the plain set, exactly as for GFS.
- **Why EURO/ICON never reached the store at mid zoom** (offline probe, z4.6):
  - the store's set was the filled one, and filled sets refuse crops;
  - the plain set was refused outright (`getPinnedIndexSync`, the world fill);
  - nothing pinned the plain set, because the static seam refuses every EURO/ICON mid-zoom box that overlaps any regional tile
    (`staticFrameCrop.js:186-188`).
  - Result: every step was `/grid`, at 0.4-3.8 s offline.
- **Which boxes the resolver answers with the clip.** A subagent traced the resolver order with citations.
  - Above a 15-deg request, `select_best_candidate` keeps only GLOBAL candidates whenever one exists within +-3 h
    (`product_selection.py:133-161`). The tails bake estimated global tiers, so one normally does, and `/grid` serves the global_mid
    clip.
  - At 12-15 deg a covering regional tile can win, for example an estimated florida_east_coast tail.
  - So the store takes a plain EURO/ICON window only for a request wider than 15 deg. The server pads the clip by
    min(12, max(2, span/2)) each side, so that is a clip wider than 30 deg (`wideClip`).

## The change

- **`getPinnedIndexSync(key, { crop })`.** A guarded plain set is served to the store as a CROP source; a world read still refuses
  it. New `storeCropSetKeyFor`; the rule and the kill live in `staticWorldFillGuard.plainCropsOn`.
- **The runtime keeps two sets for EURO/ICON** (`keyFor`): the filled set for a world-sized resident, the plain set when the engine
  holds (or a commit is) a viewport clip.
  - A plain guarded set is a crop source only (`crop_only_set`, at the commit and at the show), never a world resident.
  - A narrow clip is never taken (`crop_only_narrow`, the parity gate above).
  - A narrow GFS window is never switched to EURO.
  - The store pins the plain set itself on the first clip commit, because nothing else reads it (`pinWarm`).
- **Warm frames at mid zoom** are the other models' crop sources, so a mid-zoom model click shows from the store.

## The harness: `frontend/scripts/offline-backend/scn_instant_contract.js`

- **What it does:** one fresh browser per model x layer x zoom x theme x view x arm. It runs steps, far jumps
  (h29 -> 250 -> 336 -> 126 as fast key runs), a held-key drag (12 presses 33 ms apart) and model switches mid-scrub.
- **What it records per action:**
  - press -> exact product (the one `/grid` serves for that hour, by data time), and the path that drew it;
  - blank frames: the layer on, no wave field in the engine;
  - mislabelled frames: the label hour more than 1.5 h from the frame's own data time, or another model's product. Silent when the
    status line does not say so.
  - per drag press, shown within 33 ms or skipped;
  - every engine clear, with its reason, the transition flags and a stack.
- **Two traps found while building it, now guarded in the script:**
  - `ab_lib` defaults to 127.0.0.1:3100, which another session's SPA held, so a whole first matrix measured someone else's build.
    `AB_BASE` is now required and the loaded bundle is recorded.
  - Hour 0 must be the app's own anchor (`getSeriesAnchorMs`: now rounded to the hour). A grid-derived anchor was an hour off.

## Verified (offline; dev 4b8563851 build vs this branch + PR B, same synthetic store, same box)

- **The store:** GFS/ICON/EURO, waves + swell_1 + wind_waves, land mask, flagship tiles, frames published with the targeted fill.
- **Timing:** idle two-rAF ~32 ms in every session quoted below. An idle screensaver had loaded the box earlier, and those runs
  are not used.

| waves, dark, desktop | dev step p50 | fix step p50 | dev blank | fix blank | dev drag shown | fix drag shown |
|---|---|---|---|---|---|---|
| z2 GFS / EURO / ICON | 122 / 29 / 16 ms | 10 / 10 / 7 ms | 0 / 0 / 0 | 0 / 0 / 0 | 5 / 4 / 5 of 12 | 12 / 12 / 12 |
| z4.6 GFS / EURO / ICON | 136 / 935 / 576 ms | 11 / 10 / 9 ms | 20 / 0 / 0 | 0 / 0 / 0 | 9 / 1 / 1 | 12 / 12 / 12 |
| z5.3 GFS / EURO / ICON | 7 / 710 / 706 ms | 15 / 14 / 10 ms | 30 / 0 / 0 | 0 / 0 / 0 | 12 / 1 / 1 | 12 / 12 / 12 |
| z8 GFS / EURO / ICON | (7 / 8 / 11 of 14 missed) | (9 / 10 / 11 of 14 missed) | 0 / 0 / 738 | 0 / 0 / 0 | 1 / 1 / 1 | 1 / 0 / 0 |

At z8 both builds miss most steps (each waits 3-5 s on the regional `/grid` tile), so a p50 there averages a different handful
of steps per build (dev's z8 GFS "10 ms" includes a world-sized frame left from the load). These changes do not touch z8 GFS
(`keyFor` is the old key for GFS, and the clamp guard is false at z8).

- **Silent mislabels:** 0 in every session of both builds.
- **Steps from the store** at z4.6-5.3: 4-5 of 14 on dev, 10 of 14 with the fix.
- **What is still slow with the fix:**
  - J:336 for every model (0.25-2.5 s, `/grid`): that hour lies past the synthetic store's tail. Live, D-053 bakes the ICON/EURO
    tails 12 h further, and static-frames is closing the rest.
  - GFS J:126 (0.16-0.19 s, `/grid` on dev too).
  - The first step after load: the series frame lands in 5-16 ms, but carries no provenance, so the probe cannot call it exact.
- **z8 is the regional-tile zoom.** EURO/ICON have no pilot tiles (the scope note), and both builds miss most steps there.
- **swell_1 / wind_waves at z4.6:** blank 94 / 159 frames (GFS sessions) on dev -> 0. Steps stay 0.2-0.8 s p50 (grid / series)
  in both builds, because the GPU store holds waves only. That is the next lever for "all marine layers".
- **Light / beach (EURO z4.6):** step p50 6 / 7 ms; drag 12 of 12 shown, 0 late (dev 1 of 12).
- **Kill arm** (`__RAW_DISABLE_PLAIN_SET_CROPS__` + PR B's `__RAW_DISABLE_COVERING_CLIP_HOLD__`, on the fix build): the dev
  behaviour returns: 30 blank frames at a GFS switch, and the EURO / ICON drags at 1 of 12.
- **Phone:** not measured. The scenario could not open the phone layout's controls (the "Waves" chip stayed hidden). Open item.
- **Unit:** `marineFrameStorePlainCrops.test.js` (6 tests, on a real GFS frame). `filledWorldStore.test.js` gains the crop-read
  rules and the updated wiring pin (each read says whether it is for a clip; `crop_only_set` at the commit and at the show).
