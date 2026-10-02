# 2026-10-02 session consensus-flip-sweep: consensus PR C, the displayed-catalogue sweep the flip still needed

A temporary git worktree in the session's scratchpad (long paths enabled for git: the repo's `audit/` filenames exceed
Windows MAX_PATH there), branch `claude/consensus-flip-sweep`, rebased onto `origin/dev` @ `c4a59c01` (#219's merge).
Session "Project memory optimization for raw surf app" (it also restructured CLAUDE.md, #218). Owner: "go, build PR C".
Times are clock reads (`date -u`) or platform timestamps (L-P10). **This change moves no served number**: it is an
instrument (README rule 5); a SCOREBOARD row follows its first reading.

## Ownership and order (02:50Z to 03:40Z)
- "Concurrent models audit and work" confirmed it does not own PR C, and that #219 records `pr_merge #217` (seq 288).
  Agreed order: dev -> #219 (seq 288-293; merged 03:43Z as `c4a59c01`) -> its cached-product guard (stacked on #219) -> this
  PR; the far-zoom branch re-chains last (the owner approved that chain order at 02:20Z). This PR's ledger lines are
  re-chained onto dev's head when its turn comes (L-P21). It records neither #217 nor #219.

## Why a new instrument (read-only, 02:50Z to 03:30Z)
- STATE's PR C asked for three things. Two exist: the ledger's consensus grade by coast and by sea state (#158, #160)
  and the BUILT shadow graded in the ledger and the nearshore judge with a construction check (#169). The third, "a
  before/after catalogue sweep of displayed heights", did not.
- `science_shadow_ab.py` cannot answer it: it replays each spot-hour's PERSISTED inputs, and the offshore height is one
  of them. The flip changes that input itself, and the consensus value at a spot-hour is persisted nowhere.

## Built (03:30Z to 04:00Z)
- `backend/scripts/consensus_flip_sweep.py`: the PRODUCTION precompute (`precompute_spot_ratings` -> `rate_one_spot`)
  three times over one restored manifest, one spot list and one set of valid times: A = today's lane
  (`CONSENSUS_SERVE` '0'), B = the candidate ('1' + `CONSENSUS_SERVE_KEEP_GFS` 'hawaii'), A2 = A again after B on the
  first hour (a null control that brackets B in time). A pass-through `ObservedResolver` records each marine answer's
  `product_id` (-> the manifest's region) and `source_dataset` (`consensus:equal_mean` marks a swapped frame: the
  producer's PROVENANCE, carried by `merge()` and copied by the sampler; a test pins that chain on real products).
- Flags are NOT declared by the sweep: it reads `precompute.yml`'s env literals at run time (the lane-parity regex,
  widened to every quoted upper-case literal). Only `PREFETCH_WINDOW_DAYS` is widened, to keep +72 h frames warm in L1.
- The controls REFUSE (exit 3): no paired spot-hour; A2 differs from A; arm A answered a swapped frame; a kept region
  moved, swapped, or was never attributed; a spot-hour moved without a swap; nothing swapped.
- Read-only: `main()` makes `ProductStore._upload_to_supabase` and `_delete_from_supabase` raise before the L2
  restore and counts any attempt. (`get_manifest()` can re-upload a pruned manifest from inside a read; that write is
  caught by its own handler and now blocked.)
- `.github/workflows/consensus-flip-sweep.yml`: dispatch (hours, keep_gfs) and a pull request that changes the sweep,
  so this PR carries its own first reading; the JSON (summary + every paired row) is an artifact. It declares no
  env literal (tested).

## Verification (local, before push)
- `tests/test_consensus_flip_sweep.py`: 23 tests, claimed by `--lane chain`; the real precompute with a fake resolver
  that reads the real switch; each refusal broken and read back. 20 of 20 mutations turned a test red, including the
  null arm run before B, KEEP_GFS dropped from B, the switch left on in A, the swap tag drifting from PROVENANCE, and the
  regional-tile check removed.
- Every backend test that reads `.github` (27 files) + consensus serve: 384 passed, 39 skipped (the quarantined
  `test_debug_consciousness.py` excluded, as CI does). CI's flake8 gate clean; both files under 800 lines.
- Chain floor 140 / 1734 -> 141 / 1757 in this commit: hosted run 36961412429 on dev `c4a59c01` read 140 files / 1740;
  + 23 = 1763, - 6 = 1757; `_FLOOR_SET_FROM["chain"]` -> 1763.
- NOT yet run on live data: the PR's own run of `consensus-flip-sweep.yml` is the first reading.

## First reading: REFUSED by the null control (runs read 04:55Z to 05:03Z)
- Both PR runs refused, as designed: 36963098550 (`7d623b26`, 04:07-04:26Z) and 36963244735 (`7f9ec5de`,
  04:27-04:53Z). 1,773 spots x 4 hours: 6,704 pairs, **388 excluded as run skew in BOTH runs** (A and B answered from
  different model runs), and the null control (A vs A2, hour 0) differed on 101 and then 103 of 1,773 spot-hours.
- What the refused report showed, recorded so it is not lost, NOT a verdict: swapped 71.6% of pairs, level changed
  12.9% (up 11.0%, down 1.9%), height ratio p10/p50/p90 0.95 / 1.03 / 1.31, |dheight| p50 0.33 ft / p90 1.41 ft,
  >= 1 ft on 18.2%; Hawaii unmoved (no kept-region refusal), and no pair from the same run moved without a swap.
- Supabase `429 too_many_connections` met at each run's OWN prefetch (12 and 57 lines; 13 and 55 failed prewarms) and
  Open-Meteo tide 429s (272, 446). The production precompute's 02:34Z run (36956225481) shows the same (28 lines, 29
  failed prewarms, 438 tide-unavailable), so the bursts are this pipeline's, not the sweep's alone.
- Not a mid-run ingest: run 1 ended before the 04:46Z forecast-ingest started, and `get_manifest()` reads the local
  manifest (mtime-cached) without an L2 refresh. The skew count being identical (388) under different 429 counts argues
  against load luck. Hypotheses, untested: product selection depends on in-process state an earlier arm built (the L1
  cache, the dynamic index), or a product that fails to load falls back to another run.
- Instrumented in this commit (no fix yet; the cause first): per-arm UTC windows and signature counts; every skewed and
  null-differing spot-hour with both sides' product, run, coverage status, dynamic flag and fallback reason, aggregated
  in the report and in full in the artifact. 24 of 24 mutations red (4 new: both diagnostics blinded, the counter deaf,
  the counter left attached). Tests stay 23 (extended, not added), so the chain floor is unchanged. Commitment seq 295
  stays open until an instrumented run reads.
