# 2026-10-23 (claude, GPU-frames session): the zoom-9 scrub repainted the land mask on every step; hidden layers' series

Written 2026-10-23. Branch `claude/z9-mask-paint` from dev `4082ba4bf`. Evidence: `evidence/z9-mask-paint-2026-10-23.json`.
Client only. No served number changes. Each change is ON with a kill switch.

## Ask (the lead, 2026-10-23, after the live read of dev 5460d13b at the map's opening view: z9, Florida east coast)
- "10 ArrowRight steps, 600 ms apart. Two-rAF times: 21, 138, 192, 27, 33, 139, 34, 22, 132, 32 ms."
- "`__RAW_GPU__.cpuPhaseTiming` points at the regional land mask ... maskWaterPaint: 8 calls, 853 ms."
- "Next lever: cache or skip the clean water paint when the viewport and mask inputs haven't changed."
- "After Waves was toggled, the client fetched 48-frame series for swell_1 (6.3 s), swell_2 (6.6 s) and wind_waves (11.1 s),
  none of them shown ... gate it on a static source (frames or bundles) or on the user actually hovering or toggling."

## Findings
1. **`setWaveData` forgot the paint record on EVERY commit.** Line 150 nulls `_regionalPatchState` because "every commit
   re-encodes the mask WITHOUT the basemap-truth patch", but the encoder REUSES the cached texture when the bounds and the land
   GeoJSON match (`_lastMaskEncodeMode === 'reuse'`). In that case nothing is uploaded and the texture still holds its paint.
   The refresh's own hysteresis could therefore never skip on a scrub. Offline at the live view, with the real Mapbox basemap,
   the record was `null` before every one of the 7 paints, 5 of them on a REUSED mask with the same view, the same delivered
   coverage and the same zoom.
2. **Two mask boxes alternate at one view.** The `/grid` tile is north 30 (13 x 13) and the series frame is north 29 (13 x 9).
   The one-slot stash declined each swap back on purpose (`carryWouldAddTruth`: the last paint was on the other box), so the
   step rebuilt the mask and repainted it.
3. **The hidden layers are `prewarmSiblingMarineSeries`** (marineController, default on since 2026-06-26). At any regional view
   it fetches each other marine layer's current 48-frame series page.
- Offline instrument gap, fixed: local builds had no `REACT_APP_MAPBOX_TOKEN`, so the basemap had no `water` layer and the
  paint never ran. A local, gitignored `.env` (values never printed or committed) brings the real basemap.

## Change
- **`maskPatchKeep.js`.** A paint stamps its record on the texture it painted (`tex.__rsPatch`). After a commit, when the
  bound mask is that very texture and the record names the current mask bounds, the record comes back, and the refresh's
  hysteresis decides exactly as without the commit. A rebuilt texture carries no record and repaints.
  Kill: `__RAW_DISABLE_MASK_PATCH_KEEP__`.
- **`maskTextureStash.stashHoldsPatch`.** The stash serves a swap back when the stashed texture's own CLEAN paint, filed under
  its bounds, contains the last painted box. It then holds that truth; the swap needs no rebuild, and the keep makes it need
  no repaint. Kill: `__RAW_DISABLE_STASH_PATCH_TRUST__`.
- **SPLIT OUT (the lead, 2026-10-23, after CI):** a sibling static-source gate in `marineController` was in this branch and is
  NOT in this PR. It broke `src/__tests__/marineSiblingPrewarm.test.js` (that tree was not run here), and it traded away the
  instant layer toggle the sibling prewarm exists for. The owner's mandate is an instant toggle AND an instant scrub. The
  redesign is a follow-up PR: read regional bundles or world frames for siblings first, and elsewhere warm in idle time,
  after the visible layer, one layer at a time. The `/grid_series` counts below were measured with the gate and stay as
  evidence for that PR.

## Results (offline, the live view, the real basemap; evidence file `runs`)
- **Water paints during the 11 steps.** These counts do not depend on machine load.
  - Before: 6 per session.
  - With the keep only: 2 per session, the box-alternation rebuilds.
  - With the keep and the stash trust: **0**. Both alternations became `stash_swap`s with no paint.
- **Frames over 50 ms within 500 ms of a key**, on a quiet machine:
  - killed arms: 6 and 7 per session (125-254 ms);
  - keep only: 2 per session;
  - all three on: **0** (session ab2 #1).
  - Sessions ab2 #3-4 and a re-run pair ran while another session loaded this machine (idle frames 111-165 of ~360 per 6 s).
    Their frame times are not timings; their paint and request counts agree with the quiet runs.
- **`/grid_series` after Waves.** Killed: 10-11 requests, 6 of them the hidden layers' (swell_1, swell_2, wind_waves: their
  hour-1 page plus their 48-frame page). On: 4, waves only.
- Live this was ~24 s of the box's ~34 s of series work for one map load (the lead's read).

## Tests
- New: `maskPatchKeep.test.js` (the real refresh on a fake engine: a reuse commit skips, the kill repaints, a rebuilt or
  re-cached texture repaints, a degraded record never earns the skip, a pan repaints), stash-trust cases in
  `maskTextureStash.test.js`, and the gate in `marineController.warmLanes.test.js`. The old warm-lane test now runs under the
  gate's kill switch.
- Mutants: 11 of 11 killed in this PR (`scratchpad/mutants_z9.py`; its 2 sibling-gate mutants left with the gate). They cover:
  - each kill switch ignored;
  - any texture handing back a record;
  - the bounds check skipped;
  - no stamp;
  - no keep in `setWaveData`;
  - the reset removed;
  - a degraded, a foreign or a smaller paint trusted;
  - the stash never trusting.

## Not done
- The live read after the merge, at the same z9 view: `maskWaterPaint` calls during a 10-step scrub.
- The hidden-layer series load: in the follow-up PR (see SPLIT OUT above).
