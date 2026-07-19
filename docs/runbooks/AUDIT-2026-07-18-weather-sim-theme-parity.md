# AUDIT — weather-simulation THEME PARITY (light / dark / beach)

Date: 2026-07-18 (EVE-3) · Trigger: user tested light + beach mode and reported three symptoms —
poor marine heatmap **colour-key contrast**, **wave animations** blending into the heatmap, and
**wind animations** blending into the heatmap; then added a fourth: at **very light wind speeds
direction is unreadable**, which is needed to watch low-pressure systems form.

Binding rule: `CLAUDE.md` — THREE THEMES, ALL DEVICES. Every rendered surface must work in light,
dark AND beach, on desktop AND mobile.

---

## 0. The Jacobian — one sentence

**Theme-awareness was retrofitted subsystem-by-subsystem, and it stopped at the boundary between
the FIELD and the MARK drawn on top of it.** Every heatmap/field program is theme-aware; the
particle/animation programs drawn over them were tuned once against dark. Because a particle and
the field beneath it are coloured by *the same function of the same variable*, the mark can only be
seen via a luminance separation — and that separation was the theme-blind part.

---

## 1. Inventory — what is theme-aware, and what is not

Method: `grep` for `useTheme` / `isLight` / `isBeach` / `u_theme` across `frontend/src/components/map`.

| Surface | Theme-aware? | Evidence |
|---|---|---|
| Weather controls / legend chrome | ✅ YES | `MapWeatherControls.js` — 17 theme refs |
| Forecast overlay | ✅ YES | `MapForecastOverlay.js` — 6 refs |
| Marine heatmap shader | ✅ YES | `WebGLMarineShaders.js` — `u_theme` ×4, 6 branches |
| Marine particle shader | ⚠️ PARTIAL | `WebGLMarineParticleShaders.js` — `u_theme` ×3 but only **2** branches vs the field's 6 |
| Wind heatmap (field) | ✅ YES | `WebGLWindShaders.js` HEATMAP_FS + per-theme alpha floors (0.45 beach / 0.35 light / 0.20 dark) |
| **Wind particle (DRAW) program** | ❌ **NO → FIXED** | `u_theme` was bound to `heatmapProgram` **only** (`WebGLWindEngine.js:351`); `drawProgram` never received it |
| Wind colour ramps | ✅ YES | `WindColorRamp.js` — `THEME_RAMPS {beach, light, dark}` |
| Wind legend | ✅ YES | `MapWeatherControls.js` — inline `isLight`/`isBeach` gradients |
| Pressure legend ↔ shader sync | ✅ YES | `applyThemePressureScale(theme)` (`790c9f8a`) |
| Wave legend ↔ shader sync | ✅ YES | `applyThemeWaveScale(theme)` |
| **Wind legend ↔ ramp sync** | ⚠️ **NO FUNCTION** | there is no `applyThemeWindScale`; the legend is a hand-duplicated literal copy of `WindColorRamp.js` |

### 1a. A hypothesis I checked and KILLED
I expected the wind legend to be un-themed and therefore *wrong* in light/beach. It is not. The
inline gradients were verified numerically against the ramps — e.g. `LIGHT_WIND_RAMP[0] =
(0.08, 0.18, 0.36, 0.75)` → `rgba(20,46,92,0.75)`, matching the legend literal exactly; all eight
stops match on all three themes. **No drift today.** But see §4 DEBT-1: they are two hand-synced
sources of truth with nothing enforcing the sync.

---

## 2. ROOT A — the animation is coloured identically to the field it sits on

Not a theme bug. A **structural** one, which the themes merely amplify.

```
particle (DRAW_FS):   color = texture2D(u_color_ramp, v_speed / u_max_speed)
field    (HEATMAP_FS): color = ramp(speed / u_max_speed, u_theme)
```

Same ramp, same normalised speed ⇒ **at any pixel the particle's colour equals the pixel behind it
BY CONSTRUCTION.** No palette edit can fix this; chroma contrast is mathematically zero. The only
available signal is a *luminance* separation, which is exactly what DRAW_FS's rim (dist 0.28–0.46,
98 % black) and core (dist < 0.18, 75 % white) were added for.

**The gap:** those were fixed black/white constants, and DRAW was the one wind program never bound
to `u_theme`. Tuned on dark (neon ramp on dark navy → black rim reads, white core pops), they
**invert in light**, where the field ramp is deep navy→teal→gold on a *light* basemap: a 98 %-black
rim is camouflage against the very field it must separate from. Beach's bright coral/yellow field
washes out the white core, the mirrored failure.

**FIX** — `u_theme` + `u_theme_rim` now bound to `drawProgram`; rim/core chosen per theme so the rim
always runs *away* from the local field luminance:

| Theme | Field character | rim → | core → |
|---|---|---|---|
| dark | neon on dark navy | 0.0 (black), k=0.98 | 1.0 (white), k=0.75 — **unchanged** |
| light | dark navy/teal on light basemap | **1.0 (white halo)**, k=0.92 | **0.05 (dark)**, k=0.70 |
| beach | bright pink/coral/yellow | 0.06, k=0.95 | 1.0, k=0.55 (weaker — white on sun-yellow is invisible) |

Kill: `__RAW_DISABLE_THEMED_PARTICLE_RIM__` → restores the legacy black/white pair.

---

