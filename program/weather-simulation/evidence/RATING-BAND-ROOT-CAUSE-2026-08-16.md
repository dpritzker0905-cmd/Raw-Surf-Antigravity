# The rating band under the heatmap — ROOT-CAUSED

**Owner report:** *"The rating band is being layered underneath the marine heatmap."*
**Surface:** `https://dev--rawsurf.netlify.app/map`, authenticated, build **`d74b38f9`**, theme beach.
**Harnesses:** `frontend/scripts/ratingmode-rootcause.js` (network + console + fresh-read assertion
+ video), `coastband-ladder.js`. **Test:** `useWebGLGuardrail.ratingBandLoss.test.js` (6/6).

---

## 1. The cause, in one line

**`useWebGLGuardrail` decides the GPU is too slow and swaps the WebGL marine field for Open-Meteo
raster tiles. The rating band is a feature of the renderer it just switched off; the height heatmap
is not.** Nothing in the rating pipeline is broken.

`useWebGLGuardrail.js` trips after **12 consecutive 1-second windows below 20 FPS**, sets
`webglMarineFailed`, and `useOpenMeteoTileUrls` then serves the marine layer as third-party
wave-HEIGHT raster tiles. The legend keeps advertising *"Surf Rating (coastal band)"*.

The build says so itself, in its own console breadcrumb:

```
51229  [rating-band] PAINTING ✓ (band on) cols=17 fromSeries=false
51239  [WebGLGuardrail] Frame rate consistently below 20 FPS (1 FPS) for 12 consecutive seconds.
51239  [WebGLGuardrail] Triggering fallback override for WebGL Marine layer
51239  [WEATHER_TRUTH] chainCancelled | webgl_marine_fallback: guardrail tripped after 12 low-FPS windows
```

Ten milliseconds after the band's last confirmed paint, its renderer is gone.

## 2. The paired A/B — same build, same cameras, one variable

`__DISABLE_WEBGL_GUARDRAIL__` is the hook's own kill switch (it also self-exempts on localhost —
so **this defect can only ever occur on a deployed host**, which is why local dev never shows it).

| leg | stops FRESH | `[rating-band]` breadcrumbs | band state |
|---|---|---|---|
| guardrail **ON** (default) | **0 / 6** — all REFUSED | **0** | telemetry frozen at the last live frame |
| guardrail **OFF** (control) | **6 / 6** | 6–12 per stop | **`PAINTING ✓ (band on)`** at every stop |

Optically: `ratingmode-noguard/RC_z9_coast.png` shows the coastal ribbon — warm yellow/orange
hugging the Florida shore, tapering into the cyan wash — at the same z9 camera where the
guardrail-on capture (`ratingband-out/RB_z9.00.png`) is uniform cyan with no band.
Video of both ladders: `ratingmode-*/page@*.webm`.

## 3. The chain is healthy — measured link by link, not assumed

Captured off the wire, so none of it depends on in-page telemetry:

| link | evidence | verdict |
|---|---|---|
| L1 request carries `surf=1` | **61 / 66** grid fetches | ✅ |
| L2 backend ran the transform | `{"rated":121,"masked":40,"value_kind":"surf_rating","wind":true,"local_size":true,"obs_gate":true}` | ✅ |
| L3 `ratingMode` stamped | `__RAW_GPU__.ratingBand.gridRatingMode = true` | ✅ |
| L4 committed | rated 17×17 regional resident, `forcedOff = false` | ✅ |
| L5 painting | `active = true`, breadcrumb `PAINTING ✓` | ✅ |

⇒ **The "the rated grid is not reaching the engine" hypothesis is REFUTED.** It was my leading
hypothesis one step earlier, taken from the engine's own diagnostic string; the control killed it.

⚠️ **One real diagnostic defect found in passing.** The world-bbox request returns
`surf_transform: {"skipped":"mid_res_tier"}` — but that label is chosen by *which grid type it is*,
not *which rule fired*:

