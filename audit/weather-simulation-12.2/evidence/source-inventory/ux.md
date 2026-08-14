# AUDIT 12.2 — AREA: PRODUCT + USER COVERAGE (spec §17)

**Repo** `C:\Users\dprit\Raw-Surf` · **branch** `dev` · **HEAD** `791fdf78` · **date** 2026-08-13
**Scope** what the USER of the weather/map feature can actually tell: state disclosure, legend/unit
truth, model+valid time visibility, the three mobile/desktop layouts, the THREE THEMES mandate, the
ACCESSIBILITY mandate, error recovery / empty state / first-use / rapid-interaction feedback.

**Read-only.** Nothing outside `audit/weather-simulation-12.2/evidence/` was created or modified.

---

## 0. METHOD, AND THE CONTROLS THAT PROVE THE SEARCHES WORK

Every "there is no X" below is paired with a positive control run against the same files with the
same tool, so a zero is a zero and not a broken needle (project rule: ABSENCE IS A CLAIM).

| # | Question | Command | Result | Positive control |
|---|---|---|---|---|
| M1 | Which map components are theme-aware? | shell loop over `components/map/*.js` + `MapPage.js` + `MapLiveIndicator.js`, `grep -q className=` then `grep -q useTheme` | 5 THEMED / 17 NO-THEME (list in §3) | the same loop returns THEMED for `MapWeatherControls.js`, `MapForecastOverlay.js`, `MapPage.js`, which do import `useTheme` |
| M2 | Are there `div`-with-`onClick` controls? | python regex over JSX open tags of `div\|span\|li\|img\|svg\|p\|a` carrying `onClick` | 6 found (§4). **Known undercount** — the regex breaks on tags containing `>` inside a JS expression | the same regex finds `MapWeatherControls.js:669` and `:845`, both confirmed by reading the file |
| M3 | Is `run_time` / `valid_time` ever RENDERED? | `grep -n "run_time\|runTime\|valid_time" TruthOverlay.js TruthOverlayVisualTab.js TruthOverlayGpuTab.js` | **0 hits** | `grep -c productId TruthOverlay.js` → **4**. Same file, same tool, non-zero ⇒ the needle works |
| M4 | Does the program register cover a11y / themes / mobile / colour-vision? | `grep -rniE "accessib\|aria\|wcag\|screen reader\|colou?r.?blind\|colou?r.?vision\|deuteran\|protan\|contrast ratio\|touch target\|tap target\|beach mode\|three themes\|light mode\|dark mode\|mobile layout\|small viewport"` over `weather-simulation-12.0/CANONICAL_TASK_REGISTER.csv`, `weather-simulation-12.1/*.csv`, `STATE_OF_THE_ART_TARGET_CONTRACT.md` | only WS-CAN-0012's *category string* `"Accessibility / correctness"` (about `prefers-reduced-motion` in `WebGLWindEngine.js`) plus incidental `colou?r` matches inside "Colour-scale key". **Zero rows for aria / WCAG / screen reader / colour-vision / contrast / touch target / beach mode / three themes / mobile layout.** | `grep -ril "legend"` over the identical file set hits **all six** files |
| M5 | Does the map/weather feature handle offline? | `grep -rn "onLine\|offline" components/map/` | 1 hit, a comment in `OceanMask.js:9` about an offline-friendly GeoJSON asset. No `navigator.onLine` in the whole map dir | `grep -rln "navigator\."` in the same dir → `deviceTier.js`, `MarineAnimTuner.js`, `marineForensics.js`, `marineSharpenTrace.js`. Needle works; `useOfflineMode` is imported only by `Settings.js`, `useOfflineQueue` only by `Feed.js` |
| M6 | Legend-vs-raster colour agreement | python: extracted the shipped ramp from `frontend/node_modules/@openmeteo/weather-map-layer/dist/index.js`, interpolated both it and the hand-authored CSS gradient, converted to CIE Lab, ΔE76 per tick | table in §2.1 | the 20 °F tick lands at ΔE 6.6 — the metric can return "agrees", so a large ΔE is a signal not an artefact |
| M7 | Colour-vision safety of the 7-level rating palette | python: Viénot 1999 LMS dichromat simulation (protan/deutan/tritan) + ΔE76 over all 21 pairs | table in §2.3 | normal-vision run separates `very_poor` vs `fair` well above the top-5 cut (>73.7); the simulation is what collapses it to 11.7 |

Counts of source lines were taken with `wc -l` via Git Bash (project rule: never claim
line-neutrality from PowerShell `Measure-Object`).

---

## 1. THE USER-FACING WEATHER SURFACE INVENTORY (exhaustive)

Reachability classes: **Active-reachable · Flag-gated · Dev-only · Diag-gated · Single-layer-only ·
Fallback-only · Legacy-but-reachable · Test-only · Dead · Undetermined**

### 1.1 Controls and chrome

