# HANDOFF — 2026-07-08 (late): Radar coverage deep-audit, the Precip plan, and the scrub/backlog carry-forward

**For a fresh context.** dev HEAD `6f179d0c`, **dev == origin/dev (PUSHED)**, tree clean. FE suite last
audited **87 suites / 720 tests GREEN** (radar changes since are a scalar + comments + tests still 40/40).
prod = Netlify `main` (NO main push). **The user tests at `dev--rawsurf.netlify.app`** (Netlify dev build;
`update-sw-version.js` stamps the service-worker `BUILD_VERSION` = git short-sha → a stale SW can serve an
old bundle; ALWAYS reconcile the deployed `BUILD_VERSION` vs HEAD before trusting a "regression" report).

Read the memory index + `radar-coverage-deep-pass-2026-07-08.md` first. This doc is the authoritative
close on the radar saga + the agreed Precip direction.

---

## 0. STATE — what shipped this session, and the git arc (radar was a rollercoaster; read the reverts)

| Commit | What | Status |
|---|---|---|
| `32e7035e` | **scrub perf #1 slice** — memoize MapWebGL's static `<Map>` children (esri + ~12 om-slots + geofences) so react-map-gl skips their scrub reconcile. ~1.3ms/step, tripwires 0/0. Kill `__RAW_SCRUB_MEMO_DISABLED__`. | ✅ shipped |
| `5578e21b`→`9170dd2f` | **radar advection** core (`radarAdvection.js`, 14 tests) + `advect-rv://` protocol + frame emission (10 tests). **OPT-IN, CONUS-only** (`__RAW_RADAR_ADVECTION__=true`). | ✅ shipped, dormant |
| `b62a50ef` → **`0cddc489` REVERTED** | global+default-ON advection + zoom-EXPRESSION opacity + 512 tiles, **bundled**. Tanked FPS 30→2 + broke animation. | ⛔ reverted |
| `c7381934` | **512px RainViewer tiles ALONE** (crisper). FPS-verified 30.5=30.5 (the tiles were NOT the b62a50ef killer). Kill `__RAW_RADAR_256_TILES__`. | ✅ shipped |
| `a3558d1a` → **`84694771` REVERTED** | IMERG (GIBS) global satellite base UNDER radar. Seaming crisp-radar + coarse-satellite in one view "looks terrible" (user). | ⛔ reverted |
| `6f179d0c` | **radar light-precip visibility** opacity 0.65→0.8 (flat scalar, crossfade-safe; kill/tune `__RAW_RADAR_OPACITY__`) + **lightning coverage comment** corrected (near-global GLD360, not CONUS). | ✅ shipped |

---

## 1. RADAR COVERAGE DEEP-AUDIT — the definitive, data-backed truth (user doubted it; here's the proof)

