# HANDOFF 2026-08-03 — the CONSUMER shipped, and what it changes about the queue

**Range:** `d0bfb7ef → 96dc9165` (8 commits, all pushed to `dev`).
**Read first:** `standing-work-rules-user-mandate.md` · `THE-SOTA-LEDGER-…` ·
`reading-the-marine-diagnostic-rings-2026-08-03.md` (⛔ **before touching any ring**).

---

## §0 THE ONE-LINE STATE

The latency root is fixed and live. The rating now names its own binding constraint. **The ring
reader exists and reproduces this session's five findings from the recorded evidence.** The heatmap
thrash is reproducible and attributed to a *class* but **not fixed** — and the three obvious suspects
are all struck by measurement.

---

## §1 WHAT SHIPPED

| commit | what | verified by |
|---|---|---|
| `1f5a796f` | antimeridian normalisation · `bboxContains` crossing · series **vector budget** | 20k-input differential vs HEAD = 0 diffs; 4/4 mutations |
| `6da4c16e` | `rating_factors` + `limiter` — the score names its binding factor | 20k differential = 0 diffs; 5/5 mutations |
| `b059ddf1` | **removed my own `coverage` field** — falsified within the hour by its own probe | live control |
| `05c1956a` `18ffbb2e` `7268dcfd` | the thrash forensics | live capture, owner-driven |
| `52b27146` | **`Date.now()` in a dedup key** → per-frame diagnostic | 3/3 mutations |
| `58e62525` | corrected §6 in place (rule 20) | — |
| `96dc9165` | **the ring reader** | **9/9 mutations**; BEFORE/AFTER fixtures |

**Live proof, one command:** `python3 scripts/verify_v7_deploy.py` — currently **4 pass / 0 fail /
2 skip**. The two skips are `D3 precompute` (cron, hours) and the `limiter` histogram that depends
on it. That histogram is the **single highest-value unread number in the system.**

---

## §2 THE JACOBIAN — what actually moves the product, measured

| rank | variable | measured sensitivity | uncertainty | status |
|---|---|---|---|---|
| **1** | **rating dynamic range** | live max **68.8**, zero `good`; invisible factors remove a **median 31.4 pts** (max 85.2); **44/199** spots would be `good` and are not | **low** — served payload, n=199 | **blocked on the `limiter` histogram** |
| **2** | geometry readiness | shore normal is **7.4/28.1** of the Jacobian; **38%** of served spots DEGRADED | low | open, prerequisite |
| **3** | miss-path cost | a MISS was **13–43 MB / 18–35 s** vs a HIT's 1.3–3 MB / 2–4 s | none | **FIXED**, live |
| **4** | ensemble (`ifs/waef`) | 50 members, free, on an endpoint already fetched | **high** — decoded values retracted once | open |
| **5** | commit thrash | zero-cell fraction swings **6.7% → 55.9%**; `maxH` **1.72 → 3.02 m** same place/hour | **high** — 3 suspects struck | open, attributed to a class only |
| **6** | skill score vs instruments | **does not exist** | — | open; **makes every row above uncheckable** |

**Rows 1 and 6 are the SOTA pair.** Row 1 is the product proposition; row 6 is the only thing that
makes "better" falsifiable. Everything else is throughput.

---

## §3 THE CONSUMER — what it is and how to use it

`frontend/src/components/map/marineRingReader.js`. **A verdict engine, not a dashboard.**

```js
import { reportRings } from './marineRingReader';
reportRings(window);      // -> { verdicts: [...], summary: { pass, fail, skip, failures } }
```

Five check classes, **each derived from a defect measured this session**: C1 cardinality collapse ·
C2 cross-instrument disagreement · C3 zero-variance field · C4 poisoned identity key · C5 named
invariants. Every check **refuses** (`skip`) when its precondition is unmet, and reports **the
number**, never a colour.

**The validation that matters** — and the pattern to copy for the next consumer: it is fed the
**verbatim pre-fix captures** and must independently reproduce the findings.
`BEFORE → exactly 5 failures. AFTER → 0.` A check that fires on both is worthless, so every BEFORE
has its AFTER.

⛔ **Before extending it, read `reading-the-marine-diagnostic-rings-2026-08-03`.** It records three
facts nothing in the repo documents, and all three changed this design:
- **Two opposite insertion orders coexist.** `slice(-N)` reads the *evicted-survivor end* of half the
  rings. Encoded as `RING_DIRECTION` + `recentFrom`, which **refuses on an unknown ring**.
