# 2026-10-20: async shader compile for the engine batches (KHR_parallel_shader_compile)

Session opened 2026-10-20T03:42Z, started by the weather-simulation session `local_d6b521eb` after #403. Branch
`claude/upbeat-dirac-45811f` (worktree `.claude/worktrees/upbeat-dirac-45811f`), cut from dev `6021c2cc1`, rebased onto
`998e9e919` (#409). PR #410, ledger seq 1504. Client only. **No served number changes** (no SCOREBOARD row). Ships ON,
with the kill switch `window.__RAW_DISABLE_ASYNC_SHADER_COMPILE__` (restores #403 exactly). Evidence:
`evidence/async-shader-compile-2026-10-20.json`.

## What changed
- `WebGLProgramBatch.startProgramBatch`: with the extension, it issues every compile and link, then `poll()` asks
  `COMPLETION_STATUS_KHR` once per frame, only of incomplete programs, and reads `LINK_STATUS` once at the end.
  Without the extension (Firefox), or under either kill switch, it runs the unchanged synchronous deferred or serial batch.
  The cap is 120 polls, then the blocking read. A lost context does not count a poll and does not fail the batch.
- Engines: init allocates buffers, textures and the framebuffer. The vertex arrays wait for the batch, because
  `getAttribLocation` is a program query. `render()` makes no GL call while `_programBatch` is set. `dispose` drops a
  pending batch.
- Layers: poll before each draw. While pending they skip the engine and call `triggerRepaint`. A late link failure
  frees the whole engine and fires the same init-failure fallback, once. Marine stamps `programs_pending` / `programs_failed`.
- Lab: `lab.js` load probe (`flows[].load`); `stall_profile.js FOCUS=<regex>`.

## Measured (offline, same bundle, kill-switch A/B, 3 alternating runs; FLOWS=model_switch_future)
- Engine batch main-thread at load: kill 594/415/455 ms -> async 3/3/4 ms. Confirmatory pair on `edced5395`: 675 -> 2.
- Worst load stall: kill 665/457/520 ms, owned by the batch (`settleLinks`) every run. Async: 498/356/388 ms, owned by
  MapLibre tiles/style/draw + GC.
- First heatmap draw: unchanged (layer calls 188/221/177 vs 191/193/195). It is data-bound: the marine batch was ready
  at its first poll in every async run. The first layer call came earlier (medians 2463 -> 1827 ms).
- The remaining load shader-compile cost is MapLibre's own `program.ts` (~330-370 ms). Not touched.

## Mutation controls
20 mutations, each applied alone and then restored (scratchpad `mutate.js`); all 20 red, each on the test written
for it. List in the evidence file and the PR body.

## Lessons / traps
- Jest in a `.claude/worktrees` checkout: `npx react-scripts test --testMatch "**/src/components/map/**/*.{test,spec}.{js,jsx,ts,tsx}" "**/src/tests/**/*..."`
  works (craco's `testRegex` cannot be combined with `--testMatch`). `node_modules` is a junction to the primary's.
- `windCanvasAlpha.test.js` pins `WebGLWindEngine.js` at <= 1075 lines; additions there must be line-neutral.
- `WebGLMarineCustomLayer.stamp.test.js` requires the line before every `return` in `render()` to call `stampSkip`.
- In the async arm a pending wind batch (wind layer off) is never polled, so it is never published to
  `__RAW_GPU__.shaderBatch.wind`. That is expected: it settles on the first frame after Wind is turned on.

## Not done / owed
- No Firefox or real-phone run; no live read (offline only, per CLAUDE.md).
