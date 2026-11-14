# 2026-11-13 Fable (animation lane): low-zoom views draw one world copy, not three; and the "slow load" lead, parked

Client only, ON. Kill `window.__RAW_DISABLE_WRAP_CULL_LOWZOOM__ = true` (zoom < 4 wraps again, as before);
`__RAW_DISABLE_WRAP_CULL__` still forces all three copies everywhere. No served number. Gate set with the director before
building (shared notes; the director's go-ahead 20:35 EST); results below.

## Part A. The change: `worldWrapCull.js`
The marine heatmap and crest particles can each be drawn three times per frame, at world offsets {0, -1, +1}, so the field
continues across the antimeridian. The rule that decides this ended with "or zoom < 4", which drew all three copies for EVERY
view below zoom 4, also one centred on an ocean with both world edges far off screen. That clause dates from when the bounds
clauses were dead code (the 2026-07-23 type bug) and was the only thing that ever wrapped. Now, with the map's own bounds of
the frame known: three copies only if the view crosses or comes within 10 degrees of +-180, or is at least 300 degrees wide;
unknown bounds or zoom still wrap. The rule moved out of `WebGLMarineEngine.js` into a pure module with tests.

### Gate, as written beforehand, and what was measured
Offline app (`scn_world_wrap_cull.js`), waves on, AMD Radeon 890M (integrated), 87,616 particles. "Old" arm = the kill.

**(1) Draws per frame 3 -> 1 and at least 50% of the particle pass saved, at 5 low-zoom views away from the antimeridian. PASS.**
GPU ms per particle draw by copy (main / -1 / +1), all three timed in ONE page load of the old arm, so the share does not
depend on which load it was:

| view (desktop 1080 px map) | old: main / -1 / +1 | share spent on the two skipped copies | new: draws per frame |
|---|---|---|---|
| Atlantic z3.2 | 0.356 / 0.271 / 0.276 | 61% | 1 (was 3) |
| E Pacific z3 | 0.422 / 0.304 / 0.298 | 59% | 1 |
| Indian z2.8 | 0.409 / 0.285 / 0.277 | 58% | 1 |
| mid-Atlantic z3.6 | 0.368 / 0.291 / 0.284 | 61% | 1 |
| off S America z3.9 | 0.380 / 0.283 / 0.281 | 60% | 1 |

Phone profile (390x844, dpr 3, CPU 4x, the same GPU): 52%, 60%, 58%, 57%, 55%; draws 3 -> 1 at all five.
**Heatmap copies (asked for by the director): they cost almost nothing.** The two skipped heatmap draws measured 0.000-0.017 ms
each against 0.17-0.23 ms for the main one (their mesh is clipped off screen). So the full saving is the particle figure:
about 0.55-0.60 ms per frame on this GPU at these views, plus two draw calls of the heatmap.

**(2) Every copy the new rule skips lights ZERO pixels, particles and heatmap. PASS.** At a real draw of the main copy, with
the engine's program, uniforms, textures and blend state bound, each copy is drawn alone into an offscreen target and its lit
pixels counted. Skipped copies: 0 and 0 in all 5 views, desktop and phone, and at zoom 2 centred on 0E. Positive control: the
main copy lit 144k-233k particle pixels and 599k-862k heatmap pixels (desktop); at the antimeridian views a side copy lit
120k-124k particle pixels and 308k-413k heatmap pixels, so the probe does see a copy when one is on screen.

**(3) Still wraps near +-180 and when more than a world is shown. PASS, with one change to the wording.** Fiji z4, Bering z5,
NZ z3, date line z2.5: three copies, reason "near-edge", desktop and phone. The gate said "and at zoom < 1.5": the app cannot
get there (`minZoom` is 2; my "z1.2" view was silently zoom 2, where the reported bounds, -94.9..94.9, are the true view and
no edge is on screen). The case that clause stood for is "more than a world on screen", which at zoom 2 needs a map wider
than 2048 px: with a 3400 px window the bounds read -281..281 and -131..431, the rule wraps ("near-edge"), and the side copies
light 160k-531k particle pixels. `map.getBounds()` equalled the unprojected screen edges in all 15 views checked.

### Gate history: one clause was changed AFTER the gate was written
- **As written before building (20:30 EST, sent to the director):** "(3) at 5 views near +-180 and at zoom < 1.5 the rule still
  wraps."
- **What was found:** the app's `minZoom` is 2 (`MapWebGL.js`), so a view below zoom 1.5 cannot occur. The harness asked for
  zoom 1.2 and silently got zoom 2; the first reading of that row ("the rule did not wrap at z1.2") was a harness error, not a
  failure of the rule: at zoom 2 centred on 0E the true view is -94.9..94.9 and no edge is on screen.
- **Replacement, accepted by the director (20:59 EST):** the clause stood for "more than one world on screen". Tested as a
  3400 px wide window at zoom 2 (bounds -281..281 and -131..431): the rule wraps and the side copies light 160k-531k pixels.
- **What this does and does not show:** the unreachable zoom range is covered only by unit tests (bounds past both edges; a view
  300 degrees wide), not by an app run. If `minZoom` is ever lowered, re-run the scenario at the new minimum.

### Tests
+25 in `worldWrapCull.test.js`: one copy for mid-globe views at any zoom; the 2026-07-23 cases (bounds as an array and as an
object, straddling +-180 in unwrapped and in wrapped form, the 10 degree margin on both sides, the same below zoom 4); views
wider than a world; unreadable bounds or zoom; both kills; the engine takes the decision once and both passes read it; the
layer passes the map's own bounds of the frame. Kill listed in the inventory.

### Limits
- One integrated GPU; times are small (under 1 ms a frame in all). Frame rate was not measured.
- Pitch and rotation were not exercised (the bounds are then the bounding box of the view, which is wider, so the rule errs
  toward wrapping).
- The harness left a few samples of the previous view in two "new arm" rows (copies -1 / +1 show a time where 1 draw per frame
  was counted); the draw count and the telemetry are the evidence there, not those times.
- The wind engine has its own rule (`WebGLWindLayer.js`): below zoom 3.5 it pads the view by 180 degrees on each side, which
  gives three world copies at any centre. Read in the code only; NOT measured. Filed as the next item with its own gate, not
  part of this change.

## Part B. The "slow load" lead from the instanced-draw work: cause not found, not shown to be ours. Parked
Seen in `2026-11-13-fable-particles-instanced.md`: on some page loads the particle draw's GPU time is about double for the
whole load. Pre-registered in the shared notes (`fable-animation-2026-11-13-slow-mode-prereg.md`), then measured:

| batch | loads | slow (median > 0.5 ms) | what it showed |
|---|---|---|---|
| 1 | 20 old draw + 10 instanced, interleaved | 4 of 20, 2 of 10 | the instanced draw is slow as often: NOT the draw path. In slow loads both cost ~0.6 ms |
| 2 | 12, samples tagged by world copy | 6 | every copy +0.32 ms per draw, on screen or off: real, per draw, in the vertex stage; not a sampling artifact |
| 3 | 10, engine telemetry + every shader uniform (121 fields) | 3 | no categorical field differs between slow and fast loads |
| 4 | 14, with a vertex-bound reference draw | 0 | no slow load occurred, so the test could not discriminate |

- Ruled out: the six-vertex draw path; a sampling artifact; any engine state readable from telemetry or uniforms.
- Not ruled out: a per-load difference in how the driver compiles the shader; a GPU state that slows vertex work (the first
  reference draw was fill-bound and did not slow; the vertex-bound one never met a slow load).
- Slow loads cluster in time and their rate varied by batch (4/20, 6/12, 3/10, 0/14). One GPU, headless Chromium.
- No code change follows from this. If it is taken up again: batch 4's script on a day when slow loads are occurring.
