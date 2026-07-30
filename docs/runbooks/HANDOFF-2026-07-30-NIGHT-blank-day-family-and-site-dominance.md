# HANDOFF 2026-07-30 NIGHT — the blank day was self-inflicted, and the height error lives at the site

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
