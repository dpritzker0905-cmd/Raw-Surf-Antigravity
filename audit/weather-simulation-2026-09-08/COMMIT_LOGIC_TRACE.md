# Weather work: commit history and preservation trace

September 8, 2026. History snapshot: `c4cb14db35726c69e6d226e584ed5eb64f91d8ed`. This is a bounded semantic audit of critical repair lineages, backed by a complete index of the history available here. It is not certification of every historical commit or scientific readiness.

The audit found a real regression in our latest metadata patch: it unnecessarily awaited a promise even when metadata was already live, losing the historical synchronous URL-resolution path. A synchronous animation-callback test failed before the correction and passed after. The correction retains demand-only requests and restores the warm-cache behavior. Full frontend verification: 250 suites, 2,381 tests passed; changed-file ESLint and LOC ratchet passed.

The next live defect is now clearer. At the snapshot commit, all PR #15 checks passed, but marine run [34283809745](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/34283809745) failed its visual budget: zero transport errors, 354 analyzed frames, 162 water samples, one MULT0_FRAME and one SETTLED_STEP of -21.5 at zoom 4.724. Data contract passed. The settled step exceeds the unchanged magnitude limit of 16. Removing unnecessary metadata requests did not repair that visual discontinuity.

## Recoverable history

Fetched origin branches/tags and all 15 available pull-request heads; the repository is not shallow. Indexed every commit reachable from these refs plus available local reflogs:

| Measure | Count |
|---|---:|
| All indexed commits | 4,229 |
| Reachable from fetched/local refs | 4,229 |
| Additional reflog-only commits | 0 |
| Reachable from origin/dev | 4,199 |
| Reachable from origin/main | 4,106 |
| Weather-path candidates | 2,503 |

Dates span April 15–September 8, 2026. Root: `b8aa692f5528f859a899f1ff12d1cc99d2558dcb`. Monthly counts: April 586; May 1,139; June 778; July 967; August 736; September 23. Reverse topological order preserves parent relationships; author timestamps alone do not establish causality.

Local artifacts: [full commit index](commit-history/all-commits.jsonl), [weather candidate index](commit-history/weather-path-commits.jsonl), [refs](commit-history/refs.txt), [summary](commit-history/summary.json), [hash manifest](commit-history/SHA256.json). Each commit record includes SHA, parents, dates, author, message, changed paths, and dev/main membership. Reproduce with `python audit/weather-simulation-2026-09-08/build_commit_history.py`; doing so creates a new snapshot and changes its hashes.

Coverage limits: deleted/unreachable server commits, expired reflogs, unpushed commits on other computers, and inaccessible conversation histories are not guaranteed. The weather path filter is deliberately broad and does not semantically classify all 2,503 candidates. Author names and AI co-author trailers establish recorded attribution, not an independently verified model execution. Historical handoff narratives are leads to verify against code, not present-state authority. The full index remains local; this report and reproducible indexer can travel with the repair.

## Logic and protected behavior

Commit links resolve in [the repository history](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/commits/dev/). Use each SHA with `git show` to inspect the original rationale and exact diff.

| Original repair / lineage | Reason and behavior to preserve | Current evidence / consequence |
|---|---|---|
| `6b4e2e7d` → `a90e7cbb`: synchronous metadata resolution | Cached, genuinely live metadata should resolve raster URLs within the current animation callback. | Our `c4cb14db` added an unconditional await. New regression failed on that source and passes with a conditional await only for missing/non-live metadata. This is an actual correction, not an inferred risk. |
| `ddc7e22d`: metadata request lifecycle | Deduplicate shared in-flight requests; do not mark a failed fetch live; an individual caller must not cancel the shared fetch. | Current mapUtils retains an in-flight promise slot, adds LIVE only on success, clears the slot in finally, and does not attach a caller abort signal. Current patch does not change this helper. Current helper may return cached axes while background fetch proceeds; warm/cold behavior should not be conflated. |
| `5f2ad03a`: prewarming and transition clocks | Original performance change combined seven-model prewarming with target-change transition timer resets. | Removing unconditional seven-model warmup is intentional: native marine has no active raster consumer. Active pressure and explicit marine fallback still request their model metadata. `lastTargetSlotsRef` and transition-start reset remain. Do not restore unrelated requests merely to preserve the old commit wholesale. |
| `fd2ec5a4`: same-target dedup | Activation/layer/model effects must not abort each other's identical model/layer/hour request. A genuinely different target can supersede it. | Both current abort gates in useMarineDataFetcherCore retain this comparison. Core and helper files are byte-identical in Git to the September audit baseline; later viewport replay/lock healing refinements remain. |
| `04a86cf6`: cold-ingestion empty grids | Do not cache HTTP-200 empty/non-renderable grids. Bounded retries may heal transient ingestion gaps; terminal coverage failures must not loop. | Cache and retry source unchanged since baseline. Existing marineEmptyGridRetry tests execute and pass in the full suite. Later terminal exclusions and stale retry policy are retained; do not reinstall the older whole file. |
| `321338d1`: abort recovery and huge grids | An obsolete abort must not blank a newer target; anomalous >250,000-cell grids must not reach the expensive encoder. | Current core retains target-changed recovery guard; mapping helper retains the cap. Source unchanged since baseline; marineOversizedGrid tests pass. This does not establish all live races are solved. |
| `6ea4687e` → explicit correction `fff3cd90` | The attempted native ICON horizon cap removed intended estimated-extension capability. Restore the advertised 14-day/336-hour UI window while repairing reliability. | LayerAccessResolver still uses `max_forecast_hours`; its source is unchanged since baseline. Preserve disclosure of native vs estimated data and the advertised capability; do not hide failing hours. |
| `5e181f69`, `071ce572`, `60f724d0`, `2ac9631f` | Keep earliest eligible ledger entries, persistence control, exact paired head-to-head metrics, and a monitor that goes RED for paired loss. | forecast_skill.py is byte-identical to baseline; its merge keeps existing rows first and paired metrics remain. Focused skill tests rerun. Evidence replay is not a green accuracy grade; no scientific thresholds changed. |
| September `6dfe9703` → merge `97ae7948` | Total significant wave height and primary swell are distinct quantities. Unknown cycle is not ingestion time; newer-cycle preference must respect equivalent source/product scope; retain the loaded replacement against pruning races. | These are the September repair contract documented in canonical memory and earlier red/green evidence. This turn changes only metadata URL scheduling and a regression test; it does not edit these backend boundaries. Their scientific/runtime limits remain open. |
| `045432ee` | A seam probe must establish global geometry before applying a dateline contract; incomplete observations cannot certify rendering. | Later evidence must keep geometry validation and REFUSE/FAIL distinctions. A clean transport result can expose visual failures; it must not automatically pass them. |
| PR15 `f18acffb` → `16cff871` → `6cdcde91` | Replay accuracy RED offline, retain approved aggregate integrity evidence, attribute network failures without secrets, and keep measured CI lane floors. | Previous independent controls reject tampered evidence and individual stale floors, and separate transport REFUSE from hard renderer FAIL. Raw private archives remain runner-local. |

