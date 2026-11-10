# Backend memory-bound repair candidate

Scope: isolated, exact dev da34619e6cf57f5e493cac978e7670583e901971. No original worktree, flag, configuration, provider, publication or deployment changes.

## Evidence

Render recorded oomKilled at the 2 GiB limit at 01:21:22Z and 22:27:40Z on 2026-11-08. The latter occurred while GFS marine waves series loaded global_mid products and EURO donors; four hour timeouts preceded the restart. This correlation is not proof that either defect below was the sole OOM cause.

Source-bound offline regressions reproduce two broken bounds: cancellation releases the mid-load semaphore while its underlying thread keeps working, and ServedStore's 64-entry memo retains full-grid vectors outside ProductStore's vector budget. Six baseline cases fail for those behaviors or the missing budget. The initial network-blocking harness failed to allow Windows asyncio's loopback self-pipe; that failed receipt is retained separately and is not counted as a code regression.

## Candidate

mid_res_tier keeps the load permit until the real worker task finishes, with shielded caller waiting and late-error retrieval. Queued cancellation starts no worker. The strided fallback retains the same permit.

consensus_serve retains at most 120000 vectors as well as 64 entries per serving view. It serves an oversized composition without caching it. Composition, model selection, horizon and scientific flags are unchanged; this changes no served number. Existing parity tests and the added byte-equivalence case pass.

## Verification and holds

Before expanded edge cases: 251 affected tests passed, with three existing Pydantic warnings. Expanded isolated regressions: 11 passed. Changed-file lint and weather-pipeline 800-line check passed. Final combined run is recorded in the private local investigation report.

Independent read-only review found no actionable P1/P2/P3 implementation defect. Its queued-cancel, late-failure, strided-fallback and mixed-budget coverage suggestions were added. Direct cancellation of loader tasks during process shutdown is outside normal request cancellation; no in-application caller doing that was found.

Local interpreter: Python 3.12, 46/50 pinned packages match; anthropic, pydantic-ai-slim, pygrib and uvloop absent. This is not CI or production acceptance. No live load test, RAM reduction measurement or OOM cure claim. CI test-floor/lane integration, current-base reconciliation with the weather owner and production qualification remain pending. No shared floor or original weather-owner files were changed.
