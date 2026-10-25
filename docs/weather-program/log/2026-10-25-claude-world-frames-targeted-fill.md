# 2026-10-25 — EURO / ICON world frames with the targeted Gulf fill baked in (static-frames session)

Session: static-frames (side session of the lead "Weather simulation system audit"). Append-only.

## Why

D-050 switched the targeted Gulf fill on (15:14:13Z on 2026-10-24). A world /grid of EURO or ICON marine is then the stored
product plus that fill, so the client's world-fill guard (`staticWorldFillGuard.js`) keeps those world boxes on /grid, and the EURO
toggle waits about 1 s on the box. The lead's next item: "EURO/ICON world frames with the TARGETED fill baked in (same code +
donor run as /grid, mode stamped in the index), so the client's world-frame guard can accept them".

## What (draft PR against dev)

- **Publisher.** New `backend/services/frame_set_fill.py`, plus hooks in `frame_set.py` and `publish_frame_images.py`.
  - **Separate world sets.** It publishes a second world set per guarded layer: `EURO/marine/waves/global_mid_filled`, plus ICON
    waves, swell_1 and wind_waves.
  - **Same code as /grid.** Each set is built from the same stored products with the code /grid runs:
    `coarse_gulf_fill.targeted_fill_vectors`, the `_CompactDonor` from the same-layer GFS global_mid within 3 h
    (`_find_gfs_item`), `_lattice_mismatch`, and the same `coarse_fill` stamp.
  - **Why a separate set rather than rewriting `global_mid`.** Crops cut from `global_mid` must stay unfilled, as /grid serves
    them (it fills only at span ≥ 350°), and a separate key keeps the two apart in every client cache.
  - **Donor identity.** The GFS file, run, run time and ingested_at are part of each frame's source identity, so a new GFS run
    rebuilds the frame.
  - **Unbuilt hours.** A frame is listed unbuilt (the client asks /grid) when its donor is missing, not on disk, of another run,
    or on a mismatched lattice.
  - **Mode stamps.** The index carries `fill`; the latest.json record carries `fill_mode: 'targeted'`.
  - **Only the targeted mode is baked.** It is read the way the box reads it, from MARINE_GULF_FILL_MID and
    MARINE_GULF_FILL_MID_TARGETED, which the pilots workflow passes from repository variables. In any other mode the filled set
    publishes nothing, and its record is retired (`empty`, `fill_mode_off`) with the next real pointer move.
- **Client.**
  - **When it reads the filled set.** `staticWorldFillGuard.filledWorldSetKey` points a world box at the filled set only while
    /capabilities reports `gulf_fill_mid_mode: 'targeted'` for the model AND the record says the same.
  - **Where it is wired.** `staticFrames.js` uses it in `staticEligible`, seam A, seam B and `staticSetKeyForBox`. Crops keep
    the plain set.
  - **First ask.** The first EURO/ICON world ask starts the latest.json read, but only when the server is in the targeted mode.
  - **Kill switch.** `window.__RAW_DISABLE_STATIC_FILLED_WORLD__ = true`.
  - **Still excluded.** The GPU frame store still takes no EURO/ICON frames (`getPinnedIndexSync`, unchanged).
- **Harness.**
  - `serve_synthetic.py --enclosed-seas 1`: EURO and ICON 2-deg products mask three open-water boxes that GFS keeps. With only
    the land mask, every model masks the same nodes and the targeted fill has nothing to do offline.
  - `scn_static_parity.mjs` compares filled sets even under GUARD=1, and skips retired records.

## Evidence

