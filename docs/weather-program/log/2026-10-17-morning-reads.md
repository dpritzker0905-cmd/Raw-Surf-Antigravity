# 2026-10-17 (morning) — the overnight reads, Codex's handoff, and the retention defect in the manifest lane

Session: Claude Code (Sonnet 5.5), the leading session of the takeover (continuing the 2026-10-16/17 night). One writer for this file. Times are UTC unless a zone is
named. The owner came back at 09:19 EDT and asked to pick up where the night left off and to take Codex's Google Doc handoff (snapshot 13:06Z) into account. Ledger
lines 1372-1381 carry the facts below; this file carries the working.

## 1. Order of work

1. Read the manifest watch (commitment 1366, due 12:00Z). 2. Merged #330 on the owner's pre-given word (13:25:43Z, `5cfec8f55`, `[skip render] [skip netlify]`; the two
source files in it are comment-only). 3. Checked each Codex claim against fresh reads. 4. Built the retention fix test-first (draft PR 366) and sent it to an independent
reviewer. 5. This record.

## 2. The manifest lane's first production reading: it publishes, and its retention is blind

What passed (commitment 1366): `weather_manifest_pointer` generation 144541 at 02:00:31Z -> **145348 at 13:18:30Z** (written_by `designated:gh-run-39031637023`, a core run
in flight). `[Manifest Publish]` lines: core 39002933801 (04:32Z) 68, core 39018644942 (08:46Z) 44, pilots 39015932966 (08:03Z) 512, core 39031637023 (12:12Z) present;
no `::error::`, no PGRST205, no pointer-table error in any. Precompute (3 runs) and sim-parity (1) have no publish lines: precompute only READS the pointer, so its
flag is inert. (A grep for `::error::` in sim-parity counted 3 lines; they are the workflow's own script text echoed in the log, not runtime errors.)

What failed (the storage criterion): **318 of 318 retention gauge lines read `0 unique manifest copies standing ... 0 deleted`.** Read-only metadata selects:

| what | objects | size |
|---|---|---|
| `weather-products` bucket | 17,554 | 58.06 GiB |
| `manifests/` prefix | 3,034 | 52.65 GiB |
| of which hash-named (this lane's copies), all created since 04:35Z | 353 | ~5.2 GiB (15.3 MiB each) |
| of which legacy per-generation names (`manifest-g000000144496.json`), 2026-07-25 to 05:42Z today | 2,683 | 47.4 GiB |

Hourly creation of hash-named copies: 18 (04Z), 51 (05Z), 10 (08Z), 131 (09Z), 138 (10Z), 11 (12Z), 15 (13Z). Cause, reproduced on metadata: the lane lists 100 rows
**oldest first**; `order by name collate "C" limit 100` returns `g000000000001 .. g000000045708` (0 hash-named), and 2,665 legacy names sort before the first hash-named
copy (`g000000144548-...`). The name filter then keeps nothing. The tests seeded only hash-named objects; the seven reviews modelled "up to 42 standing copies".
Rate: pilots publish ~250 per run, ~900 publishes a day, ~13 GiB a day. Runway to an ASSUMED 100 GB quota: ~3 days (plan `pro`; quota and spend cap not visible here).

Fix: draft **PR 366** (`order: desc`; newest 100 names always contain the lane's copies; the backlog drains 50 per won swap; a hash-named orphan older than the 100th newest
name is left, documented). Two tests seed 150 legacy names ahead of the copies and failed with the production gauge line before the change; 396 manifest tests pass;
guards floor 3126 -> 3128. Independent review is running. Not in the PR: the 2,683 legacy files (47 GiB) — a dry-run-first deletion needs the owner's word.

## 3. EURO wind 503 (Codex S1): reproduced; cause not established

Fresh `GET /api/health/data` at 13:22:32Z: 503 critical; EURO/wind age 8.6 h, **model cycle 25.4 h (> 24 h)**; EURO/marine cycle conflicting; EURO/weather cycle missing; GFS
and ICON ok. In the 08:46Z and 12:12Z core runs: `[ECMWF EURO-Wind] fetcher subprocess timed out (>1800s)`, then Open-Meteo answers three POSTs 200 and the fourth 429, its
breaker opens, `EURO wind global_coarse fetch failed`, and the forecast_cache fallback holds 40 points: cycle skipped. The four earlier core runs (21:43Z 10-16 to 04:32Z)
logged none of this. 140 installed packages identical across the 04:32Z, 08:46Z and 12:12Z runs; no commit to the fetcher files since 2026-10-07 (`8e4eeaeb5`); the
September comment in `_fetch_common.py` records the same breaker ("8 ECMWF timeouts across the last 10 ingest runs"). `data.ecmwf.int` answered HEAD 200 for the 00Z f0/f240 and 06Z
f0. Hypotheses: throttling or slow delivery to shared runner addresses; where the child hangs is unknown because `run_fetcher_subprocess` drops the child's stderr on
timeout. Commitment 1377 (due 20:00Z) re-reads after the next core run; a small stderr-tail PR is the first step if it repeats.

## 4. Scoring stall (Codex S2/S3): most likely the outage hole, with a dated prediction

Precompute `[forecast-skill]` lines (run start; the pass logs ~45 min later):

| runs | ledgered | scored | pending |
|---|---|---|---|
| 10-08T20:48Z .. 10-13T15:15Z (the runs in the 80-run window) | ~1,375 | 0-2,984 (typ. hundreds-2,000) | 40-47k |
| 10-13T20:01Z .. 10-16T13:55Z (27 runs) | 26 logged no line; 10-15T17:13Z: 1,383 | 528 (lead 24 n=1, lead 48 n=6) | 38,174 |
| 10-16T17:06Z | 1,383 | **892** (lead 24 n=97) | 38,323 |
| 10-16T19:01Z | 1,389 | 12 | 40,931 |
| 10-16T21:50Z .. 10-17T11:44Z (9 runs) | 1,203-1,389 | **0** | 43,512 -> 54,000 |
| 10-17T11:44Z (pass 12:29:53Z) | 1,209 | 0 | 54,000, **evicted 1,020** |

Mechanism (`forecast_skill.py`): a pending row scores only when the same pass's report has a buoy observation within 90 min of its target hour; `run_skill_ledger` writes
pending only after the scored archives upload, so a pass that tried to archive during the ceiling outage lost its newly ledgered rows too. Rows for targets from ~10-16 19Z to
~10-17 17Z do not exist at any lead; the newest scored target (10-16T18:00Z) is where the surviving rows end. H1 (not proven): the stall is that hole travelling through
time. **Prediction (commitment 1379):** the first pass that observes the buoys between 16:00Z and 18:30Z scores > 0; a pass logged after 20:00Z at 0 falsifies it, and the next
step is an owner-approved CI read of `pending.json`'s target spread. Side effect (established): at the cap each pass loses ~1,000 of ~1,200 new rows (the farthest-lead ones),
which are the post-flip lead-48/72 rows the scalar read-back needs. Raising `PENDING_MAX_ENTRIES` is the owner's call, worth it only if evictions continue after scoring resumes.

## 5. The scalar read-back is re-dated (ledger 1380)

The first flagged pass is the precompute started 04:28:20Z (`SAMPLER_SCALAR_HEIGHT=1`; the 02:46Z run had 0). Lead-24 rows from it mature ~10-18T05Z, lead 48 from 10-19, lead
72 from 10-20, so "72 h of rows scored with the flag on, at every lead" is not reachable by 10-20T18:00Z; it is 10-23. The monitor's trailing windows also mix pre- and post-flip
forecasts: the AFTER read needs a forecast-time filter (`target_time - lead_h >= 2026-10-17T05:00Z`) that no instrument applies yet. New commitment 1380 (due 10-23T18:00Z) closes 1365.

## 6. Owed now

- **Owner:** the named word to merge PR 366 after review; the legacy-file deletion (dry run first); the quota and spend-cap check in the Supabase dashboard; whether to roll the
  four `MANIFEST_PUBLISH_ONE_STEP` values back meanwhile (my read: no, ~3 days of runway; the fix is hours away); the ICON far-hour release risk (ledger 1312); the position
  jump look (1322).
- **Me:** the reviewer's verdict on PR 366; commitments 1377 (20:00Z), 1379 (22:00Z), 1375 (10-18T18:00Z); the forecast-time-filtered read before 10-23; the cleanup PR for the
  one-off scored-rows gate; remove my worktrees.
