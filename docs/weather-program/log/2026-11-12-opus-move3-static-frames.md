# 2026-11-12: Opus, move 3: every marine layer and model scrubs from static frames and the resident frame store

Session: move 3 of the advisor's state-of-the-art gap map (`log/2026-11-12-advisor-sota-gap-map.md` on
`advisor/sota-gap-map-2026-11-11`, draft #787), approved by the owner on 2026-11-11 with his added requirement "All layers should be
instant frames". Branches `opus/move3-static-frames-every-layer` (client) and `opus/rated-frames-step-unset-var` (workflow), both cut
from `origin/dev` `a7c41dd2a`. Offline only: no live replay, no Render, no storage write, no env or flag change, no merge.

## 05:00Z Recorded state, verified at its source

| Claim | Source, as read | Holds |
|---|---|---|
| Target step p50 <= 50 ms, p95 <= 100 ms | `frontend/src/components/map/instantTelemetry.js:4-5` ("Tap/step p50 <= 50 ms and p95 <= 100 ms; fail > 200 ms") | yes |
| Waves with frames resident step at p50 2 / p95 16 ms on desktop | `DECISIONS.md:1564` (D-048: "steps p50 2 / p95 16 / max 17 ms, 0 backend requests") | yes, for GFS waves on a 3g-read desktop |
| Static frames ~55 KB vs 2.35 MB JSON | `STATE.md:20` ("~55 KB vs 2.35 MB /grid JSON") | yes |
| A 48-frame `/grid_series` page costs 10-13 s of box CPU | `DECISIONS.md:178` ("three 48-frame pages, 10-13 s of box CPU each") | yes |
| `/grid_series` p95 10 s, p99 93 s | `STATE.md:27` | yes (2026-10-19 reading) |
| Model clicks at z4.2 p95 515-599 ms | `REGRESSION-MATRIX.md:116` ("13/599, 8/515 ms") | yes |
| OOM kills 2026-11-07 and 2026-11-09 | `log/2026-11-07-claude-marine-hold-on-error.md:3` (22:25:19Z, 2Gi); `log/2026-11-09-codex-backend-memory-bounds.md:7` (12:28:41Z) | yes (the second 11-09 kill not re-found) |
| The GPU frame store is waves-only | `marineFramePack.js:106` (`layer !== 'waves'` returns null), `staticFrames.js:364` (`getPinnedIndexSync`), and a third gate, `staticWorldFillGuard.js:80` (`filledStoreAccepts`) | yes, three gates |

## 05:20Z Inventory: what a scrub step reads today (dev `a7c41dd2a`), per layer, model and zoom tier

Publisher: `backend/scripts/publish_frame_images.py` (run by `forecast-ingest-pilots.yml`, step "Publish static forecast frames",
budget `FRAME_PUBLISH_BUDGET_S` 960 s in production), sets from `services/frame_set.py` `SETS` (world), `frame_set_fill.FILLED_SETS`
(EURO/ICON world with /grid's targeted Gulf fill), `frame_set.EURO_SWELL_SETS` (D-059), `frame_set_bundle.REGIONAL_SETS` (0.25 deg
pilot boxes) and, in its own step, `frame_set_rating` (the band). Client: `staticFrames.js` `STATIC_SETS` (what it reads), seam A
(`tryStaticWorldGrid`, the /grid JSON rebuilt from a frame), seam B (series pages from frames), and the GPU frame store
(`marineFrameStoreRuntime.js`, `marineFramePack.js`, `marineFrameStore.js`). "store" = the packed frame copied to the GPU on the step
(no JS objects, ~5-20 ms); "static" = the frame fetched from the CDN and rebuilt as ~15k vectors then encoded (no box, ~150-260 ms);
"box" = `/grid` or `/grid_series` on the Render box.