```python
if (_b is not None and _span >= 350.0) or _mid_skip:
    diagnostics["surf_transform"] = {"skipped": "mid_res_tier" if _is_mid_res else "coarse_extent"}
```

A span-360 request is skipped by the **`_span >= 350` rule** yet labelled `mid_res_tier`, which reads
as *"`MARINE_MID_RES_RATING` is off"* and would send the next reader hunting a Render env var that is
not set. **The reason string must name the rule, not the subject.**

## 4. What this invalidated, stated plainly

- **Every `__RAW_GPU__` reading taken more than ~51 s into a SwiftShader session** is last-frame
  state, including this session's earlier `coverage_gap`-at-every-zoom ladder.
- **The earlier coastline numbers measured Open-Meteo raster tiles, not the marine field.**
  Re-run with the guardrail off — and this time the carve state is live and correct:
  `z8.00 → min_combine`, `z7.90 and below → off`, which is exactly the regime LOP-0002 describes
  and the first observation of **LOP-0003's threshold = 8 actually engaging on a deployed build**.

  | zoom | overlay reason | band | bleed |
  |---|---|---|---|
  | 8.40 | `coverage_gap` | **0 px** | 0 |
  | 8.00 | **`min_combine`** (carve on) | **0 px** | 0 |
  | 7.90 | **`off`** (below threshold) | **0 px** | 0 |
  | 7.50 / 7.00 / 6.50 / 6.00 | `off` | **0 px** | 0 |

  28 transect-stops, both coasts, band max **0 px**, bleed max **1 px (0.145 km)**; 18 stops pass
  the injected-band self-test at 1–21 px. **The conclusion survived the correction.**

## 5. ✅ SHIPPED — options 1 and 2, owner-approved 2026-08-16

**Option 1 — disclose the downgrade.** `marineFallbackNotice.js` (new). Renders in the legend only
while the fallback is engaged, and names the substitution rather than just "reduced graphics":
*"⚠ Simplified wave layer — surf-rating band unavailable"*, with a tooltip stating that the colours
are third-party wave HEIGHT, not this app's surf-quality forecast, and that the map retries by
itself. Wired into `LegendTicks` — the one seam that reaches the desktop panel, the collapsed mobile
float and the expanded mobile sheet at once — so `MapWeatherControls` (grandfathered, shrink-only)
did not grow. Kill switch `__RAW_LEGEND_FALLBACK_NOTICE__ = false`.

**Option 2 — recovery.** `useWebGLGuardrail` now re-enables the WebGL marine layer on a bounded,
backed-off retry: **60 s, then 300 s, then it stays down for good.**
⚠️ Deliberately NOT an FPS-based recovery: while the fallback is engaged the WebGL layer is
unmounted, so the frames being counted are the raster tiles' — cheap, and no evidence at all about
the renderer being switched back on. There is no sound in-band signal, so the retry is time-based
and the attempt budget is what bounds flapping. Recovery re-arms the mount grace (a remount pays
shader-compilation cost again), refuses while the tab is hidden or the map is mid-gesture, and never
undoes a hard WebGL error or a human-forced fallback. Kill switch
`__DISABLE_WEBGL_GUARDRAIL_RECOVERY__`.

**Verified, not assumed** (local dev, real browser, forced fallback):
- the notice renders in the legend, on exactly the state it describes;
- **contrast passes AA in all three themes** — light 4.90:1, dark 6.74:1, beach 8.08:1;
- **exactly ONE live region at desktop AND mobile width**: the notice renders in two layouts but the
  inactive one sits under `display:none` and is out of the accessibility tree, so a screen reader
  announces it once, not twice. Checked at 1280×800 and 375×812.
- **145 suites / 1555 tests pass**, LOC ratchet `Regressed: 0`, lint gate no new errors.

