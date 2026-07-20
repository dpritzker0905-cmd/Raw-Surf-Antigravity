# HANDOFF 2026-07-20 (night) — "the overlay needs to be global": the wind global-mid arc

Continues `HANDOFF-2026-07-19-queue-5-9-native-recovery-two-texture-tier-on.md` §6 (the numbered
queue). This session worked queue #1 (slow-wind visibility), #2 (drift), #3 (the mid tier — which
became the night's centerpiece), plus three live-found client roots. **The user drove this session
live**; their observations located every root. Commits `ee9e3b09` → `b56bece8` on dev.

## 0. THE DECISIVE INSIGHT (read this before any wind rendering work)

The fine-box "square" on screen is not merely a data boundary — **it is the only render path that
draws wind correctly**. The vortex R-gate and full detail live in the fine-overlay branch; the
base pass draws whatever the base texture holds (10° cells historically) with none of it. The
user watched fixes widen requests into world-manifest territory and reported, precisely: "the
clamp is gone, but now so is the vortex." Widening had starved the overlay slot. The product
contract that ends the whack-a-mole: **the overlay-quality field must be GLOBAL** — a fixed-
resolution world product as the BASE (the Windy / earth.nullschool pattern), with viewport boxes
only ever SHARPENING on top. That is what shipped.

## 1. Queue #1 — slow-wind visibility v3.22 (`ee9e3b09`)

Dark baseAlpha 0.28→0.44 + ramp 7→5 kn, light 0.35→0.42, beach stops-only; 0/3/6 kn stops
re-derived AT the new alphas (recovered from the killed design-agent's scratchpad —
`final_refine.js`; check dead agents' scratchpads before redoing their work). Composite gaps
≥18° below 10 kn; visibility floors pinned at the NEW levels; source-level VALUE pins in
windFieldLut.test.js (the shader can no longer drift from the JS mirrors silently). Kill:
`__RAW_DISABLE_WIND_CALM_ALPHA_V3__` → u_calm_alpha_kill restores the 07-19 set in field AND
casing. Verified: suite 1287/1287 ×3 · GLSL-interpreter forensics (both kill states, both
shaders agree) · byte-LUT quantization ≤0.71° gap loss · real-Gulf distribution p10 visD dark
14.0→32.0 (+129%), ≥30 share 72%→96%. Queue #2 drift fixes folded in (probe_wind_composite
rewritten to the live model; stale comments corrected).

## 2. The wide dynamic band (`b7f261bd`, pad `6a460ad8`)

Backend: wind-scoped manifest cut 15.0 → `WIND_DYNAMIC_MAX_SPAN_DEG` (default 100; revert=15).
choose_adaptive_resolution prices any span at ~400 points (16°→1.0° cells, 40→2.0, 90→5.0).
ICON-wind horizon guard preserved; marine 15.0 untouched. Client: spans 13–180° request the
padded snapped viewport (proportional pad ~8%, 1–4°, integer lattice); >180/antimeridian keep
global. Kill `__RAW_DISABLE_WIND_FINE_WIDE__`; tune `__RAW_WIND_FINE_WIDE_MAX__`. Graceful on
deploy skew BOTH directions. pytest 9/9 gate-first; shield enumerates 0.5–180° with cover+gate
invariants.

## 3. Queue #3 — wind global_mid (`34b17843`, trigger `b56bece8`) — THE STRUCTURAL FIX

- Cron job `ingest_gfs_wind_global_mid_impl` (wind_ingestion.py): GFS ~2° world product,
  NOAA-direct primary (quota-free — this tier can NEVER rate-limit), region_id `global_mid`,
  horizon mirrors the coarse sibling. Kill `GFS_WIND_MID_RES_INGEST=0`. Registered in
  scheduler/forecast.py's core jobs (runs on the decoupled GH Actions ingest workflow).
- mid_res_tier.py wind branch: serves the mid CLIPPED at any span AND **WHOLE for world-span
  requests** (`WIND_MID_RES_MAX_SPAN` default 400) — the client's global base fetch becomes
  ~15k vectors of 2° field instead of 629×10°. Replace-guard: never replaces regional/finer.
  Kill `WIND_MID_RES_TIER=0`; marine branch + kills fully independent (enumerated 31/31 with
  the marine pins).
