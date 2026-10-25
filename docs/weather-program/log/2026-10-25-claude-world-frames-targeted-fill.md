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

## What turns it on (not done here)

- **Two switches, both needed.** The repository variable MARINE_GULF_FILL_MID_TARGETED=1 makes the pilots lane publish the
  filled sets. The box's own Render env (already '1' since 15:14:13Z) makes /capabilities report the mode the client checks.
- **The client half ships ON with a kill switch.** It changes no served number: the frames carry /grid's own values
  (D-001 n/a). It serves nothing until both switches agree.
- **Live read owed after the first publish.** One world /grid per model against its filled frame at the same valid time,
  health-gated.