[history-preservation.json](history-preservation.json) records Git-blob hashes for seven protected files and selected executed regression assertions. All seven match baseline `524d8c49`. Hash equality proves these files were not edited by our September repairs; it does not prove unchanged callers or production behavior. Source inspection and tests supply additional, bounded evidence.

Other historical features (coastal-mask ordering, optional ocean-mask buffer, fallback disclosure, ARBITER provenance, native/estimated blending) are present in the indexed history but have not all received new intervention tests in this pass. Before modifying any such path, trace its latest corrective lineage and existing canonical task, rather than assuming this report certifies it. No speculative restoration of older persistent-cache code or broad rollback is justified by a commit message alone.

## Jacobian lens: controlled changes and response

Here the lens means isolating inputs and inspecting their effects, not claiming a numerical physical Jacobian for a React hook.

| Controlled change | Held fixed | Observed response | Valid inference |
|---|---|---|---|
| Cached axes → genuinely live metadata | Raster model/layer and synchronous animation callback | Restored path resolves URL without crossing a promise boundary; previous patch fails the assertion | The historical warm-cache timing contract is now explicitly guarded. |
| Native marine → pressure raster / explicit fallback | Hook mocks and request recorder | Native requests none; active pressure/fallback requests the required metadata | Removing startup prewarm need not delete fallback capability. |
| Transport error removed from recorded visual input | Same recorded frames in earlier independent control | REFUSE becomes evaluable; injected hard renderer error still FAIL | Transport and rendering must be evaluated separately. |
| New live run after demand-only repair | Same named staircase diagnostic, but live data/time are not controlled | Zero transport errors; settled visual step still FAIL | Unnecessary network dependency is absent in this run. This is not a fully controlled proof of the visual root cause. |

## Next steps, in order

1. Preserve this warm-cache correction and its regression on PR #15; require checks on the new exact head. Green checks at `c4cb14db` are evidence for that commit only. Keep the full history snapshot and canonical memory accessible at handoff.
2. Diagnose the remaining staircase settled-step with fixed trace/time/model/viewport. Around t=331272–332329, correlate multiplier changes, texture/product identity, LOD selection, transition clocks, and sampled water brightness. Replay with one factor changed at a time. Both observed findings remain symptoms until that intervention establishes a mechanism; do not label them a specific shader or provider bug yet.
3. Add a regression that fails on the established mechanism, apply a bounded repair, then rerun the same staircase and relevant protected tests. Preserve visual budgets, retries, no-data truth, the full ICON window, and source identity. Require clean live visual evidence before claiming rendering release readiness.
4. Resume calibration/skill provider-cycle provenance under the existing canonical tasks. Preserve unknown historical identity as unknown; do not fabricate backfill. Then quantify paired error by source/cycle/lead and compare persistence. Current RED remains a science blocker, not a reason to relax the monitor.

Accuracy evidence still reports MAE 0.424 m and a +24h paired loss versus persistence. The approved archive integrity checks do not identify a coefficient to change. Nearshore validation and skipped jobs remain separate open gates. The scope is weather correctness and its verification, not a general renderer rewrite or a competing task register.

## Evidence and limits

- `history-warm-cache-red.log`: before-fix timing test failure; `history-warm-cache-green.json`: four focused tests pass.
- `history-full-frontend.json`: 250 suites / 2,381 tests pass. The working tree includes the timing correction; this is not a production result.
- `history-skill-tests.xml` and `.log`: 46 focused current ledger tests pass. This Windows interpreter lacks two declared production packages; these results do not establish Linux dependency parity.
- `history-eslint.log`, `history-loc.log`: changed-file lint and unchanged LOC ratchet pass. Initial direct Vitest/Jest invocations were unsuitable for this CRA project; the successful full run used its CRACO runner.
- `history-pr-status.json`: all PR checks at c4cb14db passed. `history-marine-status.json` and `marine-demand/zoomlab-nightly-34283809745/verdict.json`: separate live visual failure.
- Canonical authority remains `program/weather-simulation/CURRENT_HANDOFF.md` and `CURRENT_KNOWLEDGE.json`; all 71 task / 40 objective historical rows must remain preserved.