- Manual seed: `POST /api/weather/ingest_gfs_wind_global_mid_direct` (admin JWT). The localhost
  dev session carries a MOCK token — prod triggering needs a real admin login or the workflow:
  `gh workflow run "Forecast Ingestion (decoupled)" --ref dev` (dispatched this session, run
  29718695874; watch `coordinate_count > 5000` on a world-span /grid probe = mid live).
- ICON/EURO mid siblings: NOT yet built — follow once GFS is deploy-proven.

## 4. Three client roots (all in `34b17843`) — found by live console forensics

1. **Mutual-abort livelock** (WeatherEngine attemptFetch): FOUR schedulers (base-lane retries,
   late-arrival re-drives, 5-min refresh, moveend/gesture kicks) shared ONE abort controller;
   each entry aborted a sibling's fetch, and the abort surfaced as a SAFE-ZERO grid (the
   redirect chain converts abort errors to zero-grids — defeating the AbortError silencer),
   which walked the retry ladder and aborted the next attempt: "attempt 9/5" + "signal is
   aborted without reason" storms while the backend was healthy. FIX: supersession token
   (`windFetchGen`) — superseded attempts die silently (no commit, no reschedule).
2. **Stranded in-flight dedup** (backendWindServiceClient): the URL-keyed dedup returned a
   promise bound to its CREATOR's abort signal — the wind edition of the marine stranded
   fetch-lock wedge (2026-06-24). FIX: entries store their signal; dead entries drop + refetch;
   finally deletes only its own entry.
3. **Stale-covering upgrade needs BOTH guards**: coverage-fraction (a sharp box holds only while
   covering ≥70% of the viewport) AND resolution (a coarser stale cover never replaces a finer
   resident over the viewport centre). The first version without the fraction rule erased a live
   tropical system's top; without the resolution rule it erased the whole system.

Also: engine NO-OP COMMIT GUARD (`4fb4af65`) — React Scan measured 41 ms React vs 235.9 ms
"other time" during FPS-drops; the moveend churn re-committed the identical cached product
(texture re-upload + reseed ×5). Identity = metadata + truthTag product + 5-point content
sample (a new run behind identical metadata still commits). Kill `__RAW_DISABLE_WIND_COMMIT_NOOP__`.

## 5. OPS roots (cost hours — bank these)

- **Poisoned webpack persistent cache**: craco dev "Compiled successfully" while serving a
  BYTE-IDENTICAL bundle across an evening of edits (cache snapshots; suspected midnight clock
  rollover). Detection: VERIFY-BUNDLE-FIRST (grep the served bundle for a just-added token
  before ANY live conclusion). Fix: delete `frontend/node_modules/.cache`, restart.
- **Orphan dev servers** from ended Claude sessions squat 3009/3011 serving stale code — check
  `Get-NetTCPConnection` + process start times; kill before starting yours.
- **HMR of engine/coverage modules remounts the map and dumps resident wind textures** — every
  mid-session edit visually "breaks" the live tab (three separate user reports traced to this).
  Batch edits; hard-reload after; never diagnose from a tab that just took an HMR hit.
- open-meteo wind rate-limit windows RECURRED all night (60–120 s negative-cache per bbox, then
  heal). `native_recovery: "none"` on every observation — cooldown vs env unresolved; check
  `[Wind Native Recovery]` in Render logs (queue #6 deploy-watch, still open).

## 6. STATE AT SAVE + NEXT

Suite 1296/1296 (multiple runs) · backend mid+gate 31/31 · shield 0.5–180°. IN FLIGHT: GH
ingest run 29718695874 (seeds the 2° world product; watcher `b49ng6roc`) · 3-theme zoom-series
probe on :3011 (`bhbnmmw77`). NEXT, in order: (1) confirm world-span serves 15k vectors →
reload tab → NO square at any zoom, worldwide; (2) full probe battery (zoomburst ALONE +
3-model sweep + eyes); (3) ICON/EURO mid siblings; (4) full backend sweep (was interrupted);
(5) React Scan re-check post-no-op-guard; (6) native-recovery Render-log verification.
