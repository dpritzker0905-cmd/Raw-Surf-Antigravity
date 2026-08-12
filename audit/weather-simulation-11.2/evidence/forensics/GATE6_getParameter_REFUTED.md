# The `gl.getParameter` batching produced NO measurable improvement — and my attribution was wrong

**Deployed** `286a4e6b` (frontend `BUILD_VERSION` confirmed, backend uptime reset).
**Measured** 2026-08-12, RTX 3060 Laptop, headed Chromium, `LAYER=Waves`, 30 s from activation.

## The number

| build | `gl.getParameter` self time | runs |
|---|---|---|
| `23743f63` (before) | 1465.9 ms · 4.6% | 1 |
| `286a4e6b` (after) | 1519.1 ms · 4.92% · 1411.2 ms · 4.50% | 2 |

**Flat.** The after-values straddle the before-value. There is no improvement to report.

## Why the fix could not have helped, established rather than guessed

Texture uploads roughly **halved** between the runs (41 → 17-19, workload counters now printed every
run). If `getParameter` were driven by texture uploads, it had to fall by roughly half. It did not
move. ★ **A cost that stays flat while its supposed driver halves is not driven by that driver.**

The real site is `WebGLStateIsolation.js:8` `captureWebGLState`, which issues **21 `gl.getParameter`
calls in a single function** and runs per render to isolate state from MapLibre. The encoder's
2-per-texture ran only on commits. I optimised the small site and attributed the large site's cost
to it.

## Was the change wrong?

No — it is correct, tested (10 → 2 driver reads per encode, mutation-verified), and does remove real
synchronous round trips. It is simply **immaterial** at this scale. It stays, the perf claim does not.
⛔ Do not cite `286a4e6b` as a performance improvement. Cite it as a correctness-neutral cleanup.

## Two instrument defects found while doing this, both silent

1. **The pre-deploy profile did not record its own workload**, so the before/after pair was never
   strictly comparable and I could not have known. Workload counters now print every run.
2. **The "JS callers" filter matched on `r.url`**, which is the *bundle* path (`main.<hash>.js`), not
   the original source. It could only ever return empty, and it printed "nothing found" rather than
   failing. It now resolves through the source map before matching.
   ★ **A filter that can only return empty is not a measurement, and it fails silently.**

## Run-to-run variance is large — single-run comparisons are weak

`getImageData` measured 2729.6 ms (8.84%) and 4420.5 ms (14.10%) on **consecutive runs of the same
build**. Any difference smaller than roughly 1.6× is inside the noise of this harness. The
before/after `getParameter` gap is far inside it in both directions.
⚠️ Quote a range from repeated runs, never one number.

## What the evidence actually supports now

Dominant cost is the ocean-mask pipeline, consistent across every run:

```
getImageData              2729–4420 ms    8.8–14.1%
marineMaskShelter.js      1394.6 ms        4.45%
drawImage                  722–1260 ms     2.3–4.0%
inlandWaterGuard.js         573.3 ms       1.83%
WebGLMarineMaskRenderer.js  399.5 ms       1.27%
gl.getParameter            1411–1519 ms    4.5–4.9%   <- mostly captureWebGLState, 21 calls/render
```

**Next, in order of expected value:**
1. `captureWebGLState` — 21 driver round trips per render. Same batching argument as `286a4e6b`, but
   at the site that actually carries the cost. Contained, and it has a real denominator.
2. The mask readback path (`getImageData` + `drawImage`) — 3× larger, but `DO_NOT_ADVANCE_ITEMS.md`
   fences the mask off as performance work until determinism is settled. That fence needs lifting or
   respecting explicitly, not stepping over.
