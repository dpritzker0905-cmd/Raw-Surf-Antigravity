# GATE E — LIVE BROWSER VERIFICATION

**Date:** 2026-08-12, after Gate C closure.
**Scope:** projection, geography, and animation behaviour of the marine mask path carrying the
verdict cache (`e6033e2b`) — the gap Audit 11.4 recorded as **BLOCKED / not measured**.

## Rig

| | |
|---|---|
| App | `http://localhost:3007/map` (craco dev server, `frontend-preview`) |
| **Backend** | **`https://raw-surf-antigravity.onrender.com` — the DEV Render backend.** Named because local ≠ production for coverage. |
| Data | GFS waves, `gfs_marine_waves_global_mid_20260812T180000Z.json`, 181×83 grid, 15,023 vectors (10,628 nonzero) |
| Provenance (HUD) | Provider **NOAA**, source `ncep_gfswave025`, Class **AUTHORITATIVE NATIVE**, "No Causal Layer Violations Detected" |
| Viewport | DPR **2**, canvas 1794×1820, bearing 0, pitch 0 |
| Flags | `__RAW_DISABLE_SHELTER_CACHE__` unset (cache ON) · `__RAW_MASK_SETTLE_DEBOUNCE_MS__` unset (**debounce OFF**) |

⚠️ Two documented traps hit and handled: the 1002 MB webpack cache (cleared — it is above the
~851 MB "invalid table size" crash threshold) and the `MarineAnimTuner` panel occluding the weather
controls (collapsed).

### ⚠️ Which code was under measurement

The dev server compiled from the **working tree**, not from a commit. At session start that tree sat
at `fb601060` **plus a concurrent session's then-uncommitted settle-debounce work** in
`marineMaskShelter.js` — code that has since landed as `85e3f1fb` and `84c3fd60`. The verdict cache
itself was unchanged from `e6033e2b` throughout.

The debounce was **inert** for every measurement here: `__RAW_MASK_SETTLE_DEBOUNCE_MS__` was never
set, and `pendingDeferrals` read 0 at every sample.

**Residual uncertainty, stated rather than hidden:** because CRA hot-reloads, I cannot fully exclude
a module hot-swap of `marineMaskShelter.js` mid-session. What I can show is that **no page reload
occurred** — `__RAW_GPU__.shelteredCalls` increased monotonically 26 → 61 → 69 → 74 → 115 → 277
across the whole session and never reset, which a reload would have zeroed. Module state was in any
case reset deliberately between arms.

## 1. The cache is real in the live renderer

| Measurement | Result |
|---|---|
| Static viewport, cache ON | **hit 22 / miss 4 = 84.6%** (author reported 88% static) |
| Kill switch ON, 15-location sweep | **hit 0 / miss 35 = 0%** |
| Kill switch ON, single-location run | **hit 0 / miss 26** |
| Cache size | 4 — at cap, never above |
| `pendingDeferrals` | 0 throughout (debounce off) |

The 0% control arm reproduces live: **the kill switch demonstrably disables the thing being
measured.** Panning between geographies collapsed the hit rate to 4/13 and 1/10, matching the
documented "motion collapses the hit rate" finding.

## 2. Geography sweep — 15 locations, `jumpTo` for reproducibility

Mask ran at **14 of 15**. Verdicts are geographically sensible, which is itself a registration check:

| Location | span° | sheltered frac | reading |
|---|---|---|---|
| Cocoa Beach | 1.23 | 0.0081 | Banana/Indian River lagoons |
| Florida peninsula | 4.93 | 0.1002 | whole Intracoastal at basin scale |
| New York coast | 2.46 | 0.0085 | Long Island Sound / harbours |
| Portugal (Peniche) | 1.23 | 0.0075 | |
| **Morocco (Taghazout)** | 1.23 | **0** | straight open coast — correctly nothing |
| El Salvador | 1.23 | 0.0011 | |
| Island chain (Hawaii) | 2.46 | 0.0001 | |
| Bay/cove (SF Bay) | 1.23 | 0.0208 | |
| Open Atlantic / Open Pacific | 9.86 | *(refused)* | coarse tier — by design |
| High lat N (Lofoten 68°N) / S (Ushuaia 55°S) | 4.93 | *(refused at that tier)* | ran, guard-refused |

### Antimeridian — the highest-risk projection case, and it passes

| Case | reported bounds W→E | span |
|---|---|---|
| Fiji (179.9°E) | `[177.44, 182.36]` | **4.927** |
| −180 side (−179.9°) | `[-182.36, -177.44]` | **4.927** |

Bounds are expressed **continuously across 180°** (east exceeding 180 rather than wrapping to
−177), and the span computes as 4.927° — **not 355°**. That exercises the wraparound branch in
`suppressShelteredWater`:

