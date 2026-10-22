# 2026-10-22 (claude, GPU-frames session): Stage A, instant model toggles

Written 2026-10-22. Branch `claude/stage-a-model-toggles` from dev `972be1e82`. Evidence: `evidence/model-toggles-2026-10-22.json`.

## Ask
- The lead, 2026-10-22: "START Stage A (model toggles) now. It's inert until ICON/EURO waves publish via #453, which is fine."
- The spec's goal (`docs/architecture/gpu-resident-forecast-frames.md` line 3): a toggle within ~150 ms.
- Before this branch, a model click waited out the orchestrator's 350 ms coalescing window, then the fetch.

## Change
**`marineFrameAux.js`** (new): a stored frame's OWN chlorophyll and bathymetry texture bytes.
- These come from the encoder's function (`getMarineGeoData`) on the frame's own masks. The packer now keeps the post-extrapolation
  ocean mask beside the true one (`oceanBitsPost`).
- They equal `encodeMarineTexture`'s uploads (`marineFramePack.parity.test.js`).

**`marineFrameStoreRuntime.js`**:
- **The exact aux show.** When the resident is NOT this set's frame, a frame can still go on screen with its own chl/bath, uploaded
  into the resident chl/bath textures beside the wave bytes. Examples: another model's frame, a `/grid` fallback frame, or masks
  more than 64 cells apart.
  - It needs: the engine samples its resident textures, a non-rating grid of the same layer, the same size and the same bounds.
    Otherwise it refuses and counts why (`shows.auxMiss`).
  - Afterwards the engine holds exactly that frame, so it becomes `rt.resident` and later steps take the resident path.
