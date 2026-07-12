# OPUS 4.8 BOOTSTRAP — 2026-07-12 (read THIS first; companion = HANDOFF-2026-07-12-global-first-and-rating-arc.md)

**Purpose: maximum accuracy, minimum hallucination. Every claim below is probe-verified with the
evidence named. Rules §1 are binding. The trap list §3 is things that LOOK true here but are
FALSE — check it before acting on any "obvious" assumption.**

## 1. BINDING WORK RULES (violations caused every regression this week)
1. **Forensics before code.** One probe (curl/SQL/grep) validating the premise BEFORE building on
   it. This week's counterexample: intersect-prefer (`6a5f6992`) was built on "manifest tiles are
   fine-resolution" — one curl would have shown 13×9/0.25°; it shipped, regressed live, reverted
   in 30 min (`184a5d99`).
2. **One change per verification cycle**, kill-switched, then full suites: FE
   `cd frontend && CI=true npm test -- --watchAll=false` (expect **98 suites / 807 tests**),
   backend `cd backend && python -m pytest tests -q` (expect **614 passed, 2928 skipped**).
   If your counts differ from these baselines, STOP and diff before proceeding.
3. **Never judge live behavior during**: a Render deploy (every dev push triggers one; events via
   the Render API, service `srv-d7fhiu7lk1mc73debje0`, key `RENDER_API_KEY` in `backend/.env`),
   an ingest window, or a stale service worker (deployed page must show cache
   `rawsurf-v3-<HEAD hash>`).
4. **GLOBAL-FIRST (user mandate)**: every layer must work at ANY GPS worldwide. Verify at ≥3
   rotated locations: a warm pilot, a pilot edge, and a NON-pilot coast (Taghazout / Arugam Bay /
   Chicama). The 10 pilot boxes are in `backend/services/weather_pipeline/scheduler_helpers.py`
   (~L385): florida_east_coast, us_west_coast_socal, hawaii, iberia_west, uk_ireland,
   east_australia, indonesia, brazil_east, south_africa, mexico_centralamerica_pac.
5. **Minefields — do not edit without a dedicated arc + user sign-off**: marine engine particle/
   advection internals, mask-res/retain, prewarm, density ladder
   (`marineControllerUtils.js:298-303`), `useMarineScrubSettle`, radar recolor core tables.
   These carry documented live regressions.
6. **dev branch only.** Never push main. Batch pushes (each one restarts Render).

## 2. VERIFIED CURRENT STATE (evidence in parentheses; re-verify anything older than a day)
- dev == origin == `892d45d2`; working tree has ONLY pre-existing `.agents/skills/*` mods (present
  before this session — not ours; leave them).
- **S2 run-keyed manifest + PG pointer: FULLY LIVE AND HEALTHY** (probed 02:03Z): pointer row
  generation **58**, `written_by designated:gh-run-29170624507`, and storage holds EXACTLY 5 ring
  copies (g54–g58) — CAS works, designated-writer works, keep-5 pruning works. Known quirk (not a
  bug): publish fires per manifest-upload (~dozens/run), so generations jump ~50+/run; optional
  P8-era polish = publish once at run end. **P8 (CDN on hot routes) is now UNBLOCKED** once you
  confirm one more run advanced the generation (query below).
- Rating band: works on GFS at FL pilot (screenshot-verified z7.55 Canaveral↔Melbourne
  continuous + glow + wash + 42FPS). EURO/ICON flicker root fixed by the ratingDowngrade guard
  (`cdd90c7e`) — NOT yet user-confirmed on the deployed build.
- Radar advect: 30-min baseline + smooth confidence-weighted motion field — offline-proven on
  live tiles (seams ≤ observed-frame baseline; ≥90% displacement). User-confirmed "one continuous
  flow"; forward-travel amount awaits re-judgment post-`06f8fc33`.
- Ops: prod service key is NOT on this machine anymore. Local `backend/.env` targets DEV
  (`weewaulkwfwlbhqemxma`, ex-Emergent, legacy schema wiped at user direction; holds ONLY
  weather_manifest_pointer + weather-products bucket; local key verified HTTP 200). Prod DB work
  = Supabase MCP connector ONLY (it cannot reveal secret keys — by design; the authenticated
  local CLI `supabase projects api-keys --project-ref <ref> -o json` is the local secret path).

## 3. ⚠️ FALSE-BUT-PLAUSIBLE TRAPS (each cost real time; do not re-derive these wrong)
- "Marine pilot tiles are fine-resolution." **FALSE** — every pilot product is 13×9 = 0.25° at
  every hour (probed repeatedly). `choose_adaptive_resolution` AND the series fastpath ALSO floor
  at 0.25°. NOTHING currently serves finer for marine viewports. The historical "fine 61×41
  resident" has NO identified producer — mapping its provenance is a PREREQUISITE for any
  cold-arrival/#17 work (it may be extinct).
- "The rating band missing means cells aren't rated." **FALSE** — probe cell scores first
  (`/grid?...&surf=1`, look at `grid.vectors[].speed` = score/10). The Canaveral "gap" was rated
  at 2-5/100 and crushed by alpha shaping (fixed `f85f7f69`).
- "A flag set by the mapper reaches the engine." **NOT GUARANTEED** — `useMarineWindData`'s
  `conformedGridBase` re-emits grids through an EXPLICIT field list; any field not listed is
  silently dropped (ate `is_valid`, `dirConfidence`, and `ratingMode` on three occasions). When a
  flag vanishes between mapper and engine, check the conform FIRST.
