# HANDOFF — 2026-07-12 · Rating local-calibration arc + EURO band decision (fresh-context bootstrap)

**Read the standing bootstrap FIRST: `docs/runbooks/HANDOFF-2026-07-12-OPUS-BOOTSTRAP.md` (binding rules,
trap list, probe recipes). This doc layers the rating-science session on top of it.**

`dev` HEAD = `861ba6e2`. **Pushed through `95c5f04a`; `861ba6e2` is committed LOCAL, NOT pushed.**
Working tree has only skills-system churn (`skills-lock.json`, `.claude/skills/*`, `.agents/**/CHANGELOG.md`)
— NOT ours, leave it. Backend suite baseline after this session: **626 passed / 2928 skipped**.

---

## 0. WHAT SHIPPED THIS SESSION (4 commits, rating theme)

| Commit | What | State | Gating / kill switch |
|---|---|---|---|
| `e0e4e40e` | **Cold tight-zoom band**: `MARINE_MID_RES_MIN_SPAN` 2.0→0.0 so the resident `global_mid` tier serves an instant coastal rating band at cold/panned tight (≤2°) viewports, sharpening to 0.25° via SWR. | **PUSHED + LIVE, verified** (live probes: fresh coasts + pan sequence all rated; dwell→fine). | `MARINE_MID_RES_MIN_SPAN=2.0` restores old cliff |
| `123f3256` | **Local size-calibration SEAM**: `size_score(h, reference_size_m=None)` reference-relative (None→1.2 m = byte-identical legacy; 0.2 m rideable floor absolute). Threaded `rating_score`/`compute_surf_rating` + JS mirror `surfRating.js`. | PUSHED (in 95c5f04a). No-op until a reference is supplied. | pass `reference_size_m=None` |
| `95c5f04a` | **Per-spot size climatology**: `spot_size_climatology.py` (rolling per-spot histogram → clamped p80 of SURFABLE-day breaking heights, MIN_SAMPLES=12 bootstrap). Precompute ACCUMULATES each cron (`RATING_SIZE_CLIMATOLOGY` default ON — writes a blob only); precompute + `rate_one_spot` USE the reference (`RATING_LOCAL_SIZE` default OFF). | PUSHED. Accumulation LIVE on the precompute cron; serving OFF. | `RATING_LOCAL_SIZE=0` (default) / `RATING_SIZE_CLIMATOLOGY=0` |
| `861ba6e2` | **Live-fallback parity**: thread the reference into the live-compute path in `routes/weather.py get_spot_ratings`. | **LOCAL, UNPUSHED.** | same `RATING_LOCAL_SIZE` |

**⛔ CRITICAL GATE — DO NOT enable `RATING_LOCAL_SIZE` yet.** It's wired into the GLYPH/precompute + live
paths only. The BAND (`rating_transform_grid`) still uses the global size gate. Enabling glyph-only →
FL glyphs read fair-good (local ref) but the FL heatmap BAND stays red (global ref) = a NEW glyph↔band
divergence. The band needs the same local reference before enabling (see §3 item B).

---

## 1. DEEP AUDIT — the rating science (all forensically verified)

**Formula (grounded, correct):** `size_gate × swell_exposure × tide_fit × breaker_type × (0.60·wind + 0.40·period)`
→ 0-100 → 7 levels at `[14,28,42,56,70,84]`. Backend `surf_rating.py` and JS mirror `surfRating.js` are
**byte-identical function-by-function** (re-verified this session) → band, glyph, infobox share one score.

**Full physics IS present in BOTH band and glyph** (user asked to confirm; verified in code):
`point_resolution.py:123` computes the glyph's `surf_height_m` via `estimate_surf(point.speed, point.period,
shelf_depth_at(lat,lng), coastal=is_coastal, shelf_width_km=…)` = depth-limited breaking with bathymetry +
cross-shelf friction; `shore_normal_at` gives land-facing; `rate_one_spot` adds wind speed+dir + swell
direction (`swell_exposure`). The band's `rating_transform_grid` uses the same `estimate_surf` + fns per cell.
So swell height/period/direction, bathymetry, water depth, shore-normal, wind — **all seven present.** The
only band↔glyph difference is the SPATIAL POINT they're sampled at (grid cell-center vs exact spot), bounded
by ETOPO bathymetry resolution → they agree at straight coasts (FL, Chile) and diverge ~a level at complex
coasts (Bali peninsula). **Glyph is authoritative.**

**Colors:** band = smooth shader `getRatingColorSmooth`; glyph/infobox/legend = discrete `RATING_COLOR[level]`.
Same anchors `#f0476b→#a855f7`, same thresholds. The smooth-vs-discrete difference is INTENTIONAL (documented
in the shader), not a bug. Live cross-check (FL/Chile/Bali): band-cell vs spot-glyph scores agree to ~1 pt and
same level at simple coasts; Bali differs by the resolution reason above.

