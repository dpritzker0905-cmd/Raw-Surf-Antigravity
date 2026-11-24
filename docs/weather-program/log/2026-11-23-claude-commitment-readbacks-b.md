# 2026-11-23: commitment read-backs, follow-up (run history, artifacts, repo; no Render read)

Session: `claude/commitment-readbacks-20261123-b`. Follows `log/2026-11-23-claude-commitment-readbacks.md` (PR #1232).
Docs only. Times are UTC. No Render read was made: the owner's decision on a permission for them is pending.

## CORRECTION to the first log (PR #1232)

`log/2026-11-23-claude-commitment-readbacks.md`, table "Checked and NOT closed", row `opus--frames-budget.jsonl:1`,
says the pilots runs took "140 to 287 min; two over 240 (249 at 11-23 00:29Z, 287 at 11-23 04:40Z)". **That is wrong.**
Those figures are `updatedAt - createdAt` of the workflow run, which includes time in the queue. The job durations
from the jobs API for those two runs are **238 and 195 minutes** (runs 45089027893 and 45113293217, job `ingest-pilots`). The same wrong figures were sent to the director
and reported as a "P1 lead: 13 minutes from the 300-minute timeout"; that lead is withdrawn as stated. What the jobs
API does show: two pilots jobs at or over 240 minutes since 2026-11-17 (44219095846 at 253, 44437475594 at 240).

## Follow-ups the advisor asked for on PR #1232's closes

### Guardrail closure: the contents of `guardrail.json`, run 41945342919
Downloaded with `gh run download 41945342919 -n flag-guardrail` (files `guardrail.json` 12,536 bytes and
`guardrail.md` 791 bytes; the 1,343 bytes quoted in the first log was the zipped artifact).
- `mode: "enforce"`, `generated_utc: 2026-11-05T01:00:25Z`, `changed: false`, `watch: {}`, `ledger_commands: []`,
  `manifest: {"schema": "raw-surf/runtime-flags/1", "flags": {}}`. So the run wrote no flag.
- `decisions`: six flags, each `action: none`, reason "NO_CHANGE: ON equals OFF at every pair in this window (the
  flag is inert here)": `CONSENSUS_DIRECTION_VECTOR`, `RATING_LOCAL_SIZE`, `RATING_OBS_GATE`,
  `SPOT_HUB_RATE_ONE_SPOT`, `SURF_BIGHT_HS_CONSENSUS`, `SURF_TIDE_DEPTH`.
- `results`: each flag has verdict `NO_CHANGE`, window `2026-10-21T00:00Z..2026-11-04T00:00Z`, 8 members (pooled,
  three leads, one season, three latitude bands), pooled n 348, T 29, and identical ON and OFF MAE (0.2544 m).
  `sanity` is empty and `blocks` is false for all six.
- This confirms the first log's reading (enforce mode, no write) from the artifact itself.

### Spot panel: before and after health for all 14 runs
From each run's own log line "backend health before: ok X; after: ok Y":

| Run | Before | After | Run | Before | After |
|---|---|---|---|---|---|
| 43965313129 | 1.2 s | 0.3 s | 44692766270 | 1.2 s | 0.3 s |
| 44041782245 | 2.0 s | 0.5 s | 44808642187 | 1.3 s | 0.3 s |
| 44173644686 | 0.4 s | 0.3 s | 44878119918 | 1.6 s | 0.3 s |
| 44258258317 | 1.7 s | 0.4 s | 44939497345 | 1.4 s | 0.3 s |
| 44391224829 | 1.6 s | 0.3 s | 44994844448 | 1.1 s | 0.2 s |
| 44478661578 | 1.7 s | 0.5 s | 45061343014 | 1.4 s | 0.3 s |
| 44609346017 | 1.7 s | 0.5 s | 45131514678 | 0.3 s | 0.3 s |

All 28 reads say "ok". Before: 0.3 to 2.0 s. After: 0.2 to 0.5 s.

### Two checks the advisor made (cited, not re-run by this session)
- #1005 merged (2026-11-18T04:22:13Z) before #1020 (2026-11-18T09:08:41Z), so the GC lever's "merged after #1005"
  clause is met. The two merge times are also in `gh pr view`.
- The five raster steps of pilots run 45173195863 each succeeded, so the raster close's "each step succeeds" clause
  is met at step level.

## New read-backs

Judgement calls were put to SubQ and Reflection (LongCat is failing today and was not retried). Both said: close a
commitment whose check was fully met earlier but lacked the machine-readable reference; leave open one whose work
was never done, one with a clause that produced no result, and one with a clause explicitly not run. They split on
closing a check that was performed and FAILED (SubQ: close as FAILED; Reflection: leave open), so those stay open
with the failed reading recorded.

### Closed

**D-059 live parity read** (`ledger.d/claude--stoic-solomon-366747.jsonl:5` and
`ledger.d/claude--state-reconciliation-20261111.jsonl:74`).
- PR #917 merged 2026-11-15T19:18:47Z. `log/2026-11-15-claude-verifier-d059-live-read.md`. SCOREBOARD.md:380: PASS
  6 of 6 (EURO and ICON, three boxes each), 2,278 nodes, max absolute height difference 0.0005 m, health 1.44 s
  before and 0.15 s after.
- `ledger.d/claude--d059-live-read-record.jsonl:1` is the finding that recorded it. Its evidence text says it
  fulfils reconciliation line 74 (re-dated from stoic-solomon line 5) "named here, not as a fulfills reference", so
  both commitment lines stayed formally open. This PR adds the two references. No new read was made.

