# 2026-11-05 · claude · skill-weighted CONSENSUS ("layer 3"): inventory, pre-registration, STOPPED

Branch `claude/skill-weighted-consensus`, draft PR against `dev`. The owner asked (2026-11-05) for "layer 3": turn
the equal-weight CONSENSUS lane into a skill-weighted blend of the members, then stop and report.

**Outcome: REFUSED for now, with no served number changed.** This session cannot reach any data that could fit the
weights, so it wrote the pre-registration and a plan and stopped (task step 1: "if the data cannot support a fit,
say so and stop with a written plan; do not invent data"). No flag, no code, no workflow dispatch, no live-backend
call, no env or secret change.

`memory_audit.py --docs-only`: 0 FAIL, 71 WARN, 8 NOTE. Every OVERDUE item is a live dev-site read-back, which this
task forbids, so none were done.

## 1. Inventory: per-member skill data

| Source | Members | Where | Usable here? | Why not |
|---|---|---|---|---|
| Skill ledger scored rows (`calibration/skill/scored-*`) | GFS `raw_surf`, `raw_surf:EURO`, `raw_surf:ICON` on the same (buoy, target, lead), NDBC deep-water buoys, leads 24/48/72 | Supabase Storage, `weather-products` bucket | **No** | The sandbox egress proxy refuses `*.supabase.co` (`connect_rejected`, 403), and the session holds no storage credential. No artifact or log exports the per-pair rows: precompute prints only the `[forecast-skill] ledgered=..` summary, and `skill_consensus.consensus_report` (`equal` / `debiased` / `weighted` / `by_region`) is written onto the calibration report, also in Supabase. |
| Nearshore judge consensus arm (`--consensus`: `MEMBER_AB`, `CONSENSUS_AB`, `PAIR_AB`) | all three, through the station transform | `nearshore_report.json` artifacts (90-day retention) | **No: 1 day** | Dispatch-only (default `'0'`; a scheduled run never grades it). The workflow_dispatch run list has 11 runs in total; the arm ran on 3 of them (36502684770, 36503616233, 36505446455), **all on 2026-09-29**, each a 24 h window. The report stores aggregates, not rows. That is far below the >= 14-day gate. |
| Eval harness / default-on history filter cache | **GFS only** (`eval_replay`: "v0 replays GFS only"; CONSENSUS_SERVE "needs EURO and ICON") | Actions cache | **No** | EURO was only ever an input substitution from ECMWF open data, scratch-only (Bight log §6). There is no ICON. |
| Judge scheduled arms (MOP grid, NWPS, MOP, legacy friction, bulk) | none per member: served GFS vs third-party products | artifacts | n/a | These grade different products, not GFS/EURO/ICON against each other. |

The data that *would* support the fit exist: the ledger has scored all three members on identical hours since
September (`skill_consensus` already computes an inverse-MSE `weighted` arm on a rolling held-out week, globally,
measurement only). They are simply not reachable from this sandbox. Nothing here was estimated or made up.

## 2. Pre-registration (committed before any scoring)

`evidence/skill-weighted-consensus-preregistration-2026-11-05.md`:
- **Formula:** per-region inverse-MSE weights on Hs, with shrinkage to 1/3 (`lambda = n_eff / (n_eff + 30)`, 0
  below 10 station-day blocks) and a 0.10 floor.
- **Windows:** fit 10-06..11-04, a 1-day gap, test **11-06..11-26** (future; scorable from 11-30).
- **Regions:** 5 NDBC coasts with declared boxes; everything else, and every untestable region, stays equal weight,
  so sparse regions cannot get worse by construction.
- **Metric:** paired |err| difference against the current equal mean.
- **Gate:** storm-block CI (#727's method), >= 4 blocks and >= 30 station-days per region, Holm, a pooled 0.005 m
  margin, no region worse.
- **Controls:** identity null, 200-shuffle label null, and a +0.30 m ICON injection as the positive control.

## 3. Plan (for the owner and the next session)

1. **Scoring path (read-only, no Render):** a script, `backend/scripts/consensus_weights_gate.py`, that reads the
   scored archive through `skill_scored_archive.read_month` and `buoy_calibration.load_calibration_rows_l2`, and runs
   §2–§7 of the pre-registration exactly. It needs a runner that holds a storage read credential. The existing
   precompute and calibration lanes do; a new step there, or a small dispatch-only workflow, would work. Either is
   an owner decision, because it adds a credentialed CI read. Run it once, on or after 2026-11-30. Cost: one read of
   the Oct and Nov archive objects. No /point calls, no Render.
2. **On PASS:** implement per §8 of the pre-registration (`CONSENSUS_SKILL_WEIGHTS`, default ON, kill `'0'`),
   weights JSON committed, floors re-derived, SCOREBOARD, DECISIONS, ledger. **On FAIL or REFUSED:** record why;
   the lane stays equal-weight.
3. **Not chosen:** arming the judge's consensus arm on schedule. It would grade the members nearshore, but it costs
   3x the /point calls on the one shared Render CPU, about twice a day. That is the owner's call and is not needed
   for step 1.
4. Satellite altimetry for global weights stays a later step.

## 4. Records

- Ledger fragment: `ledger.d/claude--skill-weighted-consensus.jsonl`, with a finding (the inventory) and a
  commitment (score on or after 2026-11-30 by the pre-registered rule, or re-date).
- No SCOREBOARD row, because no served number changed. No DECISIONS entry, because nothing was decided. The
  pre-registration is evidence, not a decision.
