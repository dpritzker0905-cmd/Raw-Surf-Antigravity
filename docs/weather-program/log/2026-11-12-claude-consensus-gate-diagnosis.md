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

## Addendum (2026-11-12, advisor accuracy notes)

- **Staleness.** Every number above is quoted from SCOREBOARD/STATE as of dev a7c41dd2a (STATE's consensus lines date from 2026-10-17/18). I found no newer consensus reading in either file; I did not re-measure anything. Treat all of them as 3-4 weeks old.
- **In- vs out-of-sample.** The 0.196 vs 0.229 (train n 57,992) is the rule-selection set, out of sample for the hawaii/atlantic_se rule only; the hawaii 0.443->0.543 and atlantic_se 0.222->0.250 figures are a single held-out week whose per-lead n and independent-station count I did not record. They are context, not gate evidence. No held-out n per lead or independent-station count exists in this PR.
- **'Unknown' is a data condition, not proven cause.** It is a real condition (lane answered by the direct-point path, `product_id=None`), not a labelling artefact in the sense of a missing field. But it is not shown to cause the +0.13 m: that needs removing or repairing those rows and a random-row null control of equal size, neither of which was run.
- **-0.03 m is offline.** The ~0.03 m gain is a computed-equal-mean figure from the ledger, not a served-shadow result; the built shadow has never matched it at +48/+72 h.

## Addendum 2 (advisor route note; read `log/2026-10-17-served-height-gap.md` Table 7c, §"cause NOT established")

Narrowed question: why is the built product not the mean of its members at +48/+72 h (median |shadow-equal| 0.126/0.132 m,
one-sided, bias +0.081..+0.103 m in 12 of 12 monitor reads) when it is at +24 h (0.003 m)? Acceptance instrument:
`forecast_skill_consensus.shadow.by_lead[*].shadow_minus_equal_m` (forecast-accuracy-monitor.yml ~line 35, WARN > 0.02 m).
Still no stored data here, so these are code-read hypotheses, ranked, none measured:

1. **Different source for the same member (best fit to the 'unknown' tier).** The equal side is the members' LANE values at the
   buoy (direct Open-Meteo when no stored frame covers it, `product_id=None`); the shadow side is a stored frame picked by
   `manifest_point_selection.choose_for_point` (`consensus_ingest.make_chooser`). If stored EURO/ICON coverage thins with lead
   (global_mid/coarse tier, snapped hour, estimated tail), the two sides diverge exactly where the ledger shows it.
2. **Masked-cell fallback biases the shadow high.** `_build` runs with `unblended="mask"`: any cell a member cannot answer is set
   invalid. At the buoy the sampler then takes `nearest_ocean_fallback` / `bilinear_ocean_masked` (sampler.py ~523-580), i.e.
   the value of a neighbouring, usually more exposed, ocean cell. That is one-sided high and grows when member coverage near
   the coast shrinks, as it would at longer leads. The shadow row's `interpolation_method` (not in the ledger row today) would show it.
3. **Build-time vs pass-time members** (Oct 17 hypothesis 1): member runs at ingest time differ from those at ledger time.

Discriminating read, one pass over the scored archive plus two stored +48 h shadow frames, all in `shadow_minus_equal_m` terms:
signed shadow-minus-equal split by (EURO tier, ICON tier), by shadow `interpolation_method`, and by `frame_off_h`; and in the two
frames `diagnostics.consensus.cells.kept_primary/masked` and `member_missing` per lead. Proof standard (advisor note 3): repair or drop
the flagged rows, the +0.13 m must vanish, and dropping the same number of random rows must not.

Ownership respected: no edit to `consensus_serve.py`, `skill_consensus.py`, `skill_mos.py` (move 4). If cause 2 holds the fix is in
`consensus_product._build` (carry the member answer through to a cell only where the sampler's read is a real bilinear, or keep
GFS's cell and flag it); I have not written it because the cause is unproven. CONSENSUS_SERVE untouched.