## 3. ROOT B — light winds carry no direction cue (the low-pressure use case)

Direction is perceived only through the particle's *mark* and its motion. Two independent
mechanisms erase it at exactly the speeds and zooms that matter:

1. **Sub-pixel contrast geometry.** rim and core are *fractions of the sprite*.
   `sizeBase = v_speed < 0.5 ? 0.0 : 2.5 + 2.5*smoothstep(1,30,v_speed)`. At low speed the sprite is
   ~2.5 px, so the rim band ≈ 0.45 px and the core ≈ 0.45 px — **both sub-pixel.** The particle
   rasterises as a flat dot of exactly the field colour. The separation mechanism from §2 *cannot
   physically render.*
2. **The existing rescue is gated on the wrong zoom.** The low-speed boost fires only at
   `u_zoom > 7.0` — i.e. zoomed IN. **A forming low is read at synoptic scale (z3–6)**, where
   `zoomBoost = 1.0`. The rescue was absent precisely where the user needs it.
   (Compounding, not fixed here: `offset *= pow(speedNorm, u_speed_gamma - 1.0)` with γ=1.15 damps
   slow particles *further*, shortening low-wind trails. Lever: `__RAW_WIND_SPEED_GAMMA__`.)

**FIX** — a minimum sprite diameter for slow-but-moving air **at any zoom**, sized so rim and core
are ≥ 1 px: `minPx = mix(4.0, 6.5, slowness) × (1 + smoothstep(6,11,zoom)×0.6)`, applied for
`0.15 ≤ v_speed < 10`. Truth is preserved — colour still encodes speed exactly; only the **mark's
legibility** changes, never the data. Sub-0.15 (genuinely calm) stays invisible, as it should.

Kill: `__RAW_DISABLE_LOWWIND_LEGIBILITY__`.

---

## 4. REMAINING DEBT (not fixed in this pass — ranked)

- **DEBT-1 — wind legend is a hand-duplicated copy of `WindColorRamp.js`.** Two sources of truth,
  verified in sync *today* by hand (§1a), with nothing enforcing it. Pressure and wave both have an
  `applyTheme*Scale` sync function; wind does not. **Fix: add `applyThemeWindScale(theme)` deriving
  the legend gradient FROM `THEME_RAMPS`, plus a test asserting legend ≡ ramp for all three themes.**
  This is the highest-value remaining item: it converts a standing drift risk into an invariant.
- **DEBT-2 — marine particle shader has 2 theme branches vs the marine field's 6.** Same class as
  ROOT A but on the wave side; the user's symptom #2 ("wave animations blend with the heatmap") most
  likely lives here. Needs the same field-vs-mark separation audit ROOT A got.
- **DEBT-3 — marine heatmap colour-KEY contrast** (user symptom #1). The key swatch is drawn on the
  panel background; its legibility depends on panel-vs-swatch contrast, not on the shader. Needs a
  measured contrast-ratio pass per theme (WCAG 3:1 for graphical objects) — a11y-adjacent, and it
  pairs with the standing accessibility mandate (information not by colour alone).
- **DEBT-4 — `u_speed_gamma` = 1.15 damps slow particles.** Deliberate speed-contrast choice that
  works against low-wind legibility. Left alone; revisit if §3's sizing proves insufficient.

---

## 5. Verification

Units: `WebGLWindShaders.test.js` 17/17 (7 new: theme uniforms present, three-way branch, light's
inverted rim, kill-switch default, min-size at any zoom, boost bounds, and a **no-stray-backtick**
guard — a backtick in a comment inside these template-literal shaders terminates the string and was
a real self-inflicted break during this work). Full suite 1200/1200.

Live: `probe_wind_themes.js` (session scratchpad) — boots each theme, enables Wind, parks at a
synoptic N-Atlantic view (z4.2, the low-spotting scale), and A/Bs both kill switches. Metric is
**mean |Laplacian|** over a central ocean crop: particles are small marks on a smooth field, so
global SD is dominated by the field's own gradient while the Laplacian responds to the marks.

| theme | before (both kills ON) | after | Δ |
|---|---|---|---|
| dark | 6.066 | 9.035 | **+48.9 %** |
| light | **2.977** | 7.062 | **+137.2 %** |
| beach | 5.643 | 7.080 | **+25.5 %** |

All six legs verified `toggle=clicked`, `windEngine=true`, `zoom=4.2`. **The pre-fix numbers are
the finding**: light sat at *half* dark's mark contrast (2.98 vs 6.07), which is precisely the
reported symptom, and light is the theme where the rim was inverted. After, all three land in a
comparable 7–9 band.

⚠️ Metric caveat (stated so nobody over-reads it): the central crop partially overlaps the
Diagnostics HUD, whose text contributes constant local contrast to BOTH legs. It cancels in the
delta but dilutes the percentage — the true map-only deltas are **larger** than the table. The
ranking and direction are unaffected.

Two probe defects found and fixed while building this — worth knowing before reusing it: (1)
`gl.readPixels` on the live canvas returns nothing after compositing (no `preserveDrawingBuffer`),
and the page CSP blocks reloading a screenshot as a `data:` URL, so pixel stats must be decoded
**in Node** (the probe carries a small zlib-based PNG reader); (2) searching for the Wind chip after
a fixed delay raced the control render — leg 1 passed warm and every later leg reported NOT FOUND.
Poll for the control instead.
