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

## Crest zooms: the far-zoom lift (owner, ~11:40Z: "Make sure the crest zooms are still visible, ship and test")

The world-zoom finding above had a mechanism: `DRAW_VS` multiplies every crest's alpha by `mix(0.45, 1.0, smoothstep(3, 9, zoom))`,
so at z <= 3 a crest draws at 45% of its close-zoom opacity. Over v2's pale cyan that was enough; over the spectrum's mid-lightness
1.5-3 m blue it is not, in either polarity.

**The lift (`marineCrestPalette.js`, `withSpectrumCrestLift` on `DRAW_VS`):** where light draws V2's crests over the spectrum (`v2s`)
the factor becomes `x mix(far / 0.45, 1, smoothstep(3, end, zoom))`, shipped at far 0.80, end 9. One GLSL line under
`if (u_theme > 0.5 && u_theme < 1.5)` plus `uniform mediump float u_theme;` (DRAW_FS's own uniform, mediump there; a shared
uniform keeps one precision). Dark and beach keep today's factor. Kill `window.__RAW_DISABLE_SPECTRUM_CREST_LIFT__ = true`: DRAW_VS
is dev's exactly (sha256 `a1683763...`, hashed from dev's own files, the same method reproducing the existing DRAW_FS pin); the
spectrum kill and the crest kill also leave it dev's. A/B levers `__RAW_SPECTRUM_CREST_FAR__` / `__RAW_SPECTRUM_CREST_END__`.
`WebGLMarineParticleShaders.js` stays at 978 lines (its LOC baseline): the wrap and the import ride existing lines.

**Engine zoom ladder** (open sea at 12N 125W, about 2 m; production build with the levers; 12 paired frames per zoom; p99 APCA
|Lc| of crest pixels against the exact wash; null half vs half <= 3.3 except today's storm view):

| zoom | today (v2) | spectrum, no lift | far 0.70 end 5 | far 0.70 end 7 | far 0.70 end 9 | **far 0.80 end 9 (shipped)** |
|---|---|---|---|---|---|---|
| 1.6 | 37.7 | 27.3 | 40.7 | 41.1 | 40.0 | **45.2** |
| 2.2 | 37.1 | 24.8 | 37.5 | 37.1 | 37.1 | **41.4** |
| 3.0 | 32.2 | 19.5 | 31.2 | 30.6 | 31.2 | **37.2** |
| 3.8 | 26.0 | 27.0 | 37.9 | 41.4 | 42.7 | **49.1** |
| 4.6 | 27.5 | 23.4 | 24.6 | 33.3 | 34.9 | **40.9** |
| 6.0 | 36.5 | 22.3 | 22.0 | 24.3 | 29.1 | **31.9** |
| 7.4 | 46.6 | 31.4 | 31.0 | 31.3 | 35.2 | **36.5** |
| 9.0 | 52.9 | 37.9 | 38.0 | 37.4 | 37.8 | **38.0** |

(far 0.60 end 5 and far 0.80 end 5 also ran; both lower in the mid zooms.) Storm at regional zoom: today 23.0, spectrum alone 60.5,
far 0.80 end 5 66.9.

**Read:** from world to regional zoom (1.6-4.6) light's crests now read at least as well as today, most by a wide margin. From z 6
in, they read below today (31.9-38.0 against 36.5-52.9). There the crest is already near its 0.85 opacity cap and the limit is the
wash: a crest has less room on a mid-lightness blue than on v2's pale cyan. Even so, no zoom falls below today's own weakest zoom
(26.0 at z 3.8). Closing the close-zoom gap needs a crest whose contrast doesn't depend on the wash: the cased crest (a dark rim round
a light core), D-036's open next step.

## Re-solved apart from dark (owner 18:11Z; re-solve to 22:15Z)

The owner, after the "Merge #431" button: "I'm not sold on light modes blue water, it seems too close to the same color as dark modes
water in my opinion"; "Neither the crests are issues in the light wave spectrum artifact, im talking about the heatmap colors.. maybe
im wrong"; "Im very confused as to what we're shipping and what we're not." #431 was put on hold (the lead was told). Shown the engine
stills (light today | spectrum | dark), he chose: "Resolve it so light improves but isnt too much like dark".

