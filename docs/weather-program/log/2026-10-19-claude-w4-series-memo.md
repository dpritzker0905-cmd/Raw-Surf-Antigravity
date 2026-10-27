# 2026-10-19 — claude — W-4: the series serve path (page memo, shared builds, off-loop encode), dark

Session: side session started from the scrub-audit lead (2026-10-18 audit, `docs/audits/2026-10-18-weather-scrub-audit/`
on PR #386, §5 ranks 4-5, §7 W-4, `evidence/lane-perf.md`). Branch `claude/w4-series-page-memo`, worktree
`.claude/worktrees/w4-series-memo`, cut from dev `d8614c36e`, dev `697ad0693` (#388) merged in. Backend only.

## Problem (from the audit, not re-measured live)

Live Render logs 2026-10-19 02:37Z: `/grid_series` p95 10 s, p99 13.8 s on the one 1-CPU box. Every zoom step asked for
the same 48-hour page under a slightly different bbox (4 bboxes in ~25 s) and nothing keyed below the exact bbox; no
page was shared across clients or across two identical requests in flight; the flag-off response went through
`jsonable_encoder` + Starlette gzip 9 on the event loop.

## What changed (all behind `GRID_SERIES_PAGE_MEMO`, default off, registered in `_RATING_FLAGS`; owner flips)

- `services/weather_pipeline/series_page_memo.py` (new). The route dispatches here when the flag is on.
  1. Snap: the resolver's own tile snap (`get_snapped_bbox`: 1 deg GFS, 2 deg otherwise); the page is BUILT for the
     snapped box. Refused (exact bbox kept) when it would cross a span edge the server branches on (8 / 20 deg reval
     caps, 4.75 surf full-cover, 15 deg wide cut, 90 / 180 global view, 350 global, 100 wind dynamic cut, mid-tier
     min/max), the antimeridian, or the plain lon/lat box. A guard test fails when a new `*SPAN*` env read appears in
     `weather_pipeline/` without joining the edge list.
  2. One build per key (model, domain, layer, snapped bbox, hours, surf, anchor + its source) in flight; a finished
     page is kept as its gzip bytes (TTL 180 s, 32 MB, 64 entries, all env-tunable). Any manifest write clears it (token
     = manifest object id + `last_manifest_update` + product count). NOT kept: missing hours, a frame with an SWR
     sharpen pending or from a preview tier, a frame the per-hour loop did not build (fast paths, live recovery), a
     2-deg mid clip inside the sharpen span. The per-hour loop reports `stale` / `cache_hit` through a ContextVar
     (`SERIES_FRAME_SINK`, `grid_series_helper.py`); the payload is unchanged.
  3. The direct serializer (`series_response.encode_json`, the PF03 path, now a shared function) + gzip
     `GRID_SERIES_GZIP_LEVEL` (default 4, clamped 1-4) in a worker thread, once per page.
  4. Stages: `request_telemetry.record_stage` (build / encode / gzip / memo_hit|miss|shared) under `/api/health`
     `request_telemetry.stages` (absent until used), plus a `Server-Timing` header on every flagged response.
  - A shared build sees a disconnect only when EVERY waiting client is gone. With `GRID_SERIES_RESPONSE_BOUNDS` also
    on, the one shared build takes that envelope's admission slot.
- `server.py`: `GZIP_COMPRESSLEVEL` env for the global GZip middleware, default 9 (unchanged).
- Not touched: `mid_res_tier.py` (Codex owns exact-time selection, `~/.codex/worktrees/0806`), `store_helpers.py`
  (the per-hour full-product parse on L1 miss and the L1 vector-budget thrash stay open: see Next).

## Measured (offline only; the live backend was not contacted)

Instrument: `serve_synthetic.py` from #388 (`--models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves`, 115
three-hourly frames, 1.5 GB), two server processes on one store (flag off :4110, on :4111), curl, psutil CPU of the
server process tree; plus an in-process stage split. Owner's PC with the deployed pins (Python 3.12.10, FastAPI 0.110.1,
pydantic 2.11.7), NOT the Render box: ratios carry, absolute ms do not. 48-frame pages. Evidence
`evidence/w4-series-memo-2026-10-19.json`.

Stage split, in process, same payload object (paired):