**The radar is working CORRECTLY. There is no coverage bug.** Evidence:
- **Rendering is FAITHFUL:** where RainViewer has data, we render it. VERIFIED live — SE Australia's real
  echo (RainViewer's own tile = **4,882 bytes** at z6) renders in our app (NSW-coast blue echo). Brazil
  (`2219b`) + US (`13675b` z4) too. No region gate on past frames.
- **Gaps are GENUINE RainViewer data gaps:** the Sahel returns a **334-byte EMPTY tile** at every zoom
  (Mali's radars don't reach the storm). RainViewer DB = 1200+ radars/150+ countries, but the LIVE tile
  mosaic only includes radars publishing real-time — vast regions (Sahel, C.Africa, C.Asia, oceans) have none.
- **Lightning is NEAR-GLOBAL, not CONUS:** nowCOAST `ldn_lightning_strike_density` GetCapabilities
  `EX_GeographicBoundingBox` = lon −180→180, **lat −25→80** (Vaisala **GLD360** global). Confirmed live:
  13 strikes, all over the Sahel; the user also sees lightning over the USA (correct — GLD360 covers it).
  This is WHY lightning shows where radar can't = a FEATURE, not a bug. (Was mislabeled "CONUS" in code.)
- **"Looks like no coverage" root = FAINT light precip:** scheme-7 paints light dBZ a dark blue,
  low-contrast on the dark basemap → covered regions with light rain read as empty. Mitigated `6f179d0c`
  (opacity 0.8). ⚠️ still a residual — a palette/contrast pass (or a lighter under-radar wash) is a candidate.

**∴ nothing to "fix" in radar coverage — it's faithful. The genuine gaps are un-fixable with more radar
(that data isn't free/doesn't exist). The real global fix = a uniform Precip layer (§2).**

---

## 2. THE AGREED NEXT FEATURE — make "Precip" BOLD + UNIFORM + GLOBAL (user signed off; NOT started)

**Insight (Windy/Zoom Earth):** the pros NEVER seam radar + satellite in one view (that's the mistake I
made in `a3558d1a`). They keep **Radar** (regional, crisp, observed) SEPARATE from a **Precipitation** layer
that's a **model or satellite product — uniform + global by construction**. OWM precip tiles = **PAID** (out).

**The app ALREADY has the uniform global product: the "Precip" button** = Open-Meteo model precipitation
(`ncep_gfs013` GFS / `dwd_icon` ICON / `ecmwf_ifs025` ECMWF; `LayerRegistry.js` `rain` layer, `omVariable:
'precipitation'`). It renders globally at uniform resolution via the om raster slots (verified live: "GFS /
rain, Raster LOADED"). It's just **faint + plainly-styled**.

**THE PLAN (one focused change, verified, do NOT bundle):** boost the "Precip" layer's visual weight so it
reads like Windy's beloved "Rain" layer — higher opacity/contrast + a proper precip color ramp (blue→green→
yellow→red). Uniform by construction, global, smooth, no seams. **Radar stays exactly as-is** (regional HD
observed). Consider making Precip the more prominent/default global view; radar = "zoom in for HD detail".
- om raster opacity is currently a zoom-interp in `MapWebGL.js` (~0.22–0.40) — that's the faintness lever.
- Palette: om tiles come pre-colored from Open-Meteo (`&dark=true&contours=true`); to restyle you'd either
  pick different om render params or recolor via a protocol (like `hrrr-rv://`). Investigate om params first.
- Alt (observed global, if wanted LATER): IMERG `IMERG_Precipitation_Rate_30min` via GIBS, `time=default`
  (free, verified 200s, ~10km) — but as ITS OWN separate layer, NEVER overlaid on radar.

---

## 3. OPEN ITEMS / RANKED BACKLOG (for the fresh context)

1. **"Precip" bold/uniform/global** (§2) — the agreed global-precip fix. MED coupling (om raster styling),
   HIGH value. Do it isolated + verify it looks like a pro rain layer worldwide + FPS-check.
2. **512-tile load latency** (user 07-08: "higher res, but slow to load") — 512px RainViewer tiles are 4×
   the bytes → slower first paint on scrub/pan. Options: preload/warm neighbor frames, HTTP caching, or a
   zoom-gated 256↔512 (256 when zoomed out/animating, 512 when settled+zoomed-in). Kill `__RAW_RADAR_256_TILES__`
   already exists for A/B. Verify on a REAL browser (headless rAF is throttled — can't judge load feel).
3. **Radar advection** (`5578e21b`→`9170dd2f`) — shipped but OPT-IN CONUS. Remaining: LIVE-STORM
   motion-plausibility + ~240ms/tile estimate perf (Worker/cheaper grid) + global (needs the non-blocking
   estimate first). `[[radar-advection-core-2026-07-08]]`.
4. **Scrub perf #1 subtree** (§7c of `HANDOFF-2026-07-08-radar-transition-scrub-perf-and-backlog.md`) —
   the low-coupling memo slice shipped (`32e7035e`); the remaining lever (stop MapWebGL body re-render) is
   the high-coupling `ScrubTimeProvider`+`MarineHeatmapSubtree`, **needs a REAL-BROWSER React Profiler
   session** (attribution proved paint is cheap ~1ms → cost is React-main-thread; but no runtime kill switch
   → all-or-nothing, watched session only). See §10 of that runbook.
5. **z9 clamping §10c** (prev runbook) — marine-commit A/B, dedicated session.
6. Sheltered-water/intracoastal exposure · external uptime probe on `/api/health/data` · reseed blink.

---

## 4. ⛔ GRAVEYARD + LANDMINES — do NOT re-learn these the hard way

- **NEVER bundle multiple radar-render changes** (`b62a50ef` = 3 at once → FPS 30→2, un-isolatable). ONE
  change at a time, each FPS-verified + kill-switched.
- **NEVER a zoom EXPRESSION on the crossfading radar opacity** — it breaks the `raster-opacity-transition`
  crossfade (frames clear/flash). Flat SCALAR only (that's why `6f179d0c` used 0.8 scalar, verified safe).
- **NEVER seam two precip products in one view** (`a3558d1a` IMERG-under-radar) — crisp + coarse next to
  each other "looks terrible." Uniform = ONE product per view (that's the whole point of §2).
- **512px tiles ALONE are FPS-clean** (`c7381934`, 30.5=30.5) — the b62a50ef FPS killer was the opacity
  expression + the main-thread advection estimate, NOT the tiles.
- **Headless preview CAN'T judge animation/FPS/load-feel** (rAF throttled ~4fps, software WebGL). Use it
  for: DOM/layer inspection, tile-existence fetches, unit tests, `map._render()` sync-timing. Do NOT trust
  it for smoothness — that's the user's real browser. Every "it looks bad" this session was real-browser-only.
- **Stale service-worker bundle** = the "verify bundle hash first" trap. Deployed `BUILD_VERSION` (in
  `/service-worker.js`) must == HEAD short-sha before diagnosing a reported regression. Hard-reload / SW
  unregister to force the new bundle.
- **radar past frames are global (RainViewer); future = HRRR CONUS / DWD EU; lightning = GLD360 global.**
- Everything from the prior runbooks' graveyards (§5a timing-change, §5b marine guards, `new Map()` shadow,
  protocol-registration-before-mount, `map.stop()` before jumpTo) still stands.

---

## 5. VERIFICATION DISCIPLINE (the meta-lesson of this session)

The radar saga churned because I judged visuals/perf on the throttled headless preview and shipped bundled
changes. The user's real browser is the only faithful judge of animation, FPS, load feel, and "does it look
right." Going forward: **one isolated, kill-switched change → the user verifies on `dev--rawsurf.netlify.app`
(after confirming the fresh BUILD_VERSION) → then the next.** Data-fetch/DOM/unit checks CAN be done headless;
subjective visual/perf CANNOT.

**Session status: radar in a clean, honest, faithful state at `6f179d0c` (pushed). Next context: §2 Precip
bold/uniform/global, then the ranked backlog (§3).**
