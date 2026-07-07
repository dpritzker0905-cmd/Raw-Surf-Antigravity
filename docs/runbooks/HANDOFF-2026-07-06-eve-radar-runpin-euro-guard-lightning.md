# HANDOFF — 2026-07-06 EVE: Radar Run-Pinning + Palette Parity + Lightning, EURO Model-Blind Guard, Mask Upgrade-Guard (+ same-day carve-out)

**dev HEAD at handoff: see git log (base `f228c762`, this session `cbbc9557` → radar/lightning final). Tree CLEAN, FE suite green (85 suites / 677+ tests). Every fix kill-switched, telemetered, live-verified on preview 3007 (`frontend-preview`, autoPort — 3009 is often another session's server with STALE code).**

## 1. What shipped (chronological)

| Commit | What |
|---|---|
| `cbbc9557` | **RADAR RUN-PINNING** ("forecast doesn't tie to the nowcast", all models): IEM's static `refp_{NNNN}` layers are leads FROM THE LATEST COMPLETED RUN, not from now — run 20z at 21:42Z made the "+1h" frame show 21:00Z, BEFORE the last observed frame (~1.7h backward jump at the now boundary; all models identical because CONUS routes everything to HRRR). Fix: archive-backed `refp-t` accepts `year/month/day/hour` (run) + `f` (lead min, 15-min grid ≤1080) URL params — found via the WMS exception leaking its file template. `discoverHrrrRun` probes f=0000 newest-hour-first (PNG=present, XML=missing, check content-type), 5-min TTL; frames emitted on the run's 15-min VALID grid from the first point ≥ now, 30-min cadence. Levers `__RAW_RADAR_HRRR_RUN_MS__`, `__RAW_RADAR_FUTURE_DISABLED__`. DWD/EU was always valid-time-correct. |
| `f36fd5c9` | **MASK RETAIN UPGRADE GUARD** ("halo on islands at mid zoom after a full zoom-out"): post-zoom-out the resident mask is WORLD-tier and its bounds contain EVERY viewport → the containment stamp held on the way back in while basemap tiles loaded → `retain_patched_src_not_ready` (07-05) had no density direction check and held the ~11 px/° world mask over a ~128 px/° mid rebuild. Guard: retain requires residentDensity ≥ incoming × 0.75. Mode `rebuild_upgrade_over_retain`, counter `__RAW_MASK_RETAIN_UPGRADE_REBUILD__`, kill `__RAW_DISABLE_MASK_RETAIN_UPGRADE_GUARD__`. |
| `68963755` | **EURO STALL/INTERMITTENCY — two stacked roots.** (a) `shouldRejectResolutionDowngrade` was MODEL-BLIND (live-proven z11.4: GFS 9×9 regional resident rejected EURO's 37×17 mid — same layer+hour, covering — and the map DISPLAYED GFS DATA UNDER THE EURO LABEL permanently; the stash self-heal re-checks only zoom/coverage). Cross-model commits now always pass (engine + useSimulationField, shared predicate). (b) `frameToMarineData` omitted `__gridSupportsLayer` — every real fetch path stamps it and the gate's `hasCopernicusGrid` REQUIRES it for provider copernicus/backend-weather-service → the gate NULLED series-committed EURO frames while raw marineData still fed the sim field = the day-2 log signature "series frames bind the FIELD, engine keeps coarse_global". |
| `cb241317` | **CLOSE-ZOOM CARVE-OUT (same-day regression of `f36fd5c9`, USER-CAUGHT)**: the upgrade guard's forced rebuild is NE-coastline-ONLY (basemap land patch async + tile-gated) → waves over intracoastal land at close zoom until the repaint. Forced rebuild now requires incoming span ≥ 8° (the halo class IS a mid-tier rebuild — fix preserved); closer commits retain the patched resident. |
| `acf637c8` | **RADAR PALETTE PARITY v1**: past frames = RainViewer scheme 7; future = IEM refp PNGs indexed with pyiem `radar_ptype()` PRECIP-TYPE ramps (rain/snow/frzr/icep, 22 colors per 2.5 dBZ 0-55; authoritative akrherz/iem `hrrr_ref2raster.py`). MapLibre custom protocol `hrrr-rv://` (radarTileRecolor.js, om-protocol precedent) recolors tiles client-side: exact-match LUT color→dBZ→scheme-7 incl. alpha; ptypes collapse to intensity; fail-open. Kill `__RAW_RADAR_RECOLOR_DISABLED__`. |
| (final) | **PALETTE FIX (USER-CAUGHT: "no yellows/reds in heavy precip")**: RainViewer's color-table JSON lists every dBZ TWICE (rain row then snow row) — the v1 extraction kept the LAST = the all-blue SNOW column. Corrected to the RAIN column (SELEX rainbow: <10 dBZ transparent, teal→green→yellow 30→amber 40→red 52.5+). Past frames run `1_0` options (snow=0) so the rain column IS the full past palette — exact parity. **+ LIGHTNING**: nowCOAST NLDN `ldn_lightning_strike_density` WMS (TIME-enabled, `nearestValue=1`, CORS `*`, CONUS) rides the radar timeline as `lightning-source`/`lightning-layer` — PAST frames only (observation truth; future frames carry none). `radarLightningTileUrl`, kill `__RAW_RADAR_LIGHTNING_DISABLED__`. |

## 1b. Final round `3c7cf1e0` (post-runbook, all user-caught + live-verified)

- **BAHAMAS density floor**: the close-zoom carve-out retained ANY resident — including the WORLD-tier mask (~11 px/°, cannot carve cays) → waves over Bahamas land. Retain now also requires resident ≥ 32 px/° (~3.5 km/px); a world resident rebuilds crisp NE-10m (no basemap-patch dependency offshore). The FL case (dense ~256 px/° patched mid resident) still retains. Verified: Andros z9.8 post-world-round-trip → mask span 2° @4096, island clean.
- **LIGHTNING WHITE-HOT + STROBE** ("appears as heatmap coloring"): industry practice = strikes flash bright white, newest brightest (WeatherBug Spark / Blitzortung / RadarOmega). `ltg-flash://` protocol whitens all detected pixels (density-ranked alpha: yellow ramp dim → red core brightest); MapWebGL strobes layer opacity (p≈0.18/130ms burst→1.0, ×0.55 decay → 0.3 glow). Live-verified opacity trace [0.55, 0.3, 1, 0.55, 0.3…]. Kills: `__RAW_RADAR_RECOLOR_DISABLED__`, `__RAW_RADAR_LIGHTNING_FLASH_DISABLED__`.
- **ICON >240h POINT continuity CLOSED** (the last open handoff item): scalar mirror of the grid fix in `backendWeatherServiceClientPoint` >240 branch — `est = mix + [trend(240)−mix(240)]·decay`, shared helpers/kill, anchors ride the point cache, fail-open. `estimate_basis.continuity_offset` flags application.
- **"Animations briefly clamped on the heatmap"** (user, during my HMR edits): telemetry showed detectClamp coarse_global → willSharpen:true → sharpen committed, ZERO clears = the designed transient self-heal, stretched by hot-reload churn. Not a regression; judge only on a clean build.

## 1c. Lightning v3 point flashes `01f5e4e1` (user: "the bolts look terrible")

Industry standard (Windy live tracker / Ventusky / Blitzortung): strikes = INDIVIDUAL white
flashes at strike locations (core + glow, independent phases, fast decay). Ours: strike CORES
extracted from the density raster (`extractLightningStrikes` — 16px-binned local maxima ≥ gold,
pixel→3857→lng/lat) → geojson `lightning-strikes` + `lightning-glow`/`lightning-core` circle
layers, per-point random flash (p=2%+6%·intensity/120ms → 1.0, ×0.45 decay). Feed = ONE direct
viewport GetMap (`refreshViewportStrikes`, 55s throttle + moveend, 5-min slot), registry TTL 90s.
Raster underlay REMOVED. Live-verified: 30 strikes/GA, maxF 1.0→0.45→reflash. Timeline note:
flashes show CURRENT lightning (not per-scrub-frame) — truthful for a live strike feed.
**Landmines burned (all live-diagnosed):** ① `new Map()` in MapWebGL = react-map-gl's default
COMPONENT import shadows global Map ("default is not a constructor", map dead) — use
`globalThis.Map`; ② protocol registration inside the radar-active effect RACED the source mount
(tiles requested pre-registration, failed, never retried) — register at mount, om-pattern;
③ maplibre refused ltg-flash:// raster tiles even registered (spec present, zero loads, zero
errors — unresolved black box; the pivot to direct fetch made it moot; do NOT re-add a
custom-protocol raster without proving tile loads); ④ preview_screenshot times out under the
120ms setData repaint loop — verify flash dynamics numerically (serialize().data maxF trace).
apiClient debug-spam carryover = ALREADY FIXED (opt-in `__RAW_API_DEBUG__`), closed stale.

## 2. Verdicts (do NOT re-litigate)

- **"GFS/EURO/ICON radar all share the same data" in CONUS = DESIGN.** Past = observed RainViewer (model-independent physics). Future in CONUS = HRRR for all models (the only public forecast-radar feed there; the per-model view of precip is the Precip layer). EU differs per model (DWD RV vs WN).
- **EURO far-tail (>240h) at close zoom shows the estimated GLOBAL grid (sharpen diag fw=360, willSharpen:false) = TRUTHFUL** — EURO has no regional far-tail product. Don't chase.
- **IEM refp tiles are indexed + nearest-neighbor resampled → NO blended intermediate colors → exact-match LUT recoloring is safe.** If IEM ever switches to bilinear, unknown colors fail open (native palette shows).
- Cross-model resolution comparison is MEANINGLESS — any identity guard needs every identity axis (the model-blind lesson; same family as layer+hour).
- The retain the upgrade guard bypassed was itself load-bearing at close zoom (patch truth) — scope guards to the tier where the bypassed mechanism's second duty is immaterial (the carve-out lesson; removal-fix class AGAIN).

## 3. OPEN — next session order

1. **ICON >240h POINT-path continuity** (day-2 leftover: grid path fixed additively, `backendWeatherServiceClientPoint` >240 branch still the raw 0.6/0.4 mix — infobox/heatmap coherence).
2. **User eyeballs owed** (deployed at this handoff): ① radar future frames now yellow/red in heavy precip + one continuous palette across "now"; ② lightning hotspots animate with past frames where storms are active; ③ close-zoom coast clean during zoom-in (carve-out); ④ mid-zoom islands halo-free; ⑤ EURO close-zoom + hour 288.
3. DWD/EU future-frame palette parity (clone of radarTileRecolor with DWD's palette — invisible from a US viewport, low priority).
4. Day-2 §3 carryovers: chips (task_59bcc036 fetch-marker wedge, task_c5366c79 OceanMask churn), Part-9-② reseed blink, manifest slimming, pan-clear transient, sheltered-water design.

## 4. Landmines (new this session)

- **RainViewer color-schemes page: every dBZ appears TWICE (rain then snow)** — dict-by-dBZ extraction silently yields the SNOW palette. Rows = `[dbz, c0..c8]`, scheme 7 = index 8, keep FIRST occurrence.
- **IEM refp is precip-type-indexed**: palette index = dBZ/2.5 + ptype segment offset (rain 1-22, snow 23-44, …). Four ramps, one dBZ axis. Source: pyiem `radar_ptype()`.
- **The WMS exception text leaks the mapfile template** (`.../hrrr/%hour%/refp_%f%.png`) — that's how the run/lead URL-param form was discovered. Worth trying on any MapServer feed.
- **HRRR products land on IEM ~1-2h after run start** — run discovery must probe ≥4-5 hours back.
- **nowCOAST default TIME can be days ahead of now** — always pass explicit `time=`; `nearestValue=1` snaps.
- **Model buttons are zero-rect while the weather drawer is closed** — drive previews via the window setters (`setActiveModel`/`toggleLayer`/`setTimeOffsetHours`) + `__FORCE_PREMIUM_TIER__` (tier gate silently reverts non-allowed models).
- The preview screenshot viewport can go mobile-narrow with the tuner overlay covering the map — verify at the data level (protocol-initiated network fetches, telemetry counters) when pixels are obstructed.

## 1d. Refinement round `a978db02` (final Fable-5 commits)

- **Lightning calm cadence**: 240ms tick, ×0.82 decay (~2s fade), glow peak 0.32, SCREEN-NORMALIZED
  flash rate (~0.35 flashes/s viewport-wide, split by intensity — storm size doesn't change the
  feel). Verified trace: full flash 2/20 ticks, long gentle decays. Levers `__RAW_LTG_TICK_MS__`,
  `__RAW_LTG_DECAY__`, `__RAW_LTG_P_SCALE__`.
- **Radar scrub tile cache**: recolored HRRR tiles LRU-cached in the protocol handler (10-min TTL,
  160 cap, in-flight dedupe) — loop pass 2 verified 4/4 hits. `__RAW_RADAR_TILE_CACHE__` telemetry,
  `__RAW_RADAR_TILE_CACHE_OFF__` kill. First loop still pays the WMS render (server-side).
- **Marine halo damp**: wash ×0.35 while resident mask <32 px/° at z≥6 (the heal window whose
  pulses read as "band halo glitching"); full wash returns when a denser mask lands. Render-time
  only. Kill `__RAW_DISABLE_HALO_DAMP__`, telemetry `__RAW_GPU__.haloDamp`. ⚠️ EYEBALL OWED.
- **Zoom-out clear rectangle: preview-3007-only** (cold cache, no SW, forced camera jumps expose
  the baseless-bridge window; EURO-no-prewarm caveat stands) — NOT reproducible on deployed dev,
  no code change. Judge bridge issues on deployments only.

## 1e. Night round `5f3d12c9`/`2cb4e709` (stranded debounce + observed palette + memo slice 2)

- **STRANDED-DEBOUNCE ROOT (live-caught; explains "halo is back" + "close-zoom clamped animation
  resolution" as ONE mechanism)**: every `move`/`zoom` sets `__MARINE_FETCH_DEBOUNCING__=true`
  unconditionally; onMoveEnd cleared it ONLY on the fetch-scheduling path — the camera-hash dedup
  and degenerate-bounds early returns stranded it TRUE forever (any gesture ending at the same
  camera hash). ~8 gates read it as "transitioning" and hold stale frames indefinitely. Fixed at
  the source (moveend clears first) + settle-backstop watchdog (>8s idle → clear, counter
  `__MARINE_DEBOUNCE_STRAND_HEAL__`). Verified: same-camera double-jump leaves debouncing=false,
  engine binds 9×9/2° (0.222°/cell) at z10.8 — pre-fix the engine stayed EMPTY indefinitely.
- **RADAR PALETTE GROUND TRUTH (user-caught 3rd time — doc ≠ rendered)**: rainviewer.com's
  color-table page does NOT describe the tile server's output. REAL scheme-7 tiles (sampled over
  a live storm): light precip = OPAQUE dark-blue→blue→cyan ramp ("cloud cover"), cores =
  yellow→amber. RV_SCHEME7 = the observed 22 colors. ⚠️ NEVER re-derive from the docs page —
  SAMPLE A TILE. Verified visually: future frames show blue cloud fields + cyan/yellow cores.
- **Memo slice 2 (chip task_c5366c79)**: WebGLMarineLayer (onError hoisted via useCallback —
  an inline arrow was defeating the memo) + MapMarkerLayers memoized. Remaining: react-map-gl
  Source/Layer reconciliation (subtree extraction).
- **False-repro landmine**: cumulative counters (dupSkips etc.) span the TAB's whole life — take
  DELTAS; and radar render-mode suspends the marine engine (empty engine with waves+radar both
  toggled is DESIGNED) — toggle radar OFF before diagnosing marine.

## 1f. Final rounds `d5ec3b96`/`19b2ec79` (07-07)

- **Halo damp gate = TEXEL VISIBILITY** (user-caught AT the z6 boundary: clean at 6.36, halo at
  5.49): world-mask texels ~0.088° exceed ~1.3 screen px above z≈4.4 → gate z≥6 → z≥4.4.
  Verified: world resident at z5.49 → haloDamp true.
- **Intracoastal z6-7 window**: basemap-water repatch was z≥7-gated at BOTH layer call sites —
  between z6-7 the NE-only mid mask flooded lagoons with nothing to carve them. Gates → z≥6.
- **Rectangle forensics**: transient "rectangle cut out of the heatmap" (healed before capture) —
  patch-carry box geometry now records to `__RAW_MASK_PATCH_CARRY_LAST__`; next occurrence =
  one-eval diagnosis (compare rectangle vs box). Also on record: stale deep-zoom overlay boxes
  make rectangles too (engine ~line 1525 has the <z12 stale-overlay clear).
- **Radar nowcast parity**: 512px GetMap renders on 256px tiles (2× supersample) + 1.5px blur in
  the recolor pass → future frames match the smoothed organic nowcast look (visually verified).
  Kill `__RAW_RADAR_SMOOTH_DISABLED__`.
- **Titusville clamp report = HMR churn** (not reproducible on the clean build; fine 0.235° grid
  covers through a zoom round-trip). Judge marine reports on clean builds only.
- **Chip task_c5366c79 slices 3 complete**: WebGLWindLayer + WindParticleOverlay memoized
  (onError hoisted). All heavy MapWebGL children now memo'd; remaining micro-slice =
  react-map-gl Source/Layer reconciliation (optional polish).

## 1g. `6e29694e` (07-07 late): crisp coarse-mask edge + per-frame radar layers

- **THE halo's real painter** (user-caught at z5.71, past the damp): the HEATMAP pass's
  `maskFade smoothstep(0.3,0.8)` — a multi-px partially-opaque band over land wherever coarse
  mask texels span screen pixels. `u_maskEdgeSharp` (resident <32 px/° at z≥4.4, same verdict
  as the damp) switches to a crisp `smoothstep(0.45,0.6)` midline cut on BOTH heatmap+wash
  passes. Blocky-but-truthful coastline replaces the smear. Verified z5.71 FL/Cuba/Bahamas.
- **The BOX = the patch-carry seam** (live capture: `__RAW_MASK_PATCH_CARRY_LAST__.box` ==
  the visible rectangle): carry now requires dst density ≥32 px/° — never transplant crisp
  truth into a world mask.
- **Choppy zoom = my z6 repatch widening** (own regression): commit-time repatch sites now
  also require mask span ≤16°; the idle driver keeps the wide-grid overlay path.
- **Radar animation = RainViewer's documented per-frame-layer architecture**
  (rainviewer-api-example): imperative manager, one source/layer per frame, current ±1
  preloaded, 250ms opacity crossfade, prune on frame-list change. Single re-pointed source
  (the old way) = reload gap per step — NEVER go back to it. Second loop = ZERO network
  (frame sources keep their tile caches). Kill `__RAW_RADAR_MULTILAYER_DISABLED__`.

## 1h. `883e292d` (07-07 latest): the z5 halo/island ROOT = overlay gated out of its own regime

- **Live capture at z5**: overlay texture present, `bounds: null`, no repaint for minutes — BOTH
  the idle driver (`BASEMAP_MASK_MIN_ZOOM=7`) and the engine painter (`z<7 return`) sat ABOVE
  the zoom band where world grids live. The wide-grid REPLACE overlay (the ONLY crisp truth for
  the world-mask regime) never ran where it was needed → "halo keeps trying to heal, only
  zooming back in heals", "heatmap on islands during healing". Old premise "below z7 coarse
  texels read acceptably" = disproven (texels >1.3 px down to z≈4.4). Overlay paints a FIXED
  screen-res canvas — cost is span-independent. Gates now PATH-AWARE: wide masks (span≥30 →
  overlay) z≥4.4; narrow (span-dependent base repaint) z≥6. Verified z5: overlay ON/REPLACE,
  FL/Cuba/Hispaniola/Jamaica/Caymans/Bahamas cut clean.
- **RADAR "dissipates everywhere in latter hours" = MODEL TRUTH** (raw IEM tiles pre-pipeline:
  coverage 3.9%→1.0% across +1h→+5.7h, leads land 00-04 local = nocturnal convective collapse).
  Do not chase. ⚠️ probe landmine: the WMS `hour` param needs ZERO-PADDING (hour=2 → XML error,
  hour=02 → PNG); 512px renders keep the exact 20-color palette (no antialiasing LUT risk).

## 1i. PAN-CLEAR TRANSIENT — CLOSED AS HEALED (07-07 verdict, user-witnessed)

6-pan soak at z9.2 along the FL coast on the final build: ZERO engine clears (the original
complaint was hard blanks on pan), zero strand heals, engine resident throughout, debounce
clean. Residual = a brief FIRST-pan coarse beat (user: "clamped very briefly on the first pan,
the other pans seemed better") = the designed cold-tile sharpen self-heal; subsequent pans ride
the 0.5° bbox pad + 50% overlay pad. The lease fix (36d5e503) + the stranded-debounce fix
(5f3d12c9) removed the pathological causes. Do not chase further without a hard-clear repro
(watch `__WEBGL_MARINE_CLEAR_COUNT__` — it should stay 0 through pans).

## 1j. Session close-out notes (07-07 final)

- **"I don't see the radar improvements" (late-night check) = CONTENT, not pipeline**: at the
  2:00 AM frames the model has ~1% precip coverage (the verified nocturnal decay) — there is
  almost nothing to render. Frame-layer manager confirmed live (11 layers, correct opacity
  window); palette/smoothing verified on storm-bearing frames. Judge radar visuals on frames
  WITH echoes (first future hour, or daytime convection).
- **DWD/EU radar palette parity — SCOPED, not started**: sampled a live WN tile (Germany):
  205 distinct colors = ANTIALIASED/blended rendering — the exact-match LUT approach (IEM's
  indexed 20-color tiles) will NOT transfer. Needs nearest-match in RGB space or a threshold
  classifier. Sample palette (dominant): greens (0,153,52)→(77,191,26)→(153,204,0)→(204,230,0)
  → yellow (255,255,0) → amber (255,196,0) → orange (255,137,0) → magenta (251,0,255 = hail?);
  cyans (153,255,255)/(51,255,255)/(0,202,202) = light precip; gray 50% (126,126,126,128) =
  coverage. Invisible from a US viewport — low priority.
- Remaining untouched: sheltered-water design, reseed blink (GPU land cull), manifest slimming
  (backend), satellite black patches (triage recipe in memory), toggle-mid-fetch surf-key race.

## REMAINING BACKLOG (next session / Opus 4.8)

~~task_59bcc036 fetch-marker wedge~~ **CLOSED `1e919775`**: the zero-stamp strand
(isFetching=true, fetchStartedAt=0) was unhealable by releaseStaleMarineLock (lease math bails
on stamp 0) and dedup-blocked every fetch — settle-backstop sibling heal (`evaluateMarkerWedge`,
10s sustained + govIdle; kill `__RAW_DISABLE_MARKER_WEDGE_HEAL__`, counter
`__MARINE_MARKER_WEDGE_HEAL__`, freeze-ring reason `marker_wedge_healed`). Fault injection NOT
possible from console (locks aren't window-exposed) — predicate unit-tested, wiring parallel to
the proven stranded-pending heal; watch the counter on the next organic wedge.
Chip task_c5366c79 SLICE 1 SHIPPED `b720752c` (OceanMask React.memo + dead activeLayers prop
dropped — verified live: mask layer present, engine binds, zero errors). REMAINING slices: the
react-map-gl Source/Layer reconciliation per radar frame step (radarFrameIndex prop re-renders
ALL of MapWebGL — the big one; needs subtree extraction or a context split, fresh-budget work)
+ the deactivate-per-switch OceanMask hide/show churn + follow-up fetch skip (the chip's
original scope). Radar low-dBZ fringe: scheme-7 rain column 0-7.5 dBZ = fully transparent
ERASED the blue cloud areas on future frames (user-caught) — fixed `b720752c` with a graduated
low-alpha teal ramp (indexes 0-3, 0x26→0x73). FL GFS-waves clamp on deployed dev (toggle-fixed,
no repro post-hard-refresh) = STALE-BUNDLE verdict (tab predated the model-blind-guard fix) —
[[verify-bundle-hash-first]] applies, no code change;
Part-9-② reseed blink (swap-time land cull); manifest slimming (6.1MB entry count); pan-clear
transient (§① abort-loop memory); intracoastal/sheltered-water exposure model (design);
DWD/EU radar palette parity; radar realism eyeball items.

---

## 5. REGRESSION WATCHLIST — 3-month forensic ledger (read BEFORE touching the marine/radar stack)

Mined from ~2,680 commits (2026-04-07 → 07-07). This is the "do-not-reopen" ledger: approaches
already tried-and-reverted, the guards that must stay, and the hotspots where regressions land.

### 5a. GRAVEYARD — approaches tried and REVERTED (do not re-attempt without new evidence)
| Reverted approach | Commits | Why it failed / the settled truth |
|---|---|---|
| **Instant layer toggle via backend `/grid_conjoined` endpoint** | `370f2042` (revert) | Phase-1 conjoined endpoint reverted; dead plumbing later purged `f63e7ced`. |
| **Instant toggle via sibling-layer prewarm** | `38b17b38` (revert), `f63e7ced` | Sibling-prewarm reverted too. Wind cross-model prewarm `3a5435c3` survives ONLY as **default-OFF**. Backend prewarm for instant toggles = graveyard. |
| **Scrub-miss: show nearest cached hour (≤6h) instead of freezing** | `e8ebb385` (revert) | Reintroduced stale-frame confusion; the settled behavior is freeze-then-fetch. |
| **Scrub-settle: use time-series frame instead of global fetch** | `42c61128` (revert) | "Doomed global fetch" pattern; capped/bypassed instead `eb067c7e`. |
| **Retry terminal no-coverage grids (EURO)** | `32f38c49`, `9620e0d5` (reverts) | Retrying a *terminal* no-coverage grid = request storm. Settled fix = **STOP retrying** `2795b763`. |
| **Retry transient wind errors instead of blanking** | `105c9161` (revert) | Reverted — do not add blanket wind retry. |
| **`displayMatchesRequested` viewport-containment parity** | `65ab8c55` (revert) | Containment-parity in the coordinator regressed; reverted. |
| **Cap ICON marine below native 14-day horizon** | `fff3cd90` (revert), `1e216323` | Horizon is CONTRACT-LOCKED (GFS 14d native / ICON blend / EURO estimated) — [[marine-14day-horizon-tier-contract]]. Never cap; fix completion via smaller batches, not truncation. |

### 5b. LOAD-BEARING GUARDS — verified present 07-07, removing any silently reopens a closed bug
Each has a documented **second duty**; the recurring "removal-fix" failure mode is deleting a
mechanism to fix symptom A and silently reopening symptom B (§2 carve-out lesson, `cb241317`).
- `shouldRejectResolutionDowngrade` (WebGLMarineEngine.js) — MUST stay model-aware; cross-model always passes (`68963755`). A model-blind identity check paints one model's data under another's label.
- `__RAW_MASK_RETAIN_UPGRADE_REBUILD__` retain-upgrade guard + Bahamas ≥32 px/° floor (WebGLMarineTextureEncoder.js) — `f36fd5c9`/`3c7cf1e0`; guards the island halo after a world→mid round-trip. Scoped span≥8° so close-zoom patch-truth (`cb241317`) survives.
- `__gridSupportsLayer` on committed frames (backendCopernicusServiceClient.js) — `68963755`; without it the EURO gate NULLs series frames while raw data feeds the sim = the "series binds field, engine stays coarse" stall.
- `discoverHrrrRun` + `refp-t` run-pinning (radarForecastSources.js) — `cbbc9557`; forecast radar must tie to the nowcast at the "now" boundary.
- `__RAW_RADAR_MULTILAYER_DISABLED__` per-frame-layer manager (MapWebGL.js) — `6e29694e`; NEVER revert to a single re-pointed source (reload gap per step).
- `u_maskEdgeSharp` crisp coastline cut (WebGLMarineEngine.js) — `6e29694e`; the real halo painter was the heatmap `maskFade smoothstep(0.3,0.8)`.
- overlay path-aware gate `z < (_rms>=30 ? 4.4 : 6)` (WebGLMarineLayer.js/WebGLMarineEngine.js) — `883e292d`; the z5 halo/island ROOT. `BASEMAP_MASK_MIN_ZOOM=7` was DELETED on purpose — do not "restore" it.
- `evaluateMarkerWedge` + `__MARINE_DEBOUNCE_STRAND_HEAL__` (useMarineScrubSettle.js) — `1e919775`/`5f3d12c9`; the stranded-fetch/debounce self-heals. onMoveEnd must clear `__MARINE_FETCH_DEBOUNCING__` on ALL exit paths.
- `__RAW_MASK_PATCH_CARRY_LAST__` carry guard, dst ≥32 px/° (WebGLMarineTextureEncoder.js) — `6e29694e`; never transplant crisp truth into a world mask (the rectangle box).

### 5c. CHURN HOTSPOTS (3mo) = highest regression surface — edit with the full ritual
`MapWebGL.js` **368**, `marineController.js` 178, `useMarineOrchestrator.js` 151,
`WebGLMarineLayer.js` 135, `WebGLMarineEngine.js` / `OceanMask.js` 126, `MapForecastOverlay.js` 122.
Concept churn: scrub 139 · mask 100 · clamp 100 · coverage 77 · overlay 53. These files are a
web of interacting gates — a symptom fix in one almost always has a second duty elsewhere.

### 5d. VERIFICATION DISCIPLINE (recurring false-alarm sources — apply before filing any "it broke")
1. **Judge on CLEAN builds** — HMR churn masquerades as clamps/halos (Titusville, "animations clamped" both = HMR, not regressions).
2. **[[verify-bundle-hash-first]]** — SW cache hash == dev HEAD before re-diagnosing (FL GFS clamp = stale bundle).
3. **Take counter DELTAS** — cumulative `__RAW_*` counters span the tab's whole life.
4. **Toggle radar OFF before diagnosing marine** — radar render-mode SUSPENDS the marine engine (empty engine with both on = DESIGNED).
5. **Sample a tile, never derive palettes from docs** — cost the team 3 user-caught rounds (`5f3d12c9`).
6. **Every dev push restarts Render — batch. NO main pushes** (prod = `main`, ~600 behind).

**Session status: CLOSED at `c4b4ad74`.** Tree clean, dev == origin/dev, FE suite green, all 10
session guards verified live in code. Next session (Opus 4.8): §3 order, then §5a graveyard stays closed.

---

## 6. RE-DIG ROUND (07-07, Opus 4.8) — two "closed" issues REOPENED by the user, both roots CORRECTED

The user reported both the radar dissipation and the z5 marine halo STILL persisting. Forensics
(empirical tile probes + live GPU telemetry) proved my earlier verdicts WRONG. Two attempted fixes
were **reverted** after the user live-tested them (they regressed / didn't help). One backlog item
(DWD/EU palette parity) shipped. **Read this before re-attempting either issue.**

### 6a. RADAR "dissipates everywhere in the latter hours" — ROOT = observed↔model coverage cliff (NOT nocturnal decay)
Empirically measured (scripts in scratchpad; re-runnable):
- **RainViewer OBSERVED past frames: 9.71% CONUS coverage. HRRR forecast frames: 3.27%.** A ~3×
  drop at "now" — HRRR **simulated reflectivity under-detects light/stratiform echo** vs observed
  radar. This is a DETECTION-FLOOR discontinuity between the two feeds, **not** temporal decay.
- Coverage is near-FLAT across leads (newest run f0=3.34% → f360=2.80% → rises to f600=3.68%). The
  earlier "nocturnal collapse 3.9→1.0%" verdict (§1h) was an artifact of the hour it was sampled —
  **do not repeat it.** The newest run has data at ALL leads (availability artifact disconfirmed).
- **LUT hit-rate on a live refp-t tile = 100%** (8577/8577) — the recolor pipeline is sound, NOT
  the cause. RainViewer's `nowcast` array is EMPTY (discontinued confirmed — no dense bridge feed).
  IEM exposes only `refp` (one product) — can't swap to a denser composite.
- **ATTEMPTED + REVERTED:** persistence bridge (fading last-observed underlay beneath forecast
  frames, MapWebGL frame manager) + HRRR cap 240→120. User live-verdict: *"still not holding the
  proper colors into the future, it makes the weather dissipate visually"* (a linear-to-zero fade
  leaves the LATTER frames un-bridged = still sparse — the exact frames complained about) **and**
  *"the timeline is also slow to scrub, it was working well earlier"* (the bridge's per-frame
  moveLayer + source recreate churned the style during scrub). Net-negative → reverted to HEAD.
- **REAL fix (next session, big lift):** a proper **advection nowcast** — motion-extrapolate the
  observed field into the near-term and blend toward HRRR — is the only thing that holds coverage
  into the future without a frozen-ghost. A frozen persistence underlay cannot (stale = wrong
  location; fade-to-zero = latter frames still bare). Do NOT re-attempt the frozen bridge.

### 6b. MARINE z5 halo — ROOT = the viewport overlay FLOODS islands at low zoom (my "missing overlay" dx was WRONG)
- Live GPU telemetry at z5 over Cuba/Bahamas: `overlayMask.replaceReason: "grid_global"`,
  `on: true`, `gwSpan: 360` — the crisp viewport overlay **already REPLACES** the coarse base mask
  at z5 (the §1h `_gwSpan≥340` path). My hypothesis that it "was built every gesture but never
  painted (`_gwSpan<340`)" was FALSE for the world-grid case.
- **The user then caught the real bug:** *"a lot of the islands are also covered in heatmap now."*
  The overlay's `overlayBasemapWaterOnMask` step samples the **basemap water polygons, which at z5
  are simplified and DROP small islands** → the overlay marks them as OCEAN → heatmap floods the
  land. So the low-zoom overlay is the source of BOTH the halo (NE-coastline vs basemap-water
  disagreement bands) AND the island flood. The original z≥7/z≥9 gate existed *because* basemap
  water is only trustworthy zoomed in.
- **ATTEMPTED + REVERTED:** extending REPLACE to `_baseMaskCoarse` (mid-grid residencies). This
  would spread the SAME island-flooding overlay to more zoom/grid combos — strictly worse. Reverted
  WebGLMarineEngine.js to HEAD.
- **REAL fix (next session):** make the low-zoom overlay island-accurate — either skip the
  `overlayBasemapWaterOnMask` step below ~z9 and paint the overlay from the **NE coastline geojson
  only** (`_cachedMaskGeoJSON` HAS islands), or gate the basemap-water step to z≥9. The NE dataset
  carries islands the basemap drops at z5; that is the layer to trust in the world-grid regime.

### 6c. User live-verification findings (verbatim, 07-07) — carry forward
1. Radar: *"still not holding the proper colors into the future, it makes the weather dissipate."*
2. Marine: *"gfs waves didn't activate either just now"* → *"they did a second time"* (activation
   flaky on the preview — worth a look; possibly the toggle-mid-fetch surf-key race in the backlog).
3. Marine: *"a lot of the islands are also covered in heatmap now too"* (§6b overlay flood).
4. Scrub: *"the timeline is also slow to scrub, it was working well earlier"* (§6a bridge churn —
   gone after revert; confirm it's back to smooth on the clean build).

### 6d. SHIPPED this round: DWD/EU forecast palette parity (§3.3 backlog item — the one clean win)
- `radarTileRecolor.recolorDwdImageData` + `dwd-rv://` protocol: **nearest-match** each antialiased
  DWD pixel to one of 12 tile-sampled anchors (cyan→green→yellow→amber→magenta) → RainViewer
  scheme-7; the semi-transparent gray `#7e7e7e` scan-coverage mask drops to transparent. Wired into
  `radarForecastTileUrl` DWD branch (shares kill `__RAW_RADAR_RECOLOR_DISABLED__`). §1j predicted an
  exact-match LUT would not transfer (205 AA colors) — confirmed; nearest-match is the right tool.
  Anchors tile-sampled live from maps.dwd.de WN/RV over Germany (NEVER derive from docs).
- **5 unit tests added** (radarTileRecolor.test.js, all green). ⚠️ NOT live-verified — invisible from
  a US viewport; needs an EU viewport eyeball. Isolated: CONUS radar path (hrrr-rv://) untouched.

### 6e. State at end of the re-dig round
Tree = DWD parity changes; the radar-bridge/cap and the FIRST marine overlay-REPLACE experiment were
REVERTED. (Superseded by §7 — the marine mask work was then done properly.)

---

## 7. MARINE MASK OVERHAUL (07-07, Opus 4.8) — island/coastal heatmap flood + glitch, FIXED at EVERY zoom

The user re-opened the island flood ("heatmap on Abaco/islands at various zooms", "very glitchy",
"make it work at every zoom level"). Diagnosed and fixed with a purpose-built probe. **All changes
kill-switched + telemetered; 540 FE tests green.**

### 7a. THE DIAGNOSTIC HARNESS — `maskFloodProbe.js` (window.__MASK_PROBE__)
The turning point: eyeballing single frames LIED (probe said 0% while the user saw flood). Built an
objective, zoom-swept, temporal harness. Two read-back primitives on the engine:
- **`probeMaskGPU(points)`** — attaches the live mask texture to an FBO and `readPixels` the exact
  texel the shader used (0-255, ≥128=water). Mirrors the shader's overlay-REPLACE / min / base
  selection via `this._probeState` (stashed each draw). Calibration exact (Orlando→0, Atlantic→255).
- **`_screenProbeRequest/Result`** — one-shot gated read-back of the COMPOSITED framebuffer at the
  end of `renderHeatmapAndParticles`, so the probe scores marine colour (crests + wash) on land —
  what the eye sees, which the mask-only probe misses (this is why it lied).
- Harness fns: `scoreFlood` (vs NE truth), `scoreVisual` (vs basemap truth, composited), `sweepVisual`
  (jumps every zoom, waits for coverage, scores), `flicker`, `ab`, `calibVisual`.
- **LESSON: NE 10m ground truth UNDERCOUNTS** (drops cays NE lacks) — score against basemap
  (`queryRenderedFeatures` water) AND the composited screen, not just NE. And measure TEMPORALLY —
  the flood spikes to ~69% DURING a zoom gesture then settles (the "glitchy").

### 7b. Task 2 — CRESTS ON LAND (crest-on-land 3.7% → 0%)
`WebGLMarineParticleShaders` DRAW_VS discarded crests only at `oceanFlag < 0.3` while the heatmap
discards at 0.5 — so crests survived on soft/partial-land mask values (thin cays, coastal edges) the
wash rejects. Made it a tunable uniform `u_crestLandThreshold` (engine default **0.5**, matches the
heatmap). Tune: `__RAW_CREST_LAND_THRESH__`.

### 7c. Task 3 — CAY / COASTAL WASH FLOOD, gated by RESOLUTION not zoom
- **ROOT (forensic):** the basemap water polygons DROP small islands wherever the mask texel is
  coarser than NE 10m (~90 m) — z5 **through z11**, not just low zoom (measured: z9 mask 205 px/°
  floods Abaco 8-17%). The re-assert had a `z<9` gate, so it was OFF exactly where the flood lived.
- **FIX:** `reassertNeLand` now MULTIPLIES the pristine **full-resolution** NE canvas back
  (`neFull`, captured before the paint) — NE land (0) forces mask 0, NE water (255) untouched, so
  port-landfill/canal/sheltered all survive; full res so thin cays survive (the old 1024 snapshot
  averaged them away). **Gated by density** (`canvas.width/span < __RAW_ISLAND_REASSERT_MAX_DENSITY__`
  default 1200 px/°) — engages at EVERY zoom the mask is coarse, auto-skips z12+ where the basemap is
  finer (re-asserting coarse NE there would blockify the coast). Result: z9 8-17% → **0.3%**.

### 7d. z5 HALO ROOT — overlay coverage-REPLACE (z5 65% → 6.4%)
Live telemetry at z5.27: a **16° MID grid** resident under a ~60° viewport → `_gwSpan=16 < 340` →
the built viewport-truth overlay sat UNUSED and the coarse fallback flooded the margins. Extended the
REPLACE trigger: `_overlayReplace = _gwSpan>=340 || !baseCoversViewport`. SAFE now that the overlay
carries the re-assert (this was the reverted §6b change — it flooded islands *because the overlay
dropped them*; the re-assert fixes that, so the REPLACE extension is now correct). Deep-zoom regional
masks that DO cover the viewport are unchanged (min-combine). Kill: `__RAW_DISABLE_OVERLAY_COVERAGE_REPLACE__`.

### 7e. Task 3b — INTRACOASTAL 30-60s WASH LATENCY (zoom-in) → ~1s
The base-mask hysteresis (`refreshMaskWithBasemapWater`) skipped ALL zoom-ins inside the patch box
(its own comment said so), so after a zoom-in the sheltered-water verdict + finest basemap holes
never refreshed until the next data commit — the intracoastal ran wash for 30-60s. Added a
**zoom-delta rebuild**: store `z` in `_regionalPatchState`; a zoom change ≥0.75 forces a rebuild
(fresh classify + finest tiles). Verified: z9→z10.2 fires `applied` in ~1s (was `hysteresis_covered`
indefinitely). Throttle (700 ms at the layer) prevents churn. Kill: `__RAW_DISABLE_ZOOM_REBUILD__`.

### 7f. Zoom-flood profile at end (visual %, basemap-truth, Abaco/FL)
z5 **6.4%** · z6-8 **0-0.2%** · z9-10 **0.3%** · z11-12 **~2.5%** (deep-zoom basemap simplification of
thin barrier islands — NE is finer-gated OFF there; residual is the tile-level water polygon, not
fixable from NE). Crest-on-land **0%** everywhere. Was: z5 65%, z9 8-17%.

### 7g. State at round end
Tree = marine mask overhaul (WebGLMarineEngine.js, WebGLMarineMaskRenderer.js,
WebGLMarineParticleShaders.js, maskFloodProbe.js NEW, +shader test) + DWD parity + this runbook.
**540 FE tests green.** Preview on 3007. **COMMITTED `94072098`** (dev, +2 ahead of origin/dev,
NOT pushed — prod is Netlify `main`; see §8). Kill switches:
`__RAW_DISABLE_ISLAND_REASSERT__`, `__RAW_ISLAND_REASSERT_MAX_DENSITY__`, `__RAW_CREST_LAND_THRESH__`,
`__RAW_DISABLE_OVERLAY_COVERAGE_REPLACE__`, `__RAW_DISABLE_ZOOM_REBUILD__`.
⚠️ **DO NOT revert the re-assert without also reverting the overlay coverage-REPLACE** — the REPLACE
relies on the re-assert to keep islands masked (the §6b lesson).

### 7h. ZOOM-OUT RECTANGLE — eager-overlay redesign TRIED + REVERTED (graveyard)
Remaining glitch: a **~600–900ms first-visit transient on zoom-out** (measured 22–51% flood + a
box-edge rectangle) — the basemap patch covers only the strict viewport at paint time, so zoom-out
reveals an NE-only/coarse ring until the rebuild (`source_not_ready` tile-load bound). My zoom-delta
rebuild (§7e) shrank it but didn't kill it.
**Attempted redesign (4 coupled edits, all kill-switched `__RAW_DISABLE_EAGER_OVERLAY__`):** (A) build
an eager NE-only overlay when tiles aren't ready (the tile gate only needs to protect the basemap
QUERY, not the NE render); (B) build that overlay in the regional base path when the patch can't
cover; (C) `patch_gap` REPLACE trigger; (D) keep basin-scale overlays alive at z<12.
**Result — REVERTED:** the probe's *numbers* looked good (transient → ~1 frame, settled clean) but
the **visual regressed**: at z6 the overlay REPLACE engaged with a **partial-coverage** overlay →
a **visible blue rectangle** at the overlay-bounds edge (the very seam it was meant to kill), plus a
frame-rate dip. Reverting Edit D (keep-basin at z<12) is the prime suspect — a persistent basin
overlay REPLACE'd a sub-viewport rect. **LESSON: the overlay REPLACE must never engage unless the
overlay FULLY covers the viewport — per-pixel fallback is NOT enough to hide the wash-intensity seam
at the bounds edge.** Any future attempt MUST gate REPLACE on `overlayCoversViewport` for ALL terms
(world_grid + coverage_gap included, not just patch_gap), and verify VISUALLY (screenshot), not just
by the flood %. The transient is tile-load-bound; the honest fix likely needs the overlay built
DURING the zoom animation (on the `zoom` event, throttled), not at moveend — future work.
State: reverted to the §7g state (all other fixes intact); rectangle gone, 30 FPS, 540 tests green.

---

## 8. SESSION CLOSE (07-07, Opus 4.8) — final state + the two OPEN residuals

**Final HEAD `94072098`** `fix(marine): island/coastal heatmap flood fixed at every zoom + mask-flood probe`.
Tree CLEAN. **dev is +2 ahead of `origin/dev`** (which sits at `c4b4ad74`) — `084b28a1` (§5 3-month
watchlist) and `94072098` (this overhaul) are **committed but NOT pushed**. Prod is Netlify `main`
(~600 behind, [[verify-bundle-hash-first]]); no main push. **540 FE tests green as committed.**

### 8a. What `94072098` actually shipped (9 files, +718/−11)
Marine mask overhaul + the `maskFloodProbe.js` harness (259 LOC, NEW) that made it possible, DWD/EU
forecast palette parity, and the §7 runbook write-up. Per-fix detail is §7a–§7h; the load-bearing
guards it adds/keeps are folded into §5b. Verified in the committed source this session:
- All 5 kill switches present (`__RAW_DISABLE_ISLAND_REASSERT__`, `__RAW_ISLAND_REASSERT_MAX_DENSITY__`
  default 1200 px/°, `__RAW_CREST_LAND_THRESH__`, `__RAW_DISABLE_OVERLAY_COVERAGE_REPLACE__`,
  `__RAW_DISABLE_ZOOM_REBUILD__`) across maskFloodProbe.js / WebGLMarineEngine.js / WebGLMarineMaskRenderer.js.
- `reassertNeLand` MULTIPLIES the full-res pristine NE canvas (`neFull`) back, non-null only when
  `canvas.width/span < _maxDensity` (WebGLMarineMaskRenderer.js:116,214) — darken-only, so the
  sheltered/canal/port-landfill verdicts survive.
- Flood profile at close: z5 **6.4%** · z6–8 **0–0.2%** · z9–10 **0.3%** · z11–12 **~2.5%**; crest-on-land
  **0%** everywhere (was z5 65%, z9 8–17%).

### 8b. OPEN residual ① — sub-second zoom-out transient (the graveyard-flagged one, §7h)
A **~600–900 ms first-visit flood spike on zoom-out** (22–51% + a box-edge rectangle) while the basemap
patch still covers only the strict pre-zoom viewport (`source_not_ready`, tile-load-bound). The zoom-delta
rebuild (§7e) shrank it; the eager-NE-overlay redesign (§7h) **was tried and REVERTED** — at z6 a
partial-coverage overlay engaged REPLACE and drew a **visible blue rectangle** at the overlay-bounds seam
(the very artefact it meant to kill). **Settled fix direction (do NOT re-attempt the reverted shape):**
build the overlay **DURING the zoom animation** on a throttled `zoom` event (not at `moveend`), and gate
REPLACE on `overlayCoversViewport` for **every** term (world_grid + coverage_gap, not just patch_gap).
**Verify VISUALLY (screenshot), never by flood % alone** — the % looked green while the seam was visible.

### 8c. OPEN residual ② — tidal-creek / marshy-cay flood (Andros / Moxey Town class)
The residual z11–12 **~2.5%** flood lives on **creek-dense and marshy coasts** where the land itself is
a fine mesh of 100–300 m tidal channels. **Root (verified in committed source):**
- **Both ground-truth sources generalize these away.** NE 10m and the basemap water polygons each
  simplify tidal creeks into solid land or solid water at the tile level → `reassertNeLand` **cannot
  restore what NE never carried** (it only multiplies NE land back; NE has already dropped the creeks).
- **The sheltered-water classifier culls sub-basin water.** `classifySheltered` (WebGLMarineMaskRenderer.js:402)
  keeps **only basin-scale connected components** — regions smaller than ~(4·nPx)² are dropped
  (line 468) — so a narrow creek/marsh network is either erased as "too small" or, running at
  basin resolution (too coarse for 100–300 m channels), classified as open water = wash.
- **Fix direction (next session, design):** a **higher-resolution sheltered-water classifier scoped to
  creek-dense coasts** — a finer nPx / per-tile classify over Andros-class geometry, or a dedicated
  marsh/creek land source the reassert can trust. This is the `[[marine-14day-horizon-tier-contract]]`-
  adjacent "sheltered-water exposure model" backlog item, now with a pinned failing class (Andros,
  Moxey Town). Not fixable from NE — the NE dataset does not contain the creeks.

### 8d. NEXT-SESSION order (supersedes the §3 / §5 close lines)
1. Residual ② tidal-creek/marshy-cay classifier (§8c) — the last visible marine flood class.
2. Residual ① zoom-out transient (§8b) — overlay-built-during-zoom, coverage-gated, visually verified.
3. Radar advection nowcast (§6a) — the observed↔HRRR coverage cliff; the ONLY real fix (big lift; the
   frozen-persistence bridge is graveyard, §6a).
4. Backlog carryovers (unchanged): ICON >240h POINT continuity (if any infobox drift remains), DWD/EU
   palette **live-verify from an EU viewport**, reseed blink, manifest slimming, chip task_c5366c79
   react-map-gl Source/Layer reconciliation, sheltered-water design (folds into #1).
5. **When ready to deploy: push dev → origin/dev (restarts Render, batch it).** No main push without the
   §22 explicit-instruction + confirmation handshake.

### 8e. Do-not-re-litigate carry-forward (the whole ledger)
§2 verdicts, §5a graveyard, §5b load-bearing guards, §5d verification discipline, §6a/§6b re-dig roots,
and §7h eager-overlay graveyard all stand. The recurring failure mode across this stack is the
**removal-fix** (delete a mechanism to fix symptom A, silently reopen symptom B, §2 carve-out lesson) —
every guard in §5b has a documented second duty. ⚠️ **The re-assert and the overlay coverage-REPLACE are
a matched pair — never revert one without the other** (§7g / §6b).

**Session status: CLOSED at `94072098`.** Runbook finished. dev +2 ahead of origin/dev (unpushed),
tree clean, 540 FE tests green, all 10 session guards verified live in the committed source.

---

## 9. RE-OPEN (07-07, Opus 4.8) — Moxey Town / Mangrove Cay marsh flood (residual ② §8c), FIXED partial

User live-tested `94072098` and caught heatmap over Moxey Town / the Bahamas. This IS §8c residual ②
(the tidal-creek/marshy-cay class). Diagnosed with the `__MASK_PROBE__` harness + basemap source probes.

### 9a. ROOT (forensic, all confirmed on the live preview)
- **Data-floor, both ground-truth sources agree the marsh is ocean.** At Moxey Town's tidal-creek belt
  (e.g. -77.60/24.24) NE 10m reads `neIsLand:false`, mask 255, screen teal — and the basemap `water`
  polygon reads water at EVERY zoom through z14. The named settlements (Moxey Town -77.6777/24.2977,
  Pinders, Congo Town…) are on NE-land and mask correctly (mask 0); the flood is the enclosed
  creek/marsh water BETWEEN them that both datasets label ocean. (This is why `scoreVisual` read ~0.9%
  while the eye saw a half-flooded island — the probe's NE/basemap truth undercounts, §7a lesson taken
  to its end.)
- **The basemap DOES ship the marsh as 29 `landuse_overlay/wetland` polygons** (Andros), and the
  existing wetland black-out pass (step 4, `overlayBasemapWaterOnMask`) already masks their INTERIORS
  (probe: 0% water inside polys). The leak is the **sub-pixel tidal creeks BETWEEN polygons** — 100-300 m
  channels are <1.5 px at the mask's ~200-800 m/px. The sheltered classifier can't help either: it drops
  sub-basin components (`classifySheltered` min-area filter releases the fine mesh), and at ~200 m/px the
  creeks are at/below the pixel floor.

### 9b. FIX — wetland black-out DILATION (WebGLMarineMaskRenderer.js, step 4)
Stroke each wetland polygon by a small **meters-based** radius (default `__RAW_WETLAND_DILATE_M__` 900,
clamped 0.75-5 px) to close the sub-pixel creek gaps. Meters-based (not fixed px) because the resident
mask resolution swings ~200-800 m/px with the resident grid; fixed-m self-scales — ~300 m at 199 m/px,
~900 m target closes the creeks, clamp caps over-cover at fine zoom. **Only ever ADDS black over
already-wetland-classified marsh → cannot flood** (the pipeline's core "passes only darken" safety).
- **A/B verified (creek-gap mask water-frac, valid rebuilds gated on `wetlandBlackout.dilatePx`):**
  0 px 22.1% → 1.5 px 19.2% → 5 px 12.6%. **Open ocean stays 100% water** (wetland polys are interior,
  > clamp px from the open coast) at z10.5 AND z13. Marsh reads predominantly solid land vs the
  "moth-eaten" baseline (screenshots).
- **540→694 FE tests green** (mask suite 37/37; added a kill-switch test; the mock needed a `stroke`
  method — my `ctx.stroke()` threw on the old mock and the wetland try/catch swallowed it, aborting the
  landcover query = the only failure, fixed). Kill `__RAW_DISABLE_WETLAND_DILATE__`; tune
  `__RAW_WETLAND_DILATE_M__` / hard `__RAW_WETLAND_DILATE_PX__`; telemetry `__RAW_GPU__.wetlandBlackout`.
- **RESIDUAL (still open, the true data-floor):** creek flood where NO wetland polygon reaches — the
  dilation can only grow existing polys. Strength is resolution-dependent (weaker when the coarse
  global-mid grid is resident: ~19%; stronger on the fine regional grid: ~12%). The complete fix is
  still §8c's higher-res land source / marsh classifier for creek-dense coasts — unchanged.
- ⚠️ Guard note: this is a NEW load-bearing darken-only pass in the §5c churn-hotspot file; it pairs
  with the wetland fill (step 4) and the island re-assert (§7c) — all "only darken", none may flood.

### 9c. NEW OPEN ITEM — z9 "grid outline / clamping" (PRE-EXISTING, not the mask fix)
User also caught a visible **coarse grid outline** in the wave field at ~z9 over the Bahamas. Forensics
(clean restart, single navigation — NOT churn): at z9 the resident marine grid is **`global_mid`
(~16 cells across the viewport)** → visible cells; it upgrades to the **regional/viewport grid (75-86
cells, smooth)** at z≥10 (verified). On the clean load the z9 view momentarily showed the regional
`florida_east_coast` product (86 cells) then settled to `global_mid` (16) — the designed tier for that
zoom band, but the finer→coarser flip is worth a look. **This is the marine DATA-GRID tier ladder, NOT
the ocean mask — the wetland fix cannot affect it.** Reproducible on a clean build = pre-existing.
**Next (separate investigation, verify on DEPLOYED dev not the churned preview):** either (a) smoother
coarse-zoom interpolation so global_mid cells don't read as a grid, or (b) lower the regional/viewport
grid threshold toward z9. Do NOT entangle with the marsh fix. See BRAIN_RULES 14-day tier contract +
`marineControllerUtils.js` regional-zoom thresholds before touching the ladder.

### 9d. State at round end
Tree = wetland-dilation marsh fix (WebGLMarineMaskRenderer.js + .test.js) + this runbook. 694 FE tests
green. Live-verified on preview 3007. Committed to dev (see git log); NOT pushed. z9 clamping logged as
§9c for a separate session.
