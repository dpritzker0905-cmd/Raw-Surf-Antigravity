# SOTA roadmap: one ranked list across every lane

Written 2026-11-16 04:55Z by the senior research lead, on the director's overnight brief. David, 23:41 EST 2026-11-15:
"sort through all our work tonight, in all of our subs and learning, organizing and improving toward SOTA while I
sleep".

- **Status is a claim, not a measurement.** Check `gh pr list` and `docs/weather-program/log/` before acting on it.
- **Edit protocol.** Append a dated update under an item; never rewrite one.
- **Sources.** Every item points at the log or PR that holds its evidence. The ranked reasoning is in
  `log/2026-11-15-senior-research-lead-sota-plan.md`.
- **Served flag.** "Served" = it changes a number or field a user sees. A served change needs D-065 (ON with a kill
  switch, history filter, guardrail), a SCOREBOARD row, and David's explicit word.
  - The director's policy lets Reflection + SubQ agreeing on a met gate stand in while he is away. It rests on David's
    standing pre-approval (2026-11-13 23:47 EST, verbatim on the director board): "If its on the path toward state of
    art, and double checked by subq and reflection, then we can give you a pre-approved yes. So anything you need to ask
    me about, and im not here because I'm sleeping, follow that path logically."
  - The advisor's standing brief requires David's explicit word for a served-number change. Where the two differ, ask
    David.
- **Gate column:** "pre-registered; can fail" applies only where a pass/fail number is written. Items marked "gate not
  yet registered" have none yet.

## Rank 1-5: what moves the product most, soonest

| # | Item | Owner lane | Gate (pre-registered; can fail) | Status 2026-11-16 | Served |
|---|---|---|---|---|---|
| 1 | **Surf transform, S0 ablation (B1)**: which multipliers survive (Komar is about half the NE-Florida over-read) | repair lead | #942: per-factor on/off with a null arm, per coast/class; break-acting factors need ≥ 30 breaking-truth rows per class | #942 open; break-acting arms wait on truth (rank 4) | No (measurement) |
| 2 | **Tide M1**: harmonic tide (FES2022 primary, EOT20 arm, CO-OPS near stations) replaces Open-Meteo `sea_level_height_msl` | tide lane | 26 CO-OPS stations, 2026-10-15..28: median RMSE ≤ 0.08 m and below the Open-Meteo 72 h arm; no station > 0.05 m worse; extrema ≤ 20 min; MLLW ≤ 0.05 m; positive/negative controls (shared notes `research-lead-briefs-2026-11-16.md` §1) | #931 (harmonic, near stations) HELD by the director under D-074; FES/EOT build owed; AVISO secrets set 01:59Z | Yes |
| 3 | **Long-range wind/gusts**: ECMWF 51-member mean hand-off past ICON 180 h / EURO 240 h, hard seam, gusts from member 10fg | wind lanes | #946 as amended (amendment 4; read the PR, not this paraphrase): void controls C3 (shuffled stations must be worse) and C4 (the shifted arm must not be significantly better); C1 (+48 h) is reported only; every PASS line is also reported on 5-day blocks, and one that passes on 1-day and fails on 5-day blocks is FRAGILE | #939 open, waits on the gate; #935 withdrawn; EMOS prereg #950 and collector #951 open | Yes |
| 4 | **Breaking truth T1 (crowd) + P4 aggregator** on the existing photographer check-ins and reports | surf-truth session + research lead | spec sent 2026-11-16: blind entry, server provenance, latent-truth model, 20% spot holdout, shuffled-ID and +30% synthetic controls; P0 provenance fix #953 | #953 open; aggregator being built | No until a gate passes |
| 5 | **Open-Meteo off the served path (M1-M6)**; EURO/ICON from primary sources (G1-G8) | Move 3, frame-carry, tide, repair | **gate not yet registered** (parity tolerances per layer still to be written). Planned: parity per layer vs today, plus a CI guard that no served route or browser bundle references an Open-Meteo host (tests, scripts and grading allow-listed) | inventory + plan in the research log; G1 ICON temp and G2 ICON precip sets built and dark; G3 cloud sets designed | Yes (per layer) |

## Rank 6-15

