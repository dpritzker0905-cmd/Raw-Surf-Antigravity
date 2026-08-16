# C4-MR-09 — antimeridian coverage and disposal semantics

**Fixed 2026-08-16.** Two defects of the same family: *state that outlives, or arithmetic that
overreaches, the domain it was written for.* Rationale lives here because
`WebGLMarineEngine.js` is at its LOC ratchet (3207/3207) and the fix had to be net-zero lines.

---

## 1. `resolveDeliveredCoverage` was wrap-naive — and it failed in the UNSAFE direction

### The code

```js
const deliveredShort = !disabled && !!cachedBounds && !!curView && !(
  cachedBounds.west <= curView.west && cachedBounds.east >= curView.east
  && cachedBounds.south <= curView.south && cachedBounds.north >= curView.north);
```

Plain numeric containment. `curView` is built from `mapInstance.getBounds()` —
`b.getWest()` / `b.getEast()` — and those return **`west > east` when the viewport crosses 180°**.

### Why that is worse than a missing feature

For a wrapped viewport `{west: 175, east: -175}` against a whole-world cache
`{west: -180, east: 180}`:

```
-180 <= 175   ✓
 180 >= -175  ✓
 south/north  ✓
⇒ naive containment says COVERED ⇒ deliveredShort = false ⇒ the repaint is SKIPPED
```

The function's own header states its safety direction explicitly:

> *"Unknown delivery is NOT treated as short: this may only ADD repaints in the proven-bad case,
> never remove a skip the old code granted on information we do not have."*

The wrap case does the **opposite**: it *removes* a repaint, on information the code does not have.
So this is not merely "antimeridian unsupported" — it is a silent violation of the invariant the
function documents about itself, in the one geography where nobody looks.

### Three facts that make it real rather than theoretical

1. `curView` genuinely comes from `getBounds()`, which wraps.
2. The engine **already carries the idiom** for exactly this, ~2300 lines earlier:
   `_vbEast < _vbWest  // viewport crosses the antimeridian`.
3. This engine has been bitten here before. Its own comment records the 2026-07 wrap conditions
   being dead code — *"every comparison against undefined is false … ALL THREE antimeridian
   conditions were DEAD CODE"* — and the symptom was **half the field blanked**.

### The fix: refuse, do not reason

A wrapped box on **either** side is never a skip. We do not attempt wrap-aware containment, because
the safe answer is available for free: cost a repaint rather than grant a skip on a box we cannot
reason about. Net **zero** lines (`3207/3207` held), rationale moved here.

## 2. `disposeEngine` left the truth box behind — hygiene, not a live bug

`WebGLMarineEngineInit.js` nulled `_overlayMaskTex` and `_overlayMaskBounds` but **not**
`_overlayMaskTruthBox`, so the truth rectangle outlived its own bounds.

**Stated honestly: this is not currently reachable.** The render path needs
`_overlayMaskTex && _overlayMaskBounds` for `overlayOn`, both are nulled, and the uniform site
independently re-checks `ob === this._overlayMaskBounds` before passing the box. Two guards, both
holding today.

It is still worth one line, because **this exact inventory has been wrong twice in production**:

| omission | consequence | found |
|---|---|---|
| `_residentScoreTex` (R11-10b) | one grid-sized texture leaked **per dispose cycle** in rating mode, stale handle into the next context | production |
| raw `gl.deleteTexture` (R11-10d) | bypassed the accounting choke; telemetry drifted upward every theme/style swap | production |
| `_overlayMaskTruthBox` (this) | field outlives its owner; guarded today | review |

Both previous omissions were found in production rather than review, because *"did dispose forget
something?"* was a question no test asked — **there was no `disposeEngine` test anywhere.**

## 3. What the tests pin

`WebGLMarineEngineInit.dispose.test.js` (new) pins the **inventory as a contract**, not my one
field: every resident/cached field nulled, the overlay **triple** nulled together, and bounds ↔
truth box asserted as a *pair* — either surviving alone is a half-state.

`WebGLMarineEngine.deliveredCoverage.test.js` (extended) adds the antimeridian cases.

## 4. ⚠️ My first draft of the wrap tests was two-thirds VACUOUS

The mutation run caught it: removing the wrap clause turned only **1 of 3** wrap tests red.

A wrap test only discriminates when **naive containment would have said COVERED** — otherwise it
passes with or without the fix. I had the cache *narrower* than the view, so naive containment
already reported "short" and two tests proved nothing:

```
WORLD(-180/180)      vs WRAP_VIEW(170/-170)   naive-covered=True   -> discriminates
WRAP_CACHE(175/-175) vs VIEW(-81/-79)         naive-covered=False  -> VACUOUS
WRAP_CACHE(175/-175) vs WRAP_VIEW(170/-170)   naive-covered=False  -> VACUOUS
```

Corrected by making the cache **wider** than the view (`170/-170` vs `175/-175`), and each test now
asserts `naive(cache, view) === true` **explicitly**, so a future edit that destroys the
discrimination fails loudly instead of silently. Re-mutated: **3 of 3** red.

★ **The reusable lesson:** for a containment fix, the test data must be chosen so the *old* code
gives the *wrong* answer. Data that fails both before and after proves only that the function runs.
Asserting the naive result inside the test is the cheap way to keep that property visible.

Also worth noting: a wrapped **cache** against an *unwrapped* view can never be naively-covered —
the arithmetic forbids it — so that case is inherently non-discriminating and is not claimed as
coverage.