- **Offline end to end, real code on both sides.**
  - Setup: `serve_synthetic.py --models GFS,ICON,EURO --layers waves,swell_1,wind_waves --land-mask 1 --enclosed-seas 1
    --horizon 24`, with MARINE_GULF_FILL_MID_TARGETED=1. The real publisher (`--only frames`) baked 1,474 cells per filled set
    (11 frames).
  - `scn_static_parity.mjs`, the app's own codec against the backend's world /grid at +0/+1/+2 h:

    | set | nodes | bad | meta |
    |---|---|---|---|
    | EURO/marine/waves/global_mid_filled | 345,529 | **0** | 0 |
    | ICON/marine/waves/global_mid_filled | 345,529 | **0** | 0 |
    | ICON/marine/swell_1/global_mid_filled | 345,529 | **0** | 0 |
    | ICON/marine/wind_waves/global_mid_filled | 345,529 | **0** | 0 |
    | EURO/marine/waves/global_mid (plain, positive control) | 345,529 | 3,082 | 0 |
    | ICON waves / swell_1 / wind_waves (plain, positive control) | 345,529 each | 3,082 each | 0 |

  - The direction max error is 0.000012° (tolerance 0.005).
- **Backend tests.** `tests/test_frame_set_fill.py` (11, chain lane). The first test runs the route function
  `fill_coarse_enclosed_sea_from_gfs_served` on the same products: the filled frame passes `fb.parity` against it with 0 bad and
  carries the same `coarse_fill`; the plain frame is bad at exactly the filled nodes. 7 of 7 mutants were caught (the fill call,
  the donor identity, the stale-run check, the lattice check, the stamp, `fill_mode` on the record, the retirement write). The
  publisher, bundle, wind and raster suites plus flag-lane parity: 99 passed.
- **Client tests.** `staticWorldFilled.test.js` (3), with 4 of 4 mutants caught. The full `src/components/map` and `src/tests`
  trees: 409 suites, 5,877 tests passed. The ESLint ratchet passes.

## Merged with dev at c1309243c (#548's tail frames)

- **The interaction.** #548's `TailDownloads` hands every ICON/EURO `global_mid` set the estimated tails, and the filled sets use
  the same `region_id`. Two fixes in `TailDownloads.prefetch`:
  - A tail the plain set already fetched this run is not fetched again.
  - The carried check uses the filled frame's full identity, including `fill_donor`.
- **Without them.** Every run would download each tail twice and refetch tails whose filled frame is carried.
- **Test.** `test_the_tail_downloads_feed_the_filled_set_once_and_carry_it_until_the_donor_changes` (both mutants caught).
- **Totals.** The new file holds 12 tests. The chain floor was re-derived on dev run 40171438269: 2955 + 12 = 2967 passed
  (MIN_PASSED 2949 → 2961), 180 → 181 files.

## What turns it on (not done here)

- **Two switches, both needed.** The repository variable MARINE_GULF_FILL_MID_TARGETED=1 makes the pilots lane publish the
  filled sets. The box's own Render env (already '1' since 15:14:13Z) makes /capabilities report the mode the client checks.
- **The client half ships ON with a kill switch.** It changes no served number: the frames carry /grid's own values
  (D-001 n/a). It serves nothing until both switches agree.
- **Live read owed after the first publish.** One world /grid per model against its filled frame at the same valid time,
  health-gated.

## Readiness evidence (2026-10-25, for the lead: parity at 3 valid times, fill mode vs /capabilities, EURO toggle before/after)

