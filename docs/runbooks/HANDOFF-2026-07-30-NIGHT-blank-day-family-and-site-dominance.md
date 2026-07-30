# HANDOFF 2026-07-30 NIGHT — the blank day was self-inflicted, and the height error lives at the site

> **PART 2 (late night) is at the bottom — read it too: the census PROOF landed, the CDS lane
> opened, the climatology got a single-writer inbox after a measured erasure, and the skill
> ledger + two nightly campaigns are live.**

**Continues `HANDOFF-2026-07-30-real-data-for-every-glyph.md`.** Read
[[standing-work-rules-user-mandate]] and the spine first.

**Branch `dev`, EVERYTHING PUSHED** (`origin/dev` == `4f12dcd0`). Backend **1,535 passed** full-suite
(one flake: `test_event_bus` latency benchmark under parallel load — passes alone in 0.47 s), all
new suites green, LOC ratchet safe (largest touched file 742).

| commit | what |
|---|---|
| `76b52451` | the startup purge was deleting real DWD natives — the blank day was self-inflicted |
| `66051837` | the ICON tail sat one hour off the scrub lattice, permanently |
| `cc6455a9` | interpolate the in-band slots a 6-hourly source leaves empty (+ the census instrument) |
| `86d511a3` | retain forecast↔observation pairs permanently (monthly append-only history) |
| `3138db1b` | the height quantile map — fitted, measured, and refused by its own instrument |
| `4f12dcd0` | research: the height residual is 67.5% site |

---

## 1. ★★★ THE BLANK DAY (queue #7, user-reported) — three roots, all fixed, one self-inflicted

Measured live before touching anything (`backend/scripts/timeline_slot_census.py`, new):

1. ⚠️⚠️ **The blank-maker: our own startup hygiene.** `store_helpers` purged every non-estimated
   ICON wind product beyond **wall-clock NOW+120h**. The DWD-direct path delivers real natives to
   **run+180h**, so the first restore after every ingest destroyed the last ~60h of real data —
   and the estimated tail stayed anchored at old-run+181h. Live: a **46h dead hole (13 lattice
   slots >3h from any product) that GREW to 16 while being measured** — a hole that grows on the
   wall clock names its own cause. Fix: run-relative cutoff (`ICON_WIND_NATIVE_HORIZON_H`=180,
   +6h slack), lenient fallback when run_time is missing. RED-verified against the old expression.
2. **Off-lattice tail:** the tail sliced STRICTLY AFTER native_max then blind-stepped 3 — a 12:00
   native end produced 13:00/16:00/19:00 forever (all 52 live tail products off-lattice ⇒ every
   scrub slot served a 1h-substituted neighbour). Fix: `_slice_hours_after(..., align_step_h=3)`
   + step=1. Self-heals on the next DWD ingest via the write-new-then-delete-old estimate prune.
3. **The EURO 6-hourly cadence** (the prior session's attribution — real, but only a third of the
   story): ECMWF open-data is 6-hourly past +144h, leaving 12–16 exact-slot gaps per global tier
   on EURO waves AND **EURO wind** (previously unrecorded; the CMEMS-fed partitions are clean).
   Fix: **`lattice_fill.py`**, a decoupled-cron job after the extension jobs — interpolates any
   lattice slot whose brackets are ≤6h apart (height/period linear, direction circular via the
   estimator's own blend, a cell valid only when BOTH sides are; `is_estimated`, basis
   `native_time_interpolation`). ⛔ **Wide holes are REFUSED by design** — a 46h hole is data
   loss and must stay visible in cron logs, never be painted over with a 2-day straight line.
   Kill: `LATTICE_INBAND_FILL=0`, cap `LATTICE_FILL_MAX_BRACKET_H=6`.

★★ **The serving side was never the bug** — `find_candidates` is inclusive at exactly 3h and
`stamp_frame_honesty` labels substitutions. Verified live before changing anything.

### ⚠️ VERIFICATION STILL PENDING (the one open loop)
A manual `forecast-ingest` run was dispatched on the fixed SHA (**run 30570760864**) but QUEUES
behind an in-flight run on the old SHA (concurrency group). Once it completes:

    cd backend && python scripts/timeline_slot_census.py

Expect: ICON wind global_coarse **dead=0** (natives to run+180h), tail on-lattice
(off_lattice=0 after its first post-fix DWD ingest), EURO waves/wind substituted → filled by
`Lattice In-Band Gap Fill` (grep cron logs for `[Lattice Fill]`). ⚠️ The serve box also purges at
restore — Render must pick up the new SHA for the purge fix to stop re-trimming there too.

---

## 2. ★★★ THE HEIGHT PIVOT — the strategy's phase 1 was executed and REFUSED itself

Phase 1 said: fit EQM on the three fittable bands. **Built** (`height_quantile_map.py` — monotone
matched-quantile knots, per-side identity blend margins scaled to the edge correction; fixed
margins FOLD BACK non-monotonically, the tests caught it), **fitted on production** (1,973 rows /
60 buoys), and the measurement said NO:

