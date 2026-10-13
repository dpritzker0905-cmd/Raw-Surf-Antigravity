# 2026-10-09: light's fast wind bands against the colour-blind floor (branch `claude/light-fast-band-cvd`)

Task (relayed from the session that merged #297): with the basemap muted under the wind (#296), light's FIELD tints still sit
below the colour-blind floor of 5 dE2000 between neighbours (coloraide Viénot protan/deutan, Brettel tritan;
`frontend/scripts/wind-color`). #297 proved ~2.6 is the ceiling under light's current rules. Produce two or three redesigns
that reach 5 on the muted water AND land with no new lightness or chroma stripe, ship them as DEFAULT-OFF levers behind one
window flag, and show the owner an A/B on the real basemaps. Owner standing rules that applied: one visual variable at a
time, the owner's A/B before any palette becomes the default, a kill switch on every palette change, no lever state left in
the owner's browser, and (restated 2026-10-10) the goal is better COLOURS: no change to the animation, and nothing removed
from a deliverable except inside a test. Client only: no served number moves, so there is no SCOREBOARD row. This log is
written only by this session.

## Result

Three candidates, each a field-only change (the legend and the particles are untouched). Flag:
`window.__RAW_WIND_LIGHT_FASTBAND__ = 'a' | 'b' | 'c'`, read at the next ramp build (theme change or reload); unset is today's
ramp, byte for byte (pinned).

| | today | A steady descent | B blue-violet end | C gentle |
|---|---|---|---|---|
| weakest neighbouring tint, muted water (dE2000, any of P/D/T) | 2.58 @ 6-10 kn | 5.22 @ 40-47 kn | 5.22 @ 55-63 kn | 5.01 @ 40-47 kn |
| weakest neighbouring tint, muted land (dE2000, any of P/D/T) | 2.59 @ 55-63 kn | 5.26 @ 16-21 kn | 5.27 @ 27-33 kn | 5.10 @ 40-47 kn |
| weakest neighbouring tint, unmuted water (dE2000, any of P/D/T) | 2.75 @ 47-55 kn | 3.04 @ 10-16 kn | 3.11 @ 6-10 kn | 2.92 @ 33-40 kn |
| weakest neighbouring tint, unmuted land (dE2000, any of P/D/T) | 2.52 @ 33-40 kn | 5.21 @ 16-21 kn | 5.21 @ 27-33 kn | 5.00 @ 33-40 kn |
| total change from today (OKLab dE_OK, 13 stops) | 0.000 | 0.924 | 0.845 | 0.618 |
| stops moved | - | 6, 10, 16, 21, 27, 33, 40, 47, 55, 63, 75 | 6, 10, 21, 27, 33, 40, 47, 55, 63, 75 | 6, 10, 21, 27, 33, 40, 47, 55, 63, 75 |
| strength 6-21 kn (bench dE76; dark 23-32) | 22 30 32 32 | 24 30 32 32 | 23 30 32 31 | 24 30 32 31 |
| strength 27-75 kn (dark 30 -> 24) | 31 29 27 26 24 23 24 | 33 34 33 33 41 40 44 | 34 38 35 40 36 36 40 | 32 30 26 31 34 33 36 |
| peak strength vs dark at that band | x1.04 @ 47 kn | x1.83 @ 75 kn | x1.66 @ 75 kn | x1.51 @ 75 kn |
| darkest fast tint L* (21-75 kn): muted water / muted land | 53.8 / 70.1 | 44.5 / 58.5 | 46.5 / 60.9 | 48.5 / 63.4 |
| tint at 75 kn over muted water: L* / C* / hue | 56 / 11 / 310 deg | 45 / 24 / 312 deg | 47 / 22 / 291 deg | 49 / 19 / 309 deg |


- **A, steady descent.** Warm hues kept (hue identity to the legend within the original 25 deg). The tint darkens and
  strengthens with speed. Changes ONE gate: dark parity for 27-75 kn.
- **B, blue-violet end.** 63 and 75 kn run bluer (tint hue 312 and 291 deg; A has 330 and 312). Changes THREE gates: dark parity, hue
  identity at 63 and 75 kn, and the no-new-lightness-turn pin (a 6 kn dip and a 10 kn peak, 1.6-2.6 L* each).
- **C, gentle.** The smallest change (0.62 dE_OK) and the softest strength (peak x1.51 dark). Changes ONE gate (dark parity).
  A pass with no margin: 5.005 over the muted water.

All three also move the 6, 10 and 21 kn field stops slightly (and 16 kn by <= 0.002): the 6-10 and 16-21 kn pairs were below 5
too, so a fast-band-only change could not reach the floor.

## 1. The weakest pairs are not only in the fast band

Today's field on the muted ground (full matrices in section 5): every neighbouring pair from 6 kn up is under 5 for some
viewer except 3-6 and 10-16. The weakest per ground: muted water 2.58 @ 6-10 kn (deutan), muted land 2.59 @ 55-63 kn
(tritan), unmuted water 2.75 @ 47-55 kn, unmuted land 2.52 @ 33-40 kn. Even in NORMAL vision 47-55 kn is 3.1-3.8 dE. The
legend passes (5.22).

## 2. The design space, with numbers

Every figure below is a SEARCH result (a stop-wise random local search on the toolkit's coloraide-exact model), so a ceiling is
a lower bound on what exists, never a proof. Worst neighbouring pair over muted water and muted land, protan/deutan/tritan.

**(a) Which constraint family must give, starting from today's ramp (4 seeds x 40k iterations).**

| relaxed | best worst pair |
|---|---|
| nothing (every gate, no new band, hue drift <= 12 deg) | 2.35-2.82 (the #297 session: 2.36-2.64 over 10 seeds) |
| dark-parity strength pin only | 2.92-3.94 |
| hue identity to the legend only | 2.35-2.82 (no help) |
| hue drift from today only | 2.34-2.88 (no help) |
| strength pin + hue identity + hue drift | 3.09-4.92 |
| the no-new-band rule (stripes allowed) | **5.10-5.22**, by zig-zag: C* on the muted water 23, 11, 33, 10, 7, 21 at 27-75 kn |
| lightness made monotone, chroma left free | 5.22 on 4 of 4, again a chroma zig-zag |
| lightness monotone AND chroma rule, pin/identity/drift relaxed | 2.27-2.56 |

The last two rows are the trap: a solver given only a lightness rule trades the problem into chroma stripes (the L-V15
failure). Without a chroma rule 5.22 is easy and wrong.

**(b) A stripe-free class exists and its ceiling is above 5.** In tint space: L* never rises with speed, chroma monotone, hue
monotone around the wheel (<= 65 deg per stop), steps <= 7 L* and <= 7 C*, every tint >= 14 dE off its ground, strength <= 60
dE76, colour-blind floor the only objective (no other gate). 21 kn anchored near today's green (L* 55-63, C* 18-28, hue
135-165):

| darkest 75 kn tint (L*) | ceiling |
|---|---|
| >= 50 | 5.7-5.9 |
| >= 45 | 6.7 |
| >= 40 | 6.9-7.1 |
| >= 35 | 7.0-7.1 |

With the strength cap as the variable (75 kn L* free >= 35): cap 37 dE76 -> 6.0-6.2; 40 -> 6.5-6.7; 46 -> 6.6; 50 -> 6.9. With
the 21 kn tint held at or under today's lightness (the streak-vs-tint gate needs it): cap 37 -> 5.3, cap 46 -> 6.3; held under
L* 55 -> 4.4. Roughly 0.3 dE of floor per L* of start lightness. Without the 21 kn anchor the optimum starts at a pale cyan
21 kn tint (hue 176-208), which the unmuted-water hue-gap and hand-off gates forbid: that is why the anchor matters.

**(c) Under the FULL gate set, from the right starting point.**

| run | best worst pair |
|---|---|
| polish from hand-built descents (21 kn at L* 58-68) | 2.0-3.7 (the wrong basin: flat lightness, hue zig-zag) |
| polish from the smooth seeds with 21 kn <= L* 58, streak gate KEPT, hue identity 28 deg | **5.22** on 4 of 6 (warm) and 6 of 6 (blue-violet) |
| A's basin, strength cap swept | 33 -> 4.1; 36 -> 4.4; 39 -> 4.65; 42 -> 4.95; **44 -> 5.22** |
| B with the Jest lightness-turn pin held | 4.1-4.9 (best 5.00, 4.9994 on muted water) |
| B with turns allowed at 6 and 10 kn | 5.22 |
| C-like, hue drift <= 14 deg of today's | 4.2-4.9; <= 22 deg gives A's solution |

Sensitivity (drop ONE family from a polish that had stalled at 3.7-4.0, 4 seeds): streak-vs-tint gate off -> 5.0-5.22;
slow-band light gates off -> 4.7-5.2; lightness-monotone off -> 5.22 (stripes); chroma rule off -> 3.9-4.2; hue identity off
-> 3.4-3.7; strength cap and land guard off -> 3.7-4.0; visibility gate off -> 3.6-4.0. That stalled seed started at 21 kn
L* 63, which the streak gate (>= 3.6 L* under the streak at 10-21 kn) rejects. Seeds that start at <= 58 pass with the streak
gate kept.

**What must give for a smooth pass:** only the dark-parity strength pin, and only for 27-75 kn. In the full gate set each
extra 7 dE76 of strength cap buys about 1 dE of floor (33 -> 4.1 ... 44 -> 5.22). Hue identity, the streak-vs-tint gate, the
low-band gates, visibility, hue drift and the 6-21 kn parity all hold in A and C. Direction 2 (a blue-yellow-axis hue end) did
NOT unlock anything the steady descent does not: its lightness descent is what carries the floor, and the bluer end costs two
more re-scoped gates (B).

## 3. The candidates

Per-stop change from today (OKLab dE_OK):

| kn | A | B | C |
|---|---|---|---|
| 6 | 0.041 | 0.071 | 0.024 |
| 10 | 0.044 | 0.009 | 0.050 |
| 16 | 0.002 | <0.002 | <0.002 |
| 21 | 0.011 | 0.008 | 0.009 |
| 27 | 0.027 | 0.020 | 0.020 |
| 33 | 0.035 | 0.043 | 0.019 |
| 40 | 0.096 | 0.068 | 0.016 |
| 47 | 0.119 | 0.144 | 0.134 |
| 55 | 0.174 | 0.146 | 0.107 |
| 63 | 0.188 | 0.163 | 0.120 |
| 75 | 0.188 | 0.171 | 0.119 |
| **total** | **0.924** | **0.845** | **0.618** |


Stripe audit (the repo's own `peaks()`, prominence > 1, stop-level; today has one lightness turn, the 16 kn dip):

| | today | A | B | C |
|---|---|---|---|---|
| lightness turns (prominence > 1 L*), muted water | 16 kn dip 4.6 | 16 kn dip 2.4 | 6 kn dip 1.9; 10 kn peak 1.9; 16 kn dip 5.1 | 16 kn dip 2.2 |
| lightness turns (prominence > 1 L*), muted land | 16 kn dip 5.9 | 16 kn dip 3.2 | 6 kn dip 2.6; 10 kn peak 2.6; 16 kn dip 6.5 | 16 kn dip 3.0 |
| lightness turns (prominence > 1 L*), unmuted water | 16 kn dip 4.7 | 16 kn dip 2.0 | 6 kn dip 1.6; 10 kn peak 1.6; 16 kn dip 5.2 | 16 kn dip 1.7 |
| lightness turns (prominence > 1 L*), unmuted land | 16 kn dip 5.9 | 16 kn dip 3.2 | 6 kn dip 2.6; 10 kn peak 2.6; 16 kn dip 6.4 | 16 kn dip 2.9 |
| chroma turns (prominence > 1 C*), 21-75 kn, muted water | 55 kn 1.1 | none | none | none |
| chroma turns (prominence > 1 C*), 21-75 kn, muted land | 40 kn 1.2; 47 kn 1.2 | none | none | none |


A and C make today's 16 kn dip shallower (2-3 L* against 4.6-5.9). In the 21-75 kn run, A, B and C have no lightness rise
(+0.3 tolerance) and no chroma turn on muted water or land; today has small chroma turns of 1.1-1.2.

## 4. Gates: what each candidate changes (measured, not replicated)

Method: make the candidate the DEFAULT light field in a scratch edit, run the six palette suites (windFieldLut,
windPaletteCvd, windParticleContrast, windParticlesV2, windLegendFromRamp, windBasemapMute: 142 tests), list the failures,
restore the file. 142 pass today.

| Jest test | A | B | C | why |
|---|---|---|---|---|
| windFieldLut: field carries dark's strength in every band (within 1 dE) | fails | fails | fails | THE re-scoped gate. 6-21 kn still within 1 dE76; 27-75 kn up to x1.83 (A), x1.66 (B), x1.51 (C) of dark |
| windFieldLut: field hue within 25 deg of the particle hue | holds | **fails** | holds | B's 63 and 75 kn are bluer than their plum legend stops |
| windPaletteCvd: tint turns in lightness only at 16, 21, 40 kn | holds | **fails** | holds | B adds the 6 kn dip and 10 kn peak |
| windPaletteCvd: "tint over water clears 2.6, not 5" exception | lifted | lifted | lifted | the exception these candidates remove |
| windPaletteCvd: neutral-ground kill positive control | fails | fails | fails | pins today's rows; the lever stands down under any older kill |
| windFieldLut: low-band kill positive control | fails | holds | holds | same, A only |
| total failing | 4 | 5 | 3 | 138 / 137 / 139 of 142 pass |

Everything else holds for all three: legend contrast, particle casing, calm and middle-ground bands, adjacent-stop distances,
low-band hand-off and hue gaps, streak contrast, the posctl "particle-as-field" control.

The repo's own checker (`node scripts/wind-color/check.mjs --theme light`, coloraide), candidate as default:

| | today | A | B | C |
|---|---|---|---|---|
| colour-blind: tint over water (muted) | RED 2.6 (6-10 deutan) | ok 5.2 (40-47 tritan) | ok 5.2 (55-63 protan) | ok 5.0 (40-47 deutan) |
| colour-blind: legend | ok 5.2 | ok 5.2 | ok 5.2 | ok 5.2 |
| normal-vision RED lines | 0 | 0 | 0 | 0 |
| hue fidelity (tint > 30 deg off the legend hue), water | warn 1 kn (12.5-14) | none | warn 1.5 kn (6-14) | none |
| `--no-mute` (kill-switch picture): colour-blind tint over water | RED 2.7 | RED 3.0 | RED 3.1 | RED 2.9 |
| `--no-mute`: hue fidelity | RED 24.5 kn | RED 19.5 kn | RED 24 kn | RED 20.5 kn |

The unmuted picture is not made worse (and is slightly better) but is not 5: it is the pre-#296 map, which the mute replaces.

## 5. Full neighbouring-pair matrices


#### Neighbouring tint pairs over muted water (172,179,180): dE2000 normal / protan / deutan / tritan, floor 5 on the three dichromacies

| pair | today | A steady descent | B blue-violet end | C gentle |
|---|---|---|---|---|
| 3-6 | 7.6 / 5.8 / 6.7 / 7.4 | 5.9 / 5.9 / 6.3 / 5.3 | 13.0 / 8.3 / 9.3 / 10.7 | 8.0 / 6.0 / 7.2 / 7.9 |
| 6-10 | 9.2 / 4.1 / 2.6 / 4.9 **<5** | 9.4 / 6.1 / 5.2 / 9.7 | 15.4 / 6.8 / 5.3 / 6.8 | 14.2 / 6.0 / 5.0 / 14.2 |
| 10-16 | 28.6 / 28.8 / 26.8 / 5.5 | 28.1 / 26.7 / 23.9 / 8.2 | 29.0 / 29.2 / 27.2 / 6.1 | 28.3 / 26.1 / 23.1 / 10.2 |
| 16-21 | 6.1 / 5.0 / 4.5 / 6.1 **<5** | 7.1 / 5.7 / 5.2 / 7.1 | 6.6 / 5.5 / 5.2 / 6.7 | 6.7 / 5.5 / 5.2 / 6.7 |
| 21-27 | 7.6 / 3.0 / 4.7 / 8.1 **<5** | 11.2 / 5.3 / 7.8 / 13.3 | 7.7 / 5.3 / 7.2 / 7.2 | 10.1 / 5.0 / 7.4 / 11.0 |
| 27-33 | 7.3 / 4.0 / 2.7 / 7.4 **<5** | 6.1 / 5.7 / 5.2 / 5.8 | 11.1 / 6.3 / 5.3 / 13.9 | 6.2 / 5.6 / 5.0 / 5.0 |
| 33-40 | 9.9 / 3.9 / 2.6 / 4.9 **<5** | 8.9 / 6.3 / 5.2 / 5.3 | 21.1 / 8.9 / 5.6 / 8.9 | 12.6 / 6.4 / 5.0 / 5.2 |
| 40-47 | 6.4 / 3.0 / 2.6 / 3.2 **<5** | 14.5 / 7.7 / 5.3 / 5.2 | 5.8 / 5.7 / 5.4 / 5.3 | 5.0 / 5.1 / 5.0 / 5.0 |
| 47-55 | 3.1 / 3.1 / 3.4 / 2.6 **<5** | 7.6 / 7.6 / 5.2 / 5.2 | 8.9 / 11.6 / 12.4 / 6.2 | 11.5 / 8.1 / 5.1 / 5.1 |
| 55-63 | 5.8 / 7.2 / 7.5 / 2.6 **<5** | 6.1 / 6.6 / 9.5 / 5.4 | 6.5 / 5.2 / 7.2 / 8.1 | 5.6 / 6.2 / 8.3 / 5.1 |
| 63-75 | 4.1 / 4.0 / 4.9 / 4.5 **<5** | 5.4 / 5.2 / 6.4 / 5.6 | 7.6 / 5.4 / 6.6 / 10.3 | 5.0 / 5.1 / 6.0 / 5.1 |
| weakest | **2.58** (6-10) | **5.22** (40-47) | **5.22** (55-63) | **5.01** (40-47) |

#### Neighbouring tint pairs over muted land (236,236,235): dE2000 normal / protan / deutan / tritan, floor 5 on the three dichromacies

| pair | today | A steady descent | B blue-violet end | C gentle |
|---|---|---|---|---|
| 3-6 | 9.2 / 6.2 / 7.3 / 9.1 | 6.9 / 6.5 / 7.1 / 6.5 | 15.9 / 8.4 / 9.6 / 12.7 | 10.4 / 6.6 / 8.2 / 10.3 |
| 6-10 | 9.6 / 4.5 / 2.8 / 6.9 **<5** | 9.9 / 6.1 / 5.3 / 13.0 | 16.8 / 7.8 / 5.9 / 9.7 | 15.8 / 6.0 / 5.3 / 19.6 |
| 10-16 | 32.3 / 33.5 / 31.3 / 7.1 | 31.4 / 31.2 / 28.0 / 12.7 | 32.7 / 33.9 / 31.7 / 7.9 | 40.2 / 30.6 / 27.0 / 14.9 |
| 16-21 | 6.5 / 5.0 / 4.5 / 6.9 **<5** | 7.7 / 5.8 / 5.3 / 8.1 | 7.2 / 5.5 / 5.3 / 7.5 | 7.2 / 5.5 / 5.2 / 7.6 |
| 21-27 | 9.2 / 3.3 / 5.3 / 11.1 **<5** | 13.5 / 5.7 / 8.6 / 19.6 | 9.3 / 5.8 / 7.9 / 9.7 | 12.3 / 5.5 / 8.2 / 16.8 |
| 27-33 | 8.6 / 4.0 / 2.6 / 8.9 **<5** | 6.3 / 5.8 / 5.3 / 5.8 | 12.5 / 6.3 / 5.3 / 15.9 | 6.7 / 5.8 / 5.1 / 5.1 |
| 33-40 | 11.8 / 4.2 / 2.6 / 5.3 **<5** | 10.2 / 6.7 / 5.4 / 5.5 | 22.0 / 9.5 / 5.7 / 9.1 | 15.4 / 7.0 / 5.2 / 5.7 |
| 40-47 | 7.0 / 3.2 / 2.6 / 3.4 **<5** | 16.1 / 8.5 / 5.5 / 5.6 | 6.1 / 6.3 / 5.6 / 5.5 | 5.1 / 5.2 / 5.1 / 5.1 |
| 47-55 | 3.5 / 3.6 / 3.8 / 2.7 **<5** | 8.1 / 9.2 / 5.6 / 5.5 | 10.4 / 14.1 / 13.4 / 6.1 | 12.6 / 9.4 / 5.4 / 5.4 |
| 55-63 | 6.7 / 8.9 / 8.5 / 2.6 **<5** | 7.3 / 8.1 / 12.4 / 5.3 | 7.6 / 6.3 / 9.4 / 8.5 | 6.6 / 7.6 / 10.8 / 5.2 |
| 63-75 | 4.8 / 4.9 / 6.4 / 4.7 **<5** | 6.5 / 6.0 / 7.8 / 5.7 | 9.2 / 6.1 / 7.8 / 14.0 | 6.0 / 5.9 / 7.3 / 5.2 |
| weakest | **2.59** (55-63) | **5.26** (16-21) | **5.27** (27-33) | **5.10** (40-47) |

#### Neighbouring tint pairs over unmuted water (168,214,222): dE2000 normal / protan / deutan / tritan, floor 5 on the three dichromacies

| pair | today | A steady descent | B blue-violet end | C gentle |
|---|---|---|---|---|
| 3-6 | 5.8 / 5.6 / 6.0 / 5.8 | 5.5 / 5.5 / 5.4 / 4.3 **<5** | 9.8 / 8.2 / 8.8 / 8.8 | 5.5 / 5.5 / 6.0 / 5.4 |
| 6-10 | 7.4 / 4.2 / 2.9 / 3.1 **<5** | 8.9 / 6.4 / 5.7 / 7.4 | 12.1 / 6.9 / 5.3 / 3.1 **<5** | 11.8 / 6.4 / 5.4 / 8.9 |
| 10-16 | 29.8 / 32.1 / 28.8 / 4.2 **<5** | 28.9 / 30.2 / 26.6 / 3.0 **<5** | 30.2 / 32.5 / 29.3 / 4.6 **<5** | 28.8 / 29.8 / 26.1 / 3.7 **<5** |
| 16-21 | 5.7 / 5.2 / 4.9 / 5.7 **<5** | 6.6 / 5.9 / 5.8 / 6.6 | 6.3 / 5.7 / 5.9 / 6.2 | 6.3 / 5.7 / 5.7 / 6.2 |
| 21-27 | 5.6 / 3.5 / 5.4 / 4.9 **<5** | 8.9 / 6.2 / 9.1 / 7.4 | 7.2 / 6.3 / 8.7 / 4.5 **<5** | 8.1 / 5.9 / 8.7 / 6.5 |
| 27-33 | 5.6 / 4.4 / 3.4 / 4.8 **<5** | 6.0 / 5.8 / 5.5 / 5.7 | 9.1 / 6.7 / 6.1 / 10.0 | 6.1 / 6.1 / 5.7 / 4.7 **<5** |
| 33-40 | 7.0 / 5.2 / 4.4 / 3.5 **<5** | 7.9 / 7.2 / 6.5 / 5.1 | 21.7 / 11.8 / 9.2 / 12.2 | 9.8 / 8.6 / 8.1 / 2.9 **<5** |
| 40-47 | 5.8 / 4.1 / 3.7 / 2.8 **<5** | 14.8 / 11.1 / 9.4 / 5.2 | 7.0 / 6.5 / 5.9 / 5.8 | 5.2 / 5.2 / 5.2 / 5.2 |
| 47-55 | 3.8 / 4.2 / 4.7 / 2.7 **<5** | 10.8 / 8.3 / 6.6 / 7.7 | 10.9 / 12.3 / 14.5 / 10.5 | 14.6 / 10.1 / 7.9 / 5.3 |
| 55-63 | 7.1 / 7.1 / 7.0 / 2.8 **<5** | 7.1 / 6.4 / 7.5 / 9.1 | 7.0 / 5.0 / 5.9 / 7.3 | 6.4 / 6.0 / 6.7 / 6.4 |
| 63-75 | 3.5 / 3.8 / 4.0 / 2.9 **<5** | 5.7 / 4.9 / 5.3 / 5.5 **<5** | 6.0 / 5.1 / 5.4 / 5.7 | 4.9 / 4.9 / 5.0 / 3.9 **<5** |
| weakest | **2.75** (47-55) | **3.04** (10-16) | **3.11** (6-10) | **2.92** (33-40) |

#### Neighbouring tint pairs over unmuted land (236,236,232): dE2000 normal / protan / deutan / tritan, floor 5 on the three dichromacies

| pair | today | A steady descent | B blue-violet end | C gentle |
|---|---|---|---|---|
| 3-6 | 9.4 / 6.3 / 7.4 / 9.2 | 7.0 / 6.7 / 7.3 / 6.6 | 16.1 / 8.4 / 9.6 / 12.8 | 10.6 / 6.8 / 8.4 / 10.4 |
| 6-10 | 10.3 / 4.6 / 2.9 / 7.1 **<5** | 10.1 / 6.1 / 5.3 / 13.0 | 17.8 / 8.0 / 6.0 / 10.1 | 16.4 / 6.0 / 5.4 / 19.7 |
| 10-16 | 32.1 / 33.3 / 31.1 / 7.3 | 31.3 / 30.9 / 27.7 / 13.0 | 32.5 / 33.7 / 31.4 / 8.2 | 40.0 / 30.3 / 26.7 / 15.2 |
| 16-21 | 6.5 / 5.0 / 4.5 / 6.9 **<5** | 7.6 / 5.7 / 5.2 / 8.1 | 7.1 / 5.5 / 5.3 / 7.5 | 7.2 / 5.5 / 5.2 / 7.6 |
| 21-27 | 9.1 / 3.2 / 5.1 / 11.1 **<5** | 13.4 / 5.5 / 8.3 / 19.6 | 9.2 / 5.6 / 7.6 / 9.7 | 12.1 / 5.3 / 7.9 / 16.9 |
| 27-33 | 8.4 / 4.0 / 2.6 / 8.8 **<5** | 6.2 / 5.8 / 5.3 / 5.8 | 12.3 / 6.3 / 5.2 / 15.8 | 6.6 / 5.8 / 5.1 / 5.1 |
| 33-40 | 11.4 / 4.1 / 2.5 / 5.3 **<5** | 9.9 / 6.6 / 5.3 / 5.5 | 21.7 / 9.2 / 5.5 / 9.1 | 14.9 / 6.7 / 5.0 / 5.7 **<5** |
| 40-47 | 7.0 / 3.1 / 2.6 / 3.4 **<5** | 16.1 / 8.1 / 5.3 / 5.6 | 6.1 / 6.3 / 5.6 / 5.5 | 5.1 / 5.2 / 5.1 / 5.1 |
| 47-55 | 3.4 / 3.4 / 3.6 / 2.6 **<5** | 8.3 / 9.1 / 5.5 / 5.5 | 10.3 / 13.8 / 12.6 / 6.0 | 12.9 / 8.8 / 5.1 / 5.4 |
| 55-63 | 6.7 / 8.7 / 7.8 / 2.5 **<5** | 7.3 / 8.3 / 12.4 / 5.2 | 7.6 / 6.5 / 9.9 / 8.3 | 6.6 / 7.9 / 10.7 / 5.1 |
| 63-75 | 4.8 / 5.1 / 6.7 / 4.6 **<5** | 6.5 / 6.1 / 8.0 / 5.6 | 9.3 / 6.3 / 8.0 / 13.9 | 6.0 / 6.1 / 7.6 / 5.1 |
| weakest | **2.52** (33-40) | **5.21** (16-21) | **5.21** (27-33) | **5.00** (33-40) |


## 6. The A/B on the real basemaps

Artifact: https://claude.ai/artifact/S3Tw5rDU1oVF8ArDf4YKrW (private; the owner shares it). Real engine and Mapbox
navigation-day basemap (muted as in the app), the committed wind bench's page, build and server, a recorded Gulf storm
(`fixtures/eye-2026-10-09-gfs-native.json`, as served), four cameras (whole storm z6, eye wall z7.3, panhandle coast z7, Mobile
Bay z8) x today/A/B/C, same camera and particle seed in every picture. The page switches every image and swatch between normal,
protan, deutan and tritan vision (coloraide's models, per pixel), shows the neighbour distances between swatches, and defaults
to the wind AS DRAWN (colour + particles). The Mapbox token came from the main checkout's gitignored `frontend/.env` into
process memory only: never printed, never written, and the published page contains none (grepped).

## 7. Mistakes and limits

- **I made the owner-facing page open on "colour only" (particles off).** That view isolates the tint and is a test aid, but
  nobody asked for it and the owner asked why the particles were missing. Republished (version 2): default is colour +
  particles, colour-only is a labelled secondary button. Rule recorded in agent memory (never remove particles from a
  deliverable; removal is for tests only).
- The pictures are single frames after 150 animation frames, at the bench's 448 px thumbnail, so the 1 px streaks read as
  texture and nothing moves. The candidates change no particle colour, size, density or speed, so the motion is the shipped
  motion; a full-size screenshot or clip is the next instrument if the owner wants to judge streaks.
- B reaches 5.22 only by adding two small lightness turns (6 kn dip, 10 kn peak) and re-scoping hue identity; held to every
  existing pin it tops out at 5.00 (4.9994). Its blue shift is modest (tint hue 291 vs ~310 deg) because the hue-identity
  gate and the steady descent already fix most of the path.
- C passes by 0.005 on muted water (5.0054). A tiny drift in the muted ground or the model would take it under; pinned at 5.0.
- The strength re-scope is the substance: A's 75 kn tint is L* 45 over muted water (darkest land L* 58.5, today 70), x1.83
  dark's strength. The owner approved dark parity because it keeps the land visible; whether x1.5-1.8 at the storm bands is
  acceptable is the owner's call, which is what the A/B is for.
- All numbers are the toolkit's model (0.000 max difference from coloraide, anchored in `windPaletteCvd.test.js`) and were
  cross-checked with the repo's real checker and real Jest (section 4), not trusted alone.
- Not touched, pre-existing: `WindParticleOverlay.js` (the Canvas2D fallback) reads `THEME_RAMPS` directly, so no ramp lever
  reaches it.
- The lever is read at ramp build: setting it live needs a theme change or reload. It stores nothing.

## 8. Instruments and reproduction

Toolkit (a copy of the #292 session's, extended): `C:\Users\David\AppData\Roaming\Claude\side-session-notes\local_e8e3ee51-8233-4600-9637-d80fc4aec466\light-fastband-cvd\`.
Extensions this session: the app's muted grounds in the model, per-ground floors, switchable constraint families, shape rules
(monotone hue, step bounds), the tint-space optimiser (`tsopt.js`, `tintspace.js`), the Jest pin as a hard constraint
(`--jestbands`), unmuted-ground floors, `gatereport.js` (the real-Jest gate report) and `checkreport.js`. Tests:
`frontend/src/components/map/windLightFastBand.test.js` (29 tests: default-off, rows touched, kill stand-down, the floor on
muted and unmuted grounds, stripes, strength window, hue identity, land never blocked, plus three positive controls). The
A/B renders: `abshoot.js` (in the same notes folder), against the committed bench; the generic equivalent is
`node scripts/wind-bench/map-run.js --arms '{"today":{},"a":{"__RAW_WIND_LIGHT_FASTBAND__":"a"}}' --themes light`.

## 9. Open (owner)

1. Pick A, B, C or none. If one becomes the default: its rows move into `LIGHT_FIELD_RAMP`, the dark-parity test is
   re-scoped to the chosen candidate's 27-75 kn strengths, the pins that assume today's rows (the "tint clears 2.6" exception,
   the neutral-CVD and low-band kill controls) are rewritten, and a kill switch restores today's rows.
2. If the strength is too heavy for the storm bands, the cap sweep (33 -> 4.1 ... 44 -> 5.22) says what each step costs.
3. Beach and dark are untouched; beach passes already (#292).
