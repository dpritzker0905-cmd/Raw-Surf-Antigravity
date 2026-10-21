# 2026-10-21: light's wave-height wash becomes the seven-band spectrum (D-037)

Session: the float-height session (#420, `claude/wave-height-float`) continued on the owner's word. Branch
`claude/wave-light-spectrum` from dev `448deb35c` (#421 receipt, ledger 1557). Client only.
**No served number changes** (no SCOREBOARD row): every height, rating, glyph and hub value the backend serves is untouched;
what changes is the colour light's wave-height wash and legend draw, light's calm-water opacity, and the height at which light's
crests switch from umber to cream. Dark and beach draw exactly what dev `448deb35c` draws.

## The owner's words

1. "We need the heatmap to have a clear spectrum of colors that distinguish the wave heights easier to see to the eye. Deep
   research this using science and art and animation" (research report + comparison page
   https://claude.ai/artifact/KSm5QY1qj2yjhtb5b6ozjR: today | proposed, per theme).
2. "On this wave height spectrum, I like the proposed light mode, but I like the v2 dark mode, and beach mode v2 I like.... at
   least on this chart". Asked which panes he meant (the page labels were "today" and "proposed"): dark "Today's dark (left)",
   beach "Today's beach v1 (left)".
3. "Build the proposed light spectrum here as one PR with a kill switch back to v2, record the decision, re-check light's crests,
   and leave dark and beach as they are."
4. "just to make sure we have the best and widest spectrum of color on this scheme"
5. "run a structured design critique with colour-harmony checks across all three crests, use special art skills"

## What changed

- **`marineWavePalette.js`: `WAVE_PALETTES.spectrum`, light's table.** Seven bands on the WMO / Douglas sea-state breaks
  0.5 / 1.25 / 2.5 / 4 / 6 / 9 / 14 m (1.6 / 4 / 8 / 13 / 20 / 30 / 46 ft): mint (0, 202, 144) to 0.5 m, cyan-blue (0, 156, 222)
  at 1.25 m, blue (80, 109, 246) at 2.5 m, violet (128, 60, 235) at 4 m, magenta (181, 0, 118) at 6 m, crimson (164, 0, 26) at 9 m,
  umber (90, 20, 0) at 14 m. 4.5 / 5 / 5.5 m are blend-only anchors on the OKLab line between violet and magenta (an sRGB blend
  there dips and climbs back in lightness). `cap: 14` and no above-cap colour: 14 m is the top band (`over: null`), so light's
  upload scale is 14 (`marineWaveHeightScale`: [light, beach, dark] = [14, 10, 10]; under the kill [16, 10, 10]).
- **"Widest" (owner's item 4): how the colours were chosen.** `spectrum-solve.mjs` (the same composite model as `wave-check.mjs`:
  the spectrum's opacity law, swell lighting, light's measured water (144, 223, 254)): per break, a grid of composited CIELAB L*
  (a window that keeps lightness falling) and hue (a window that keeps the order teal, azure, blue, violet, magenta, crimson,
  brown), each at the MAXIMUM chroma whose source colour light can display at world opacity. Feasible tables keep OKLCH L
  falling at every sample, on the table and as composited at world, regional and coastal opacity under lighting 0 / 0.5 / 1.
  Objective: the weakest adjacent step over those nine views, as min(normal / 10, worst dichromat / 6.5, |dL*| / 5), then the
  widest total path at world opacity. `spectrum-tune.mjs` then trimmed violet's blue by 10 (headroom for the lighting term), lifted
  its red and green by 8 and laid the OKLab blend anchors (the solved 4-6 m band climbed a few thousandths of L). The sweep runs
  green -> cyan -> blue -> violet -> magenta -> red -> brown at maximum displayable chroma: the widest path light's gamut allows
  from a pale calm to a dark storm while lightness falls. Yellow and orange are left out because they are LIGHTER than the blues
  that must come before them (a yellow storm band would make lightness climb, the one thing the research says a magnitude scale
  must not do).
- **Shader (`withWaveSpectrum`, `WebGLMarineShaders.js` HEATMAP_FS).** For light only: the deep-ocean floor blend
  (`smoothstep(0, 0.18, h)`, which mixed 0-0.18 m toward a near-black floor) is replaced by 1.0, and the opacity line becomes
  `marineWaveSpectrumAlpha(u_opacity, h, u_theme)`: `(alpha + (1 - alpha) x 0.4286 x t) x smoothstep(0, 0.5, h)`,
  t = clamp(log(max(h, 0.5) / 0.5) / log 12). Calm water (below 0.5 m) fades to the map instead of to a pale floor, and the
  heavier the sea the more opaque the wash (world: 0.65 at 0.5 m -> 0.80 at 6 m and above), so storms read through the basemap.
  Dark and beach branches return their alpha and blend unchanged.
- **Legend (`marineWaveLegend` -> `spectrumLegend`).** An equal-band ruler, one band per sea-state step, each band its colour as
  composited over light's water at world opacity; labels ft `0 1.6 4 8 13 20 30 46+`, m `0 0.5 1.25 2.5 4 6 9 14+`.
- **Crests (`marineCrestPalette.js`, `LIGHT_CRESTS.v2s`).** D-036's colours, switch moved from 3.05 m to 1.55 m: the spectrum
  darkens faster than v2, so it crosses mid-lightness lower. `crest-switch.mjs` (every 0.05 m switch from 1.3 to 3.2 m; weakest
  APCA |Lc| of a crest core on its wash over 0-14 m, every opacity, lighting and whitecap): today's 3.05 m would leave |Lc| 28.8
  over the spectrum (at 3.05 m, coastal); 1.55 m gives 42.4, the best.
- **Kill: `window.__RAW_DISABLE_WAVE_SPECTRUM__ = true` before load** -> light draws v2 at 16 m exactly: HEATMAP_FS, DRAW_FS, the
  palette GLSL, light's ft and m legends, beach's legend and both themes' samples are sha256-pinned to dev `448deb35c`
  (`marineWaveSpectrum.test.js`). `__RAW_DISABLE_WAVE_HEIGHT_16M__` also returns light to v2 (as #411); `__RAW_DISABLE_WAVE_PALETTE_V2__`
  returns both themes to v1. Suites that pin v2 itself import `marineWaveSpectrumKill.testsupport.js` first.

## Evidence

### The checker (`wave-check.mjs --theme light`, as composited)

| line | v2 @ 16 m (today) | spectrum |
|---|---|---|
| lightness falls at every 0.02 m step (wash and composite) | yes (L 0.90 -> 0.30) | yes (L 0.74 -> 0.31) |
| weakest neighbouring band, normal vision | 9.3 dE00 (10-16 m) | 15.3 (2.5-4 m) |
| weakest neighbouring band, any colour vision | 7.2 (deutan, 1.22-2.44 m) | 5.3 (tritan, 6-9 m); deutan 6.0 (2.5-4 m) |
| weakest chroma, wash / composite | C* 31.5 / 14.8 | 36.0 / 19.1 |
| land vs sea (closest) | 20.0 dE00 | 21.0 |
| crest core vs wash, APCA \|Lc\| | 40.0 (at 3.1 m) | 42.7 (at 1.5 m); 43.1 on a whitecap's front |
| crest core vs wash, colour-blind dE00 | 24.3 | 26.3 |
| legend stop on its white panel, weakest APCA Lc | 15.3 (0 m) | 41.1 (0 m) |

The neighbour line is RED for both (target >= 10 in every vision kind); it is structural for any palette that also keeps lightness
monotone over seven-plus steps in light's gamut.

### Engine, offline (real build, synthetic backend, never the live one)

Production build of this branch (`6a9774bfc`, `npm run build` in a dot-free copy) on `serve_spa.js`, the harness backend
`serve_synthetic.py --dynamic 1 --vortex-peak 14 --calm-patch 27,-111,8` (a storm whose eye passes 14 m off Jalisco, a calm bowl
in the Gulf of California), `scn_wave_palette_ab.js` with `VARIANTS=sp@v2,v2,sp@v2b,v2b THEMES=light,beach,dark
VIEWS=world,regional,coastal,calm WASH=1 CRESTS=1` (sp@v2 / sp@v2b = the kill, today exactly; v2 / v2b = this PR; the b runs are
the null controls), then `CLIP=1 PAIRED=1 CLIP_VIEWS=world,regional,coastal CLIP_FRAMES=24` for the crests. The harness lever and
stats scripts were local copies of #420's (that branch carries them; nothing here depends on it). 60 shots, every GL error 0;
upload scales as designed: light 14 (spectrum) / 16 (kill), beach and dark 10.

**The wash (crest-free, same grid per pair, interior = sea >= 8 px from land):**

| theme / view | interior px moved (today -> spectrum) | dE00 mean / p99 | null (each lever twice) |
|---|---|---|---|
| light world | 485,881 of 505,113 | 16.6 / 20.1 | 0 / 0 px |
| light regional | 511,037 of 524,913 | 19.5 / 30.0 | 343 / 566 px of run noise |
| light coastal | 549,350 of 555,019 | 26.9 / 33.5 | n/a / 0 px |
| light calm | 295,327 of 308,036 | 13.1 / 16.0 | 0 / 0 px |
| beach, all four views | **0** | 0 | 0-545 px of run noise |
| dark world / coastal / calm | **0** | 0 | 0-592 px of run noise |
| dark regional | 9 px (dE00 max 3.9) | | 445 / 645 px of run noise |

Beach and dark are unchanged: every moved pixel outside the interior sits inside the null runs' own noise.

**Light's crests, engine (paired exact wash; p99 over sea pixels):**

| view | APCA \|Lc\| today -> spectrum | normal dE00 | deutan | tritan | share of sea at \|Lc\| >= 15 | null (half vs half, \|Lc\|) |
|---|---|---|---|---|---|---|
| world | 35.0 -> **23.9** | 26.3 -> 19.4 | 26.5 -> 19.9 | 24.1 -> 17.9 | 13.6% -> 4.8% | 0.7 / 0.1 |
| regional | 42.3 -> **53.5** | 47.0 -> 54.1 | 48.4 -> 47.3 | 29.6 -> 39.1 | 9.1% -> 11.5% | 7.0 / 0.1 |
| coastal | 78.6 -> 77.4 | 84.7 -> 80.6 | 82.7 -> 59.6 | 53.3 -> 51.3 | 55.9% -> 51.5% | 0.2 / 0.5 |

**The re-check's finding: at world zoom light's crests are weaker over the spectrum.** The open ocean at world zoom is mostly
1.5-3 m, where the spectrum draws a mid-lightness blue (OKLCH L 0.66-0.59; v2 drew a light cyan there). World-zoom crests are
small and drawn at partial opacity, and at partial opacity neither of V2's inks has much room on a mid-lightness wash
(a scratch check with `wave-lib.mjs`, a crest ink laid over the composited wash at 40% opacity, APCA |Lc|: umber 22-25 / cream 17-19 on the spectrum's 1.5-2.5 m blue, against umber
31-36 on v2's cyan). So moving the switch would gain only 3-5 |Lc|; the wash itself sets the limit. Regional zoom gains (crests
bigger and more opaque, cream and gold on blue, violet and crimson), coastal is level. Levers, each its own A/B: the cased crest
(D-036's next: a dark rim round a light core reads on a mid wash in both directions), or a far-zoom crest opacity lift for light.

### Crest critique, all three themes (`crest-critique.mjs`)

The owner asked for a structured design critique with colour-harmony checks across all three themes' crests (item 5). Method:
the critique framework (first impression, usability, hierarchy, consistency, accessibility), with colour harmony read as a
painter reads it: Itten's contrasts (light-dark, cold-warm, complementary, simultaneous) and Albers' rule that equal-lightness
complements "vibrate". Numbers: `crest-critique.mjs` (model, weakest case per height) and the engine read above. The full write-up
is on the owner page; the findings:

| theme | weakest model \|Lc\| (height) | engine p99 \|Lc\| world / regional / coastal | harmony read |
|---|---|---|---|
| light, spectrum (this PR) | 42.7 (1.5 m) | 23.9 / 53.5 / 77.4 | warm inks on a cool sea to 4 m (cold-warm + light-dark); cream / gold on violet at 2.5-4 m is the complementary pair; gold on crimson above 6 m is warm-on-warm carried by lightness (\|Lc\| 56-66) |
| light, v2 (today) | 43.0 (4 m) | 35.0 / 42.3 / 78.6 | umber on cyan to 3 m, the strongest at world zoom |
| beach, v1 (today, D-035) | **0** (1.5 m and 6 m) | **0** / 20.9 / 24.5 | complements at equal lightness (pink on teal, turquoise on coral): Albers' vibrating edge, motion direction lost; the crest's own pink -> turquoise mix passes through grey at 1-2 m (188, 168, 186 on sand 200, 179, 146); lilac on the white storm core |
| dark (today) | **0** (6 m and above) | 17.2 / 27.4 / 30.1 | mint on dark's green is analogous (2-7 degrees of hue) and leans on the self-contrast boost; gold on violet at 2.5 m is the best pair (\|Lc\| 42-46); orange on magenta at 6 m vibrates; peach on the ramp's white top has no contrast at all (same polarity) |

Recommendations, none built here (owner: "leave dark and beach as they are"): beach, the drafted warm polarity crest (#416, plum
below 2 m, cream / lemon above, model \|Lc\| >= 36) is the answer on the table (owner pick due 2026-10-24); dark, draft #419
(electric blue crests from 8 m, the owner's "improve those" on the storm's eye) answers 8 m and above, and this table shows the
gap it leaves: 6-8 m, orange on dark's magenta, \|Lc\| 0-10 (whether #419's switch should start lower is #419's to measure). Taken
together that would make all three themes one crest logic, the owner's rule in D-036 (an ink of the opposite lightness to the
wash under it). Light: the cased crest or a far-zoom opacity lift for the world-zoom finding.

## Owner page

https://claude.ai/artifact/2PAV3K3x43fhsUc2pMeGus: the rulers, the engine sheets per view, beach and dark unchanged, the crest
re-check with the world-zoom choice (recommended: ship, then A/B the cased crest), and the structured crest critique with
per-height swatches for every theme.

## Ledger

On `claude/wave-light-spectrum`, after dev's head 1557 (`448deb35c`): 1558 decision (D-037), 1559 pr_open (#431), 1560 commitment
(hosted CI, the owner's word to merge, the owner's world-zoom crest call; due 2026-10-24 18:00Z). #420's branch also appends after
1557 (its 1558 / 1559): whichever PR merges second re-chains its lines after dev's head at that moment.

## Not done here

- Dark's and beach's crests: the critique's recommendations go to #419 and #416; nothing changed in either theme.
- Light's world-zoom crest lever (cased crest or far-zoom opacity): waits on the owner's pick.
- The harness's spectrum levers (`sp@v2`, `sp@v2b`) were added to a local copy of #420's `scn_wave_palette_ab.js`, not committed;
  #420 carries that file. Add them there (or on dev once #420 lands) for the next spectrum A/B.
