# 2026-10-09 · Light's colour-blind pass on the neutral ground (the muted basemap)

Owner: "then do the light colour-blind palette pass", after #296 muted the basemap under the wind. On a neutral ground,
light's FIELD tints collapse for a deuteranope: 27-33 kn at 1.8 on light's own near-grey land (unchanged since the
first colour-blind pass) and at 1.9 on the muted water. Floor: 5 ΔE2000 (coloraide Viénot protan/deutan, Brettel
tritan; `frontend/scripts/wind-color`).

## Method (the 2026-10-09 colour-blind pass's solver, re-pointed)

The earlier pass's least-change solver: OKLab moves, every Jest gate replicated as a hard constraint, the colour-blind
floor soft, maximin mode for ceilings, a greedy prune. Changes for this pass:
- the colour-blind pairs are scored on the MUTED ground (the app's own `muteColor`, light water x0.90 / land), water AND
  land;
- every other gate keeps its original surfaces (the Jest tests still read them);
- the no-new-band rule also runs on the muted ground;
- the unmuted water is held at today's 2.75 and the unmuted land is not lowered;
- field stops only (the legend already passes at 5.2).

## Ceilings: what light's rules allow

| constraints | best worst-pair (maximin, seeds) |
|---|---|
| every gate + no new band (≤ 1 L*) | 2.36-2.64 (10 seeds; 2.6 typical) |
| ... with the dark-parity strength pin loosened to ±12 dE76 | 2.6-3.1 |
| ... with no strength pin at all | 2.6-3.2 |
| ... with the hue identity loosened to 30° | 2.6-2.7 |
| new bands allowed up to 2 / 3 / 4 L* | 3.1 / 3.6-4.2 / 3.1-3.9 |
| no band rule at all | **5.2** (all gates), by 4.5-8 L* stripes at 33, 47 and 63 kn |

What binds is smoothness (L-V15). On the muted ground, light's 21-75 kn tints sit at one lightness (L* 55-59) and differ
only in hue (yellow-green → gold → orange → red → crimson → plum). A deuteranope loses most of that hue. Five needs
either visible lightness bands, or a redesign of light's warm fast-band hues so that neighbours differ on the
blue-yellow axis or in lightness. That is the character change, and it stays an owner decision.

## Shipped (light FIELD only; the legend unchanged; kill `__RAW_DISABLE_WIND_LIGHT_NEUTRAL_CVD__`)

Five stops, each ≤ 0.014 dE_OK (total 0.040; L* within 1.6):

| kn | before | after | L* |
|---|---|---|---|
| 10 | 0.719 0.640 0.914 | 0.710 0.639 0.913 | 71.1 → 70.8 |
| 21 | 0.462 0.759 0.538 | 0.462 0.747 0.521 | 72.2 → 71.3 |
| 27 | 0.631 0.705 0.434 | 0.634 0.708 0.432 | 70.4 → 70.6 |
| 33 | 0.687 0.634 0.429 | 0.670 0.618 0.409 | 66.5 → 64.9 |
| 40 | 0.751 0.595 0.470 | 0.742 0.579 0.462 | 65.6 → 64.3 |

Weakest neighbouring tint (worst of protan/deutan/tritan):

| ground | before | after |
|---|---|---|
| muted water (what shows with the wind on) | 1.92 (27-33 deutan) | **2.58** |
| muted land | 1.85 | **2.59** |
| unmuted land (kill-switch picture) | 1.83 | **2.52** |
| unmuted water (kill-switch picture) | 2.75 | 2.75 (kept) |

The tint makes no new lightness or chroma turn on any ground. Normal-vision minimum unchanged (3.1 muted water). Checker
(coloraide): light tint over water 1.9 → 2.6 (RED against 5, as documented), legend 5.2, hue bent ≤ 1 kn, and the
40 kn streak now sits 3.2 L* off its own tint (was a 1.3 L* watch item).

Tests: `windPaletteCvd.test.js` pins every ground at the new floor (never lower) and adds a positive control: the kill
restores the rows and the 1.9 collapse. Palette suites 72/72.

## Open

- Five on a neutral ground needs the warm fast-band redesign: an owner A/B of light's 33-75 kn hues (e.g. a blue-violet
  end instead of crimson → plum, or a steady lightness descent with speed at a relaxed strength pin).
