# Weather Simulation System — Full Audit & Report (2026-07-03)

Scope: the complete marine/weather pipeline front-to-back — cron ingestion → Supabase L2 →
Render serve-only backend → frontend fetch/cache/commit pipeline → WebGL GPU rendering —
audited against the runbooks, system-brain docs, session memory, and industry practice
(Mapbox webgl-wind lineage, Windy/earth.nullschool patterns, MapTiler weather tiles).
All claims below were verified by forensics (live probes, FBO texture reads, pinned-model
discriminators, synthetic-grid A/B), not by reading code alone. dev = `bb7d5da3`.

---

## 1. Executive summary

The system is in the best verified state it has ever been. Every open item from the night-2
handoff is closed. Seventeen commits shipped on 2026-07-03 (7 morning/day + 10 afternoon),
each with tests and a live verification. Suites: backend 476/476, frontend 508/508.

The day's defining finding: **the direction pipeline is now honest end-to-end** — the R_d-gated
coarse direction field was verified against its own source (pinned `ncep_gfswave025`
discriminator + R_d block probes), the per-cell confidence export rides the product, and the
renderer fades exactly the cells whose direction has no stable truth ((20,−120) reads
conf 0.2267 and renders dim; (20,−110) reads 0.9987 and renders full). "Show nothing
confidently wrong" is now implemented at data level, serving level, and render level.

## 2. Shipped today (all dev, all live-verified)

| Commit | What | Verification |
|---|---|---|
| `7d3b8a71` | Gulf/Texas /point: degraded coarse → direct 0.25° point | Galveston cm-parity vs pinned GFS (0.28m@156 exact) |
| `494b9484` | §0B-a confidence export (backend) | product carries `dir_confidence`; (20,−120)=0.242 |
| `2107f39c` | orchestrator layer-switch dedups state-authoritative | live toggle storm; z9 coarse→regional re-sharpen |
| `b6b9b5c2` | heatmap +20% low-range contrast (3 themes, surf-mode byte-identical) | dark/light/beach + mobile 375×812 DPR2, 30-31 FPS |
| `1402b91f` | zoom-band crest self-contrast (z3.5–4.4) | A/B kill-switch screenshots; band ramp measured 0/0.6/1/0.5/0/0 |
| `d61f7209` | confidence consumption: mapper + encoder scaling | synthetic grid → FBO read \|waveVec\| 1.0 vs 0.106 |
| `56c63dbf` | coarse-smear + inland-zero /point classes | Oman 3.07→0.8 direct; Kansas zeros→"--"; Tonkin 0.47→1.82 |
| `194fd1e8` | conform mirror carried dir_confidence (the last stripper) | real product: scaledCells 366, Baja band visibly dimmer |
| `8ff9dc79` | surf-mode boot pin + mode-keyed caches/held frames | boot with persisted surf=true pins flag pre-fetch |
| `bb7d5da3` | stranded fetch-pending stamp + phantom inflight entry | toggle storm: 6/6 complete, active=[], pending=null |

Morning session (same day): gate rebuild VERIFIED (freeze lifted), satellite black patches
investigated to ground truth (not reproducible; 2-min triage protocol in memory), Baja SSW
motion confirmed CORRECT, global u/v-vs-direction scan 0 mismatches/367 cells, 30-point
worldwide gulf/bay /point sweep.

## 3. Second-pass review of today's work — residuals found

1. **Toggle-mid-fetch cache labeling (narrow race, accepted):** the surf-mode cache marker is
   read at cache-SET time; a fetch started pre-toggle that lands post-toggle caches a plain
   product under the surf key (or vice versa). Bounded: the toggle's forced refetch overwrites
   the same key within seconds and the TTL caps exposure. The complete fix is the "mode into
   frame identity" design (grid carries its own surf marker end-to-end) — queued, not urgent.
2. **`scaledCells` telemetry counts any conf < 1.0** (366 of 367 cells) — correct but noisy;
   the meaningful signal is `min` and the <0.65 population (41 cells on the 14:46Z product).
   Cosmetic; left as-is.
3. **Re-drive driver (formerly 3Hz):** root-caused by analysis to the SWR-revalidation
   reschedule cycling against dup-skipped commits. The state-authoritative dedup terminates
   the loop after one commit and `bb7d5da3` removes the wedge state it fed on. SWR scheduling
   deliberately untouched (regression risk > residual value). Watch item only.

## 4. Front-to-back health assessment

**Ingestion (GitHub-Action cron, sha-stamped):** healthy. NOAA/DWD/Copernicus direct fetchers;
R_d-gated two-tier direction with confidence export; kill switches per source and per feature
(`NOAA_COARSE_DIR_{BLOCKMEAN,TOTAL_FIELD,CONFIDENCE}`). Known operational quirk: ~3h runs can
be cancelled by the next slot; early valid-hours upload progressively (a cancelled run can
still refresh near-term products — this masked the gate-rebuild state this morning and is now
documented in memory).