| Surface | File | Reachability (justification) | Notes |
|---|---|---|---|
| Desktop weather panel (model chips, 12 layer chips, Surf-Rating pill, ft/m pill, legend, timeline) | `MapWeatherControls.js:660-784` | **Active-reachable** — mounted unconditionally at `MapPage.js:539 isDesktop={true}`, CSS `hidden md:block` | 953 LOC, grandfathered over the 800-LOC ratchet, shrink-only |
| Desktop **collapsed** chip | `MapWeatherControls.js:668-680` | **Active-reachable** — `isCollapsed` set by the collapse button *and* auto-set by `isImmersiveMode` (`:107-109`) | **`<div onClick>`** — see §4.1 |
| Mobile **collapsed float** (legend + timeline above the bottom nav) | `MapWeatherControls.js:787-840` | **Active-reachable** — `MapPage.js:559 isDesktop={false}`, `md:hidden`. Returns `null` when `activeLayer` is falsy | two identical wave-SVG toggle buttons, both `aria-label="Toggle timeline"` |
| Mobile **expanded sheet** (bottom sheet + scrim) | `MapWeatherControls.js:843-949` | **Active-reachable** — opened by the `Layers` button in `MapRightControls.js:102-110` | no `role="dialog"`, no `aria-modal`, no Escape, no focus trap — §4.2 |
| Right-hand floating controls (GPS, photographers, friends, **Weather layers**) | `MapRightControls.js` | **Active-reachable** — `MapPage.js:519` | fully hardcoded dark (`bg-zinc-800/90 text-white`), no `useTheme` |
| Map filter tabs + spot search | `MapFilterTabs.js` | **Active-reachable** | hardcoded dark (`bg-zinc-800/90`, `text-white`, `placeholder-gray-500`) |
| Nearest-spot card | `NearestSpotCard.js` | **Active-reachable** | body is a `div onClick` (`:68`); hardcoded dark |
| Live-session HUD | `MapLiveIndicator.js` | **Active-reachable** when a session exists | hardcoded dark; `aria-label="Square"` on two buttons (the *icon name*, not the action) `:138,:153` |
| IP-location banner | `IPLocationBanner.js` | **Active-reachable** | no `useTheme` |
| Map crash screen | `MapErrorBoundary.js` | **Active-reachable** on a render throw | hardcoded `bg-zinc-900 text-white`, full `h-screen`; empty `<div className="text-6xl mb-4"></div>` at `:26` (an emoji was stripped) |
| Marine animation tuner | `MarineAnimTuner.js` | **Dev-only** — same `isEnabled` gate class as TruthOverlay | not a production surface |

### 1.2 Readouts

| Surface | File | Reachability | Notes |
|---|---|---|---|
| Point infobox ("forecast-overlay") | `MapForecastOverlay.js` | **Active-reachable** but **conditional**: `MapPage.js:585` requires `activeLayers.length > 0`, and `MapForecastOverlay.js:648-650` returns `null` unless a lat/lng is selected/long-pressed/snapped | the ONLY user-facing home of the substitution + stale-hour + heatmap-status disclosures |
| Card compiler + `STATUS_RENDERS` (13 states) | `forecastCardCompiler.js:12-26` | **Active-reachable** | Ready / Zoom In / Config Error / 502 / Timeout / Out of Time Range / Calm-Zero / Rate Limited / Error / **Stale Hour Retained** / payload too large / no Copernicus coverage / No Coverage |
| Model-substitution notice | `modelProvenance.describeSubstitution` → `MapForecastOverlay.js:764-774` | **Active-reachable** | words not colour; exemplary |
| Stale-hour notice | `modelProvenance.describeStaleHour` → `MapForecastOverlay.js:753-763` | **Active-reachable** | names the hour; refuses on bootstrap axes |
| Served-resolution notice under the legend | `servedResolutionNotice.js` + `legendTicks.js:86-106` | **Flag-gated + single-source**: kill switch `window.__RAW_LEGEND_RESOLUTION__`, and the input is **`window.__MARINE_PROJECTION_DIAG__` only** (`legendTicks.js:88`) | see §5.2 |
| Spot rating glyph + hover/focus card | `MapMarkerLayers.js:157-290` | **Active-reachable** when `surfMode` is on | good a11y text (`spotGlyphAriaLabel`), but see §2.3 (colour-vision) and §2.4 (missing key) |
| Truth HUD (7-state provenance class, 4-state parity gate, GPU/visual tabs) | `TruthOverlay.js`, `TruthOverlayVisualTab.js`, `TruthOverlayGpuTab.js` | **Diag-gated** — `isDiagHudEnabled()` `:20-28`: `?diag=1`, `localStorage.__RAW_DIAG__==='1'`, or a localhost hostname. **Production is OFF** | this is where WS-CAN-0034's seven provenance states and WS-CAN-0036's `NO DATA` branch live |

### 1.3 Legends (the key surface for this area)