* 0-0.5 and 0.5-1.0 improve; **1.0-1.5 regresses (MAE 0.270→0.305), 1.5-2.5 regresses
  (0.323→0.341)**. A conditional-mean candidate helps mid, hurts high, and its bin deltas zigzag.
* ★★★ **67.5% of the residual variance is BETWEEN buoys** (per-site bias −0.53…+0.93 m, SD
  0.316). The stratified "compression" is substantially **site composition**: over-reading buoys
  are small-sea sites (mean obs 0.4-0.6 m), under-reading ones are big-sea sites (1.4-2.3 m).
  **Same site-offset dominance as nearshore Kr, one layer up.** r(model,obs)=0.773.
* ⇒ `scripts/fit_quantile_map.py` prints the decomposition + a SHIP/NO-GO verdict and **refuses
  `--upload` on NO-GO**. Nothing in the engine reads the blob; `HEIGHT_QUANTILE_MAP` never
  shipped. **Do not re-run the global-map plan** — the instrument carries its own conclusion.
* Doc: `docs/research/HEIGHT-RESIDUAL-site-dominance-2026-07-30.md`.

### The unlock is RETENTION, and it is live (`86d511a3`)
`buoy_residual_retention.py`: once per UTC day (first calibration run with hour <6), the ~14-day
hot archive rolls into **append-only monthly segments** `calibration/history/residuals-YYYY-MM.json`
— dedup on (buoy_id, buoy_time), no caps, uploads only on growth, NEVER raises (a storage failure
cannot cost the report; pinned by test). Verify tomorrow: grep an early-UTC cron log for
`residual history rolled up`. Per-site fits become fittable when each buoy holds independent
weather systems — weeks, not 2.5 days.

---

## 3. THE SIM — measured healthy again this session (no work needed)

Live sweep via the MCP: forecast (Mavericks: geometry full/etopo, parity **−0.26%** vs served,
`why` + provenance complete) · what-if (holds omitted inputs, `baseline_delta` +17.0 "better",
zero writes) · `find_best_window` (Sebastian: 17/17 frames, daylight gating correct). The brief's
"sim features" remain the previous session's shipped state; this session's product work was the
data those features stand on.

---

## 4. ⛔ THE QUEUE (updated)

1. ★★ **Verify the blank-day fixes live** (§1 — one census command after run 30570760864 + a
   Render deploy of `dev`).
2. ★★★ **ERA5 per-spot climatology** (`era5_spot_climatology.py`) — **BLOCKED ON A USER ACTION:**
   no Copernicus CDS credentials exist anywhere (no `~/.cdsapirc`, no env, no `cdsapi` dep).
   The owner must register (free) at cds.climate.copernicus.eu and provide the API key; then the
   script unblocks `RATING_LOCAL_SIZE` (phase 2→3) and kills cold-start for new pins.
3. ★★★ **Per-site height offsets** (replaces "global quantile map") — wait for retention depth;
   fit per-buoy, apply nearest-buoy/region at the offshore input, identity fallback. Composes
   with the Kr per-site transfer function (queue #3 of the EVE handoff — same shape).
4. ★★ **Wire `partitions` into the RATING** + measure `SURF_PARTITIONS` in precompute (#12/#13).
5. ★★ Depth-dependent height → tide/moon in the rating. · ★★ Shore normals (434 spots). ·
   ★ `SURF_V3_KOMAR=0` mislabel. · ⚠️ Friction inert at ~46%. · ⚠️ Tide times in viewer's TZ. ·
   ⚠️ Thread spot id into the hub (spawned).

### Carried notes
`weather_sim_mcp.py` 769/800 — next sim addition goes in a sibling. `scheduler_helpers.py` 774/800
— `lattice_fill.py` deliberately created as its sibling. The `test_event_bus` latency benchmark
flakes under parallel pytest load; passes alone.

## 5. ★ METHOD NOTES
1. ★★★ **A hole that grows while you measure it names its own cause** (wall-clock reference).
2. ★★★ **The instrument must carry its own verdict** — a per-band table with two improving rows
   invites cherry-picking; the script now prints NO-GO and refuses to upload.
3. ★★ **Synthetic tests validate machinery, not plans.** The EQM synthetics all pass — against
   real data the plan failed. Only the production fit could say so.
4. ★★ **Measure the current state before fixing the reported state.** The reported EURO blank day
   was not reproducible; measuring found the live ICON hole + the real blank-maker (the purge).
5. ★ cp1252 consoles cannot print ✗/em-dash — scripts emit ASCII (third occurrence of this trap).

---

# PART 2 — LATE NIGHT: the proof, the 47-year lane, and the erasure that fixed the architecture

Commits `f827ff65` `165c6597` `9a54ce03` `44020553` `297b9bd9` `d472a075` (+ research
`7ab7ac04` `aca57830`), all pushed, CI green.

## A. ✅ THE BLANK-DAY FIXES ARE LIVE-PROVEN (run 30570760864, first fixed-SHA cycle)
Run log: NO "Startup hygiene: Purged" line (old code purged 144 products every startup) · ICON
tail "beyond 2026-08-07 **00:00**" (on-lattice) · "**[Lattice Fill] 54 interpolated frames saved
(54 candidates, 0 non-fillable wide holes)**". Census after: **every lane 0 dead / 0 off-lattice**;
substituted 12+14+16+22+53 → 0 everywhere except EURO wind global_mid (2 remain — brackets arrived
after the fill step; idempotent next cycle). `scripts/timeline_slot_census.py --fail-on-dead` is
the permanent guard.

## B. ✅ THE CDS/ERA5 LANE IS OPEN (user registered; `~/.cdsapirc` present)
`reanalysis-era5-single-levels-timeseries`: a spot's FULL hourly history (1979→, 416,952 rows,
100% finite) in ~32 s / 8 MB / one request — but its period is the MEAN (no peak variable). The
GRIDDED dataset has `peak_wave_period` ⇒ **v3 composite** (`era5_deepen_climatology.py`): 47 y of
(Hs,Tm,dir) × the spot's own hour-matched Tp/Tm from one tiny gridded year (⚠️ ERA5 WAVE fields
are on the ~0.5° WAVE grid — a smaller area hits ZERO wave points and MARS fails; pad ±0.5°).
**Validated: Sebastian Tp/Tm=1.242 ⇒ 47-y ref 1.152 m vs the independent 4-y OM lane's 1.145
(0.6%).** The OM lane's `wave_period` is ALSO a mean — v2 (`9a54ce03`) selects the SWELL
partition period (matches served peak 7.35-8.0 vs 7.35-8.38 at the shallow case; deep shelves are
period-insensitive so the Mavericks 0.3% cross-val was blind to it).

