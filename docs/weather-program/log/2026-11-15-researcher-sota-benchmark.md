# 2026-11-15 · researcher · State-of-the-art benchmark, our code against it, and Blender's role

**Director batch (09:15 EST 11-15, David):** "State of the art is our goal." Three tasks, docs only, one draft PR, no merges
(Codex release order in progress). Baseline: gap matrix #887 (`2026-11-13-researcher-weather-gap-matrix.md`). Code read from
`origin/dev` at `9001096dc`.

**Status legend.** **Cited** = read in a source this session. **Code** = read in code on dev. **Unverified** = not found, or
only partly. Nothing here was measured live. No competitor page was loaded; scrub latency for competitors is **unverified**.

## 1. State-of-the-art benchmark, by layer

### 1.1 What the public sources say (how much is known)

| Product | Frame delivery | Time interpolation | Particles / animation | Palette | Confidence |
|---|---|---|---|---|---|
| **earth.nullschool** | Browser computes from a GFS grid (1°). Bilinear interpolation of the grid in JS, plus a per-point projection-distortion term. Canvas 2D for the animation and the colour overlay. | Not stated. Grid downloads trigger re-interpolation. | ~5k particles, Canvas 2D (per the author's notes, cited) | Speed ramp; legend with units | Cited (WebSearch; author notes; not the source code) |
| **Windy** | Community posts describe a WebGL particle layer (v11.00 "WebGL particles"). Mapbox-derived implementation lineage (cited). | Two levels: spatial bilinear (cited via wind-js) and temporal. Windy's own community argues about blending model hours; unresolved. | WebGL particles (cited, community) | Not checked | Partial: internals not published |
| **Ventusky** | Animated streamlines for wind (cited). Developer writes in-house, no third-party JS mapping library (2016 article, cited). | A user-facing interpolation on/off key in the guide (cited). An older interview says a "variant of bicubic" interpolation (cited), and that it was CPU-heavy. Forum reports of "jumping" between limited frames (user report, not official). | Streamlines | Not checked | Partial, mostly dated |
| **Meteoblue** | Tile API: raster PNG or vector protobuf tiles, time placeholder in URL (cited). Mapbox GL plugin on the tile API (cited). | Radar: 15-min source steps displayed at 1-min steps by synchronising and interpolating networks (cited). Model-hour interpolation not described. | Animated frame slider; "Play" for real-time layers (cited) | Not checked | Partial |
| **Surfline** | Not described publicly in what we found. LOLA (older) and LOTUS (newer, the latter named in one opinion piece). "Lumina" not found. | Unverified | Unverified | Unverified | Low: no technical source found |
| **Apple Weather** | Animated maps on Apple Maps base (cited). Precipitation: 3 h of history and 1 h of future in hourly view (cited). | Unverified | Unverified | Unverified | Low: no rendering source found |
| **Xweather MapsGL** (for reference, not in the six asked) | Client-side rendering of weather data, interpolated through time on the device, not a stack of images (cited, vendor blog). | Client-side time interpolation (cited) | GPU | Not checked | Vendor claim |
| **MapTiler weather example** | One tile pyramid per forecast step; frames loaded as they arrive (cited) | Frame stepping | WebGL shaders (cited) | Not checked | Vendor/docs |
| **Mapbox webgl-wind** (reference implementation) | GPU particle state; up to 1 million particles at 60 fps (cited) | Not stated | GPU particle state, Chris Wellons' technique (cited) | Not checked | Cited |

**Read.** The public record does not show any of the six products doing shader-side blending between two model hours as a
published technique. Two things are visible across them: the user-facing interpolation toggle (Ventusky), and client-side
time interpolation as a vendor claim (Xweather). Our code has no time blend of its own (section 2, gap 2), so the comparison
is on what we can see, not on what they hide.

### 1.2 Per layer (our 12), against our own state

Baseline from #887 for ownership; the "SOTA reference" column is what the public record supports.

| Layer | Ours (dev) | SOTA reference (public) | Gap |
|---|---|---|---|
| rain | GFS own set (DARK), EURO set in #855 (DARK), tile path otherwise | Radar-style short-range frames, 1-min interpolation (Meteoblue radar, cited) | Time blend + 1-h steps |
| radar | RainViewer tiles | Meteoblue 1-min synchronised radar (cited) | Not our data source; tile fade only |
| satellite (cloud) | GFS own set ON | Not checked | Model-hour blend |
| wind | GFS static frames, WebGL particles, 6 vertices per particle | Mapbox GPU particles, 1M at 60 fps (cited) | Particle draw cost (section 2, gap 1) |
| waves / swell_1 / swell_2 / wind_waves | CDN marine sets, WebGL marine engine | Not found for competitors | Time blend (gap 2) |
| fog | GFS visibility tile, no frames | Not checked | No frames, no capability row |
| pressure | Own per-model sets ON | Not checked | Time blend |
| temperature | GFS own set DARK | Not checked | Lever default |
| water_temp | Open-Meteo tile, no ICON | Not checked | Source coverage |

## 2. Our code against SOTA: top 5 gaps

Each gap has the files, the expected gain, and a measurement fixed before any build. Gains are estimates from code reads,
not measured.

### Gap 1. Particle draw runs six vertices per particle
- **Code.** `WebGLMarineParticleShaders.js:396-414` recomputes the particle index and fetches the state texture per vertex.
  Draw at `WebGLMarineEngine.js:2152`: `drawArrays(TRIANGLES, numQuadVerts)`. Wind: `WebGLWindEngine.js` (not re-read here).
- **Gain (estimate).** About 525,696 state fetches per frame at 296² marine, against 87,616 with one instance per particle.
- **Measurement (pre-registered in #865).** Median particle-draw GPU time over 300 frames, fixed viewport. Pass at ≥25%
  lower on one desktop GPU, and output identical within 1/255 across 10 fixed views. Kill below 10%.

### Gap 2. No time blend between model hours
- **Code.** The marine and wind shaders take one frame at a time. Search for a second-frame uniform or a `mix()` between
  frames (`u_frac`, `u_blend`, `u_next`, `timeBlend`) found none in `WebGLMarineShaders.js`, `WebGLMarineParticleShaders.js`
  or `WebGLWindShaders.js`. Frames step in whole hours. The only `u_time` uses are the wave shimmer and the particle clock.
- **Gain (estimate).** Removes the hour-boundary pop. Cost: a second texture sample per fragment on the frame path.
- **Served numbers.** A display-only blend of two already-served frames leaves served values unchanged. The blend fraction
  must come from the frame times, not a new forecast.
- **Measurement (to pre-register before build).** On a fixed scrub of 24 h at 3-hourly frames, mean absolute luminance step
  across the hour boundary (blended vs stepped), over 10 views. Pass: step reduced ≥50%, no frame-time regression above +10%.
  Reference: a half-hour frame rendered offline from the two neighbours.

### Gap 3. JSON series decoded on the main thread
- **Code.** `marineGridSeries.js:340` and `:526` call `res.json()` on the main thread for `/grid_series` pages. The static path
  already has a worker (`staticFrames.js:141`, a Blob worker), and the binary RSWF path exists (`marineFramePack.js`). The JSON
  series path does not use the worker.
- **Gain (estimate).** Main-thread time per page; the header records 1.7-4.3 ms per world frame for the object path and up to 55 ms
  under 4× CPU throttle (`marineFramePack.js:8-10`, bench figure).
- **Measurement.** Long-task count and total blocking time during a 48-frame page load and scrub on a throttled profile.
  Pass: ≥50% lower blocking time, identical decoded arrays (byte compare on a fixture).

### Gap 4. Mipmaps and LOD for static frame textures (verify first)
- **Code.** `staticFrames.js` has no `generateMipmap` or mipmap filter in its texture setup. `ownRasterLayer.js` and the
  marine texture uploads were not checked for mipmaps; this is a question, not a finding.
- **Gain (estimate).** Less shimmer and aliasing at zoom-out (z2-z4), where one texel covers many screen pixels.
- **Measurement.** At z2 and z3 fixed views, SSIM against a full-resolution reference, and texture memory. Pass: SSIM up
  ≥0.02 at z2-z3 with memory up ≤20%.

### Gap 5. Per-step React work during scrub (Move 3's finding)
- **Code.** The board records Move 3's ranked census of >100 ms scrub misses and the phone finding about per-step React
  re-renders. Not re-measured here.
- **Gain.** Scrub latency on phones (the main user-visible gap).
- **Measurement.** Owned by Move 3 under its own pre-registration. This log does not add a new test.

## 3. Blender's role (proposal, no scenes built)

Blender's Ocean modifier is documented in the manual: spectra (Phillips turbulent, Pierson-Moskowitz, JONSWAP sharp peaks,
TMA shallow water), wind velocity, fetch, alignment, and a time keyframe (manual `modeling/modifiers/physics/ocean.rst`, found
by search). Searches for fog and volume scattering returned nothing in the bundled manual, so fog and rain are **unverified**
as Blender features in this pass.

Ideas, with worth and order:
1. **Reference renders for wave crests (worth it, first).** Use the Ocean modifier and its spectra as a physically based
   reference for how crest shape and foam should look. Output is a picture for comparison, never a served value.
2. **Golden images for shader regression (worth it, second).** Fixed camera, fixed scene, rendered once to an image, then the
   browser output is pixel-compared. We already plan this in the #865 pixel test; Blender can give a cleaner reference for
   crest and foam shape than a screenshot of our own output.
3. **Fog and rain references (not verified).** Only after the volume-scatter manual entries are found. Do not start on it now.
4. **Camera paths for marketing and preview (last).** Not a quality gain for the served product. Low priority.

Rule: Blender output never feeds a served number and is never a source of truth for forecasts.

## 4. ONE ranked list: next 5 SOTA moves for the weather layers

| Rank | Move | Gain (estimate) | Risk | Pre-registered success test |
|---|---|---|---|---|
| 1 | Instanced particle draw (gap 1; #865) | ~25% of particle pass | Low; same triangles | Particle-draw GPU time ≥25% lower; output identical within 1/255 |
| 2 | Display-only time blend between adjacent hours (gap 2) | Removes hour pops on all layers | Medium: 2× texture cost | Luminance step at hour boundaries reduced ≥50%; frame time ≤+10% |
| 3 | Move the JSON series decode off the main thread (gap 3) | Main-thread blocking during scrub | Medium: parity | Blocking time ≥50% lower; decoded arrays byte-identical |
| 4 | Mipmap/LOD for static frame textures (gap 4; verify first) | Less aliasing at z2-z4 | Low to medium: memory | SSIM ≥0.02 up at z2-z3; memory ≤+20% |
| 5 | Phone scrub re-render census (gap 5; Move 3) | Scrub latency on phones | Owned by Move 3 | Move 3's own pre-registration |

Ordering reason: 1 is already written and cheap; 2 is the largest visible gain but needs a pre-registration first; 3 is
independent of the GPU work; 4 needs a verification step before it is a move.

## 5. Limits

- Competitor internals are mostly unverified. The sources are community posts, vendor blogs, and one 2016 article.
- No competitor page was loaded, and no scrub latency was measured for any of them.
- Surfline and Apple rendering: no technical source found.
- Gaps 1-4 are from code reads, not from a run.
- Blender: the bundled manual covers the Ocean modifier. Fog and volume were not found.
- Nothing in this log changes a served number, a SCOREBOARD row, or a merged PR. No merge was attempted.


## 6. Corrections (2026-11-15, 09:40 EST). These supersede sections 2, 4 and 5 above where they differ.

**Why this section exists.** The logs are append-only. The earlier top 5 (section 4) listed instancing and a between-hours
blend for every layer. Both were wrong for this lane, as the checks below show.

### 6.1 Instancing (old gap 1) is dropped

- #876 (instanced particle draw) is CLOSED, not merged. Its gate was not met: 19-24% GPU drop against the 25% bar. Recorded in #878 (MERGED 2026-11-14 02:07Z).
- Merged instead: #881, one marine world copy at low zoom when no world edge is in view (ON, kill switch; merged 2026-11-14 04:10Z). #882, wind world copies from the frame's bounds (ON, kill switch; merged 2026-11-14 04:55Z).
- Director's board figure for the two culls: about 0.5-0.6 ms saved per frame. Not re-measured here; cited from the board and #882's gate (0.48-0.53 ms in 4 of 5 views).
- Result: the particle-draw move from section 2 is closed. The vertex count is not a current gap.

### 6.2 Time blend, checked layer by layer (file and line on origin/dev 9001096dc)

| Layer group | Transition now | Evidence | Gap? |
|---|---|---|---|
| Own-frame raster: pressure, rain (GFS), temperature (GFS), satellite (GFS) | **Value blend over 160 ms on a step**, smoothstep. Mixes the shown frame with the wanted frame, then colours through the theme LUT. Off under reduced motion, on different grids, or with `__RAW_DISABLE_RASTER_VALUE_BLEND__`. | `ownRasterLayer.js:91-105` (BLEND_MS = 160, blendEase); shader mix at `:209` | Partly. A short step blend exists. There is no continuous blend across the hour. |
| Wind particle field (GFS) | **No blend, by rule.** Two grids may composite only when they share model and committed hour: "never blend two hours or two models". | `WebGLWindEngine.js:96-100` (windGridsCompatible) | Not a gap. Changing it is an owner decision (truth-first rule). |
| Marine crests: waves, swell_1, swell_2, wind_waves | **Hard swap.** The wave texture is replaced on commit; no value blend found. The only ease is an opacity glide on a resident sharpen swap. | Texture bind on frame change `WebGLMarineEngine.js:3110`; opacity ease referenced `:329`; no blend function found in `WebGLMarineShaders.js` or `WebGLMarineParticleShaders.js` | **Yes. This is the real time-blend gap.** |
| Tile-path layers (rain, radar, satellite, fog, water_temp, tile fallbacks) | **Hard cut by policy.** Raster fade 0, "one hour on screen per frame". Legacy 300 ms crossfade behind a flag. | `rasterFrameSwap.js:7-13`; `radarFrameHold.js:7-30`; `MapWebGL.js:788` (`raster-fade-duration: 0`) | Policy, not an oversight. A change needs an owner decision and an A/B on the same scrub. |

**Restated gain and test, marine crests only.**
- Change: in-shader blend between two adjacent marine frames, mixed by the fraction between their valid times. Two texture samples per fragment. The fraction comes from frame times, not a new forecast, so served values do not change.
- Gain (estimate): removes the hour pop on wave and swell crests. Not measured.
- Pre-registered test: over a 24-hour scrub at 3-hourly frames, 10 fixed views, mean absolute luminance step across hour boundaries, blended vs hard swap. Pass: step reduced by at least 50%, and frame time no more than 10% worse. Reference: an offline half-hour frame built from the two neighbours.
- Served-value check: decoded frames byte-identical before and after (the blend is display-only).

### 6.3 Competitor facts, verified in light reads (one page each, no load)

- **earth.nullschool / cambecc/earth (GitHub README, MIT).** Verified: MIT licence; GFS at 1° resolution, wind from the 1000 hPa level; animation drawn on an HTML5 Canvas over an SVG map, with a second Canvas for the colour overlay; spatial bilinear interpolation between grid points. Not stated in the README: particle count, and whether the canvas is 2D or WebGL. No temporal interpolation between forecast hours is described. The source code was not read.
- **Ventusky (published user guide, my.ventusky.com).** Verified: a keyboard key "turns off / on weather map interpolation", so an interpolation option exists. The method is not described. Time moves in forecast periods with the timeline or arrow keys. No animation-smoothness claim.
- **Windy (public API page, api.windy.com).** Verified: public APIs are Point Forecast, Map Forecast and Webcams. No plugin docs were listed on that page. Nothing on rendering or hour interpolation. Plugin docs and any rendering description: unverified.
- **Meteoblue, Surfline, Apple Weather, Xweather.** Not re-read in this pass. The earlier search snippets stand as cited but unverified: Meteoblue radar at 1-minute steps (search snippet); Apple precipitation 3 h history and 1 h future (search snippet); Surfline and Apple rendering: no source.

### 6.4 Corrected top 5 (replaces section 4)

| Rank | Move | Gain (estimate) | Risk | Pre-registered success test |
|---|---|---|---|---|
| 1 | Marine crest blend between adjacent hours (section 6.2) | Removes the hour pop on wave and swell crests | Medium: two texture samples | Luminance step across hour boundaries cut by at least 50%; frame time at most +10%; decoded frames byte-identical |
| 2 | Move the JSON series decode off the main thread (`marineGridSeries.js:340, :526`; worker pattern at `staticFrames.js:141`) | Main-thread blocking during scrub | Medium: parity | Blocking time at least 50% lower on a throttled profile; decoded arrays byte-identical |
| 3 | Verify, then decide, mipmaps for static frame textures (none found in `staticFrames.js`; `ownRasterLayer.js` not checked) | Less aliasing at z2-z4 | Low to medium: memory | SSIM up at least 0.02 at z2-z3; texture memory at most +20% |
| 4 | Phone scrub re-render census (Move 3) | Scrub latency on phones | Owned by Move 3 | Move 3's own pre-registration |
| 5 | Owner decision: revisit the wind "never blend two hours" rule and the tile-path hard-cut policy | Smoother scrub on those layers, if the owner agrees | Policy change, not code | A/B on the same fixed scrub, both arms on the same build; pass only if the owner accepts the truth-first trade-off |

**Blender** is unchanged from section 3: reference renders and golden images only, never a served value.


## 7. Wider research brief (director, 2026-11-15 10:12 EST): accuracy, animation, instant, ranked

**Scope and limits.** Read-only: code and docs on origin/dev `9001096dc`, and the board and per-buoy notes. No live load, no
merge. Uncertain items are marked **(uncertain)**. Served numbers are marked: a served change needs David's word.

### 7.A Accuracy: where the error is largest (ours, from the logged results)

- **One buoy dominates the +72 h hole.** NDBC 46267 (Strait of Juan de Fuca) runs +1.47 to +1.52 m against best_match at
  every lead, CI about [+1.0, +2.0], n about 187. That is about 37% of the pooled 14-day +72 h gap by itself. Source:
  per-buoy split, Actions 43339322792, 2026-11-13 00:45Z. A named exclusion is shipped (#852; board 079866eb7). Served: yes.
- **Hawaii south and east shore.** 51211 (Pearl Harbor) is +0.11 to +0.12 m worse than the identical model (CI excludes 0),
  and 51202 is +0.08. Our chain is worse than the same model only there. Source: per-buoy split. Served: yes (the chain).
- **Pooled, our chain beats the identical model.** 7-day control gap is -0.034 / -0.031 / -0.022 m at 24 / 48 / 72 h, all CIs
  below 0. Source: per-buoy split.
- **SoCal Bight and Oregon shelf.** We trail best_match by 0.1-0.3 m, but the identical model shows about 0 or negative.
  The gap is the GFS-Wave 0.25° model in the island shadow, not our chain. Source: per-buoy split.
- **Blind spot: bias.** MAE cannot see a +0.05 m bias shift on under-reading keys (detection control failed). A bias line
  beside MAE is needed. Source: per-buoy split, "Detection control". Served: no (a grading change).

### 7.A upgrades that buy skill (with cited numbers and what applies to us)

| Upgrade | Cited evidence | What it means for us | Applies? |
|---|---|---|---|
| AI global models (GraphCast) | Lam et al., Science 2023: GraphCast better than HRES on 90% of 1,380 targets (variables, levels, lead times together; 69 of 227 variable-levels in the HRES comparison) [eurekalert / arXiv 2212.12794] | Global model replacement; not a nearshore fix | Partly: a candidate source, not a nearshore upgrade. Served: yes if adopted |
| ECMWF AIFS (operational Feb 2025 single, Jul 2025 ENS) | ECMWF newsletter 187: medium-range error reduction 5-15% typical, up to 25% for AIFS-ENS; 2m temperature better at all leads vs SYNOP. An independent 9,000-station preprint (not peer-reviewed, unverified) finds raw IFS better than AIFS, shrinking after post-processing | Our EURO lane is ECMWF IFS-based; an AIFS source would change the EURO lane | Yes for EURO. Verify with our buoy set before adoption (uncertain) |
| Aurora (Nature 2025) | Abstract says it beats operational forecasts for ocean waves; the coverage cites 86% of comparisons over a test year (Microsoft framing); SWH skill metrics not found (uncertain) | Relevant to swell; the wave data start only in 2016 | Uncertain. Read the paper's wave section before any use |
| EMOS calibration (Gneiting et al., MWR 2005) | Method confirmed: Gaussian EMOS fitted by minimum CRPS. The wind-speed percentage was not found (uncertain). Wind speed uses truncated normal (Thorarinsdottir and Gneiting 2010) | Our bias and calibration work (OCF shadow) is this family | Yes. Gain not number-verified here |
| Bias correction / linear MOS (ours, shadow) | Scoreboard 2026-11-13 02:33Z: rolling 14-day, 56 buoys. Linear MOS: 24 h -0.000, 48 h **-0.012 [-0.018, -0.007]**, 72 h **-0.019 [-0.028, -0.011]**. Gate not met: hawaii worse at every lead, atlantic_ne/se worse at 48/72 h. Pooled gain from pacific_ne only | Real gain at 48-72 h in pooled terms; fails the per-region gate | Yes, uncertain as a default. Served: yes if shipped |
| Multi-model consensus and weighting (ours) | Consensus product exists (`consensus_product.py`); shadow excess is tied to pairs with no stored tier (scoreboard 02:33Z) | The consensus-shadow excess is a labelling issue, to fix first | Yes. Served: yes |
| Nearshore transform (ours, #852, #851) | Exposure sweep proposed in #851 (not built); named exclusion of 46267 shipped | Fixes the one-buoy hole; the bake-off (#883) tests coast types | Yes. Served: yes |
| Downscaling | No measured number in the repo for our grids (uncertain) | Would help Hawaii and Bight shadows | Uncertain |

### 7.B Animation and rendering: what the leaders do (verified where stated)

| Product | Time interpolation | Particles | Colour ramps | Verified from |
|---|---|---|---|---|
| earth.nullschool / cambecc/earth | Spatial bilinear only; no temporal interpolation described | Canvas 2D over SVG map; count not stated | Speed ramp | GitHub README, MIT (fetched 09:4x) |
| Ventusky | On/off key for map interpolation; method not described | Streamlines (wind) | Not checked | User guide, my.ventusky.com |
| Windy | Not described | WebGL particles (community posts, unverified) | Not checked | api.windy.com page: no rendering docs |
| RainViewer | Weather Maps API gives past 2 h plus nowcast frames, refresh every 5 min; no interpolation or motion compensation stated | n/a (radar tiles) | Not checked | rainviewer.com/api.html |
| Zoom Earth | Animation options: precipitation on/off, speed slow/medium/fast, satellite loop 3-24 h, satellite style "Fast" or "Smooth"; no method stated | n/a | Not checked | zoom.earth |
| Meteoblue radar | 15-min source displayed at 1-min steps by synchronising and interpolating networks | n/a | Not checked | Meteoblue blog (search snippet) |

**Our code, with file:line.**
- **Marine crests:** hard swap per hour (`WebGLMarineEngine.js:3110`). No value blend (section 6.2 of #912).
- **Own-frame raster:** 160 ms value blend on a step, smoothstep (`ownRasterLayer.js:91-105`).
- **Tile path:** hard cut by policy (`rasterFrameSwap.js:7-13`).
- **Wind:** no blend across hours or models by rule (`WebGLWindEngine.js:96-100`).
- **Colour checks:** colour-blind and palette law checks exist as scripts: `frontend/scripts/wind-color/` (README and `check.mjs`, cited in CLAUDE.md) and `frontend/scripts/raster-color/check.mjs`. Whether they test colour-blind simulation for every layer: uncertain.
- **Antialiasing:** no `antialias` or MSAA setting found in `MapWebGL.js` or `mapUtils.js`. MapLibre's default applies (uncertain).
- **Frame pacing:** the marine and wind layers run through MapLibre's custom-layer render loop; no separate `requestAnimationFrame` loop was found in `WebGLMarineLayer.js`, `WebGLWindLayer.js` or `ownRasterLayer.js`.
- **Phone tier:** marine particles 192 on handheld, 296 otherwise (`deviceTier.js:36-38`); wind 192 handheld, 384 desktop (`deviceTier.js:45-47`).
- **Lighting and shading:** the crest shader has a shimmer term (`WebGLMarineShaders.js:546-549`), no physically based lighting.
- **Radar motion compensation:** none in code (radar is RainViewer tiles, hard cut, `radarFrameHold.js`).

Blender: no look prototyped in this pass. The Ocean modifier spectra stay the reference for crest shape (section 3 of this log).

### 7.C Instant: remaining first-paint and scrub latency, by measured cause

Board 07:38Z (#889, phone profile, dev harness): own-frame beats the tile path (fog p95 337 ms vs 1.26 s; toggle 1.2-2.0 s vs
5.7-6.7 s), but neither meets the 50 ms gate. Measured causes:
1. **App-wide React re-render per step: 90-150 ms.** Next batch: take non-critical re-renders off the scrub step.
2. **Main-thread water decode: 570-960 ms.** Next batch: worker decode.
3. **Own-frame pump retry loop** (board 05:45Z, live bug): endless re-request on a failed frame; fix is a 30 s backoff already
   in flight.
4. **Missing frames:** the census (Move 3, partial) found 112 of 188 slow steps are EURO and ICON at z7, and 147 never showed the
   asked hour within 6 s. Source: board, Move 3 census.
First paint and per-layer first paint are not measured in this pass (uncertain).

### 7.D One ranked table, A + B + C (top 10, then long tail)

Served column: **yes** means it changes a served number and needs David's word.

| # | Upgrade | Evidence | Expected gain | Cost | Risk | Pre-registered gate | Served? |
|---|---|---|---|---|---|---|---|
| 1 | Scrub: take React re-renders off the scrub step (C1) | Board 07:38Z: 90-150 ms per step | Toward the 50 ms gate; not measured | Medium | Medium (UI, themes) | Phone p95 scrub step ≤50 ms; desktop unchanged; 0 blank frames | No |
| 2 | Water decode to a worker (C2) | Board 07:38Z: 570-960 ms | Removes most water first-paint cost | Medium | Medium (parity) | Blocking ≥50% lower; decoded arrays byte-identical | No |
| 3 | Marine crest blend between hours (B; #912 section 6.2) | Hard swap at `WebGLMarineEngine.js:3110` | Removes hour pop on crests; not measured | Medium | Medium (2× texture) | Luminance step at hour boundaries −50%; frame time ≤+10% | No |
| 4 | Linear MOS / bias correction on the 48-72 h keys | Scoreboard 02:33Z: -0.012 and -0.019 m (48/72 h) | About 0.01-0.02 m pooled | Low (shadow exists) | Hawaii and Atlantic regress | Per-region gate: no region worse at any lead, CI excludes 0 | **Yes** |
| 5 | Exposure sweep replaces the named exclusion for 46267 (nearshore transform) | Per-buoy split: 37% of pooled +72 h gap | Up to ~37% of the pooled gap | High (#851 design, #883 bake-off) | Coast-type errors | Bake-off gate in #883 (≥3 buoys per class; ΔRMSE ≤-0.05 m) | **Yes** |
| 6 | Hawaii south/east shore over-read (downscaling or transform) | 51211 +0.11 m vs identical model | Hawaii only | Medium | Hawaii regress | 51211 and 51202 MAE vs identical model: CI includes 0 or better | **Yes** |
| 7 | Add a bias line beside MAE in grading | Per-buoy split detection control | Grading fidelity (no served gain) | Low | None | Seeded +0.05 m bias detected at CI excluding 0 | No |
| 8 | EURO lane: AIFS source comparison | ECMWF newsletter 187: 5-15% medium-range error reduction (conflicting independent preprint) | Uncertain | High | Source change | Buoy MAE at 24/48/72 h beats current EURO with CI below 0 | **Yes** |
| 9 | Own-frame pump backoff (C3) | Board 05:45Z live bug | Stops retry storm | Low | Low | No endless re-request in a 60 s run | No |
| 10 | Missing-frame census fix for EURO and ICON z7 (C4) | Board census: 112/188 slow steps | Toward the instant gate | Medium | Medium | Census re-run: slow-step count down ≥50% | No |

**Long tail.**
- Lanes we lack (grep of `LayerRegistry.js`): gusts exist in the forecast variable list (`LayerRegistry.js:349`) but not as a
  map layer. Not in the registry: UV, CAPE, lightning, ocean currents, tide overlay, visibility as its own layer (visibility is
  used only for fog). Each is a new lane, with a served-number decision.
- Fog: GFS only, no capability row (gap matrix #887).
- Zoom Earth and RainViewer: no interpolation described; our radar is a hard cut by policy.
- Surfline and Apple: no rendering source (unverified).
- Antialiasing setting and frame pacing: not found in our code (uncertain).
- Colour-blind coverage of every layer's palette: uncertain (the scripts exist; coverage not checked).
- Physically based shading: none in the crest shader; Blender reference renders only (section 3), never a served value.

**Cite-check.** Verified in this pass: GraphCast 90% of 1,380 targets (search of the paper and arXiv); AIFS error reduction
5-15% (ECMWF newsletter 187, via search); Aurora's wave abstract claim (search); EMOS method (search); RainViewer and Zoom Earth
animation options (one page each); earth.nullschool README (one page). Not verified: the Aurora 86% figure (Microsoft
coverage), the EMOS wind-speed percentage, the independent IFS-vs-AIFS preprint's peer-review status, Windy and Ventusky
internals, Meteoblue and Surfline rendering.


## 8. Second-opinion pass on the top 10 (2026-11-15 10:30 EST): tools used, agree or disagree per item, status

### 8.1 Which tools were used, and which were not (and why)

| Tool | Status | Reason |
|---|---|---|
| Consensus (paper search) | **Used.** 2 queries, 3 results each (free plan cap) | Bias correction and AIFS-vs-IFS evidence (below) |
| ww3 `ww3_compare_forecast_with_buoy` (46267, 48 h) | **Failed: no response for 1800 s, aborted.** Not retried | Server silence; a retry would be another long wait. The 46267 GFS-Wave check is **not done** |
| Reflection (`ask_reflection`) | **Not called** | Needs David's own typed request. A peer relay does not count, and the earlier yes covered a different question |
| SubQ (`subq_decide` / `subq_chat`) | **Not called** | Dev-use only, and only when David asks for it by name. Not done |
| LongCat reviewer | **Not called** | No code change or prototype is proposed in this log |
| Logfire | **Not called** | No timing run exists to explain |
| Context7 | Not needed | No library question arose beyond the MapLibre custom-layer check already recorded |
| ndbc, erddap, coops, sealegs | **Not called** | The 46267 check was the only buoy item needed; the ww3 timeout blocked it. Other buoy reads would repeat the per-buoy split already on the board |
| latest-science, HF papers | Not called | Consensus covered the question; no second search needed |

### 8.2 Papers found (Consensus, read from abstracts)

- **AIFS surface-ocean extension (Hahner et al., 2026, arXiv).** Joint atmosphere-ocean ML model that includes waves. Authors report about one day of extra skill at medium range for most marine variables against physics-based models. Authors' claim, not independently checked. [Representing the Surface Ocean in ECMWF's data-driven forecasting system AIFS](https://consensus.app/papers/details/w:f2332dcd-22a1-47f1-8066-5b8e3c754034/?utm_source=claude_code)
- **AIFS (Lang et al., 2024, arXiv).** AIFS trained on ERA5 and operational analyses; highly skilled upper-air and surface forecasts; open data. [AIFS -- ECMWF's data-driven forecasting system](https://consensus.app/papers/details/w:90186cec-733b-4770-9446-5784a7f4cc9a/?utm_source=claude_code)
- **AI vs physics, 9,000+ stations (Kocsis et al., 2026, arXiv).** Raw IFS ensemble is clearly better than raw AIFS at all horizons for 10 m wind speed (July–November 2025). EMOS post-processing narrows the gap; at short lead times IFS stays ahead after post-processing. Covers wind speed, not waves. [AI and physics-based weather forecasting: A comparative study](https://consensus.app/papers/details/w:0116b31f-2253-484d-91ab-ac78dcc18b0b/?utm_source=claude_code)
- **Deep-learning bias correction of WAVEWATCH III SWH (Wang et al., 2026, Oceans).** RMSE vs reanalysis down 28.2%, 26.1%, 24.7% at 24, 48, 72 h; buoy check shows a systematic positive bias corrected, mostly for 0.5–2 m waves. [Deep Learning-Based Bias Correction Model for Spatiotemporal Significant Wave Height Prediction Using Multi-Channel VMRNN](https://consensus.app/papers/details/w:758e3a3a-5e8a-4ff4-8abf-94cb64833e5f/?utm_source=claude_code)
- **Real-time bias correction of ECMWF-IFS SWH, Western North Pacific (Zhang et al., 2023, Ocean Modelling).** MAE down 13–46% by season; worst in winter (13.8–39.0%). [A deep-learning real-time bias correction method for significant wave height forecasts in the Western North Pacific](https://consensus.app/papers/details/w:3f30d067-5e5f-4b4f-bbed-cdaeb748ca54/?utm_source=claude_code)
- **Australian wave forecast with statistical wind correction (Zieger, 2025).** Mean RMSE of SWH 0.29 m across 84 buoy locations; a statistical wind bias correction superseded flux scaling. [The Australian wave forecast system with statistical wind correction](https://consensus.app/papers/details/w:a5378f2b-20d9-49d2-ad40-ef11a6f03fe7/?utm_source=claude_code)

Consensus notice (required): Create or connect a free Consensus account to return more than 3 results per search in Claude Code: https://consensus.app/sign-up/?utm_source=claude_code&auth=claude_code

### 8.3 Agree or disagree, per top-10 item

| # | Item | Tool evidence | Agree? |
|---|---|---|---|
| 1 | React re-render off scrub step | None external (internal measure, board 07:38Z) | Not checked |
| 2 | Water decode to a worker | None external | Not checked |
| 3 | Crest blend between hours | AIFS paper is about a joint model, not blending | Not checked |
| 4 | Linear MOS on 48–72 h | Wang 2026 and Zhang 2023: bias correction of wave forecasts cuts error 13–46%; direction agrees. Our shadow gate fails on hawaii and atlantic | **Agree in direction; our regional gate says not yet** |
| 5 | Exposure sweep for 46267 | No paper found in the two searches; ww3 check failed | Not checked |
| 6 | Hawaii south/east downscale | None | Not checked |
| 7 | Bias line beside MAE | Kocsis 2026 and EMOS: post-processing changes the ranking; bias matters | **Agree** |
| 8 | AIFS source for the EURO lane | Kocsis 2026: raw IFS beats raw AIFS for 10 m wind at all horizons (9,000 stations). AIFS-ocean paper claims marine gain (authors' claim) | **Disagree on the wind lane, mixed on marine.** Do not switch on this evidence alone |
| 9 | Own-frame pump backoff | None (internal bug) | Not checked |
| 10 | EURO/ICON z7 missing frames | None | Not checked |

### 8.4 Status line (for the director)

- **Open:** #912 (draft, no merge): sections 1–8. Nothing merged.
- **Owed:** a re-run of the ww3 46267 check when the server is responsive (with a shorter window); Reflection and SubQ only on David's own typed request.
- **Blocked:** ww3 comparison (server timeout, 1800 s, not retried). Reflection and SubQ not called, pending David's own request.
- **Not used, by choice:** LongCat (no prototype), Logfire (no timing run), latest-science and HF (Consensus covered the question).
