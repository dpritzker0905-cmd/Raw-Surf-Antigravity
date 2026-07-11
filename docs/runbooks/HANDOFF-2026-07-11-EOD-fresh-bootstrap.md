# HANDOFF — 2026-07-11 EOD · Fresh-Context Bootstrap (supersedes all earlier 07-11 queue states)
**dev == origin `419a356a` (19 commits this session, tree clean). FE 98 suites / 790 tests green;
backend 609 green (+15 S2 tests). Detailed session forensics live in
`HANDOFF-2026-07-11-pipeline3-feel-and-wt-halo.md` §1-4f — THIS doc is the entry point.**

## 0. AUDIT VERDICT (deep pass, session close)
Every ship is kill-switched, additive, and verified at the level the environment allowed
(live counters/pixels in preview; unit tests for pure logic; production probes for backend).
Minefield compliance: engine internals / mask-res / prewarm / density ladder
(marineControllerUtils.js:298-303) / radar recolor core / useMarineScrubSettle /
grid_resolver.py — ALL untouched. The one engine-adjacent change is a documented tunable's
default (coverage 0.8→0.6) with 35/35 guard tests and the live lever intact. The z9
DO-NOT-RE-CHASE verdict stands and is now explicitly distinguished in memory from the (fixed)
coverage-release root. Known debt accepted: CAS-lost run-keyed manifest copies can linger
unreferenced (rare, bounded, sweep reserves `manifests/`).

## 1. SHIPPED THIS SESSION (all live on dev, pushed)
| Commit | What | Verified |
|---|---|---|
| `f609f161` | #31 model-switch double-flash: raster no-blank hold + single-finish + 10s loaded slot flips | 42 vis-polls all-visible across a switch (was 2.1s blank); 1 finish; flip loaded-gated t+2.96s |
| `a385d22c`→`92b0c754` | water_temp artifact family: decode OCEAN-FILL landmask (SKIN-temp contamination; Abaco 47.3°C→29-31°C), coastal outlier QC, buffer/parks/lakes session gates, street-zoom fade | grid probes + Caribbean/FL screenshots; zero halo rings; 81/81 Abaco cells clean |
| `f609f161` (riders) | #25/#30: cancelPendingTileRequestsWhileZooming=false + temp-pair fade 200 A/B | init-option + paint verified live |
| `3886f00c` | Activation loading pulse (cold-CDN silence read as breakage): TARGET-slot poller + picker icon pulse | tracer-proven target-slot fix; pulse ON t+448ms → OFF at cap under injected throttle |
| `8fbd20af` | **S2: run-keyed manifest + Postgres pointer CAS** (migration APPLIED to prod, user-approved) | 15 unit tests; pointer row EMPTY at 20:45Z = EXPECTED (last ingest 17:17Z predates S2; first generation lands ~21:15Z — see §3 check) |
| `0a67cbaf` | Cluster rating ping parity (tint+glow was WORKING — probe-proven; the missing piece was the animated ring) | DOM-verified ping on 10/10 rated bubbles |
| `4f60c196` | Marine fine-tile retention band 0.8→0.6 (the z7.8 "clamping": coverage predicate released the fine 61×41 at ~67% → all lanes serve ~0.24° crops BY DESIGN — direct /grid requests ~20×20, computeGridPoints) | 35/35 guard tests incl. 2 new band cases; churn was ALREADY capped (giveup=1, clears=0 live) |
| `b60602ff` | Air Temp ramp 0.38→0.53 (terrain must read through t2m); z3.46 clear = UNREPRODUCIBLE any shape (pixel-sampled settled/hard/cold paths) | live paint 0.38; recipe banked if it recurs |
| `949a4ad3` | Temp-pair infobox: decodedOmSampler — ACTIVE slot URL names model+timeIndex (display-consistent by construction), row-0-SOUTH, NaN→"Land / no data"; air = point-first + decoded fallback | live: 87°F Gulf Stream / Land inland / 97°F Orlando; 7 sampler tests |

Also closed by forensics (no code): radar faintness = scheme-7 pale-by-design (lever
`__RAW_RADAR_OPACITY__`); waves clamping ≠ rating mode (A/B screenshots identical); temp-pair
architecture decision RECORDED (keep tri-model air / bi-model water silent-GFS; optional ICON
estimate design in the detailed doc §5).

## 2. KILL-SWITCH INVENTORY (this session)
`__RAW_MODEL_SWITCH_BLANK_LEGACY__` (restores blank-out + paired imperative restore — matched
pair, never split) · `__RAW_SLOT_FLIP_TIMEOUT_LEGACY__` (flat 2s flips) ·
`__RAW_CANCEL_ZOOM_TILES_LEGACY__` (set BEFORE map mount) · `__RAW_RASTER_FADE_MS__` /
`__RAW_RASTER_FADE_DISABLED__` · `globalThis.__RAW_WT_LANDMASK_DISABLED__` (whole ocean-fill
lane) · `__RAW_WT_COASTAL_QC_DISABLED__` · `__RAW_WT_HIGHZOOM_FADE_DISABLED__` ·
`__RAW_WATER_TEMP_COAST_BUFFER__` / `__RAW_WATER_TEMP_GREEN_LANDUSE__` (force-on the marine
decor in wt-only sessions) · `MANIFEST_POINTER=0` (S2 lane, both directions) ·
`__RAW_DOWNGRADE_COVER_FRAC__` (retention threshold, default now 0.6).

