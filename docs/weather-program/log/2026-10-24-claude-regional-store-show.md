# 2026-10-24 (claude, mid-zoom session): the frame store takes a pilot tile resident - z7-9 scrubs show from the GPU

Written 2026-10-24. Branch `claude/agitated-spence-f105b6` from dev `afe40e6fc`. Evidence: `evidence/regional-store-show-2026-10-24.json`;
design: `docs/architecture/mid-zoom-static-frames.md` section 9. Client + harness only. No served number changes (DARK with the regional bundles).

## Ask (the lead's brief, written 2026-10-22)
Build the regional static frame sets so scrubbing at z7-9 is instant, as #459 did at z3.9-6.5: publisher sets per region, the client
choosing the set by tile, `midClipWindow` generalised to the regional clip, the store's crop show for the resident window, fail closed
where a dynamic-cache product could answer first, the instruments, and z7 / z9 before / after numbers.

## What was already done when this started (dev afe40e6fc), so not redone
- Publisher: `GFS/marine/<layer>/<region_id>` bundles for waves + the three swell trains, parity-gated, 19 pilot boxes (#467, #486).
- Client: tile choice by manifest / pilot box, the Step 3 window (`regionalClipWindow`), bundle slices on both seams, fail-closed cover
  rule, backoff, kill switch (#491, #493, #500: DARK by default since the live parity failed); server tile-first flag (#508, DARK).
- Instruments: `scn_regional_client_parity.mjs` (node-by-node vs the resolver), `scn_zoom_scrub.js` arms `regional` / `noregional`.
The one missing piece, written in the code ("the frame store does not take regional sets yet"): the store's crop show.

## Change
- `marineFrameStoreRegional.js` + a regional branch in `marineFrameStoreCropShow.js` (about 60 lines): a committed grid that is a window of
  a pinned tile's frame (matched by STORED PRODUCT ID, then `frameWindowOf` on the tile lattice) is the crop show's resident; a step
  shows the same window of the stepped-to tile frame, packed exactly (`packWindow`). Packs for the whole run are built in idle time from
  the bundle in memory. Runtime hooks: three marked lines in `marineFrameStoreRuntime.js` (onParsed, noteCommitted, showStored).
- `staticFrames.getPinnedRegionalIndexSync` / `pinnedRegionalKeys`: the regional pins, only while `regionalBundlesOn()` (so DARK with them).
- `useMarineWindData` conform carries `__storedProductId` (a series frame's stored product, otherwise dropped): found because the first
  offline run showed 0 regional shows, every series commit having no id. No other consumer reads the field.
- Kill: `window.__RAW_DISABLE_FRAME_STORE_REGIONAL__ = true`. Harness: `serve_synthetic.py --real-frames` also writes the REAL tile from
  each regional bundle in the bucket copy (only for `--regions`); `scn_zoom_scrub.js` arm `regionalnostore`.

## Evidence
- Window pack == real encoder, 0 differing bytes: 3 real tile frames (florida_east_coast, us_west_coast_socal, uk_ireland), 9 windows,
  both lanes, 3 themes (27 cases) + runtime tests (resident, whole-run build, deferred show, fail closed, kill, re-pin, zoom-out).
- Bundle vs the resolver's tile clip on the REAL store: 74 of 432 asks claimed, 39,062 nodes, 0 bad, 0 metadata mismatches, max error 0.
- Scrub, offline, real run 2026-10-23T18Z, desktop, 2 sessions x 10 steps per arm, no session across :30:
  z9 Florida correct frame p50 / p95 / max ms: bundles killed 36 / 55 / 55, bundles on 35 / 67 / 82, **this PR 1 / 16 / 16**;
  z7 SoCal: 56 / 2,352 / 3,795, 46 / 208 / 218, **3 / 16 / 116**. Never-correct steps 0, mislabelled frames 0 in all arms.

## Not done / handed on
- Live read: the regional path is dark; once the lead opens it (bundles + #508 together after the live parity), one read of z9 Florida
  step times belongs to that flip. No live call was made here.
- Phone / small-window view not measured (the +-8 / +-24 build-ahead applies).
- STATE.md not edited (its "Now" list is the lead's).