**Local size calibration (the FL insight — Surfline's "relative to a spot's potential"):** ROOT GAP was
`size_score` being a GLOBAL absolute curve (0 below 0.2 m, saturate 1.0 at 1.2 m everywhere). The arc makes
the SATURATION local (spot's p80 good-day breaking height) — a clean 2-3 ft day saturates in FL (small p80)
but scores low in Indo (large p80). Verified end-to-end in tests (`test_spot_size_climatology.py`:
same 0.75 m swell → fair_good/good in FL, poor in Hawaii). Removes NO physics factor — only shifts the size
saturation. Reference source = per-spot MODEL climatology (objective, global, auto-scales to ANY spot added —
this is WHY a hand table was rejected: 496 regions, and it wouldn't scale to new spots).

---

## 2. DEEP AUDIT — band on all 3 models (the live issue) + CRON ARCHITECTURE

**"Band only on GFS" root cause (storage-verified, prod `jnfbxcvcbtndtsvscppt` weather-products):**
`global_mid` product counts — **GFS 113, ICON 57, EURO 0.** The mid-res rating band needs a per-model
`global_mid`. EURO's mid job `ingest_euro_marine_global_mid_impl` (`marine_mid_res_ingestion.py:145`) is
gated `EURO_MARINE_MID_RES_INGEST` **default "0"** at `scheduler/forecast.py:136` (GFS/ICON default "1"),
because it's a 2nd ~15-30 min CMEMS fetch. So EURO waves fall to global-coarse → `coarse_extent` skip → no
band (except the tight WARM native 0.25° dynamic lane). **ICON is fine** (data exists) — it only failed in
the user's live session because the serve box was OVERLOADED (see below).

**CRON IS DECOUPLED FROM THE SERVE BOX (user's question — CONFIRMED):**
`forecast-ingest.yml:7` sets `DISABLE_FORECAST_SCHEDULER=1` on the Render web box. ALL ingest/precompute runs
on **GitHub Actions runners**, NOT Render. Render only SERVES pre-computed products from Supabase L2.
Workflows: core `forecast-ingest.yml` (`15 */4`), pilots `forecast-ingest-pilots.yml` (`45 1-21/4`, **where
the mid jobs live**), `precompute.yml` (`45 1,7,13,19`, spot-ratings + my climatology accumulation),
`data-health-monitor.yml` (`*/30`), `keep-warm.yml` (`*/5`).
→ **Adding to the cron slows the GitHub Actions JOB, NOT the app.** But the GH Actions budget is genuinely
tight: recent **pilots-lane durations = 114, 117, 161, 162, 210 min**; core = 69, 114, 170 min + one
**cancelled at 58 min**. A 210-min pilots run is near limits. So EURO mid (#2) in the existing pilots lane
(+15-30 min) risks a timeout/eviction → stale/missing ingest (NOT a slow app). This is why "default-OFF until
budget confirmed" — the budget is NOT comfortably confirmed.

**Serve-box overload (the 24s health + CORS the user saw):** transient — deploy window 03:45-49Z (backend
restarting → no CORS headers on app-API endpoints = expected) + the user's heavy model/layer toggling
saturating the 1-CPU serve box. Deploy `95c5f04a` **succeeded + is live** — NO regression from the push.
Re-verify once load drops.

---

## 3. OPEN DECISION — how EURO waves get the rating band

Options (user weighing blend vs #2):
- **#1 — derive EURO `global_mid` by upsampling the already-ingested EURO global-coarse (10°→2°).** Cheap
  (CPU only, NO Copernicus fetch → NO added cron time). Band renders fine (coastal STRUCTURE comes from
  bathymetry per-cell; smooth offshore Hs is an OK swell-amplitude proxy; not blocky; a visual UPGRADE over
  today's blocky 10° coarse). Caveat: the same `global_mid` also feeds the SWELL heatmap → EURO swell at mid
  zoom looks softer/less-detailed than GFS/ICON native 2°. Safe given the tight cron budget. Optional refinement:
  scope the upsampled mid to rating mode only (band uses it, swell stays on honest coarse) — more code.
- **#2 — enable native EURO mid (`EURO_MARINE_MID_RES_INGEST=1`, maybe `EURO_MID_RES_DAYS` 10→5 to bound it).**
  True 2° data, best quality, ZERO serve-box/app impact (decoupled) — BUT +15-30 min onto the already-210-min
  pilots lane = real timeout risk. Safer variant **#2b**: run EURO mid in its OWN parallel GitHub Actions
  workflow (not serialized into the pilots lane) → real quality without extending the pilots job; costs more
  workflow infra + Copernicus quota.
- **Blend:** #1 now (band works, no cron cost) → upgrade to #2b later if EURO quality parity is wanted.

**⭐ #3 — EURO mid from ECMWF Open Data (VERIFIED 2026-07-12, RECOMMENDED).** GitHub Actions is FREE (repo
is PUBLIC), so cost was never the issue — the concern was CMEMS quota + the 210-min pilots lane. ECMWF Open
Data publishes a FREE (CC-BY, no auth) `wave` stream at 0.25° — and we ALREADY fetch EURO wind+pressure from
it via `ecmwf_opendata_fetcher.py` (official `ecmwf-opendata` client, already `layer`-parameterized). So
source EURO `global_mid` waves from ECMWF, not CMEMS: free, real data (better than #1's upsample), no CMEMS
quota, fast GRIB byte-range (not the ~7s CMEMS toolbox). **PROBE-VERIFIED** (index at
`data.ecmwf.int/forecasts/20260712/00z/ifs/0p25/wave/…-{step}h-wave-fc.index`): params present =
`swh, mwp, pp1d, mwd, mp2, h1012..h2530 (period-band heights), cdww, wmb`; **horizon 360h** (steps
144/240/336/360 all 200; swh present at 360h). The mid band needs only `swh`+`mwp`/`pp1d`+`mwd` = all present.
**Bonus:** `pp1d` (PEAK period) is available — more correct for surf rating than the mean period fed today.
⚠️ NO wind-sea/swell partition params (`shww`/`shts`) in the free feed → `swell_1`/`swell_2`/`wind_waves`
CANNOT drop-in swap to ECMWF (they'd stay on CMEMS, or be re-derived from the `h1012..h2530` period bands =
a separate project). So ECMWF cleanly covers the TOTAL `waves` layer (band) + could retire the estimated
240→336h EURO extension (real data to 360h); partitions gate a full cutover.

**Author's recommendation (updated):** **do #3** — free, real 2° data, no CMEMS quota, reuses existing infra,
lights the EURO band cleanly. #3 spec: (1) extend `ecmwf_opendata_fetcher.py` `LAYER_PARAMS["waves"]=["swh",
"mwp","mwd"]` (+`pp1d`), use `stream="wave"` on the Client for the wave layer, map swh→wave_height/pp1d→period/
mwd→direction (derive u/v), keep provider='open-meteo' source_dataset='ecmwf_ifs' for manifest parity;
(2) point `ingest_euro_marine_global_mid_impl` at the ECMWF fetcher (spawn `layer=waves, resolution=2.0`)
instead of `fetch_euro_marine_global_coarse`; (3) flip `EURO_MARINE_MID_RES_INGEST` default 0→1 (now free+fast,
budget caution moot); (4) no resolver change (Step 3.6 is model-agnostic); (5) unit-test the wave-param mapping
+ that it produces `region_id=global_mid` EURO products; VERIFY: storage EURO global_mid 0→N, then
`/grid?model=EURO&…&surf=1` at a mid viewport → `surf_transform:{rated…}`. FIRST STEP before wiring: a runner
test fetch confirming the `ecmwf-opendata` client's exact wave param codes + `stream="wave"` retrieval (index
proves availability; confirm the client call shape on the CI runner where pygrib+the package live — they are
NOT installed locally). #1 (upsample coarse) / #2 (native CMEMS mid, quota) remain fallbacks if ECMWF waves
disappoint.

---

## 4. ROLLOUT + VERIFICATION (local calibration)

1. **Push `861ba6e2`** (live-fallback parity) whenever the next intentional push happens (batches a Render deploy).
2. **Climatology accumulation is LIVE** on the `precompute.yml` cron (RATING_SIZE_CLIMATOLOGY default ON). It
   writes `spot_ratings/size_climatology.json` to L2. Verify it populates: MCP `execute_sql` on
   `jnfbxcvcbtndtsvscppt` → `select name, metadata->>'size' from storage.objects where bucket_id='weather-products'
   and name='spot_ratings/size_climatology.json';` (blob exists + grows). Content read needs the prod service
   key (not on this machine) OR a temporary diagnostic endpoint.
3. **Before enabling `RATING_LOCAL_SIZE`:** (a) do the BAND local-calibration (§3 gate — else glyph↔band diverge),
   (b) confirm the climatology is sane (FL spots ref ~0.6-0.8 m, Hawaii/Indo ~2-3 m). MIN_SAMPLES=12 at hour-0
   1 sample/precompute-cycle (4x/day) ≈ ~3 days to bootstrap; until then a spot has no reference → global default
   (graceful, no regression).
4. **Enable** = flip `RATING_LOCAL_SIZE` default "0"→"1" in `spot_ratings.py` + `routes/weather.py` (version-
   controlled) and push. Verify FL glyph ratings lift on the deployed build.
5. Band local reference design (§3 item B): give `rating_transform_grid` a `reference_fn(lat,lng)`. Cheapest:
   nearest-spot reference from the same per-spot climatology (adds spot-loading to the marine serve path — cache
   it, risk); cleaner: a coarse GRIDDED breaking-height climatology sampled like bathymetry (bigger build). THEN
   enable band + glyph together.

**Rating truth probe (any coast):** `curl ".../api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=<ISO>&bbox=<w,s,e,n>&surf=1"`
→ `grid.diagnostics.surf_transform` = `{rated,masked,value_kind:surf_rating}` (band on) or `{skipped:coarse_extent}`
(band off, global frame) or `{skipped:mid_res_tier}`. cols=37 = coarse global (no band); cols≤13 = mid/viewport
(band). Scratchpad harness: `gridprobe.py` (per-model tight/mid probe). ⚠️ serve box was overloaded — probe when
health `time_total` < ~2s.

---

## 5. QUEUE (Jacobian order)
1. **EURO band** per §3 decision (#1 / #1-scoped / #2b). Then re-verify ICON band paints (data exists) once serve box recovers.
2. **Band local-calibration** (§3 gate) → THEN enable `RATING_LOCAL_SIZE` and verify FL lift.
3. **Report-weighting layer** (Surfline "science heavy, reports light"): bounded per-spot offset from
   `report_calibration` bias + a model self-cap below Good/Epic until an observation confirms. `surf_log_entries`
   + `report_calibration.py` exist (measure-only today).
4. **Spot-DB growth** (user wants global auto-add, deduped): OSM `sport=surfing` is MOSTLY surf shops/schools,
   NOT breaks — needs curation (filter businesses, cross-check open break lists, proximity-dedup ~1-2 km, mark
   `unverified`). PROD write → user sign-off. Add via `SurfSpot` model (seed_missing_florida_spots.py pattern).
5. Colors-vs-data: already audited CLEAN (divergences are by-design); no action unless the user reports a specific mismatch.

## 6. LEVERS ADDED THIS SESSION
`MARINE_MID_RES_MIN_SPAN`(0.0) · `RATING_LOCAL_SIZE`(0=off) · `RATING_SIZE_CLIMATOLOGY`(1=on, blob-only) ·
`EURO_MARINE_MID_RES_INGEST`(0) · `EURO_MID_RES_DAYS`(10) · climatology tunables in `spot_size_climatology.py`
(REF_PERCENTILE 0.80, MIN_SAMPLES 12, REF_CLAMP 0.4-4.0 m).
