# Settle debounce — built, measured, and it MUST NOT become default

Default-off behind `__RAW_MASK_SETTLE_DEBOUNCE_MS__`. A/B against the same bundle, 20 s panning.

## It works, and it is the biggest win found so far

```
debounce OFF (default)     classified=42  deferred= 0   ~1.96 s classifier
debounce ON  (1000 ms)     classified=12  deferred=23   ~0.56 s classifier
```

**~71% of the panning classifier cost removed** — far beyond the cache's 12% while moving. Panning
was the open problem after the cache; this closes it on the CPU axis.

## ⛔ AND THE SAFETY METRIC SAYS DO NOT PROMOTE IT

```
pendingDeferrals AT REST, 4 s after motion stops:   OFF: 0    ON: 2   (max seen: 3)
```

Non-zero at rest means **a deferral was never followed by a real classification**. The mask is left
un-suppressed — sheltered water animating — and nothing re-drives it. That is the "heatmap on Canal
Grande" shape, except permanent rather than transient.

`suppressShelteredWater` cannot fix this: it has no handle on the render pipeline and cannot
re-drive itself. The fix belongs at the layer, where a settle timer can force a re-render — the
`useMarineScrubSettle.js` pattern, wired one level up.

★ **This is why it was built default-off with a safety counter rather than shipped on a CPU number.**
The CPU win is real and large; the feature is still not safe. Those are separate questions and only
one of them was ever in doubt.

## ⚠️ I picked the interval without measuring the thing it had to exceed

At **250 ms it was a complete no-op** — `deferred=0`, indistinguishable from OFF. Calls arrive
~540 ms apart during panning (37 in 20 s), so nothing ever landed inside a 250 ms window. I chose
250 because it is a conventional debounce value, not because it was above the measured inter-call
gap. The first A/B looked like "the feature does nothing" when it actually meant "the constant is
below the interval it is debouncing".
★ **A debounce interval is only meaningful relative to the arrival rate. Measure the gap first.**

⚠️ Also void, and caught only by checking: the first A/B ran against a STALE dev server holding the
previous build (`EADDRINUSE` on restart, silently ignored). `deferred=0` there meant "the bundle has
no debounce", not "the debounce did nothing". Verified afterwards by grepping the served chunk for
the flag — it lives in `6770.*.chunk.js`, not `main.js`, because the map code is split.
★ **Confirm the artifact under test actually contains the thing under test.**

## To promote this, in order

1. Wire a settle re-drive at the layer so `pendingDeferrals` returns to 0 at rest. Until that reads
   0 across repeated runs, this stays off.
2. Choose the interval from the measured inter-call gap, not convention — ~540 ms panning here, so
   anything at or below that is a no-op.
3. Verify visually what a pan looks like with it on. No instrument in this session can answer that.
