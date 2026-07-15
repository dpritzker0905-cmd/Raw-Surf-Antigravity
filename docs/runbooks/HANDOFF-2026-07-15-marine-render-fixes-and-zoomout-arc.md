# HANDOFF 2026-07-15 — marine render fixes + the zoom-out experience arc

**For a fresh context picking up the weather-simulation work.** dev HEAD at write = `e8f10955`,
all pushed, **Netlify dev + Render both LIVE on `e8f10955`, CI green**. This session ran on top of
`0072d0d3` and shipped 16 commits (10 fixes, 6 doc/record). Predecessor blow-by-blow:
`HANDOFF-2026-07-14-marathon-close-stability-arc.md` §0g–§0o (every root cause + fix detail lives
there; this doc is the audit + orientation layer over it).

**Baselines (last full runs):** FE **971/971** (verified at HEAD's FE changes). BE **731/2928**
(last full run before the §0n revert; the revert only DELETED an untested gate block, so the count
holds — re-run `python -m pytest -q` to reconfirm if paranoid). Targeted BE viewport/resolver
76/76 verified at HEAD.

**Standing rules that bit this session (read before touching marine):**
- Shared-tree repo → **commit with pathspec only**, never `git add -A` (the `.agents/skills/*`
  working-tree noise is pre-existing, NOT ours — leave it).
- Every dev push restarts Render → **batch pushes**, judge behaviour only on a WARM build with
  SW `BUILD_VERSION == HEAD` (hard-refresh; the SW caches the old bundle a cycle).
- Pane gotchas that cost time: the Browser pane can shrink to ~453px → **mobile layout** hides
  desktop controls → `resize_window` 1280×800 FIRST and confirm `window.innerWidth`. Model
  buttons are **tier-locked** (`getAllowedModels`) — a fake localStorage user can switch LAYERS
  but sometimes not MODELS; use a layer switch to exercise the same lanes. CRA HMR does NOT
  reliably reload non-component modules → **hard-navigate** before re-testing engine/controller
  changes. Visual A/B recipe: `map.once('render')` → `canvas.toDataURL()` → full-screen `<img>`
  overlay → screenshot.

---

## ✅ COMPLETED THIS SESSION (verified, shipped, live)

| § | Commit | What | Verification |
|---|--------|------|--------------|
| 0g | `0d2622f5` | **Series proxy-window death** — heavy-class 16-frame pages (EURO/surf) + BE deadline 35→20s under Netlify's ~26s cut. Kills the "Fetch failed" EURO far-tail. | Live: GFS surf pages 8–10s, 0 misses. Env `GRID_SERIES_DEADLINE_S`. |
| 0h | `3c51f852` | **Wash model-switch re-warm** (ICON "animations but no heatmap") + **EURO/ICON coarse `dir_confidence` export** (wrong-way crests fade). | Wash: live `__RAW_GPU__.blendBoth`. Confidence: **AUDIT-CONFIRMED live in products** — EURO 357/629 cells, ICON 397/629, low-conf cells present (see §"pending eyeball"). |
| 0i | `75a11204` | **Wide-request surf-tile tightening** — z7 rating-on ocean dead strips. Wide (>4.75°) requests need ≥ near-full tile cover else the covering dynamic lane serves. | Live at user's z7.02. Envs `SURF_REGIONAL_PREFER_FULLCOVER_SPAN_DEG` / `_WIDE_POKE_DEG`. |
| 0k | `ba421d16` | **Band inland-water gate** — rating-on land-mask halo over lagoons/bays. Shader small-disc enclosure classifier. | Canvas-capture A/B, FL Melbourne. Kill `__RAW_BAND_INLAND_GATE__=0`. |
| 0l | `f9c35e07` | **Series flavor guard** — the band wouldn't turn off on toggle-off (cached surf frames served into swell mode). One-directional (surf-in-swell refused). | Deployed-site E2E: toggle off → band off ~10s. |
| 0l-add | `d322078a` | **Abort-Gate flavor identity** — rapid off→on re-toggle stuck honest (`__intent.surf` + both dedup sites). | Live: the exact 400ms racy cycle restores in ~10s. |
| 0m | `626c905f` | **Island-halo no-truth damp** + crisp-mask **density gate** (world-mask-as-crisp hole closed). | Live Green Turtle Cay. Kill `__RAW_DISABLE_ISLAND_HALO_DAMP__`, telemetry `washNoTruthDamp`. |
| a11y#5 | `626c905f` | **jsx-a11y lint arm** — `.eslintrc.json`, 15 warn-only rules, no `extends`, Netlify `CI=false`. | **Proven with full `craco build` exit-0** (the deploy-landmine test). |
| 0j-slice | `f875e023` | **OceanMask guard-layer high-zoom fades** — z13.3 "sectioning lines". inland-water/waterway 1.0@z11.5→0@z12.5; mask-line ramp ends z12. Order-independent (z-order is mount-timing dependent = the "intermittent" face). | Suite green; the fade is deterministic paint. |
| 0o | `e8f10955` | **Zoom-out bridge** — blank flash + floating FL rectangle on zoom-out. `shouldBridgeToCoarseGlobal` (pure, 7 goldens) promotes the held `_coarseBaseData.waveGrid` when the regional covers <60% of a wide view (coverage COMPLEMENT of the no-downgrade guard). | Live: **0 empty frames** both fast + settle zoom-out; final resident global 37×17. Kill `__RAW_DISABLE_ZOOMOUT_BRIDGE__`, telemetry `__MARINE_ZOOMOUT_BRIDGE__`. |

**REVERTED — a regression I introduced and removed (`e8f10955`):** §0n dynamic-cache
resolution-adequacy gate (`f875e023`). Post-deploy probe FAILED honesty: a 5°×4° GFS ask served
`global_mid` 5×5 on BOTH probes, not the intended 21×17. Rejecting the 0.5° dynamic cache falls
through to `try_serve_mid_res_tier` (global_mid 2°) whose SWR sharpen is span-capped at 5° → the
5° box NEVER rebuilds fine. It traded a viewport grid for a coarser one with no rebuild path and
aggravated zoom-out coarsening. **Jacobian lesson: a server cache change must verify the
FALLTHROUGH, not just the rejection.** If the z7.82 swirl recurs, the fix belongs in the VORTEX
MAGNIFICATION GATE (`isMagnifiedCoarseField`), not the cache.

---

## ⚠️ NOT COMPLETED — open board, ranked by user-visible value

### 1. ZOOM-OUT EXPERIENCE ARC (ACTIVE user pain, top priority)
The §0o bridge removed the blank-flash and the persistent FL rectangle, but the user's last live
report still names **"clamping + slow expansion of the animations + some quick clearing."** These
are SEPARATE mechanisms from what the bridge fixed:
- **"Slow expansion"** = the coarse→fine **SWR sharpen cadence**. On zoom the coarse-global serves
  instantly, then the regional viewport tile revalidates and commits over ~seconds — the field
  visibly "fills in". This is DATA-FLOW timing (`_revalidate_fetch`, the render backstop re-drive
  cadence, `try_serve_mid_res_tier`'s span-capped sharpen), NOT the render guards.
- **Residual "clamping"** = a barely-covering regional or a mid-tier grid magnified at the
  coverage boundary (the no-downgrade `__RAW_DOWNGRADE_COVER_FRAC__=0.6` frontier).
- **"Quick clearing"** = sub-frame transition gaps the 110ms instrumentation can miss.
**Why banked, not rushed:** this is the documented scrub/perf minefield
([[marine-scrubsettle-safetynet-internals-2026-07-12]], [[standing-context-guards-landmines]] —
"mask-res/retain + prewarm + engine = OFF-LIMITS / documented-regression MINEFIELD"). Speculative
timing/shader changes here are exactly how past regressions landed. **Approach for the arc:**
instrument the sharpen timeline first (when does the regional commit land after a zoom? measure
`_revalidate_fetch` latency + the backstop cadence), THEN decide whether to (a) pre-warm the
regional viewport tile on zoom-START not zoom-END, (b) raise the mid-res sharpen span cap (the 5°
cap that bit §0n), or (c) tune the no-downgrade frac. Measure before touching. Kill switches to
A/B during the arc: `__RAW_DISABLE_ZOOMOUT_BRIDGE__`, `__RAW_DOWNGRADE_COVER_FRAC__`.

### 2. §0j FULL ARC — marine layer re-anchor + mask-rebuild churn (biggest close-zoom win)
The slice (paint fades) shipped; two structural pieces remain:
- **Re-anchor `webgl-marine-particles`** (currently stack index 9, BELOW `fill:water` and all
  three OceanMask guard layers). Conventional weather-overlay stacking puts the data layer ABOVE
  all water fills, BELOW roads/labels (`beforeId ≈ pitch-outline`/`waterway`). Re-anchoring
  obsoletes the guard-above-marine class wholesale. ⚠️ `OceanMask.syncLayers` actively manages
  order (`60f5dd8e`: inland-water once repainted the WHOLE ocean) — do it WITH the syncLayers
  logic, own arc, full visual pass at the z13.3 sites. Code home `OceanMask.js:24-37`.
- **Mask-rebuild CHURN** — every commit rebuilds the land mask (the 4096↔2048 alternation in the
  user's logs); also behind the FPS 7-17 dips. This is the "intermittent covering" disease. Needs
  its own forensic pass (why does every commit rebuild vs retain?).

### 3. Sheltered-water / intracoastal exposure model (backlog ②)
The full answer to enclosed-water band painting. The §0k inland gate handles narrow lagoons but
"wide bays >~2× the classifier disc" (mid-Biscayne scale) still partially paint. Server-side
enclosure classification feeding mask + band + animations consistently is the real fix.

### 4. EURO/ICON coarse-direction VISUAL eyeball (data now confirmed present)
`dir_confidence` is AUDIT-CONFIRMED live in the products (EURO 357/629, ICON 397/629 cells; 19/44
low-conf cells that WILL fade). The wrong-way-crest fade should now engage. **Only the visual
confirmation is left — a human look at EURO/ICON coarse at a bimodal-water spot** to confirm the
faint wrong-way crests now fade instead of animating confidently.

### 5. a11y item 4 — panels keyboard support
The map control PANELS need full keyboard operability (ForecastWheel is the house pattern:
`role`, arrows/PgUp/PgDn/Home, visible focus). Item 5 (lint arm) shipped; item 4 is the manual
keyboard work. Handoff §0a debt inventory. Task chip filed earlier this session for three
unlabeled `aria-expanded` float buttons.

### 6. BOLA lane (own review doc)
221/930 routes trust bare `user_id`. `HANDOFF-2026-07-12-USERID-AUTH-ARCHITECTURE-BOLA-REVIEW.md`
§6 governs — CI enforcement FIRST, not one big PR. Untouched this session.

### 7. Minor / notated (not chased)
- **Stale wash base** seen once this session: `washBase:"GFS"` under an ICON rating resident at
  z8.5 (rating band still painted correctly). Possibly a same-session artifact of my scripted
  model juggling; watch for it in a clean organic session before treating as a bug.
- Public storage buckets security debt (`SECURITY-REVIEW-2026-07-14-public-storage-buckets.md`) —
  P1 chat_media/crew_chat world-readable. User wants to return to it. Untouched.

---

## FORENSIC / JACOBIAN NOTES FOR THE NEXT SESSION
- **The marine render pipeline is a coupled system.** One zoom-out involves: the SWR
  coarse-preview → mid-res tier → dynamic viewport build → no-downgrade guard → coarse-base wash →
  zoom-out bridge → prewarm. Changing one ripples. §0n proved a server cache change can make the
  CLIENT experience worse via an unverified fallthrough. **Always trace what serves when your
  change says "miss", and verify the fallthrough on the DEPLOYED backend, not just the unit.**
- **Instrument before editing the minefield.** The zoom-out arc needs a sharpen-timeline probe
  (regional-commit-latency-after-zoom) before any timing change. The `__MARINE_ZOOMOUT_BRIDGE__`,
  `__RAW_GPU__.blendBoth`, and the `[Marine] Render backstop` / `[SCRUB-SETTLE]` console lines are
  the existing forensic surface — a pasted log self-reports the lane state.
- **Verify claims against the deployed bundle.** This session's proof passes read the SW cache
  `rawsurf-v3-<hash>` to confirm `== HEAD` before trusting any live readout. Do the same.
- **The confidence export is a good template** for "data lands on the next cron" items: probe a
  fresh product for the new field directly (`/grid` wide bbox → count non-null cells) rather than
  waiting to eyeball.
