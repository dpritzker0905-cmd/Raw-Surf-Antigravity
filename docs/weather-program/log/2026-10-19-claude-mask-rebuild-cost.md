# Land-mask rebuild cost: reproduced offline, measured, a two-entry mask cache (2026-10-19)

Session opened 2026-10-19T12:47Z, started by the scrub-upgrade session (PR #388) on the owner's console line
`[WebGLMarineEngine-Forensic] High-resolution land mask texture created (4096x2048)` about 8 times in a short session of
layer switches and zooms (log/2026-10-19-claude-scrub-upgrade.md, "Forensics from the owner's consoles"). Branch
`claude/mask-rebuild-cost`, built on #388's head 899a1563 and rebased onto `dev` bf154de07 after #388 was squash-merged at
13:14Z (its `frontend/src` is identical to 899a1563, so "before" below is dev's client). Draft PR #392. Client and harness only.
**No served number changes** (no SCOREBOARD row): which land-mask texture is bound changes, never a height, rating, glyph or
hub value, and the bound texture is exactly what a rebuild of the same bounds and polygons would draw (see "Safety").

## 1. The harness could not see it (why offline every switch reused the mask)

`scn_mask_cost.js` (PR #388) read `reuse` on every switch: the synthetic store held only world tiers. Two gaps, both now closed
in `serve_synthetic.py`:

- **No regional products.** `--regions florida_east_coast,us_southeast_midatlantic` (or `flagship` / `all`) adds 0.25-deg
  `regional_tile` frames for every layer production stores regionally, the boxes and resolutions read from
  `backend/services/weather_pipeline/pilot_regions.py` (the ingest's own table; the live manifest needs bucket credentials and
  was not fetched).
- **No dynamic lane.** A request under 15 deg skips the manifest products (`grid_resolver_selection.py`, `manifest_cut = 15.0`)
  and production answers it from Open-Meteo for THAT viewport at an adaptive resolution; offline the lookup is blocked, so the
  resolver fell back to the 2-deg `global_mid` clip, whose product id equals the resident world frame's, and the client
  short-circuits it (`commit_short_circuit`, resident 181x83, incoming 25x21). `--dynamic 1` answers the lane's marine fetch
  (`OpenMeteoProvider.fetch_grid`, `CopernicusProvider.fetch_grid`) from the same synthetic field, in Open-Meteo's raw
  shape, so the lane's own normalizer, cache keys and bounds run unchanged. A z7 request now commits
  `region_id viewport_-84.00_22.00_-76.00_30.00`, 9 x 9 at 1.0 deg (the production `choose_adaptive_resolution`).

Even then the zoom steps alone never rebuild: the mid tier serves the 2-deg clip at once and SCHEDULES the fine viewport fetch
in the background (`mid_res_tier._schedule_sharpen`). The viewport grid is committed by the NEXT request for that view, which
is what a layer or model switch while zoomed in is. `scn_mask_cost.js` now also switches at z7 and z9, reads the app's own
`mask_rebuild` / `mask_stash_swap` events (marineForensics ring), clears the encode-mode readout before each call (an early
return used to inherit the previous call's `rebuild`), and takes `THROTTLE=4` (CDP CPU throttling) and `WAIT_MS`.

## 2. Reproduced and measured (before = #388 head)

Desktop (no throttle), 21 actions, 10 s settle: **7 mask builds of 4096 x 2048**, all in the zoomed-in stretch
(z7 Waves, zoom 9, three in z9 Swell, zoom 4, z4 Swell): 45-344 ms of `setWaveData` each, **1,077 ms** in total, worst long
task 516 ms. An earlier run of the same scenario read 9 builds, up to 242 ms each, and a 675 ms long task.

4x CPU throttle (a mid-range phone's main thread): **8 mask builds, 211-1,521 ms each, 5,043 ms in total**; the world mask
builds are the 1.5 s ones. An earlier throttled run read 12 builds and 6.7 s.

The bounds sequence is the cause: zoomed in, the committed grid alternates between the world series frame
(-180,-80,180,84) and the viewport's own grid (-81,24,-73,30; -82,25,-78,28; -82,24,-79,29), and the encoder's single cached
mask is rebuilt on every alternation, including back to bounds it held one commit earlier. The renderer's three-entry pristine
CANVAS cache does not help enough: a hit still pays a full 4096 x 2048 blit, the patch carry and the 32 MB `texImage2D`.

## 3. The fix: a second mask-cache entry (`maskTextureStash.js`), ON, kill `window.__RAW_DISABLE_MASK_STASH__`

When the encoder REBUILDS, the outgoing resident texture moves to a one-slot stash instead of being deleted; a later rebuild
whose land geojson (same object) and bounds the stash matches (identical bounds at the same width tier, or a world mask
covering a world frame, the #347 rule) swaps it back in: no polygon paint, no SDF, no upload. **World pin:** when the stash
holds a world mask of the current world geojson, an outgoing REGIONAL mask is freed instead of displacing it (at z9 three
viewport boxes arrive between world frames, and a plain one-slot stash let each evict the world mask: measured 8 builds and
2 swaps on desktop before the pin, 5 and 2 after).

### Safety: every existing guard decides first
- The stash is consulted ONLY in the encoder's rebuild branch. `reuse`, retain-patched (src not ready), its upgrade guard,
  the close-zoom carve-out, the 32 px/deg density floor and the no-downgrade retain all run first, unchanged
  (test: a src-not-ready retain keeps the resident and leaves the stash untouched).
- **Patch carry:** if the carry would transplant painted basemap-water truth onto a fresh rebuild that the stash may not hold
  (the last painted box belongs to OTHER bounds and overlaps these, with the carry's own kill switch, density and overlap
  gates), the stash declines and the rebuild runs, carry included. World masks never carry, so they are never blocked.
- A resident carrying a DEGRADED basemap-water paint is freed, never stashed (the engine's own rule for the carry source).
- The stashed texture is still bound by the outgoing frame; `safeDeleteTexture` (the one deletion choke point) refuses to free
  it through the engine's cleanup path, and `disposeEngine` frees it. `WebGLMarineEngine.js` (3,204 lines) is untouched;
  the encoder grows 788 -> 793 lines.
- Cost: one extra mask texture held, up to 32 MB of GPU memory, counted in `__RAW_GPU__`. Telemetry: mode `stash_swap`,
  `window.__RAW_MASK_STASH_SWAP__`, forensic event `mask_stash_swap`.

## 4. After (same scenario, run back to back with the before arm against the same warm server)

| | before | after |
|---|---|---|
| Desktop: mask builds / swaps | 7 / 0 | 5 / 2 |
| Desktop: main thread in mask encodes | 1,077 ms | 575 ms (550 in builds, 25 in swaps) |
| Desktop: worst long task | 516 ms | 342 ms |
| 4x CPU: mask builds / swaps | 8 / 0 | 5 / 6 |
| 4x CPU: main thread in mask encodes | 5,043 ms | 2,898 ms (2,681 in builds, 217 in swaps) |
| 4x CPU: cost of one event | 211-1,521 ms per build | 4-103 ms per swap |

Throttled runs are timing-dependent (the after arm happened to see 11 mask events against 8), so read the 4x rows per event.
The world build left at z9 is, by inference NOT yet instrumented, a DIFFERENT mask rather than a miss: a stashed world mask is
refused only for another land-geojson object, and the layer swaps to the 10 m polygons at close zoom (`land_mask_res_swap`),
so a world frame committed at z9 most likely paints from the 10 m set. The next run should log the geojson identity per call.
Evidence: `docs/weather-program/evidence/mask-rebuild-cost-2026-10-19.json` (the four runs, every call's ms, mode and bounds).

## 5. Checks
- `maskTextureStash.test.js` (19 tests: the alternation, the world pin and its geojson condition, GPU accounting through
  eviction and teardown, the kill switch, retain precedence, the degraded rule, the carry rule, the delete guard) plus
  `maskCoverReuse.test.js`; two mutants (drop the same-bounds carry exemption; drop the delete guard) each fail a test.
- Windows note: a worktree under `.claude/` matches no test with the default `testMatch` (the `\.claude` path segment), so run
  `npx react-scripts test --testMatch "**/src/components/map/**/*.test.js"`.

## Not done / open
- Not seen on the real app yet: the harness is the production bundle over synthetic data. The read-back is the owner's console
  on a zoomed-in session: fewer `High-resolution land mask texture created` lines, and `window.__RAW_MASK_STASH_SWAP__ > 0`.
- The z9 world build (~1.2 s at 4x) is the largest cost left. If the per-call geojson identity confirms it is the 10 m set, a
  world frame at close zoom could use the 50 m set, but that changes which polygons cut the world mask and needs its own look.

## 6. Review fixes (2026-10-19 ~15:40Z; two independent reviewers via the lead session, combined local preview)
- **F8 (held):** after a swap, a throw later in the same encode transaction ran the rollback, which nulled `_cachedMaskTex`:
  the swapped-in texture was in neither the allocation list nor the stash (up to 32 MB stranded, still counted in
  `__RAW_GPU__`). The rollback now calls `releaseSwappedMask`, which frees it with accounting, except when the live frame
  still binds it (a swap from an EARLIER call: the engine frees that one with its frame, as before). 3 tests.
- **No device gate (held):** the stash is now OFF on handhelds (`deviceTier.isHandheldDevice`), where the OOM forensics live
  and iOS exposes no `deviceMemory`; `window.__RAW_MASK_STASH_HANDHELD__ = true` opts a phone in for a read. The 4x-CPU rows
  above therefore describe what a phone WOULD gain, not what it gets by default. 1 test.
- **Merge hazards (noted, resolved at merge):** #391 also edits `serve_synthetic.py`'s argparse block (`--layers`); whichever
  merges second keeps `--layers`, `--regions` and `--dynamic`. Both PRs carry ledger seq 1448; the second re-chains. The
  docs commit that carried a deploy-skip marker was folded into this one so a squash body cannot skip the dev deploy.
- Lead's lab note: in a combined build the zoom-to-8 long task read 313 vs 348 ms (dev); the mask is one part of that task.
- Jest map + `src/tests`: 328 suites, 4,857 tests pass.

## 7. Rebased onto dev fd7f5383b (2026-10-19 ~23:55Z, the lead session: the owner wants #392 merged once CI is green)
- dev moved (#389, #391, #393, #394, #396, #397, #398): the branch was rebuilt as ONE commit on fd7f5383b. The only overlap
  was `serve_synthetic.py`'s argparse: dev's `--layers ...,wind` (#391) is kept beside `--regions` and `--dynamic`; wind keeps
  its own build path, the regional tiers apply to marine layers only (smoke store: GFS waves + wind + florida_east_coast).
- Ledger: the first push's pr_open line (seq 1448) forked against #391's 1448 and never reached dev; it is dropped and the
  pr_open is re-appended by `action_ledger.py` as **seq 1462** on dev's head 1461. No commit message or PR title carries a
  deploy-skip marker (Render honours them; frontend paths are in its ignore list anyway).
- The backend-floor-staleness failure on the old head is dev's (fixed by #389's floors); this PR adds no backend test.
