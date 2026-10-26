# 2026-10-26 (claude, GPU-frames session): RingReader stops crying wolf — two checks whose premises were out of date

Branch `claude/ringreader-premises` from dev 82bde66ae. Client diagnostics only (marineRingReader.js and its test); no served number,
no map behaviour. The reader's own kill (`__RAW_DISABLE_RING_READER__`) is unchanged.

## Ask
- The lead, 2026-10-26: "RingReader: reader premises out of date, not data. Fix it in a small follow-up PR so the owner's console
  stops crying wolf."
- Earlier (2026-10-25): "'[RingReader] 2 check(s) FAILED - run __RAW_RING_REPORT__() for detail', seen twice. Please say which checks
  those are and reproduce them offline".

## What failed (reproduced offline in the GPU-frames session; shared notes owner-manual-test-2026-10-25/RINGREADER-2-CHECKS-2026-10-25.md)
1. **`C2 cross:uploadCount`, in every session.** `__RAW_GPU__.textureUploadCount` (every texture upload: wave, chl, bath, mask, the
   frame store's shows and their aux) against the layer's normal-path upload count. They agreed after the 2026-08-03 fix (131 vs
   129, the test file's AFTER session). Since the frame store and the aux show (2026-10-21) they count different things: 87 vs 14
   offline.
2. **`C1 cardinality` on a ring that had evicted nothing.** "'commit' is 51.5% of 33" on the 500-entry forensic ring, and the churn
   ring, whose `counts` are monotonic totals by construction. Both C1 verdicts are about eviction (a loud type deleting the others
   at the cap).

## The change
- **C1, eviction first:**
  - Monotonic totals (`countsAreTotals`, set by captureRings for the churn counts) SKIP with the reason.
  - A ring below 90% of its cap PASSES and says why (nothing evicted: its counts are totals).
  - Dominance (80%) still FAILS near the cap.
  - The 50% undercount FAILS only once the ring is full (or its cap is unknown).
- **C2:** the `uploadCount` pair is retired from captureRings, with the reason in the source. `checkCrossInstrument` and its tests
  stay for a pair that describes one quantity.

## Verified
- marineRingReader.test.js, 38 tests:
  - the 2026-08-03 BEFORE/AFTER sessions still read as before: 5 failures, then none;
  - the saturated telemetry ring still fails;
  - the undercount fires on a full ring;
  - an unsaturated mix passes;
  - dominance near the cap fails (positive control);
  - churn totals skip;
  - the pair is gone;
  - the owner's two failures, replayed through captureRings, leave none.
- Whole frontend suite: see the PR.
