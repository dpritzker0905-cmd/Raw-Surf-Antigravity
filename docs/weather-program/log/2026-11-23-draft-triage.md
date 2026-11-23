# 2026-11-23: triage of five unowned draft PRs (#1071, #1075, #1078, #965, #663)

Session: draft-triage, a side session of the director (local_d6b521eb). The owner said "Yes open it" in the director session,
2026-11-23. Dev was at 1e41f0203 when the PRs were read. Every branch is kept; only the PRs were closed.

## How each was decided

For each PR, the session read the PR, its log and decision entries, and what dev already has. It then put one public brief to
SubQ (savant-1.4), Reflection (Beam) and LongCat (2.5, via preview_review then submit_review): "what is the best path toward
SOTA: close as superseded, finish, or hold for the owner?" The brief held no secrets. All three gave the same five verdicts
independently. LongCat wrongly attributed EURO cloud to #1075; that slip changed no verdict.

## Verdicts

| PR | Verdict | Outcome |
|---|---|---|
| #1071 ICON air temp 0.125 | Superseded by #1136 (d4e8123df) | Closed |
| #1075 ICON rain 0.125 | Superseded by #1136 | Closed |
| #1078 EURO cloud | Superseded by #1136 | Closed |
| #965 0.5° world wave tier (B1) | Owner: **"Fold into coastal, close"** | Closed |
| #663 EURO scalar height flip (draft D-057, renumbered D-073) | Owner: **"run this by longcat, subq, and reflection. If retire it is best go that way"**; all three said RETIRE | Closed, retired |

### #1071, #1075, #1078: superseded

Dev has, through #1136:
- their client keys, `ownOnlyModels`, `gapFill`, the three test files (`ownRasterIconTemp`, `ownRasterIconRain`,
  `ownRasterEuroCloud`) and the three kill switches;
- the fixes for the advisor's holds: the session-long "unavailable" latch is now a 60 s retry, and the Open-Meteo credit is
  corrected;
- the answer to the owner's hold on blank ranges past ICON 180 h and EURO 240 h: a labelled fill (the coarser set, then the
  anchored prediction, then a GFS stand-in). It never uses Open-Meteo.

### #965: folded into the coastal band

- **What already lives on:** the vectorized reductions (`services/_fetch_region_reduce.py`, #962) are on dev, and the
  coastal-band writer calls them.
- **Where its purpose goes:** the tier was meant to stop a first visit outside a 0.25° pilot box from dropping to the 2° world
  frame. That becomes the band's fallback design, scoped inside the coastal-band lane under its one pilots-pass budget
  (fable-coastal-band-slice3-answers, condition 6).
- **Reference only:** the PR's tiled gzip-member packing and its byte-for-byte gate (1a).

### #663: retired

The only paired buoy read (#925, Actions run 43754098448, `log/2026-11-15-claude-verifier-euro-scalar-read.md`) was VOID on its
own C1 control. Read for the record only, it showed:
- a pooled dMAE of -0.002 / -0.006 / -0.008 m at +24 / 48 / 72 h, none significant;
- a high bias that rises at every lead (pooled +0.11..+0.20 m against +0.09..+0.15 m);
- Hawaii and the NE Pacific worse.

A second read on rows already seen risks p-hacking, and the buoy skill gate remains to catch any real EURO height issue. EURO
marine heights keep the vector-mean interpolation, and `SAMPLER_SCALAR_HEIGHT_MODELS` stays `GFS`.

**Left as it is:** the EURO shadow lane (`SAMPLER_SCALAR_LEDGER_MODELS` includes EURO) keeps grading. Retiring it is not part of
this decision.

## Ledger

The ledger lines are in `ledger.d/claude--draft-triage-2026-11-23.jsonl`: an owner_action (the owner's two decisions and
the five closures they authorized) and a doc_write (this log). This change moves no served number, so it needs no SCOREBOARD row.
