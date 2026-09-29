# 2026-09-29 · consensus builder, dispatch token, a glyph bug from the failed runs

Owner: the worktree session (`raw-surf-wt`). Append-only; only this session writes this file.

## ~08:30Z · start-of-context checks
- `dev` = `e82f59c8` (#153), healthy; every data lane green since the night; MOP ingest recovered at 06:10Z after the
  23:30Z CDIP 403s. `workflow_dispatch.armed: false` (no token yet).
- Ledger `by_band` and `by_region` published for the first time (numbers in SCOREBOARD, 11Z row, and D-006's flip
  caveats). Decision D-006 unchanged; Hawaii and small seas are the flip caveats.

## ~09:00Z · #161 (consensus PR A) opened
- `consensus_product.build_equal_mean(gfs, euro, icon)`: a copy of the GFS waves product carrying the equal mean
  where all three members answer, with GFS's period and direction; diagnostics carry members, counts and the
  consensus/primary ratio; mismatched inputs are refused. `equal_consensus` moved from the judge module so the judge
  and the builder share one definition.
- **Correction of the handoff:** "sampler 0.16 ms/sample, no cache needed" held only for small tiles. The sampler
  rebuilt its grid index (and resolution) on every call: 2.66 ms/sample on a 5,917-cell Brazil tile, ~25 s per frame.
  `PointSampler(memoize=True)` (opt-in; guarded to the builder) → 0.15 s. (LESSONS L-S9)
- 21 tests, 9/9 mutations red, chain floor 128/1495.

## 13:27Z · #161 merged on the owner's word (`e4c27fd7`); owner set the token
- Hosted chain 128 files / 1501 passed, exactly as projected.
- After the owner's manual deploy and the #161 deploy: `workflow_dispatch.armed: true` (13:30Z).

## ~13:35Z · failed runs triaged (owner asked "check logs to see what runs failed")
1. **Sim Parity 11:24Z = a real served-number bug.** 32/48 spots a level apart with heights within ~1%;
   `glyph_reference_size_m` null on all 48 (present on all 48 at 02Z). The 02:43Z precompute's GFS pass logged
   "0 spots have a size reference": at 02:48:41Z the prefetcher drew Supabase Storage 429s, the climatology read got
   the same 429 → None → every spot rated on the global default, served ~9 h (Trestles 63.4 vs 38.7). 1 pass in 90
   over 5 days. → **#162** (LESSONS L-F1).
2. Sim Parity 22:33Z on 09-28: glyph frames still on the pre-#146/#120 chain; the 23:01Z rebake fixed it, #150
   automates it. No action.
3. Forecast Accuracy Monitor 06:48Z: **false alarm.** Ledger passes 34-37 min after the previous one scored 0
   (scored vs gap: 3 h → 1,282; 66 min → 36; 34 min → 0; 37 min → 0; 11:57Z → 1,005). (LESSONS L-F4) Fix queued.
4. Marine Nightly zoomlab 13:14Z (and 09-28): 12 consecutive MULT0 frames (~7 s); 09-28 was 15 s API timeouts. n=2
   with different signatures: recorded, not diagnosed.

## ~13:40Z · #162 opened
- Status-aware climatology loader (failed vs absent), retries 3 s / 6 s, the precompute refuses the pass and the
  model keeps its previous frames. 20 tests incl. a replay of the 02:48Z 429-then-200 sequence; 7/7 mutations red
  (+1 equivalent). Chain floor 129/1515. Residual: the live `/spot-ratings` fallback.

## ~13:45Z · memory moved into git (D-008)
- This folder created: README (protocol), STATE, DECISIONS (D-001..D-008), SCOREBOARD (seeded with the measured rows
  above), LESSONS (migrated from agent-local memory, without infrastructure IDs), and this log.
- The untracked `audit/weather-simulation-15.0/HANDOFF.md` on the main machine is frozen history from now on.

## ~13:55Z · #162 merged; D-009
- #162 merged on the owner's word (`f18c7ab8`); hosted chain 129 / 1521 exactly as projected.
- Designing consensus PR B surfaced two flaws in rewriting GFS tiles in place: the pre-flip evidence would come only
  from the judge's approximation, and the ledger/judge would lose their GFS baseline (their equal arm would count
  EURO and ICON twice). Asked the owner once with a recommendation → **D-009: shadow product first.**
- Found for PR B: the point resolver's live marine fallback runs only for GFS/ICON/EURO, so a `CONSENSUS` point reads
  the manifest or answers unavailable (no upstream calls); `/point` and `/grid` accept only GFS|ICON|EURO (the
  judge arm needs that widened in PR C); the ICON regional pilot covers 2 days and the four GFS-only regions have no
  EURO/ICON tiles, so members come from their coarser tiers via `manifest_point_selection`.