## C. ⚠️⚠️ THE ERASURE → ONE WRITER + INBOX (`d472a075`) — read before touching the blob
The owner's proof audit found the 152-spot backfill GONE from the live blob within an hour of a
verified upload (race guard fired AND recovered — still erased). Two writers read-modify-writing
one key cannot be made safe by checking harder. Worse, latent: the precompute merges frames onto
`load_size_climatology_l2()` — **a transient None rebuilt the ENTIRE blob from scratch**.
Contract now: **the precompute cron is the ONLY writer**; scripts drop batches in
`spot_ratings/climatology_inbox/` (folded in-cycle: bin-wise add, markers carried, dedup by
batch_id, malformed consumed); resume filters ALSO see unconsumed inbox batches; a failed base
load retries once then **SKIPS** (never rebuilds; a genuinely-absent blob is seeded by hand).

## D. ✅ THE SKILL LEDGER (`297b9bd9`) — "are we near the competition?" becomes a number
Every calibration run ledgers +24/48/72h forecasts at all ~60 mapped buoys (ours + an Open-Meteo
lane, one batched call) → `calibration/skill/pending.json`; scores them against fresh NDBC truth
when the target hour arrives → monthly `calibration/skill/scored-YYYY-MM.json` + a per-source×lead
MAE table in the report (`forecast_skill`). Honesty pins: EARLIEST forecast per
(source,buoy,target,lead-bucket) wins; join ≤1.5h; 0.0-model = coverage hole. First rows: the
next calibration cycle after this push. Meaningful table: ~1-2 weeks. Surfline third lane:
deferred (spot-id mapping + ToS).

## E. AUTONOMOUS FROM TONIGHT (Windows scheduled tasks, Interactive-only — machine must be on)
* **"RawSurf Climatology Backfill Resume"** daily 06:10 — OM 4-y lane, ~150 spots/day → inbox.
* **"RawSurf ERA5 Climatology Campaign"** daily 21:30 — v3 47-y lane, `--limit 150`/night → inbox
  (~12 nights). Both no-op when done. Logs: `%LOCALAPPDATA%\raw-surf-*.log`.
* Retention roll-up: first fire on tomorrow's first <06 UTC calibration run
  (`calibration/history/residuals-YYYY-MM.json`).

## F. THE GATES TO STATE-OF-THE-ART (in order, each with its instrument)
1. ~~Data integrity~~ ✅ proven (census).
2. **Climatology full catalogue** (campaigns, autonomous) → `local_size_gonogo.py` GO vs the
   owner anchors → flip `RATING_LOCAL_SIZE` (today 4 ft ≡ 12 ft — the biggest rating lever).
3. **Skill verdict** (~2 weeks accumulation) → per-lead MAE vs the competitor lane on buoy truth.
4. **Per-site height offsets** from retention depth (the 67.5% between-buoy component).
5. **Shore normals** — top Jacobian lever (6.0-23.6 pts); geometry-in-DB awaits the owner.
6. **Partitions into the RATING** (+ precompute cost) · then Kr+H1/10 together.
7. **Expansion to 4,000+ spots** — ONLY after gate 3 says "near" (task #6; CC-BY sources, ODbL trap).