| Legend | Source of its gradient | Source of the pixels it claims to describe | Agree? |
|---|---|---|---|
| waves / swell_1 / swell_2 / wind_waves | `BASE_CUSTOM_COLOR_SCALES` via `buildGradientCSS` | the same scale | ✅ value-positioned ticks since R11-11 item 3 |
| rain | `BASE_CUSTOM_COLOR_SCALES.precipitation` | same | ✅ label fixed to mm/h |
| pressure | `BASE_CUSTOM_COLOR_SCALES.pressure_msl` | same | ✅ |
| wind | **derived** from `WindColorRamp.windLegendGradientCSS(theme)` | the shader ramp | ✅ fixed at `6568d94b` precisely because a hand-authored duplicate had drifted |
| satellite / fog | hand-authored, qualitative labels | library scale | ⚠️ approximate but claims no numeric precision |
| radar | hand-authored 5-colour | RainViewer scheme-7 reflectivity PNG | ❌ **known** — `radarLegendUnits.proof.test.js` is the standing record; WS-CAN-0015 item 7 |
| **temperature (Air Temp °F)** | **hand-authored 7-colour, `MapWeatherControls.js:247-251`** | OM library `temperature` scale, `unit:"°C"`, 46 breakpoints, **−80…+50 °C** | ❌ **§2.1 — measured, not covered by any task** |
| **water_temp (Water Temp °F)** | **hand-authored 6-colour, `:252-256`** | the same ramp, aliased by `colorScales.aliasSurfaceTemperature` | ❌ **§2.1 — ΔE 174.7 at the first tick** |
| **surf rating (coastal band)** | 7 hard bands from `RATING_COLOR`, 4 evenly-spaced words | the shader's smooth rating ramp | ❌ **§2.2 — 3 of 4 words sit over the wrong band** |

---

## 2. MEASURED LEGEND / COLOUR FINDINGS

### 2.1 The two temperature legends describe a ramp that does not exist

Proof of the raster's actual ramp, from the shipped dependency:

```
frontend/node_modules/@openmeteo/weather-map-layer/dist/index.js
  temperature:{type:"breakpoint",unit:"°C",breakpoints:[-80,-60,-50,-40,…,48,50], colors:[…]}
  sea_surface_temperature: n.temperature          ← the SAME object
```

`LayerRegistry.js:94` sets `temperature.omVariable="temperature_2m"`; `:110` sets
`water_temp.omVariable="surface_temperature"`; `colorScales.aliasSurfaceTemperature` points
`surface_temperature` at `sea_surface_temperature`, i.e. at the °C ramp above.
`MapWeatherControls.js:245-247` states the intent in a comment: *"the legend is a static
approximation of that ramp in °F."*

