# 2026-11-12 — Opus, move 3 follow-up: why EURO estimated-tail hours still go to the box (branch `opus/frame-publish-fair-order`)

Session: the move 3 static-frames session (its main log is `2026-11-12-opus-move3-static-frames.md` on #802's branch). This file
is this branch's own log so the two PRs never conflict on one file. Owner's ask (16:34Z): "fix the EURO estimated-tail hours next".

## 16:44Z What sends EURO hours past 240 h to the box, measured

**Offline lab (#802 build, `serve_synthetic.py` in production's targeted fill mode):** the store shows h250 (estimated) in
5-11 ms, so estimated hours as such are not refused. Only h336 missed, with `no_frame_in_window` in both the frame store and the
static seam: the lab index ended at 2026-11-26T03Z while the ask was 08Z (5 h, past the client's 3 h window). `/grid` answered it
through the **far-edge hold** (`far_edge_hold.py`, `far_edge_hold:+5.0h`, `frame_offset_hours -5`), with the whole 181 x 83 world
grid (not the viewport clip) and the Gulf fill re-run against GFS at 08Z (`donor missing`, 2,714 cells masked). The lab runs without
production's `MARINE_EXT_CEILING_MARGIN_H=12`, `FAR_EDGE_HOLD_PREFER_MID=1` and `MARINE_GULF_FILL_DONOR_SERVED_TIME=1` (D-053), so
this case is partly a lab artifact.

**Production CDN (public `weather-frames` reads only; the Render box was not touched), at 16:07Z:**

| Set | Run | Index written | Last built frame | now + 336 h minus last |
|---|---|---|---|---|
| EURO waves global_mid (+ filled) | 11-12T00Z | 14:13:57Z | 11-26T21Z | -4.9 h (covered) |
| EURO swell_1 global_mid | 11-11T12Z | 06:37:17Z | 11-26T15Z | +1.1 h |
| EURO swell_1 / wind_waves global_mid_filled | 11-11T12Z | 03:50:17Z | 11-26T09Z | **+7.1 h (miss)** |
| ICON waves global_mid_filled | 11-12T00Z | 14:13:57Z | 11-26T21Z | -4.9 h |
| GFS waves / swell_1 global_mid | 11-12T06Z | 14:13:57Z | 11-28T06Z | -37.9 h |

The EURO swell sets are a model run behind the others. **Cause: the publish budget.** Pilots run 43212941038 (11:52Z) logged
`EURO/marine/<swell layer>/global_mid[_filled]: skipped, the run is past its 960 s budget` for all six, plus 57 regional bundles.
Over the 9 pilots runs from 11-11 00:14Z to 11-12 11:52Z (`gh run view --log`): EURO swell sets skipped whole in 4 runs
(42959146362, 43031280542, 43081907418, 43212941038), 3 of 6 in a 5th (43155348469), all published in 4. Their list position is
last (after the 132 regional bundles), chosen on 11-01 because no client read them; #802 makes the client read them.

**Consequence beyond the tail (a correction to #802's framing):** while a set is skipped, its published index stays, and the
client has no run check (`staticFrames.getPinnedIndex` pins whatever `latest.json` names). So with #802 a skipped run means the map
draws EURO swell from the previous model run at every hour, not only at h336, while `/grid` serves the newer run. Before #802 those
hours went to the box and were fresh. This PR bounds that staleness to one run; it does not remove it.

## 16:44Z The change: a fair publish order (`publish_frame_images.publish_order`, ON, kill `FRAME_PUBLISH_FAIR_ORDER=0`)

Rule: the set whose `latest.json` record was written longest ago starts first (never-written first of all); on equal times world
sets go before regional bundles, then the list order. A skipped set keeps its old `written_at`, so it leads the next run. After a
run that wrote every set, all records share one `written_at` and the order is exactly today's.

**Replay of the 9 runs on their own per-set times** (blocks between `[frames]` log lines; the trailing retention block of the last
set clipped to 40 s; sets a run skipped take their median from the other runs; budget 960 s):

| Order | EURO swell set-runs skipped (of 54) | World set-runs skipped | Regional set-runs skipped (of 1,188) | Longest skip streak, world / regional |
|---|---|---|---|---|
| A, fixed (today) | 27 | 27 | 118 | 2 / 2 |
| B, world class first, oldest inside | 0 | 0 | 463 | 0 / 2 |
| **C, oldest first, world on ties (this PR)** | **2** | **2** | **367** | **1 / 1** |

Trade-off, stated plainly: the budget is unchanged, so the ~200 s the six EURO swell sets take on a heavy run comes out of the
regional bundles (regional seconds on the 4 heavy runs ~350 -> 145-239). C was chosen over B because it keeps every set, regional
included, to at most one skip in a row; B lets a regional box go two runs stale. Replay limits: per-set times are log-line spans
(upload threads and retention blur them), a set the run skipped has no measured cost that run, and a "skip" of a set whose source
did not change costs no freshness (the replay cannot tell).

Tests (`tests/test_publish_frame_sets.py`, estate lane, +4): the order rule; the OFF path (kill = list order); a starvation replay
(fixed order skips the tail 6 runs of 6, the fair order at most 1 in a row); end to end through `publish_frame_sets`, the set the
last run skipped is the first one started. Mutant (`FRAME_PUBLISH_FAIR_ORDER=0` for the suite): exactly those 3 order tests fail.
Gates: the 20 test files that read `forecast-ingest-pilots.yml` plus this one, 602 passed locally (venv, not the declared env);
flake8 gate clean; file 713 lines.

## Not fixed here (next, in order)

1. **Rebuild churn.** The EURO swell plain sets rebuilt 74-118 frames in every run that reached them, though the CMEMS forecast end
   moved only daily (11-20 -> 11-21 -> 11-22). `frame_set.publish_set` carries a frame only when its source identity (filename,
   `ingested_at`, run times, fill donor) is unchanged, and the pilots lane re-ingests the same CMEMS run with a new `ingested_at`.
   Keying the carry on content would free most of the ~200 s and take back the regional cost above. Needs a careful identity design.
2. **The far-edge hold on the client.** In the last hours of each cycle now + 336 h passes the newest frame by more than 3 h even
   when every set is fresh, and `/grid` serves the hold. Mirroring it needs `/capabilities` to expose the hold's rails
   (`FAR_EDGE_HOLD`, `_MAX_H`, `_PREFER_MID`, `MARINE_GULF_FILL_DONOR_SERVED_TIME`), since the client cannot know them, and the
   held answer is the unclipped world grid.
3. **A run check on the client** (owner's call): refuse a static set whose run is older than the box's, trading speed for freshness.
