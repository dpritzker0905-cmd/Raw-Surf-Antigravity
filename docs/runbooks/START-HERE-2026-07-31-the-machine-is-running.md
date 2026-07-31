# START HERE — 2026-07-31 · the machine is running; your job is to check it, then build #5

**Read [[standing-work-rules-user-mandate]] and the memory spine
(`THE-SURF-FORECAST-SCIENCE-canonical-chain.md` — now carries 7 invariants + the DATA
ARCHITECTURE) first. This doc supersedes reading the 2026-07-30 handoffs individually** (they
remain the forensic record: NIGHT + PART 2, `HANDOFF-2026-07-31-geometry-in-the-db-and-the-queue`).

Branch `dev` == `origin/dev` == `513fd568`+. **16 commits shipped 2026-07-30**, CI green,
full backend suite green at last run. Production schema migration `surf_spots_geometry_columns`
applied and seeded (DB-verified 1,360 rows).

---

## 0. ⚠️ FIRST 10 MINUTES — verify the autonomous machine actually ran overnight

| what | how to check | expect |
|---|---|---|
| Retention roll-up (first ever) | first <06 UTC calibration run log: `residual history rolled up` | `calibration/history/residuals-2026-07.json` exists on L2 |
| Skill ledger (first rows) | same log: `[forecast-skill] ledgered=` | `calibration/skill/pending.json` exists; `forecast_skill` table in `buoy_latest.json` |
| OM climatology resume (06:10 task) | `%LOCALAPPDATA%\raw-surf-climatology-backfill.log` | an inbox batch `om-v2-*` uploaded (~150 spots) |
| ERA5 campaign night 1 (21:30 task) | `%LOCALAPPDATA%\raw-surf-era5-campaign.log` | inbox batch `era5-v3-*` (Tp/Tm ratios ~1.1-1.4) |
| Inbox folded by the single writer | precompute log: `inbox batches folded` ≥ 1 | markers appear in `spot_ratings/size_climatology.json` |
| Timeline stays clean | `cd backend && python scripts/timeline_slot_census.py` | 0 dead, ~0 substituted, 0 off-lattice |

⚠️ Both Windows tasks are **Interactive-only** — they run only if the machine was on and the user
logged in. A missed night just resumes the next one (all lanes are idempotent).

⚠️⚠️ **A KILLED RUN LOOKS EXACTLY LIKE A MISSED ONE — CHECK `LastTaskResult`, NOT JUST THE LOG.**
Measured 2026-07-31: the ERA5 campaign's first-ever firing died after ONE download with
`LastTaskResult = 3221225786` (`0xC000013A` = STATUS_CONTROL_C_EXIT) and a bare `^C` at the end of
the log. Root: both tasks shipped with **`StopIfGoingOnBatteries = True`**, so a laptop dropping to
battery terminates the job mid-run. ✅ Fixed on both tasks (`StopIfGoingOnBatteries` and
`DisallowStartIfOnBatteries` now False) — re-apply if `install_*_schedule.ps1` is ever re-run,
because the installer still creates them with the default settings.
    Get-ScheduledTask -TaskName "<name>" | Get-ScheduledTaskInfo   # LastTaskResult 0 = clean
Resuming is always safe: the campaign's resume filter skips spots already deepened in the blob OR
pending in the inbox, and it writes to the INBOX (invariant 6), never the blob.

## 1. WHAT IS TRUE NOW (each item live-proven 2026-07-30, see the session memory for numbers)

* **Blank-day family DEAD in production** — run 30570760864's own log: no purge line, on-lattice
  tail, `[Lattice Fill] 54/54, 0 wide holes`; census all-clean. Guard: `timeline_slot_census.py`.
* **Geometry lives on the spot row** — 1,360 seeded (1,354 etopo + 6 override); uncertainty now
  queryable: **589 tight(≤10°) / 551 medium / 214 loose / 413 no-fit**; moved pins self-invalidate
  (>150 m from `geometry_lat/lng`). SERVING UNCHANGED (asset/overlay, DB-free — proven: sim ↔ DB
  values identical, parity 0.06%).
* **One composition, three surfaces, still exact** — glyph frame 53.9/fair vs sim 53.9/fair at
  Mavericks, different machines, same night.
