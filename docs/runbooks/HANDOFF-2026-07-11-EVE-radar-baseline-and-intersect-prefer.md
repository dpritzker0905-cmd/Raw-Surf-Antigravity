# HANDOFF — 2026-07-11 EVE-2 · #16 CLOSED + #17 backend half (supersedes the EOD bootstrap's queue)

## ⚡ LATE-SESSION UPDATE (user live-reports, same evening — READ FIRST, supersedes §1's #17 row)
1. **`6a5f6992`'s intersect-prefer serve is REVERTED (`184a5d99`)** — live probes falsified its
   premise: the FL manifest pilots are **13×9 = 0.25° at every hour** (probed 3 hours), and
   `choose_adaptive_resolution` floors the dynamic lane at 0.25° too. The pass served a
   coarser-or-equal PARTIAL rect clipped at the tile edge with NO revalidation (sticky) —
   matching the user's clamped-rectangle report minutes after deploy. The split + the dormant
   `min_viewport_frac` picker floor stay. **The redesigned #17 requires a resolution-provenance
   map first: which lane (if any) produces the historical "fine 61×41" grids — nothing probed
   tonight serves finer than 0.25° for marine viewports.**
2. **Marine default-load activation clamp (user: intermittent, fixes on zoom-out): probe-grounded
   partial picture** — at a ~1.1° padded z12-style bbox the series fastpath returns **5×5
   (0.25° floor, `_build_openmeteo_marine_series` line ~186: the resolution ladder only steps
   COARSER)** and /grid serves the 13×9 pilot. Whether the visible artifact is the 0.25° floor,
   a lane race, or something FE-side is NOT yet pinned — next session needs the user's exact
   default-load geometry (GPS viewport + a screenshot) and should weigh the z9 verdict (GFS wave
   0.25° NATIVE — "finer" would be interpolation, not truth; the fix may be FE smoothing/serving
   presentation, not upstream density).
3. **Radar "very gridlike" movement FIXED (`3c116b28`)** — smooth motion FIELD: per-pixel
   bilinear vectors from uniform half-res 3×3 neighborhood estimates (same vector per physical
   tile from every neighborhood → seam-free by construction; PRESENT conf-0 identities used
   VERBATIM for seam symmetry — a per-side fallback re-created the seam on real tiles). Real-tile
   seam proof: 21.29→2.35 / 37.04→4.09 / 6.98→0.78 / 52.53→0.93 (at/below the observed-frame
   baseline). Kill `__RAW_RADAR_ADVECT_SMOOTH_DISABLED__`. FE 98/801. **User eyeball on deployed:
   forecast motion should now read as one continuous flow, not sliding tile blocks.**
4. **S2 pointer root FOUND: 42501 permission denied** — the pointer table was created WITHOUT
   API-role grants (RLS bypass ≠ GRANT); every read/CAS in run 29168283567 got HTTP 403 while
   the run-keyed `manifests/manifest-g000000000001.json` uploaded fine all run. **USER ACTION
   (permission classifier blocked the agent applying it):** run
   `grant select, insert, update on table public.weather_manifest_pointer to service_role;`
   in the Supabase SQL editor (jnfbxcvcbtndtsvscppt) — now also in the migration file. Then the
   01:15Z ingest should publish generation ≥1.
5. S1 (dev Supabase project) purpose explained to the user — see the session close message.

**dev = `6a5f6992` (2 code commits this session on top of `9e446f99`). FE 98 suites / 797 tests
green; backend 622 green (609 baseline + 13 new). Session detail in memory
[[session-2026-07-12-radar-baseline-intersect-prefer]].**