| Layer | Model | World (z <= ~4, 2 deg) | Mid zoom (z ~4.5-6, crop of 2 deg) | Regional (z7-9 in a pilot box, 0.25 deg) | Store before |
|---|---|---|---|---|---|
| waves | GFS | published; read; **store** | crop of plain set; **store** (crop show) | bundle published (20 boxes); store crop show | yes |
| waves | ICON | filled set published (targeted); read; **store** | plain-set crop; **store** | bundle (14 boxes); store crop show | yes |
| waves | EURO | filled set published; read; **store** | plain-set crop; **store** | bundle (14 boxes); store crop show | yes |
| swell_1, swell_2, wind_waves | GFS | published; read; **static** (seam A/B, vectors) | crop; **static** | bundles published; static (no store: `getPinnedRegionalIndexSync` waves only) | **no** |
| swell_1, wind_waves | ICON | plain + filled published; read; **static** | crop; **static** | bundles published; static | **no** |
| swell_2 | ICON | no product: client blend of GFS + EURO swell_2 (`iconSwell2Blend.js`) | blend | blend | no |
| swell_1, swell_2, wind_waves | EURO | plain + filled published since D-059 **but not read**: `STATIC_SETS` never listed them, so **box** | **box** | no EURO swell bundles: **box** | **no** |
| wind | GFS | published (`GFS/wind/wind/global_mid`); its own static engine (`windStaticFrames.js`, `windStaticEngine.js`) | crop | none | own engine |
| wind | ICON, EURO | **not published: box** | box | box | no |
| Surf Rating band | all | rated sets coded (D-057, "ON") but **the CI step is skipped on every run** (below), so clients miss and ask `/grid?surf=1`: **box** | box | box | no |
| pressure, air temp, satellite, precip, fog, water temp | (provider) | client-decoded Open-Meteo map tiles (`openMeteoProtocol.js`); own GFS/EURO/ICON raster frames exist behind the dark `__RAW_RASTER_OWN_FRAMES__` | same | same | n/a: never the box |
| radar | (provider) | RainViewer tiles (`radarForecastSources.js`) | same | same | n/a: never the box |

### Production publish, read from the workflow record (`gh run view`, read-only)

- The frames step takes 15-18 min every pilots run (four runs 2026-11-11/12: 17.8, 17.5, 17.0, 15.4 min) against its 960 s budget
  and 22-min timeout. Run 43081907418 (2026-11-11 18:52Z) skipped **all six EURO swell sets** and 22 regional sets at the budget
  ("skipped, the run is past its 960 s budget (the published index stays)"). A skipped set keeps its older index, so a client still
  gets frames, but from an older run until a later run reaches it.
