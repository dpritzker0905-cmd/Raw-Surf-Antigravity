# 88% of mask classifier work is re-deciding unchanged input

Measured 2026-08-12, local build of the current commit (validated against production to within 11%
on call frequency), production backend, `LAYER=Waves`, **static viewport — no pan, no zoom**, 30 s.

Key = the classifier's COMPLETE input: `FNV-1a(water[]) : nPx : dsW x dsH`. `classifySheltered` is
pure, so identical input means identical output by definition — and that is exactly the cache key a
real implementation would need, so measuring redundancy prices the fix at the same time.

```
entries            : 34
work calls         : 34      (no guard refusals)
hashed inputs      : 34
DISTINCT inputs    :  4
REPEATS            : 30      => 88% redundant

repeat histogram
  19y27j9:2:1024x512   31     <- one input, re-classified 31 times
  1hhtzvp:2:1024x512    1
  1tzof24:3:1024x512    1
  ygyyit:1:1024x512     1
```

**A perfect cache removes 30 of 34 calls — 1.40 s of 1.59 s.** Sustained cost would fall from
~51 ms/s to roughly **6 ms/s**, about an 8.5x reduction, with no change to the classifier itself.

★ That is a bigger win than any algorithmic improvement to the chamfer/flood, and far easier to
prove correct: the 32-test mask suite already pins what the classifier must return, so a memoised
wrapper either returns the same verdict or fails those tests.

## ⚠️ 88% is the STATIONARY figure, not the general one

The viewport never moved. Under pan and zoom the input changes on most calls and the hit rate falls
— possibly to near zero. **The redundancy rate under interaction is UNMEASURED.**

What this does establish is that an idle or slowly-changing map — a user reading a forecast, which
is plausibly the dominant mode — pays ~51 ms/s to compute the same answer over and over. Whether
that holds while panning is a separate measurement, and it should be taken before sizing the win.
⛔ Do not quote "88%" as the expected saving. Quote it as the saving *on a static viewport*.

## Note on the instrument

Hashing 500k+ bytes per call costs ~5% of the 46.7 ms, so it is gated behind
`__RAW_MASK_INPUT_HASH__ === true` and is **off by default** — pinned by a test that also checks a
merely-truthy value (`1`) does not enable it. An instrument must not tax the product.

Also pinned: identical inputs collapse to one distinct key, different geometry produces different
keys (the hash discriminates), and a different `nPx` on identical pixels is a different key.
A redundancy counter that could not tell two inputs apart would report 100% and be believed.

---

# ⚠️ THE MOVING CASE — 96% static vs 32% panning, measured as a within-run control

Same session, same bundle, same backend, same product; 20 s per phase, the only difference being
whether the map moves. A within-run control because comparing two separate runs would confound the
difference with everything else that varies between runs.

```
A: STATIC viewport     calls=23   new-distinct= 1   repeats=22   redundancy=96%
B: PANNING + zooming   calls=41   new-distinct=28   repeats=13   redundancy=32%
                       (20 pan operations issued)
```

## Panning is worse on BOTH axes

| | calls / 20 s | redundancy | cost | after a perfect cache |
|---|---|---|---|---|
| static | 23 | **96%** | ~54 ms/s | **~2 ms/s** |
| panning | **41** | **32%** | **~96 ms/s** | ~65 ms/s |

Motion nearly **doubles the call rate** *and* collapses the hit rate. ★ **The cache helps most
exactly where it matters least.** Idle drops 27x; panning — when the user is most sensitive to
frame time — drops only 1.5x, and the residual ~65 ms/s is worse than the static case was before
any cache at all.

## What this changes

**Still do the cache.** It is cheap, safe against the existing 37-test suite, and removes 96% of
idle work — and an idle or slowly-changing map is plausibly the dominant mode for a forecast reader.
⛔ **But it does not solve the moving case, and the moving case is the expensive one.** Do not ship
the cache and call the mask problem closed.

The panning residual needs a different lever, and the measurement points at which:
- **28 new distinct inputs in 20 s of motion** means the classifier is re-deciding a genuinely new
  viewport roughly every 0.7 s. Classifying every intermediate frame of a continuous gesture is work
  the user never sees settle. **Debouncing classification to viewport-settle** — the pattern
  `useMarineScrubSettle.js` already establishes elsewhere in this codebase — would remove most of
  those 28 without touching the algorithm.
- Only after that is the chamfer/flood itself worth attacking.

⚠️ Both figures are single 20 s phases on one machine. The static number moved 88% -> 96% between
two runs, so treat these as ~90s and ~30s, not as three significant figures.
