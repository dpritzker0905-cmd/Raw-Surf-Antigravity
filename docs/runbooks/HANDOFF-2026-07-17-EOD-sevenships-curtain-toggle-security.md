# HANDOFF — 2026-07-17 EOD — §2c fade · flavor backstop · close-zoom curtain · toggle interlude · seam verdict · BOLA guard + slice

**For a fresh context.** Read `[[standing-work-rules-user-mandate]]` +
`rating-toggle-direction-interlude-2026-07-17` + `closezoom-curtain-inland-order-pin-2026-07-17`
+ `band-coverfade-and-flavor-backstop-2026-07-17` first. This consolidates the full 07-17 session
(day + prior night); per-arc detail lives in `HANDOFF-2026-07-16-NIGHT-...lru.md` §5a–§5j
(updated in place all session — the §5 addendum IS the detailed ledger).

## 0. VERIFIED STATE (2026-07-17 EOD, re-checked from primary source)
| Surface | State | Proof |
|---|---|---|
| `origin/dev` HEAD | `4325437c` (docs) / last code `1965fabd` | git log origin/dev; local==origin |
| CI | ✅ success every push (incl. the NEW `backend-bola-guard` job) | gh run list + job-level view. ⚠️ GitHub incident delayed one workflow ~3 h AND swallowed a Render webhook (§5j lesson) |
| Netlify dev FE | ✅ LIVE (was `e8b5a2db`+ at last check) | cache-busted service-worker curl |
| Render backend | ✅ LIVE on `1965fabd` — bridge smoke: legacy-param 404 domain / no-cred 401 bridge | /api/health version + live curls |
| FE tests | ✅ 121 suites / 1072 tests (multiple fresh runs) | craco |
| EOD battery | see §2 | traces in session scratchpad `final_battery/` |

## 1. THE SHIPS (all pushed, CI-green, each forensically pinned; kill switches §3)
1. **`83def648` FLAVOR BACKSTOP** — the Surf Rating toggle could silently no-op (toggle raced the
   §0l inflight dedup; nothing re-drove). One bounded re-drive per flag|viewport|layer|hour at
   fetch completion. Ring `flavor_backstop`.
2. **`e34d6942` §2c COVERAGE-KEYED BAND FADE** — the rated→unrated release is `z≤7 && cover<0.6`;
   the span-only fade couldn't anticipate the zoom leg → full-strength band flips (+11..+16 L).
   Coverage leg derived from the release's own constants; min() combine; wash follows. Swap frame
   ΔL now +2..+5 with band pre-faded. (§2c "fail-open" prose was a telemetry misread — documented.)
3. **`e4a6bdd0` CLOSE-ZOOM CURTAIN KILL** (user z11.51) — `ocean-mask-inland-water` paints ALL
   water on class-less basemaps (filter fails open) at opacity 1.0 below its z11.5 fade stop, and
   its order vs the marine layer was MOUNT-TIMING RANDOM. Two-sided deterministic order pin
   (OceanMask targets below-marine; WebGLMarineLayer demotes strays end-of-styledata-tick).
   Full-span ladder (NEW `staircase_full` scenario, z9→14→2): zero events across 96 notches.
4. **`f74214fd` TOGGLE INTERLUDE LANES** (user z8.63 "direction flips + faint, then self-corrects")
   — COLD asks resolve different tiers per flavor (unrated→global_mid blockmean/damped; surf→
   regional tile); the mid interim escaped every upgrade path (settle clamp = coarse-GLOBAL only).
   Flavor-cache fast path + `series_upgrade` cache-only lane (commit missing-flavor or ≥1.25×-finer
   series frames; never network; never aborts fetches). Landmine fixed en route: updateMarineGrid's
   `marineData` closure is MOUNT-STALE → use marineDataRef.
5. **§5i SEAM VERDICT** (user "line of less animations" ~-79.3 off Ft Pierce) — the seam lived
   INSIDE a cold-window interim dynamic product (tile-edge quantized); photographed, then healed
   when fine builds displaced it. FALSIFIED: particle-tile edge · valid-edge · dominant-swell
   stamp. Probe kit `probe_seamline.js` (kept in scratchpad; recreate from §5i description).
6. **`4d6ae5d1` BOLA DRIFT GUARD (CI)** — AST scanner + ratchet baseline; drift PROVEN live
   (221→226 in 5 days). `backend-bola-guard` job green in real CI.
7. **`1965fabd` BOLA PHASE 1 SLICE** — 7 clear-self QUERY-param financial money-movers on
   `Depends(get_user_id_from_jwt_or_query)`; ratchet 226→219. DEPLOY-PROVEN live: legacy-param
   call → domain 404 (fallback intact); no-cred call → the bridge's own 401; token-bearing calls
   now act as the JWT subject (the BOLA fix).

