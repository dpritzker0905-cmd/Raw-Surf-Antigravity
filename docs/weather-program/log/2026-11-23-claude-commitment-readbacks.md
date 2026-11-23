# 2026-11-23: commitment read-backs (spaced reads lane)

Session: `claude/commitment-readbacks-20261123` (the inspection lane). Docs only: no served number, flag, variable or
workflow changes. Times are UTC.

## Authority

The director session relayed the owner's words to this session on 2026-11-23: David, "Yes, spaced reads", answering
whether a lane should clear the overdue checks with spaced-out reads, using the CDN where possible. Rules given with
it: CDN first; Render GET only, one at a time, at least 60 s apart, at most 20 an hour, `/api/health` before each
batch and after every 5; no POSTs, dispatches, scrubbing loops or browser replays against live; stop and report if
the permission system blocks a read.

## What happened to the Render reads

- 18:32:01Z: one `GET /api/health` answered 200 in 1.63 s. The body was not kept.
- 18:33Z: the first batch (wind lane, buoy calibration, three world `/grid` reads at now + 336 h, health before and
  after, 62 s apart) was **blocked by this session's permission system** before any request left. As instructed, no
  further Render read was attempted and nothing was worked around.
- So **no commitment that needs the API was read**. They stay open (list below).

## Read-backs made (public CDN and GitHub run history only)

### 1. `ledger.d/claude--default-on-guardrails.jsonl:2`: first scheduled flag-guardrail run after merge
- Run 41945342919 (schedule, 2026-11-05 00:59Z), conclusion success.
- Job summary "Flag guardrail (enforce)" lists the ON guarded flags with a verdict each: 6 rows
  (`CONSENSUS_DIRECTION_VECTOR`, `RATING_LOCAL_SIZE`, `RATING_OBS_GATE`, `SPOT_HUB_RATE_ONE_SPOT`,
  `SURF_BIGHT_HS_CONSENSUS`, `SURF_TIDE_DEPTH`), every action `none`, every verdict `NO_CHANGE`.
- Artifact `flag-guardrail` present (1,343 bytes).
- **Deviation from the commitment's wording:** the run was NOT a dry run. Its log shows `FLAG_GUARDRAIL_ENFORCE: 1`.
  It wrote nothing because every action was `none`. The commitment expected the first scheduled run to be a dry run.
- Since then the schedule has run about twice a day (the cron asks for four); 10 of the last 12 runs succeeded and
  both 2026-11-19 runs failed.

### 2. `ledger.d/opus--gc-fuse-b-release.jsonl:1`: GC FUSE B release lever in both lanes
- PR #1020 (`opus/gc-fuse-b-release`) merged 2026-11-18 09:08:41Z.
- At `origin/dev` `78e7adb21`, `PRODUCT_GC_MAX_DELETE_SHARE` is in `.github/workflows/forecast-ingest.yml` and
  `.github/workflows/forecast-ingest-pilots.yml` (`grep -l`).
- Not checked: the "merged after #1005" order.

### 3. `ledger.d/fable--surf-spot-panel-schedule.jsonl:1`: one week of scheduled surf-spot-panel runs
The commitment asked for a log of one week of scheduled runs: how many ran, how many stopped early and why, and
`/api/health` before and after each. From `gh run list` and each run's own log (`gh run view --log`):

| Started (UTC) | Run | Result | Minutes | Spots read | Stopped early | Slowest read |
|---|---|---|---|---|---|---|
| 11-16 21:57 | 43965313129 | success | 19 | 30 of 30 | no | 1.9 s |
| 11-17 07:50 | 44041782245 | success | 69 | 30 of 30 | no | 1.7 s |
| 11-17 20:51 | 44173644686 | success | 5 | 30 of 30 | no | 2.4 s |
| 11-18 07:21 | 44258258317 | success | 14 | 30 of 30 | no | 1.8 s |
| 11-18 20:27 | 44391224829 | success | 19 | 30 of 30 | no | 2.2 s |
| 11-19 07:19 | 44478661578 | success | 41 | 30 of 30 | no | 1.8 s |
| 11-19 20:30 | 44609346017 | success | 5 | 30 of 30 | no | 2.7 s |
| 11-20 07:08 | 44692766270 | success | 7 | 30 of 30 | no | 1.2 s |
| 11-20 20:08 | 44808642187 | success | 5 | 30 of 30 | no | 1.9 s |
| 11-21 06:59 | 44878119918 | success | 5 | 30 of 30 | no | 2.3 s |
| 11-21 19:10 | 44939497345 | success | 5 | 30 of 30 | no | 1.8 s |
| 11-22 06:41 | 44994844448 | success | 5 | 30 of 30 | no | 2.7 s |
| 11-22 19:32 | 45061343014 | success | 5 | 30 of 30 | no | 1.3 s |
| 11-23 07:29 | 45131514678 | success | 7 | 30 of 30 | no | 0.8 s |