- **`tryShowStoredFrameForSwitch`**: the same, at a model click. The deferred show carries the switch.
- **Warm frames.** On a capable desktop (the idle fill's gate) the other published waves sets of this layer are planned at the
  cursor's time +-1 frame: after the +-8 window, before the run fill.
  - Only once the wheel has RESTED 500 ms. During a drag, the last resting position's warm frames stay planned: nothing is
    aborted, and nothing new is asked of the other models.
  - They stay in CPU bytes (no 7.5 MB texture array for a few frames), and their chl/bath are computed in idle time.
  - A set that turns active uploads its packed frames to its array then.
  - A set whose index is not pinned yet is pinned in the background, at most once a minute.
- **Only a desktop computes chl/bath on the main thread** (~63 ms per real frame): at a click, or on a scrub step at most once a
  second. Phones keep phase 2's behaviour.

**`marineFramePrefetch.js`**: a warm plan entry is flagged, and a replan never aborts a planned warm frame in flight.
- Before, every replan aborted any non-active request outside the top 2 x CAP. That was harmless while nothing planned warm
  frames, but a scrub replans on every step.

**Seam** (`useMarineOrchestratorScrubCache.showStoredFrameOnModelSwitch`, called by the orchestrator right after
`beginTransition`):
- It asks for the model the fetch will draw (`resolveMarineFetchModel`: past a model's horizon, or ICON past 168 h with its
  backend flag off, that is GFS), and only on a backend lane.
- Then the prefetch follows the new model.
- The coalesced fetch still runs and commits the same frame.

Kills (read per call): `window.__RAW_DISABLE_FRAME_MODEL_TOGGLE__` (no switch show, no warm frames) and
`window.__RAW_DISABLE_FRAME_AUX_SHOW__` (no exact chl/bath shows at all: phase 2's resident-gated path).
Lever: `window.__RAW_FRAME_WARM_REST_MS__` (500).

## Measured
**Setup.** `scn_model_toggle.js`, offline, on ONE combined build (this branch + #453's client, branch `tmp/stagea-combined`).
- Data: the synthetic store with GFS, ICON and EURO waves, published by #453's `publish_frame_images.py` (115 / 115 / 99 frames),
  served locally at 340 ms per object.
- Per session: 10 model clicks at hours 0, 24 and 168, every model order, each followed by one wheel step.
- `off` = `__RAW_DISABLE_FRAME_MODEL_TOGGLE__` (today's switch). Arms were interleaved over 2 rounds.

| per click | off (today) | on |
|---|---|---|
| ms to the new model's exact frame on the GPU, p50 / p95 / max | 429 / 1195 / 1262 | **11 / 12 / 12** |
| shown by the frame store | 0 of 20 | 20 of 20 |
| wrong-model frames the status line did NOT admit | 11 | **0** |
| frames already showing the new model while the line still said "Loading" | 17 | 0 |
| the wheel step right after, p95 ms | 15 | 12 |
| GPU read-back at the show vs after the normal commit (wave, chl AND bath equal) | n/a | **28 of 28** |
| backend requests per session | /grid_series 2 | /grid_series 1 |

- **Light and beach (`on`):** p95 11 and 12 ms, 10 of 10 from the store, 14 of 14 read-back pairs equal each. Each theme has its
  own pack signature.
- **Phone tier (`on-handheld`, 390 x 844):** no warm frames and no chl/bath computed on the main thread (`aux_not_ready` 7,
  `computed` 0). Every click took today's path: p50 435 / p95 1176 ms, as `off` on a desktop. That is intended.
- **Pre-existing, not from this branch:** today's switch draws about one wrong-model frame per click before the status line
  re-renders. Counted as 7 in 10 phone clicks and 11 in 20 desktop `off` clicks; the store path has none.
- The 28 equal pairs are the in-app proof that the exact chl/bath ARE the encoder's bytes.
- **Caveat:** in the synthetic store every model shares one grid and one land mask, so `getMarineGeoData` hits its cache and the
  idle chl/bath compute costs ~0 ms here. On real frames it costs ~63 ms each (measured in the parity work), which is why it runs
  in idle time and only on a desktop.

## Gates
- Frame-store, prefetch and scrub-cache suites: 76/76. New tests:
  - `marineFrameStoreRuntime.modelToggle.test.js` (22 cases, on a real GFS frame and a model-like variant with 200 more invalid
    cells; the switch's chl/bath bytes equal `auxForPack`'s, and the wave bytes equal the pack's);
  - `useMarineOrchestratorScrubCache.modelSwitch.test.js` (the seam mirrors the fetcher's model resolution and backend lanes).
- **The prefetch test that pinned the old abort rule was changed**, with the reason in place: a planned warm frame in flight now
  survives a replan.
- 18 mutants, each turning at least one test red (list in the evidence).
- Full map + `src/tests` + `src/__tests__` trees and the ESLint ratchet on the combined tree: 439 suites, 5,948 tests, all pass; ratchet passes.

## Not done / follow-ups
- **Live read owed once #453's pilots publish ICON and EURO waves.** Live today publishes GFS waves only, so this is inert there.
  - Read `__RAW_FRAME_STORE__.switches` and `shows.auxMiss`. A real ICON or EURO world grid whose trimmed size or bounds differ
    from GFS's would show up as `dims` / `bounds` refusals: the synthetic store uses one grid for every model.
- Egress: toggling makes the desktop idle fill run for EVERY model that becomes active (each run ~6 MB of real frames), not one.
  This is the existing per-active-set policy, and it feeds the open per-open egress cap question for the lead and owner.
- Layer toggles (Stage B) wait for #456 (the conform carries `is_valid`) and the packer's non-waves parity.

## Update 2026-10-22 ~21:30Z: on #459 (mid zoom) and #457; two fixes the mid-zoom A/B found
**Ask (lead, after #459 merged):** "merge origin/dev into claude/stage-a-model-toggles and resolve against #459's six marked crop
lines, so instant model toggles also work on a crop resident; re-chain your ledger lines after dev's head; run the store / crop /
static suites, mark it ready, and send me the full head SHA."

**Merges:**
- dev with #459: #459's crop hook landed in `showStored` after `setFor`, which covers the scrub step, the switch and the deferred
  show. Real conflicts only in the test reset and an appended parity test.
- dev with #457: `marineFramePrefetch.js` merged clean (AIMD `capEff` + the warm flag in `abortStale`).
- Ledger re-chained twice: after #459 (1671-1673), then after #457 (1673-1675).

**Mid-zoom model toggles** (`marineFrameStoreCropShow.js`):
- `cropWindowFor`: any set on the window's run lattice gets window packs. That covers the warm frames as they are parsed, and
  `cropWarm` covers those that landed before the window.
- `showCropSwitch`: the new model's window bytes plus the window's OWN chl/bath (`auxForPack` on the window pack, computed at the
  click on any tier; the window is ~1/30 of the world). The new model's clip becomes the crop resident.
- Only a click crosses models; a wheel step never does.
- The crop show's runtime half moved out of `marineFrameStoreRuntime.js` into the new file, as a factory over the runtime's state.
  It is #459's code unchanged; the move keeps the runtime under the 800-line cap (it would have been 843).

**Fix 1: ICON past 168 h is never shown from the store.**
- A production build draws those hours from a client-side blend (`fetchBackendMarineGridIconExtended`), never the stored frame.
- Offline the publisher built those frames, so a store show was replaced by the blend ~5.8 s later.
- Live, the pilots lane lists them unbuilt, so this is a safety guard.

**Fix 2: a store show supersedes the engine's stashed downgrade reject of another frame.**
- What happened, found by the forensic ring:
  1. At a mid-zoom click to ICON at hour 168, the store drew ICON's clip.
  2. The normal ICON commit was a WORLD frame (181 x 83). The no-downgrade guard rejected it against the same-model clip and
     stashed it in `_pendingDowngrade`.
  3. After the next click to GFS, the guard's every-frame re-check no longer held, so the self-heal committed the stale ICON
     frame: 23-25 frames of ICON under GFS, unadmitted.
- The engine's choke clears that stash on every accepted commit ("the stash must not resurrect"); a show never passes through it.
- The fix: `supersedeStash` clears a stash of ANOTHER frame (another model, layer or product) at every show. A stash of the SAME
  product (another extent of the frame now drawn) is kept, because a zoom-out brings it back.
- Kill: `__RAW_DISABLE_FRAME_STASH_SUPERSEDE__`.

**Measured** (offline, ONE combined build of this branch + #453; backend `--dynamic 1`; CDN 340 ms; on/off interleaved; 10 clicks
per session at hours 0, 24, 168):

| mid zoom, per click | off (today) | on, before the fixes | on, final |
|---|---|---|---|
| desktop 1280 x 800 at z5.5 (19 x 15 clips): p50 / p95 ms | 444 / 1196 | 8 / 9 | **10 / 11** |
| owner window 844 x 390 at z4.2 (27 x 19 clips): p50 / p95 ms | 440 / 1243 | 7 / 10 | **10 / 11** |
| from the store | 0 of 20 | 20 of 20 | 19 of 20 |
| wrong-model frames the status line did NOT admit | 13 + 9 | 25 + 24 (the stash) | **0 + 0** |
| frames regressed after the exact frame | 0 | 25 + 24 | **0** |

- **The one owner click that is not exact:** GFS -> EURO at hour 168. The app asked for EURO's 18Z frame (6-hourly past 144 h)
  and the probe's reference `/grid` ask tie-broke to 00Z. The two off sessions picked 18Z and 00Z by their own hour-rounded
  anchor. The status line read "nearest stored forecast" and no wrong-model frame was drawn, so this is the harness's tie-break,
  not a store mismatch.
- **The unequal read-back pair (1 per view, hour 48 scrub step):** the store showed a world frame (the engine held one), and the
  normal commit was the clip of the same product. That is #459's world/clip extent flip at mid zoom, not a switch.

**Gates:**
- Store / crop / prefetch / static / scrub-cache suites pass.
- `marineFrameStoreCropShow.test.js`: 17 cases.
- Mutants:
  - 11 mid-zoom-toggle mutants, including the window owner, every texture check, warm packs for a fresh window, a deferred
    switch, and a wheel step crossing models;
  - 5 stash mutants: each call site, the same-product exemption, and the kill;
  - each turns a test red.
- The warm-landing test now lands the window until the fill is granted (#457's cap of 4 changed the timing).