## 2. EOD FULL BATTERY (fresh runs at `4325437c`)
| Scenario | Verdict | vs baseline |
|---|---|---|
| zoomout rating OFF | max \|ΔL\| **−8.3**, mult0 **0** | baseline class (−4.7..−9.8) ✅ |
| zoomout rating ON | max \|ΔL\| **−7.2**, mult0 0; ONE rated→unrated swap at **ΔL 1.1, band 0.00** | best ON result ever recorded (pre-arc −16..−22) ✅ |
| pan_coverage | ring-fill 282/291, min cell coverage 55% | rf ✅; min-cov 55 vs 63 = run variance (land-heavy frame) — watch |
| staircase_full (z9→14→2) | **0 curtain-class events, 0 animation collapses**; 4 settled steps 8.2–12.9 L in z11.5–13.3 (flags continuous, crests alive) | curtain stays dead ✅; the small close-zoom flutter = basemap label/road pop-in at their z12/z13 minzooms + the documented z12.05 overlay-engagement step (`ovl off↔min_combine`, hm 0.798↔0.85) — NEW residual, see §4.5 |
| layers | max ΔL 25.2 = the wind-overlay toggle (intentional); **0** anim-dead frames | ✅ |
| FE unit suite | 121 suites / 1072 tests | ✅ |
| Backend live | version `1965fabd`; bridge smoke 404-domain/401-bridge | ✅ |
Note: two background battery runs crashed on first attempt (parallel-Chromium contention);
foreground re-runs succeeded — run battery scenarios SEQUENTIALLY.

## 3. KILL-SWITCH QUICK REFERENCE (07-17 ships)
`__RAW_DISABLE_BAND_COVER_FADE__` (+ `__RAW_BAND_COVER_FADE_ZLEAD__` lever) ·
`__RAW_DISABLE_FLAVOR_BACKSTOP__` · `__RAW_DISABLE_INLAND_ORDER_PIN__` ·
`__RAW_DISABLE_FLAVOR_CACHE_FASTPATH__` (fast path + series_upgrade lane) ·
BOLA guard: revert = remove the `backend-bola-guard` job; route slice: bridge falls back to the
legacy param, so behavior-level rollback is unnecessary (revert commits if ever needed).

## 4. KNOWN RESIDUALS — what the user may still SEE (honest list, with owners)
1. **Cold-window interims (the big one):** for ~10–60 s after an ingest cycle / fresh viewport /
   flavor toggle, the marine field can ride mid/coarse tiers: paler heatmap, faint or
   differently-angled crests, possible internal seams (§5i class) — until the 1-CPU backend
   builds the fine product and the (new) upgrade lanes commit it. FIXES QUEUED: backend
   dynamic-build stitching audit (seamless-or-withheld interims) · cold-supply latency strategy ·
   anim-source independence (animations never re-source from interims — the durable §0e
   completion; generalize the ring-fill held-field pattern; dedicated particle-minefield arc).
2. **Tier-vs-tier direction physics:** GFS/EURO coarse fields genuinely differ from fine
   (blockmean / gfs_estimated-vs-ECMWF) — visible whenever a coarse tier is honestly on screen.
   Not a bug; bounded by fixing #1.
3. **Res-watchdog bar too lax:** expectedMaxCellDeg 2.5° at z8.6 lets a one-cell-per-screen mid
   grid pass silently. Tighten when touching the watchdog.
4. **Close-zoom settled flutter (NEW, small):** ±8–13 L settled steps in z11.5–13.3 with healthy
   animations — basemap label/road layers popping at their z12/z13 minzooms through the
   translucent field + the z12.05 overlay-engagement opacity step (hm 0.798↔0.85 at
   `min_combine`). If the user's "still see issues" is at close zoom, THIS is the likely
   remaining visual. Candidate fixes: fade the overlay-engagement step over ~0.3z; accept
   basemap pop-in (it's the basemap's own behavior).
5. **BOLA debt remaining:** 219 routes (15 PATH-param financial = co-drive bucket needing the
   ownership-check pattern + tokenless-compat decision; then messages → location →
   identity-writes → rest). Public-bucket audit still pending (07-14 review).

## 5. QUEUE (priority order)
1. **User co-drive:** BOLA path-param bucket + domain rollout + public buckets (see §4.4).
2. **Backend dynamic-build stitching audit** (§5i root) + cold-supply latency (§4.1).
3. **Anim-source independence arc** (§4.1; particle minefield — instrument-first).
4. Small: res-watch bar · a11y panels-keyboard mandate · §0j mask churn supply-side ·
   sheltered-water model.

## 6. OPS / HARNESS NOTES (new this session)
- **Verify `api/health` version before claiming a backend change live** — a GitHub incident can
  swallow Render's deploy webhook (never retried; any new push re-triggers). Same-day proof: CI
  delayed 3 h, deploy stuck one commit behind, caught by a smoke curl's pydantic-vs-bridge shape.
- Windows Python: use `C:\Users\dprit\AppData\Local\Python\bin\python3.exe`
  (`Program Files\Python314` is broken — Lib/encodings missing). Scanner output is ASCII
  (cp1252 consoles crash on emoji). Five route files carry BOMs (scanner uses utf-8-sig).
- zoomlab additions: `staircase_full` (z9→14→2 both directions — THE brightness ladder; run it
  for any zoom-band visual claim) · `_ratingon` suffix works on any scenario · rating-wait
  timeout diag. Probe kits in the 07-17 session scratchpad: seam hunter, curtain/order,
  debug-modes (`__GPU_DEBUG__.mode='uv'|'mask'|'grid'`), toggle-interlude, valid-edge,
  anim-channel, flavor-direction compare.
- Forensic lessons: engine-telemetry-identical visual cliff ⇒ bisect the style/DOM layer stack ·
  `getStyle().layers` omits custom layers (use `map.style._order`) · canvas readbacks only
  inside `map.on('render')` · quarantine evidence from runs within ~60 s of an HMR recompile.
