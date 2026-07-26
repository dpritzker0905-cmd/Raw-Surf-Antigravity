# DEBT-CACHE-03 — the z6 global resident: **the stated root is DISPROVEN**, corrected root inside

**STATUS: symptom REPRODUCED live at HEAD `2dc12a9a` (3/3 runs). NOT fixed. The published cause is
wrong — do not implement the proposed fix, it is already in and it does not solve this.**

## 1. What every existing note says (and why it is wrong)

Both sources say the same thing:

- `HANDOFF-2026-07-24-...-marine-regression-dive.md` §(B): *"`getModelSafeMarine`'s containment
  fallback is **missing the `gwid >= 340` global-skip guard** … Proposed kill:
  `__RAW_DISABLE_SAFECACHE_GLOBAL_SKIP__`"*
- Antigravity's 07-24 debt bank, DEBT-CACHE-03: *"lacks `gwid >= 340` global-skip check … Mitigation:
  Add `__RAW_DISABLE_SAFECACHE_GLOBAL_SKIP__` guard rail."*

**That guard has existed since `82bd76b3` (Codex, 2026-07-25)** — `marineController.js:370`, with the
exact `__RAW_DISABLE_SAFECACHE_GLOBAL_SKIP__` kill switch, plus
`marineGlobalCoarseCooldown.test.js` covering both directions. It is real, it is tested, it works.

**And the symptom persists anyway.** So the guard was never the cause. Two tools independently wrote
down a root that a live run disproves in 30 seconds — this is the cross-tool fragmentation problem in
miniature: Codex fixed the named thing on 07-25 and neither the handoff nor the debt bank knew.

## 2. Live reproduction (HEAD `2dc12a9a`, 3/3 runs)

```
AC_BASE=http://localhost:3001 AC_MODEL=EURO AC_ZOOM=6.0 AC_CENTER=-80.2,28.4 \
  node scripts/activationlab.js scripts/ac-z6-1
```
```
resident: 181x83  bounds {"west":-180,"south":-80,"east":180,"north":84}   <- all 3 runs
```

Contrast at **z8.5**, same centre/model: `resident: 21x21 bounds {-84,26,-79,31}` — correct regional.
So this is zoom-dependent, and z6 is on the wrong side of the line.

## 3. THE CORRECTED ROOT (Jacobian: which grid is the only committable payload at z6)

The z6 network timeline is the whole story:

| t | event | size |
|---|---|---|
| 662 ms | `grid_series` bbox=**viewport** `-86.63,23.97,-73.77,32.69` hours=0 | req |
| 2666 ms | ↳ response | **4 KB** |
| 2995 ms | `grid` bbox=**-180,-80,180,85** (the world prewarm) | req |
| 4973 ms | ↳ response | **229 KB** |
| **6335 ms** | **`_waveData` COMMITTED → 181×83 global** | |
| 7229 ms | `grid_series` multi-hour response | 44 KB |

**At z6 there is NO regional `/grid` request at all.** At z8.5 there is
(`bbox=-83,26,-79,30.75`, 7 KB). So at z6 the only full-grid payload in existence is the world
prewarm's, and that is what gets committed — proven by elimination: it is the sole 229 KB `/grid`
response and the resident is exactly its 181×83 shape.

The safe-cache guard cannot help here: nothing is asking the cache for a regional grid and being
handed a global one. **The global arrives on its own fetch path and is committed because it is the
only candidate.**

## 4. Why this matters

15,023 vectors + a 4096×2048 mask uploaded per commit, where a ~7×5 clip of the same 2° field would
cover a 12.9° viewport. It is also ~1.4 s of the z6 activation (commit at 6335 ms lands right after
the 229 KB world response at 4973 ms, while the 4 KB viewport series arrived at 2666 ms).

## 5. What I did NOT do, deliberately

The 07-24 handoff's own words: **"This is a fetch/coverage change — do not rush it."** Correct. The
fix is either (a) clip the global to the viewport before commit, or (b) make the viewport
`grid_series` frame the commit candidate at z6 so the world stays a bridge base only — both are
commit-path changes in the documented regression graveyard. That needs its own session with a
kill switch and a z5/z6/z7/z8 A/B, not a tired end-of-session patch.

## 6. What IS verified and shipped

- `2dc12a9a` — pins that the MAR-01 world alias (`dbc49ea0`) did **not** hole the close-zoom guard.
  The pre-existing DEBT-CACHE-03 tests seed the cache directly and never exercised the real write
  path, so this needed proving rather than reasoning. 5/5.
- MAR-01's **first** half is done and A/B-proven (`dbc49ea0` + `b8114048`): duplicate world fetch
  2→1, activation 5122→4359 ms, disjoint distributions.

## 7. For whoever picks this up

- Repro is 3 lines (§2). It is deterministic — 3/3.
- **Do not** re-add the global-skip guard. It is in, tested, and irrelevant to this.
- Start from §3: the question is *why z6 issues no regional `/grid`* while z8.5 does. Look at the
  span thresholds that choose `grid_series`-only vs `grid`, and at what the commit path accepts as a
  candidate.
- ⚠️ ONE headless browser at a time. Count world requests INSIDE the `marine grid REQUESTS` block —
  the report prints the same bbox again under RESPONSES and a naive `awk` reports double.
