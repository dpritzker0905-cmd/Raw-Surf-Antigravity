# HANDOFF 2026-07-18 NIGHT — tides shipped · fencepost ROUND 2 · per-chain lineage · the 1000-spot cap

**Fresh context: read this + memory `session-2026-07-18-night-tides-and-fencepost2` first.**
Six ships on `dev`, HEAD `11714c90`. All forensically pinned, tested (units + live), pushed.

## 1. Shipped
| Commit | What | Kill |
|---|---|---|
| `6471a7ec` | **TIDES ARC (SOTA gap #1)** — RATING_TIDE=1 in both cron workflows + render.yaml; batched tide-cache prewarm (~10 req/run for ~1500 spots); frontend tide line on the spot rating card (rides the RATING toggle — user decision, no standalone pill), ft/m-aware, aria text equivalent; payload-first with client-side Open-Meteo fallback per 0.1° cell | env `RATING_TIDE=0` · `__RAW_DISABLE_TIDE_FALLBACK__` |
| `de03ac57` | #14: `seriesFrameMint` start stage — mini/series commits register their chain at mint | `__RAW_DISABLE_SERIES_MINT_STAGE__` |
| `dc1e74a7` | **1000-SPOT CAP** — PostgREST max-rows silently capped 1516 active spots to 1000; ~516 spots NEVER precomputed. Offset pagination w/ stable order | revert |
| `951bba42` | **FENCEPOST ROUND 2** — five sibling `_coarse_axis` copies (NOAA wind/pressure, ICON wind, GWAM, Copernicus global) + shared `_fetch_common.coarse_axis` (ECMWF/EURO all layers + ICON pressure) were still half-open ⇒ dead east col + north row in EVERY direct-source lane except GFS waves. One inclusive truth; siblings delegate | revert |
| `0fe8a888` | #14 round 2: truth lineage is **per-CHAIN** (traceId) — battery proved same-product chains legitimately interleave (held-grid re-uploads); cross-chain compare was the remaining false-MISMATCH source. Tampered-hash detection intact | revert |
| `11714c90` | zoomlab `ZL_THEME` per-theme battery lane + `zoomlab-diff.js` (matched-notch, regime-aware trace comparison) + console capture 200→400 chars | — |

## 2. LIGHT-MODE PARTICLE VERDICT (user's observation, tool-tested)
Two staircase_full batteries (light cold, dark) + one light **warm** re-run + matched-notch diff:
- The "fat dark slugs" were **cold-supply coarse residents** (cols=3 at z12-14 on the cold run)
  masquerading as a theme problem — warm re-run rode the same cols=10 regionals as dark.
- Honest theme delta: **~1.5-1.6× animation contrast at close zoom** (spk ~2×) from the light
  palette (deep-navy calm crests on a bright field). **Size/density are NOT theme-keyed in the
  shader** (only color is) — no render bug. Palette softening = USER CALL (design change).
- The one persistent dead band (cols ~6-12, deep zoom-out leg) appears in **BOTH themes** — the
  known stripe residual, now root-addressed by fencepost round 2 (bakes must land).
- Battery hygiene: run themes SEQUENTIALLY and treat run-order as a cache-warmth confound;
  `zoomlab-diff.js` flags regime-differing buckets automatically.

## 3. WATCHERS — RESOLVED IN-SESSION (07:56-08:0xZ)
1. ✅ **FL tile HEALED**: pilots run `29633034715` (fix-carrying) completed success 07:56Z →
   per-column probe of the fresh 09Z product: east col -79.0 **29/29 valid** (was 0/29); north
   row 31.0 = 10/25 valid, the 15 invalid cells are inland Georgia (geography, not fencepost).
   NOTE: `provider: open-meteo` on NOAA-direct products is DELIBERATE label parity
   (scheduler.py §196) — do not let it mislead future forensics.
2. ✅ **Tide BAKED**: ingest run `29633827114` (RATING_TIDE-carrying) completed 07:58Z →
   latest.json (generated 07:57:45Z): GFS 977/980, EURO 1000/1000, ICON 1000/1000 withTide per
   frame. End-to-end: cold-booted map's glyph aria = "Playalinda Beach: Poor, 1.9 ft at 7
   seconds, tide -2.3 ft falling" — from the BAKED payload lane (no hover/fallback involved).
3. ✅ **CI green** through `4ee5b853` (+ Lighthouse).

## 3b. STILL OWED (small)
- **spots 1000→1516** in latest.json: needs a run carrying `dc1e74a7` (pushed 06:5xZ; the 06:20Z
  run predates it) — check the next cycle's frame spot counts.
- **Render env**: render.yaml now carries RATING_TIDE=1 — if the service is NOT Blueprint-synced,
  set it in the Render dashboard (live-lane parity).
- Other direct-source lanes (wind/pressure/ICON/GWAM/EURO) heal as their crons re-bake with
  `951bba42`+ (pushed 06:47Z); spot-check east col/north row on one wind + one EURO product.

## 4. OPEN (carried queue)
- **z8 halo — hypothesis SHARPENED (read-only forensics this session):** `coverage_gap` =
  the MID-GRID UNCOVERED REPLACE branch (`WebGLMarineEngine.js` ~1554-1594): at z8.0 the CACHED
  base mask (rebuilt viewport-scoped at deeper zoom) no longer covers the widened viewport →
  `_mbCov=false` → overlay REPLACES, and the overlay's 50%-padded ring is water-flooded past its
  truth box = the halo. At z8.5 the cached mask still covers (`cov:true`). The dig: why the
  escaped-mask rebuild (`64bd1ff6`) doesn't re-scope the BASE mask on the z8.5→z8.0 escape —
  check its z-gate / escape trigger. Live telemetry already sufficient: `__RAW_GPU__.overlayMask`
  {reason, baseCoversView} while stepping z8.5→z8.0. Instrument-first; this file is the minefield.
- §5b toggle wedge (§5f-2 pinning instrument next) ·
  zoom-out transient stripe real-GPU capture lane · mini-hoist to prewarm · v3 hot-bias trim
  (USER CALL) · Peniche offshore sampling · a11y debt · security co-drive (BOLA path-param +
  buckets).
- Latent same-class REST caps: `fetch_buoy_spots_via_rest` + `fetch_recent_reports_via_rest`
  (0 rows today, no exposure; paginate when they grow).
- Windows-only pre-existing flake: `test_fetch_common.py::test_runner_*` (subprocess spawn;
  passes in isolation + Linux CI; reproduced on the unmodified tree).
- Tides UI next steps (post-bake): tide state in the point infobox + a tide curve lane in the
  timeline (handoff §3.1 of 07-18 EOD).

## 5. Session forensic lessons (standing)
- The CDN object is a cheap TRUTH INSTRUMENT: "exactly 1000 spots" fingerprinted the PostgREST cap.
- "Sibling sweep found no copies" must be re-verified with grep, not trusted — round 2 found six.
- Battery A/Bs inherit cache warmth from run ORDER — regime flags in the trace are the discriminator.
- The System Python (Program Files) is gutted; use `AppData\Local\Python\bin\python3.exe` (memory).
