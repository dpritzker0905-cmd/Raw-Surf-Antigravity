# FINDING 2026-08-03 — the heatmap commits a DIFFERENT grid three times at an unchanged viewport

**Captured live** on `dev--rawsurf.netlify.app`, bundle `6da4c16e`, GFS / waves / hour 128, owner
driving the gesture that reproduces the report: *"as I zoom in, closer up it changes to no data or
trace swell in spots… noticeable as I zoom out."*

Instrument: `window.__LADDER__`, a `setInterval(250 ms)` recorder — **rAF-independent by design**.
Every quantity below is written at COMMIT time, not per frame, which is why it recorded where the
previous per-frame ladders recorded nothing (a backgrounded tab throttles `requestAnimationFrame` to
zero but never stops `setInterval`). 41 rows, 12 uploads, ~22 s of gesture.

---

## §1 THE MEASUREMENT — one viewport, three grids, 1.6 seconds

Zoom **8.30**, span **2.232°**, *unchanged across all four rows*:

| ms | vectors | non-zero | zero % | maxH (m) | upload sig |
|---|---|---|---|---|---|
| 70883 | 110 | 86 | 21.8 | 1.7217 | `110_geo_land_10` |
| 71402 | **49** | 44 | 10.2 | 1.7217 | `49_geo_land_10` |
| 71780 | **169** | 99 | **41.4** | **1.8901** | `169_geo_land_10` |
| 72504 | 169 | 99 | 41.4 | 1.8901 | *(retained)* |

Not an isolated moment. The same shape repeats through the trace:

| span (fixed) | vectors before → after | zero % before → after | maxH before → after |
|---|---|---|---|
| 3.888° | **225 → 30** | 24.9 → 6.7 | 2.3796 → 1.7217 |
| 1.938° | **396 → 143** | 42.4 → **55.9** | 1.72 → 1.72 |
| 2.232° | **110 → 49 → 169** | 21.8 → 10.2 → 41.4 | 1.7217 → 1.7217 → 1.8901 |

Distinct vector counts committed during one gesture: **30, 49, 110, 143, 169, 225, 272, 396.**

## §2 BOTH REPORTED SYMPTOMS ARE THIS ONE PHENOMENON

- **"no data in spots"** — the zero-cell fraction of the committed grid swings **6.7% → 55.9%**.
  At 143 vectors with 63 non-zero, more than half the cells carry nothing to paint.
- **"trace swell"** — `maxH` for the SAME location and SAME hour varies **1.72 → 3.02 m** depending
  on which product won the race. A **76% spread** in the headline number, with no input changing.

## §3 WHAT THE TRACE RULES OUT — a hypothesis killed by measurement

⛔ **The no-downgrade guard is NOT the cause here.** `rejected` and `blocked` are `null` on **every
one of the 41 rows**; the guard never fired during this gesture. AUDIT v7 §9 named it as the prime
suspect on the strength of an earlier console log — **that attribution is STRUCK for this defect.**
The `No-downgrade` lines in the earlier log were a different, correctly-working mechanism.

⛔ **Not the antimeridian fix, and not a fetch failure.** Every bbox in this session is legal, and no
row carries a `renderBlockedReason`.

## §4 WHAT IT IS, STATED ONLY AS FAR AS THE DATA GOES

**Several independent paths each commit a grid for the same viewport, and they disagree about both
coverage and magnitude.** Twelve uploads in ~22 s (`uploadCount` 21 → 33), each a full texture
re-encode. The signature field shows the committers are handing over genuinely different products,
not the same product re-uploaded — `110_…` → `49_…` → `169_…`.

One committer is also visibly triggered by something that is not the data: at ms 56763 the signature
changed `225_geo_land_1420` → `225_geo_land_10` — **identical 225 vectors, only the land mask
changed** (OceanMask's 50 m → 10 m upgrade at close zoom), and that alone forced an upload.

⚠️ **This is a CORRECTNESS defect, not only a visual one.** `__WebGLMarineLayer_DIAG__` reports
`infoboxHeatmapParity: false` in the same state. A number read from the infobox and a colour read
from the heatmap can come from different products, which is the recorded
`PARITY IS BLIND TO A WRONG COORDINATE` class wearing new clothes.

## §5 WHAT WOULD CLOSE IT — the instrument before the fix

The trace says *what* happens; it does not yet name *which* committer wins each race, because the
commit path is not stamped. Every row above is anonymous. **One field closes that gap:** stamp each
commit with its ORIGIN (`series_settle` / `sharpen` / `backstop` / `layer_switch` / `scrub`) beside
the signature already being recorded. Then the same 22-second gesture yields the caller histogram,
and the fix becomes a decision about arbitration rather than a guess about which path to touch.

★ This is the identical shape as the `vectors_total` fix that worked earlier today: **publish the
quantity the decision is actually made on.** The commit arbiter chooses between products with no
record of who asked or why, exactly as the series endpoint chose between hit and miss with no record
of which it served.

⚠️ Do NOT "fix" this by suppressing uploads. A committer that is right and one that is wrong are
indistinguishable in this trace; muting the losers would freeze whichever happens to be resident.
`marineCommitArbiter.js` exists and is the place this belongs.

---

**Reproduction:** GFS / waves / hour 128, Florida–Gulf, zoom 5.9 → 9.5 → 7.5, ~20 s.
**Raw trace:** `window.__LADDER__.rows` (re-installable; see the installer in this session's
transcript). **Not yet fixed — this is the forensic record only.**
