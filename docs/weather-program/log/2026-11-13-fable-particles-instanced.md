# 2026-11-13 Fable (animation lane): marine particles as one instanced quad. Pixel-identical; GPU drop below the 25% pass line

The researcher's recommendation in `2026-11-13-researcher-render-claims-check.md` (#865), with its pre-registered gate:
PASS = median GPU time of the particle draw down at least 25% on a desktop GPU AND pixels identical (max 1/255) on 10 fixed
views; KILL = a drop under 10%. **Result: pixels identical (0 differing); the median drop is about 24% (world view) and 19% (a
closer view), under the pass line and over the kill line. No mobile-class GPU was measured. So the gate as written is NOT met;
the PR stays a draft for the owner's or the coordinator's call.** Client only, no served number.

## A correction to the hypothesis
The log proposed "one instance per particle ... 87,616 vertex-stage state fetches instead of 525,696". Instancing cannot do
that: WebGL has no per-primitive stage, so the vertex shader still runs once per CORNER of every instance. What instancing
removes is the two repeated corners of the six: 4 runs per particle instead of 6, a third of the vertex stage (350,464 runs at
296^2, not 87,616).

## The change (`particleInstancedDraw.js`; kill `window.__RAW_DISABLE_PARTICLE_INSTANCED__ = true`, read at engine init)
- Draw: `drawElementsInstanced(TRIANGLES, 6, UNSIGNED_BYTE, 0, N)` with corners 0..3 = BL, BR, TL, TR and indices
  [0,1,2, 2,1,3]: the same two triangles in the same vertex order as the old six vertices (BL, BR, TL, TL, BR, TR).
- Shader: the same text except how it learns the particle and the corner (5 lines out, 4 in; pinned line by line in the test).
  Still GLSL ES 1.00: the particle id is an instanced attribute (divisor 1), the corner a 4-vertex attribute.
- Buffers: N floats + 4 floats + 6 bytes instead of 6N floats (0.35 MB instead of 2.1 MB at 296^2).
- WebGL2 only. WebGL1, or a shader whose text no longer matches the rewrite, keeps the six-vertex draw.
- Marine only. The wind engine is not touched and was not read.

## GPU time (measured, not estimated)
`scn_particle_draw_gpu.js`: offline app, waves on, the map still; a TIME_ELAPSED timer query around the particle draw call
alone; median of 300 samples per page load; arms interleaved; 87,616 particles; no disjoint result. GPU: AMD Radeon 890M
(integrated), ANGLE Direct3D11, headless Chromium. Per-load medians in ms:

| view | instanced | classic (kill) |
|---|---|---|
| world (-55, 38, z3.2), 1280x800 | 0.224, 0.218, 0.213, 0.211, 0.218, 0.220 | 0.661, 0.284, 0.291, 0.266, 0.274, 0.288 |
| closer (-4, 50, z5), 1280x800 | 0.368, 0.345, 0.514, 0.351 | 0.445, 0.439, 0.445, 0.369 |
| phone profile (390x844, dpr 3, CPU 4x), world | 0.252, 0.252, 0.253 | 0.339, 1.065, 1.087 |

- World view: median of the load medians 0.218 against 0.286 = **-24%**. Closer view: 0.360 against 0.442 = **-19%** (one of the
  four pairs is reversed). Both are under the 25% pass line.
- The classic draw has a slow mode the instanced draw did not show: 3 of 9 classic loads sat at 0.66-1.09 ms for the whole
  load (2.3x-4x), 0 of 9 world-view instanced loads did (one closer-view load read 0.514). Cause not investigated. Counting
  those loads by MEAN the drop is larger (world: 0.217 against 0.344 = -37%), but the pre-registered statistic is the median.
- In absolute terms the pass is small on this GPU: 0.06-0.08 ms saved per frame of a 16.6 ms budget in the usual case.
- The phone profile throttles the CPU only; it is this same GPU, and it kept 87,616 particles (the handheld tier did not
  apply under emulation). **No mobile-class GPU was measured**, which the gate's metric asks for.

## Pixels (`scn_particle_draw_pixels.js`)
Particles move and are seeded at random, so two page loads never show the same frame. The comparison is made inside ONE frame:
at a real particle draw call, with the engine's program, 75 uniform values, textures and blend state bound, the particles are
drawn into an offscreen RGBA8 target by the app's instanced path (A, and again B), by the classic path rebuilt from the same
shader with the rewrite undone and 6N vertex ids (C), and by the classic path with the last 2,000 particles left out (D).

| | result over 10 views (dark x4, light x3, beach x3; 1080x800 buffer; 139k-346k lit pixels each) |
|---|---|
| test, A vs C | **0 pixels differ, max difference 0** in all 10 |
| null control, A vs B | 0 pixels differ in all 10 |
| positive control, A vs D | differs in 8 of 10 (74 to 7,085 pixels); in 2 views the omitted particles were not on screen |

Limits: the offscreen target has no depth or stencil buffer (neither test is enabled for this draw: read back as off). The
"rating on" view clicked the Surf Rating chip but did not verify the rating was drawn. "Crests off" has no particle draw, so
there is nothing to compare. Only the first world copy's draw of a frame was compared. Desktop buffer size only.

## Tests
+8 in `particleInstancedDraw.test.js` (the shader differs only in the pinned lines; the indexed corners equal the six
vertices in order; a moved shader is not rewritten; mode choice and telemetry; the OFF path; WebGL1; buffers, divisor and the
one instanced call; the engine draws only through the module). Kill listed in `killSwitch.inventory.test.js`. The 7 suites
that mention the engine init or the draw call pass locally (357 tests).

## Not done / not verified
- A mobile-class GPU and a discrete desktop GPU; Safari and Firefox (no timer query there in general).
- Why the classic draw has a slow mode on some loads.
- Wind particles (384^2 on desktop: more vertices than marine) use their own engine and shader: not read, not changed.
- Frame rate. Nothing here says the app is faster to the eye; the pass is under 1 ms either way on this GPU.
