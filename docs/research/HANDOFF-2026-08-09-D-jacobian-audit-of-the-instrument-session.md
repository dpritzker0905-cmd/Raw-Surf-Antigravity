# Handoff 2026-08-09 (D) — Jacobian audit: what moved, what is measured, what is still guessed

Supersedes handoff (C) for the session's later half. Span `44cc2ddd..b20dba2a` (42 commits, two
sessions sharing the tree; mine are the shadow-A/B, readout-truth and proof-pin series).

**The one-line summary:** the platform gained an instrument that can answer "what would this flag
have done?", and the instrument was **wrong three times before it was right** — each time caught by
a control, never by a green suite. Everything below is ranked by measured effect on the number a
user reads, not by how interesting it was to find.

---

## ⭐ JACOBIAN — ∂(what the user sees) / ∂(one change), measured

| # | Finding | Magnitude ON THE USER'S NUMBER | Reach | State |
|---|---|---|---|---|
| 1 | **Lane-dependent wave height** — nearshore decay applies in ONE lane | **up to 2.86×** (0.35H vs H) | every coastal grid-sample; all marine layers | ⛔ PINNED, not fixed — needs a science call |
| 2 | **Tide flag potency** — `SURF_TIDE_DEPTH` at the depth-limited cap | **+43.7%** height (8.99→12.92 m); **38.1 pts** of score | rare: only cap-limited seas | ✅ now MEASURABLE (was unmeasurable) |
| 3 | **Legend numbers vs colours** | **47 pp** of bar width (rain "6" at 57% of the bar, its colour at 10%) | 6 legends × 3 layouts | ✅ FIXED |
| 4 | **Fog readout dead on EURO/ICON** | total loss (`--` forever) under a full raster | fog layer, 2 of 3 models, every hour | ✅ FIXED |
| 5 | **Band-fade dead zone** — rated grid painted at alpha 0 | 100% of the band | viewport spans 9.5–40° | ⛔ owner call (`__RAW_RATING_SPAN_FADE_HI__=40`) |
| 6 | **Access-cap key mismatch** | 2× scrubber window (14 d vs 7 d) | `rain`/`temperature`/`water_temp` | ⛔ owner call (reduces what users reach) |
| 7 | **Stale frame past a model's axis** | wrong HOUR, undisclosed | any layer past its horizon | ✅ disclosed; ⛔ not closed |
| 8 | **ft/m toggle missing on the cards** + drifted 3.281 | unit-wrong, 1-in-20 500 rounding split | infobox cards, all marine layers | ✅ FIXED |
| 9 | **Radar legend units** | label vs stops vs readout, three-way | radar legend | ⛔ needs RainViewer scheme-7 spec |

**Where the leverage now sits:** #1 is the largest number on the product's core quantity and is
one science decision away from resolution. #5 and #6 are single-value changes with the evidence
already attached. #9 is blocked on an external primary source, not on effort.

---

## ⛔ THE FIVE TIMES I WAS WRONG (and what caught each)

This is the most transferable part of the session. **The instrument failed far more often than the
code under test**, and a green suite caught none of it.

1. **E#1's cause — refuted BY SIGN.** I documented the cell-vs-spot reference gap as the cause of
   the band/glyph divergence and wrote it into a module docstring. Measured: the band reads
   **2.3–2.7× ABOVE** the glyph, while a LARGER reference scores **LOWER** (33.5 at ref 1.481 vs
   21.9 at 2.164). The gap predicts the band reading LOW — opposite sign, so it is a
   *counteracting* term. ⇒ **A mechanism that predicts the wrong sign is refuted, not "partial".
   The sign test is binary and cheap; run it before believing a mechanism you like.**
2. **A false "safe to flip".** The first real A/B reported `SURF_TIDE_DEPTH` as *0.2% change,
   median 0.0* over 502 served rows. It measured **nothing**: the tide term is guarded on
   `water_level_m`, which the replay never supplied. The true potency is **38.1 points**.
   ⇒ **A null result from an inert lever is not evidence of a quiet lever.**
3. **My own payload nearly doubled a client-downloaded blob.** `inputs` cost **+137 B on a 320 B
   row (+42.8%)**, ~1.4 MB across an object every client fetches — nearly double the +23% that had
   justified interning `run_time` out of that same blob, with the precedent six lines above mine.
   ⇒ **An instrument may not tax the product it measures.**
