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