**Tests:** `useWebGLGuardrail.ratingBandLoss.test.js` (23) + `marineFallbackNotice.test.js` (12).
★ Two of my own bugs were caught by the positive controls in those suites, not by review: a clock
installed after `renderHook` (so the grace period never expired and the guardrail could never trip)
and a mutated props object (so the recovery ref never updated). In both cases the four "does NOT
recover" assertions passed **vacuously** while only the positive tests failed — which is precisely
what a suite without controls would have shipped.

✅ **VERIFIED ON THE DEPLOYED BUILD `6561ea30`** (`frontend/scripts/guardrail-recovery-live.js`).
Nothing forced — no `__DISABLE_WEBGL_GUARDRAIL__`, no `force_marine_fallback`; SwiftShader's ~1 FPS
is the same condition a genuinely slow GPU produces, so this exercises the real path:

```
t+39.8s   TRIP       [WebGLGuardrail] below 20 FPS for 12 consecutive seconds
t+43.9s   FALLBACK   webglMarineFailed = true
t+48.9s   NOTICE     "⚠ Simplified wave layer — surf-rating band unavailable"
t+101.3s  RECOVERY   [WebGLGuardrail] Recovery attempt 1/2: re-enabling the WebGL Marine layer
t+102.2s  BAND_ON    [rating-band] PAINTING ✓
t+105.1s  RESTORED   webglMarineFailed = false, notice cleared
```

Recovery fired **61.5 s** after the trip — the 60 s backoff. All six checks pass: tripped, notice
shown while down, recovered, **notice cleared after recovery**, recovery logged, band repainted.

## 5a. Does the fallback actually PAINT? — owner's question, answered both hosts

The notice claims a *"Simplified wave layer"*, which asserts one exists. That had not been checked:
§5 verified the notice's text, contrast and live-region count, never the truth of its own claim.
Harness `frontend/scripts/fallback-paints.js` — three legs, each its own page load (the fallback is
read by a `useState` initialiser at mount and cannot be toggled in place):

| leg | | local dev | dev alias |
|---|---|---|---|
| **A** | waves OFF — the true negative | baseline | baseline |
| **B** | waves ON + fallback FORCED | **distance 1**, 7 colours | **distance 11**, 39 colours |
| **C** | waves ON + WebGL — positive control | distance 62, 169 colours | distance 67, 239 colours |

Distance = max per-channel difference of mean ocean colour vs leg A, over ~200–300 sample points
that are basemap WATER *and* whose topmost element is the map canvas (a pixel under the weather
panel is not evidence about the ocean). Second, baseline-free discriminator: unique-colour count —
flat basemap water has ~7–10, a real field has structure.

**Answer: it depends on the host, and that is the finding.**

- ✅ **On the deployed build the fallback DOES paint.** 37 tile requests, all 200/206;
  `waves-slot-1-layer` `visible` with a live `ncep_gfswave025` source and an opacity ramp
  (`z2→0.22 … z12→0.40`). The notice's claim is TRUE in production.
- ⛔ **On LOCAL dev it paints NOTHING** — distance **1** from bare water, 7 unique colours, 8 tile
  requests instead of 37. Cause, in the build's own words:

  ```
  [OM-Protocol] Async tile decoding error: Failed to initialize WASM module
  wasm streaming compile failed: Incorrect response MIME type. Expected 'application/wasm'.
  CompileError: expected magic word 00 61 73 6d, found 3c 21 64 6f
  ```

  `3c 21 64 6f` is `<!do` — the dev server returns **index.html** where the `.wasm` should be, so
  `@openmeteo/file-format-wasm` never initialises and every `om://` tile decode throws. The layer is
  added, visible, correctly sourced, and blank.

### ✅ 5b. The local wasm break — root-caused and FIXED

Not an Open-Meteo problem and not a code defect: **a poisoned webpack persistent cache.**