4. **"ICON has data to 216 h" — unsourced.** `capabilities.py` declares native 120 / estimated 216
   / max 336, and **120 + 216 = 336**: the 216 is a TAIL LENGTH, not an hour. I nearly moved a
   cutover on it.
5. **Five probe bugs in one afternoon** — a string match counted a COMMENT as a consumer; a `/s`
   regex matched under node but not jest (reporting 0 while the import sat there); a heredoc
   collapsed `\n` inside a JS string; a `{tier:'premium'}` fixture silently resolved to GUEST; a
   return value assumed to be an object was a number.
   ⇒ **Every one was caught by a KNOWN-TRUE control that should have matched and didn't.**

---

## ✅ THE INSTRUMENT — and the four ways it now refuses

`backend/scripts/science_shadow_ab.py` replays SERVED spot-hours under a candidate flag set.
It carries **11 refusal/disclosure paths**, every one added because it had already been fooled:

| Guard | Answers | Added after |
|---|---|---|
| per-row **baseline self-check** | is the replay still the production chain? | design |
| **NOT READY vs REFUSED** | absence vs breakage (exit 0 vs 3) | two false CI alarms |
| **COVERAGE + `! NARROW`** | one hour or a fortnight? | reporting 3 models × 2 hours as if it were one |
| **positive control** (`candidate_can_move`) | can the lever move AT ALL? | the false "safe to flip" |
| **`! DILUTED` / `! BLIND`** | how many rows CAN'T move? | 25% headline vs 100% of carrying rows |
| **`* INFERRED`** | what is the effect confined to? (registry-free) | a registry with one entry |

⭐ The last one matters most for the future: dependency is now **inferred from the data**, so a
flag guarded on an unlisted input can no longer get the diluted headline in silence.

---

## ▶ NEXT, in Jacobian order

1. **Resolve the lane-dependent height (#1).** The decay's intent is sound; living in one lane is
   not. Decide whether the point lane is already land-aware, and whether 0.35 is calibrated or a
   guess. `nearshoreDecay.proof.test.js` holds the measurement.
2. ✅ **DONE — the tide A/B ran for real (22:05Z, run 31338483734).** First trustworthy verdict
   this instrument has produced:

   ```
   rows        seen 10638 | replayable 496 | disqualified 26
   COVERAGE    6 frames | EURO,GFS,ICON | hour offsets [0, 3] (span 3 h) | 21:00Z .. 00:00Z
   LEVEL       unchanged 496  up 0  down 0  => 0.0% change
   delta       p10 -0.1  median 0.0  p90 0.1  (min -0.2, max 0.2)
   DEPENDENCY  guarded on `water_level_m`: 486/496 rows carry it (98%) -> among THOSE,
               0 changed level (0.0%), max |delta| 0.2
   ```

   **Why this one is believable where the first was not:** input coverage went 0% → **98%**, and
   the positive control proves the harness can detect a **38.1-point** move — **190× larger than
   the largest thing observed (0.2)**. The lever is live, wired, and pointed at the served
   population, and it still moves nothing.
   ⇒ **Flipping `SURF_TIDE_DEPTH` is user-invisible in these conditions.** It is NOT evidence of
   no effect in general: the term binds only at the depth-limited cap (~12 m offshore at
   Pipeline), and no such sea is in this 3-hour sample.
   ⚠️ **AN OPEN DISCREPANCY, recorded rather than smoothed over:** the ledger puts tide reach at
   **1.694%** of served spot-hours, which predicts **~8 binding rows in 486**. Observed: **0**
   level changes, max 0.2 pts. Either the 1.694% is measured on a different predicate (input
   present vs cap actually binding), or this window is unrepresentative. **Do not quote either
   number as settled until that is reconciled.**
3. **Owner calls #5 and #6** — one value each, evidence attached.
4. ⛔ **Do not tune either band/glyph lane** until the per-cell composition sub-term is isolated —
   that belongs to the concurrent report-11 session.

---

## ⚠️ KNOWN LIMITS OF THIS WORK

- The A/B has never produced a **trustworthy non-null verdict** yet. Every run so far either
  refused or was retracted. Treat its first green result with the same suspicion I failed to apply.
- `CANDIDATE_INPUT_DEPS` still declares one dependency. Inference covers the gap, but only when the
  data contains rows on BOTH sides of the input.
- The frontend fixes are **unverified in a browser** — no compositing pane, so MapLibre never
  finishes loading a style. Unit-proven, visually unproven.
- Two of my nine findings (#5, #6) would REDUCE what users currently reach. That is a product
  decision I deliberately did not make.