- **The rated band step has not run.** `if: ${{ ... && vars.FRAME_RATING_SETS != '0' }}` with the variable unset: GitHub compares
  null and '0' as numbers (0 == 0), so the condition is false. Every sampled run from 2026-11-05 to 2026-11-12 reads `skipped`. Same
  bare pattern, same effect: `FRAME_RASTER_PRESSURE` (pilots) and `SPOT_SERIES_PUBLISH` (`spot-series.yml`, its 3 newest runs
  `skipped`). Fixed for the band only, in its own PR (turning the other two on is the owner's call).

## 06:00Z Two client gaps closed (branch `opus/move3-static-frames-every-layer`, ON, kill switches)

1. **The GPU frame store takes every marine layer.** Three gates kept it to waves: `marineFramePack.packStaticFrame`,
   `staticFrames.getPinnedIndexSync` and `staticWorldFillGuard.filledStoreAccepts`. Measured first (a scratch Jest run, then kept as
   `marineFramePack.parity.test.js` "every marine layer"): with the gate lifted, the waves packer's bytes equal the real encoder's for
   swell_1, swell_2 and wind_waves on both static lanes, **84/84 cases** (4 frames incl. one real GFS world frame x 7 theme and
   kill-switch settings x 3 layers), and each layer's own chl/bath bytes equal both lanes'. All three gates now read
   `marineFramePack.packableLayer`. Kill `window.__RAW_DISABLE_FRAME_STORE_ALL_LAYERS__ = true` (waves only again; also closes under
   #456's own kills `__RAW_DISABLE_CONFORM_IS_VALID__` / `__RAW_DISABLE_STATIC_SERIES_ALL_SETS__`); the pack signature carries the
   scope, so a kill retires every held set at once. Mutant (the gate back to `layer !== 'waves'`): 91 tests red.
2. **The EURO swell world sets are read.** `staticEuroSwellSets.js` lists the six keys the publisher writes since D-059 (plain + filled
   x swell_1 / swell_2 / wind_waves) under the EURO waves rules (the filled world set only while server, record and index agree on
   the targeted mode; the plain set as the mid-zoom crop source). Kill `window.__RAW_DISABLE_STATIC_EURO_SWELL__ = true`.

**Memory bound (unchanged by design).** The store's budgets are fixed per device tier (`marineFrameStore.TIERS`): desktop 64 MiB GPU /
48 MiB CPU, handheld 16 / 12 MiB (CPU bytes dropped once resident), constrained 8 / 6 MiB, WebGL1 8 / 12 MiB. Eviction is LRU by SET
(never the active set), then LRU frames of the active set, never the cursor's neighbours. One world frame packs to ~59 KB
(179 x 83 x 4 after the dead-edge trim); a full GFS run (115 frames) is ~6.8 MB CPU and one 128-layer texture array (~7.6 MB GPU).
So per layer: desktop holds ~8 whole runs of any mix of layers and models at once; a phone holds ~2 arrays (the active layer's run
and one other) and evicts the least recently viewed set first. More layers do not raise the ceiling; they compete for it.

**Harness and lab.** `scn_instant_contract.js` gains the Swell 2 chip. `serve_synthetic.py` gains `--euro-mid-swell 1` (production stores
EURO swell at global_mid since D-059). Lesson for the lab: run the publisher with `MARINE_GULF_FILL_MID_TARGETED=1` and the backend
with the same, as production does (repo variable since 2026-10-26); the default (legacy) publishes no filled set, and then every
EURO/ICON world step reads 1.4-5.0 s from `/grid` (my first BEFORE run, discarded: it measured a world production is not in).

## 06:50Z BEFORE and AFTER, offline

Instrument: `scn_instant_contract.js` (fresh headless Chrome per layer x start model x zoom; the default 15-action PLAN of arrows,
PageUp, far jumps, a 12-press drag and two model switches; time from the press to the exact (model, layer, hour) product on the GPU),
dark theme, desktop 1280 x 800, zooms 2 and 4.6, center (-75, 30). Backend: `serve_synthetic.py --models GFS,ICON,EURO --layers
waves,swell_1,swell_2,wind_waves --land-mask 1 --dynamic 1 --euro-mid-swell 1` with `MARINE_GULF_FILL_MID=1
MARINE_GULF_FILL_MID_TARGETED=1`; CDN: the real publisher's offline output of that store (17 world sets, every one parity_bad 0).
BEFORE = `dev` `a7c41dd2a` (bundle main.0ea76288.js); AFTER = this branch (main.fc836fc8.js); same store, CDN, backend process, machine,
run back to back. n = one run per arm (24 sessions each); a "step" is every non-switch action, "toggle" is a model switch (M).

| Layer | Model | BEFORE step p50 / p95 ms | AFTER step p50 / p95 ms | BEFORE toggle p50 / max | AFTER toggle p50 / max | AFTER p95 <= 100 |
|---|---|---|---|---|---|---|
| waves | GFS | 13 / 42 | 9 / 61 | 91 / 204 | 74 / 79 | yes |
| waves | EURO | 8 / 41 | 11 / 61 | 160 / 191 | 189 / 189 | yes |
| waves | ICON | 10 / 161 | 10 / 97 | - | - | yes (n 11) |
| swell_1 | GFS | 168 / 262 | 12 / 61 | 690 / 739 | 122 / 123 | **yes** |
| swell_1 | EURO | 965 / 3469 | 10 / 62 | 1457 / 1670 | 91 / 128 | **yes** |
| swell_1 | ICON | 171 / 347 | 8 / 141 | - | - | no (one 141 ms far jump, n 11) |
| swell_2 | GFS | 166 / 334 | 8 / 51 | 637 / 745 | 153 / 155 | **yes** |
| swell_2 | EURO | 656 / 3159 | 9 / 1464 | 1996 / 2056 | 116 / 141 | no: the hour-336 jump (estimated tail) |
| swell_2 | ICON (client blend) | 1607 / 2843 | 308 / 2222 | 4905 / 5791 | 1043 / 1086 | no: the blend path |
| wind_waves | GFS | 176 / 232 | 8 / 270 | 626 / 638 | 139 / 189 | no: first far jumps (270, 468 ms) |
| wind_waves | EURO | 910 / 3455 | 16 / 2053 | 1451 / 1460 | 174 / 174 | no: the hour-336 jump (estimated tail) |
| wind_waves | ICON | 178 / 274 | 10 / 157 | - | - | no (n 16) |

All layers pooled: steps p50 waves 10 -> 10, swell_1 193 -> 10, swell_2 428 -> 13, wind_waves 210 -> 11 ms; p95 42 -> 61, 2188 -> 62,
2843 -> 1686, 2062 -> 855 ms. Box work during each run (the backend's `[Grid Route] Mid-res tier: serving global_mid` lines, one per
world/mid grid it builds): **1,557 -> 596**; the EURO swell sets alone **1,096 -> 199**, and those 199 are almost all `[estimated mirror
hour]`. GFS/ICON sets read the same in both runs (38-59 each, the boot-time series pages), so their step gain is the store, not the box.

Misses (an action never reached its exact frame inside the 6 s window) are the same in both arms (ICON-start sessions 19/30, the
harness's own note: a series-page frame carries no product id and is never called exact); they are excluded from the percentiles.

### What is still slow, and why (not fixed here)

- **EURO estimated tail hours (h > 240).** The client still asks the box for an estimated EURO hour (`[estimated mirror hour]` builds)
  although its frame is published (index: 115 frames, 0 unbuilt, 35 estimated). One far jump to h336 costs 0.9-2.1 s. Next: find why
  the estimated hour leaves the static path (likely the estimate-provenance rule for estimated hours), then let it read the frame.
- **ICON swell_2** has no product; it is a client blend of GFS and EURO swell_2 (`iconSwell2Blend.js`), drawn on the `grid` lane each
  step (150-620 ms; 1.7-2.8 s at h336). Frames cannot help while the blend runs per step; options are a published blended set or a
  packed blend in the store.
- **First far jumps before the idle fill reaches them** (GFS wind_waves h336 270-468 ms) draw from the static vector path once.
- **Regional (z7-9) bundles stay out of the store for non-waves layers** (`getPinnedRegionalIndexSync` keeps waves only); not
  measured here (the lab store has no regional products in this run).
- **Wind for ICON and EURO, and the Surf Rating band** are not covered by these two changes (no published ICON/EURO wind sets; the
  band's CI step never ran: the separate PR fixes its condition).

## 07:15Z Accuracy addendum (the advisor's five notes)

**Labels for every number above.** OFFLINE only: one desktop PC (Windows 11), headless system Chrome, 1280 x 800 at dpr 1, dark theme,
center (-75, 30), zooms 2 and 4.6, harness `scn_instant_contract.js` against `serve_synthetic.py` (synthetic data, real backend code).
Each session is a fresh browser (cold page load, empty frame store); the layer is turned on and settles 6 s, then the 15-action plan
runs, so the first actions are cold-ish (store filling) and later ones warm. Before and after use the same plan, so they compare
like with like; neither is a warm-only number. n per layer x model = 11-25 steps and 0-4 toggles from one run per arm. These do not
prove live latency: the box, the CDN edge and real networks were not involved. **The real-user timing feed (`instant_rum`) has never
been read** (its read-back was due 2026-10-30); no live reading backs any number here.

**Corrections to the gap map (`log/2026-11-12-advisor-sota-gap-map.md` section 3), from current code at dev `a7c41dd2a`:**
- "The GPU frame store is waves-only": TRUE at dev (three gates, quoted above), though much of the instant work it predates had merged:
  #456 GPU-resident frames, #459 mid-zoom crops, #535 regional frames, #575 filled EURO/ICON world sets, #601 EURO/ICON mid-zoom
  crops. Waves was already instant offline for all three models (p95 41-161 ms before this change).
- GFS and ICON swell layers were NOT on the box before this change: they already read static frames (seam A/B), at 150-350 ms a step
  offline. The box was involved for EURO swell (never listed client-side), estimated EURO hours, and the band (CI step never ran).
- "EURO model toggle 1.0-1.3 s": for EURO waves, already ~160-190 ms offline before this change (#575); for EURO swell, 1.4-2.1 s
  before, 91-174 ms after.

**David's requirement, "All layers should be instant frames": every layer, offline, after #802 (+ #803 for the band).**

| Layer | GFS | EURO | ICON | Why not, where not |
|---|---|---|---|---|
| waves | meets | meets | meets | - |
| swell_1 | meets | meets | no (one 141 ms far jump) | first far jump before the fill reaches it |
| swell_2 | meets | no | no | EURO: estimated hours > 240 still ask the box (fixable client-side; next). ICON: no product, client blend per step: needs a published blend set (publisher change) or a packed blend in the store |
| wind_waves | no (first far jumps 270-468) | no (estimated tail) | no (157-239) | fill timing; EURO estimated tail as above |
| wind | GFS has its own static engine (#468); not re-measured here | no frames published | no frames published | needs EURO/ICON wind sets in the publisher; adds ingest minutes to a step already over budget (below) |
| Surf Rating band | box until #803 merges and a run publishes | same | same | CI condition bug (#803); not re-measured |
| regional z7-9, non-waves layers | static, not store | EURO swell: no bundles | static | `getPinnedRegionalIndexSync` waves only; not measured |
| pressure, temperature, satellite, precip, fog, water temp, radar | third-party tiles, never our box | same | same | not measured; own frames exist but are dark |

None of the gaps found needs a Codex-reserved file, a bigger box or a tier-contract change. The one constraint that is structural:
**the publish step is already over its budget** (15-18 min against 960 s; a run skipped all six EURO swell sets). Every added set
(ICON swell_2 blend, EURO/ICON wind) competes for the same ~16 min. A second step with its own budget, or a parallel job, is needed
before more sets are added.

**Cost per ingest cycle (pilots run, about every 4 h):**
- #802: **0 added bytes and 0 added ingest minutes**: it reads sets that are already published. Client egress per viewer changes: a
  desktop that scrubs a swell layer now prefetches that run (~6.8 MB of frames for 115 frames) instead of fetching ~150-250 KB vectors
  per step from the CDN, the same policy waves has had since D-048.
- #803: the rated band step, up to 600 s of runner time per run (its own budget), ~16 KB a frame, 1.6-1.8 MB per set per run
  (`log/2026-11-01-claude-rating-frames.md`); the bucket keeps the current and previous index, so about twice that is resident.
- For reference, the EURO swell sets already cost ~6.6 MB uploaded per cycle when a run reaches them (offline: 1.23 + 0.22 + 0.74 MB
  plain, the same again filled) and ~507 s of publish time on this PC.

**Phone memory bound:** handheld tier 16 MiB GPU / 12 MiB CPU (`marineFrameStore.TIERS`), CPU bytes dropped once resident: about two
whole runs resident (one 128-layer array is ~7.6 MB), LRU by set; the constrained tier (<= 2 GB RAM, Save-Data, 2g) 8 / 6 MiB.
Phones fill on demand only (no idle fill). Not measured on a phone.