- 14 scheduled runs in the week, all success, none stopped early (the run stops above an 8 s read; the slowest was
  2.7 s, always at "Galveston - 61st Street").
- Each run logs one health line. The 11-23 07:29Z run's reads "backend health before: ok 0.3s; after: ok 0.3s". I
  read that line's text in that one run and counted one health line in each of the other 13.
- **The cron asks for a run every 6 h (four a day); two a day ran.** GitHub dropped about half the slots, as it does
  for the other scheduled monitors. Three runs took 19 to 69 minutes of wall time against 5 to 7 for the rest; the
  cause was not read.

### 4. `ledger.d/fable--surf-ablation-s0.jsonl:4`: S0 gate, breaking truth source 1: FRF Duck
- DECISIONS D-077 (2026-11-15, decided) dropped FRF (USACE Duck) data: its metadata prohibits commercial use.
- The same fragment's line 5 is a correction, "S0 gate: FRF Duck withdrawn as a truth source", but it carries no
  `fulfills`, so line 4 stayed open and would have gone overdue on 2026-11-30.
- Closed as **superseded, not met**. No FRF data was read.

### 5. `ledger.d/opus--raster-ship-on.jsonl:1`: five raster sets ship ON by default
- PR #998 (`opus/raster-ship-on`) merged 2026-11-18 03:16:52Z.
- Public `weather-frames/v1/latest.json`, read 2026-11-23 18:32:44Z (`written_at` 2026-11-23T16:00:59Z, writer
  `gh-run-45173195863`), carries all five sets, each with coverage 1.0:

| Set named in the commitment | Key in `latest.json` | Frames | Run |
|---|---|---|---|
| water_temp | `GFS/weather/water_temp/global_0p25` | 113 | 2026-11-23T06Z |
| temperature_icon | `ICON/weather/temperature/global_0p5` | 61 | 2026-11-23T12Z |
| cloud_cover_euro | `EURO/weather/cloud_cover/global_0p25` | 65 | 2026-11-23T00Z |
| precipitation_icon_0p125 | `ICON/weather/precipitation/global_0p125` | 112 | 2026-11-23T12Z |
| temperature_icon_0p125 | `ICON/weather/temperature/global_0p125` | 61 | 2026-11-23T12Z |

- Pilots run 45173195863 (2026-11-23 12:19Z to 16:05Z) concluded success.
- **Deviation:** the commitment says "first pilots run after merge". This is today's run, five days after the merge,
  not the first one. Per-step success was read as the run's overall conclusion, not step by step.

## Checked and NOT closed

| Commitment | What the read showed | Why it stays open |
|---|---|---|
| `opus--frames-budget.jsonl:1` (pilots job < 240 min) | last 11 completed pilots runs: 140 to 287 min; two over 240 (249 at 11-23 00:29Z, 287 at 11-23 04:40Z); timeout is 300 min | **criterion failing** on duration; skips per step were not read |
| `opus--sim-guards-timeout.jsonl:1` | `ci.yml:655` has `timeout-minutes: 35`; PR #1028 merged 2026-11-18 | the job's duration on a dev and a PR run was not read |
| `claude--eval-harness-v0.jsonl:2` | every listed `eval-harness.yml` run is a skipped pull-request run | the production-parity run has not happened |
| `claude--spot-hub-charts.jsonl:2`, `claude--spot-series-unset-var-gate.jsonl:2`, reconciliation line 73 | every recent `spot-series.yml` run is skipped or cancelled | nothing is published to read |

## Still open: what each group needs

Of the 77 overdue on `origin/dev` `78e7adb21` (`action_ledger.py open`):

- **Need the owner's own browser on the dev site** (a `window.__...` reading, a performance trace, or the owner's
  word): about 35, almost all in `claude--state-reconciliation-20261111.jsonl` (lines 13, 18, 20, 22, 24 to 31, 33
  to 38, 46, 48, 51 to 55, 57 to 65, 68 and `claude--rating-band-sota-51340a.jsonl:2`). A GET cannot clear these, and
  rule 3 forbids a browser replay against live.
- **Need one or a few Render GETs** (blocked today): the S8 direction and period read (`/api/weather/buoy-calibration`,
  two lines), the day-14 world `/grid` reads, the #555 filled-frame parity, the wind-lane read, the memo-hit health
  read, D-059 parity (two lines; STATE says #917 passed it 6 of 6 on 2026-11-15, so these may be bookkeeping).
- **Need Render logs, a storage select or a scored-archive read** (no GET reaches them): about 8.
- **Need a workflow run or a measurement that has not been made**: about 10.

## Not done

- No SCOREBOARD row: nothing here changes or measures a served number.
- STATE not edited.
