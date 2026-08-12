# `getImageData` is a STARTUP cost, not a per-frame one — and there was never a fence

Measured 2026-08-12 on deploy `34d76000`, live page, `LAYER=Waves`.

## ⛔ RETRACTION 1: the fence I said blocked this does not exist

I told the owner that `DO_NOT_ADVANCE_ITEMS.md` "explicitly fences the ocean-mask path as
performance work". **It does not.** §5 fences four named items — the ~27 s cold start, the 4 s
pre-request dead time, the duplicated `grid_series hours=0`, and the global-extent fetch — plus
particle-count reduction. The words *mask*, *getImageData*, *marineMaskShelter* and
*inlandWaterGuard* appear nowhere in the fence. The only mask mention in the file is my own Gate 2
residue line.

★ Fourth time in one session I asserted what a document said without re-reading it (the others:
`e2e-tests.yml`'s deploy gates, its `paths-ignore`, and its explicit warnings against the fix I was
proposing). **The cost of re-reading is seconds. The cost of not re-reading was an hour.**

## ⛔ RETRACTION 2: "the largest measured cost in the app" was misleading

`getImageData` totals 2858–2942 ms over a 30 s profile — but that is not 95 ms/s sustained.

`window.__RAW_MASK_REPATCH_LOG__` on the live page, sampled at t+5 s and t+35 s after activation:

```
t+5s   repaintLog: 2   noop: 0   reasons: ["data_commit", "data_commit"]
t+35s  repaintLog: 2   noop: 0   reasons: ["data_commit", "data_commit"]
        => +0 repaints over the 30 s window
```

**Zero mask repaints during steady state.** Both repaints are `data_commit` at startup. The two
`suppressShelteredWater` call sites (`WebGLMarineMaskRenderer.js:389` and `:411`) are in mutually
exclusive branches of `_spanForSheltered >= 0.5`, so one runs per repaint, not two.

That matches the windowed profile exactly: the worst blocked windows are t+4000 ms, t+6000 ms and
t+10750 ms — all inside the first ~11 s. And the two largest LoAF frames land at t+3917 ms
(1519 ms) and t+4718 ms (1026 ms), inside that same window.

## What this actually means

★ **The mask readback is what causes the big early stalls — and it is the answer to the original
"1.2 second frame" question.** It is NOT a drain on sustained animation. Optimising it buys
time-to-usable-map and removes the multi-hundred-ms startup stalls; it will not move frame rate
during ordinary use.

⚠️ And that lands it much closer to §5's genuinely fenced "~27 s cold start" than my framing
implied — though the fence's stated *reason* (those items may be load-bearing for the
non-deterministic product-selection logic in RC-03) does not apply to mask classification.

## Why I stopped here rather than cutting

1. **No safety net.** Gate 2 lists *pixel-wise OceanMask registration* as untested. There is no test
   that would catch a registration or classification regression, and this subsystem's comments
   record several hard-won correctness fixes (the Canal Grande mottle, Pellestrina reading as water,
   the z16 mottled-block report). Optimising it blind would be the highest-risk change of the session
   on the least-covered code.
2. **The target changed character mid-investigation.** A number I had been calling a sustained cost
   turned out to be a startup cost twenty minutes ago. That is exactly when to stop and re-plan.

## The plan, in order

1. **Build the safety net first**: a canonical-mask test in the style of
   `WebGLMarineTextureEncoder.canonicalFields.test.js` — known land/water bitmaps through
   `suppressShelteredWater` and `classifySheltered`, asserting which pixels are suppressed, with a
   mutation control. Without this, nothing below is safe.
2. **Then measure per-call cost directly** (~1.4 s per `suppressShelteredWater` inferred from 2 calls
   ≈ 2.9 s, but inferred, not measured — instrument it).
3. **Then the candidates**, cheapest first: reduce `dsW` below 1024 where `mPerPx` allows; skip the
   classification when `nPx` is degenerate; move the per-pixel loop off the main thread; reuse the
   downsample canvas across repaints instead of `document.createElement` each time.
4. ⛔ **Do not touch the `gapM` defaults or the smoothing flag.** Both carry recorded live-defect
   provenance (1000 m seals every Venice inlet at ~900 m; smoothing ON fixed the Canal Grande
   mottle). Those are calibration, not performance.

---

# ⛔ CORRECTION 2026-08-12 — two of the numbers above are wrong, and one counter was the wrong counter

## 1. "~1.4 s per call" was wrong by ~30x

Measured directly (`GATE6_mask_percall_bench.js`, real canvas, real extracted `classifySheltered`,
positive control passing, medians of 12 reps at production dimensions 4096x2048 -> 1024x512):

| stage | median | share |
|---|---|---|
| classify (JS) | **28.0 ms** | 60% |
| draw (downsample) | 11.7 ms | 25% |
| read (`getImageData`) | **4.5 ms** | 10% |
| stamp back | 2.5 ms | 5% |
| **TOTAL per call** | **46.7 ms** | |

The ~1.4 s figure came from dividing a 30 s profile total by two observed calls. **Do not optimise
against a quantity obtained by division.**

## 2. `getImageData` is the WRONG TARGET inside this call

It is 10% of the call — the second *smallest* stage. The JS classifier is 60%. Every sentence above
that frames the mask work as a "readback" problem is misdirected: within `suppressShelteredWater`
the cost is the chamfer/flood/BFS, not the pixel read.

## 3. ⛔ "Zero mask repaints in steady state" is VOID — wrong counter

`__RAW_MASK_REPATCH_LOG__` is written in `WebGLMarineLayer.js:495`, at the **layer re-patch** site,
whose own comment reads *"every recommit re-encodes the mask patch-less in setWaveData, then
re-patches here"*. It does not count `suppressShelteredWater` calls. I read a counter and assumed it
counted the thing I cared about, without checking its write site — the fifth time in this session.
★ **GREP THE WRITE SITE BEFORE TRUSTING A COUNTER.** A counter answers the question its author had,
not the question you are asking.

The **windowed profile** evidence for front-loading still stands on its own (worst blocked windows
at t+4000, t+6000 and t+10750 ms; largest LoAF frames at t+3917 and t+4718 ms). The counter half of
that argument is gone. Treat "startup, not steady state" as SUPPORTED BUT NOT ESTABLISHED.

## 4. The open discrepancy, stated rather than smoothed over

The CPU profile attributes **1394–1486 ms** to `marineMaskShelter.js:193`. At 46.7 ms per call that
is **~30 calls**, not the 2 I inferred. So either the function runs far more often than believed, or
production dimensions/`nPx` differ materially from this bench. **Call frequency is now the
unmeasured quantity** — and it must be measured at the function, not at a neighbouring counter.

★ Next step is NOT an optimisation. It is a call counter on `suppressShelteredWater` itself.