**Guards job timeout** (`ledger.d/opus--sim-guards-timeout.jsonl:1`: "guards job completes under 35 min on the next
dev and PR runs").
- #1028 merged 2026-11-18T08:14:12Z; `ci.yml:655` `timeout-minutes: 35`.
- Job `backend-sim-composition-guards`, all success. Push to dev: 44265253419 19m27s, 44265531393 16m27s,
  44267780511 15m21s, 44315713398 22m47s, 44338484996 16m02s. Pull request: 44278178601 23m16s, 44276296438 13m31s,
  44318322237 24m31s.

### Read, FAILED, left open

**Pilots budgets** (`ledger.d/opus--frames-budget.jsonl:1`: "4 pilots runs after the change: skips <= 2 per step in
3 of 4, no timeouts, job < 240 min, rated runs = plain runs"). #996 merged 2026-11-17T06:18:48Z.

| Run | Job min | Frames step s | Rated step s | Skips (frames, rated) |
|---|---|---|---|---|
| 44046081974 | 205 | 1,033 | 1,645 | 0, 0 |
| 44083737083 | 183 | 1,213 | 1,789 | 0, 0 |
| 44169533492 | 194 | 1,301 | 1,890 | 0, 31 |
| 44219095846 | **253** | 1,253 | 1,914 | 0, 2 |

- The literal first four completed runs fail "job < 240 min" (253).
- The lane's own counted set (forced rebuilds excluded, `log/2026-11-16-opus-frames-budget.md:165-226`) fails
  "skips <= 2 per step in 3 of 4": rated skips 0, 12, 28, 11.
- No step timed out. Later runs still skip rated sets (11-20 to 11-23: 12, 30, 0, 2, 0, 28, 0, 0, 4, 0, 0, 35, 7, 32).
- "Rated runs = plain runs" could not be re-read for most runs (`latest.json` has been rewritten since).

### Read, not done, left open

| Commitment | What exists | Unmet |
|---|---|---|
| `claude--eloquent-khorana-f240a0.jsonl:2` (post-flip-only gap and a per-region held-out fit as SCOREBOARD rows) | SCOREBOARD.md:347 is pooled pre and post flip and says "NOT a post-flip proof"; :372 is pooled fits scored by region | both rows |
| `fable--blend-fallback-design.jsonl:2` (46267 after-measurement) | the only `accuracy-per-buoy-split.yml` run is 43339322792 on 2026-11-13, before #852 merged; SCOREBOARD.md:375 is the BEFORE row | all three clauses |
| `claude--eval-harness-v0.jsonl:2` | 0 non-skipped `eval-harness.yml` runs in 1,000 listed | the run |
| `claude--state-reconciliation-20261111.jsonl:45` (#401 model spread) | `MODEL_SPREAD_PUBLISH` is not among the repo variables, so the gated step never runs | needs the owner to set it |

### Read, one clause without a result, left open

| Commitment | Met | Not met |
|---|---|---|
| `opus--wind-hourly-ship-on.jsonl:1` | #1006 merged 2026-11-17T15:52:16Z; first pilots run after it, 44169533492, had `FRAME_WIND_GFS_HOURLY: 1`, `GFS/wind/wind/global_mid` 113 → 193 entries (121 hourly + 72 three-hourly), coverage 1.0, frames step 1,301 s (inside 1,500 s) | "default-on filter verdict": run 44100370042 was green but the lane's log records the flag as SKIPPED, "no cached history window", so there is no verdict. Today's run 45173195863 took 1,573 s in the frames step, over the 1,500 s budget |
| `opus--icon-precip-0p125-cloud-temp.jsonl:1` | G1 numeric, G2 and G3 tables exist and pass (`log/2026-11-16-opus-icon-precip-0p125-cloud-temp.md:82-86`, ~:165-170, ~:121-125) | the G1 VISUAL read was not run (`:101`, `:132`, `:255`) |

### Read, cannot be settled from here

| Commitment | What was read | Missing |
|---|---|---|
| `opus--run-keyed-ship-on.jsonl:2` | #1005 merged 2026-11-18T04:22:13Z; GC summaries present in four pilots runs (44249848808 listed 41,133, deleted 0; 44325777889 listed 53,292, deleted 18,410; 44389564713 listed 36,810; 44437475594 listed 35,789); 0 "Stored product path not found" in those logs | "a GFS pilot tile follows the manifest" needs a live read; "storage object count flat" needs a storage select |
| `opus--euro-swell2-stale-tail.jsonl:1` | #940 merged 2026-11-16T07:16:58Z; of 25 completed pilots runs since, exactly one was exposed (44169533492: stale_refetched 85, stale_local 0 on the ICON and EURO world sets) | "3 consecutive exposed runs" do not exist; in that one run `EURO/marine/wind_waves/global_mid` coverage was 0.7542, not 1.0 |
| `claude--gusts-currents-layers-172ef8.jsonl:2` (#928) | `log/2026-11-16-opus-gusts-currents-lever-a-rerun.md:10-15`: phone, 4x CPU, step p50 gusts GFS 238, EURO 207, ICON 232, currents 224 ms; SCOREBOARD.md:393 has ratios only | not shown to be after the fix; no p50 per layer in the SCOREBOARD row |
| `claude--state-reconciliation-20261111.jsonl:67` (#522) | core run 45197354406: lane-window frames `status: published`, 55 rebuilt and 138 carried of 193, parity_bad 0. Public CDN at 19:08Z: `wind_lane.json` names the 06Z index while `latest.json`'s wind run is 12Z | the live `/grid` node comparison; and at read time `wind_lane.json` did NOT name `latest.json`'s wind run. A core run at 18:46Z, after `latest.json` moved to 12Z, still logged `already_rebuilt` for the 06Z index. Not traced: this may be a real lag |

## Not done
- No SCOREBOARD row: nothing here changes or measures a served number.
- STATE not edited.
