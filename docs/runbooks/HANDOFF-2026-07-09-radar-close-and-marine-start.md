# HANDOFF — 2026-07-09: Radar saga CLOSED, start MARINE in a fresh context

**For a fresh context.** dev HEAD `84bb1351`, **dev == origin/dev (PUSHED)**, tree clean. **FE 87 suites /
721 tests GREEN.** prod = Netlify `main` (NO main push). The user tests `dev--rawsurf.netlify.app` —
`update-sw-version.js` stamps the SW `BUILD_VERSION` = git short-sha; **always reconcile the deployed
`BUILD_VERSION` vs HEAD before trusting a "regression"** (a stale SW served an old bundle and cost us
multiple false alarms this arc). Read the memory index first, then this doc.

This session was a long radar arc (precip → infobox → radar forecast). It's now in a clean, honest,
working state. **The next focus is MARINE (§3).**

---

## 1. WHAT SHIPPED THIS SESSION (07-08 → 07-09) — all kill-switched, FE 721 green

| Commit | What | Kill switch | Status |
|---|---|---|---|
| `6b6e5d64` | **Precip §2 bold/uniform/global** — hue-progressive palette (`colorScales.js`) + boosted rain raster-opacity (`MapWebGL.js`). Global model precip reads like Windy's Rain. | `__RAW_PRECIP_BOLD_DISABLED__` | ✅ user: "looks good" |
| `017929db` | **Infobox** — prefer parity-grid over `exact_stale_available` (flash) + soften bare "Timeout" → "Updating…". | `__RAW_INFOBOX_STALE_TIGHTEN_DISABLED__` / `__RAW_INFOBOX_TIMEOUT_SOFT_DISABLED__` | ✅ |
| `8d9844a6` | Radar **advection nowcast** default-on + cap 30→60 (Ventusky/Windy Lagrangian). | — | ⤳ superseded below |
| `6200c496`→`3c59f8e3` | Radar Stage-2 model-precip far-term — **REVERTED** (seaming crisp radar + coarse model looks awful = the IMERG mistake on the time axis). Radar = observed + advection nowcast, then STOP; the long forecast is the SEPARATE **Precip** layer (Windy/Ventusky keep them separate — forensically confirmed). HRRR = fallback/opt-in `__RAW_RADAR_HRRR_FAR__`. | — | ✅ correct architecture |
| `5ec7f7e9` | Radar observed tiles → **native 256px** (512 supersample `c7381934` was 4× bytes → ERR_CONNECTION_RESET on slow networks). | `__RAW_RADAR_512_TILES__` (opt back to 512) | ✅ |
| `928c5546`→`84bb1351` | **RainViewer tile PROXY** (Netlify edge fn `frontend/netlify/edge-functions/rvproxy.js`, `/rv/*`, durable CDN cache) + **advection default-ON**. The advect tiles route through the cached proxy (`rainviewerTileTemplate`); observed stays direct. | `__RAW_RADAR_PROXY_DISABLED__` (advect→direct) / `__RAW_RADAR_ADVECTION_DISABLED__` | ⚠️ **UNVERIFIED — user must confirm live** |

---

## 2. RADAR CLOSE — the hard-won truths (do NOT re-learn these)

- **RADAR IS RATE-LIMIT-FRAGILE on the free RainViewer CDN.** Anything that multiplies tile requests →
  HTTP **429** → a 429 carries **no `access-control-allow-origin`** → the browser reports it as a **CORS
  block** → blank tiles in **vertical-column "rectangle" gaps**, worst zoomed out, and it takes the
  *observed* radar down too. Confirmed live via the `advDecodeTile` stack trace + `429 (Too Many Requests)`.
  RainViewer 200s DO send `ACAO:*` + `cache-control: max-age=172800` — so it was purely a request-RATE problem.