| page | build cold | encode legacy -> direct | gzip 9 -> 4 (-> 1) | bytes gzip 9 / 4 / 1 |
|---|---|---|---|---|
| GFS waves world | 2,257 ms | 806 -> 189 ms | 252 -> 46 (27) ms | 729 / 854 / 1,007 KB |
| ICON swell_1 world | 2,110 | 792 -> 243 | 264 -> 57 (29) | 712 / 838 / 992 |
| EURO waves world | 2,076 | 815 -> 209 | 257 -> 44 (27) | 728 / 858 / 1,008 |
| GFS wind_waves 13 deg | 7,361 | 134 -> 33 | 16 -> 7 (3) | 35 / 59 / 93 |
| EURO swell_2 world | 229 | 540 -> 152 | 70 -> 14 (7) | 107 / 124 / 142 |

Decoded legacy == decoded direct on all five. Gzip 4 chosen as the default: the memo pays it once per page, and it is
~1/5 of gzip 9's CPU for +17% bytes (gzip 1 is +38%).

HTTP A/B (server CPU / wall ms; second run, gzip 4):

| page | off cold | off repeat | on cold (build / encode / gzip) | on, jittered bbox | on, identical repeat |
|---|---|---|---|---|---|
| GFS waves world | 4,250 / 4,339 | 1,796 / 1,830 | 3,125 / 3,261 (2,715 / 322 / 58) | 0 / 46 hit | 0 / 56 hit |
| ICON swell_1 world | 4,984 / 5,200 | 2,609 / 2,844 | 3,625 / 3,774 (3,399 / 272 / 54) | 0 / 41 hit | 15 / 43 hit |
| EURO waves world | 3,640 / 3,771 | 1,265 / 1,312 | 2,781 / 2,776 (2,469 / 225 / 42) | 0 / 54 hit | 0 / 37 hit |
| GFS wind_waves 11.7 deg | 6,546 / 6,709 | 6,531 / 6,701 | 6,593 / 6,779 (6,718 / 31 / 5) | 15 / 21 hit | 0 / 21 hit |
| EURO swell_2 world | 1,406 / 1,436 | 703 / 723 | 437 / 446 (273 / 129 / 15) | 0 / 24 hit | 0 / 22 hit |

- Acceptance "second identical request <= 10% CPU of the first": 0-0.4% (psutil resolution 15.6 ms on Windows).
- Acceptance "decoded frames byte-equal": flag-on page (raw and jittered bbox) == flag-off page for the snapped bbox,
  whole decoded payload, all five pages.
- The flag-off repeat still costs 30-100% of a cold build (no page memo; L1 products only).
- The 13-deg GFS wind_waves page builds in ~6.5-7.4 s even warm, offline: a regional per-hour cost the memo hides but
  does not fix. Not diagnosed here (Next).
- First run's CPU column read 0 ms everywhere: on Windows the venv `python.exe` is a launcher whose CHILD is the
  interpreter; psutil must sum the process tree. Its regional jitter pair also crossed a 1-deg grid line and the 12-deg
  edge (a CLIENT pad threshold I had wrongly listed as a server edge, now removed). Both kept in the evidence file.

## Tests

`backend/tests/test_series_page_memo.py` (30, `--lane guards`): flag-off route untouched; decoded equality vs flag-off
for the snapped bbox (gzip and identity); memo hit after one build across jittered bboxes; three concurrent requests ->
one build (miss, shared, shared); manifest write clears; four uncacheable classes; mid clip inside the sharpen span; one
disconnected tab does not stop a shared build; snap edges incl. antimeridian/unwrapped; the `*SPAN*` completeness
guard; gzip clamp; stage telemetry; admission with the envelope on; the real per-hour loop feeding the sink. Mutations
(edge guard off, manifest clear off, waiter logic inverted, stale filter off) each go red. Neighbouring suites (31
files: series, telemetry, flag registry, health, grid_response) 711 passed. Floors: guards 3212 -> 3242, files 207 ->
208, `_FLOOR_SET_FROM["guards"]` 3218 -> 3248 (projection; hosted CI is the authority).

## Next

- Owner: flip `GRID_SERIES_PAGE_MEMO=1` on Render (and optionally `GZIP_COMPRESSLEVEL`); read-back is ONE bounded
  `/api/health` comparison (`request_telemetry.stages` memo_hit share, `/grid_series` p95) before/after, no load test.
- The per-hour full-product parse on L1 miss and the L1 vector-budget thrash (lane-perf A3 ranks 1 and 3), and
  `copy.deepcopy` of a clip-cache hit (rank 6): `store_helpers.py` / `mid_res_tier.py`, after Codex's exact-time work lands.
- Why a 13-deg regional page builds in ~7 s offline.

