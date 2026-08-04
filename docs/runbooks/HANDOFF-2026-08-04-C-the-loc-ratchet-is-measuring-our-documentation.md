# HANDOFF — 2026-08-04-C · THE LOC RATCHET REFACTOR
**For a fresh session. Everything below is measured. Read §0 and §2 before planning anything.**

---

## §0 THE ANSWER IN ONE LINE, AND IT IS NOT WHAT I TOLD THE OWNER

> **This is not "split two 800-line files". It is ~133 lines across 4 files, and only ONE of them
> needs structural work at all.**

I characterised this as a large, risky refactor in the marine regression graveyard. Measuring it says
otherwise. Correcting that is the first thing this handoff owes you.

| file | now | needs | why it is that small |
|---|---|---|---|
| `WebGLMarineLayer.js` | 1233 | **−11** | GRANDFATHERED — must only return to its own baseline (1221), not to 800 |
| `useMarineDataFetcherCore.js` | 979 | **−12** | GRANDFATHERED — baseline 966 |
| `backendWeatherServiceClientHelpers.js` | 817 | **−17** | NEW file, so the bar is 800. It is 17 over, not 800 over |
| `marineGridSeries.js` | 893 | **−93** | NEW file. **The only one needing real structure** |

Ratchet rule (`scripts/loc_ratchet.py`): *a file NOT in the baseline may never exceed 800; a file IN
the baseline may never exceed **its own recorded count**.* That second clause is what makes two of
these trivial — I had been reading them as "1233-line file must become 800", which is false.

---

## §1 ⭐⭐⭐ THE FORENSIC FINDING: THE GATE IS MEASURING OUR DOCUMENTATION

`count_lines()` is raw `wc -l`. Every comment and blank counts. Composition, measured:

| file | total | blank | comment | **code** | comment % | code vs 800 |
|---|---|---|---|---|---|---|
| `marineGridSeries.js` | 893 | 31 | **358** | **504** | **40 %** | UNDER |
| `backendWeatherServiceClientHelpers.js` | 817 | 75 | 94 | **648** | 12 % | UNDER |
| `WebGLMarineLayer.js` | 1233 | 88 | 267 | **878** | 22 % | over |
| `useMarineDataFetcherCore.js` | 979 | 41 | 208 | **730** | 21 % | UNDER |

**Three of the four are under 800 in CODE.** `marineGridSeries` is 40 % comment — its actual logic is
504 lines.

And the regressions are almost pure rationale. Both are single commits, pure additions, zero deletions:

* `WebGLMarineLayer.js` +11 (`499256f1`) = **10 comment lines + 1 code line**
  (`upstreamProvider: grid?.__upstreamProvider || null,`)
* `useMarineDataFetcherCore.js` +12 (`02499122`) = **10 comment lines + 2 code lines**
  (an import and a `ringReaderTick(...)` call). ⚠️ **That one is MINE**, from the ring-reader wiring.

★★ **So the thing tripping this repo's size gate is the practice that makes this repo safe** — the
recorded landmines, the measured numbers, the "this was tried and it failed" notes. That is a real
tension and it deserves a decision (§5), not a quiet round of comment-deletion.

---

## §2 ⚠️ A THIRD VIOLATION EXISTED AND IT WAS MINE — ALREADY FIXED

The gate reported **3** new violations, not the 2 I kept calling pre-existing:

    WebGLMarineTextureEncoder.js   796 → 802 (my commit 6a66859a)  → 799 (fixed, 58c6e3c5)

I had truthfully measured "all frontend, all unmodified in this tree" — and then edited one of those
files later in the same session and never re-measured. ★ **A pre-existing failure is not a licence to
stop looking: once a gate is red for someone else's reason, your own contribution to it is invisible
unless you re-run it.** Fixed by recovering 3 lines from *my own* comments, not from code and not
from anyone else's work.

---

## §3 THE SAFETY NET — BETTER THAN I FEARED

I called this "the marine regression graveyard" and implied a refactor would be dangerous. The file
that needs the most work has the **best** coverage in the area:

    marineGridSeries.js   5 DEDICATED suites: .antimeridian .coverage .globalPrewarm .leak .retry
    backendWeatherServiceClientHelpers.js   1 suite: .dirConfidence

**MEASURED BASELINE — keep this green:**

```
npx craco test --testPathPattern "marineGridSeries|marineController|backendWeatherServiceClientHelpers|useMarineScrubSettle" --watchAll=false
→ 15 suites, 120 tests, ALL PASSING
```

Consumers (blast radius for import updates):
* `marineGridSeries` → 14 files (9 source + 5 of its own tests), incl. `marineController`,
  `useMarineDataFetcherCore`, `useMarineOrchestrator*`, `useMarineScrubSettle`, `windGridSeries`
