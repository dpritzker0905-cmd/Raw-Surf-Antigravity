# HANDOFF 2026-07-19 — the wind-legibility arc (6 rounds), and what is still open

HEAD `4b13a080`, pushed to `origin/dev`. Suite **1234/1234**. Build verified exit 0 earlier in the
session (after the ESLint dependency change).

---

## 0. READ THIS FIRST — the one thing that matters

**Every contrast number produced in rounds 2–5 of this arc was measured against the wrong
background, including the ones I reported to you as wins.**

A wind particle does not sit on the ramp colour. The wind field is **semi-transparent** —
`HEATMAP_FS` draws it at `u_opacity * (baseAlpha + (1-baseAlpha)*smoothstep(0,10,speed))`, which in
light mode is only **~0.23 at low wind**. The surface a mark is actually drawn against is the ramp
**composited over the basemap**. I was measuring against the ramp alone.

Measured against the real composite, before round 6:

| theme | worst actual | at | best available | verdict |
|---|---|---|---|---|
| **light** | **1.71:1** | 0 kn | 12.25:1 | **6 of 8 speeds FAIL 3:1** |
| dark | 2.58:1 | 0 kn | 8.14:1 | fails at calm |
| beach | 4.04:1 | 39 kn | 5.20:1 | passes — which is why beach alone read as "improved" |

That is the whole "light mode is really hard to see" report, and it was a measurement error of
mine, not a taste disagreement.

**The finding worth keeping:** judged on the composite, **both themes invert at low wind** —
- dark @0 kn: alpha 0.10 over a dark basemap → bg 0.079 (DARK) → needs a **WHITE** ring
- light @0 kn: alpha 0.23 over a light basemap → bg 0.563 (BRIGHT) → needs a **DARK** ring

Each theme needed the *opposite* of what its own ramp suggested, at exactly its calmest speeds.
Now asserted as a test, not a comment.

After the fix, worst outer-ring vs the real background across all 13 Beaufort stops × 3 themes:
**light 1.71 → 6.55:1 · dark 2.58 → 4.96:1 · beach 4.04 → 5.33:1**, internal casing edge 17.9:1,
no stop failing 3:1 in any theme.

---

## 1. What shipped, in order

| commit | what |
|---|---|
| `86d03cbd` | theme parity: wind DRAW program had never been bound to `u_theme` at all |
| `dd517c7a` | dual-tone casing, DPR-correct sizing, z≥4 respawn density |
| `974a8b46` | Beaufort-anchored 13-band ramps + linear-luminance pole choice |
| `cd576a04` | ink-budget fix for the clumping |
| `84132898` | oriented DASH + zoom-aware floor |
| `4b13a080` | **composited-background pole choice — the light-mode root** |

Also this session, outside the wind arc: `8b002f73`+`25511f22` marine commit ARBITER (3000/3000
differential, default still guards), `41ba5472` ESLint repaired repo-wide (it was crashing on every
file; found a live `ReferenceError` in `MapPage.js`).

## 2. Every kill switch added

`__RAW_DISABLE_THEMED_PARTICLE_RIM__` · `__RAW_DISABLE_LOWWIND_LEGIBILITY__` ·
`__RAW_DISABLE_WIND_DASH__` · `__RAW_DISABLE_WIND_DENSITY_UNIFORM__` ·
`__RAW_DISABLE_WIND_VIEWPORT_DENSITY__` · `__RAW_WIND_DPR__` (test override) ·
`__RAW_WIND_SPEED_GAMMA__` (pre-existing).

## 3. Gates now standing (all enumerate — none sample)

- `windParticleContrast.test.js` — per-speed contrast, **on the composite**, 13 stops × 3 themes,
  plus pole-optimality and mobile/DPR.
- `windParticleDensity.test.js` — ink budget, never-hoard, fast regime bit-identical, both shader
  stages agreeing on the size curve, and ADVECT_FS never taking a theme input.
- `windParticleScale.test.js` — 7 zooms × {1,2,3} DPR × 8 real GFS speeds.
- `marineCommitArbiter.differential.test.js` — 3000-fixture guard-vs-arbiter sweep.

## 4. 🔴 STILL OPEN

1. **The circulation centre (Invest 91L) — never addressed.** A vortex core is where |wind| → 0 but
   ROTATION is the signal. Particles vanish below 1 kn and are further damped by
   `u_speed_gamma`=1.15, so the core reads as dead air. This is a **flow-visualisation** change
   (seeding / persistence / curl-aware treatment near a detected core) — explicitly *not* solvable
   with palette or size. I have fetched real Gulf GFS data for it (`frontend/scripts/` probes) but
   did no implementation.
2. **Live visual verification of rounds 5–6 was never completed.** The zoom × device × theme sweep
   was started three times and interrupted each time. **The numbers in §0 are analytic (exact
   shader arithmetic), not screenshots.** Run:
   `ZL_WZOOM=3 node scripts/probe_wind_themes.js http://localhost:3011 scripts/wind-themes-out/z3`
   (also 5.5 and 9) — each sweeps both device classes and all three themes.
3. **Marine layers on real devices** (iPhone/Galaxy) — queued, untouched. The marine engine has
   **not** been audited for the DPR defect fixed in wind.
4. `applyThemeWindScale` still does not exist — the wind legend is a hand-duplicated copy of
   `WindColorRamp.js`. Verified in sync by hand today; nothing enforces it.
5. Marine particle shader has 2 theme branches vs its field's 6 (the wave-animation blend symptom).
6. ARBITER Phase C default flip needs a stateful sequence harness first.

## 5. Traps that cost real time — do not relearn

- **Shader edits do NOT take effect on HMR.** WebGL programs compile once at engine init, so
  hot-reload swaps the source string while the running engine keeps the old program. **Hard-reload**
  after any shader edit. This is why a probe can report a large delta while your own tab shows
  nothing.
- **A backtick inside a comment in these template-literal shader files breaks the build.** It bit me
  three times. There is a test guarding it now, but the file must parse for the test to run.
- **`gl_PointSize` is in DEVICE pixels** and this pipeline had zero DPR handling anywhere — every
  geometric mark was ~3× physically smaller on a DPR-3 phone.
- **A round disc carries zero direction information at any size.** I grew the mark for four rounds
  to make casing rings resolve; direction comes from **elongation**, which is why the mark is now a
  dash.
- **Probe trap:** the localhost-only Marine Anim Tuner covers a 390 px viewport entirely — set
  `localStorage.__RAW_TUNER__='0'` or you measure the panel. A first mobile run returned an
  identical value in both legs and looked like a clean "0.0% delta".
- **Metric trap in my own test:** differencing shipped-vs-legacy at DPR 3 measures the DPR *fix*
  (legacy sizing is DPR-blind) and flags the correction as the regression. Compare at DPR 1.

## 6. The recurring lesson

Four separate times this session, a number I reported was produced by the wrong instrument:
an average that hid a per-band failure; a soak whose 89/89 hid 166 divergences; particle *count*
where the eye reads *ink*; and contrast against a background that is not on screen. Each was caught
by **enumerating the space instead of sampling it**. Every gate listed in §3 enumerates for that
reason.