## ~14:10Z · #164 opened: consensus PR B, the shadow (D-009)
- `consensus_ingest.py`: a pilots-lane job after the three members' regional passes builds the equal mean of every
  GFS regional waves frame (latest run per region) as model `CONSENSUS`. Each member is answered per cell by the
  point resolver's own pick (`point_candidates` → `choose_for_point` → `load_product`, its 3 h window included,
  offsets counted). Unanswerable cells are masked; frames that blend nothing are not saved. Hour-major, so a global
  member file loads once per hour for every region (not once per region: the fan-out behind today's 429s).
- One switch (`CONSENSUS_INGEST`, `'0'` in all three lanes) registers the job and adds the `raw_surf:CONSENSUS`
  ledger lane; the prefetcher never warms shadows; a `CONSENSUS` point reads a stored product or answers 404
  `no_backend_coverage` with no upstream call (pinned end to end).
- 16 tests, 530 nearby pass, 11/11 mutations red, chain floor 130/1531. No served number changes, armed or not.
- Next: arm it (all three lanes) on the owner's word, then PR C grades the shadow in the ledger against the served
  lane and the computed equal mean (a positive control), and widens `/point` for the judge arm.

## ~14:15Z · the dispatch token lacks Actions WRITE (403)
- Render logs, 13:46Z (the first pass after arming): `forecast-ingest.yml: error: RuntimeError: dispatch HTTP 403`,
  `forecast-ingest-pilots.yml: … dispatch HTTP 403`, `mop-nearshore-ingest.yml: slot 12:40Z served by run 36574129754`.
  The runs listing worked (the decision was reached), so the token reads Actions but cannot write them. The
  dispatcher's decisions were right: the core 12:15Z slot and the pilots 11:45Z slot had no run.
- Owner action: edit the fine-grained token → Repository permissions → **Actions: Read and write** (the token value
  does not change, so Render needs no update). `last` in /api/health is in memory and resets on each deploy; the
  Render log lines `[workflow-dispatch]` are the durable record.

## 14:30Z · CORRECTION: the first two headings of this log are 4 hours off
- "~08:30Z · start-of-context checks" was really **~12:30Z**, and "~09:00Z · #161 opened" was really **13:06:13Z**
  (`gh pr view 161` createdAt). I read this machine's local clock (EDT, UTC-4) as UTC. The headings from 13:27Z on
  came from `date -u` and GitHub and are right. The wrong headings stay as written (append-only); this entry, and
  ledger line 16, correct them.

## 14:28-14:40Z · #164 and #163 merged; accountability built (owner: "be accountable for every action you do")
- #164 merged on the owner's word at 14:28:05Z (`09cbca84`; hosted chain 130 / 1537 = projection); #163 at 14:31:20Z
  (`9358324d`, docs only). Both read back with `gh pr view`.
- **The action ledger** (`ACTIONS.jsonl`, BRAIN_RULES §23): one line per state-changing action or correction, with
  the authorizing words, evidence, read-back verification and rollback; SHA-256 chained; STATE publishes the head;
  CI (`weather-program-ledger.yml`) runs a selftest (15 tamper cases, each caught by its OWN check, including a
  re-chained rewrite of history that only the anchor or the base prefix can catch), verifies the chain and, on a PR,
  requires the base ledger to be a byte-exact prefix. Removing any of the verifier's 11 checks fails the selftest.
  Seeded with today's 17 actions, reconstructed from GitHub, Render and the logs (flagged `reconstructed`).
- **The memory check-over** (`memory_audit.py`, first run 14:24Z): 12 of 12 local memories had no record of when
  their facts were last checked → each now carries an honest `metadata.verified` (today only where re-checked
  today). The index, links and frontmatter were sound. BRAIN_RULES §21 mandates Mind/Memstate/Trevec, none of which
  this session has (§23 names the git record as the shared memory). `.antigravityrules` §22 has drifted from
  BRAIN_RULES §22 (no authorized main-push exception): recorded, not changed.
- **Correction** (ledger line 16): this log's first two headings are 4 h off (local EDT read as UTC).
- Verified at 14:39Z: `action_ledger.py verify` → 20 entries OK; `memory_audit.py --memory-dir …` → 0 FAIL, 0 WARN.

## ~14:42Z · #166 opened: the accuracy monitor judges liveness on the archive
- The 06:48Z page came from judging only the latest ledger pass. Measured basis for the new bound: 127 successful
  calibration passes (precompute + core ingest) over 14 days, gap p50 2.0 h / p90 5.2 h / p99 7.1 h / max 8.6 h,
  so dead = no scored target newer than 16 h (~1.5x the worst healthy ~10.6 h). The archive unreadable keeps the
  old rule; last month's archive is read near a month boundary. 8 tests, 7/7 mutations, guards floor 174/2118.
- After merge, verify by dispatching the monitor and reading its new `skill ledger liveness:` line (the real
  newest-target age, which the 16 h bound assumes is ~2 h behind the last pass).