Measured (ΔE76 in CIE Lab between the colour the LEGEND shows at each tick and the colour the
RASTER actually paints at that tick's temperature):

```
AIR TEMP  ('Air Temp (°F)', ticks 0/20/40/60/80/100+)
  0°F   →  legend (145, 80,220) purple   raster at -17.8°C ( 68,  3,249) blue      ΔE  48.5
  20°F  →  legend ( 65,126,233) blue     raster at  -6.7°C ( 58,141,248) blue      ΔE   6.6   ← agrees
  40°F  →  legend ( 78,194,179) teal     raster at   4.4°C ( 48,244, 48) green     ΔE  88.1
  60°F  →  legend (177,203, 86) yellow   raster at  15.6°C ( 44,161,  0) green     ΔE  37.0
  80°F  →  legend (235,137, 54) orange   raster at  26.7°C (255,180,  0) amber     ΔE  30.3
  100°F →  legend (200, 40, 40) red      raster at  37.8°C (255, 50,  0) red       ΔE  32.1

WATER TEMP ('Water Temp (°F)', ticks 35/45/55/65/75/85+)
  35°F  →  legend (145, 80,220) purple   raster at   1.7°C ( 96,244, 96) GREEN     ΔE 174.7
  45°F  →  legend ( 64,110,235) blue     raster at   7.2°C ( 12,232, 12) GREEN     ΔE 181.7
  55°F  →  legend ( 70,190,225) cyan     raster at  12.8°C (  1,148,  1) GREEN     ΔE  91.6
  65°F  →  legend ( 90,200,110) green    raster at  18.3°C (161,220,  0) yellow-gn ΔE  45.5
  75°F  →  legend (235,205, 70) yellow   raster at  23.9°C (255,211,  0) yellow    ΔE  19.3
  85°F  →  legend (235,120, 50) orange   raster at  29.4°C (255,148,  0) orange    ΔE  23.2
```

The cold half of the Water Temp key is a **colour-family inversion**, not an approximation: the
key says purple/blue/cyan for 35–55 °F; the raster paints that range **green**. A surfer deciding
whether to bring a 4/3 reads a key that has no relationship to the pixels over the entire range
where wetsuit decisions are made.

The infobox NUMBER is right — `forecastCardCompiler.js:220,225` converts `°C×9/5+32`. So the number
is correct, the colour is on a °C domain, and the label claims °F: exactly WS-OBJ-204's stated
outcome ("the number, the colour and the label agree") failing on two layers.

**This is the identical defect that was FIXED for wind** at `6568d94b` — `MapWeatherControls.js:232-239`
says so in the source: *"DERIVED from WindColorRamp — never duplicated. The hand-maintained CSS that
stood here was a byte-exact copy of the LEGACY 8-stop 0-50 kn ramp, so calm (now vivid magenta) read
as hurricane on the legend."* Two hand-authored duplicates of the same class survive one file below
the fix, and neither is in the seven-item enumeration.

### 2.2 The surf-rating key: three of four words sit over the wrong band

`MapWeatherControls.js:266-276`. `RATING_LEVELS` has **7** levels; `surfLegend.stops` is
`evenTicks(['Poor','Fair','Good','Epic'])` → 4 words at 0 / 33.3 / 66.7 / 100 %. Band *i* occupies
`[i/7, (i+1)/7)`:

```
  'Poor'  at   0.0%  →  band 0 = very_poor    (should be band 1 = poor)
  'Fair'  at  33.3%  →  band 2 = poor_fair    (should be band 3 = fair)
  'Good'  at  66.7%  →  band 4 = fair_good    (should be band 5 = good)
  'Epic'  at 100.0%  →  band 6 = epic         ✓
```

A systematic off-by-one-band. In particular `fair` is **green** (`#2fd07a`) and the word "Fair"
sits over **yellow** (`#f7d038`); "Poor" sits over the worst colour in the palette (`#f0476b`),
so the map's most severe band is labelled with the second-mildest word and nothing on the key is
worse than "Poor".

The source calls this deliberate — *"4 words over 7 equal bands is a deliberate summary, not a value
axis"* — and it is the one legend explicitly routed through `evenTicks` rather than `valueTicks`.
It is nonetheless the exact defect `legendTicks.js` was built for (labels 47 pp from their colour),
on the product's headline quality display.

### 2.3 The rating palette collapses under deuteranopia — measured

Palette (`surfRating.js:354-357`): `very_poor #f0476b · poor #f59e2c · poor_fair #f7d038 ·
fair #2fd07a · fair_good #14b8a6 · good #7c3aed · epic #a855f7`.

Viénot-1999 dichromat simulation + ΔE76, five most-confusable pairs per vision type:

```
normal   good/epic 15.2 · poor/poor_fair 28.6 · fair/fair_good 38.0 · very_poor/poor 67.0 · poor_fair/fair 73.7
protan   good/epic 16.4 · poor/poor_fair 19.2 · poor/fair 24.4 · very_poor/fair_good 25.3 · poor_fair/fair 34.4
deutan   VERY_POOR/FAIR 11.7 · poor/poor_fair 12.2 · good/epic 19.4 · very_poor/fair_good 32.8 · fair/fair_good 35.2
tritan   poor/poor_fair 9.8 · very_poor/poor 12.1 · fair/fair_good 13.9 · very_poor/poor_fair 21.9 · fair/good 28.4
```

Under deuteranopia (~6 % of males) the **worst** rating and a **mid-good** rating become the single
most confusable pair in the palette — ΔE 11.7, down from >73.7 in normal vision. `good` vs `epic`
is already the least separable pair at ΔE 15.2 **in normal vision**.

The non-colour channel that exists is `spotGlyphAriaLabel` (screen readers) and the hover/focus card
(`MapMarkerLayers.js:261-262` prints `· {rating.label}`). Neither helps a sighted colour-vision-
deficient user scanning the map for where it is good, and the WebGL **coastal rating band** has no
per-pixel text channel at all.

### 2.4 The rating COLOURING is ungated; the rating KEY is gated on a marine layer

`MapWeatherControls.js:764` renders the "Surf Rating (coastal band)" key only when
`surfMode && SURF_TOGGLE_LAYERS.includes(activeLayer)`, `SURF_TOGGLE_LAYERS = ['waves','swell_1',
'swell_2','wind_waves']`, and the whole legend block at `:757` additionally requires
`activeLayer && legendConfig[activeLayer]`.

But the glyph colouring is *deliberately* ungated — `:705-707`: *"the Rating toggle governs the
per-spot GLYPHS even when no marine heatmap layer is active, so it can never hide behind one."*

⇒ Surf Rating ON with `rain` / `radar` / `satellite` / `wind` / `fog` / `pressure` / `temperature` /
`water_temp` active, **or with no layer active at all**, paints seven-colour rating glyphs with **no
key anywhere on screen**. The stated design intent ("can never hide behind one") is satisfied for the
colour and violated for the key.

---

## 3. THREE THEMES (binding mandate) — census

M1 loop result. THEMED = imports `useTheme`; ForecastWheel is theme-correct via a `theme` **prop**
(`THEME_COLORS` dark/light/beach, `ForecastWheel.js:143-147`) and `legendTicks` /
`servedResolutionNotice` inherit a theme-aware `className` from their caller — those three are
correct despite showing as NO-THEME.

```
THEMED    FeaturedPhotographersPanel.js   MapForecastOverlay.js   MapWeatherControls.js
          RequestProModal.js              MapPage.js
NO-THEME  BoostSelector.js   DispatchTrackingPanel.js   IPLocationBanner.js
          MapErrorBoundary.js   MapFilterTabs.js   MapHeader.js   MapMarkerLayers.js
          MapRightControls.js   NearestSpotCard.js   PhotographerBottomSheet.js
          RequestProButton.js   RequestProConfirmStep.js   RequestProCrewPanel.js
          MapLiveIndicator.js
          [ForecastWheel.js, legendTicks.js, servedResolutionNotice.js — correct via prop/className]
```

Weather-relevant single-theme surfaces: **`MapRightControls.js`** (hosts the mobile *Weather layers*
button), **`MapFilterTabs.js`**, **`MapErrorBoundary.js`** (the map's only crash-recovery screen),
**`NearestSpotCard.js`**, **`MapLiveIndicator.js`**.

Partial violations inside themed files:
- `MapForecastOverlay.js:55-59` — self-documented: *"This file computed only `isLight`, so BEACH
  rendered with dark-mode colours — a pre-existing violation of the three-theme mandate."*
  `bgClass`/`textClass`/`textMuted` (`:118-122`) still branch on `isLight` only; `isBeach` was added
  for the two new notice rows only (`:753-774`).
- `MapWeatherControls.js:800-813` — the two mobile-float wave SVGs hardcode `fill-zinc-500`,
  `fill-zinc-600`, `stroke-zinc-800` on all three themes.

---

## 4. ACCESSIBILITY (binding mandate)

### 4.1 `MapWeatherControls.js:668-680` — the desktop panel can be collapsed by keyboard but not re-expanded

```jsx
<div className={...} onClick={() => setIsCollapsed(false)} aria-label="Expand weather controls" >
```

No `role`, no `tabIndex`, no key handler. `aria-label` on a generic `div` with no role is not
exposed by the accessibility-name computation, so the control is both **unreachable by keyboard**
and **anonymous to a screen reader**. The collapse direction *is* a real `<button>` (`:687`), and
`isCollapsed` is also set automatically by `isImmersiveMode` (`:107-109`) — so a keyboard user can
enter the collapsed state without ever clicking, and cannot leave it.

### 4.2 The mobile expanded sheet is a modal with no modal semantics

`MapWeatherControls.js:843-948`: a full-viewport scrim `<div … onClick={onClose} />` at `:845` and
a bottom sheet at `:846`. The sheet has **no `role="dialog"`, no `aria-modal`, no accessible name,
no Escape handler, no focus move on open, no focus restore on close, no focus trap**. Behind it the
map, the right-hand controls and the collapsed float remain in the tab order.

### 4.3 Missing / duplicated ARIA state on weather toggles

| Site | Issue |
|---|---|
| `:687` collapse button | `aria-label` present, **no `aria-expanded`** |
| `:669` expand div | not a control at all (§4.1) |
| `:794` and `:805` | **two buttons with the identical `aria-label="Toggle timeline"`**, both firing `setCollapsedState(!collapsedState)`; neither carries `aria-expanded`. A screen-reader user hears the same command twice with no way to tell them apart |
| `MapLiveIndicator.js:138,153` | `aria-label="Square"` — the lucide *icon* name, not the action ("End session") |

Correct by contrast: layer chips carry `aria-pressed` + `aria-busy` + an `sr-only` "(loading)"
(`:738,745-751`); model chips carry `aria-pressed`; the ft/m pill carries a directional
`aria-label`; `ForecastWheel` is the full house pattern (`role="slider"`, `aria-valuemin/max/now/
valuetext`, arrows/PgUp/PgDn/Home, visible focus ring, `prefers-reduced-motion`); the infobox header
is a real `<button aria-expanded>`; the infobox rows are `role="list"/"listitem"` with per-row
`aria-label`; `MapRightControls` icon-only toggles are named and carry `aria-expanded`, guarded by
`controls.a11y.test.js` (two arms, including a source-level arm for breakpoint-hidden labels).

### 4.4 Touch-target sizes on the timeline (all three layouts share `renderTimeline`)

Tailwind defaults confirmed — `tailwind.config.js` extends only `borderRadius` and `colors`, so
`py-1` = 4 px, `w-6` = 24 px, `w-7` = 28 px.

| Control | Classes | Computed | WCAG 2.5.8 AA (24×24) |
|---|---|---|---|
| Play/Pause `:483` | `w-7 h-7` | 28 × 28 px | pass |
| Radar step back/forward `:493,:543` | `w-6 h-6` | 24 × 24 px | at the floor exactly |
| **−1d / −1h / Now / +1h / +1d** `:567-579` | `text-[9px] leading-none px-2 py-1` | ≈ **32 × 17 px** | **FAIL (17 px < 24 px)** |

The step row is the control the source says was added *"for pointer/touch users"* (`:556-559`) —
the keyboard equivalents live on the wheel. It renders identically in the mobile collapsed float and
the mobile expanded sheet.

### 4.5 Readout type size

`grep -o` counts of arbitrary-value font utilities:

```
MapWeatherControls.js   text-[8px]×5  text-[9px]×11  text-[10px]×5  text-[11px]×3
MapForecastOverlay.js   text-[8px]×0  text-[9px]×6   text-[10px]×3  text-[11px]×2
MapMarkerLayers.js      text-[8px]×0  text-[9px]×1   text-[10px]×4  text-[11px]×1
```

The legend value ticks, the surf-rating key words and the served-resolution notice all render at
**8 px** on desktop / 9 px on mobile. These are the numbers a user reads the field with.

### 4.6 Other keyboard-unreachable map controls (M2, undercount)

`NearestSpotCard.js:68` (navigate-to-spot body), `FeaturedPhotographersPanel.js:41`,
`PhotographerBottomSheet.js:20`, `RequestProModal.js:108` — non-weather, listed for completeness.

---

## 5. WHAT THE USER CAN AND CANNOT TELL

| State | Disclosed? | Where | Evidence |
|---|---|---|---|
| default / first use | **partial** | `useWeatherState.js:44 activeLayers=[]` — nothing is on. Desktop shows 12 chips; mobile shows only a `Layers` icon. No empty-state copy anywhere | `activeModel` persists to `localStorage` (`:15-30`), `activeLayers` does **not** — an asymmetry a user feels on every reload |
| loading (raster) | ✅ | spinner + `aria-busy` + `sr-only "(loading)"` on the chip | `useOpenMeteoTileUrls.js:707-755` |
| data ready | ✅ | `STATUS_RENDERS.ready` — **only in the infobox**, so only when a point is selected | `forecastCardCompiler.js:13` |
| **stale hour** (axis clamped) | ✅ | `describeStaleHour`, words + the actual hour | `modelProvenance.js:96-120` |
| unavailable model / substituted model | ✅ | `describeSubstitution`, words | `modelProvenance.js:56-70` |
| **failed layer** | ❌ | `emit(false)` fires on the 30 s timeout and on effect cleanup with no error channel — the chip stops spinning and looks exactly like success over a blank map | `useOpenMeteoTileUrls.js:743-754` |
| offline | ❌ | none in the map feature | M5 |
| **fallback active** | ⚠️ **diag-only** | `TruthOverlay.js:274-286` `ESTIMATED FALLBACK` / `SUBSTITUTED SOURCE` | `isDiagHudEnabled` is OFF in production (`:20-28`) |
| value unavailable | ✅ | `'--'`, `'N/A'`, `'Land / no data'`, `'No data'` | `forecastCardCompiler.js:221,226`; `MapForecastOverlay.js:623` |
| **model RUN time** | ❌ **nowhere, including the diag HUD** | M3: 0 hits in `TruthOverlay*.js`; the value is threaded into telemetry at `MapForecastOverlay.js:583` and thrown away | see §5.1 |
| forecast VALID time | ❌ (wall-clock proxy only) | `formatTime()` `MapWeatherControls.js:328-340` and `forecastTimeLabel` `MapForecastOverlay.js:629-641` both do `new Date(); d.setHours(d.getHours()+offset)` | WS-CAN-0016 names only the first site |
| units labelled | ⚠️ | yes on every legend, but two are wrong (§2.1) and radar's stops are not dBZ (known) | |
| **direction convention** | ⚠️ | `degToCompass` is applied and the arrow icon is rotated (`MapForecastOverlay.js:716`), but no surface states whether a wave/wind direction is **from** or **toward**. `MapForecastOverlay.js:222` computes `atan2(-u,-v)` = meteorological *from* | not asserted anywhere user-visible |
| legend matches the field | ⚠️ | 4 of 9 legends verified-derived; 3 known/measured wrong | §1.3 |
| grid coarseness | ⚠️ **marine-only** | `legendTicks.js:88` reads `window.__MARINE_PROJECTION_DIAG__` regardless of which layer's legend is being drawn | §5.2 |
| rapid interaction | ✅ | scrub decimation at 11 Hz with leading+trailing commit; `ForecastWheel` leading commit on pointer-down; `MapForecastOverlay.js:87-94` 200 ms settle | `MapWeatherControls.js:287-301`, `ForecastWheel.js:64-99` |
| **disabled during invalid transitions** | ❌ | the only `disabled=` on any map control is `MapRightControls.js:49` (GPS while locating). Model chips, layer chips and the scrubber stay live through `isTransitioning` | `grep disabled= MapWeatherControls.js MapForecastOverlay.js` → 0 |
| error recovery | ⚠️ | full-page reload only (`MapErrorBoundary.js:31-36`); the amber "Load missing data" retry at `MapForecastOverlay.js:735-750` covers only `estimate_pending_sources` / Copernicus >+27 h | |

### 5.1 The model run time reaches the client and is never shown

`run_time` is parsed and carried in `backendWeatherServiceClientHelpers.js:315,328,339`,
`backendWindServiceClient.js:79,89,505`, `backendCopernicusServiceClient.js:121,132`,
`marineGridSeries.js:307,327`, `marineController.js:479`, `marineControllerCache.js:263`,
`useMarineOrchestrator.js:796`, `useMarineWindData.js:163-164`, `WeatherEngine.js:207` — and is
posted to telemetry at `MapForecastOverlay.js:583`.

M3 shows **zero** occurrences of `run_time` / `runTime` / `valid_time` in `TruthOverlay.js`,
`TruthOverlayVisualTab.js`, `TruthOverlayGpuTab.js`, against a positive control of 4 `productId`
hits in the same file. There is no JSX anywhere that renders it. The user sees `GFS Forecast` and a
wall-clock-derived weekday, and cannot tell a 00Z run from twenty hours ago from a 12Z run from
twenty minutes ago.

### 5.2 The coarse-grid notice is wired to one subsystem's global

`legendTicks.js:88` — `showResolution && window.__MARINE_PROJECTION_DIAG__`. That global is written
only by the marine client (`backendWeatherServiceClientDiag.js:552`, and `:116` picks between
`__WIND_PROJECTION_DIAG__` and `__MARINE_PROJECTION_DIAG__`). But `showResolution` is passed at all
three layer-legend call sites (`MapWeatherControls.js:777, 832, 940`), i.e. for **rain, radar,
satellite, fog, pressure, temperature and water_temp** as well. Consequences: (a) a coarse global
raster never earns the notice, and (b) a marine session followed by a raster layer can render a
resolution claim derived from the previous marine grid under the new layer's key. The module's own
header states the design intent it is failing — *"The legend is the surface that is always on
screen"* — and its refuse-on-unknown discipline is otherwise exemplary.

Latent, not a finding: `servedResolutionNotice.js:74` builds a Tailwind class by template literal
(`` text-[${size}px] ``). It currently works only because `text-[8px]` appears literally in
unrelated files (`ExploreSpotCard.js`, `GalleryItemModal.js`, …) so the JIT emits it.

---

## 6. THE STRUCTURAL GAP: the program has no owner for either binding mandate

M4 (with a working positive control on "legend") over the 12.0 register, every 12.1 CSV and the SOTA
contract returns **zero** rows for accessibility, ARIA, WCAG, screen readers, colour-vision,
contrast, touch targets, beach mode, three themes, light/dark mode, mobile layouts or small
viewports. The single hit is WS-CAN-0012's *category string*, whose actual body is
`prefers-reduced-motion` + device tier in `WebGLWindEngine.js`.

`CLAUDE.md` carries both as **binding user mandates** (THREE THEMES 2026-07-12, ACCESSIBILITY
2026-07-14) and already quantifies the debt (*"~41 aria attributes across 132+ interactive elements
in the map components; keyboard handling in only 2 of 20 interactive files"*). The audit program
tracks none of it. 40 objectives, 65 tasks, 41 SOTA rows, zero coverage.

Two closure criteria in the register are **closed enumerations**, so satisfying them cannot reach the
defects in §2:

- **WS-OBJ-204** Closure Criteria: *"All seven readout-truth items shipped"* — the seven are rain
  label, wind legend, equal-value ticks, cross-fall slot sampling, one nearshore display policy, ft/m
  infobox, radar legend. §2.1 (two temperature legends) and §2.2 (rating key) are neither of the
  seven; shipping all seven leaves both live.
- **WS-OBJ-202** Intended Outcome: *"run_time means the model cycle not the ingest clock"*, Closure
  Criteria: *"run_time is the cycle; ingested_at carries the wall clock"*. Entirely a wire contract.
  §5.1 (never displayed) is outside it by construction.

Corroborating precedent from the program's own record — WS-CAN-0060's Remaining Work field:
*"this defect existed throughout Audits 11.0–12.0 and no task covered it — blank-render was not an
objective any prior audit tracked."* The same shape recurs here for the user-facing half.

---

## 7. CONCERNS I TRIED TO KILL AND SUCCEEDED IN KILLING (reported as covered)

| Apparent concern | Killed by | Why |
|---|---|---|
| Radar legend stops (0/.1/.3/.5/2+) are not dBZ | WS-CAN-0015 item 7 + `radarLegendUnits.proof.test.js` | named item, deliberate no-fix pending a primary source |
| Scrubber label derived from wall clock, not the served frame | WS-CAN-0016 | names `MapWeatherControls.js:327-331` exactly. (The *second* site, `MapForecastOverlay.js:637-640`, is unnamed — noted, not raised: the fix is one policy) |
| ft/m not threaded into infobox cards | WS-CAN-0015 item 6 | named; and it now IS threaded (`MapForecastOverlay.js:64-69`) |
| Provenance class over-reliant on `isEstimated` | WS-CAN-0034 | seven states shipped at `TruthOverlay.js:274-286` |
| Total load failure not disclosed | WS-CAN-0036 | named, Partially Implemented. (That its named disclosure surface is diag-gated is raised separately) |
| Grid coarseness not disclosed | WS-CAN-0014 / WS-OBJ-203 | `resolution` stamping landed at `172f66aa`; the *layer-wrong-global* wiring is a different claim (§5.2) |
| Confidence identical for degraded vs full geometry | WS-CAN-0062 / WS-OBJ-207 | opened 12.1 with LV-06 evidence |
| Colour-scale key miss paints transparent | WS-CAN-0060 | closed `0f13fa7d`/`2dd8f1ff`/`6bef6eda`, class guard added |
| water_temp buried under the basemap | WS-CAN-0061 | closed `f3fe2c85` |
| `fps \|\| 60` fabricates a frame rate | WS-CAN-0010 + WS-CAN-0063 | closed `69ac3ddb`, `172f66aa` |
| Nine 200-with-error returns on `/conditions/*` | WS-CAN-0009 | named, Not Started, `conditions.py:94…331` |
| Wind legend duplicated the legacy ramp | fixed `6568d94b` | derived from `WindColorRamp` |
| Legend tick labels 47 pp from their colour | fixed, R11-11 item 3 | `legendTicks.js` `valueTicks`/`dropCollisions` |
| Marker glyph rating conveyed by colour only (screen readers) | shipped | `spotGlyphAriaLabel`, `MapMarkerLayers.a11y.test.js` |
| Icon-only right-hand controls anonymous | shipped | `controls.a11y.test.js`, two arms |
| Scrubber drag jank | shipped | 11 Hz decimation + `wheelDragCommitDue` |
| Wheel `aria-valuetext` empty until first interaction | fixed | `ForecastWheel.js:132-136,338`, `ForecastWheel.valuetext.test.js` |

---

## 8. RANKED, BY CLASS

**Core correctness (the number/colour/label contract)**
1. §2.1 Air Temp + Water Temp legends describe a ramp that does not exist (ΔE up to 181.7)
2. §5.1 model run time never displayed on any surface
3. §2.2 surf-rating key: 3 of 4 words over the wrong band
4. §5.2 coarse-grid notice keyed to the marine global on every layer's legend
5. §5 failed-layer indistinguishable from loaded
6. §5 fallback/provenance disclosure exists only behind `?diag=1`

**Usability**
7. §2.4 rating colours with no key on 8 of 12 layer states
8. §5 no offline state in the map feature
9. §5 no control disabled during a model transition
10. §5 `activeLayers` not persisted while `activeModel` is
11. §4.5 8–9 px legend readouts

**Accessibility (binding mandate — not nits)**
12. §4.1 desktop panel collapsible but not re-expandable by keyboard
13. §4.2 mobile sheet is a modal with no modal semantics
14. §2.3 rating palette collapses under deuteranopia (ΔE 11.7 worst-vs-fair)
15. §4.4 timeline step row 32×17 px on touch
16. §4.3 duplicate/missing ARIA state on weather toggles
17. §3 five weather-adjacent map surfaces are single-theme; `MapForecastOverlay` beach is a
    self-documented partial violation

**Optional refinement**
18. §4.6 non-weather div-onClick controls
19. `MapErrorBoundary` stripped emoji + single theme
20. `servedResolutionNotice.js:74` dynamic Tailwind class that works by accident

---

## 9. TEST COVERAGE OF THE USER-FACING SURFACES

`grep -rl "<Name" --include=*.test.js` (positive control: the same grep finds
`controls.a11y.test.js:72 render(<MapRightControls …/>)` and
`ForecastWheel.valuetext.test.js:71 render(<ForecastWheel …/>)`, so the needle works):

| Surface | Rendered-component test | Note |
|---|---|---|
| `MapWeatherControls.js` (953 LOC, **three layouts**) | **NONE** | four test files mention it; three only in *comments* (`legendTicks.test.js:11`, `ratingRampAnchors.test.js:12`, `windLegendFromRamp.test.js:4`), and `radarLegendUnits.proof.test.js` reads it as a *string*. `grep -rn "<MapWeatherControls" --include=*.test.js` → 0 |
| `MapErrorBoundary.js` | **NONE** — no test file references it at all | the map's only crash-recovery screen |
| `MapFilterTabs.js` | **NONE** | |
| `NearestSpotCard.js` | **NONE** | |
| `MapLiveIndicator.js` | **NONE** | |
| `MapRightControls.js` | ✅ `controls.a11y.test.js` (two arms) | the house standard |
| `ForecastWheel.js` | ✅ `ForecastWheel.test.js`, `ForecastWheel.valuetext.test.js` | |
| `MapMarkerLayers.js` | ✅ `MapMarkerLayers.a11y.test.js` | |
| `forecastCardCompiler.js` | ✅ `tests/forecast-card-compiler.test.js`, `__tests__/forecastCard.*.test.js` | |
| `modelProvenance.js` | ✅ `modelProvenance.test.js`, `staleHour.proof.test.js` | |
| `legendTicks.js` / `servedResolutionNotice.js` | ✅ own unit tests | neither asserts *which layer* the resolution came from |

The single most user-facing component in the feature — the one carrying all three device layouts,
every legend, both preference toggles and the timeline — has no test that renders it.

---

## 10. GOVERNANCE

The two mandates in `CLAUDE.md` have no objective, no task, no gate and no owner in the audit
program (§6). Until they do, every finding in §4 and §3 will keep being re-found by the next audit
and re-closed as "not in scope", exactly as blank-render was before WS-CAN-0060.
