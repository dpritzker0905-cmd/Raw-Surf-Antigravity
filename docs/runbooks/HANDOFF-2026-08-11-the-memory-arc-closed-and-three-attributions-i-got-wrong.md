# HANDOFF 2026-08-11 — the memory arc closed, and three attributions I got wrong

**Branch:** `dev` · **Supersedes:** `HANDOFF-2026-08-10-the-oom-the-instruments-that-lied-and-a-flag-flipped.md`
(that one called the memory work closed; it was not — see §2).

⚠️ A **concurrent session** worked this tree throughout. Everything below was staged BY PATH.

---

## §0 READ FIRST

1. ⛔⛔ **A RENDER ENV VAR IS INERT UNTIL A DEPLOY.** `PUT /env-vars/{KEY}` returns 200, the
   read-back shows the new value, and the running process keeps the old one. Deploy explicitly
   (`POST /deploys`), then verify against the PROCESS — `/api/health`, or the code's own log line —
   never the config.
2. ⭐⭐⭐ **MATCH THE VARIABLE THAT ACTUALLY MOVES THE QUANTITY.** Three attributions in this arc
   were wrong because I matched one variable and declared the comparison clean: uptime (not load),
   boot phase (not request mix), and endpoint availability (not render-state authority). Each time
   the control looked rigorous and wasn't. **Name the confound you did NOT match, out loud.**
3. ⛔ **LIVE P1 THAT IS NOT MINE — see §5.** `series_stride` reaches `_load_kw` as a FastAPI
   `Query` OBJECT and raises `TypeError` on every affected grid resolve. 98 occurrences in 13 min.

---

## §1 THE OOM — root cause and fix, unchanged and holding

One global-bbox 48h `grid_series` cost **+170.3 MB resident for a 6.67 MB response** — a 25x
amplification — and 150 s of total idle returned **zero**. Three pages per settle against ~350 MB
of headroom ⇒ **7 oomKilled in 15 h**.

`apply_vector_budget` ran on the ASSEMBLED response while `asyncio.gather` held every hour's full
product alive: `CONCURRENCY` bounds resolution, never RETENTION. ★★★ **A budget applied after
assembly is a TRANSFER budget, never a memory one.**

✅ `0d9149b7` decimates each hour as it lands. **Production: +170.3 MB → +0.0 MB on the identical
request**, serving 35 frames instead of 26.

---

## §2 THE RATCHET — what the 08-10 handoff missed

That handoff called the memory work closed. It was not. RSS grew **+74.8 then +76.6 MB** across two
consecutive 25-min windows with `disk_product_count` FLAT at 618 — not traffic. `periodic_l2_restore`
(interval 30 min) fired once per window, and each one re-parsed a 20,007-entry manifest:
`json.loads` (~17 MB dict) + `model_validate` (~93 MB model) + `model_dump_json`, while the OLD
cached manifest was still referenced. Writing it back also rewrites mtime, busting
`get_manifest`'s mtime-keyed cache so the next reader re-parses too.

✅ **`712e3bac`** hashes the DOWNLOADED BYTES and skips the whole cycle when unchanged.
**Both branches verified in production within 30 minutes:**

    02:10:46  manifest UNCHANGED (sha 3f224797fbd4) -- skipped the re-parse      cost ~0
    02:40:44  manifest CHANGED (20007 -> 19989) -- full parse   rss 1086.9 -> 1151.9  (+65 MB)

`disk` was flat at 933 across the second, so +65 MB is the re-parse alone — which independently
corroborates the ~75 MB ratchet attribution.