| # | Item | Owner | Gate | Status | Served |
|---|---|---|---|---|---|
| 6 | Breaking truth T2: Sentinel-2 surf zones (breaking line to shoreline gives beach state and slope; scene paired with hindcast) | new lane (director) | **gate not yet registered** (planned: Frugier-style state classes reproduce known sites, and ≥ 30 pairs per class; no failing threshold written yet) | designed | No |
| 7 | Surf transform B2 classes, B3 per-spot spectral K (per partition; bathymetry stack CUDEM/EMODnet > S2 SDB > S2Shores > ETOPO), B5 inlet tide term, B4 hierarchical correction last | repair lead + offline build | held-out SPOTS by class/region; shuffled-class null; seeded x1.3; monotone; no class worse | designed (log, 19:32Z..19:52Z sections) | Yes |
| 8 | Breaking arm A1: open Battjes-Janssen transect (gamma 0.73); A2 SWAN BKD once its form is read from an open source | repair lead | inside #942's ablation | A1 runnable; A2 not runnable | Yes |
| 9 | Model blend missing-member fix (shadow) | repair lead | fixed shadow no worse than its best member at every lead (CI upper ≤ +0.01 m), pooled and on missing-member rows | waits on the 11-16/18 cause read | No (shadow) |
| 10 | Accuracy monitor D-072 v2 (rule 1 on CHANGE with a guard gap; rule 2 on named holes; NOAA bulletin reference #952) | verifier; scored by the advisor | P2' ≥ 6/7 fully seeded days and first fire ≤ 11-10; null ≤ 1 page / 30 d | #934 merged; #945 v1 FAILS P2; #949 v2 (amend 1d) and #952 open | No |
| 11 | Bias correction 11-30 test incl. ocf_idw arm; ML residual shadow (gradient-boosted trees) | Move 4 / skill lane | 11-30: better at every lead with CI > 0, no region worse > 0.01 m, hole buoys out of fit AND score (#932) | #936/#938 merged; #944 needs David's dispatch | Yes if shipped |
| 12 | Instant: phone scrub re-render, EURO/ICON z7 misses, EURO water raster decode worker | Move 3 | p95 ≥ 50% lower vs same-build baseline, A/A < 10%; census slow steps −50% | run 2: gate 1 FAIL (noisy machine), gates 2-3 PASS; re-run on a quiet machine | No |
| 13 | Hour blend (cross-hour only) with physics advection arm | animation lane | hidden-middle-frame vs the real frame, ghost count, corrupted-frame negative; then David's blind look | #930 draft, OFF by default | No (display) |
| 14 | Gusts + currents layers on own frames | gusts lane | every hour drawn equals its label, 0 skipped, phone scrub ≤ 150 ms | #928 open; phone scrub FAILS (decode to the #921 worker) | Yes (new) |
| 15 | Height-scale display (face default; Hawaiian in Hawaii; toggle; scale always labelled) | client lane | **gate not yet registered** (a checklist so far: 3 themes x devices, label always present, rating uses the physical height only) | decided by research (D-078) | Display |

## Dated updates (append only)

- **2026-11-16 08:35Z, rank 10 (D-072 v2): FAIL.**
  - Scored by the advisor (relayed by the director): FAIL on P3, the hole-buoy rule 2 fired on 0 of 5 required days.
  - Recorded as a FAIL with NO tuning on the November data.
  - A new rule 2 means a new pre-registration scored on unseen days (LESSONS L-S27). Rule 1 v2's status is as #949
    records it.
- **2026-11-16 22:15 EST, ALL served items: SHIP ON (owner).** David, 22:09 EST: "It needs to ship on, not off. With kill
  switch. I get confused and forget to turn things on once they are merged. Make special tests to test and kill switch it."
  - Every served item ships with its code default ON at merge (D-065), with a kill switch and the kill-switch test suite
    (research log, 22:15 EST).
  - Its gate must still pass before the merge. Where this roadmap says "dark" or "David's word to flip", read: David's
    word to MERGE, with the item ON.

## Watch list (not ranked)

- ICON precip at 0.125 deg conservative remap (decided by research): frame-carry, gate mass ±1%, peaks ≥ 90%.
- DWD EWAM for European spots; ECMWF period-band heights as a groundswell cue.
- T3 on-device optical wave gauge; T4 Oahu lifeguard record (NCEI access unconfirmed).
- AIFS-ENS as a wind arm; open ML wave models (no open feed yet).
- WebGPU: dropped while MapLibre is WebGL2-only.
