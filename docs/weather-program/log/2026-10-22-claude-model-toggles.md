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