★ The dangerous half is not the skip, it is skipping when you shouldn't: `_pending_manifest_sha` is
promoted to `_last_` ONLY after the write succeeds, and the skip additionally requires a live
`_cached_manifest` AND the file on disk (Render's disk is ephemeral). Mutation battery 5/5.

⏳ **OPEN CLOCK:** the long-run RATE. Skips now track the ingest cadence (~3-4 h) rather than the
restore cadence (30 min), implying a ~6-8x reduction — but that is **one skip and one parse
observed**, not a day's worth. Trough-to-trough across consecutive restores is the number.

---

## §3 THE CONFIG KNOBS — the one memory figure I would defend

`PREFETCH_MAX=120` + `PREFETCH_CONCURRENCY=2`, verified by the prefetcher's own log:
`3826 -> 400 ... conc=5` (26 s) became `3826 -> 120 ... conc=2` (**10 s**).

`MALLOC_TRIM_THRESHOLD_=131072` — glibc auto-RAISES its trim threshold as a program frees large
blocks; pinning it disables that. **Measured at MATCHED `disk_product_count` by driving the box
there deliberately:**

| | disk | RSS | % of 2,048 |
|---|---:|---:|---:|
| pre-trim | 590 | **1,445.3 MB** | 71.2% |
| post-trim (probe) | 554 | **784.0 MB** | 38.3% |
| post-trim (loader, independent series) | 582 | **794.8 MB** | 38.8% |

**≈ −650 MB at the same product count**, two independent series. RSS repeatedly sits BELOW peak
mid-flight — memory actually returned, never previously observed here.

⛔ **RETRACTED: the "−62%" I published for `PREFETCH_MAX`** was a quiet box at 8 min against a busy
box at 23. ⛔ **`MALLOC_ARENA_MAX` deliberately left UNSET** — no remaining problem justifies moving
a second allocator variable. ⚠️ A latency worry I raised and **withdrew**: the loader's `grid` p90
of 3,385 ms was cold product fetches; the warm path (`spot-ratings`) held ~385 ms median under load
vs a 268–357 ms idle baseline.

---

## §4 THE HEIGHT FLAG — flipped, and my first verdict was wrong

`679da3d9` flips `__RAW_NEARSHORE_RENORM__` ON. Kill switch `= false` restores the old behaviour
exactly, pinned to the same three constants (0.975 / 0.450 / 0.175).

Real production data, 93 real spots on a live 40%-land grid: **80/93 (86%) move**, ratio **p50
3.00x, max 10.68x**, and **ON == the period lane's own sample at 80/80 movers**.

⛔⛔ **I FIRST RECOMMENDED AGAINST FLIPPING IT**, on a 423-resolution census showing the exact-point
lane answering 100%. That measured whether the ENDPOINT can answer, not whether it is the
AUTHORITY: `isExactPointAuthority` requires `selectedSpot || longPressLocation`, while the overlay
renders whenever any layer is active (`MapPage.js:585`, second clause tautological). **In the
default map state the decayed tile value is displayed directly.**
⛔ **Proven: internal consistency.** **Not proven: accuracy** — no buoy validates this sampler.

---

## §5 ⛔ LIVE P1, NOT MINE — `series_stride` arrives as a `Query` object

    grid_resolver.py:93  return {"stride": series_stride} if (series_stride or 0) > 1 else {}
    TypeError: '>' not supported between instances of 'Query' and 'int'

`routes/weather.py:121` declares `series_stride: Optional[int] = Query(None, ...)`. `get_grid` is a
FastAPI route **and** is called programmatically as the injected resolver
(`build_grid_series(get_grid, ...)`). Called directly, FastAPI never resolves the default, so it is
a `Query` OBJECT. **98 occurrences in 13 minutes.** The route catches it, so it degrades rather than
500s — but every one is a grid request returning nothing.

Introduced by **`d68f6f2d`** (*"perf(grid_series): bound the LOAD, not the build"*). **Not from any
change of mine** — `grid_resolver.py` and `routes/weather.py` are byte-identical across the two
deployed builds (sha `5925f995dc7c9579` / `b29adc7e8ea10e80` at both). One-line fix, left for the
session that owns that work.

---

## §6 CI / ACTIONS

✅ 340 of 482 backend test files were in **no CI lane** — including every guard on the box's memory
bounds and the OOM fix's own new guards. Named families added. ⚠️ **The composition list exists
TWICE** (`ls` selector + `COMPOSITION` literal); `test_flag_lane_parity` pins them equal and caught
me editing one alone.
✅ E2E fired on markdown-only commits (9 of 30 runs) and a docs push KILLED the in-flight run of the
code commit before it — **eight consecutive cancelled runs, zero coverage**. `paths-ignore` added.
⛔ `cancel-in-progress: false` is the WRONG fix and is pinned against: this lane tests the LIVE
deployment, so a superseded run reports another commit's deployment under this commit's SHA.
✅ Render build filter set — a single markdown commit was redeploying production.
⚠️ **`render.yaml` is NOT APPLIED to this service** (3 independent tells); its `RATING_TIDE=1` was
therefore never on the serve box, now set via API.

---

## §7 STILL OPEN

* **§5 `series_stride` TypeError** — live, degrading grid resolves now.
* **The ratchet's long-run rate** (§2) — one skip and one parse observed.
* **Open-Meteo same-model control** — needs scored rows to answer model-choice vs our-chain.
* **Two credentials** in `BRAIN_RULES.md` (Supermemory + Qdrant), owner rotation; history retains.
* **333 backend test files** still in no lane · the pixel oracle's `test.fixme` · the P0 uptime
  probe · three dark flags · height accuracy unvalidated.

---

## §8 MY ERRORS — the reusable half

1. ⛔ **Three attributions wrong, each from an unmatched confound**: "−62% from PREFETCH_MAX"
   (uptime, not load) · "I shipped a production regression" (boot phase, not request mix) · "the
   tile lane is unreachable" (endpoint availability, not render-state authority).
2. ⛔ **A limit-truncated log query cannot prove absence.** I read 50 hits all after my deploy and
   concluded it was mine; the API had returned the 50 most recent. Fixed with an explicit time
   window **and a positive control in both windows**.
3. ⛔ **`rc=4` is a COLLECTION ERROR, not a caught mutation.** My mutation had broken the file's
   syntax so the guard never ran. Require the exact failure you intended.
4. ⛔ **A guard of mine was hollow** — `"x" in src` survives anywhere in a 200-line file.
5. ⚠️ **Buffering ate three measurements**: `| head` silenced a monitor, `| tail` hid an exit code,
   and Python block-buffered through `tee`. **Any probe that pipes must flush per line.**
6. ⚠️ **Windows/bash tax**: `/tmp` differs between Git Bash and Windows Python; cp1252 choked on
   `✓`; `--testPathPattern=a|b` died rc=255 because `npx.cmd` routes through `cmd.exe`.
7. ⚠️ **I nearly re-fixed something already fixed** because the stale record was my own memory.
