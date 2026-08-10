# Handoff 2026-08-10 — four fixes shipped dark, and an audit of the eleven times I was wrong

Supersedes handoff (D). Covers `4cb9c3c6..37654183` plus the corrections folded back into (D).
**Audited before writing**, not asserted: full frontend **1949 tests / 209 suites**, backend
composition lane **873 passed / 64 skipped**, every commit pushed, all four flags verified strict
`=== true` with **zero** loose default-on forms.

---

## ⭐ WHAT YOU CAN TURN ON (all default OFF = byte-identical today)

| flag | fixes | measured effect when ON |
|---|---|---|
| `window.__RAW_NEARSHORE_RENORM__` | wave height penalised twice on land | worst case **11.43× → 1.00×** |
| `window.__RAW_LAYER_CAP_ALIAS__` | `rain`'s own forecast cap never binds | scrubber **14 d → 7 d** for ICON rain |
| `window.__RAW_AXIS_FLOOR__` | silent stale frame past a model's axis | a **time** lie becomes a *disclosed* model substitution |
| `window.__RAW_RATING_SPAN_FADE_HI__ = 40` | rated band painted at alpha 0 | closes the **9.5–40°** dead zone |

Each ships dark because each **changes a number a user reads** — that is your call, not mine.
Each has its default-off behaviour pinned by an explicit assertion, and each was mutation-tested
in the direction of "silently defaults on".

---

## ⛔ THE AUDIT — ELEVEN TIMES I WAS WRONG, AND WHAT CAUGHT EACH

The through-line: **my instruments failed far more often than the code under test, and a green
suite caught none of it.** Every catch came from a control, a mutation, or actually executing the
thing.

| # | The wrong claim | What caught it |
|---|---|---|
| 1 | E#1 caused by the reference-population gap | **SIGN**: band reads 2.3–2.7× HIGH, a bigger reference scores LOWER |
| 2 | "`SURF_TIDE_DEPTH` = 0.2%, safe to flip" | the flag's input was never supplied — it measured **nothing** (true potency **38.1 pts**) |
| 3 | shipping `inputs` on every row | pricing it: **+42.8%** on a blob every client downloads |
| 4 | "ICON has data to 216 h" | `120 + 216 = 336` — a **tail length**, not an hour |
| 5 | "2.86× lane divergence" | my own **failing proof**: two interpolation paths, real worst case **11.43×** |
| 6 | "one-line alias fixes three layers" | two of them have **no capability row** — an alias would invent a bound |
| 7 | "users are hitting 86-second responses right now" | telemetry is **cumulative**; the live call took **1.02 s** |
| 8 | "p50 = 85.8 s on every request" | overflow bucket reports `max_ms`; only **≥3 of 5 exceeded 10 s** |
| 9 | e2e red = deploy race (events 2–4) | backend was up **10–20 min** before those failures |
| 10 | RSS leak heading for OOM | six samples: **flat, then released 55 MB** (two points always make a line) |
| 11 | 1.694% vs 0 observed = a contradiction | different predicates: a **uniform −1.5 m stress offset** vs real tides |

Five more were pure instrument bugs: a string match counting a **comment** as a consumer; a `/s`
regex matching under node but not jest; a heredoc eating `\n` inside a JS string; a
`{tier:'premium'}` fixture silently resolving to **GUEST**; and slicing the **last** 8 chars of a
40-char SHA and reading it as a prefix.

---

## ⭐⭐⭐ THE FIVE RULES THAT PAID FOR THEMSELVES

1. **A mechanism that predicts the wrong SIGN is refuted, not "partial."** Binary, cheap, and I
   skipped it.
2. **A null result from an inert lever is not evidence of a quiet lever.** Prove the harness *can*
   move the thing before believing it didn't.
3. **An instrument may not tax the product it measures.** Price the payload on the object a user
   downloads.
4. **A stale comment on a FLAG-GATED path reads true for as long as the flag is off** — and the
   day it flips is the day the claim matters.
5. **Run the lane the gate runs, not the subset you trust.** Twice: tests passing alone and failing
   in combination, and a targeted run passing while CI failed.

---

## ⚠️ OPEN, AND WHY

- **#9 radar legend units** — raster is RainViewer scheme-7 (dBZ), label says dBZ (correct), stops
  are rain-rate shaped, readout is model mm/h. Needs the **scheme-7 palette spec**, which is not in
  this repo. **I refused to invent dBZ thresholds**: fabricated numbers read as measured ones.
- **`SURF_TIDE_DEPTH`** — now genuinely measurable (98% input coverage; harness proves it can see a
  38.1-pt move). Verdict: **user-invisible in a 3-hour window**, but the term binds only at the
  depth-limited cap, so re-run across a wider span before concluding. Read the **DEPENDENCY** line,
  never the headline.
- **Serving latency** — `/api/health` p90 **16 s**, RSS **70–73%** of a 2 GiB cap. Stable, not
  leaking, but it is the best explanation for the e2e flakes and it belongs to the concurrent
  session's OOM thread (`0d9149b7`).
- **Band/glyph per-cell composition** — theirs; do not tune either lane.

---

## ▶ IF YOU DO ONE THING

Flip `__RAW_NEARSHORE_RENORM__` in a browser console and look at a coastal spot's wave height.
It is the largest measured error on the number this product exists to report (**11.43×**), the fix
makes height agree with period rather than inventing anything, and default-off means you can turn
it straight back off.
