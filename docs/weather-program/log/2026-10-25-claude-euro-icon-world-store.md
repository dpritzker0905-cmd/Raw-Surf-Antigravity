# 2026-10-25 (claude, GPU-frames session): the frame store takes the FILLED EURO/ICON world set (instant world model toggles)

Branch `claude/euro-icon-world-store` from dev 2b419ac80. Client only, no served number (the store shows frames the normal path already
draws); ships ON with a kill switch. Evidence: `evidence/euro-icon-world-store-2026-10-25.json`.

## Ask
- The lead, 2026-10-25: "getPinnedIndexSync still EXCLUDES EURO/ICON world sets, a guard from the time those frames lacked the
  serve-time fill. Now that the filled set exists and carries fill_mode: 1. Accept a EURO/ICON world set only when its index's
  fill_mode equals /capabilities gulf_fill_mid_mode. Otherwise keep excluding it (fail closed). 2. Measure the EURO world toggle, click
  to exact frame, p50/p95, before and after. Today it's about 450-475 ms offline, floored by the click's 350 ms coalescing window, so
  measure that floor too."

## What was in the way
- The GPU frame store asks `getPinnedIndexSync(setKeyFor(model, layer))`, i.e. the PLAIN `global_mid` set. For EURO/ICON it returned
  null: a world /grid of those models is the stored product WITH /grid's serve-time Gulf fill, and the door cannot tell a world show
  from a crop. So the store held no EURO/ICON frame, and a world model switch to them waited for the coalesced fetch (#555's filled
  frames made that fetch fast, but not instant).
- #555 publishes the filled set under its own key, `<model>/marine/<layer>/global_mid_filled`, its latest.json record and its index
  stamped with the fill mode (`fill_mode`, `index.fill.mode`). A crop must still come from the plain set: /grid fills world-span grids
  only.

## The change
- `staticWorldFillGuard.filledStoreAccepts`: the store may take a pinned filled index only while `filledWorldSetKey` still names it
  (/capabilities `gulf_fill_mid_mode` 'targeted' for the model AND the record says the same) AND the index's own `fill.mode` equals the
  server's mode. Waves only (the store's scope). Anything else: refused (fail closed).
- `staticFrames.getPinnedIndexSync`: a filled key passes only through that rule; a plain EURO/ICON key is still refused while the guard
  holds. `staticFrames.storeSetKeyFor`: the store's set is the filled one while it is servable, else the plain one (refused, i.e.
  today's behaviour).
- `marineFrameStoreRuntime`: its four set lookups use `storeSetKeyFor`; a filled set gets its own store domain (`world_filled`), so
  its packs can never be confused with the plain set's of the same run.
- `marineFrameStoreCropShow`: a filled set never feeds a crop window (`cropWindowFor`, `noteCropCommitted`). A world show already needs
  the engine's dims and bounds to equal the pack's, so a filled frame can only ever replace a world-sized resident.
- Kill: `window.__RAW_DISABLE_FILLED_WORLD_STORE__ = true` (the store takes no EURO/ICON frame: dev's behaviour exactly).
- Harness: `scn_model_toggle.js` CONLOG also captures the orchestrator's `[MODEL]` line, so the coalescing floor is measured per click.

## Measured (offline; one build = dev 2b419ac80 + this branch; ABBA fix / kill / kill / fix; world view z3.2, desktop window)
Store: serve_synthetic GFS/ICON/EURO waves, land masked; frames published by #555's publisher with MARINE_GULF_FILL_MID_TARGETED=1
(EURO filled 99 frames, ICON 115, parity_bad 0); the backend runs the same flag (/capabilities `gulf_fill_mid_mode: 'targeted'`).
Plan per session: EURO, GFS, EURO, GFS, EURO, GFS.

| Arm | EURO toggle: click -> exact frame | via frame store | coalescing floor (click -> "[MODEL] ... changed to") |
|---|---|---|---|
| fix | **p50 6 ms, p95 9 ms** (5, 6, 5, 9, 7, 7) | 6 / 6 | p50 431 ms (417-464): no longer waited for |
| kill (dev today) | p50 455 ms, p95 682 ms (535, 435, 455, 682, 427, 468) | 0 / 6 | p50 444 ms (432-647): the toggle lands just after it |

- **Control:** GFS toggles came from the store in both arms (0-8 ms).
- **Mislabel:** 0 silent new-chip frames in every arm.
- **Show vs commit:** at each EURO store show, the wave, chlorophyll and bathymetry textures read back equal to the textures after
  the normal commit of the same product (2 / 2 sessions, 181 x 83 both).
- **Other views (fix arm, 1 session each):** z4.5 in the desktop window and z4.2 in the owner window (844 x 390, dpr 2). EURO toggles
  took 3-7 ms, all from the store. In both views the normal path committed the same 181 x 83 world EURO frame, and the show and the
  commit read back byte-equal (all three textures). No crop window formed in this store at any view tried, so the crop refusal (a
  filled set never feeds a crop) is pinned by the unit / wiring test only, not by a run.
- **Checks:**
  - Suites: the static-frame, filled-set and frame-store suites (12 files, 208 tests) and the whole frontend suite (543 of 544 files).
    The one failure is netlifyIconStoredTailScope's Git Bash spawn timing out under machine load (24 ETIMEDOUT lines, 12 tests);
    it touches no file here.
  - ESLint ratchet: no new or regressed rule.
  - LOC: staticFrames.js 793 of 800, no grandfathered file grew.
- **The floor:** SWITCH_FETCH_COALESCE_MS is 350; it reads 417-470 ms on this loaded machine (timer plus style-ready slack).
- **Today's path is floor-bound:** dev's EURO toggle lands 0-35 ms after the floor ends.

## Not covered
- **The filled VALUES:** in this synthetic store the targeted fill changed 0 cells (`cells_filled` 0: the land mask masks the same
  nodes in GFS and EURO), so the run proves the timing and the acceptance path, not that a filled frame equals /grid where the fill
  acts. That equality is #555's parity gate on live data. The store adds no transform: it shows the published frame's bytes.
- **Idle baseline:** scn_model_toggle reads no idle two-rAF; the gap (6 vs 455 ms) is far beyond load noise, but the absolute
  numbers are offline on a loaded machine.
- **Live:** not read. That needs the publisher's repository variable (the filled sets are dark until it is set) and the box's
  targeted mode, both live.

## Follow-ups
- MID-ZOOM: a crop never comes from a filled set, so a EURO toggle at z4-6 still waits for the normal path. The lever there is the
  plain set's crop for EURO world-to-crop switches (the store refuses plain EURO/ICON sets today). Not in this PR.
- z7-9: the pilot-tile-per-model work (scope in the shared notes, PILOT-TILE-TOGGLE-SCOPE-2026-10-25.md), after static-frames'
  tile-first and bundles for ICON/EURO.
