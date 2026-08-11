# EXECUTIVE TRAJECTORY BRIEF — Audit 11.1

**2026-08-10 · branch `dev` · HEAD `8be9dd56` · baseline `c9a0e9fc` · 103 commits reviewed**

---

# ⚖️ ON TRACK WITH CORRECTIONS

The direction is right and it is producing results you can point at. One repair was declared
finished on a measurement that could not have shown otherwise, and that must be corrected before
more capacity work — not because the engineering was bad, but because the *check* was.

---

## In one paragraph

Since Report 11.0 the team shipped 103 commits and did not move a single forecast number — verified
by running the composition control at the baseline commit and at HEAD and diffing: bit-identical
across a 24× swell range. Eight of eighteen findings were materially repaired. Three instruments
built in the last 48 hours each caught a real defect they were built for, one of them catching its
own author's mistake within hours. Against that: the most celebrated fix of the window — the Render
OOM repair — **does not do what it was recorded as doing**, and this audit measured that three
separate ways with a controlled discriminator. A live API credential is still committed. And no CI
run has ever proven the marine field actually paints.

---

## What is genuinely better

| | |
|---|---|
| **The mixed-run detector works** | Shipped `7312412b`; a production response was caught carrying two model runs **7.8 hours apart** in one scrubbable page. Report 11.0 had this as an open question it could not observe. Now observed. |
| **The science did not drift** | 103 commits, four inside the physics chain, **zero** movement: `3.3/68.1 · 5.8/84.5 · 17.6/84.5 · 30.6/55.7 · 29.5/59.8`, identical at both commits. |
| **A 64.6-point release blocker closed** | And the green JS test that had been *defending* the bug was corrected too. |
| **The CI lane that protected nothing now protects 141 files** | It caught a real regression the same afternoon it landed. |
| **The E2E lane has an opinion again** | 26 of 40 runs were being cancelled by newer pushes. The first uncancelled run after the fix passed; the two docs commits after it correctly fired nothing. |
| **Latency roughly halved** | `grid_series` p90 32 s → 16 s; `/api/surf-spots` p50 26 s → 250 ms. |

---

## What must be corrected

### 1. The OOM fix bounds retention, not allocation — and the proof said otherwise

Recorded post-fix: **RSS delta +0.0 MB.** Measured at HEAD, three times, each against a plateau
verified flat first:

| replicate | baseline (verified flat) | **RSS Δ** | **peak Δ** |
|---|---|---:|---:|
| 4 h uptime | 1,563.6 MB (0.0 MB drift / 40 s) | **+156.7 MB** | +0.0 † |
| 12 m uptime | 1,418.4 MB (+1.0 MB drift / 213 s) | **+201.6 MB** | **+124.1 MB** |
| 3 m uptime | 677.3 MB (0.0 MB drift / 30 s) | **+812.8 MB** | **+800.2 MB** |

† A high-water mark cannot rise past itself — that process's peak already stood 174 MB above the
post-request RSS.

**The control that settles it:** the same request over a *small* bounding box — identical hour list,
identical code path, only fewer cells — costs **+5.7 MB**. The global one costs **+812.8 MB**.
**142× the memory for 5.9× the cells.** It is the request.

**Why the original reading said zero:** it was taken on a box already sitting at its own high-water
mark, where a +157 MB transient is invisible by construction.

> **A delta measured against a saturated baseline reads zero by construction.**

**This is not a rollback.** The commit genuinely cut the wire 25 % and halved latency. It moved the
retention multiplier from ~40 grids to 5. It just did not close the OOM arithmetic: one client
settle (three pages) still consumes essentially the entire memory headroom, and live peak sits at
**84.9 % of the 2 GiB cap**.

### 2. A live credential is still committed

`BRAIN_RULES.md:200` still carries a Qdrant Cloud API key and its cluster endpoint. Flagged P1 in
Report 11.0. History retains it regardless of any future edit — **only provider-side rotation closes
this**, and only you can do it.

### 3. The accuracy gate is green about the wrong population

Paired, at HEAD, against real buoys:

| comparison | n | ours | theirs | verdict |
|---|---:|---:|---:|---|
| vs **Open-Meteo** +24 h | 790 | 0.201 | **0.151** | **we lose (win rate 39 %)** |
| vs **Open-Meteo** +72 h | 714 | 0.245 | **0.164** | **we lose (37 %)** |
| vs our own **EURO** lane | 658 | 0.185 | **0.172** | **we lose (47 %)** |
| vs persistence | 530 | **0.181** | 0.199 | we win (51 %) |

The gate reads `MAE 0.152 m` against `warn 0.30` and passes comfortably. **A free competitor beats
the product's own lane at every horizon and the gate cannot say so.**

*Good news buried in there:* the recent audit's alarming headline — *"the forecast is losing to
persistence, contributing negative skill"* — is **wrong**. It compared two columns computed over
different buoy populations. On the matched population we win. The fix for that comparison error
shipped one commit later and was simply never applied back to that row.

---

## The three things worth doing next, in order

1. **Write the test that measures what a global request costs, and watch it fail.** No production
   code. It is what was missing when "+0.0 MB" was accepted, and it makes every later capacity claim
   provable. *(Full packet written.)*
2. **Then** bound the request at resolution rather than after the fact.
3. **Add "worse than a free competitor" to what the accuracy gate can fail on** — before any further
   forecast tuning, because that gate will be grading it.

---

## Two one-clicks that are yours alone, and both are overdue

1. **Rotate the Qdrant credential** — provider-side.
2. **Set four Render env vars** — `MALLOC_ARENA_MAX=2`, `MALLOC_TRIM_THRESHOLD_=67108864`,
   `PREFETCH_MAX=120`, `PREFETCH_CONCURRENCY=2`. Prescribed on 2026-08-03. **Seven days, seven OOM
   events, still not set.** `PREFETCH_CONCURRENCY` is the literal multiplier in the OOM fix's own
   *"CONCURRENCY full grids"* — so part of finding #1's severity is bounded by a setting no engineer
   can change.

Also awaiting you: a decision on each of the four dark flags shipped 08-10 (each changes a number a
user reads), including one — `__RAW_LAYER_CAP_ALIAS__` — where the app currently offers a **14-day**
scrubber for a layer whose model supports **7**.

---

## What this audit could not check

Anything involving motion. The browser pane runs hidden, which suspends animation frames entirely —
**0 frames in 1.5 seconds, measured.** An animation test run there measures the browser, not the app,
so no claim is made about animation continuity, frame rate, particle behaviour or the geographic
projection sweep. Also unverified: whether the box is still being OOM-killed (needs a Render API
call you'd have to authorize).

*Update after this brief was first written:* the backend guard lane finished — **1,620 passed,
66 skipped, 0 failed** across all 141 files. Together with the frontend's 1,949/1,949 and green CI,
both suites are independently confirmed clean at the audited commit.

---

## Bottom line

**Two of six release gates are failed — regression protection and capacity — and both fail for the
same reason: a repair without an oracle.** Nothing needs rolling back, nothing is going in the wrong
direction, and the forecast itself is provably untouched. Fix the check, then finish the fix.
