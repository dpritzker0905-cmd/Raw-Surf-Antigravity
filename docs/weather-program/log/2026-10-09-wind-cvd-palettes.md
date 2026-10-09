# 2026-10-09: the wind palettes against the colour-blind floor (branch `claude/wind-cvd-palettes`)

Task (from the session that built the checker, #289): make the light, beach and dark wind palettes pass the
colour-blind floor of `frontend/scripts/wind-color` (5 dE2000 between neighbouring stops; coloraide 8.13 Viénot
protan/deutan, Brettel tritan) while keeping each theme's character, every `windFieldLut.test.js` gate hard, one theme
at a time, kill-switched, with the owner's A/B before anything becomes the default. Palette only: this changes no
served number (no surf height, rating or forecast value), so there is no SCOREBOARD row. This log is written only by
this session.

## 1. The full matrix, not the worst pair

The checker prints the weakest pair per line. Every pair (legend = particle stops; tint = field stops composited over
the measured water, and over land for light/beach), shipped palettes at `abc90c21`:

| theme | legend pairs < 5 | tint-over-water pairs < 5 | tint-over-land pairs < 5 |
|---|---|---|---|
| dark | 4 of 12 (16-21 kn protan 2.4; also 7.9 dE in NORMAL vision, under the checker's 9) | 6 of 11 (21-27 protan 2.1) | n/a |
| beach | 2 of 12 (10-16 tritan 1.9) | 7 of 11 (27-33 deutan 0.4) | 6 of 11 (27-33 protan 0.8) |
| light | 2 of 12 (6-10 deutan 4.3, 27-33 protan 3.9) | 9 of 11 (27-33 deutan 0.3, 47-55 tritan 0.8) | 7 of 11 |

Over the water, light's 40-75 kn tints are all one near-grey: L* 61.6-64.3, C* 2-16, because the pale warm field
(pinned to dark's strength, 24-26 dE76 on the bench grey) cancels the cyan water. 40-47 kn is 3.9 dE even in normal
vision. Beach's 47-75 kn do the same (C* 5-17).

## 2. Instruments

- A JS port of coloraide's CVD filters + dE2000 (Lab D65): 0.000 max difference from coloraide over all 69 scored
  pairs; anchored in `windPaletteCvd.test.js` to coloraide's own output on three reference pairs.
- Every Jest assertion that reads a stop value, replicated verbatim as a constraint (windFieldLut: middle ground,
  adjacency, dark parity per band, hue identity, the light low band / beach green band / mid-band gates, the
  positive control; windParticleContrast: casing internal edge, 3:1 outer ring, better pole, orientation;
  windParticlesV2: 3:1 theme contrast; windLegendFromRamp: 0/75 kn pinned), plus the checker's normal-vision lines.
  Checked on the shipped palettes: every non-colour-blind constraint passes, as Jest does.
- A least-change solver (OKLab, L1 so moves stay sparse), the gates as hard penalties, the colour-blind floor at 5.2;
  a maximin mode for ceilings; a greedy prune that reverts each move unless a gate fails without it.
- A smoothness rule, added after the first dark solve passed by trading blue between 21 and 27 kn (a pale chroma
  stripe between two vivid neighbours): no stop may become a NEW lightness or chroma peak/dip deeper than 1 unit, in
  the legend or in the tint over water/land; turns the shipped palette already has stay allowed, and (beach) the tint
  may also turn where the legend turns.
- A real-map A/B page (L-V10): real MapLibre, the app's Mapbox styles (navigation-night / navigation-day /
  outdoors-v11), the real engine from the worktree under `admin-1-boundary-bg` with the coastline layer, a synthetic
  Gulf hurricane (vmax 66 kn), no backend. BEFORE and AFTER each in their own iframe (the kill flag of one cannot leak),
  screenshot headless on the GPU, then the same pixels re-rendered as a protanope/deuteranope/tritanope sees them.
  Plus a swatch sheet of every stop and tint, both palettes, four visions. Images delivered to the owner.

## 3. Ceilings: what the gates allow

| theme | smooth + every gate: best worst-pair (maximin) | without the smoothness rule |
|---|---|---|
| dark | ~10.4 | (not needed) |
| beach | 2.8-3.2 (6 runs); 4.0-7.3 once the tint may turn where the legend turns | feasible |
| light | 1 run of 11 reached 5.2, by redesigning the field | 5.45, by zig-zag lightness (false bands) |

The light/beach ceilings come from dark parity plus smoothness: at 24-26 dE76 a tint can darken the water by at most
~22 L*, so six fast-band steps cannot each carry 5 dE of lightness, and the chroma left over the cyan water is small.

## 4. What shipped on the branch (one commit per theme)

- **Dark** (`50fe46f1`): 8 particle stops, each <= 0.05 dE_OK (total 0.226). The 10-55 kn bands become one lightness arc
  (L* 83 -> 90 -> 91 -> 86 -> 77 -> 66 -> 59 -> 53). Checker: 0 RED (legend 16-21 normal 7.9 -> 9.5; colour-blind
  legend 2.4 -> 5.2, tint 2.1 -> 5.2). Kill `__RAW_DISABLE_WIND_DARK_CVD__`.
- **Beach** (`d3a724c6`): legend <= 0.013 dE_OK; field 27 kn lifts to a light lime-gold (tint over water L* 60 -> 68),
  40 kn a clearer apricot. Legend, tint over water AND over land >= 5.2 (land's worst 0.8 -> 5.2). Parity kept with >= 0.1
  dE76 to spare. On the map it reads as a pale ring at ~27 kn: the main thing for the owner to judge. Kill
  `__RAW_DISABLE_WIND_BEACH_CVD__`.
- **Light** (`c4b4b720`): every stop <= 0.05 dE_OK (total 0.14). The legend passes (5.2). The tint over water's weakest
  pair rises 0.3 -> 2.75 but stays under 5: one RED checker line, pinned in `windPaletteCvd.test.js` as an EXCEPTION
  for the owner to accept. Kill `__RAW_DISABLE_WIND_LIGHT_CVD__`.
- Not shipped, offered: light's full pass (the 1-in-11 solve): the 21-27 kn field goes pale (tint over water L* 65 ->
  78, against water at 82.7), stops up to 0.18 dE_OK, and 6 land pairs fall under 5. It is a redesign, not a refine.

Verification on the branch: full frontend suite 393 suites / 4468 tests green; ESLint ratchet and LOC ratchet green;
mutation checks RED for every pin (shipped rows restored without the flag, a planted lightness peak/dip, the kill
switch unregistered, light's 33 kn gold and 55 kn field reverted).

## 5. Open after this branch

- The owner's A/B per theme, and the light exception (accept, or ask for the redesign).
- `WindParticleOverlay.js` (the Canvas2D fallback) reads `THEME_RAMPS` directly, so no ramp kill switch (this
  branch's or the older ones) reaches it. Pre-existing.
