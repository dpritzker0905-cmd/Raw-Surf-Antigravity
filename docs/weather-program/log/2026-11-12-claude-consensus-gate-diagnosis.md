# 2026-11-12 · claude · consensus gate (SOTA move 1): code diagnosis of the 'unknown' EURO rows, then STOPPED

Branch `advisor/consensus-gate-2026-11-12` from `origin/dev` a7c41dd2a. Docs only. No flag, env, workflow, deploy or
live call; `CONSENSUS_SERVE` untouched (code default "0").

## Outcome

The 0.13 m shadow defect was NOT reproduced here: **no stored skill-ledger data is reachable from this session** (same
blocker as `log/2026-11-05-claude-skill-weighted-consensus.md` §1). The scored rows live in Supabase Storage
(`calibration/skill/scored-*`); this checkout has no copy (searched the worktree, `docs/weather-program/evidence`, the
shared notes folders; no `eh0-cache`). I did not read a storage credential out of `backend/.env`: nobody authorised
a credentialed read in this task. So steps 1 (numbers), 3 (re-run shadow) and the gate are **not done**. What follows
is what the code proves, and the exact read that settles the rest.

## What 'unknown' means (code-proven)

- `skill_attribution.tier_of(product_id)` returns None for an empty id; `serving_provenance` then writes no `tier` key
  and `scored_rows_analysis.construction` (line ~234-235) prints `EURO=unknown`. `forecast_skill.rows_from_calibration_report`
  takes `product_id` from `buoy_calibration.calibrate_spots` (`marine.product_id`).
- `point_resolution._resolve_point_internal` sets `product_id` on every stored-product path (strict grid, dynamic
  regional tile, manifest item). The **direct-point path** (`source="backend_direct_point"`, upstream Open-Meteo,
  ~lines 440-670) builds the response with no `product_id`. The code comment at ~571 records the same signature
  ("source=backend_direct_point, product_id=None").
- Therefore a lane row with tier 'unknown' is a row where that lane was answered by **Open-Meteo's copy of the model
  at that hour, not by a stored EURO/ICON frame**. It does NOT mean the shadow product lacked a member.

## Consequence for ledger 1346/1347

The ledger's computed equal mean uses the EURO and ICON **lane** values. The shadow is built at ingest from stored
frames chosen by `manifest_point_selection` (`consensus_ingest` -> `consensus_product._build`, which may snap a member
up to the resolver's MAX_TIME_DIFF_S off the GFS hour and counts those in `member_frame_offset_cells`). At +24 h both
come from stored frames and agree (median 0.002 m). At +48/+72 h the lane often falls to the direct point while the
shadow still uses a stored (possibly snapped or estimated-tail) frame. So 'unknown' marks rows where the two sides use
DIFFERENT sources for the same member. The 0.12 m gap is then a statement that the stored EURO/ICON frames the shadow
used differ from Open-Meteo's copy at those hours; it does not say which side is right. The buoy score (shadow vs
observation), not shadow-minus-equal, decides that, and ledger 1346 does not report it split by tier.

Not proven: which side is biased. Candidates, in the order commitment 1336 lists them: (1) stored EURO frames at +48/+72
are the estimated tail (`euro_persistence_gfs_blend`) or a snapped neighbour hour; (2) ICON likewise; (3) the direct
Open-Meteo lane is the low one. Rows with both members 'unknown' read +0.238 m (1346), which fits (1)/(2) acting on both.

## The decisive read (needs a credentialed read, an owner decision)

On the scored archive, for held-out +48/+72 h shadow pairs, split by (EURO tier, ICON tier): MAE and signed bias of
SHADOW, EQUAL (lane mean) and served GFS against the buoy. Plus, from two stored +48 h shadow frames, quote
`diagnostics.consensus.member_sources` and `member_frame_offset_cells` against the manifest at ledger time.
`scored_rows_gate.py` / `scored_rows_analysis.construction` already compute the split; they add only the buoy score.
If SHADOW is the biased side, the fix is in `consensus_ingest.py` / `consensus_product.py` (member choice must refuse
estimated or snapped frames, or fall back to GFS for the cell with `unblended="mask"`); neither file is Codex-reserved
by the brief, but `consensus_serve.py` is, so any serve-side change is a patch proposal only. I made no edit because
the target cannot be chosen without the split.

## Gate status (honest)

| Gate | Status |
|---|---|
| shadow bias < 0.03 m at +48 and +72 h | NOT MET on the last reading (median 0.108 / 0.114 m, ledger 1346); no new reading |
| history filter + nearshore arm not worse | CANNOT RUN: `eval_replay` replays GFS only and the filter cache has no EURO/ICON (2026-11-05 log §1); a "NO_CHANGE/SKIPPED" would be no evidence |
| hawaii and atlantic_se | Held-out week: equal mean worse in hawaii 0.443->0.543 and atlantic_se 0.222->0.250 (SCOREBOARD 2026-09-30 16:31Z). Out of sample (train n 57,992): atlantic_se REFUTED (equal 0.168 vs GFS 0.181 = equal better), hawaii confirmed GFS better (0.313 vs 0.345); rule hawaii-only 0.192 vs equal 0.196 vs GFS 0.229. The flip as designed is `CONSENSUS_SERVE=1` + `CONSENSUS_SERVE_KEEP_GFS=hawaii` (#203) |

Sources re-verified: SCOREBOARD rows at lines 72, 73, 75; STATE lines 48-50; ledger 1336, 1346, 1347.
(Note the gap map says "SB:75" for GFS 0.229 vs 0.196: correct, train set, not held-out.)

## Not changed / owed

Commitment 1336 stays open. Owed: the decisive read above (one credentialed read-only job, or the existing
dispatch-only `scored_rows_gate` job on the owner's word), then the fix, then the shadow re-run, then the filter
once a mean-consensus arm exists in the harness (EURO/ICON replay inputs do not exist yet).