- "The z9/z12 blockiness is a bug." **CLOSED** — GFS wave data is 0.25° NATIVE (DO-NOT-RE-CHASE).
  Band-edge blocky at z7-8 was the coverage-release root (FIXED). Do not conflate.
- "grid_series URLs lack surf=1." **FALSE** — a 160-char log truncation artifact; always inspect
  URL TAILS.
- "RLS bypass means the service key can read the table." **FALSE** — GRANTs are separate (the
  42501 class). New tables need explicit `grant ... to service_role`.
- "The radar catalog/nowcast array will help." RainViewer's own nowcast is EMPTY (discontinued);
  radar = observed + our advection ONLY; never seam model precip into radar; all RainViewer via
  `/rv/*` proxy in production (direct on localhost).
- "Headless preview can verify tiles/animations." **FALSE** — maplibre captures rAF at module
  scope; hidden tabs load 0 tiles in every source. Verify wiring via `map.getStyle().sources`
  templates and `map.style.tileManagers` (NOT `_sourceCaches`); do pixel math OFFLINE (the
  scratchpad RainViewer harness pattern: pngjs + verbatim module copy); animations are judged by
  the USER on the deployed build.
- "The preview tab's logs are gone after server stop." **FALSE** — tabs retain console history;
  READ the user's session logs (`read_console_messages`) before re-probing.
- "Precompute Spot Ratings writes the manifest." **FALSE** — the manifest/pointer writer is
  `forecast-ingest.yml` ("Forecast Ingestion (decoupled)", cron `15 */4`, runs 1-2h).

## 4. PROBE RECIPES (copy-paste; expected shapes stated)
- S2 pointer: MCP `execute_sql` on `jnfbxcvcbtndtsvscppt`:
  `select generation, written_by, updated_at from public.weather_manifest_pointer;`
  → one row, generation increasing run-over-run, written_by `designated:gh-run-<id>`.
  Ring: `select count(*) from storage.objects where bucket_id='weather-products' and name like 'manifests/%';` → exactly 5.
- Rating truth at any coast: `curl "https://raw-surf-antigravity.onrender.com/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=<ISO hour>&bbox=<w,s,e,n ~2deg>&surf=1"`
  → `grid.diagnostics.surf_transform = {rated:N, masked:M, value_kind:'surf_rating', wind:true}`
  on any sub-350° extent; `{skipped:'coarse_extent'}` ONLY on the global. Cell scores in
  `vectors[].speed` (×10 = 0-100 score); u/v now NONZERO on rated cells.
- Health: `curl .../api/health/data` → `status: ok`, 9 lanes.
- FE rating diagnostics in any browser session: `__RAW_GPU__.ratingBand`
  ({flag, gridRatingMode, forcedOff, active, gridCols, fromSeries}) and `__RAW_GPU__.blendBoth`;
  console breadcrumb `[rating-band] PAINTING ✓ / OFF — <reason>` every ~2s while the toggle is on.
- Preview drive: launch `frontend-verify` (port 3009); on the LANDING page inject the rAF shim +
  `localStorage.__SURF_MODE__='true'` + `__FORCE_PREMIUM_TIER__=true`, then SPA-navigate (click
  the `/map` link — a full reload wipes the shim). Map handle: `window.__MAP_INSTANCE__`.

## 5. QUEUE (do in order; each has its recipe above or in the companion doc §2)
1. Confirm pointer generation advanced past 58 by a NEWER run → **start P8** (CDN headers on hot
   serve routes via pointer-resolved run-keyed URLs). Optional: publish-once-per-run polish.
2. **Global rotation test pass** (rule §1.4) for rating/waves/wind/temp — fix what breaks; expect
   the weak spot to be cold-SWR first-serve latency at non-pilot coasts.
3. **Colors-vs-data validation** (user asked): band color vs spot-glyph score vs infobox at the
   same cells — all three share `compute_surf_rating` server-side; disagreement = rendering bug.
4. **rating-anim-v2** (banked design, memory has it): real-height motion channel in the field
   schema so band color and motion decouple; backend already sends real u/v; living band is
   opt-in behind `__RAW_RATING_LIVING_BAND__` until this lands. Do NOT re-ship score-scaled
   motion (user: "horrible", verdict correct).
5. 61×41 provenance map → then decide #17-redux framing.
6. Cleanups: grid_resolver Step 3.5 = provably dead (all three `manifest_preview_item`
   assignments are None) — remove in its own commit · DEV dashboard rename · backlog in the
   companion doc.

## 6. KEY LEVERS SHIPPED THIS SESSION (defaults live on dev)
`__RAW_RADAR_ADVECT_BASELINE_MIN__`(30) · `__RAW_RADAR_ADVECT_SMOOTH_DISABLED__` ·
`__RAW_RADAR_ADVECT_CAP_MIN__`(60; 120 = 2h nowcast) · `SURF_REGIONAL_PREFER_MIN_FRAC`(0.45) ·
`MARINE_MID_RES_RATING`(1) · `__RAW_RATING_BLEND_WASH_DISABLED__` · `__RAW_RATING_LIVING_BAND__`
(opt-IN) · ratingDowngrade rides `__RAW_DISABLE_NO_DOWNGRADE__`.
