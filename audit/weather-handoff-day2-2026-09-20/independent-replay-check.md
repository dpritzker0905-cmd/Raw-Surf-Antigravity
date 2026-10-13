# Independent replay verification

**Ready within the reviewed scope:** all 15 comparison rows and both archive-quality summaries in `scored-replay.json` independently reproduce exactly. This check uses only Python's standard library; it does not import `head_to_head`, the monitor, or other application code. Absolute errors are recomputed from forecast height minus observation height with decimal arithmetic, which avoids turning equal decimal errors into false wins through floating-point noise. [Executable calculation](independent_replay_check.py), [aggregate results](independent-replay-check.json)

The private snapshot is **17,686,467 bytes / 86,346 rows**, SHA256 `9012f386d32995ee66ec04a6a7ce816356481366e502bd9d135fce6c326e417e`, matching the root receipt. Its **55,425 trailing-week rows** have target times in the inclusive UTC interval **2026-09-13 16:29:23 through 2026-09-20 16:29:23**. There are 56 distinct buoys. All archived lead values are exactly 24, 48 or 72 hours, so lead bucketing does not alter this snapshot.

The independent join first matches source/buoy/target/lead, then requires identical verifying observation timestamps and heights. All 15 comparisons have **zero missing observation identities and zero mismatches**. Full-snapshot and weekly checks also reproduce zero invalid heights, observations, errors or timestamps; zero duplicate keys; zero observations after the evaluation time; and zero joins beyond 90 minutes. The largest difference between a recomputed signed error and stored error is **4.44e-16m**. These are checks on the supplied retained rows, not proof of complete data acquisition or retention.

| Persistence comparison | Common pairs | Raw Surf MAE | Persistence MAE | Strict wins / ties / losses |
|---|---:|---:|---:|---:|
| +24h | 3220 | 0.2125m | 0.2671m | 1770 / 2 / 1448 |
| +48h | 3174 | 0.2245m | 0.3549m | 1980 / 2 / 1192 |
| +72h | 3138 | 0.2358m | 0.3851m | 1951 / 4 / 1183 |

Strict win rates include ties in the denominator but not the numerator: **54.97%, 62.38%, 62.17%**. Both public-reference sources still outperform Raw Surf on their own matched cohorts at all three leads. The JSON contains all 15 independently reproduced MAEs, deltas, sample sizes and integer win/tie/loss counts; comparisons have different cohorts and should not be ranked using their unpaired source-wide MAEs. These descriptive results are not significance tests because observations and leads are correlated.

The target-only and corrected observation-aware algorithms agree **on this exact snapshot and evaluation window** because no mismatched or missing observations survive in it. This does **not** establish equivalence to the September 19 handoff's historical population (`n=3221`, approximately 0.209m versus 0.258m at +24h), nor prove or disprove those earlier measurements. The snapshot starts September 9 and has no forecast-issue or scoring timestamps; a historical as-known population cannot be reconstructed from it alone. The first corrected scheduled production verdict, broader skill clocks, retention investigation and nearshore validation remain separate work.

Privacy check: the raw file resolves outside the weather checkout, and its directory is not inside any ancestor Git worktree. It was read in place and was not copied, printed or published. Only aggregate statistics, hashes and this standalone calculation were written under the audit directory. No source, CI, ledger or remote state was changed by this verification.
