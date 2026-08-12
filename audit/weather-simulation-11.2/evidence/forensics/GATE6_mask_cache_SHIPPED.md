# Verdict cache — measured against its own kill switch

A/B in one session per arm, same bundle, same backend, same product; the only difference is
`__RAW_DISABLE_SHELTER_CACHE__`. 20 s per phase.

```
CACHE ON      static    work=24  hit=21  miss= 3   hitrate=88%   classifier avoided ~0.59 s
              panning   work=38  hit= 8  miss=30   hitrate=21%   classifier avoided ~0.22 s

CACHE OFF     static    work=23  hit= 0  miss=23   hitrate= 0%
(kill switch) panning   work=31  hit= 0  miss=31   hitrate= 0%
```

The control arm at 0% is what makes the ON arm readable: the kill switch demonstrably disables the
thing being measured.

## ⛔ CORRECTION to my own projection

I published *"a perfect cache would remove 30 of 34 calls = 1.40 s of 1.59 s"*. **Wrong twice over.**

1. **A hit does not skip the call.** The downsample (11.7 ms) and readback (4.5 ms) must still run to
   produce the pixels the key is computed FROM, and the stamp still has to paint. A hit skips the
   classifier and the close — **~28 ms of 46.7 ms, about 60%**, not 100%.
2. **The hit rate is capped by the LRU.** Redundancy measured 96% static / 32% panning with unbounded
   key tracking; the shipped cache holds 4 entries and captures **88% / 21%**. Panning generates ~28
   distinct inputs in 20 s, so entries evict before they can be re-hit.

**Actual saving: ~53% of mask cost when static, ~12% when panning.** Worth having — idle is
plausibly the dominant mode — but a third of what my headline number implied.
★ **A cache saves the stage it replaces, not the call it sits in.**

## The cap is a real trade, not an oversight

Each entry is a `Uint8Array` of dsW×dsH — **512 KB** at the 1024×512 tier. Cap 4 ≈ 2 MB. Raising it
to 16 (≈8 MB) would recover some of the 96%/32% ceiling, but this subsystem already has a documented
Render OOM history and the panning gain would still be bounded by 32%. Left at 4 deliberately;
raising it is a measurable, reversible experiment, not a fix.

## What is guarded

Six cache tests, three mutation arms, each failing tests that name the risk:

| mutation | fails |
|---|---|
| drop `nPx` from the key (collision across `gapM`) | 1 |
| lookup ignores the key (serves the first entry) | 2 |
| kill switch ignored | 1 |

The correctness property under test is **not** "it is fast" — it is that a HIT is indistinguishable
from a MISS: byte-identical stamped pixels, identical verdict fields, and the cached mask being
POST-close so a hit cannot leak an unclosed mask. Everything else about the cache is detail; that is
the part that could ship a bug.

## Still open

Panning remains **~85 ms/s** after the cache — worse than static was before it. That needs the
debounce-to-settle lever, not a bigger cache: 28 new distinct inputs in 20 s of motion is the
classifier re-deciding viewports the user never sees settle.

---

# ⛔ MY CACHE PROOF WAS A TAUTOLOGY — caught by audit 11.4, not by me

The headline test, *"a HIT produces byte-identical stamped pixels to the MISS before it"*, compared
one canvas **with itself**.

`created` accumulates across `run()` calls but is reset per TEST, so `return { ds: created[0] }`
handed back the FIRST run's downsample canvas for every later run in the same test. Both sides of my
pixel comparison were the same object. Audit 11.4 found it and fixed it to `created[before]` —
capture the index THIS call will write to.

**A verdict cache returning an all-zero, an all-one, or a fully INVERTED mask on every hit passed
all 32 tests.** That is not a weak assertion. It is an assertion that cannot fail — the exact defect
class this entire session was about, shipped by the person cataloguing it.

## The code was right; the proof was not

Re-run against the FIXED harness, the same three corruptions now fail 2 tests each:

| mutant | broken harness | fixed harness |
|---|---|---|
| hit returns all-zero mask | **passed 32/32** | fails 2 |
| hit returns inverted mask | **passed 32/32** | fails 2 |
| hit returns all-one mask | **passed 32/32** | fails 2 |

And the shipped cache still passes 43/43 with a harness that can now fail. **The cache in
`e6033e2b` is correct** — that is now established rather than assumed.

## The lesson is narrower and worse than "test your tests"

Every mutation arm I ran on this cache (drop `nPx`, blind lookup, ignored kill switch) DID fail
tests — so mutation testing did not save me. Those three mutants happened to break paths the
tautological assertion did not cover, which made the harness look sound.
★ **A mutation arm proves the mutant is caught. It says nothing about the assertions it did not
touch.** Coverage of mutants is not coverage of assertions, and a fixture that returns the wrong
object will pass every mutant that does not depend on that object.