## 1. SHIPPED
| Commit | What | Verified |
|---|---|---|
| `8199e51a` | **#16 radar advect "frames don't slide" CLOSED** — root = sub-cell identity: typical 10-min echo displacement < 1 SAD grid cell (4px) at z≤6, so the integer block-match returned (0,0)/conf-0 for 34/81 live tiles INCLUDING heavy-echo ones (faint-echo theory DISPROVEN; sub-cell parabolic refinement around (0,0) tried and REJECTED — incoherent noise vectors). Fix = pair the latest observed frame with the one ~30 min back (prev-frame selection only; leadFactor already divides by the real interval). 60-min-lead warp multiplier drops ×6→×2 (neighbor-mosaic excursion 240px→80px — safer). Lever `__RAW_RADAR_ADVECT_BASELINE_MIN__` (≤10 = legacy adjacent pair). | Offline real-tile harness (81 tiles, 3 continents; displacement scales linearly with baseline = real velocity; 40 min = decorrelation onset); live preview wiring (advect sources paired 20:30Z+21:00Z, leads 0.5/1.0); handler-chain sim on real tiles (echo slides ≈ motion×lead); FE 98/797. **User eyeball on deployed build still wanted: radar forecast frames should now visibly slide at active-weather viewports z4-7.** |
| `6a5f6992` | **#17 blend-both cold-arrival (backend half) + the standing-rule grid_resolver split** (786→583; `grid_resolver_selection.py` + `grid_resolver_surf.py`, pure extraction, 609 green pre-feature). Root = `select_best_candidate.should_force_global` drops ALL regional candidates when the best no longer FULLY covers the bbox → straddling viewports could never receive the fine tile (the `4f60c196` retention fix only helped the RESIDENT case). Fix = `apply_marine_intersect_prefer`: non-wide marine viewport + no decision → serve the INTERSECTING regional tile at ≥`MARINE_INTERSECT_MIN_FRAC` (default **0.6 = the engine retention floor** — arrival and retention agree, no lane flap), Step-3-clipped, stamped honestly `regional_partial`/`partial_coverage=true` (the labels the old Step 6 fallback used — FE already renders them). Kill `MARINE_INTERSECT_PREFER=0`. | 622 backend green; the 2 `test_dynamic_viewport` tests that expected the coarse-fallback path now pass through the honest-label serve (same product, same labels, no failed-upstream latency). **User eyeball on deployed: waves at z7-8 poking past a pilot-tile edge on a COLD viewport should now show the fine field + coarse wash ring, not whole-screen blocky.** |

**Engine half of #17 ("retention keyed on blend-base presence") DELIBERATELY BANKED** — with
symmetric 0.6 floors it's speculative polish inside minefield-adjacent code (the 35-test
no-downgrade guard). Revisit only on a fresh user report of band-edge coarseness below ~60%
coverage.

## 2. S2 POINTER — STATUS AT SESSION CLOSE
Pointer row still EMPTY through 21:39Z, **still EXPECTED**: the first post-S2 ingest
(forecast-ingest.yml run `29168283567`) only STARTED 21:08Z and runs 1–2h. gh cannot stream
in-progress logs. **Next session first action:** `select * from public.weather_manifest_pointer`
(Supabase jnfbxcvcbtndtsvscppt). If the run succeeded and the pointer is STILL empty → pull that
run's logs and grep `[Manifest Pointer]` (publish is non-fatal by design). NOTE: the manifest
writer is **forecast-ingest.yml** — NOT "Precompute Spot Ratings" (that's the ratings lane).
P8 stays gated on ≥2 healthy pointer generations.

## 3. OPS ANSWER (user asked): 04:08Z health-check failure = TRANSIENT
One 503 probe at 04:08Z; 12 consecutive green hourly checks since; live probe at 20:55Z =
status ok / 9 lanes ok / freshest 1.7h / no alerts. Ingestion is decoupled → zero data impact.
Render's 100-event window couldn't reach 04:08Z (the EOD 4-push deploy storm consumed it), so
the exact cause is unrecoverable; most likely an overnight cold-start/restart blip. Hardening
candidates (backlog): retry-once in data-health-monitor.yml · backlog ③ external uptime probe.

## 4. QUEUE (updated)
1. **S2 pointer verify** (§2) → then after 2 healthy generations: **P8 CDN flip**.
2. **S1 credential separation** — ONE user decision (create the dev Supabase project), then strip
   prod service key from backend/.env.
3. **User eyeball pass on dev--rawsurf** (SW `BUILD_VERSION`==HEAD first; MapPage is CODE-SPLIT —
   check the MapPage chunk): radar advect slide (§1) · z7-8 cold straddle waves (§1) · plus the
   EOD bootstrap §3.2 list (model flips, water_temp coasts, temp infobox, cluster ping, pulse).
4. Candidate cleanup found this session: **grid_resolver Step 3.5 (SWR manifest preview) is DEAD
   CODE** — `manifest_preview_item` is None at every assignment site. Remove in its own commit.
5. Backlog unchanged: #21 · SpectorJS/P14 · z9 A/B levers · sheltered-water · NE-lakes · DWD/EU
   radar palette arc · radar sparse-speckle false-match floor (only if a report surfaces).

## 5. NEW LANDMINES / METHODS BANKED
- **Offline RainViewer tile harness** (scratchpad pattern: pngjs + verbatim module copy) = the
  radar forensic method of record — estimator/warp truth WITHOUT preview or deploy.
- **maplibre captures rAF at module scope**: shim on the LANDING page then SPA-navigate (router
  link); a full-page nav (`location.href`) re-evaluates the chunk but this session even a
  pre-boot shim left EVERY source at 0 tiles in the hidden tab — headless tile-render
  verification is dead; verify wiring via `map.getStyle().sources` templates. Current maplibre
  style internals: `map.style.tileManagers` (NOT `_sourceCaches`).
- Step 1&2 viewport-cache precedes Step 3: pre-existing cached coarse crops win until TTL — not
  a failure of intersect-prefer (cold-arrival = cache miss by definition).