**He was right, and it measures** (`theme-distance.mjs`: light's composite against dark's shader ramp over the dark style's sea, world
opacity, lighting 0.5, CIEDE2000 per height): the first spectrum sat 0.8-3 m mean 15.0 from dark (min 5.6 at 1.5 m) against live
light's 24.0, and its 4 / 6 m violet and magenta were dark's own (13.7 / 11.3 against live light's 32.0 / 26.8). The spectrum had
followed dark's hue path: cyan -> blue -> violet -> magenta.

**The re-solve (`spectrum-apart.mjs`):** spectrum-solve.mjs plus a hard floor at every 0.1 m from 1.2 to 6 m: light at least as far
from dark (and from beach's v1) as live light is (capped at 24 / 20). Below 1.2 m the floor is 8: as far from dark's 0.5 m green as
live light is, a colour would be lighter than light's own water and the calm fade would climb. A colourfulness floor (C* 32) on the
common sea, and the calm fade's own step kept visible to every colour vision (`--water-cvd 4`). Rejected on the way: a lime start
(score 1.01; its 1.25 m band a dusty sage the engine showed as a grey-teal ocean) and mint starts (0.22-0.50).

**Shipped table:** soft green (140,219,128) to 0.5 m, aqua (0,200,173) at 1.25, teal (0,144,174) at 2.5, steel blue (64,104,181) at 4,
indigo (68,67,200) at 6, maroon (115,40,56) at 9, dark red-brown (95,17,0) at 14; OKLab blend anchors at 6.75 / 7.5 / 8.25 m.

| | live light (v2) | first spectrum | re-solved |
|---|---|---|---|
| from dark, 0.8-3 m mean / min | 24.0 / 8.6 | 15.0 / 5.6 | 23.9 / 9.6 |
| from dark at 4 / 6 m | 32.0 / 26.8 | 13.7 / 11.3 | 29.9 / 24.3 |
| neighbour steps, normal-vision weakest | 9.3 | 15.3 | 12.0 |
| neighbour steps, colour-blind weakest | 7.2 | 5.3 | 4.2 (calm fade only, tritan); >= 6.5 everywhere else |
| solver score (1 = normal 10 / colour-blind 6.5 / lightness 5 on every step from 0.5 m) | - | 0.82 | 1.10 |

Lightness falls at every 0.02 m on the table; the composite's one wiggle is < 1e-5 OKLCH L at 0.48-0.50 m (coastal, full lighting).
Crest switch over the new wash: 2.35 m (`v2s`, |Lc| 41.7; 33.0 at 3.05 m). Engine (production build, offline): light today | re-solved
| dark at world, regional and calm views plus a crest burst, 18 shots, GL errors 0; the open-sea umber crests on the teal read like
today's on cyan. The one shared hue left is the indigo ring at 4-6 m, near dark's blue-violet at 2.5-4 m (a different height, so the
per-height measure passes it). Evidence: `evidence/wave-light-spectrum-apart-from-dark-2026-10-21.json`.

## Merged with D-041: the original crests are the default over the spectrum too (lead, ~22:34Z)

#438 merged (D-041): light's default crests are the original again (deep navy -> amber-gold -> crimson red); V2 only on request
(`__RAW_LIGHT_CREST_V2__`). dev `83c1c4c0c` merged into #431; `resolveLightCrest` reconciled: no request -> `v1` on every light wash
(the spectrum included); on request -> `v2` over v2, `v2s` (2.35 m switch) over the spectrum. The far-zoom lift is keyed on `v2s`, so
it rides only the opt-in. By default #431 now leaves DRAW_FS and DRAW_VS exactly as dev (sha256 pinned from dev's own files; dev's DRAW_FS
changed with #438 / #419, re-pinned to `e2438586`). Tests: the spectrum, crest, palette, height-encoding and dark storm crest suites, 88/88.

**The original crests over the re-solved wash** (the lead's ask, the owner's complaint):
- Model (`crest-over-wash.mjs --crest v1`, crest core at the engine's opacity per zoom, weakest lighting / whitecap): on BOTH live light
  and the spectrum the original crests reach |Lc| 0 from about 2-2.5 m up at every zoom; the spectrum is 2-8 lower at 0.3-2 m.
- Engine (open sea about 2 m, paired exact wash, p99 |Lc| live light -> spectrum): z 2.2 22.1 -> 17.5, z 4.6 14.7 -> 11.5, z 9 28.5 ->
  22.2. The original crests are faint on live light already; the spectrum takes 3-6 more.
- No wash fixes it: `spectrum-apart.mjs --crest-lc N` (the original crest core at close-zoom opacity at least N off the wash at every
  height, plus the re-solve's rules) has no solution at N = 10, 12, 15, 20 or 30. Amber (about 3 m) and crimson (6 m up) are
  mid-lightness and a light wash that darkens with height passes through them. The remedy is the crest (a casing or a constant core
  with an opposite-brightness edge: the light-crest session's D-040 work), not the sea.
Evidence: `evidence/wave-light-spectrum-original-crests-2026-10-21.json`.

## Ledger lines handed to the lead (2026-10-22 ~00:20Z)

The owner to the lead: "resolve all the conflicts and merge, communicate between sub chats". To merge without serial re-chains, #431
carries no ledger lines or STATE edit: ACTIONS.jsonl and STATE.md are dev 23a91534f's exactly. #431's seven lines (decision D-037,
pr_open, commitment, the crest-zoom finding, the re-solve finding, the D-041 finding, the ship decision; numbered 1603-1609 on this
branch before the hand-over) and its STATE "Now" line were sent verbatim to the lead session for one receipts PR after the merges.
The seq numbers quoted above in this log are the branch's at the time; the receipts PR assigns the final ones.