**L2 (Supabase) + serving (Render, serve-only):** healthy. The 9-step grid resolver ladder
verified live (Gulf-of-Oman viewport product materialized on the 2nd fetch with exact pinned
parity). /point ladder now: strict grid product → dynamic viewport → manifest (honest
`inside_global_coarse` labeling; degraded/masked-bilinear coarse marine samples fall through
to the direct 0.25° point; null-height upstreams can never fabricate zeros; fail-open stash).
Structural note: `point_resolution.py` was split at the 800-LOC hook limit (wind/scalar
direct-point builders → `point_direct_fallbacks.py`).

**Frontend data pipeline:** the highest-entropy part of the system, and where every mixing bug
of the past week has lived. Audit finding worth stating plainly: **there are at least five
vector-shape transforms between the wire and the GPU** (backend flat GridVector → series
frames → mapNormalizedGridToWebGL conjoined → per-model-hour/held caches →
useMarineWindData conform → encoder). Two of them re-emit vectors with explicit field lists,
which is how `is_valid` (night-1) and `dir_confidence` (today) were silently dropped. All
current fields now flow, with the encoder reading all four shape variants defensively.

**GPU rendering:** healthy and now confidence-aware. Advect/draw seam machinery (dim-not-kill,
drift damping), per-polygon mask culling, dilation + validity gating, constant-density
particles, zoom-band self-contrast, theme-aware ramps with a JS mirror kept in sync.
Perf: 30–31 FPS with ~1650 on-screen crests on desktop AND a 375×812 DPR2 mobile viewport.

## 5. Docs vs reality (drift found)

- `frontend/system-brain/weather-simulation-system.md` (self-described "source of truth"):
  last touched **2026-06-02** — a month stale. It documents the FCE/RenderPlanDispatcher
  marine path, which has been DISABLED for marine since ~2026-06-30 (marine renders via
  orchestrator → WebGLMarineLayer → WebGLMarineEngine). Anyone onboarding from this doc will
  debug the wrong pipeline (this exact trap cost time in the satellite investigation — the
  handoff pointed at FCE globals for a maplibre-raster layer).
- `docs/runbooks/*` handoffs are accurate but episodic; the durable truths live in the session
  memory index, which is current.
- **Recommendation:** rewrite `weather-simulation-system.md`'s architecture map to the current
  orchestrator/engine reality (or stamp it DEPRECATED with a pointer). One page would do.

## 6. Industry comparison (webgl-wind / Windy / nullschool / MapTiler lineage)

Where this system already matches or exceeds common practice: GPU particle state textures with
off-screen advection (the standard mapbox/webgl-wind architecture), fixed on-screen particle
density across zoom (flow-viz best practice), direction-coherence handling (no equivalent seen
in the public implementations — most render confidently-wrong directions in divergence zones),
per-cell model-confidence fade (novel relative to the public art), theme-aware perceptual
ramps, and land masking at the encoder level with per-polygon culling.

Upgrade candidates borrowed from that lineage, prioritized:

1. **Pre-encoded data tiles (PNG/RGBA or the existing om-protocol) for the marine field**
   instead of JSON vectors — the wire format is the system's heaviest artifact (629-cell coarse
   is fine, but regional/viewport JSON grids are ~100s of KB and parse on the main thread).
   The wind raster path already uses encoded tiles; marine parity would cut fetch+commit cost.
   Medium effort, high payoff on the 1-CPU backend.
2. **Time interpolation between hourly frames** (nullschool/Windy pattern): the scrubber
   currently swaps discrete hourly textures; a two-texture mix uniform (t between hour N and
   N+1) would make playback continuous for near-zero GPU cost. The two-slot texture plumbing
   already exists in the raster slots; the marine engine would need a second resident texture.
3. **Speed-tinted particles** (option, taste): crest color already encodes energy; industry
   often tints by speed. Current design reads better for surf semantics — recommend NO change,
   noted for completeness.
4. **prefers-reduced-motion support**: pause/damp particle advection for that media query —
   small accessibility win, trivial effort.
5. **OffscreenCanvas/worker rendering** is NOT recommended now: MapLibre custom-layer
   integration is the constraint and the FPS budget is already met.

## 7. Watch items (nothing blocking)

- First user eyeballs on: Baja/4-corner seam at z5, close-zoom crest roam (per handoff §3.4).
- Confidence-fade user acceptance in the 41-cell Southern-Ocean population (heatmap untouched
  by design; only crests dim).
- Satellite black patches: unreproducible; 2-min triage protocol ready on recurrence.
- The smear-class /point fix trades zoomed-out infobox-vs-heatmap smear-parity for point truth
  (matches what zoom-in shows). If a user reports "pin disagrees with the coarse paint," that
  is this decision working as intended — the paint is the smear.
- Netlify prod (`main`) remains ~600+ commits behind dev; release checklist unchanged
  (bundle-hash verification first).
