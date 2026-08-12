# PERFORMANCE AND CAPACITY DELTA — Audit 11.4

## What was measured, and by whom

⚠️ **All runtime performance numbers below are AUTHOR-REPORTED. I did not reproduce them.**
No browser session was run in this audit. This section reports and assesses the author's experiment;
it does not independently confirm it.

Source: `audit/weather-simulation-11.2/evidence/forensics/GATE6_mask_cache_SHIPPED.md`.

```
CACHE ON    static   work=24  hit=21  miss=3    88%    classifier avoided ~0.59 s
            panning  work=38  hit= 8  miss=30   21%    classifier avoided ~0.22 s
CACHE OFF   static   work=23  hit= 0  miss=23    0%
(kill)      panning  work=31  hit= 0  miss=31    0%
```

| Metric | Pre-repair | Repaired | Classification |
|---|---|---|---|
| Mask cost, static viewport | ~54 ms/s | ~53% lower | Improved |
| Mask cost, panning | ~96 ms/s | ~85 ms/s (~12% lower) | Acceptable Tradeoff |
| Classifier invocations, static | 23 / 23 | 3 / 24 | Improved |
| Classifier invocations, panning | 31 / 31 | 30 / 38 | Preserved (barely improved) |
| Per-call key hash cost | 0 ms (flag-gated) | ~2.3 ms **unconditional** | Regressed — disclosed, and outweighed at both measured hit rates |
| Resident memory | 0 | ~2 MB (4 × 512 KB) | Acceptable Tradeoff |
| Map component test suite | 1351 pass | 1351 pass | Preserved *(measured by me)* |
| Lint on changed files | clean | clean | Preserved *(measured by me)* |

## Assessment of the experiment's design

**Strong.** The control arm at 0% hit in both phases is what makes the ON arm interpretable — it
demonstrates the kill switch actually disables the mechanism under measurement rather than assuming
it. Within-run phase control (static vs panning in one session) removes between-session confounds.
This is the design the project's standing work rules call for.

**Limitations the author states, and which I confirm are real:**

- One session per arm. No repeat, no variance estimate. The upstream redundancy figure already moved
  88% → 96% between two runs, so these are two-significant-figure numbers at best.
- A hit saves ~60% of a call, not 100% — the downsample (11.7 ms) and readback (4.5 ms) still run.
- Realized hit rate (88% / 21%) sits below measured redundancy (96% / 32%) because the 4-entry LRU
  evicts entries before they can be re-hit during motion.

**The correction is the most important line in the record.** The author had published "a perfect
cache removes 1.40 s of 1.59 s" and retracted it to "~53% static / ~12% panning — a third of what my
headline implied." I checked both the reasoning and the arithmetic; both hold.
★ *A cache saves the stage it replaces, not the call it sits in.*

## NOT MEASURED

Cold vs warm cache, CPU throttling, DPR 1 vs 2, viewport size, time-to-weather-ready,
time-to-first-frame, frame-time distribution, long tasks, React commits, map repaint frequency, and
production-vs-development build behaviour. None were exercised. See `OPEN_EVIDENCE_GAPS.md`.
