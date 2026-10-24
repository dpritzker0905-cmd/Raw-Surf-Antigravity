# 2026-10-24 · lead · the Gulf fill switch-on (D-050)

The owner, 2026-10-23 17:33 EDT: "Yes: at 9 AM EDT tomorrow switch on EURO's own values first (verify on the next ingest), then the
targeted fill to stop the land painting, with the baseline, Reflection's rollback triggers and a scoreboard row."

## What was done (UTC)
- 12:43-13:01Z baseline (passive): Render CPU/memory 2 h, /api/health route telemetry, admin /surf-forecast/status (mode legacy).
- 13:01:39Z `ECMWF_WAVE_LAND_CENTRE_BLOCK=1` (repo variable). 13:01:43Z dispatched pilots 40096388879 + core 40096395825; both
  queued behind in-flight runs that read 0 (variables are read when a job starts).
- 14:04Z the served world EURO frame shows own values: landCentreBlockNodes 948, legacy fill 2,465 -> 1,674 cells, inland 0.
- 14:22-14:31Z the end-of-ingest burst (CPU 0.93-1.00, memory to 901 MB, 0 x 5xx), BEFORE step B: folded into the baseline.
- 14:58Z static-frames' verify_euro_own.py PASS on run 40096388879's frames: 950 = 842 sea / 62 land-lake-coast / 46 ice.
- 15:14:13Z Render `MARINE_GULF_FILL_MID_TARGETED=1` (deploy of 749080841, nothing else, live 15:17:48Z).
- 15:27Z the same probe: 25 filled of 3,739 masked (was 1,674); inland 0; admin mode targeted, one donor build at 53 ms.
- 15:27Z an unrelated deploy (#525, safety, another session) restarted the box; the comparison window opened at 15:42Z.
- 16:31Z static-frames' postflip_read2.py: EURO 25 of 3,739 and ICON 123 of 3,788 filled, every one GFS sea; land painted 0.
- 16:50Z the watch closed with no trigger (weather err_5xx 0; edge 500s 0-4 per 5 min vs a 0-5 baseline; memory 650-706 MB;
  CPU <= 0.26; world grid probe 0.85-1.5 s). The held weather merges then went in: #531, #536, #538, #537.

## Lessons
- **L: a baseline must include the end-of-ingest burst.** The first 2 h baseline (peak 821 MB, CPU <= 0.27) missed it; the burst
  reached 901 MB and CPU 1.0 for 10 min with no flag involved. Without it, step B's first ingest would have tripped the memory and
  CPU triggers falsely. Take the baseline across at least one ingest finish.
- **L: Render gives no http_latency for this service**, and the in-app telemetry resets on every deploy. p95 comparisons need the same
  uptime phase. Absolute Render CPU/memory and a fixed external probe (one world frame every 5 min) are the stable instruments.
- **L: /api/health itself takes 1-5 s at idle CPU** (the route, not the box). Script health gates use 6 s, twice in a row.
- **L: other sessions merge during a watch** (#525 deployed at 15:27Z). Holding our own merges is not enough; the window rule (compare
  only from 15 min after the last deploy) is what keeps the reading honest.
- Reflection (Beam) refined the triggers before step B: edge 5xx only when more than 8 per bucket twice; app err_5xx on weather routes
  is the hard signal; the donor baseline is the first 15 min after the flip.

## Evidence
side-session-notes gulf-switch-on-2026-10-24/ (BASELINE-and-timeline.md, probe.jsonl, health baselines) and
euro-own-values-flip-2026-10-24/ (verify and post-flip JSON). Ledger: ledger.d/claude--gulf-switch-on-2026-10-24.jsonl.