- **The advection nowcast is the amplifier** (advect-rv:// `fetch()`es prev+curr per tile = ~3×). It is only
  viable default-on **behind the cached proxy** (`84bb1351`). If the proxy underperforms, `__RAW_RADAR_ADVECTION_DISABLED__=true`
  reverts to observed + HRRR (works — HRRR is IEM, a different server).
- **NEVER zoom-drive the radar tile URL** — putting tile size on a zoom-driven state re-mounted every frame's
  source on each zoom, re-fetching all tiles → the same 429/CORS flood (`b8658774` revert). The URL must be
  STABLE per frame.
- **NEVER seam two precip products in one animated view** (Stage-2 om-model far-term `6200c496`, and the
  earlier IMERG underlay `a3558d1a`). Radar = observed + short crisp nowcast, then STOP. The long forecast is
  the SEPARATE Precip layer. This is exactly what Windy/Ventusky do (researched, not guessed).
- **⚠️ The proxy (`84bb1351`) is UNVERIFIED** — Netlify edge functions don't run under local craco, so this
  was shipped blind (FE tests + the doc'd durable-cache mechanism only). **The user must verify on
  `dev--rawsurf.netlify.app`: no 429/rectangles, radar populates at every zoom, advection animates smoothly.**
  If it regresses: `__RAW_RADAR_PROXY_DISABLED__=true` (advect→direct) or `__RAW_RADAR_ADVECTION_DISABLED__=true`.
- Radar rendering is FAITHFUL — where RainViewer has data we render it; gaps are genuine RainViewer data gaps;
  lightning = GLD360 near-global. Per-frame-layer = RainViewer's own pattern (NEVER a single re-pointed source).

---

## 3. ⭐ MARINE — THE NEXT FOCUS (start here in the fresh context)

The marine heatmap/scrub is the user's outstanding daily-UX complaint. Root map + the ranked items:

### 3a. Scrub / toggle jank + "heatmap clears on scrub" + the E-Atlantic rectangle (ONE root)
The user's live 07-08 reports — "radar clears the heatmap when I scrub," "a rectangle appeared in the E
Atlantic" — are the **marine coarse↔regional grid swaps during scrub** (logs: `coarse_global → Sharpening →
regional → coarse`, grid flipping 37×17 ↔ 19×8; the grey box is a coarse-grid coverage boundary mid-swap).
This is the SAME subsystem as the "timeline scrub slow" jank.

- **Root (measured, definitive — `HANDOFF-2026-07-08-radar-transition-scrub-perf-and-backlog.md` §7/§10):**
  `timeOffsetHours` re-renders the ~850-line MapWebGL every scrub step → react-map-gl reconciles the `<Map>`
  child tree → the felt ~62 ms/step. Proven **React-bound, NOT GPU/paint** (paint ~1 ms via `map._render(0)`;
  the no-layer control drag held ~66 ms). The marine upload path already tracks the scrubber (synchronous
  content-diffed `safeUploadWaveData`); the vector conform is already memoized; the atmospheric tiles debounce.
- **Shipped cheap wins (do NOT redo):** ratings-churn fix `63765848`; static-`<Map>`-children memo `32e7035e`
  (kill `__RAW_SCRUB_MEMO_DISABLED__`); memo slices `b720752c`/`2cb4e709`/`19b2ec79`. Harness:
  `window.__SCRUB_PROBE__` (`scrubPerfProbe.js`) — renders/step + per-hook attribution + `clears`/`reinits` 0-tripwire.
- **The ONLY remaining lever = the §7c `<ScrubTimeProvider>` + `<MarineHeatmapSubtree>` refactor** (lift
  `timeOffsetHours` into context so MapPage/MapWebGL go inert on a scrub tick; the heatmap subtree consumes the
  raw hour and publishes `marineData` up DEBOUNCED). **It has NO clean runtime kill switch** (Rules of Hooks —
  can't conditionally move `useMarineOrchestrator`/`useMarineWindData` between components), so it's all-or-nothing
  with git-revert as the only rollback, on the 371-commit churn-hotspot MapWebGL. **⇒ do it in a REAL-BROWSER
  watched session (React DevTools Profiler + real-FPS A/B), NOT a blind headless edit.**
- **Guardrails that refactor MUST preserve (3-mo archaeology):** engine residency `9c89701e`/`15302d35`;
  synchronous scrub upload `6f173bc0`/`a9c30178`; the vector mirror (`useMarineWindData` conform — the LAST place
  field lists eat `is_valid`/`dirConfidence`); FCE-decoupled-in-normal-mode `40d28b9d`; the `task_c5366c79` memo
  slices. Verify `__MASK_PROBE__` no re-flood + `__WEBGL_MARINE_CLEAR_COUNT__`/particle-reinits = 0.

### 3b. z9 "clamping" — DO NOT RE-CHASE the data (it's a real fix spec, not a hunt)
GFS wave is **0.25° NATIVE** — there is no denser product; the "grid outline" at close zoom = crests binning to
0.25°. Settled-z9 is already resolved (crest jitter `3d604a12`, `__RAW_CREST_DIR_JITTER__`). The residual is a
~600 ms intrinsic zoom-animation bridge. The ready fix = **§10c commit-regional-MID-GESTURE**
(`__RAW_DISABLE_MIDGESTURE_COMMIT__`, A/B with the scrub harness against the §5a timing-change graveyard).
⚠️ **density landmine `marineControllerUtils.js:298-303` (41×41 BLANKED)** — judge marine ONLY on CLEAN/WARM
builds (cold Render + preview churn amplify clamp perception; tell = failing spot-ratings/grid_series fetches).

### 3c. Infobox stuck-loading on EURO far-scrub
EURO exact-point fetches a fresh **cold Copernicus point** (25 s budget + retries) on each settle, suppressed
during scrub → "stuck Loading… for a minute." The real fix: **sample the already-loaded EURO grid series for
the infobox** instead of a separate slow point fetch (touches the guarded v5.7→v8.0 cascade — careful, kill-switched).

### 3d. Other marine backlog (lower priority)
Sheltered-water / intracoastal exposure model (rating truth for protected spots — design-heavy, multi-session);
reseed blink (swap-time land cull); colormap v5 light/beach + Baja eyeballs.

---

## 4. MARINE LANDMINES & GUARDS (carry-forward — do not re-learn the hard way)
- **`radar render-mode SUSPENDS the marine engine`** — any radar/scrub work must preserve this handoff.
- **`new Map()` in MapWebGL = react-map-gl shadow** (use `globalThis.Map`); **protocol registration BEFORE
  source mount**; **`map.stop()` before jumpTo**; **`/grid` vectors live at `grid.vectors`**, not top-level.
- **backend `speed` IS wave height** (land-aware seam coherence note).
- **mask upgrade = re-assert + overlay-REPLACE is a MATCHED PAIR** (`94072098`; `__MASK_PROBE__`) — never revert one alone.
- **800-LOC pre-commit hook** — NEVER `--no-verify`; split files instead.
- **screenshots time out under repaint loops** — use `serialize().data` traces / `map._render(0)` sync timing.
- Data source-of-record locked (`data-source-matrix-2026-07-08.md`): all GRIB2 EXCEPT EURO marine = Copernicus
  netCDF; open-meteo = FALLBACK; `7d3b8a71` coarse-vs-direct-point guard (never revert a lane to open-meteo-primary).
- 14-day horizon + tier contract LOCKED (`marine-14day-horizon-tier-contract.md` / BRAIN_RULES): horizons via
  capabilities ONLY; tiers via `LayerAccessResolver` ONLY.

---

## 5. VERIFICATION DISCIPLINE (the meta-lesson of the whole session)
Headless preview CANNOT judge animation / FPS / load-feel / "does it look right" (rAF throttled ~4 fps, software
WebGL) and CANNOT run Netlify edge functions. Use it for: DOM/layer inspection, tile-existence fetches, unit
tests, `map._render(0)` sync-timing, webpack-compile confirmation. **Everything subjective (marine smoothness,
the scrub refactor's real FPS, the radar proxy's effect) is the user's REAL browser on `dev--rawsurf.netlify.app`
after confirming the fresh BUILD_VERSION.** One isolated, kill-switched change → user verifies → then the next.

---

## 6. FIRST MOVES FOR THE FRESH CONTEXT
1. **Confirm the radar proxy live** (user): `dev--rawsurf.netlify.app`, Radar layer, zoom out over CONUS — no
   429/rectangles, radar populates, advection animates. If bad → `__RAW_RADAR_PROXY_DISABLED__=true` /
   `__RAW_RADAR_ADVECTION_DISABLED__=true` and report which.
2. **Then MARINE.** Recommended: the §3a scrub-subtree refactor as a dedicated real-browser Profiler session
   (biggest daily-UX win; build/verify with `__SCRUB_PROBE__` + `clears`/`reinits`=0; preserve every §3a guard).
   OR §3b z9 §10c A/B if you'd rather a smaller marine-commit change first. Do ONE at a time on a CLEAN/WARM build.

**Session status: radar CLOSED at `84bb1351` (pushed, proxy pending live verify). Precip + infobox shipped.
Next context: verify the proxy, then marine (§3).**
