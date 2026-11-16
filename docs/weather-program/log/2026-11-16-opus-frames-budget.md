# 2026-11-16 — opus: the pilots frames budget (77-143 sets skipped a run), measured, and a pre-registered fix

Session: the frame-carry side session, asked by the director (2026-11-16 18:20 EST): measure first, propose the smallest fix,
pre-register a gate of skips at or near 0 in 3 of 4 runs, and send it to the advisor before building. Written 23:33Z, before any code.

## Measured (pilots 43803432374, 43863453856, 43950205417; per-set `frame_sets` reports from the jobs-API logs)

**There are TWO budgets, not one.**
- **The frames step** (`publish_frame_images.py`, FRAME_PUBLISH_BUDGET_S 960 s, step timeout 22 min) spends 874-937 s a run:

| kind | sets | seconds a run |
|---|---|---|
| world | 11 | 331-466 |
| filled | 7 | 241-288 (after #922) |
| regional bundles | 43-118 built | 146-272 |
| wind | 1 | 29-38 |

  It skips 14, 89 and 38 regional sets.
- **The rated step** (`--only rated`, the Surf Rating band sets, FRAME_PUBLISH_BUDGET_S 600 s, step timeout 14 min) spends
  589-597 s and builds only 21-30 of its 84 sets a run (median 13.6-15.5 s a set, max 47-105 s). It skips 54-63 every run. So a
  rated set is refreshed about every third pilots run, about once a day. #975 (merged) already orders GFS waves first, so the
  band's waves bundles keep current (run 3 built GFS waves first, 387 s); the swell and wind-wave rated sets rotate.
- **Staleness now** (the public latest.json, 2026-11-16 ~23:25Z): plain regional marine sets have a run-age median of 11-17 h, max
  23 h, none over 24 h. The fair-order stagger catches the skipped plain sets up the next run. The rated sets are the stale ones.
- **Headroom:** the pilots job took 165, 171 and 162 min against its 300-minute timeout (05:23-08:08Z, 12:46-15:37Z,
  20:29-23:11Z). The cron is every 8 h, so about 130 min of room.

## Proposed: the smallest fix is a budget raise inside the measured headroom (no code)

- **Frames step:** FRAME_PUBLISH_BUDGET_S 960 -> 1260 s (when FRAME_TAIL_DOWNLOAD is on), step timeout 22 -> 27 min. The skipped
  regional sets cost about 2 s each (14-89 sets: about 30-180 s), so +300 s covers the worst run measured.
- **Rated step:** its budget 600 -> 1500 s, step timeout 14 -> 30 min. 84 sets at the measured ~14 s median is about 1,200 s; 1,500
  s leaves room for the long sets. #975's waves-first order is kept.
- **Cost:** at most about +20 min of job time a run (the 300 s and 900 s raises), about 185-195 min against 300; the next cron is
  8 h away. No Render load (Actions only); storage unchanged (the same sets, just not skipped).
- **Not chosen now:** a separate rated job (more moving parts for the same seconds), ordering by views (it moves staleness, it does
  not remove it), a raster cap (raster steps are separate steps, not in these budgets).

## The gate (pre-registered)

Over the 4 pilots runs after the change is live, in at least 3 of 4:
1. The frames step skips at most 2 sets, and the rated step at most 2.
2. No step times out, and the job finishes under 240 min.
3. Every rated set's run equals its plain sibling's run at the end of the run (no rated set more than one run behind), counted
   from the public latest.json.
4. #975's order holds: the rated GFS waves bundles are built first.

Fail = a timeout, or skips over the line in 2 of 4 runs: revert the variables. Rollback: the two numbers back (repo variable or
revert).
