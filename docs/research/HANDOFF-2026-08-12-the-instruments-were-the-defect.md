# Handoff 2026-08-12 — the instruments were the defect, four times

Supersedes the status lines in `HANDOFF-2026-08-11`. Everything of mine is pushed; nothing is
uncommitted on my side. Tip at writing: `b5632fc7`. Backend CI **20 pass / 0 fail**; `e2e` red for
environmental reasons documented below.

---

## ⭐ THE HEADLINE — `SURF_TIDE_DEPTH`, SIX samples — and the flag now has evidence, not a guess

| # | window | replayable | moved | max abs delta | tail rows |
|---|---|---|---|---|---|
| 1 | 08-09, 3 h | 486 | 0 | 0.2 | none |
| 2 | 08-11, 5 h | 496 | **8** | **3.2** | none |
| 3 | 08-12, 12 h span / **5 distinct served frames** | 123 | 0 | 0.2 | none |
| 4 | 08-12, 1 live frame | 15 | 0 | 0.2 | **4, to 3.22 m** |
| **5** | 08-12, 1 **precomputed** frame | 17 | 0 | **0.1** | **7, to 3.71 m** |
| **6** | 08-12, **14 h span / 5 served frames** | **127** (1 disq.) | **0** | 0.2 | **44** |

**Sample 3 retired the tide-PHASE hypothesis** — it covered a measured 2.4–3.1 m tidal swing and
moved nothing. **Sample 4 is the first observation of the depth-limited regime ever taken** and
shows the same smallness.

⚠️ **SAMPLE 2 IS NOW UNEXPLAINED BY EITHER HYPOTHESIS.** Phase is dead (3), size is not supported by 4, 5 OR 6
. I do not have a third explanation and did not invent one. **Five of six** samples say the term
is user-invisible; the outlier survived both stories I had for it.

✅ **SAMPLE 5 IS DONE (see the table).** The trigger below fired within the hour and the sample ran on PRECOMPUTED tail rows to 3.71 m: 17 replayable, 0 disqualified, 0 level changes, max |delta| **0.1**. ⭐ **The clock ended itself because it named the observation that ends it** — unlike the false blocker it replaced. ⚠️ Sample 2 now stands ALONE against FIVE nulls, three of which cover the depth-limited regime that was its last available explanation. Every hypothesis proposed for it has been tested and failed. I am NOT calling it noise: 8 rows moving 3.2 points is a real observation from a real instrument, and "outlier explained by something unmeasured" is not distinguishable from "outlier that was always noise" on the evidence I have. What changed is the BURDEN. ▶ **Original next step, now satisfied: sample 5, once the precompute writes tail rows.** Unlike the false blocker I wrote
yesterday, this clock names the observation that ends it:
**`rows >= 2.5 m carrying inputs > 0` on a `source: precomputed` frame.**
Then `--frames-file` a production frame and read the **DEPENDENCY** line, never the headline.

---

## ✅ SHIPPED (all pushed, all verified before and after)

- **Tail sampling** (`b5632fc7`) — big surf now sampled UNCONDITIONALLY on top of the uniform 5%
  draw. `SPOT_RATINGS_INPUTS_TAIL_M` default 2.5 m. **Verified live in production:** rows >= 2.5 m
  carrying inputs went **0 of 7 → 4 of 4**; max sampled height **1.93 → 3.22 m**; payload +~0.6%.
- **Three coverage disclosures** in `science_shadow_ab.py`, none able to see the others' failure:
  `! SPAN UNKNOWN` (2323874a), `! REPEATED FRAMES` (70fa7144), plus the tail fix above.
- **The floor-provenance trap fixed at the CLASS level** (d4c4f5d3) — the staleness prescription
  now names BOTH edit sites, the file, the key and the value.
- **CI floors** carried forward correctly: guards 1685→1695→1699, estate `_FLOOR_SET_FROM`→349.

