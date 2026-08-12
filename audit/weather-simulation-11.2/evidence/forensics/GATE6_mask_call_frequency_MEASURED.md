# Mask call frequency MEASURED — 37 calls / 30 s, and "startup, not steady state" is REFUTED

Measured 2026-08-12 with a counter on `suppressShelteredWater` itself, local build of the current
commit served at `localhost:4173`, production backend, `LAYER=Waves`, vectors 289 (same product the
deployed runs served).

```
before activation      calls=  0  work=  0
t+5s  after activate   calls=  8  work=  8
t+15s                  calls= 19  work= 19
t+30s                  calls= 37  work= 37

activation burst (0-5s)   : +8    (1.6 /s)
settling      (5-15s)     : +11   (1.1 /s)
steady state  (15-30s)    : +18   (1.2 /s)
```

## ⛔ REFUTED: "the mask is a STARTUP cost, not a per-frame one"

Published in `GATE6_getImageData_IS_STARTUP_NOT_STEADY_STATE.md` and already downgraded once when
the counter behind it turned out to be the wrong counter. It is now **refuted outright**: the rate
in steady state (1.2 /s) is essentially the same as during the activation burst (1.6 /s). The work
is **continuous**, not front-loaded. The windowed profile's early hot spots were the *worst*
windows, not the *only* ones — and I read "worst" as "only".

★ A distribution's peak is not its support. Ranking windows tells you where the maximum is; it says
  nothing about whether the rest is empty.

## Two independent methods now agree — which validates both

| method | result over 30 s |
|---|---|
| counter × measured per-call (37 × 46.7 ms) | **1728 ms** |
| CPU profile self-time at `marineMaskShelter.js:193` | **1394–1486 ms** |

Within ~20%. The count came from a counter at the function; the per-call came from a real-canvas
bench with a positive control; the profile came from CDP sampling. Three separate instruments,
converging. That is the first cross-validated number in this whole line of work.

## What this makes the mask worth

**~1.2 calls/s × 46.7 ms ≈ 56 ms/s ≈ 5.6% of wall time, sustained.** Every entry does full work —
`calls == workCalls` at 37/37, so no call is being refused by the guards. Within each call the
classifier is 60%, so the chamfer/flood/BFS alone is **~34 ms/s continuous**.

That is a real, ongoing cost and it is now worth optimising — for frame behaviour, not merely
time-to-usable-map. The earlier framing had it backwards in both directions: I called it the
largest cost when I thought it was a readback (it is not, that is 10%), then called it startup-only
when it is continuous.

## Caveats

- Local frontend build, production backend. Same commit, same served product (vectors 289), but the
  deployed bundle was not the thing counted. The counter ships with this commit, so the next deploy
  can confirm on production.
- The layer was activated by dispatching `element.click()` because a class-less full-screen `DIV`
  intercepts pointer events on the local build. `aria-pressed` was verified `true` before any count
  was taken — a run where it stayed `false` reported **0 calls**, and that zero was correctly
  discarded rather than published.

## Next

Optimise the classifier, not the readback. Candidates in order: reuse the downsample canvas instead
of `document.createElement` per call; skip re-classification when the canvas signature and bounds
are unchanged between calls (37 calls in 30 s on a static viewport suggests substantial repeat
work); then the chamfer itself. The two mask suites (32 tests, 6 mutation arms) are the net.
