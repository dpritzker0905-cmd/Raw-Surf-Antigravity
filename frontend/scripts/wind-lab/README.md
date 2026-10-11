# Ground Truth: the wind-look lab

A p5.js + WebGL page that draws one seeded wind three times, on dark, beach and light grounds, and measures each frame the way the
wind bench reads a crop. Built 2026-10-11 to answer the owner's "light mode and beach mode's wind animations [should] follow the same
rules as dark mode". The finding it produced is `docs/research/FINDING-2026-10-11-dark-s-rules-on-any-ground.md`, and the lessons
are LESSONS L-V30 to L-V33. The published copy (private to the owner) is linked in
`docs/weather-program/log/2026-10-10-light-look-ab.md`.

**It is a model, not the engine.** Its colour tables are copied from `src/components/map/WindColorRamp.js` at `a12135b`, and its
particle law, casing, fade and composites from `WebGLWindShaders.js` / `WebGLWindEngine.js` / `WebGLWindUtils.js`. If those change,
the lab does not follow them. Re-copy the tables before trusting a number from it. Its limits are in the FINDING's section 6.

| File | What it holds |
|---|---|
| `core.js` | Colour maths (sRGB, CIELAB, OKLab/OKLCH, CIEDE2000, Machado CVD), the engine's tables and composites, `huePathStops`, and `solveTheme`, the solver for dark's rules on any ground. Pure; `require()`-able from node. |
| `sim.js` | The seeded coastline and the wind field (from a streamfunction, so it has no sources or sinks). Uses p5's `noise` and `random`. |
| `gl.js` | The engine's pipeline in miniature: point-sprite marks with the casing, the 8-bit floor fade, and each theme's composite. |
| `main.js` | Parameters, the frame loop (the engine's advection and respawn law), the instruments, the overlay and the UI handlers. |
| `page.src.html` | The page, built from the algorithmic-art viewer template; the parts above are inlined at build. |
| `PHILOSOPHY.md` | The piece's algorithmic philosophy. |

```bash
node build.mjs                                   # -> out/ground-truth.html (p5 from cdnjs) and out/ground-truth.local.html
# offline test: put p5 1.7.0 beside the local page (the CDN may be blocked in a sandbox)
curl -sSL https://registry.npmjs.org/p5/-/p5-1.7.0.tgz | tar xz -C /tmp && cp /tmp/package/lib/p5.min.js out/
PLAYWRIGHT_BROWSERS_PATH=<browsers> node test.mjs          # readouts + a canvas screenshot (shot.png); VW=390 for phone
CASES='[{"set":{"olive":0},"shot":"g0.png"}]' node sweep.mjs   # set parameters and read the instruments per case
node -e "const C=require('./core.js'); const T=C.buildTables('dark',{}); console.log(C.cvdFloor(T,'light','land'))"
```

The defaults (room L* 58, name guard L* 76, colour floor C* 25, ring 0.25, the engine's dose of 490 marks per 100 × 100 px, seed
1963) are the result of the sweeps logged in the FINDING. Never point this at the live backend: it needs no data.
