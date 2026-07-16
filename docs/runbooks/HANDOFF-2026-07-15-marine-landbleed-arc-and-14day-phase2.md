# HANDOFF — 2026-07-15 — marine land-bleed arc + direction-truth + 14-day Phase 2

**For a fresh context.** dev HEAD `64bd1ff6`, all pushed to `dev`, Netlify+Render redeploying. This
session shipped 4 kill-switched marine fixes + a watchdog + 14-day Phase 2, all forensically verified
(deep audit below). **Read `[[standing-work-rules-user-mandate]]` first** — the user's standing rules
(forensics-not-guessing, Jacobian, instrument-first on the minefield, live-test protocol, be decisive).

---

## 0. SHIPPED THIS SESSION (all live-verified, all kill-switched)

| Commit | What | Root (forensically pinned) | Kill switch | Audit verdict |
|---|---|---|---|---|
| `b0bb9bd6` | **Crest land-bleed** — dense global base must min()-COMBINE not REPLACE the overlay | wide-grid `_gwSpan>=340` overlay REPLACE let a water-flooded overlay ring override a correct dense global base | `__RAW_DISABLE_DENSE_BASE_NO_REPLACE__` | ✅ z3: 13 land pts worldwide=0 bleed |
| `b8555570` | **Resolution watchdog** — traps the stuck-coarse-global state in the wild | (instrument, not a fix) — coarse-global at a <15° viewport | `__RAW_DISABLE_RES_WATCH__` | ✅ caught 6 anomalies live; 0 false-pos on fine tile |
| `62030654` | **14-day Phase 2** — ICON far-tail gets a `global_mid` variant (9.73°→1.75°) | ICON extension hardcoded to `global_coarse`; EURO already had both tiers | env `ICON_MARINE_EXTEND_MID=0` | ✅ 5 unit + 63 BE tests; **cron-baked → curl-verify post-cron** |
| `64bd1ff6` | **Escaped-mask rebuild** — rebuild base mask when the viewport escapes it on zoom-out | base mask rebuilt only on COMMIT; zoom-out escapes the regional mask box w/ no commit → CLAMP_TO_EDGE water over land (SC/NC/GA/Cuba) | `__RAW_DISABLE_ESCAPED_MASK_REBUILD__` | ✅ z5: 0 bleed, mask rebuilds global; z12.5 no regression |

Plus docs/proof commits (`2c7b04e7`, `f4b99bda`, `7a11047a`, `ad1eee7a`, `415b7859`) and the
direction-truth PROOF doc `docs/runbooks/PROOF-2026-07-15-marine-direction-truth-and-resolution.md`.

---

## 1. DEEP AUDIT (this handoff — re-proven with fresh forensics)
- **Tests:** FE `503 passed` (1 suite `MapMarkerLayers.a11y` fails to LOAD on `react-map-gl/maplibre`
  — a PRE-EXISTING local node_modules subpath gap, not mine: my commits never touched that file or
  package.json; works at runtime). BE marine `63 passed`. Unit sets for each fix all green.
- **Crest + escaped-mask @ z5 (live probe):** base mask rebuilds to GLOBAL 4096 (1420-feature geojson),
  `enc:rebuild`; 7 interior-land points (SC/NC/Cuba/Ohio/MS/Brazil/Congo) = **0 bleed**, 3 oceans intact.
- **Watchdog:** present, `report()` works, **caught 6 `coarse_global_at_coastal_zoom`** during a z9→z5
  jump (working as designed); 0 false-positives on the fine tile.
- **Direction rating parity:** rating ON == OFF == 81.3° at the fine 0.231° tile (surf_transform
  preserves direction). Authoritative backend curl: GFS 50.4° (`ncep_gfswave025`), ICON 74.0°
  (`dwd_gwam`), EURO 78.8° (`ecmwf_wam025`) — all `is_forecast_authoritative:true`.
- **Phase 2 pre-deploy:** ICON day-12 tail still `global_coarse` 9.73° estimated (correct — the fix is
  cron-baked; will flip to `global_mid` ~1.75° after one Render cron cycle). Post-cron curl recipe in
  [[icon-fartail-mid-resolution-phase2-2026-07-15]].
- ⚠️ **Escaped-mask kill-switch A/B was INCONCLUSIVE one run:** the bleed is INTERMITTENT — it needs
  the retain to fire (coarse-global commits while the viewport is still small → `_maskSourceReady=false`
  retains the regional mask), which is timing-dependent. When the base rebuilds naturally at commit,
  there's no bleed and the fix is a no-op. The fix is proven by the CAPTURED live bleed (retained
  regional mask, SC/NC/Cuba covered, FPS 2) + forcing a rebuild clearing it + clean post-fix z5.

---

