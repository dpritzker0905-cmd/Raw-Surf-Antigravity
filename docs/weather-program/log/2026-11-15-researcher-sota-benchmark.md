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
