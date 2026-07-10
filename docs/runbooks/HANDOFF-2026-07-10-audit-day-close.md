# HANDOFF — 2026-07-10 audit-day close: 9 fixes shipped, wind lane hardened end-to-end

**Fresh-context bootstrap order:** (1) memory index (auto-loaded), (2) memory topic
`audit-2026-07-10-fixes-p4-p5.md`, (3) `docs/runbooks/WEATHER-SIM-MASTER-AUDIT-2026-07-10.md`
(findings #1-#23 AUTHORITATIVE — statuses, evidence, kill switches), (4) this doc.
dev == origin/dev `6859caa1`. FE 93 suites/763 green · backend 569 green. prod=`main` untouched.
User verifies on `dev--rawsurf.netlify.app` — check SW `BUILD_VERSION`==HEAD FIRST; never judge
during a Render deploy (every push restarts it) or an ingest window.

## 1. SHIPPED TODAY (all pushed; kill switch in parens)
| Commit | Fix | Verified |
|---|---|---|
| `9494d8c2` | Wind series prewarm on model-switch/first-landing (`__RAW_WIND_MODEL_PREWARM_DISABLED__`) | live: settle series-hit, no fetch |
| `cf0b4b23` | Ingest-window gap: estimated tail survives native prune (`INGEST_PRUNE_PRESERVE_ESTIMATES=0` = operator purge lever) | run 29068687719: EURO prune 68→2/layer |
| `06fbeef2` | Wind hold-last-frame + terminal-nocov skip in SETTLE path (`__RAW_WIND_HOLD_LAST_FRAME_DISABLED__`, shared `__RAW_DISABLE_TERMINAL_NOCOV_BYPASS__`) | live fetch-interception: hold+skip+recovery |
| `bcbc25c6` | #17 OM slots anchored BELOW wind (`__RAW_OM_SLOTS_ANCHOR_DISABLED__`) + #10 10° global-wind parity (`WIND_GLOBAL_PARITY_10DEG=0`) | z-order live (wind 121→132); parity live 629 @0.77s cached |
| `db94a7c3` | Shared in-flight context poison (CancelledError = BaseException; shield×4 + waiter reap + fetcher cleanup) — the post-parity naked-500 storm | live: no naked 500s through cold-timeout cycles |
| `95b42121` | Fitted parity timeout `WIND_GLOBAL_PARITY_TIMEOUT_SEC` (default 40s; explicit `VIEWPORT_UPSTREAM_TIMEOUT_SEC` still bounds) | live: parity served after one cold 504 |
| `22eb81c8` | #11 model-switch OM cache retention — wipe + `_cb` nonce were VESTIGIAL (`__RAW_OM_MODEL_WIPE_LEGACY__=1`) | live: return-leg = ZERO map-tiles requests |
| `fc0ec396` | #22 ICON wind 14d tail PRE-BAKED on DWD ingest path (`ICON_WIND_EXTEND=0`) | ⚠️ PENDING — see §2 |
| `68e80179` | #23 wind trail FBOs kept through camera reseeds — the pan/zoom field blank (`__RAW_WIND_TRAIL_CLEAR_LEGACY__=1`) | live: "re-seeded (trails kept)" ×3, no blank |
| `6859caa1` | Moveend refetch renderable-guard — the "ICON wind heatmap cleared" report (safe-zero 1-vector grid committed ×5 → layer cleared buffers). LAST `vectors.length>0` commit hole closed | suite-pinned (same class as 06fbeef2); ⚠️ user live-verify pending |
Plus: `4271db10` WIND-TELEMETRY label fix + docs commits (audit rows updated per fix).

## 2. VERIFY FIRST NEXT SESSION
1. **#22 pre-bake**: run 29113128156 (18:02Z) was CANCELLED-no-jobs (runner contention, harmless) —
   the extension has NOT executed in a completed cycle. On the next SUCCESSFUL forecast-ingest run:
   `/api/health/data` ICON/wind horizon ~113→~330h · far-hour `grid?model=ICON&domain=wind` instant
   (stored product) · run log has "ICON wind (14d loop-ext tail)" saves. Until then far-hour ICON
   wind 504s gracefully (hold-last-frame keeps the display; `6859caa1` stops the clear).
2. **`6859caa1` live**: user repro was waves-scrub → switch to ICON wind → heatmap cleared → restored
   after toggles. Post-fix expect "Viewport refetch unrenderable — holding last frame" instead.

## 3. OPEN QUEUE (ranked)
1. **#21 ICON waves banding/equator-clamp** (user-reported, un-reproduced ×4) — WAIT for the user's
   capture (recipe in audit row #21; A/B lever `__RAW_DISABLE_MIDGESTURE_COMMIT__=true`).
2. **Audit P7** (particles/SpectorJS — `tools/spectorjs`): includes the unresolved preview-pane
   1Hz-rAF anomaly (rAF 1Hz + idle main thread + healthy GPU telemetry + wind engine not rendering;
   preview FPS numbers are UNRELIABLE — measure on the user's live session only).
3. **Audit P8** (API audit; seed = `data-source-matrix-2026-07-08` + this week's latency curls),
   then P9 races / P12 WebGL perf (mask-churn evidence banked: fixed-viewport scrub = reuse ✓,
   zoom-out transition churn = documented accepted class, DO NOT grind) / P14 readiness score.
4. **#18/#19 observability slices** (user approved direction): cheap = stamp truthTag through series
   frames; medium = stage-absence watchdog; TruthDiff prod-silent + first-layer-only.
5. #15 gfs_ext reorder (LOW) · chatty [MapCore] log block (#12 class) · awake-cycle `ingest_probe.sh`.

## 4. HARD-WON LANDMINES (today)
- CancelledError is a BaseException — `except Exception` ladders are BLIND to it; bare-future awaits
  get CANCELLED by a dying waiter (shield them). Local uvicorn does NOT cancel on disconnect; Render
  DOES — this bug class is un-reproducible locally.
- `getStyle().layers` OMITS custom layers — z-order forensics via `map.style._order` ONLY.
- om-tile fetches live in the WORKER — invisible to main-thread performance API; use DevTools-level
  network tools (preview_network).
- CRA jest `resetMocks:true` wipes factory mock impls — re-arm in beforeEach.
- viewport_service.py = 800/800 EXACTLY — SPLIT before any next change (wind gates already moved to
  `wind_gates.py`; re-imported so import sites unchanged).
- The `vectors.length>0`-vs-`isRenderableWindData` commit-guard class is now closed at ALL THREE
  wind commit sites (primary/settle/moveend) — any NEW commit site must use the renderable guard.
- GH "cancelled, jobs: []" ingest runs = runner contention, harmless; data continuity now protected
  by cf0b4b23 regardless.

## 5. TELEMETRY CHEAT SHEET (additions today)
`__WIND_MODEL_PREWARM_COUNT__` · `__WIND_TERMINAL_NOCOV_SKIP_COUNT__` · `__RAW_MASK_RETAIN_COUNT__`/
`__RAW_MASK_RES_RETAIN_COUNT__` · wind reseed log split: "re-seeded (trails kept — camera recenter)"
vs "re-initialized and FBOs cleared due to bounds change" (data-driven) · model-switch log:
"(caches retained, model-keyed)" = retention active.

**Session status: CLOSED.** Next session: §2 verifications first, then §3 queue.