## 15:50Z — review fixes (two independent reviewers, via the lead session)

All five findings held in the code; each is fixed on the branch, still dark.

- **F4 (medium):** `_Waiters.is_disconnected` was not sticky, so a client could join a flight after every earlier
  waiter had gone and the per-hour loop had stopped, and be served the truncated page (flag off it would have built a
  full one). Now: abandonment is sticky, a watcher cancels the build the moment every waiter is gone
  (`GRID_SERIES_PAGE_MEMO_CANCEL_POLL_S`, 0.25 s), the gone clients get 499, and a later client starts its own build.
  This is also the server-side cancellation the lead asked for after a layer switch. Abort probe (cold 48-frame world
  page dropped after 0.5 s, then a `/grid` for another layer): server CPU in the 4 s after the drop, flag off -> on,
  GFS 3,094 -> 344 ms, ICON 2,688 -> 594 ms, EURO 172 -> 266 ms (EURO's page was mostly warm). The `/grid` itself
  answered in 160-620 ms either way offline.
- **F5:** a failed shared build is now logged (`logger.warning` with the traceback) even when nobody waits.
- **F6:** a manifest read failure now uses one fixed sentinel token: in-flight sharing still works, no page is kept,
  and the warning is at most once a minute (it gave every request its own token and a traceback before).
- **F7:** `build_grid_series(resolved_anchor=...)` takes the (anchor, source) the key was made from; an hour rollover
  between keying and building can no longer file one hour's page under the other's key. `base_time_source` unchanged.
- **Item 5:** with `GRID_SERIES_RESPONSE_BOUNDS` also on, waiters are refused with the envelope's 503 AT its deadline
  (outer `wait_for`) and late output is refused after build and after encode, as `serve_series` does.

Tests: +7 (37 in the file). Mutation per fix (sticky flag, joiner refusal, cancel, sentinel put, outer deadline,
anchor, log level): all red. Two of my first tests did not pin what they claimed (the joiner case ran after the flight
had already ended; `asyncio.run` cancels leftover tasks at teardown, which faked the cancel signal), and were rewritten
until the mutations went red. Neighbouring suites 780 passed. Hosted run 39259510389 (first push) read guards 3248 /
208 files = the projection; floor now 3249 for 3255.

Re-run A/B on the fixed code (evidence `evidence/w4-series-memo-review-2026-10-19.json`): repeat or jittered page
0-0.6% of the cold CPU, decoded payload equal to flag-off for the snapped bbox on all 5 pages.

Ledger: my 1447/1448 had forked from dev's 1446 (dev gained 1447 = #390, pr_merge #388); took dev's file byte for byte
and re-appended them as 1448 (pr_open) and 1449 (commitment) with their original times, plus 1450 (this push). Open
PRs #391, #392, #393 each carry one ledger line too: whichever of us merges second re-appends.

Harness note: ports 4110/4111 were held by ANOTHER session's harness (`--regions flagship`, a `wind` layer); I moved
mine to 4130/4131 and did not touch theirs. On Windows `Popen.terminate()` stops only the venv launcher, so a bench must
kill the process tree or it leaves the interpreter holding the port.

## 22:17Z — rebased onto dev 88e762fe0

#389 was CONFLICTING after #391/#393/#394/#396/#397/#398 merged. Rebuilt the branch as origin/dev `88e762fe0` + the
#389 diff (code applied cleanly; dev had touched `surf_forecast.py` and `server.py` elsewhere). Floors recomputed on
dev's unchanged guards floor (3212 / 207, set from 3218): 3218 + 37 = 3255 projected, floor 3249, 208 files. Ledger:
took dev's file as is (head 1457) and re-appended this branch's lines as 1458 (pr_open), 1459 (commitment, the flip
read-back; was 1449 then 1448), 1460 (the review-fix push), 1461 (this force-push). Old head kept locally as
`backup/w4-pre-rebase` (`3a52a1ec2`). STATE's Now entry re-added (dev's STATE never had it).

Asked by the lead: does cancellation cover a NON-shared build? Yes. A flight's waiter set is whoever asked for it;
with one client that is the only waiter, so when it disconnects the watcher cancels the build within one poll
(0.25 s). The abort probe above (15:50Z) was exactly that case: one client per page, no sharing. Caveat: what is
cancelled is the asyncio build; a product load already inside a worker thread (`asyncio.to_thread`) runs to its end,
and the flag-off path is unchanged (it still only stops starting NEW hours after a disconnect).
