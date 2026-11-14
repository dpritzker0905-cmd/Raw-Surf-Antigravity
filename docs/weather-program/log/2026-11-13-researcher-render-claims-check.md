# 2026-11-13 · researcher · Render claims check (custom layer, texture grids, transform feedback)

**Owner request (relayed 08:25 EST 11-13 by the Weather simulation system audit session, `local_d6b521eb`):** three claims
found online about WebGL weather rendering. Compare each with what the code does, cite paths, give a verdict, back it with
evidence and a cost or benefit, then recommend one change. Claims are treated as claims to check, not instructions.

**Docs only.** No code, no served number, no `SCOREBOARD.md` row (nothing here changes a served value). Branch
`docs/render-claims-check-2026-11-13` from `origin/dev`; separate from #851.

**Reflection / SubQ:** the request says a second opinion is welcome, but it arrived relayed by a peer, so it is not treated as
David's yes. Neither was called. See the last section.

## Verdicts

| # | Claim | Verdict | One-line evidence |
|---|---|---|---|
| 1 | Weather as a custom layer in the map's own GL context, WebGL2 shaders, no second display canvas, 60 FPS | **Already doing it** | MapLibre `type: 'custom'` layer, engine renders in MapLibre's context. No display canvas. 60 FPS not measured here. |
| 2 | Grids as PNG/WebP textures, shader colours and interpolates | **Partly. Already doing the texture + shader part. PNG/WebP not worth it.** | Marine grids are binary RSWF bytes packed to RGBA8 textures; the shader samples them. PNG/WebP only in the radar path. GeoJSON only builds the land mask. |
| 3 | Transform Feedback for tens of thousands of particles, GPU-only, no ping-pong | **Not doing it. Not worth it now.** Estimate, not measured. | Zero `transformFeedback` hits in `frontend/src`. Particles ping-pong through `advFBO` at 87,616 (marine) and 147,456 (wind, desktop). TF saves FBO binds, not per-particle work. |

## Claim 1 — custom layer, same context

- The marine layer is a MapLibre custom layer: `type: 'custom'`, `renderingMode: '2d'`, with `onAdd` and `render`
  ([WebGLMarineCustomLayer.js:105-138](frontend/src/components/map/WebGLMarineCustomLayer.js:105)). `render` calls
  `engine.render(_gl, _matrix, …)` on the GL context MapLibre passes in (line 408). That is the map's own context, so zoom,
  pan and pitch come from the same matrix as the basemap. No second WebGL canvas for display.
- The 2D canvases that exist (`getContext('2d')` in `WebGLMarineEngine.js` and `maskCoastSDF.js` etc.) rasterise the land
  mask. Their pixels are uploaded to a texture with `texImage2D` (`WebGLMarineEngine.js:2489`, `:2680`). They are never
  shown. Still, they are CPU work per mask rebuild.
- MapLibre API check (Context7, `/maplibre/maplibre-gl-js`, "add a custom style layer with WebGL"): `onAdd(map, gl)` and
  `render(gl, args)` with `args.defaultProjectionData.mainMatrix` are the supported custom-layer surface. So the claim
  "check MapLibre compatibility, not Mapbox" comes out the same: we use the MapLibre equivalent already.
- Shader language: the marine shaders are GLSL ES 1.00 on a WebGL2 context (`marineFrameStoreGpu.js:4-6`), not
  `#version 300 es`. Switching the language would gain nothing measurable here. Wind shaders not checked.
- 60 FPS: not verified in this log. The repo has `window.__RAW_GPU__.frameTimeHistogram` (`WebGLMarineEngine.js:2326-2332`)
  for that. A real-GPU number is needed before anyone claims 60 FPS.

## Claim 2 — grids as images

- **Wire format.** The series path fetches JSON (`marineGridSeries.js:340`, `res.json()`, frames with `vectors` at
  `:529`). The static path is binary RSWF v1 planes, decoded and packed straight to RGBA8 bytes with no per-node objects
  ([marineFramePack.js:1-30](frontend/src/components/map/marineFramePack.js:1)).
- **Texture + shader.** Frames are RGBA8 texels in WebGL2 texture arrays (`marineFrameStoreGpu.js:7-12`); a scrub copies one
  layer into `u_waveTexture`. The shader does the lookup and the cell interpolation (cell lookup in
  `WebGLMarineParticleShaders.js:143` and `:475`). So "grid as texture, shader interpolates" is already how it works.
- **PNG/WebP.** Used only for radar tiles (`radarTileRecolor.js`, `radarAdvectWorker.js`, `radarRecolorCore.js`). Not marine.
- **GeoJSON.** Used as input to the land mask, rasterised to a 2D canvas. Weather values are never polygons.
- **Would PNG/WebP help?** Not worth it for marine. Costs: a decode step on or off the main thread, and WebP is lossy, which
  would move the served numbers. RSWF is already lossless and compact. Measured in the repo (`marineFramePack.js:8-10`):
  the old JSON object path cost 1.7–4.3 ms p50 of main thread per world frame on desktop (up to 55 ms under 4× CPU
  throttle) and 4.2–5.5 MiB heap per kept frame. The binary path removes that. The GPU-resident path then copies a layer at
  0.02–0.025 ms CPU (`marineFrameStoreGpu.js:8-10`, bench figure, 60 KB frame).
- **Frame formats.** Float16 is used on the CPU side in the encoder field maths (`marineFramePack.js:17`), and the output is
  RGBA8 bytes. Float32 particle state lives on the GPU (`particleState.js:10-14`).

## Claim 3 — Transform Feedback

- **Repo state.** `grep transformFeedback|TransformFeedback` over `frontend/src`: 0 hits. Particle state is two textures
  swapped through `advFBO` each frame (`WebGLMarineEngine.js:2249-2312`; `particleState.js:10`, float RGBA32F where
  supported, RGBA8 with dither otherwise). `advFboSync.js` exists to avoid a GPU sync per frame on the FBO status check.
