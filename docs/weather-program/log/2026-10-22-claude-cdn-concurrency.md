# 2026-10-22 (claude, GPU-frames session): frame prefetch CDN etiquette (4 in flight, back-off, wake-up)

Written 2026-10-22T14:07Z. Branch `claude/cdn-concurrency` from dev `972be1e82`. Evidence: `evidence/cdn-concurrency-2026-10-22.json`.

## Ask
- The lead, 2026-10-22: "Lower CDN concurrency to stop the Supabase 429s you saw at 6 in flight (e.g. 3-4), with backoff on 429."
- Live, 3 of 116 whole-run frame asks got 429.

## Change (`marineFramePrefetch.js`)
- In-flight limit: 4, or 2 on slow links (was 6 and 3).
- AIMD: after a failed ask the limit halves, nothing starts for a cool-off (1 s, doubling to 8 s), and each success wins one slot
  back.
  - The loader doesn't pass the HTTP status through, so any non-abort failure counts; a 429 is the usual one.
- One wake-up timer for the earliest moment something may start (a cool-off ending, a retry delay passing). Before, a backed-off
  frame was re-asked only at the next landing or step.
- `scn_instant_second_pass.js` gains `CDN_RATE_LIMIT=N`.

## Measured
CDN limited to 4 concurrent frame asks, the 113 real frames, 340 ms per object, dark and light arms.

| | dev (6 in flight) | this branch |
|---|---|---|
| CDN 429s | 346-354 | **0** |
| frame requests / landed | 384-390 / 36-39 | 113 / 113 |
| frames resident | 40-45 of 113, fill never finished | 113 of 113, fill done 10.7-10.9 s |
| steps p50 / p95 / max | 2 / 580-594 / 583-851 ms | **2-3 / 13-16 / 14-17 ms** |

- Per-frame retry alone cannot live with a rate limit: every retry collides again.
- Cost when nothing limits it: a whole-run fill takes about 10.8 s instead of 7.5 s.
- Caveat: the first "after" run built dev's prefetcher, because the worktree switched branch mid-run; it was re-run with the
  file from the branch commit.

## Gates
- Frame suites 192/192, including 2 new tests (AIMD, wake-up); 2 mutants caught (no back-off, no wake-up).
