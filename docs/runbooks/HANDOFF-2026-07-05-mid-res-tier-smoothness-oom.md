# HANDOFF — 2026-07-05: Mid-Res Tier End-to-End, Gesture Smoothness, Render OOM Triad

**dev HEAD at handoff: `9cfbc935`** (pushed, 0/0 origin/dev). **DEPLOY FREEZE in effect** — every dev
push auto-deploys Render (= ~1-2 min restart/502 window); 7 deploys today read as "failures" to the
user. Batch future pushes.

## 1. What shipped today (all dev-only, kill-switched, test-covered)

| Commit | What |
|---|---|
| `e3fb61b4` | z7-boundary frontend: coarse-base bridge P1/P2 + Fix-A coverage-aligned display gate + item-① diagnostics |
| `2c9fa5fb` | **MID-RES GLOBAL TIER** (backend): `global_mid` ~2° per provider, resolver Step 3.6 serves it clipped. LIVE-verified |
| `17472850` | item-① Long Beach idle glitch: LIVE-CONFIRMED (soak caught `{source_not_ready, rebuild}`) → retain-patched-mask fix |
| `f7025fe5` | **FORECAST MIRROR**: GFS mid 14d parity; EURO 240→336h via extended-estimates region `global_mid`; resolver serves estimated mid + replaces unclipped coarse; `global_mid` excluded from generic selection + preview scan (manifest-order luck); **mid jobs → pilots lane** (core timeout fix) |
| `3841a41e` | **Zoomed-out viewport fetch**: marine global threshold 5→15° + coverage-aligned ALL FIVE "zoomed-out ⇒ global" replicas (display gate, conform, clear-helper, recovery detector, §2b reqBounds). The z6.27 clear / z7.44 color-flip fix |
| `270d2801` | Infobox: Rating card gated on `getSurfModeFlag()`; provisional `…` marker on grid-sampled first paint |
| `6b2f5a1d` | Irvine straddle guard (⑥ center-tile only when fully inside); mid SWR sharpen; **Render OOM #1** (prefetcher warming global_mid = 24× budget) ; lifespan `Optional` shadowing bug |
| `c18434a9` | San Diego half-cell coverage ring: mid clip padded one cell (`MARINE_MID_CLIP_PAD_DEG=2`) → coverage ~1.0 deterministic |
| `256997fc` | Dwell-sharpen clamp: `detectClamp` zoom-relative (0.3°/8-cells-across) → auto `clamp_resharpen`, no pan needed |
| `41bfebca` | **Gesture smoothness**: 30% fetch-pad (grid overhangs screen; 40% pan lands inside — proven) + `sourcedata` mask re-drive (FL intracoastal first-paint flood) |
| `9d681d5e` | **Render OOM #2**: reval concurrency semaphore (`MARINE_REVAL_CONCURRENCY=1`); reval cap 5→8° (pad-aware — the z7.20→7.35 color step) |
| `9cfbc935` | **Render OOM #3** (scrub burst: 17-hour grid_series parsed a full 15k-vector mid PER HOUR concurrently ≈250MB): clipped-result LRU (`MARINE_MID_CLIP_CACHE_MAX=24`) + load semaphore (`MARINE_MID_LOAD_CONCURRENCY=2`) + reval queue cap (`MARINE_REVAL_QUEUE_MAX=2`) + **zoom-out anticipation** (`prewarmZoomOutMarineGrid`, timeline-proven: covering grid at zoomstart+17ms) |

## 2. Final audit sweep (this session's close, post-`9cfbc935` FE)
Scrub/pan/zoom gauntlet LA basin (z7.0→7.4→8.6→9.5): **0 mask glitches, 0 engine-empty recovers,
0 no-downgrade rejections, 0 repatch no-ops**; settled fine 25×25; JS heap 161MB / GPU ~272MB
bounded; backend 200 @ 0.49s. The resolution ladder now: fine 0.25° (≤2° in-tile, or SWR-sharpened
≤8°) → mid 2° clipped+padded (2-15°) → global coarse 10° (>15°), with estimated-hour mirror parity.

## 3. OPEN — next session, in order
1. **Render stability watch**: confirm the memory graph is FLAT after the `9cfbc935` deploy under
   hard scrubbing. If it OOMs again, the honest next step is the instance size (512MB is tight for
   15k-vector product parses) — weigh $/mo vs more engineering (streaming JSON parse, or the
   "encoded marine tiles" upgrade-queue item which fixes this class permanently).