## 3. FIRST ACTIONS FOR A FRESH CONTEXT
1. **S2 health check** (2 min): `select * from weather_manifest_pointer` (Supabase MCP,
   project jnfbxcvcbtndtsvscppt) — expect generation ≥1, written_by `designated:gh-run-<id>`,
   manifest_key `manifests/manifest-g…json` after the ~21:15Z 07-11 ingest. Then confirm the
   serve box logs `[Manifest Pointer] manifest served from …` on its next restore. If the
   pointer is STILL empty after a successful post-19:55Z ingest run → check the run's logs for
   `[Manifest Pointer]` warnings (publish is non-fatal by design).
2. **User eyeball pass on dev--rawsurf** (SW `BUILD_VERSION`==HEAD FIRST; MapPage is
   CODE-SPLIT — verify markers in the MapPage CHUNK via asset-manifest.json, never main.js):
   model flips with rasters (no flash) · water_temp coasts (no halo/moat/band) · Air Temp
   transparency feel · temp infobox taps (water/land/air) · cluster ping in Rating mode ·
   waves at z7-8 after visiting inside the tile (fine field should now HOLD when the viewport
   pokes past the tile edge; cold arrivals still coarse until #17) · ICON air-temp activation
   (pulse instead of silence).
3. Then pick from §4.

## 4. QUEUE (Jacobian order, tasks #16/#17 carry full recipes)
1. **#16 radar advection triage** (own session; radar-arc rules §2a-b, three failure shapes):
   catalog RULED OUT (proxy==direct, 8-min fresh; nowcast=0 expected post-discontinuation).
   Suspect: per-tile SAD motion degenerating to identity on faint/sparse echoes ("some frames
   don't slide"). Probe advect diag per tile at an active-weather viewport; any fix touches
   radarTileRecolor.js.
2. **#17 blend-both cold-arrival retention** (the z7.8 remainder): resolver serves
   INTERSECTING fine tiles (not just containing) + engine keys retention on blend-base
   presence. **SPLIT grid_resolver.py (786/800) FIRST** — the standing rule.
3. **S1 credential separation** — ONE user decision (create the dev Supabase project), then
   strip prod service key from backend/.env (the #28 incident's real fix).
4. **P8 CDN flip** — after §3.1 shows healthy pointer generations across ≥2 cycles: hot serve
   routes get Cache-Control via pointer-resolved run-keyed URLs (f8c0c6b2's scar finally heals).
5. Backlog unchanged: #21 · SpectorJS/P14 · z9 A/B levers · sheltered-water model · NE-lakes
   source · DWD/EU radar palette arc (scheme-7 re-key, the faintness cure if wanted).

## 5. FRESH LANDMINES BANKED THIS SESSION (memory has them too)
- **Hidden preview tab = rAF starvation**: resolveAllUrls/slot mounts/engine loops silently
  starve; `document.visibilityState==='hidden'` even after fronting. Shim
  `window.requestAnimationFrame = cb => setTimeout(()=>cb(performance.now()),16)` FIRST; with
  it the preview fully renders (tiles, screenshots, 118+ ticks). NEVER leave throttle/shim
  instrumentation in a tab the user watches — reload after, and SAY when one is live.
- **Decoded om grids: row 0 = SOUTH** (gfs013 AND ifs025, probe-verified) — a row-north read
  mirrors into the opposite hemisphere with plausible-looking values. Validate orientation
  with a Sahara(+45°C day)/Antarctica(−41°C) pair before trusting any sample.
- **Direct /grid fetches are ~20×20 BY DESIGN** (computeGridPoints GRID=20); fine 61×41 tiles
  only travel via the grid_series lane. An engine grid of ~17×15 at a regional zoom is the
  DIRECT lane's product, not a bug.
- Pixel probes: BISECT layers (hide→readPixels→restore) before blaming a family — a
  "field over land" read was a traffic-colored motorway.
- Swell/Rating pill shares its label with the Swell LAYER button — select by
  `title="Toggle Swell…"`, never by text.
- jsdelivr ne_10m_land.json = 10 dissolved MultiPolygons (18 MB) — 10 features ≠ truncation.
- StrictMode dev double-mount doubles boot logs — not prod double-fire evidence.
- Sampling `__DECODED_OM_TILES__`: entries are GLOBAL grids per timestep, LRU 150; match the
  ACTIVE slot URL's `valid_times_N` for display consistency (decodedOmSampler does this).

## 6. STANDING STATE (unchanged from prior arcs — do not re-litigate)
dev-only pushes (prod=main far behind) · ingest 4h decoupled (GH runner = the ONLY designated
L2 writer, `L2_WRITER=1`) · marine engine 30 FPS all zooms, engine/mask minefields OFF-LIMITS ·
radar CLOSED (three failure shapes, /rv/* proxy deploy-only, direct on localhost) · z9 clamping
DO-NOT-RE-CHASE (now explicitly distinct from the FIXED coverage-release root) · preview drive
recipe + kill-switch master inventory in MEMORY.md and the topic files.
