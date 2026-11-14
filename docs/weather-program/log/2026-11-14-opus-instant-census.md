# 2026-11-14 — Opus, move 3: what is left between us and "instant everywhere" (branch `opus/instant-census`)

## 02:35Z Recorded decision: the far-edge gap stays (director, relaying the owner's lane plan)

The director asked for EURO's estimated far-edge hold as a stored server product, "the last forecast calculation done in the
browser". Checked first: the premise was wrong. The browser computes nothing at the far edge. The hold is entirely server-side and
per request (`far_edge_hold.try_far_edge_hold`, from `grid_resolver.py` and `hold_before_upstream`): the lane's last stored global
frame, relabelled `estimate_basis.type = far_edge_hold`, at most `FAR_EDGE_HOLD_MAX_H` (24 h) past the tail. The browser only reads the
label (`heldFrameTime.js`, `drawnFrameReadout.js`, `marineDrawnFrame.js`). With ICON swell_2 server-side (#877, merged dark) and ICON
past 168 h server-side since 2026-07 (`icon_marine_extension.py`), **no forecast calculation remains in the browser.**

What remains at the far edge is a delivery gap: held hours have no published frame, so the frame store cannot draw them and those
steps go to /grid (the late-cycle EURO h336 miss, roughly the last 0-6 scrubber hours before each new run). Storing the hold as
products would make the held copies "the tail" (a hold of a hold unless excluded from the tail and the candidates), force a prune
when the next run covers those hours, and cost ~8 frames per lane per tier per run, for the last few scrubber hours.

**Director's decision (2026-11-14 ~02:35Z): leave the far-edge gap.** It is honest, about 160 ms, and only in the last few scrubber
hours late in each cycle; held products would add risk to tail and selection logic for a small gain.

## The census, pre-registered (before any data)

**Question:** every scrub step still over 100 ms, ranked by user impact, with its cause.

**Lab:** offline only (`serve_synthetic.py` store5 + `publish_frame_images.py` cdn5, built from dev `376977357` with `--horizon 352`;
the harness's aged-store pre-check must pass). Client: a dev build of the same commit. No live backend.

**Cells:**
- Desktop: GFS / EURO / ICON start x waves / swell_1 / swell_2 / wind_waves x z2 / z4.6 / z7, dark theme, the standard plan
  (R R R PU J:29 J:250 J:336 J:126 D:12 M R J:250 M R J:336). One run (a census, not an A/B).
- Phone (390 x 844, dpr 3): waves only (the harness's documented limit: `VIEW=phone` cannot select a layer chip), all three models,
  the same zooms.

**Cause classes, assigned per step over 100 ms from the action record** (first rule that matches wins):
1. `held hour`: the store or the static seam refused with `no_frame_in_window` (past the lane's stored tail; /grid answered with the
   far-edge hold). Decided: left as is.
2. `ICON blend-hour policy`: the store refused with `icon_blend_hour` (ICON past 168 h is stored server-side, but the client store does
   not read its frames unless `REACT_APP_ICON_STORED_TAIL`).
3. `ICON swell_2 browser blend`: an ICON swell_2 step answered `grid` (fixed server-side by #877 once its flips land; the client half
   is held for "UI merged").
4. `missing frame`: `no_index`, `unbuilt_frame` or `not_indexed` (no published frame for the set or hour).
5. `/grid fallback`: answered `grid` with any other refusal (`resident_not_this_set`, `crop_only_set`, `crop_not_ready`, `not_ready`,
   `aux_not_ready`, `validity_differs`, `dims_differ`, ...), sub-labelled by the refusal.
6. `decode / series`: answered `series` in over 100 ms.
7. `upload / store show`: answered `store` in over 100 ms (the frame was on hand; the show itself or the draw was slow).
8. `unexplained`: none of the above (reported, never dropped).

Model toggles (`M`) are reported separately, as before. **Impact = number of steps x mean milliseconds over 100** per class (and per
cell), so a frequent 120 ms miss and a rare 2 s stall are on one scale. The top class by impact gets a pre-registered fix next.

## 04:10Z Result: PARTIAL (director: wrap this batch here)

Ran the desktop census as pre-registered (dev `376977357` build `main.66618efd.js`, asserted on all 36 sessions; store5 / cdn5, fresh:
the aged-store pre-check passed; 468 steps). **The cause labels are unusable:** the census ran dev's `scn_instant_contract.js`, which
does not record why a step fell back (the per-step store / static-seam / aux refusal counters live on #833, held), so every /grid step
read "no refusal recorded". A rerun with #833's instrumented harness was started and then stopped at the wrap.

**What it does show (counting a step that never showed the asked hour within the 6 s window as 6 s):**
- 188 steps over 100 ms or never exact. **112 of them are EURO / ICON at z7** (regional zoom); the rest split z2 38, z4.6 38.
- **147 steps never showed the right hour within 6 s** (most frequent: ICON J:336 in waves, swell_1 and wind_waves, 9 each; ICON R h251;
  GFS R h139 in swell_2 / wind_waves; R h2 at the start hours).
- ICON swell_2 (the browser blend, fixed server-side by #877 once its flips land): 39 steps, 9 never exact.
- Lab /grid answers at z7 took 1.9-9.2 s (one `/grid_series` EURO waves 9.2 s): the lab's dynamic viewport path, so the absolute times
  are a lab property; the counts and where they fall are the finding.
- Toggles: ICON swell_2 p50 668 ms (the blend); the others p50 26-62 ms with maxima near 500 ms.
- **Phone: no data.** `VIEW=phone` timed out waiting for the Waves chip in every session (15 s), so the phone profile is broken even for
  waves, not only for other layers as its header says.

**No fix is proposed or built on this data** (the director: don't build a fix on the current data).

**Next batch, first item:** instrument the harness on dev so each step records its fallback reason (the per-action store / static-seam
/ aux refusal counters and the committed grid's own hour; #833 carries a version of this, so either land #833's harness part on its
own after the merge window or port it), fix `VIEW=phone` (the chip selector at phone size), then re-run this census as pre-registered
above, desktop and phone.