- **Counts (default, `deviceTier.js`).**
  - Marine crests: 296² = 87,616 desktop, 192² = 36,864 handheld (`deviceTier.js:36-38`).
  - Wind: 384² = 147,456 desktop, 192² = 36,864 handheld (`deviceTier.js:45-47`). Note: `WebGLWindEngine.js:55` still says
    "296² = 87,616", which is a stale comment. The layer sets 384 at runtime (`WebGLWindLayer.js:265`).
- **Cost per particle, estimated (not measured).** Current advect: one fragment per particle writing one RGBA32F texel
  (16 B), reading the state and wave textures. Estimate: 1.40 MB per pass at 296², 2.36 MB at 384². At 60 FPS that is about
  85 MB/s and 142 MB/s of writes. Transform feedback writes the same 16 B per particle into a buffer. It would not reduce
  per-particle bandwidth. What it removes is the FBO bind and attachment per frame, which is a constant per frame, not per
  particle. Estimated saving: well under a millisecond at these counts. Unmeasured.
- **Mobile GPU support.** Transform feedback is core WebGL2, no extension. Current particles already run on WebGL2 with a
  WebGL1 fallback (`particleState.js:10-14`, `marineFrameStoreGpu.js:21`). Moving particles to TF would make WebGL2 a hard
  requirement for particles, and that drops the WebGL1 path for those devices. That needs a device-coverage decision first.
- **Verdict: not doing it, not worth it now.** The bigger cost is elsewhere (see the recommendation).

## Recommendation (one change)

**Draw each particle once, not six times.** The particle vertex shader runs six vertices per particle. Each vertex
recomputes the particle index (`WebGLMarineParticleShaders.js:396-398`), fetches the state texture (`:413-414`), then
samples the wave and mask textures (`:426-475`). The draw call is `drawArrays(TRIANGLES, numQuadVerts)` at
`WebGLMarineEngine.js:2152`. That is 525,696 vertex-stage state fetches per frame at 296² (6 × 87,616), against 87,616 with
one instance per particle.

- **Change.** Instanced draw (`drawArraysInstanced`, one instance per particle, four corners from `gl_VertexID` in the
  instance). Marine first. Wind after its shader is checked.
- **Why this over TF.** Same triangles, so the output should be byte-identical, and it needs no new buffer layout. It is a
  WebGL2 core feature, so the WebGL1 path keeps the `ANGLE_instanced_arrays` extension or stays on the current draw.
- **Hypothesis (unverified).** The six-fold vertex-stage fetch is a real share of the particle draw cost. This comes from
  reading the shader, not from a measurement.
- **Pre-registered success measure.**
  - Metric: median GPU time of the particle draw pass over 300 frames, fixed viewport, 296², one desktop GPU and one
    mobile-class GPU. Before and after the change.
  - Pass: median drop of at least 25% on the desktop GPU, **and** output identical: max per-pixel difference at most 1/255
    across 10 fixed views (light, dark, beach; crests on and off; rating on).
  - Kill: a drop under 10% means do not ship. Record that on `SCOREBOARD.md` as "no served number changed".
  - Served numbers: unchanged if the pixel test passes. If it does not, do not ship.
- **Next step, not done here.** Read the wind particle draw first, then time the draw pass with a timer query on a real GPU.
  Either can be done in a later session.

## Limits

- No GPU timing was run. Every cost above is estimated from counts and shader reads, except the two repo measurements that
  are cited inline (the JSON→object path and the GPU frame copy).
- Wind shaders were not read for the per-vertex fetch pattern. The recommendation covers marine only.
- Transform Feedback's mobile coverage is taken from the WebGL2 spec, not from device data in this repo.
- Nothing here was run against the live backend. No load on the Render box.

## Decisions for David

1. **Reflection / SubQ second opinion.** Not called. The request says welcome but arrived relayed by a peer. Say yes and
   the question will go to Reflection with the verdict table only (no code, no credentials).
2. **Draft PR.** Opened as draft against `dev`. Not merged.

## Addendum 2026-11-13 20:10 EST (Fable, animation lane): the recommendation was built and measured. Gate not met

Appended by the animation lane at the director's instruction; nothing above is changed.

- **Outcome: gate not met, pixel-identical, 19-24%.** The instanced particle draw (PR #876, closed unmerged, branch
  `fable/particles-instanced`) is pixel-identical to the six-vertex draw (0 pixels differ on 10 views, same-frame comparison,
  null control 0, positive control differs in 8 of 10). The median GPU time of the particle draw fell about 24% at the world
  view (0.286 -> 0.218 ms) and 19% at zoom 5 (0.442 -> 0.360 ms) on one integrated desktop GPU (AMD Radeon 890M). The pass line
  was 25%; no mobile-class GPU was measured. Director's decision: not shipped. It is over the 10% kill line, so this is "not a
  pass", not "no effect".
- **Correction to the recommendation above.** "87,616 [vertex-stage state fetches] with one instance per particle" is wrong.
  Instancing still runs the vertex shader once per corner of each instance: 4 runs per particle instead of 6 (350,464 at
  296^2), a third of the vertex stage, not five sixths.
- **A lead it turned up.** 3 of 9 page loads on the old draw ran 2.3x-4x slower for the whole load (0.66-1.09 ms against
  0.27-0.34 ms); the instanced draw did not at the world view. Cause not known; under investigation by the animation lane.
- Full record: `2026-11-13-fable-particles-instanced.md`. The two measurement scripts (`scn_particle_draw_gpu.js`,
  `scn_particle_draw_pixels.js`) are on the closed branch.