## ⛔ STILL DARK / OWNER-GATED (unchanged from 08-11)

`__RAW_LAYER_CAP_ALIAS__` · `__RAW_AXIS_FLOOR__` · `__RAW_RATING_SPAN_FADE_HI__ = 40`.
Radar legend units (#9) still blocked on the external RainViewer scheme-7 palette spec.
`BRAIN_RULES.md` still carries a committed live API key — owner rotation.

---

## ⭐⭐⭐ THE RULES THAT PAID FOR THEMSELVES

1. **A sample can look broader than it is, and each way is invisible to the guard for the others.**
   Span=None fell out of BOTH branches · 12 requested hours = 5 SERVED frames · a uniform 5% draw
   reaches a 1.5% tail never. ⭐ **Span is a property of the REQUEST; coverage of the RESPONSE.**
2. **A prescription naming one of two required edits has a 100% miss rate.** Three consecutive
   commits, two authors, same trap. ★ **Fix the INSTRUCTION, not the third instance.**
3. **A prescription computed from the last GREEN run cannot see tests already committed but not yet
   run.** Its number describes the past; a floor must survive the future. Project it, mark it
   PROJECTED, **show the arithmetic** — that is what makes it falsifiable rather than fabricated.
4. **A DEPLOY IS NOT A PRECOMPUTE.** Production ran `b5632fc7` while serving a blob written by its
   predecessor. The first reading said my change had failed; the deploy SHA said it had worked.
   **Both were true and neither was the answer** — the live-compute fallthrough was.
5. **A blocker I authored decays exactly like anyone else's, and I trust mine more.** "A third tide
   sample needs a large swell — a clock, not a task" died to one API call.
6. **A verification inherits the working directory of what it verifies.** A persisted `cd` made a
   restore fail AND made the `git diff` confirming it report "0 lines changed" — a clean reading
   from the wrong scope, leaving a bogus floor in a shared tree.
7. **A hand count is a measurement.** I published "3 distinct served frames"; the instrument said 5
   and was right. I applied no scepticism to it purely because I had done it myself.

---

## ⛔ WHAT I GOT WRONG (the useful half)

| # | wrong claim | what caught it |
|---|---|---|
| 1 | "backend-floor-staleness has already cleared" | RUN-level conclusions vs JOB-level; `gh pr checks` |
| 2 | fixed the floor, left `_FLOOR_SET_FROM` stale | the paired test, on the very next run |
| 3 | my own prescription stated a FALSE equation | forcing the branch to execute against a mutated floor |
| 4 | non-ASCII in a print, on cp1252 stdout | **twice** — my own most-recorded Windows trap |
| 5 | "3 distinct served frames" | the instrument I had just written said 5 |
| 6 | nearly published a "12-hour" sample | inspecting ONE instance before parsing the set |
| 7 | +24 LOC into a file with a HARD 800 limit | checking `wc -l` before committing, not after |

★ **Every catch came from a control, a mutation, or executing the thing. A green suite caught
none of them** — and in the SPAN UNKNOWN case the suite *could not*: its own helper emitted no
`hour_offset`, so all 29 tests ran the silent path.

---

## ⚠️ OPEN, AND WHOSE

- **Sample 2's outlier** — mine, unexplained, no third hypothesis. Do not paper over it.
- ⭐⭐ **CHASED, AND IT IS A PRODUCT FINDING: 47% OF SAMPLED ROWS HAVE DEGRADED GEOMETRY, AND
  THEY ARE SYSTEMATICALLY THE BIG WAVES.** Measured over 128 rows of `frames_s6.json`, the
  separation is total — no overlap:
  | | n | `geometry_readiness` | height p50 | max |
  |---|---|---|---|---|
  | has `break_depth_m` | 68 | `full` (all) | 0.99 m | 1.93 m |
  | missing | 60 | `degraded` (all) | **2.96 m** | **3.81 m** |
  `break_depth_m is None` **iff** `geometry_readiness == 'degraded'` — 128/128, so the field is a
  free diagnostic for degraded geometry. ⛔ **The waves users care most about are the ones
  served with the worst geometry.** That is a data-quality question for the owner, not a
  measurement artefact.
  ⚠️ **I HYPOTHESISED THIS EXPLAINED THE TIDE NULL AND IT DOES NOT.** The obvious story — tail
  rows lack the depth input the tide term acts through, so they cannot respond — was TESTED by
  splitting the replay on `geometry_readiness`: `full` 68 rows max |delta| 0.2, `degraded` 60
  rows max |delta| 0.2. **Identical.** Degraded rows are not inert. ★ I nearly published this
  as the headline resolution of the tide question; the split took one run and refuted it.
  ✅ **ANSWERED: IT IS GEOGRAPHIC, AND THE HEIGHT LINK IS LARGELY CONFOUNDING.** Degraded rate
  by region (22 unique spots, one global `/spot-ratings` viewport — quote the n):
  | region | n | degraded | h_p50 |
  |---|---|---|---|
  | N. America | 6 | **17%** | 0.45 |
  | Europe/Med | 6 | **17%** | 1.54 |
  | Asia/SE-Asia | 5 | **80%** | 3.00 |
  | Africa/Indian | 2 | **100%** | 3.02 |
  | Pacific | 2 | **100%** | 3.81 |
  ⇒ **A COVERAGE GAP IN THE PER-SPOT GEOMETRY ASSETS OUTSIDE EUROPE/N. AMERICA** (`FULL` needs a
  per-spot ETOPO normal AND a nearshore break depth; `DEGRADED` is a coarse 0.25° normal
  and/or no break depth). The tall-wave correlation is mostly those regions HAVING the big
  surf, not height causing degradation.
  ⚠️ **n is small (regions of 2–6) and within-region strata are too thin to separate cleanly** —
  Asia/SE-Asia still shows degraded 2.95 m vs full 1.39 m, so a residual height effect is not
  excluded. The BETWEEN-region signal (17% vs 80–100%) is what carries this, and it is strong.
  ⛔ **NUMBERS CORRECTED AT 11x THE SAMPLE (245 unique spots, every row — `geometry_readiness`
  is on EVERY spot, not only the 5% carrying `inputs`):**
  | | n=22 (biased) | **n=245** |
  |---|---|---|
  | degraded estate-wide | 47% | **34.7%** |
  | Pacific | 100% (n=2) | **35%** (n=20) |
  | Africa/Indian | 100% (n=2) | **47%** (n=17) |
  | Asia/SE-Asia | 80% (n=5) | **72%** (n=32) |
  | Europe / N.America | 17% / 17% | **20% / 24%** |
  ★ **AND A CATEGORY THE SMALL SAMPLE NEVER SHOWED: 2 spots are `blind`** — no shore normal at
  all, strictly worse than degraded. Rare states need n to appear.
  ⭐⭐ **WHY I WAS WRONG: I ESTIMATED A POPULATION RATE FROM THE `inputs` SUBSET, WHICH I HAD
  DELIBERATELY BIASED TOWARD BIG WAVES THAT MORNING** (`b5632fc7`). Big waves are
  disproportionately degraded, so the bias inflated 34.7% into 47%. The finding doc for that
  very change says *"N% of rows can no longer be read as a population rate"*. I wrote the
  warning and walked into it inside 24 hours. ★ **A SAMPLE YOU BIASED ON PURPOSE STAYS
  BIASED FOR EVERY QUESTION YOU LATER ASK OF IT, INCLUDING ONES IT WAS NOT BUILT FOR.**
  The direction still holds — coverage is thin outside Europe/N. America — but the magnitudes
  were small-n artefacts, and 100% at n=2 should never have been written down as a rate.
  ▶ Owner call: extending geometry asset coverage is a product decision, not a measurement.