## 2. OPEN BOARD (next steps, prioritized)
1. **Escaped-mask residual TRANSIENT.** The fix rebuilds on the zoom's `moveend`/`zoomend`, so the
   PERSISTENT bleed is gone, but a *continuous* trackpad zoom could still flash for a sub-second frame
   before the first `moveend`. If the user still reports a quick flash, tighten it to fire mid-gesture
   (on `zoom`/`move`, throttled) — or make the shader treat outside-the-mask-box as land at coarse-global.
2. **Wash-dimming ("strange land-band covering") — STASHED, unverified (`git stash@{0}`).** An engine
   edit accepting the dense global mask as `baseCrispMask` so `washNoTruthDamp` stops dimming the
   coastal wash at coarse zoom (A/B-proven the damp dims: `__RAW_DISABLE_ISLAND_HALO_DAMP__` off →
   brighter). Do NOT restore without its own A/B — it binds the global mask to the WASH (would cover
   land if that mask were transiently wrong). Mostly moot after `64bd1ff6` fixes the base transient.
3. **Verify Phase 2 post-cron** (ICON day-12 tail → `global_mid` 1.75°); watch the ICON-extension
   wall-time vs the ~165min core budget (`ICON_MARINE_EXTEND_MID=0` is the escape hatch).
4. **Watchdog trigger review:** `window.__RAW_RES_WATCH__.report()` now traps stuck-coarse-global in the
   wild — when the user hits a coarse/wrong-direction state, its `recent[]` gives the exact trigger to
   fix the sharpen/bridge dedup with proof (the OPEN #1 zoom-out arc).
5. Deferred non-marine: BOLA (221 routes trust bare user_id), public-bucket audit (DB advisors clean of
   ERRORs this session — 134 INFO rls_enabled_no_policy = safe deny-default, 3 minor WARNs), a11y panels.

---

## 3. FORENSIC METHODS + HARNESS (this session's real unlocks)
- **Harness:** local `frontend-live` localhost:3001 auto-mock-auth (`AuthContext.js:34`) → real Render
  data. `window.map` / `__MARINE_ENGINE__` / `probeMaskGPU` / `__RAW_GPU__` / `__RAW_RES_WATCH__`.
- **`engine.probeMaskGPU([{lng,lat}])`** → `{base,overlay,effective,src}` (0-255, ≥128=water) — the
  ground-truth mask readback. `null` eff = the point is OUTSIDE the mask bounds (a bleed signal itself).
- ⚠️ **rAF THROTTLES TO 0** when the Browser-pane tab backgrounds between tool calls → per-frame samplers
  record nothing and `flyTo` won't animate. **Use rAF-INDEPENDENT capture:** monkey-patch
  `engine.setWaveData(gl, waveGrid, landGeoJSON)` to `probeMaskGPU` land points at COMMIT time
  (event-driven). This is how the SC/Cuba bleed was finally caught.
- ⚠️ **Programmatic camera reverts** (React re-centers) — `jumpTo` mostly holds; `flyTo` often gets
  reverted mid-animation; `setZoom` reads are stale (apply async). `jumpTo` to a target fires
  `zoomend`/`moveend` (enough to test event-driven paths like the escaped-mask fix).
- **Backend curl** (`raw-surf-antigravity.onrender.com/api/weather/grid?model=GFS|ICON|EURO&domain=marine&layer=waves&bbox=..&valid_time=..T00:00:00Z`, model UPPERCASE, valid_time REQUIRED) is the
  authoritative forensic surface — provenance (`source_dataset`, `is_forecast_authoritative`), tier
  ladder, far-horizon behavior.

---

## 4. KILL-SWITCH QUICK REFERENCE (this session)
`__RAW_DISABLE_DENSE_BASE_NO_REPLACE__` (crest min-combine) · `__RAW_DISABLE_RES_WATCH__` +
`__RAW_RES_WATCH_WARN__` (watchdog) · `__RAW_DISABLE_ESCAPED_MASK_REBUILD__` (escaped-mask) ·
`__RAW_DISABLE_ISLAND_HALO_DAMP__` + `__RAW_DISABLE_GLOBAL_CRISP_WASH__` (wash damp, the latter is
STASHED) · env `ICON_MARINE_EXTEND_MID=0` (Phase 2 mid tail).

## 5. STANDING LESSONS (re-confirmed)
- The marine mask/retain/bridge code is a regression graveyard — instrument + kill-switch + multi-zoom
  A/B before touching. Two DISTINCT land-bleed roots this session (overlay-REPLACE `b0bb9bd6` vs
  retained-regional-mask-on-escape `64bd1ff6`) proved one fix ≠ the whole class.
- Verify on the RENDERED map (the SC/Cuba bleed + FPS crash were only visible live), not just probes.
- The user witnessed both bugs on the live preview during MY testing — keep the preview coherent and
  narrate what you're driving.
