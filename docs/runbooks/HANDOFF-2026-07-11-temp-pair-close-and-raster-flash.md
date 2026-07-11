# HANDOFF — Temperature-Pair Arc CLOSED · Pipeline-3 Polish Is the Last Feature Mile
**2026-07-11 (late). Fresh-context bootstrap. dev==origin `60f5dd8e`+ (this doc's commit). FE 96/777,
backend 594 green. Read WEATHER-SIM-MASTER-AUDIT-2026-07-10.md findings #28-#31 + memory
[[session-2026-07-11-xfam-hold-manifest-clobber]] before ANY work. The user is feature-fatigued:
the remaining work is ONE instrumented pipeline-3 session + verification passes — do not open new
fronts.**

## 1. STATE — what is DONE and LIVE-VERIFIED (do not re-litigate)
| Ship | What | Verified |
|---|---|---|
| `cee97385` | #27 marine cross-family toggle TTL-hold | Preview round trip: 0 clears, dup-skip return, 0 texture churn |
| `7b6a312d` | #28 designated-writer gate (`L2_WRITER=1` runner-only; kill `L2_WRITER_GATE=0`) | Backend 583; rogue local backend killed by user; repair cycle green |
| `f88594da` | `written_by` manifest attribution + health/monitor warn on non-designated | Backend 587; stamps from the first post-deploy cycle |
| `6d2a56d9` | S4 far-edge hold (`far_edge_hold.py`; tail-only; kill `FAR_EDGE_HOLD=0`) | LIVE prod probe: h336 → 200/629vec, `far_edge_hold:+13.0h`, original estimate lineage preserved |
| `6056e3f1` | Air Temp + Water Temp toggles (pipeline-3 riders; CDN-probed first) | Slot ring live both layers; z-order dump exact |
| `0dcfc4ee` | water_temp roots #1/#2 (mask sync-drop retry; anchor re-assert) + **#29 CLOSED** (activation-lane terminal gate) | Break-case live-verified; cross-model commit discard was ALREADY guarded (useMarineDataFetcherCore:456) |
| `d21b7cd9` | water_temp root #3 (basemap `water`→0.25 when water_temp active) | Live z2.2 on/off |
| `60f5dd8e` | water_temp root #4 (inland-water lakes-repaint gated to marine-active) | Live: wt-only 0 ocean features; waves-on 9 lake features |

**Stage-6I.3 ICON marine 168→336h: CYCLE-VERIFIED** (manifest: 168 `icon_marine_*_estimated`, tail
07-25T00:00Z). Health all-green. ICON/marine horizon 141→~330h.

**Load-bearing lesson (memory has it too):** an under-water RASTER needs **FOUR** activations —
`oceanMaskActive` + `configureWaterTransparency` + slot-anchor re-assert below `ocean-mask-fill` +
inland-water hide. Marine never needed any (GPU in-shader mask; renders above the mask family).
Mapbox-streets **v8 `water` has NO `class` property at any zoom** — no filter can split
lakes/ocean; lakes-as-land in water_temp-only sessions is the accepted v1 trade (durable fix =
dedicated NE lakes source). Picker is SINGLE-SELECT (`toggleLayer` replaces).

## 2. NEW #31 — DOUBLE-FLASH on model switch with raster layers (user-repro'd; queue TOP)
Repro: any raster toggles active (Precip/Satellite/Fog/Pressure/Air Temp/Water Temp) → switch
GFS↔EURO↔ICON → screen flashes twice. **Mechanism candidates, all evidence-backed from the user's
own session logs — the session's job is to RANK them with instrumentation, then fix:**
1. **`!isTransitioning` blank-out (prime suspect):** every OM slot layer's layout is
   `visibility: (!isTransitioning && active) ? 'visible' : 'none'` (MapWebGL openMeteoRasterSlots)
   — a model switch deliberately HIDES all raster layers then un-hides. Logs show
   `[TRANSITION] Transition finished` fires **TWICE** per switch (the "Style load safety fallback
   triggered" re-fire) → hide/unhide runs twice = two flashes.
2. **Slot advance churn:** one model flip logs `satellite slot 0→1→1→2→2→0` (triple advance —
   URL re-resolution per metadata arrival). Each advance re-points a Source (react-map-gl
   remove+re-add) with `raster-fade-duration: 0` + cold .om decode → blink per advance.
3. **The #25 cold-tile class** (see §3) amplifies both.
Recipe: user session, reactscan OFF → `__RASTER_SLOT_TELEMETRY__.recent` around ONE model switch
(count transitions per layer) + count `Transition finished` lines + `performance.mark` around the
isTransitioning window. Fix directions (pick per evidence): don't blank rasters during model
transitions (hold last frame — the same retain philosophy every other lane got: `22eb81c8`
retention exists, the VISIBILITY blank is separate); dedupe the safety-fallback double-finish;
coalesce slot advances until metadata settles.

## 3. #25 — KEY DIAGNOSIS BANKED (user-repro'd 07-11 late): raster clears at ~z2.5 crossings =
**tile-pyramid-level switch (512px: tile-z2↔z1) + cold .om decode + `raster-fade-duration: 0`
disabling MapLibre's stretched-parent handoff** → transparent until decode instead of showing warm
parent tiles; self-heals once all levels are cached (user confirmed: zoom-all-in-then-out made it
vanish). Affects ALL SIX raster layers. First experiment: per-layer fade-duration/parent-retention
A/B — CAREFUL: fade 0 is deliberate for slot crossfades (radar arc precedent) — A/B on ONE layer
first with `__RASTER_SLOT_TELEMETRY__` watching. #30 (satellite decode-error bursts,
openMeteoProtocol.js:272 wrapper suspect) is the same session.

## 4. QUEUE (Jacobian order — this is the "get past feature work" path)
1. **THE pipeline-3 session (one session closes #31+#25+#30):** instrument one model switch + one
   zoom crossing on the user's machine → fix the blank-out/fade/slot-churn per evidence. This is
   THE remaining user-felt item family.
2. **User eyeball pass on dev--rawsurf** (SW BUILD_VERSION==HEAD first!): water_temp all zooms/all
   toggle speeds · marine far-edge hours show held-estimate frames not blanks · marine↔wind #27
   A/B · temp pair sanity.
3. **Structural (user decisions needed, designs banked in the 07-11 safeguards chat report):**
   S1 cred separation (dev Supabase project/bucket; strip prod service key from backend/.env) ·
   S2 run-keyed manifest + Postgres pointer CAS (Supabase has NO If-Match; unlocks CDN on hot
   routes = the 1M-user scalability lever).
4. Backlog unchanged: #21 (un-reproduced) · P7 SpectorJS · z9 A/B · sheltered-water model ·
   Temperature infobox long-press (raster-only v1 shipped) · NE-lakes source for water_temp ·
   split grid_resolver.py (786/800!) before ANY resolver change.

## 5. LANDMINES for the fresh context (beyond MEMORY.md's standing list)
- `grid_resolver.py` at **786/800** — split before touching. `far_edge_hold.py` is separate on purpose.
- OceanMask syncLayers: sync collisions now RETRY (kill `__RAW_MASK_SYNC_RETRY_DISABLED__`); source
  `setData` fires `sourcedata` NOT `styledata` — never rely on styledata for heal loops.
- `safeMoveLayer` is UNUSABLE for multi-layer re-asserts (adjacency-only guard → eternal rotation);
  use `map.style._order` strictly-above checks (see the water_temp re-assert in MapWebGL).
- Kill-switch inventory this session: `__RAW_MARINE_XFAM_HOLD_DISABLED__` ·
  `__RAW_MASK_SYNC_RETRY_DISABLED__` · `__RAW_WATER_TEMP_ANCHOR_REASSERT_DISABLED__` ·
  `__RAW_WATER_TEMP_MASK_DISABLED__` · `__RAW_WATER_TEMP_LAKES_REPAINT__` (force-on) ·
  `FAR_EDGE_HOLD=0` · `L2_WRITER_GATE=0` · shared `__RAW_DISABLE_TERMINAL_NOCOV_BYPASS__`.
- Preview-drive recipe (memory has full detail): `frontend-preview` autoPort → seed
  `localStorage['raw-surf-user']` → `/map` → patch `m.isStyleLoaded=()=>true` (geofence setData
  churn wedges it false) → `window.toggleLayer/setActiveModel/jumpTo` → verify via
  `javascript_tool` on `window.__*` + `style._order` (screenshots time out; getStyle().layers
  omits custom layers).
- NEVER run a local backend with prod .env creds on pre-gate code; the gate + `written_by`
  attribution now catch it, but S1 is the real fix.

## 6. 3-MONTH ARC IN ONE PARAGRAPH (for orientation, not re-work)
2,797 commits, 51% fixes. The system converged by hardening one lane at a time: mask truth (07-03→06
minefield, now document-only) → marine clamp/coverage (07-04→05) → OOM + manifest CDN (07-05→06) →
radar (07-08→09, CLOSED) → scrub/toggle/wind responsiveness (07-09→10) → full-system audit #1-#27
(07-10→11) → THIS session: the #28 rogue-writer incident (root-caused cross-machine in one night),
safeguards (gate+attribution+far-edge), the temperature pair (the first NEW layers in months —
shipped on the audited rails + four novel under-water-raster roots), #29 closed. What remains is
polish on pipeline-3's FEEL (#31/#25/#30 — one session) and two structural safeguards (S1/S2).
The engine itself: 30 FPS all zooms, stale-field vectors closed, data lanes all green with
attribution. The feature matrix is fully ✓ except the raster-feel column.
