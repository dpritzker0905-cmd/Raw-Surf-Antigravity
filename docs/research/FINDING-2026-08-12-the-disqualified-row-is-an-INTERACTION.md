# The disqualified row is an INTERACTION, and a count-only oracle was enough to find it

Companion to `HANDOFF-2026-08-12-the-instruments-were-the-defect.md`. **New file deliberately:**
that handoff has been patched four times today and the fourth patch shipped a wrong number. A new
single-source document has no counts elsewhere to keep in sync.

## What was measured

Sample 6 reported `disqualified: 1` — the first non-zero across six samples. The report carries
only the COUNT, no identity. It was located anyway, by bisecting subsets and reading the count:

| step | result |
|---|---|
| whole set (8 frames) | disqualified = **1** (control, asserted before trusting any split) |
| per frame | only **frame 5** (`hour_offset 10`, 15 rows w/ inputs) |
| each row ALONE | **0 for every row** — not a property of any single row |
| prefix binary search | `[:77] = 0`, **`[:78] = 1`** |

**The row is `Salalah - Mughsail`** — persisted score **22.7**, breaking height **2.629 m**,
carries `inputs`. It reproduces its persisted score when replayed alone, and fails to when
preceded by 77 other spots in the same frame.

## Why this matters more than the row

The baseline self-check exists to catch a **second forecast path**: re-rate a served row, and if it
does not reproduce its persisted score, disqualify it rather than replay it. A per-row failure
would mean bad data at one spot. **A failure that appears ONLY with neighbours present means state
is leaking between rows in the replay** — which is the exact shape the check was built to detect,
pointed back at the harness.

⚠️ **The obvious suspect is a guess, and is recorded as one:** `ONE FORECAST COMPOSITION` requires
geometry to be resolved once per coordinate and reused across hours. A reuse keyed slightly wrong
would produce precisely this signature — correct alone, wrong in company. **NOT CONFIRMED.**
Confirming it means instrumenting per-row state in the replay, which is code, not analysis.

★ **`Salalah - Mughsail` is a TAIL row (2.629 m >= the 2.5 m threshold), so it is in the sample
ONLY because of the tail-sampling change shipped the same day (`b5632fc7`).** The first
disqualification in six samples landed on a row that was unobservable that morning. That is either
a real reproducibility problem concentrated in the depth-limited regime, or coincidence on n=1 —
and n=1 cannot tell those apart. **Re-run sample 6 and see whether the disqualification recurs, and
whether it stays on a tail row.** That is the cheapest discriminator available.

## ⛔ THE FIX I NAMED IN THE HANDOFF WOULD NOT HAVE ANSWERED THIS

The handoff says: *"collect (spot_id, name, persisted, reproduced, delta) for the first N
disqualified rows and emit them alongside the count."* **That is insufficient.** Salalah is fine in
isolation — an identity plus a delta would name a row that passes when you go and check it, which
is worse than useless: it sends the reader to a spot with nothing wrong. What the instrument
actually owes is **the row PLUS the state that preceded it** — at minimum a row INDEX within the
frame, so that "fails at position 78, passes at position 1" is visible.

★ **A fix specified before the defect was understood was wrong about what to record.** It was
written one turn after the defect was noticed and sounded complete.

## The transferable method

**A COUNT-ONLY ORACLE IS ENOUGH TO FIND IDENTITY.** No instrument change was needed — subsets plus
a reported count plus binary search localised a single row out of 1,600 in ~14 runs. The bisection
asserted the whole-set control (`== 1`) before believing any split, which is the step that makes
the search trustworthy rather than merely fast.

⚠️ Windows/bash tax paid on the way: `"\\\\bis_"` inside an unquoted heredoc collapsed to `\b`, a
backspace, and produced `Errno 22`. `os.path.join` avoids the whole class.
