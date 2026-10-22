# 2026-10-22 (claude, mid-zoom instant scrub, a subagent of the lead): instant scrub at the zooms people use

Written 2026-10-22T16:45Z. Branch `claude/eloquent-almeida-a2627f` from dev `95ca652a5`. Design and plan:
`docs/architecture/mid-zoom-static-frames.md`. Evidence: `evidence/mid-zoom-instant-scrub-2026-10-22.json`.

## Ask
The owner, through the lead: "I am not seeing the heatmaps serving instant scrubbing changes yet ... open a subagent to further
diagnose and resolve the instant scrub issue." His console (dev bundle 9ecac552, GFS waves, z3.5-4.4): 27 x 20 / 29 x 20 /
31 x 21 grids (clips of global_mid), "[SCRUB] [BACKEND CACHE] Instant re-index", no frame-store or static-frame activity.

## Instruments (new)
- `serve_synthetic.py --real-frames <bucket copy>`: the store holds the REAL published GFS waves run (115 frames copied from the
  public bucket, every sha256 checked against the index), so `/grid` clips the very numbers the CDN frames carry.
- `scn_static_crop_parity.mjs`: the app's own modules against that backend, node by node, on both seams.
- `scn_zoom_scrub.js`: one open per (zoom, arm), the owner's steps, per step the time to the correct frame and to the label,
  backend requests, mislabelled frames (must be 0), resident dims; the store and static-frame counters per session. Views:
  desktop 1280 x 800 and `owner` 844 x 390 (MapLibre sizes the world at 512 x 2^z px, so that window at z3.5-4.4 gives the
  owner's exact clips: 31 x 21 at z3.9, 26 x 19 at z4.4).

## Found (each in the design doc, section 1)
- A (confirmed): static frames served world boxes only (340-deg span); viewport boxes at z3.9-7 went to the backend.
- B (confirmed in code, but not the blocker): the guard refuses a same-hour world frame over a covering clip. The store never
  passes the guard; it refused because its resident had to be world-sized (`resident_not_this_set`, 9 of 14 per session).
- C: a fixed 150 ms debounce on a series miss (`timeline_scrub_deferred`).
- D: at mid zoom the series serves the WORLD frame (series pages over 15 deg ask the world box) while the exact `/grid` serves the
  clip, so the two take turns as the resident and a same-hour world frame after its clip is refused (the owner's "rejected
  181x82"). Only a 12-15 deg series page is a clip; it gets its own key.
- E: the server's clip cache (keyed by the snapped box) makes the clip extent depend on request history; never a node value.
- At open, mid zoom first shows the WORLD frame (store steps instant), and only a later trigger commits the viewport clip; from
  then on every step missed the store.

## Changed
1. `staticFrameCrop.js` + both static seams: a viewport box the resolver answers from `global_mid` is served as a crop of the
   static frame (kill `__RAW_DISABLE_STATIC_MID_CROP__`); crop series pages get their own key. Parity: 382 crops, 206,860 nodes,
   0 bad, 0 metadata mismatches.
2. `marineFrameStoreCrop.js` + small hooks in `marineFrameStoreRuntime.js`: the store shows a resident clip's window of the next
   frame, packed exactly (kill `__RAW_DISABLE_FRAME_STORE_CROP__`). Pinned byte-identical to the encoder on both lanes, 5 windows x
   3 themes; a control shows a world-texture cut is not.
3. Step 2 as briefed (the guard accepting a same-cell world frame over a clip) NOT done: it would ping-pong world and clip each
   step with a mask switch; with both seams answering the same clip there is nothing to let through.

## Measured (offline, the real run; `evidence/mid-zoom-instant-scrub-2026-10-22.json`)
Steps whose resident is a clip, key press to the correct frame on the GPU:

| view, zoom | before p50 / p95 | after p50 / p95 | `/grid` per step | mislabelled frames |
|---|---|---|---|---|
| owner-sized, z3.9 | 275 / 306 ms | 7 / 26 ms | 0.5 -> 0 | 0 |
| owner-sized, z4.4 | 277 / 300 ms | 5 / 49 ms | 0.5 -> 0 | 0 |
| owner-sized, z4.8 | 259 / 261 ms | 2 / 28 ms | 0.5 -> 0 | 0 |
| desktop, z5 | 252 / 273 ms | 5 / 26 ms | 0.5 -> 0 | 0 |

Crop show killed: 184-195 ms p50 (the 150 ms debounce plus the static crop). World zooms unchanged (p95 16-17 ms). Residuals:
desktop z6 (two clips from different boxes take turns, p95 212 ms) and z7-9 (regional tiles: plan in the design doc, section 6).

## Gates
- Jest: the crop, store, static and series suites 169/169 plus the new series test; the whole map + `src/tests` tree 4,955 pass,
  the 3 suites failing in the dot-free copy all fail on files outside it (`e2e/`, repo-root reads), none on this change.
- Mutants caught: a one-cell window offset (15 tests), `engineHolds` always true (2), the pad fraction 0.5 -> 0.6 (3).
- ESLint ratchet exit 0; LOC ratchet 0 regressed; secret scan clean.

## Owed
- ONE live read on the dev site after the merge deploys (the owner's z3.9-4.4 at his window size; `/api/health` before and after):
  `__RAW_STATIC_FRAMES__.crops` rising, `__RAW_FRAME_STORE__.crop.shows` rising, no `/grid` per step at those zooms.

## No served number changes
Crops are the resolver's own clip of the same product (parity 0 bad); the store's crop show writes the encoder's own bytes for
the clip. No SCOREBOARD row: nothing served moves.
