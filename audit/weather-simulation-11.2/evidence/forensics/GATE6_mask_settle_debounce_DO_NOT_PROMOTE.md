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

---

# ✅ RE-DRIVE WIRED — `pendingDeferrals` now reaches 0 at rest, and it costs most of the win

```
20 s panning, same session per arm
  debounce OFF (default)   classified=29  deferred=0   ~1.35 s classifier
  debounce ON  (1000 ms)   classified=21  deferred=7   ~0.98 s classifier

pendingDeferrals AT REST (4 s after motion stops)
  OFF: 0    ON: 0    (max seen during motion: 3)   ✅ every deferral was followed
```

## The re-drive already existed; what was missing was PRIORITY

`WebGLMarineLayer` has listened on `idle`, `zoomend` and `moveend` since well before this work. The
debounce defeated it: those events fire within a second of the last gesture, so the settle call
landed inside the window and was deferred exactly like the motion calls it was meant to close.
★ **A debounce that also debounces its own settle signal can never converge.** The fix is one line —
`markMaskViewportSettled()` at the top of `refresh` — which makes the next call settled regardless
of how recently work happened.

## ⚠️ The saving fell from 71% to ~27%, and that is the correct number

The 71% was measured with a **broken** feature — the mask was left stuck un-suppressed at rest. With
the re-drive in place the marker also fires on `sourcedata` (it lives inside `refresh`, which is the
`sourcedata` handler too), so the debounce resets more often and defers less.
⛔ **Do not quote 71%.** That figure describes a state that leaves the map visibly wrong. Safety cost
about two thirds of the win, which is what safety usually costs and why it is measured rather than
assumed. ~27% of panning classifier cost, with the mask converging, is the real offer.

## Still DEFAULT-OFF

The CPU and safety questions are now both answered. The visual one is not: no instrument in this
session can say what a pan looks like with classification deferred. That needs a human, and until
then the flag stays off.

## Two rig errors worth recording

- **`grep markMaskViewportSettled` on the built chunk returned 0 and that proved nothing** — it is an
  internal ES export, so terser renames it. The `__RAW_MASK_SETTLE_DEBOUNCE_MS__` window property
  survives minification and is the valid presence check. ★ **Verify a build by a string the minifier
  cannot rename.**
- A stale dev server on the original port silently answered two measurement runs. Both times the
  symptom was `deferred=0`, which reads as "the feature does nothing" rather than "you are testing
  the wrong bundle".
