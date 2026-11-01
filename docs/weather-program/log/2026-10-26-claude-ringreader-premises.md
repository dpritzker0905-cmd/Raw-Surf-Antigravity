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

## Update (same day): the lead's two conditions
The lead, 2026-10-26: "C2 must compare two counters that SHOULD agree under today's design. Don't simply delete it: keep a check
with teeth, plus a positive control that still fails on a real mismatch. C1 must judge each ring by its own semantics (forensic cap
vs churn totals). Cite the pinned test and why its premise expired in the log."

### C2: a live pair, one quantity counted twice
- **The pair (`C2 cross:commits`, tolerance 0):**
  - one side is the sum of `__RAW_FRAME_STORE__.commits`, minus the two follow-ups `resident_late` and `crop_not_resident`;
  - the other is `__WEBGL_MARINE_UPLOAD_DIAG__.uploadCount`.
- **Why they agree by design:**
  - WebGLMarineLayer calls `noteCommitted` and then `__WEBGL_MARINE_UPLOAD_COUNT__++` in the same synchronous success block after
    `setWaveData`. Each is the only caller or increment of its counter.
  - Every return of `noteCommitted` past its on-check counts exactly one reason through `why()`.
  - The two follow-ups are written later, outside `noteCommitted` (`resolvePending`, `resolveCropPending`), so they are not commits.
- **Measured** (offline, one session, build rs-build-held2 = dev 4e706abfd + #587, synthetic backend with the flagship regions):

  | Stage | Commits | Uploads | Retired pair (textureUploadCount) |
  |---|---|---|---|
  | load | 1 | 1 | 10 |
  | six world steps | 7 | 7 | 40 |
  | three pans | 8 | 8 | 46 |
  | EURO, ICON, GFS | 11 | 11 | 61 |
  | z8 and four steps | 16 | 16 | 78 |
  | zoom-out | 18 | 18 | 95 |

- **SKIP:** the store off or absent, or no upload yet (the store counts nothing then).
- **What a FAIL means** (named in the detail): an upload that skipped `noteCommitted`, a `noteCommitted` return without a reason,
  the commit path throwing between the two, or a store kill switch flipped mid-session (reload, then read again).
- **Teeth:**
  - Positive controls: 14 commits vs 30 uploads FAILS; 19 vs 18 FAILS.
  - Source guard: the writers of `rt.commits` outside `noteCommitted` are exactly the follow-up list. WebGLMarineLayer has one
    `noteCommitted(grid` call and one increment, and the call comes first.
  - Mutations: tolerance 0 -> 99 fails 3 tests; dropping `crop_not_resident` from the list fails 2.

### C1: each ring by its own semantics (caps read in source)
- **telemetry:** cap 500 (`WeatherTelemetry.MAX_LOGS`) and no per-type counter, so eviction is judged at the cap.
- **forensic:** cap 500 (`marineForensics` `MAX_EVENTS`). Below 90% of it, nothing has been evicted and the ring passes.
- **churn:** `counts` are monotonic totals (`recordChurn` increments before pushing and never decrements), so they SKIP. The
  `log` fallback (no `counts`) is a sample of a 150-entry evicting ring, so it is judged.

### The pinned test, and why its premise expired
- **Pinned on dev:** "the 50% undercount threshold fires BEFORE outright dominance". `{ a: 60, b: 20, c: 20 }` in a 500 cap (100
  entries) had to FAIL, at a 0.60 share.
- **Its premise:** past 50% of the ring, every other type's count is an undercount.
- **Why it expired:** that holds only once the ring has evicted. FIFO deletes the oldest entries only at the cap, so at 100 of 500
  nothing has gone: the counts are totals, and a 60% share is the workload, not a loss. The owner's "'commit' is 51.5% of 33" was
  this case (33 of 500).
- **Now:** the same shares at the cap (`{ a: 300, b: 100, c: 100 }`, 500 of 500) still FAIL; the test is renamed "..., once the
  ring is FULL". The dev mix below the cap passes, saying "nothing has been evicted".

### Verified
- marineRingReader.test.js: 44 tests.
- Whole frontend suite, ESLint ratchet and line-count ratchet: see the PR.