- **World frame vs /grid at 3 valid times per model.** From the end-to-end run above (`scn_static_parity.mjs`, the app's codec
  against the backend's world /grid). Valid 10-25 00Z and 10-25 15Z cover 30,046 nodes each; 10-26 06Z covers 45,069. All 0 bad,
  0 meta, for EURO waves and ICON waves, swell_1 and wind_waves `global_mid_filled`.
- **Fill mode, matched.** Offline backend with MARINE_GULF_FILL_MID_TARGETED=1:
  - `/capabilities` reports `gulf_fill_mid_mode: "targeted"` on every EURO and ICON marine row.
  - The publisher's latest.json records for all four filled sets say `fill_mode: "targeted"` (27 frames each, horizon 72 h).
- **EURO toggle before/after, offline.**
  - Setup: one build (#555); arm "filled" vs arm "killed" (`window.__RAW_DISABLE_STATIC_FILLED_WORLD__`, today's path).
    `scn_model_toggle.js` at world zoom (ZOOM 1.2, 1280 x 800), CDN_LAT 340 ms, 2 rounds per arm.
    Plan: EURO, GFS, EURO, GFS, ICON, EURO, GFS, EURO.
  - ⚠️ The first two attempts were INVALID and are discarded. Port 3100 was held by another process, so serve_spa never bound and
    the harness drove someone else's build: identical arms. The first attempt was also at zoom 3.2, a ~98-deg mid-zoom crop,
    which reads the plain set by design. The valid run used port 3177 (AB_BASE), and the runner aborts on EADDRINUSE.
  - New telemetry `window.__RAW_STATIC_FRAMES__.filledWorld` (the last guarded world decision) confirms each arm:
    - filled: `{possible: true, latestRead: true, key: "EURO/marine/waves/global_mid_filled", ok: true}`;
    - killed: `{possible: false, ok: false}`.

    | per session | filled | killed (today) |
    |---|---|---|
    | backend /grid asks | **0** | 2 |
    | backend /grid_series asks | **1** | 7 |
    | CDN frames fetched | 45 | 27 |
    | ms to the exact EURO frame (8 clicks) | median 475, max 1,389 (first click, cold filled index) | median 449, max 907 |
    | silent wrong-model frames / missed clicks | 0 / 0 | 0 / 0 |

  - **What this does and does not show.** The filled set takes EURO's world views off the box (no /grid, 1 series page instead of
    7). Offline, the click time does not move: the local backend answers a world /grid in about 270 ms, and the floor is the
    click's 350 ms coalescing window plus the draw.
  - The first EURO click is slower cold, about 1.3 s against 0.9 s: three serial CDN reads (index, then frames) at a simulated
    340 ms each, against a local backend.
  - The live gain is the box's ~1 s world /grid. That is not measurable offline without a backend-latency arm, which this
    scenario lacks.
  - The lever for an INSTANT EURO toggle is the frame store, which still takes no EURO/ICON frames (`getPinnedIndexSync`):
    with the filled set it can for world views. That is a follow-up for the instant-scrub owner, not done here.

## Follow-up: preload the filled index (the cold first click), 2026-10-25 midday

- **Why** (the lead, after #555 merged as 264d57e05): the cold first EURO click on the filled set made two SERIAL CDN reads,
  the index and then the frame. Offline it took 1.3-1.4 s against 0.85-0.9 s for today's /grid path.
- **What** (client only, ON, kill `window.__RAW_DISABLE_FILLED_INDEX_PRELOAD__`): `staticWorldFillGuard.preloadFilledIndexes`.
  - **When:** once latest.json is read, and again after the boot prewarm pins its own set (by then /capabilities has likely
    loaded).
  - **What it loads:** the WAVES index of each servable filled world set (EURO, ICON), through staticFrames' cached index loader.
    A model switch then waits for the frame only.
  - **What it leaves alone:** no pin, no frame download. It never runs for a set the server and the record disagree on, or
    for a killed set.
- **Measured** (offline, same setup as #555's evidence; my own build at port 3178, AB_BASE; world zoom 1.2, CDN_LAT 340 ms; 2
  rounds per arm):

  | first EURO click (cold) | #555 filled, no preload | preload | today's /grid path |
  |---|---|---|---|
  | run 1 | 1,302 ms | **868 ms** | 831-854 ms |
  | run 2 | 1,389 ms | **842 ms** | 907-993 ms |

  - Later EURO clicks: median 439-441 ms in every arm (the 350 ms coalescing floor).
  - Silent wrong-model frames: 0.
  - The preload arm also drops #555's one remaining /grid_series ask: the backend gets 0 /grid and 0 /grid_series asks for EURO
    world views, against 2 + 7 for today's path.
- **Tests.** `staticWorldFilled.test.js` gained 2 tests: the preload rides the latest.json read and the first ask fetches only
  the frame; there is no preload in another mode, with the preload kill, or with the filled set's own kill. 3 of 3 mutants
  caught. The map and tests trees: 411 suites, 5,929 passed. The ESLint ratchet passes.