```js
const spanLon = (bounds.east < bounds.west) ? (bounds.east + 360) - bounds.west : bounds.east - bounds.west;
```

The mask ran on both sides (5 and 1 calls). **No antimeridian discontinuity, and no spurious
refusal from a 355° span.**

## 3. ⚠️ My first metamorphic A/B was CONFOUNDED — and the tell was `nPx`

The first design compared per-location `shelteredFrac` between a cache-ON sweep and a kill-switch
sweep. It reported **8 mismatches**, including Florida peninsula 0.1002 vs 0.0065.

**That is not a cache defect, and one number proves it.** At New York the two arms reported
different **`nPx` (2 vs 1)** — and `nPx` is computed from the canvas bounds *before* any cache
lookup:

```js
const nPx = Math.max(1, Math.round((gapM / 2) / Math.max(1e-6, mPerPx)));
```

The cache cannot influence it. A differing `nPx` therefore proves the two arms **sampled different
mask canvases**, not the same canvas answered differently. The observable
(`__RAW_GPU__.shelteredWater`) is a snapshot of *whichever call ran last*, and the arms made
different numbers of calls (1–6) at different tiers. The comparison was never like-for-like.

★ **A metamorphic comparison is only valid if the thing you hold constant is actually constant.
Here it was the canvas, and it wasn't.**

## 4. Corrected like-for-like A/B — verdicts keyed by canvas signature

Redesigned: collect verdicts keyed by **`nPx:mPerPx`** (the canvas geometry signature) across 9
samples per arm while nudging the viewport, then compare only *shared* signatures.

| Location | shared signatures | cache ON | kill switch | **disagreements** |
|---|---|---|---|---|
| Cocoa Beach | 1 (`2:236`) | `[0.0081]` | `[0.0081]` | **0** |
| SF Bay | 1 (`2:212`) | `[0.0209, 0.0208, 0.0207]` | `[0.0209, 0.0208, 0.0207]` | **0** |
| New York | 0 (`1:454` vs `1:535`) | — | — | no comparable pair |
| Florida peninsula | 0 (mask refused at that tier) | — | — | no data |

**Zero disagreements on every comparable canvas**, including SF Bay where the *set* of three
distinct verdicts matched element-for-element. The ON arms carried real hits (7, 10, 1), so the
matching verdicts were genuinely served from cache.

⚠️ **Limit, stated plainly:** this compares the verdict *scalar* (`shelteredFrac`) and `nPx`, not the
full mask bitmap. Pixel-level equivalence is proven separately and more strongly by the jsdom
oracle and the 10/10 mutation table — not by this.

## 5. Animation and resources

| Metric | Result |
|---|---|
| `activeRafCount` | **1**, stable across two reads 2.5 s apart, after 277 mask calls and 19 viewport changes |
| textures / framebuffers / shader compiles | 91 / 5 / 6 — bounded |
| Reproducibility control | Cocoa Beach returned **0.0081** at the end — identical to the first measurement, after a full world tour |

**No RAF duplication, no renderer multiplication.** ⛔ No FPS figure is quoted: frame rate is not
measurable in this browser pane (RAF throttling on unfocused tabs), so any number would be an
artifact.

## 6. Visual registration

Screenshot at Cocoa Beach, Waves active: the green wave field covers the open Atlantic and **stops
at the barrier island** — the Banana River and Indian River lagoons render unanimated. That is the
sheltered-water suppression landing on exactly the water it is meant to, with the cache serving
84.6% of those frames. HUD concurrently reads Class **AUTHORITATIVE NATIVE**, no causal violations.

## 7. Gate E verdict

> ### GATE E — CONDITIONAL PASS (was BLOCKED)

Passes: antimeridian continuity both sides · high-latitude and open-ocean handling (ran, guard-
refused by design) · 14/15 geographies incl. bay, cove, island chain, peninsula · coastline/mask
registration confirmed visually · single RAF owner under sustained interaction · cache verdicts
identical to uncached on every comparable canvas · kill switch verified live at 0%.

**Conditional, because these were NOT measured:**

1. **Bearing, pitch, and resize** — every sample was bearing 0 / pitch 0 at one window size.
2. **DPR 1** — only DPR 2 was exercised.
3. **Tile seams, half-screen clearing, dead zones** — not systematically inspected.
4. **Vector-field orientation** (N/S, E/W arrow direction) — the *scalar* mask was the subject here;
   direction correctness was not re-verified.
5. **Remount** — layer-toggle and route-remount cycles were not run (route navigation logs the
   dev-mock user out, a documented blocker).
6. **Production build** — dev build only.

None of these are cache-specific risks; they are general Gate E surface that remains open.