2. **Island shadowing (user live, mechanism FOUND, fix NOT applied)**: shape-hugging dark halos
   around Channel Islands at z7.2-7.4 with mid resident (screenshot in session; 6×5 span-10 grid).
   Root: render-side land-fade whose width scales with GRID TEXEL size (1.67° mid cells ⇒ ~6.7×
   wider halo than fine). Shader grep 'fade|texel' in WebGLMarineShaders returned nothing — look at
   WebGLMarineEngine uniforms (seamFadeFloor / heightAlpha / confidence-fade `d61f7209`) and the
   TextureEncoder dilation (its .dilation.test.js). Fix = make fade width ABSOLUTE (deg/px) or clamp
   for coarse grids.
3. **Cron verdict**: core run `28747064567` was STILL in_progress at ~19:00Z (~2h25m — will hit the
   165-min cap ~19:21Z). Mid jobs are OUT of core now, so a cancel cleanly indicts the
   calibration/precompute tail alone → next lever is trimming REPORT_CALIBRATION per-point fetches
   or splitting calibration into its own workflow (same pattern as the pilots split).
4. **Eyeballs owed**: colormap v5 on light/beach themes (`raw-surf-theme` in localStorage — RESET IT
   after testing, a stuck 'light' reads as "white map"); infobox long-press (Swell→no Rating card,
   Surf→card, `…`→clears); SD/Baja/LB re-sweep post-deploy.
5. **system-brain weather doc rewrite** (`frontend/system-brain/weather-simulation-system.md`, 210
   lines, stale-flagged): today's architecture belongs in it — resolver ladder + Step 3.6, the
   coverage-not-zoom principle (SIX aligned replicas incl. the guard), pilots-lane job split, the
   OOM guard set, gesture pad/anticipation. Write from `docs/audits/AUDIT-2026-07-03` + this file.
6. **Backlog**: sheltered-water exposure design (lagoons animate; user wants them still — the
   sourcedata re-drive fixed the *transient*, steady-state exclusion needs the exposure model);
   encoded marine tiles > hourly texture interp > mask-beyond-viewport; EURO mid enable decision
   (`EURO_MARINE_MID_RES_INGEST=1`) once cron budget is proven.

## 4. Landmines for the next context
- Preview loads code ONLY on `preview_stop`+`preview_start`; `reused:true` may serve pre-edit JS.
- The infobox opens on a REAL long-press — synthetic pointer events don't trip it.
- `_CLIP_CACHE` in mid_res_tier keys by filename (content identity in prod) — tests reusing fake
  filenames must clear it (see `_resolve` in test_marine_mid_res_tier.py).
- The 800-LOC pre-commit hook is per-file and hard (NEVER --no-verify): grid_resolver 773,
  viewport_service 759, WebGLMarineLayer ~950-gross (hook counts code lines) — extract before adding.
- Every dev push = Render deploy = restart. Batch.
- Kill switches added today: `__RAW_DISABLE_COARSE_BRIDGE__`, `__RAW_DISABLE_ZOOMOUT_REGIONAL_COVER__`,
  `__RAW_DISABLE_MASK_RETAIN__`, `__RAW_DISABLE_STRADDLE_GUARD__`, `__RAW_DISABLE_MASK_SOURCEDATA_REDRIVE__`,
  `__RAW_MARINE_GLOBAL_SPAN__`, `__RAW_MARINE_FETCH_PAD_FRAC__`, `MARINE_MID_RES_TIER=0`,
  `{GFS,ICON,EURO}_MARINE_MID_RES_INGEST`, `MARINE_MID_REVAL_MAX_SPAN`, `MARINE_REVAL_CONCURRENCY`,
  `MARINE_REVAL_QUEUE_MAX`, `MARINE_MID_LOAD_CONCURRENCY`, `MARINE_MID_CLIP_CACHE_MAX`, `MARINE_MID_CLIP_PAD_DEG`.

Full forensic detail: memory topic `z7-zoomout-clear-coarse-bridge-2026-07-04` Parts 1-10 +
`item1-idle-glitch-root-source-not-ready-2026-07-04`.