* **Climatology architecture is single-writer + inbox** (invariant 6) after a measured erasure.
  `RATING_LOCAL_SIZE` stays OFF until `scripts/local_size_gonogo.py` says GO (owner flips).
* **The skill ledger records every +24/48/72h forecast** at ~60 buoys (ours + Open-Meteo lane),
  scored on NDBC truth as targets arrive. ~2 weeks to a meaningful per-lead MAE table — the gate
  for the 4,000+ expansion.
* **Height correction is PER-SITE, not global** — 67.5% of residual variance is between-buoy; the
  global map REFUSED by its own instrument (`fit_quantile_map.py` prints NO-GO, refuses upload).
* **ERA5/CDS lane open** (`~/.cdsapirc`) — 47y per spot in ~32 s; v3 composite = timeseries
  (Hs,Tm,dir) × per-spot Tp/Tm from one gridded year (wave grid is ~0.5° — pad areas ±0.5°).

## 2. ✅ DONE 2026-07-30 (same night) — task #5: partitions into the RATING (+ #13 A/B)

Shipped in one arc: the response CARRIES the reconciled trains its own height ran on
(`response.partitions`, attached at the single injection point), and ALL THREE surfaces + the
infobox badge grade that list (reference converted to BY-NAME; registry all SUPPLIED; the JS
mirror already had the factors — only the whitelist + badge call were missing). Flag stays OFF.

* **Swept A/B (`scripts/partitions_rating_ab.py`, 40 spots × 8 regions × 2 h, live data):
  LEVEL moves on 50.0% of spot-hours** (14 up / 26 down — demotes chop-dominated seas, recovers
  groundswell hidden under windsea). Score delta median −0.8 (p10 −15.0 / p90 +11.1); height
  median +3.2% (−27.7…+50.2%); reconcile mismatch median 4.6%, max 111.8%; live-lane cost
  +0.6 s median/point; precompute arithmetic 10,638 → 42,552 marine resolutions/cycle.
  Baseline parity local-vs-served: 0.00% median. ⇒ **the flip is a product event: owner call,
  3 lanes together** (flag now visible in `_RATING_FLAGS` + declared '0' in BOTH workflow envs).
* **24-agent adversarial review: 15 confirmed (5 mutation-verified test gaps), all fixed same
  night** — NaN self-inequality guards (NaN train → level 'epic'), `partitions_represent`
  (lone-train inflation gate, shared by both suppliers), `_sane_partitions` (sim trust
  boundary), composition-matched `baseline_delta` (+12.5 was 100% composition artifact),
  komar-fallback drops trains, hub helper structurally fail-open.
* Remaining before any flip: precompute wall-clock measured ON THE RUNNER; owner reviews the
  50%-level-change A/B. Goldens untouched (engine byte-identical).

### ⛔ THE NEXT BUILD — geometry wiring that remains (audit-corrected order)
1. **`geometry_reject_reason` backfill FIRST** (413 never-resolved rows are mostly gate-REJECTED;
   a naive reconcile burns 413×22 s reproducing rejections 24/24).
2. Reconcile job (new/moved only, cap ~5/cycle, decoupled cron, DB write via direct SQL — REST
   PATCH is 403 by RLS posture; ⚠️ workstation has `PGHOSTADDR=0.0.0.0` machine-wide, pop it
   per-process; the prod DATABASE_URL password has unencoded specials — parse at the LAST `@`).
3. Overlay rehydrate-from-DB at serve-box boot (fixes overlay ephemerality).

### Then, accumulation-gated
Climatology fills → gonogo → owner flips `RATING_LOCAL_SIZE` (the 4ft≡12ft fix) · skill verdict
(~2 wks) → Surfline third lane (ToS + spot-id map) → **4,000+ expansion (task #6)** ·
per-site offsets as retention deepens · Kr+H1/10 TOGETHER after partitions.

## 3. ★ THE TRAPS THAT BIT TONIGHT (do not re-learn)
1000-row silent REST truncation (4th time — PAGINATE) · timestamps-over-nulls + `"undefined"`
phantom variables on Open-Meteo · weighted historical API budgets (~65 calls per 4y fetch) ·
`PGHOSTADDR` env hijack · cp1252 console vs unicode · "verified uploaded" ≠ durably stored ·
a merge that tolerates a None base is a reset waiting for a timeout.
