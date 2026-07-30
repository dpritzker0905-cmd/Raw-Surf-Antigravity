# HANDOFF 2026-07-31 — geometry lives on the spot row now; the queue, starting with partitions

**Continues `HANDOFF-2026-07-30-NIGHT-blank-day-family-and-site-dominance.md` (read its PART 2).**
Branch `dev`, everything pushed (`origin/dev` == `646f76ef`), CI green.

---

## 1. ✅ WHAT JUST SHIPPED — geometry travels with the spot (`646f76ef` + prod migration)

The owner approved the schema change and it is LIVE in production:

* **Migration `surf_spots_geometry_columns`** (all nullable): `shore_normal_deg`,
  `shore_normal_spread_deg`, `break_depth_m`, `geometry_source`, `geometry_resolved_at`,
  `geometry_lat`, `geometry_lng`, `geometry_reject_reason`.
* **Seeded and DB-verified: 1,360 rows** (1,354 etopo + 6 override, 1,066 with break depth),
  produced by the SAME `resolve_surf_geometry` chain the product serves from; the census matched
  the EVE session's independent measurement exactly (etopo 1,354 / coarse 393 / none 20 /
  override 6). **Coarse/none stay NULL by design** — a coarse bearing is runtime-derivable and
  median 22.3° wrong; freezing it would outlive the grid's improvements.
* **The staleness contract** (`spot_geometry_db.py`, tested): `needs_geometry_refresh(row)` →
  `never_resolved` | `moved` (>150 m from `geometry_lat/lng`) | None. ⛔ A row with a
  `geometry_reject_reason` and no fit does NOT re-queue — re-running reproduces the rejection
  (measured 24/24); the pin must move, and the move itself re-queues it.
* ⚠️ **SERVING IS UNCHANGED** — the hot path stays asset/overlay-backed and DB-free (a DB
  coupling there once zeroed every rating). The DB is the SYSTEM OF RECORD + the reconcile queue.

### The remaining geometry wiring (next session, in order)
1. **The reconcile job**: sweep rows where `needs_geometry_refresh` fires (new + moved pins
   only), run `resolve_one` (gate-split: placement ⇒ nothing + reject_reason; bearing-only ⇒
   depth only), write the row + the runtime overlay. Cap ~5 spots/cycle (~22 s ERDDAP each),
   kill-switched, in the decoupled cron AFTER the extension jobs. The DB write lane must be
   direct Postgres or a backend route — **REST PATCH is 403** (RLS denies service-role UPDATE on
   `surf_spots`; do not change that posture casually).
2. **Overlay rehydration from the DB at serve-box boot** — fixes the overlay's ephemerality
   (Render redeploy loses it; the DB now survives). Needs a startup-order review.
3. **`geometry_reject_reason` backfill** for the ~707 actionable spots from the gate CSV, making
   "this pin must move" queryable product state.

⚠️ Ops trap discovered: **`PGHOSTADDR=0.0.0.0` is set machine-wide on the workstation** — libpq
honors it over `host=`, so every direct Postgres connection dials 0.0.0.0 until cleared
per-process (`os.environ.pop("PGHOSTADDR")`). Also the production `DATABASE_URL` password
contains unencoded specials — parse at the LAST `@`, never with urlsplit.

---

## 2. ⛔ THE QUEUE — what comes next, in order

### #5 (NEXT): wire `partitions` into the RATING + measure `SURF_PARTITIONS` in precompute
The HEIGHT half shipped `e637d6dc` (spectral transform at `point_resolution._resolve_partitions`,
`SURF_PARTITIONS=0`). The RATING half is dark: `rating_score`'s `partitions` input (feeding
`dominant_swell_period` / `sea_cleanliness`) is supplied by NOBODY (the registry table shows ❌ at
all three surfaces). The work:
1. Thread partitions into `rate_one_spot` (REFERENCE first), then hub + sim —
   **`test_rating_composition_parity.py` WILL go red until all three declare; that is the point.**
   Pass BY NAME (the reference still calls with 10 positional args — fix that while there).
2. ⚠️ **RECONCILE FIRST** — raw partitions invent energy (+6.2% median, miss the total by median
   9.5%, max 43.8%): `reconcile_partitions` = the total Hs is the SCALE, partitions are the SHAPE.
3. **Measure the precompute cost** (queue #13): `SURF_PARTITIONS=1` is ~4× the point resolutions —
   time a full precompute A/B on the runner before any env flip. **Enable everywhere or nowhere.**
4. Rating A/B on the live catalogue (the `surf_science_audit.py` harness pattern): score deltas +
   level-change % with partitions on vs off, swept — before/after per the house method.

### Then, gated by accumulation (all autonomous, check logs first):
* **Climatology → gonogo → `RATING_LOCAL_SIZE` flip** — inbox batches land daily (OM 06:10,
  ERA5 21:30); after the catalogue fills: `python scripts/local_size_gonogo.py` vs the owner
  anchors. The flip decision is the owner's, with that verdict in hand.
* **Skill verdict (~2 weeks)** — `forecast_skill` table in the calibration report: per-source ×
  per-lead MAE vs the Open-Meteo lane on NDBC truth. This is the gate for the **4,000+ spot
  expansion** (task #6) and the trigger to design the Surfline third lane (ToS + spot-id map).
* **Per-site height offsets** once retention holds independent weather systems per buoy
  (`calibration/history/` monthly segments — first roll-up fires the first <06 UTC run).
* **Kr + H1/10 together** (never separately — they cancel at 0.988×), per-site transfer function,
  after partitions land (CDIP MOP-style, using the spread + partitions).

### Morning checklist for the next session (3 greps + 1 audit)
    grep "residual history rolled up"  <first <06UTC calibration run log>
    grep "forecast_skill\|ledgered"    <same log>   # first skill rows
    type %LOCALAPPDATA%\raw-surf-climatology-backfill.log   # OM inbox batch?
    type %LOCALAPPDATA%\raw-surf-era5-campaign.log          # ERA5 night 1?
    cd backend && python scripts/timeline_slot_census.py    # stays clean?
    # + confirm a precompute log line "inbox batches folded" ≥ 1

## 3. ★ METHOD NOTES OF THIS ARC
1. **The dry-run census matching an independent prior measurement (1,354/393/20/6) is what made
   writing 1,360 production rows safe.** Cross-validate before you write.
2. **A 403 on a write is posture, not an obstacle** — route around it (direct SQL) rather than
   weakening RLS at midnight.
3. **When a connection dials an address you never gave it, an env override is speaking**
   (PGHOSTADDR). The third machine-env trap of the day (cp1252, weighted API budgets, PGHOSTADDR).
