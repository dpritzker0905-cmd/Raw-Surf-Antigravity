# Backend memory bounds: local qualification, 2026-11-09

## Scope and evidence

This candidate is isolated on dev `d39fb0c4a6b8224ee02b0509ec02c9cae8afa1c8`. The prior November 8 candidate and other working trees are preserved. No production configuration, scientific flag, restart, deployment, public branch, or pull request was changed during qualification.

Render recorded a 2 GiB `oomKilled` at 2026-11-09 12:28:41Z and availability at 12:29:06Z. Memory was already about 2.0 GB before a periodic restore logged an 18,160-entry manifest at 12:28:39Z. This timing supports investigating retained objects and allocation peaks; it does not establish a sole OOM cause. The last sampled process health at 13:08Z was healthy on d39fb0c, RSS 597.8 MB. That is a point-in-time reading, not evidence that this local candidate is deployed or that the recurring problem is solved.

The existing restore helper already releases downloaded parsing intermediates. No duplicate restore-path change was added.

## Three bounded owners

1. Mid-resolution loading retains its semaphore permit until the underlying thread finishes, even if its caller is cancelled. A cancelled queued request starts no load. The strided-load fallback keeps the same permit.
2. Served compositions retain at most 120,000 vectors as well as 64 entries per serving view. Oversized compositions are returned uncached. This is not a process-wide RSS cap.
3. Bight frame plans share one manifest-products identity/length token for the plan cache instead of retaining a full historical manifest in each inactive entry. A generation change clears the plans; publication checks token identity so an already-building old plan cannot repopulate a changed cache. Plans still have the existing entry cap.

The third defect is bounded but substantial: frame requests interleaved with manifest refreshes can retain up to 128 distinct historical product-list generations under the old entry limit. Refreshes without intervening frame requests do not create that multiplicative retention. Active requests and other caches may separately retain manifests. A delayed request can select an older token, so this claim is one cache-owned generation, not globally only the newest manifest.

Selection, donor weights, scientific flags, and served numerical results are unchanged. The new tests require genuine blended cells and independently check the GFS/EURO mean, rather than accepting equal raw fallbacks.

## Verification

- Final affected suites: **260 passed**, three pre-existing Pydantic warnings. Includes the 15 new cases plus Bight, consensus, nearshore, marine/wind mid-tier, exact-time, strided series, and deadline coverage.
- The 15 new cases also pass with pytest's default import mode.
- Final four manifest cases against the hash-verified prior implementation: **2 failed, 2 passed**. They expose eight retained generations instead of one and an old in-flight plan repopulating the new cache. The same four cases pass against the repaired implementation, including real-blend arithmetic.
- CI floor/lane guards: **73 passed**.
- Changed-Python fatal-error lint, pipeline 800-line check, and diff whitespace check passed. The size checker reports 35 existing warnings and no violation.
- Independent read-only review found no blocking implementation regression. Its missing blend-assertion recommendation was addressed before the final affected run.

The first broad run had 54 temporary-directory setup errors because the offline runner changes into backend and its relative basetemp parent did not exist; 206 tests passed. The successful final run uses an absolute isolated basetemp. Two diagnostic baseline replay attempts failed collection before execution; a package-preserving replay then produced the specific two expected failures above. These failed receipts are retained and are not counted as product regressions or passing evidence.

All qualification used Python 3.12 with external socket connections blocked and test database settings. Four declared packages are absent locally: anthropic, pydantic-ai-slim, pygrib, and uvloop. These results describe this local environment, not the complete declared CI or production environment. No live load test, measured production RSS reduction, or OOM cure claim is made.

## CI integration and release gate

The existing selector places all three new test files in the chain lane. The partition remains exclusive: 224 guards, 210 chain, 369 estate, two fastmcp exclusions, one quarantine, 806 tracked files total.

The official rederive tool used hosted dev run 42564071128 (3,626 passes, 207 files) and the dev map (3,627): `max(3626, 3627) + 15 = 3642`, file floor 210, pass floor 3,636 with the existing margin of six. Only the isolated chain floor and its paired map changed; guards and estate floors are untouched. The 3,642 number is a projection, not an observed hosted result.

Publication and merge remain held for weather-owner coordination, exact-current-base reconciliation, and passing hosted checks on the resulting head. No shared branch was edited. Before release, verify current deployment controls and authorization separately; these local bounds do not prove the production OOM is eliminated.

## Draft-publication update, 16:10Z

The owner subsequently authorized pushing qualified work for hosted validation. A draft PR to dev is now authorized; merge remains gated on exact-head checks and coordination of the chain floor with the weather owner. The earlier publication hold above describes the qualification checkpoint, not this later authorization. No deployment or restart is requested.

A fresh Render read at 16:05Z still reports d39fb0c as the live deployment, no newer failure or availability event than the 12:28 OOM and 12:29 recovery, and platform memory of 761,024,500 bytes at 16:04Z. Platform memory and process RSS are different measurements. Recurrence remains possible; the local fixes are not deployed.

Final docs-only memory audit: zero failures, 95 warnings, six notes. Outstanding historical ledger/STATE warnings were not changed by this scoped candidate.

Timestamp correction: the preceding update heading should read 16:07Z. The typed 16:10Z heading is not a measured event time; the clock read was 2026-11-09T16:07:30Z.

## Publication result

Commit `31547f60de6fbbbdf6165d4aff3fb196e0c4b30d` was pushed to `codex/backend-memory-bounds-20261109` with existing commit/push hooks intact. The ledger guard reported zero problems, and the explicit floor guard passed. Dev and main were not updated.

Draft PR creation returned GitHub HTTP 403, `Resource not accessible by integration`. An exact-branch PR search returned no results. The denied operation stopped; no alternate gh/browser creation route was attempted. There is no PR or hosted CI acceptance to report. Weather-owner coordination and exact-head CI remain merge gates. This publication receipt is retained locally pending the next authorized documentation commit.

2026-11-10T00:22Z correction: the committed header "Draft-publication update, 16:10Z" was an estimated minute. The actual checkpoint was 16:07Z, supported by the clock read 2026-11-09T16:07:30Z. The earlier timestamp-correction paragraph is unchanged. This correction now also has the matching ledger entry required by the clock audit; the historical header is preserved.