`.claude/worktrees/halo-lane/frontend/node_modules` is a **Junction to the main tree's
`node_modules`** (verified with `Get-Item -Force`), so a build run in that worktree writes its cache
into *this* tree's `node_modules/.cache`. Measured: the 1.4 GB cache carried `worktrees\halo-lane`
build contexts **and** `om_reader_wasm.web.wasm` asset entries — two absolute build contexts in one
cache. Webpack fails that as `Can't handle conflicting asset info for sourceFilename`, the wasm
asset is never emitted, the dev server answers the `.wasm` request with the SPA's index.html, and
every `om://` decode dies on `expected magic word 00 61 73 6d, found 3c 21 64 6f`.

★ `craco.config.js` already *documented this exact failure* and shipped a fix — behind an opt-in
`WEBPACK_CACHE_DIR` env var. **Nobody set it, so it never fired.** A guard every writer must
remember is not a guard. The cache directory is now keyed by the build tree's own absolute path by
default, so each worktree gets its own cache even through a shared/junctioned `node_modules`;
`WEBPACK_CACHE_DIR` still overrides by hand.

**Verified by the same three-leg harness, before vs after, plus the wasm response itself:**

| | local BEFORE | local AFTER | dev alias |
|---|---|---|---|
| leg B distance from bare water | **1** | **13** | 11 |
| leg B unique colours | 7 | 33 | 39 |
| leg B tile requests | 8 | **37** | 37 |
| `.wasm` response | index.html (`3c 21 64 6f`) | **200 `application/wasm`, `00 61 73 6d`** | — |
| decode errors | 3 | **none** | none |

⇒ **local now reproduces the deployed behaviour**, which is the actual acceptance criterion. Also
re-verified: production build compiles clean and emits a valid `om_reader_wasm.web.*.wasm`
(`0061736d`) referenced from the bundle; 44 focused tests pass; LOC ratchet `Regressed: 0`.

⚠️ Still true and unrelated: `npm run build` fails on Windows at the `NODE_OPTIONS=… ` shell prefix
(`C4-OP-04`). `NODE_OPTIONS=--openssl-legacy-provider npx craco build` from bash works.
★ And it is why §5's local check was misleading: I forced the fallback to photograph the notice and
read the resulting empty ocean as "the fallback, working". I had even seen the wasm compile errors
in the dev-server overlay and dismissed them as "pre-existing, unrelated" — they were the mechanism.
**"I did not touch it" is not "it is irrelevant to what I am verifying."**

⭐ **A REAL FINDING THAT SURVIVES BOTH HOSTS: the fallback is ~6× less prominent than the field it
replaces** (deployed distance 11 vs 67). That is the opacity ramp doing what it was written to do,
but it means the fallback ocean reads as nearly flat — which is very likely what "the band is
underneath the heatmap" looked like from the outside. Whether 0.22–0.40 is the right ramp for a
layer that is now the ONLY wave signal is a separate, open product question.

## 6. Still the owner's — the two options NOT taken

The guardrail is legitimate protection. Options 1 and 2 above are shipped; these two are not:

1. **Disclose the downgrade.** Today the legend still advertises a coastal band that cannot exist.
   Cheapest, and it stops the bug report recurring.
2. **Add recovery/hysteresis.** The hook never calls back with `false` — one GPU stall costs the
   band for the rest of the session unless the user changes layer or reloads (pinned by test).
3. **Retune the trip** (20 FPS × 12 s). Not recommended blind: it exists for real stalls.
4. ⛔ **The deepest issue:** the fallback silently substitutes a **different forecast product**.
   Open-Meteo raster tiles are not `resolve_surf_geometry` + `estimate_surf_at` + `compute_surf_rating`
   — so the fallback is a second forecast path that CLAUDE.md's ONE FORECAST COMPOSITION rule
   forbids, reached automatically and without disclosure. That is worth an explicit decision.

**Nothing was changed in production code.** The test pins current behaviour, including the missing
recovery, so the decision can be made without the behaviour drifting underneath it.