- **`counts` survives eviction; `log` does not.** Churn is read from `counts`, never `log.length`.
- **`__RAW_FORENSIC__.summary()` counts by looping the ring** ⇒ silent undercount once saturated.
  C1 reports `countsAreFloor` at cap, and flags at **50%** that other types are already undercounts.

---

## §4 THE QUEUE — ordered, with what is known and what is not

### Tier 1 — ready, evidence in hand
1. **`limiter` histogram** *(zero work, wait for cron)*. `verify_v7_deploy.py` reports it. It decides
   Tier-3 #9: `size_gate` ⇒ the local size curve · `swell_exposure` ⇒ **geometry, not the rating** ·
   `tide_fit`/`sea_clean` ⇒ a different story. **Do not tune anything before reading it.**
2. **Wire the ring reader into a lane.** It is shipped but nothing calls it. A dev-overlay button and
   a line in `verify_v7_deploy.py`'s output are both ~10 lines. *An unread consumer is the disease.*
3. **`clamp_resharpen`** — **19 of 34 detaches (56%)**, named by `__MARINE_CHURN__`. The one committer
   worth reading. Medium risk: it is the commit path.

### Tier 2 — measured, not diagnosed
4. **Mask rebuild thrash** — 20 rebuilds alternating `2048×1024 ↔ 4096×2048`, the alternation the
   encoder's own comment names as a land-halo suspect. **High risk: five recorded false fixes here.**
   Needs eyes on the map.
5. **Flavor cache 63% miss** — `flavor_fastpath_miss` 31 vs `flavor_cache_fastpath` 18. Untouched.
6. **`is_dynamic_viewport_product` threading** (`viewport_helper.py:427`) — the *real* hit/miss signal,
   replacing the `coverage` field I had to delete.
7. **The bbox inflation rule** — requested `[-125,0,-45,60]` served `[-136,-12,-34,72]`.
   `get_snapped_bbox` cannot produce that; a second widening step exists and was never found.
8. **Behavioural proof of the antimeridian fix** — needs a browser doing the rapid world zoom-out.
   Code is deployed (`BUILD_VERSION` ≥ `1f5a796f`); behaviour unverified.

### Tier 3 — the ledger
9. Rating dynamic range *(blocked on #1)* · 10. Geometry readiness · 11. **Skill score vs
instruments** · 12. The 50-member ensemble · 13. v5 **F7** (Kr must A/B against
`_height_exposure_factor`'s **0.595–1.0, not 1.0**) and **F8** (`ECMWF_PERIOD_BANDS` absent from the
lane running 2 of 3 EURO fetches).

### ⛔ STRUCK — do not re-propose without new evidence
- ~~A/B the commit arbiter~~ — **`arb_shadow_diverge: 0`**. It would decide identically. *(Not
  evidence it is safe to adopt — only that it is not a fix for this.)*
- ~~react-scan / re-render storm~~ — `reactRerenderCounter: 0`.
- ~~the no-downgrade guard as the thrash cause~~ — fired on **3 of 32 commits**.
- ~~`coverage: hit|miss` from bounds~~ — the true MISS inflated **less** than the true HITs.
- ~~`CAP_UNCONFIRMED` as why the app can't say `good`~~ — **0 of 200** spots capped.

---

## §5 THE PROCESS FINDING — read this before trusting a claim

**I made six wrong claims in this session and measurement caught all six**: the encode attribution,
`encodeDupCount` being blind, "the guard never fired", the bounds-based `coverage` rule, the
arbiter's production wiring, and my own clock detector — which was `/\b\d{10,13}\b/` and **could not
match the key that motivated it**, because `_` is a word character.

That rate is the signal, not an embarrassment. It is what happens when a heavily-instrumented system
has **no consumer**: plausible attributions survive until someone reads a ring. Three lessons now in
the standing rules:

- **An event name is not a call site.** Grep the emitter before attributing cost to a function.
- **Sample state for levels; read the event ring for occurrences.** Never infer *never* from a sampler.
- **A detector must be tested against the artifact that motivated it**, not a synthetic one.

⚠️ **`surf_rating.py` is at 760 LOC against an 800 ceiling.** The next substantial rating change
forces a split; doing it under pressure is how composition defects get in.
