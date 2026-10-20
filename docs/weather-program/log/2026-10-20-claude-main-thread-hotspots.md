# 2026-10-20: three main-thread hot spots from the stall profile (GL state shadow, manifest index, Intl cache)

Session opened 2026-10-20T01:23Z. It was started by the weather-simulation audit session on the stall profile of PR #400
(`frontend/scripts/visual-lab/stall_profile.js`), which billed about 17% of scrub/switch stall time to
`WebGLStateIsolation.captureWebGLState`, 113-307 ms per run to `getSharedValidTime`, and 75-220 ms to `formatInstant`.
Branch `claude/main-thread-hotspots`, worktree `C:/Users/David/App/rs-hotspots`, cut from dev `a4a020334`. Client only.
**No served number changes** (no SCOREBOARD row): the GL state the engines capture and restore is the same state, the
selected valid time is the same string, and the readout is the same text, each pinned by a parity test. All three ship ON,
each with a kill switch. Evidence: `evidence/main-thread-hotspots-2026-10-20.json`.

## What changed

1. **GL state shadow** (`WebGLStateIsolation.js`; kill `window.__RAW_DISABLE_GL_STATE_SHADOW__`). `captureWebGLState(gl,
   mapContext)` reads blendFunc, blendEquation, colorMask and depthMask from MapLibre's `painter.context.<value>.current`
   when that value is NOT dirty, and calls getParameter for each value that is dirty, and for all of them when no context
   is passed. Both custom layers pass `map.painter.context` per frame (`engine._mapGLContext`). Why it is sound: in MapLibre 5.24, a
   value that is not dirty was last written through its own setter (`src/webgl/value.ts`: `set` skips the GL call only when
   the value is equal AND not dirty), and `drawCustom` sets all four values right before a custom layer's `render`
   (setColorMode, setDepthMode, and setBaseState's blendEquation). I checked both engines: nothing between that point and
   the capture writes blend or mask state (marine pre-capture work, `windTrailFrame`). MapLibre's BlendFunc and
   BlendEquation use the non-separate calls, so the RGB and ALPHA values are equal. A four-entry blendFunc shadow is taken
   entry for entry; any other shape falls back to getParameter.
   `WebGLStateIsolation.capReads.test.js` keeps its meaning unchanged: with no context, the expensive reads are still made.
2. **Manifest valid-time index** (`manifestTimeIndex.js`; kill `window.__RAW_DISABLE_MANIFEST_TIME_INDEX__`). Built once
   per products array (the manifest is replaced wholesale on every fetch and never mutated in place; WeakMap + length check):
   MODEL|domain|layer -> sorted unique valid-time ms + the lowest manifest index holding each time, and a binary search for
   the nearest time. It follows the linear scan's tie rule exactly: when two times are equally far, the one earlier in
   manifest order wins. Unparseable dates are skipped. A manifest with a non-string model, domain or layer gets no index
   and runs the original scan, which still throws as before.
3. **Cached Intl formatters** (`forecastReadout.formatInstant`; kill `window.__RAW_DISABLE_INTL_FORMAT_CACHE__`). One
   weekday + one hour `Intl.DateTimeFormat` per timeZone, at most 16 zones. With a field given, `toLocaleDateString` and
   `toLocaleTimeString` add no default fields, so the strings are the same. An Invalid Date keeps the toLocale path, which
   returns "Invalid Date" where Intl's format() throws.

## Tests (all in `frontend/src`)

- `WebGLStateIsolation.shadow.test.js`: a driver-faithful mock GL plus a line-for-line replica of MapLibre 5.24's four
  Value classes and the translucent-pass order. Covers the shadow capture deep-equal to the driver capture after setup,
  400 random frames (MapLibre sets, raw writes plus setDirty, partial re-sets; shadow path taken on more than 200 frames),
  dirty fallback, kill switch, foreign or missing context, four-entry shape, no aliasing, the audit, and a source pin that
  both engines pass the context. Mutation: dropping the dirty guard turns 2 tests red.
- `manifestTimeIndex.parity.test.js`: compares index vs scan (ISO string AND diagnostic record) on a RECORDED manifest
  (`src/tests/fixtures/products-manifest-offline.fixture.json`: 4,651 products from the offline backend's `/products`,
  order kept, fields cut to the four read) over more than 30,000 calls (all models, layers, domains, half-hour offsets,
  two anchors, more than 1,000 exact ties). It also covers adversarial manifests (more than 30,000 calls, more than 1,000
  ties: shuffled, duplicates, bad dates, mixed case, numeric times), the tie rule, the malformed-row fallback, and
  build-once. Mutations: always picking the earlier neighbour, or skipping the dedupe, each turn a test red. Fixed during
  the work: my first trimmed offset grid (-8 + 0.75k) never landed on an exact midpoint, so the adversarial sweep missed
  the tie mutant; the grid is now -7.5 + 0.75k and the sweep asserts its tie count.
- `forecastReadout.formatCache.test.js`: every 7 h 13 min across 2026 in ten zones (DST, half-hour and 45-minute offsets)
  equals the legacy toLocale strings; also covers the kill switch, Invalid Date, a bad zone (RangeError, not cached), and
  exactly two formatters built per zone.
- Runs: `src/components/map` + `src/tests` 336 suites / 4,916 tests pass; the rest of `src` 118 / 1,002 pass;
  `check_eslint.js` passes (no rule over baseline); `craco build` compiles with the same warnings as dev.
- The first full run caught three source pins I had broken: `WebGLWindEngine.js` line ratchet (1076 > 1075; the comment
  is now inline) and two `WebGLMarineCustomLayer` pins that keep `stampSkip(ENGINE_NO_DATA)` immediately before
  `engine.render(` (the assignment now sits five lines up, in the same try block).

## Measured (offline; never the live backend)

Setup in the evidence file. Both builds were made with the same command and env (dev on :3161, branch on :3162); the
synthetic backend was the same `:4121` process PR #400 used; the erratic flow with `LAB_TRACE=1` ran interleaved twice
per arm.

**Real-GPU agreement** (new `frontend/scripts/visual-lab/gl_shadow_agreement.js`; `window.__RAW_GL_SHADOW_AUDIT__` reads
the driver on every capture as well and counts agreement). On an AMD Radeon 890M under ANGLE D3D11, final build: 3,070
captures (marine 1,360, wind 1,710), every one shadowed, **12,280 checks, 0 mismatches** across scrubs, layer and model
switches, wind on, zoom 7 and 3, and Home. (The build before the final source-pin fix read 12,272 checks, 0 mismatches.)

**Stall view (stall_profile.js, 50 ms stalls), mean of 2.** This machine was much quieter than during PR #400's runs (dev
3,494 ms of stalls here vs 11,980 ms there), so the totals are noise: dev 2,363 / 4,625 ms, branch 5,486 / 3,485 ms. The
three targeted functions: captureWebGLState dev 0 / 298 ms -> branch 0 / 0; getSharedValidTime 15 / 46 -> 0 / 0;
formatInstant 15 / 38 -> 0 / 0. GL-state-capture stage over scrubs + switches: 142 (0, 285) -> 6 (12, 0) ms. Stall
stageByStep per run: evidence file, `runs.*.stall50.stageByStep`.

