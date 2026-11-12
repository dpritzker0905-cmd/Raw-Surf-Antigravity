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

## Addendum 3 (2026-11-12, after David's "Yes, approve read"): the split already exists, in public aggregates

No Supabase credential exists on this machine (the main checkout's `backend/.env` has one unrelated line), so I did not
pull the archive myself. The repo's own read-only workflow `scored-rows-gate.yml` holds the CI secrets and prints
`scored_rows_analysis.construction` (GET-only, aggregates, no rows). Its run 41389448778 (2026-11-02, `gh run view --log`) is
the instrument for every number below; run 43174501916 (dispatched 2026-11-12 on dev) is the fresh read (Addendum 4).

Shadow minus ledger equal mean, built CONSENSUS shadow, regional tier, run 41389448778 (n = paired pairs, NOT independent stations):

| lead | member tiers (EURO / ICON) | n | shadow-equal signed mean | shadow bias vs buoy | equal bias vs buoy | shadow MAE | equal MAE |
|---|---|---|---|---|---|---|---|
| +48 h | global_mid / global_mid | 5973 | -0.055 | -0.047 | +0.008 | 0.293 | 0.290 |
| +48 h | unknown / global_mid | 8746 | +0.151 | +0.229 | +0.078 | 0.342 | 0.239 |
| +48 h | unknown / unknown | 2989 | +0.341 | +0.300 | -0.041 | 0.408 | 0.205 |
| +48 h | all (regional shadow) | 17760 | +0.114 | +0.149 | +0.035 | 0.337 | 0.251 |
| +72 h | global_mid / global_mid | 5121 | -0.058 | -0.071 | -0.013 | 0.298 | 0.295 |
| +72 h | unknown / global_mid | 7745 | +0.150 | +0.219 | +0.069 | 0.349 | 0.245 |
| +72 h | unknown / unknown | 2638 | +0.329 | +0.286 | -0.043 | 0.416 | 0.215 |
| +72 h | all (regional shadow) | 15551 | +0.112 | +0.136 | +0.024 | 0.344 | 0.256 |

Check: the +48 h rows weight to (8746*0.151 + 5973*-0.055 + 2989*0.341 + 52*0.283)/17760 = +0.114, the pooled figure.

What this proves and what it does not:
* PROVEN (aggregate): the whole +0.11 m sits in rows where a ledger member lane read 'unknown'. Drop them and the shadow reads
  -0.055 / -0.058 m (slightly LOW), median |diff| 0.002 m. 'Unknown' is therefore a real data condition, not a label: the three
  groupings (member tiers, frames, cycles) all separate it, and the same cut at +24 h (control) shows EURO=ICON=unknown +0.502.
* PROVEN: the shadow is the wrong side, not the ledger. In the flagged rows the shadow's own bias vs the buoy is +0.22..+0.30 m
  while the equal mean's is +0.08..-0.04 m, and the equal MAE is lower by 0.10..0.20 m.
* PROVEN FROM CODE: the build cannot degrade to GFS or to two members. `consensus_product._build` masks a cell when any member
  gives no answer (`unblended="mask"`, `member_answer` -> None on `_NO_ANSWER`), so the shadow is a three-member mean wherever it
  exists. Hypothesis 'EURO missing, GFS-only shadow' is REFUTED.
* NOT PROVEN: why the stored-frame shadow is high where the point lane found no stored product. Open: cycle/frame mismatch of the
  stored member frames at those cells, or an exposed neighbour cell (hypothesis 2). Needs `member_sources`,
  `member_frame_offset_cells` and `masked` from stored frames, which the aggregates do not carry.
* NOT RUN: the random-row null control (needs rows; the aggregate reconstruction above is the substitute and is weaker). Independent
  stations are not in the gate's output: n above counts pairs.

## Addendum 4 (2026-11-12): fresh read, run 43174501916 (dispatched on dev; success; aggregates only)

Replicates Addendum 3 at current dev; pairs, not independent stations; in-sample (all scored pairs since 2026-10-03, not held out).

| lead | member tiers (EURO / ICON) | n | shadow-equal | shadow bias | equal bias |
|---|---|---|---|---|---|
| +48 h | global_mid / global_mid | 10539 | -0.045 | -0.009 | +0.035 |
| +48 h | unknown / global_mid | 9653 | +0.143 | +0.237 | +0.094 |
| +48 h | unknown / unknown | 4103 | +0.332 | +0.308 | -0.024 |
| +48 h | all regional | 24377 | +0.094 | +0.143 | +0.049 |
| +72 h | global_mid / global_mid | 9956 | -0.045 | -0.020 | +0.024 |
| +72 h | unknown / global_mid | 8701 | +0.144 | +0.231 | +0.087 |
| +72 h | unknown / unknown | 3823 | +0.322 | +0.293 | -0.029 |
| +72 h | all regional | 22560 | +0.091 | +0.131 | +0.040 |

Where it moved: pooled +0.114 -> +0.094 (+48 h), +0.112 -> +0.091 (+72 h). Gate (<0.03 m) still NOT met.
Per coast, shadow-equal signed mean at +48 / +72 h: hawaii -0.177 / -0.185 (n 2014 / 1866, shadow LOW, the opposite sign);
atlantic_se +0.154 / +0.146 (n 5370 / 4984, median 0.056 / 0.051, so a heavy tail); pacific_ne +0.146 / +0.150 (n 10278 / 9490).
The pooled defect is pacific_ne and atlantic_se; hawaii offsets it. Control at +24 h: atlantic_se +0.000 (n 5663).
Not run: filter with nearshore arm (replays GFS only); null control; independent-station counts.
