# 2026-11-03 · Claude · map motion fixes (ON, a kill switch each)

Branch `claude/map-motion-fixes` (worktree `C:/t/mmf`, from dev `35feaaac6`, then dev `f96fd8359` merged in). Draft PR only.
Owner, 2026-11-03 ~21:25Z, asked whether to build the visual fixes for an A/B: "lets switch them on, if we made them to be on,
they need to be turned on". These are client-only fixes to how particles MOVE; no served number changes (no SCOREBOARD row).
Source: the L4 graphics research of 2026-11-02 (memory `research-graphics-math-2026-11-02`).

## What changed

| Fix | Module | Kill switch |
|---|---|---|
| Particle state RGBA32F (EXT_color_buffer_float); fallback RGBA8 + stochastic rounding, rounded in the shader to exact codes | `particleState.js` | `__RAW_DISABLE_FLOAT_PARTICLE_STATE__` |
| RK2 midpoint advection, wind and crests | `particleRk2.js` | `__RAW_DISABLE_RK2_ADVECTION__` |
| Crest phase in local coords (p minus the tile centre, a view anchor when the tile is the world), x wrapped, 11 fixed period classes (4 s x 2^(j/4)) cross-faded by T, class phases integrated on the CPU and bounded, 1.5 s anchor cross-fade; #404's zoom factor kept | `crestLocalPhase.js` | `__RAW_DISABLE_CREST_LOCAL_PHASE__` |
| Wind u/v bytes round on a zero-aligned lattice (calm decodes as 0) | `windEncoderRound.js` | `__RAW_DISABLE_WIND_ENCODER_ROUND__` |
| Crest density by R2 texel rank with a soft edge; share follows the old hash's measured share from above, so no zoom draws fewer crests | `crestTexelRank.js` | `__RAW_DISABLE_CREST_TEXEL_RANK__` |

Each kill set before load leaves the shader TEXT byte for byte as dev (`motionFixes.killSwitch.test.js` pins the dev hashes of marine
ADVECT_FS / DRAW_VS / DRAW_FS and wind ADVECT_FS / DRAW_VS / DRAW_FS). Set live, the uniforms restore the old behaviour; the float
kill reseeds the particles into RGBA8 textures. A float framebuffer refused at draw time falls back to RGBA8 + dither instead of
switching the crests off. The marine height encoder (/10 path) is NOT touched.

LOC ratchet: the two shader files shrank (marine 978 -> 960, wind 1029 -> 1008); WebGLMarineEngine.js 3197 -> 3199 (baseline 3207).

## Measured (GPU proof: real GLSL from the modules, ANGLE d3d11 AMD Radeon 890M and SwiftShader, 200 frames)

- Sub-quantum steps, realised per frame (q = 1/65025 of the tile), RGBA8 | RGBA8 + dither | float, d3d11:
  0.05 q -> 0 | 0.055 | 0.050; 0.2 -> 0 | 0.195 | 0.200; 0.45 -> 0 | 0.455 | 0.450; 0.55 -> 0 (d3d11's unorm threshold sits near 0.6 q)
  | 0.575 | 0.550. A first dither that left the rounding to the driver read 0.1 q low on d3d11; rounding in the shader fixed it.
- Wind (float state): every speed and heading at z5/z6 moves at 1.00x with heading error <= 0.43 deg; RGBA8 froze 1-2 kn at z5 and
  1-3 kn at z6, 5-8 kn read 7-35 deg off at 0.71-1.22x.
- Rankine vortex, 30 frames, radius drift: Euler 20 kn +11.2% at the core, 40 kn +33.1%, 40 kn at 30 Hz +76.1%; RK2 0.00-0.47%
  (7.7% inside the core at 40 kn/30 Hz, the (omega h)^4/8 bound).
- Crest phase on the real GFS-Wave North Pacific field (L4 `npac_field.json`): old |grad phase|/F p50 4.09, 37.2 deg off the swell
  (L4: 4.2, 37); after 10 min 8.96, after 1 h 35.6; the same sea 0.4 world east 7.15. Local: p50 1.00 at every time and longitude;
  angle to the swell p50 1.5 deg within 0.01 world of the anchor, 4.3 deg at 0.01-0.03, 13.3 deg at 0.03-0.06, 35.6 deg beyond 0.06
  (the heading's curvature times the distance: a single anchor cannot do better; phasor noise is the long-term fix).

Scripts and numbers: session scratchpad `gpu/gpu_proof.cjs`, `gpu/gpu_proof.txt`, `gpu/gpu_proof.json` (not in git).

## Offline harness (built client over `serve_synthetic.py`, ab_lib routing, no live box)

Dark, light, beach x desktop 1440x900 and phone 390x844 dpr 3: Waves and Wind on, float state ON in both engines, advect FBO complete,
0 page errors (console: the known offline RainViewer / resource failures). The all-kills arm reads stateFloat false, crest phase off.
Host audit per run: onrender asks answered locally, only fonts / jsdelivr left the machine, sockets blocked.

## Tests

+6 suites / +54 tests (frontend floor 532/6986 -> 538/7040). Four older suites that pin an older DRAW_VS/ADVECT_FS byte for byte
import `motionFixesKill.testsupport.js` (the same pattern as the beach-lift support file); `windDarkRules.test.js` classifies the
encoder kill as orthogonal (data precision, no table). Local: map + tests 459/459 suites, 6354 tests; ESLint ratchet pass; build ok;
`wind-color/check.mjs` 0 red lines.

## Open, for the owner

- Colour/ramp fixes from L4 section 4 (dark and beach wash lightness, calm-end slope, crest Lc zero bands): need the owner's A/B pick.
- The marine HEIGHT encoder (/10 path floors, -1.96 cm mean): moves what dark mode and the rating draw; a separate decision.
- The texel-rank share is calibrated to the d3d11 read-back of the old hash; other GPUs' hashes differ (SwiftShader kept more at
  tau 0.02-0.05). Owner's eye on the live map.
- `scripts/wind-bench/run.js` fails on dev itself (`readTrail` reads `screenA.fbo` of undefined): tool drift, not this change.