**All main-thread busy time (threshold 1).** captureWebGLState **13,177 / 15,636 ms -> 257 / 221 ms per run**;
getSharedValidTime 184 / 162 -> below the top 25; formatInstant 156 / 126 -> below the top 25. BUT "marine engine draw"
rose 3,657 / 4,269 -> 12,582 / 19,305 ms, and total busy time rose too (35.3 / 42.8 s -> 43.6 / 49.4 s). The traced
getParameter reads were mostly where the main thread waited on queued GPU work. Without them, the wait lands at the next
synchronous GL call. Most likely that is the per-frame `gl.checkFramebufferStatus` in particle advection
(`WebGLMarineEngine.js`, render body), but the profiler bills native GL time to the calling function and cannot name the
line. **So the "17% state capture" share was GPU wait; it was not CPU the reads themselves burned.**

**What the reads themselves cost (controlled, one build, kill switch only, steady 10 s scrub, 60 fps in every arm):**
marine engine.render 4.12 / 4.39 ms (shadow off) -> 3.09 / 3.32 ms (on), p95 6.4 / 5.9 -> 4.1 / 4.6;
wind 4.74 / 4.07 -> 2.73 / 2.80 ms, p95 6.4 / 5.6 -> 3.9 / 4.1. That is about 1.0-1.6 ms of main thread per engine per
frame, outside the tracer.

## Not done / follow-ups

- The next GPU sync point (`checkFramebufferStatus` every frame on an FBO whose attachment is fixed) is where the wait now
  lands. Caching its status per attachment is the next experiment, and it needs the same kind of A/B. The
  weather-simulation audit session also proposed skipping capture/restore of MapLibre-tracked fields altogether, since
  `drawCustom` calls `context.setDirty()` after every custom layer. That needs an audit of GL work outside the callbacks
  (texture uploads in setWaveData, mask probes) and a pixel read-back gate, so it is a separate change.
- I did not add the agreement script to the visual-lab README, to avoid a conflict with PR #400, which rewrites that
  README; the script's header documents it.
- No real-device or owner-console reading yet. The 1-1.6 ms per frame is this PC in headless Chrome.
