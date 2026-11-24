# 2026-11-24: pilots second time-left gate (before the ICON 0.125 steps) measured and dropped

Session: ingest-health, a side session of the director (local_d6b521eb). Docs only; nothing served changes.
Context: #1228 (squash-merged as 19c3f7354; the gated head 719df1b4a) added one gate, `ci_job_budget.py`, that skips the whole raster block when less
than 45 min of the 300 min job budget remain (kill switch `JOB_BUDGET_GATE=0`). The director asked whether a second gate
before the ICON 0.125 steps was also needed. Measured first, read-only (`gh run view`), step wall times in minutes.

## Evidence (forecast-ingest-pilots.yml, job `ingest-pilots`)

| Run | Ingest | Static frames | Rated frames | Raster steps (each) |
|---|---|---|---|---|
| 45258226576 (dispatch, 2026-11-23 20:19Z) | 121 | 18 | 9 | GFS 0.117 5; gust risk 4 |
| 45186444511 (schedule, 2026-11-23 13:41Z) | 141 | 21 | 10 | GFS 0.117 5 |
| 45173195863 (dispatch, 2026-11-23 12:19Z) | 136 | 26 | 31 | GFS 0.117 6; ICON gusts 5; ICON temperature 0.125 4; ICON precip 0.125 3 |

Earlier analysis (PR #1228 body): job minutes over 11 runs were 140-238 of 300; the "287 min" run was 91 min of queue plus
195 min of job (`timeout-minutes` does not count queue).

## Conclusion

No raster step, ICON 0.125 included, took more than 6 min. The time goes to the sequential ingest step, then static and rated
frames, all of which run before the raster block. #1228's single gate sits before the whole raster block and so already
covers the raster tail; a second gate would protect about 7 min of work. Dropped. Not built, nothing in the workflow changed.

## Revisit trigger

Reopen if any pilots run shows a raster or offset step finishing after minute 255 of the job (the gate's own cut-off is
300 - 45), or the job being cancelled at the timeout while a raster step is running. Design then: a `JOB_T0` self-skip in
`publish_raster_frames.py` (a skip counts as success, not a masked failure), not another workflow-level gate.
