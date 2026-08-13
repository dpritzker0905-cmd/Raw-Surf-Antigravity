# RETRACTED AND CORRECTED — the disqualified row is NOT an interaction; my oracle could not read a refusal

⛔ **The original version of this file (commit `0d325cd2`, title "the disqualified row is an
INTERACTION") was WRONG.** It is corrected here rather than deleted, because the way it was wrong
is the most useful thing in it.

## The correct result

Sample 6's lone disqualification is **`Salalah - Mughsail`** (persisted score **22.7**, breaking
height **2.629 m**, a TAIL row). **It never reproduces its persisted score — alone or in company.**
A plain per-row failure. There is no interaction and no state leaking between rows.

| experiment | disqualified |
|---|---|
| `spots[:78]` as served (control) | 1 |
| `spots[:78]` REVERSED | 1 |
| Salalah FIRST, then the other 77 | 1 |
| `spots[:77]` (Salalah absent) | 0 |
| last 78 spots (Salalah absent) | 0 |
| **Salalah ALONE** | **REFUSED — "1 rows carried inputs and NONE reproduced"** |

Order does not matter. Position does not matter. Only Salalah's presence matters. The earlier
`[:77]=0 / [:78]=1` prefix result was never evidence of predecessors — Salalah is simply the 78th
spot in the served order.

## ⛔ HOW I GOT IT WRONG — a refusal my own oracle could not read

The bisection oracle scraped `disqualified (\d+)` from stdout and returned `-1` when the pattern
did not match. Replayed alone, Salalah drives every row in the frame to fail, so the script takes
its **REFUSED** path — a different, louder message with no `disqualified N` in it:

> `REFUSED: 1 rows carried inputs and NONE reproduced their persisted score (seen 1). The replay is
> no longer the production chain -- a second forecast path, or the assets/constants moved since
> these frames were rated. This is blindness, not a result.`

My per-row loop tested `if disq([x]) > 0`. `-1 > 0` is False, so **the strongest possible signal —
a full-throated refusal naming the exact failure — was scored as "this row is fine."** Every row
came back "fine", so I concluded the failure required neighbours, and published that.

⭐⭐⭐ **THIS IS `A REFUSAL YOU CANNOT READ IS A PASS`, COMMITTED BY ME, HOURS AFTER CITING IT.**
The repo has carried that landmine since 2026-08-09. I applied it to CI checks and to pytest skips
the same day, and then wrote a scraper whose miss case collapsed into the pass case. ★ The class is
not "other people's guards are unreadable" — it is **any parser whose no-match branch is
indistinguishable from a negative result.** `-1` was chosen precisely to be distinguishable, and
then compared with `> 0`, which threw the distinction away.

★ **The instrument was never wrong at any point today.** It refused, explained why, and named the
consequence. Two separate wrong conclusions of mine (the count-regex error at `4b8d34f9`, and this)
came from reading its output through a pattern that could not represent what it said.

## What this means for the fix — the ORIGINAL prescription was right

The previous version of this file claimed the handoff's named fix was insufficient. **That claim is
withdrawn.** Collecting `(spot_id, name, persisted, reproduced, delta)` for disqualified rows
**would** have identified Salalah immediately, with no bisection and no wrong conclusion. It is the
right fix, it is ~6 lines, and it is still unimplemented.
⚠️ Add one thing the episode does justify: **make the REFUSED path emit the same per-row detail**,
since that path fires exactly when EVERY row failed — the case where the detail matters most.

## The genuinely open question

**A tail row does not reproduce its persisted score.** `Salalah - Mughsail` at 2.629 m is in the
sample only because of `b5632fc7` (same day), and the first disqualification in six samples landed
on it. Either the depth-limited regime has a real reproducibility problem — a second forecast path
in exactly the regime the tide work cares about — or it is coincidence at n=1. **n=1 cannot
distinguish them.** Cheapest discriminator: re-run and see whether it recurs, and whether it stays
on a tail row.

## The method still holds

A count-only oracle DID localise one row out of 1,600 in ~14 runs, and the whole-set control
(`== 1`) asserted before trusting any split is what made the search sound. The method was fine.
**The scraper on top of it was not** — and no control was placed on the scraper itself.
