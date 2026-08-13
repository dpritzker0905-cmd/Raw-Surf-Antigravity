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

⛔ **THAT DISCRIMINATOR WAS RUN AND TESTED NOTHING.** A fresh precomputed frame
(2026-08-13T03:00Z) reported **0 disqualified / 17 replayable** — but `Salalah - Mughsail` had
dropped to **2.486 m**, just under the 2.5 m `SPOT_RATINGS_INPUTS_TAIL_M` threshold, so it
carried no `inputs` and was **not in the sample at all**. The green reading says nothing about
the row it was meant to test.

⭐⭐ **A THRESHOLD-BASED SAMPLE LETS THE SUBJECT LEAVE THE EXPERIMENT.** Salalah sat at 2.629 m
— barely above the line — so ordinary swell decay removed it from observation between one run
and the next. **A re-run that silently loses its subject reads as REASSURING**, which is worse
than a failure: the count went to zero for a reason unrelated to the question. ★ Any "re-run and
see if it recurs" over a filtered sample must FIRST assert the subject is still in it.

▶ **To actually test Salalah:** lower `SPOT_RATINGS_INPUTS_TAIL_M` below its current height, or
replay the banked frame (`frames_s6.json`, frame 5) against a rebuilt chain. Both are cheap.

⚠️ **The instrument named a second explanation I have not excluded:** *"or the assets/constants
moved since these frames were rated."* Checked: **no science constant changed on 2026-08-12**
(`science_registry.py`, `surf_rating.py`, `surf_point.py` — no commits that day). One row failing
of 128 argues against systematic drift, but a per-SPOT geometry change would look exactly like
this — see `4d82a13c` ("land without a bearing — 14 atoll spots stop serving the offshore
height") for the shape. **Not dated, not excluded.** A second forecast path and a moved asset
are still both live, and the REFUSED text says so explicitly.

## ⭐⭐ RESOLVED BY MEASUREMENT — an ABSOLUTE bound meeting a HEIGHT-SCALED error

Height reproduction error across all 128 rows of `frames_s6.json` (bound is `> 0.005 m`):

| p50 | p90 | p99 | max |
|---|---|---|---|
| 0.001332 | 0.003318 | **0.004715** | **0.005293** (Salalah) |

Over 0.005: **1**. Over 0.004: **5**. Over 0.003: **17**. Over 0.001: **79 of 128**.

⭐ **Salalah is not broken — it is the top of a smooth, continuous distribution.** The p99 is already 0.004715. The bound sits INSIDE the natural error spread, so which row disqualifies is decided by a hair.

⭐⭐ **THE ERROR SCALES WITH HEIGHT AND THE BOUND DOES NOT.** The five largest errors are the two tallest waves: Salalah 2.629 m (0.005293 = **0.20%**) and Papara 3.813 m (0.004715 = **0.12%**). An ABSOLUTE 5 mm tolerance therefore disqualifies TALL waves preferentially, whatever the chain is doing.

⇒ **The causal chain, complete and measured:** `b5632fc7` put big waves into the sample for the first time → height reproduction error scales with height → the bound is absolute → the first disqualification in six samples appeared immediately, on the tallest sampled row. **Not a second forecast path. A mis-specified tolerance meeting a newly-observable regime.**

⚠️ **This will get WORSE as intended.** Tail sampling exists to put more big waves in the sample, so an absolute bound means the false-disqualification rate GROWS with the change that made the tail observable. ★ A guard whose false-alarm rate rises with your coverage will be switched off exactly when coverage finally arrives.

▶ **Fix (not written):** make the height check RELATIVE, or mixed — e.g. `abs(dh) > max(0.005, 0.002 * h)`. ⚠️ Derive it and write the derivation down: `REPRODUCE_TOL` carries a careful quantization argument for the SCORE grid, and the height bound carries none. **Do not widen it to whatever makes today's row pass** — that is the census-bound mistake this repo already has on record.

## ⭐⭐⭐ THE DERIVATION — measured, not fitted

The bound needed a derivation, not a constant that makes today's row pass. Perturbing EVERY persisted input by its own rounding half-quantum (`offshore_hs_m` +-0.0005 m, `swell_from_deg`, `shore_normal_deg`, `break_depth_m` +-0.05, `period_s` +-0.05 s) and summing the single-input effects gives the honest quantization envelope:

- **0 of 22 rows have an observed error EXCEEDING their own envelope.** Reproduction error is fully accounted for by input rounding. There is no residual drift to explain.
- Papara: envelope **0.006106** vs observed 0.004715 — within.
- **Max envelope / height = 0.84%**, and the envelope SCALES with height, which is why an absolute 5 mm bound preferentially fails tall waves.

⇒ **DERIVED FIX:** the height check must scale. `abs(dh) > max(0.005, 0.010 * h)` covers the measured 0.84% envelope with modest headroom, and the 0.005 floor preserves today's behaviour for small waves. **This is derived from the persisted rounding grids, the same way `REPRODUCE_TOL` was derived for the score grid — not fitted to the failing row.**

⚠️ **TWO HONEST LIMITS ON THIS RESULT.** (1) The envelope run DEDUPED BY SPOT NAME, so the 'Salalah' row it measured is from frame 0, not the frame-5 row that actually failed; that row's envelope is inferred from a sibling (0.006843 > its 0.005293 observed), **not measured directly**. (2) The sum-of-single-effects is a LINEAR worst case; real combined error is typically smaller, so the envelope is generous by construction. Neither weakens 'the bound must scale'; both matter if anyone tunes the 0.010 coefficient. **Re-measure without dedup before pinning it.**

## The method still holds

A count-only oracle DID localise one row out of 1,600 in ~14 runs, and the whole-set control
(`== 1`) asserted before trusting any split is what made the search sound. The method was fine.
**The scraper on top of it was not** — and no control was placed on the scraper itself.