* `backendWeatherServiceClientHelpers` → 3 (`backendWeatherServiceClient`,
  `backendWeatherServiceClientPoint`, 1 test)

---

## §4 THE PLAN, IN JACOBIAN ORDER (cheapest certainty first)

### 1. `marineGridSeries.js` −93 — THE ONLY STRUCTURAL ONE, and the seam is already measured
A cohesive, stateless block extracts cleanly:

    lines 233–300   "THE REQUEST BOX" — SERIES_BBOX_PAD_DEG, padRegionalBbox,
                    GLOBAL_REQUEST_BBOX, normalizeRequestBbox        = 68 lines
    lines 744–772   bboxContains                                     = 29 lines
                                                              TOTAL  = 97 lines

**893 − 97 = 796.** Under the limit with 4 lines of headroom, in one move, with no logic changed.
These are pure bbox geometry — no state, no I/O — so a new `marineBboxGeometry.js` is a mechanical
move plus import updates in the consumers above. `.antimeridian` and `.coverage` already exercise
them; point those suites at the new module and the safety net comes with you.

⛔ **DO NOT also "tidy" the rest of the file while you are in there.** The whole point of a ratchet is
that one change is attributable.

### 2. `backendWeatherServiceClientHelpers.js` −17
648 code / 94 comment. Smallest real decision: either extract one small helper group, or recover 17
lines of genuine redundancy. Do NOT strip rationale to hit a number — see §5.

### 3 & 4. The two grandfathered regressions, −11 and −12
Both are ONE commit each, pure addition, and the added lines are ~90 % comment. Recommended: move the
long-form rationale into a doc and leave a one-line pointer (§5). `useMarineDataFetcherCore` is mine —
its 10-line comment about the ring reader's call site compresses to 2 without losing the warning.

---

## §5 ⭐ THE DECISION THIS WORK SHOULD SURFACE (owner's call, not the fresh session's)

Four ways to satisfy the gate, in ascending order of honesty:

| option | cost |
|---|---|
| **(a) Delete/compress comments** | Cheapest, and it burns the asset. This repo's rationale is *why* defects stop recurring |
| **(b) Move long-form rationale to `docs/`, leave a one-line pointer** | Preserves it, satisfies the gate, matches existing practice (`docs/research`, `docs/runbooks` are already exactly this) |
| **(c) Structural split** | Right when there is a real seam — which there is for `marineGridSeries`, and is not obviously true elsewhere |
| **(d) Count CODE lines, not raw lines, in the ratchet** | Changes governance. Would make 3 of these 4 files compliant instantly, because they already are in code |

**Recommendation: (c) for `marineGridSeries` (the seam is real and measured), (b) for the rest, and
put (d) to the owner.** A gate that penalises the documentation practice will keep producing this
work forever, and every future session will face the same temptation to solve it with (a).

---

## §6 LANDMINES FOR THIS SPECIFIC JOB

* ⛔⛔ **NEVER run `loc_ratchet.py --update-baseline`** to make this green. Standing rule; it converts
  a debt into a permanent allowance.
* ⚠️ **Stage by path.** A concurrent session shares this tree — `backend/scripts/geometry_backfill.{json,sql}`
  are currently untracked and are NOT ours.
* ⚠️ **`npx jest` cannot parse this project** (no babel transform). Use `npx craco test`.
* ⚠️ The ESLint ratchet is a SEPARATE gate and is currently **green** (154 errors / 150 warnings,
  exit 0). Do not let a refactor regress it; re-run `node scripts/check_eslint.js`.
* ⚠️ **PowerShell's `Measure-Object -Line` undercounts** vs `wc -l` (it read 751 where `wc` read 799).
  The ratchet uses `wc -l` semantics — measure with `wc -l` or the ratchet itself, never PowerShell.
* ⚠️ Marine render/mask/scrub code is a genuine regression graveyard with five recorded false fixes.
  The extraction in §4.1 is a *move*, not a behaviour change — keep it that way, and if anything
  starts looking like a logic edit, stop and split the commit.

---

## §7 WHAT "DONE" LOOKS LIKE

```
python scripts/loc_ratchet.py            → exit 0
npx craco test --testPathPattern "marineGridSeries|marineController|backendWeatherServiceClientHelpers|useMarineScrubSettle" --watchAll=false
                                         → 15 suites / 120 tests, still green
node scripts/check_eslint.js             → exit 0, still 154/150 or better
```
Then the loc-check job goes green, which unblocks **queue #5 — promoting `dev` → `main`**. Production
is ~115 commits and 2+ days behind, and that promotion is the OWNER'S action (standing order:
dev-only, NO main pushes).
