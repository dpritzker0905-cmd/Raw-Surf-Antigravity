# 2026-10-21 · Claude · beach crest style: visible crests in beach's own colours (owner A/B)

Session: the beach crest session (started by the lead, local_d6b521eb; its earlier log is
`log/2026-10-20-claude-beach-crest-v2.md` on PR #416's branch). Branch `claude/beach-crest-casing` from dev `a25aaa8ae`.

## The request

The lead relayed the owner's words on the live dev deploy (2026-10-21 08:02 EDT): "I do not like the animation colors of light
mode, with dark animations mixed with yellow ones, its not pleasing to the eye as a good representation of waves moving. The
original was better. And the animations for beach mode, its hard to see the crests colors against some of the heatmap."
Beach keeps the v1 sea (D-035). The crests must become visible on it without the dark/light colour flip he rejected (#416's crest
is that pattern, so #416 is relabelled reference-only). Brief: measure where today's beach crests fail, build 2-3 one-colour-family
candidates with kill switches, check colour blindness and APCA per band, show them moving side by side on an owner A/B page.

## Where today's beach crests fail (as the engine draws the sea)

`frontend/scripts/wind-color/beach-crest-style.mjs` (new): the v1 wash at each zoom state's measured alpha (PR #425's law:
no regional tile at world and fresh regional zoom; BLEND BOTH once one is resident), each crest sampled at its centre, body and edge
as DRAW_FS shades them (today's self-contrast below 1.05 m and in the z ~3.6-4.3 band included), APCA |Lc| of the best part, worst
over swell lighting and whitecap, every 0.2 m.

- World z2.2, coastal z7.4 and close z10: |Lc| < 30 at 48-49 of 50 heights. Fresh regional and zoomed-out regional (the
  self-contrast band): 18-19 of 50 (0.2-1.4 m and 5.4-8 m).
- |Lc| 0 on the sea-green/sand band (1.0 m, 1.6-2.2 m: mauve-pink crest on `#c7a78c`) and the maroon/grey-mauve band (4.4-6.8 m:
  magenta crest on `#84798a`). Leonardo's APCA (wcag3) agrees: `#c13ed8` on `#84798a` Lc 0; `#aba0b2` on `#c8b092` Lc 0;
  control `#ffbbf6` on `#2e969b` Lc -38.6 (the grid says 39).

## Why the answer is a luminance structure, not a new colour

A crest colour that varies smoothly with height and keeps its hue cannot avoid matching the brightness of a sea whose brightness
goes up and down (light at 1.2 m sand and 10 m cream, dark at 0 m teal and 5 m maroon): it must cross it somewhere unless it is
darker, or lighter, than the whole sea (the fixed-point argument). Always-darker crests become near-black at the maroon band (the
owner rejected dark inks in dark mode); always-lighter cannot beat the 10 m cream. A crest that carries BOTH a dark part and a light
part escapes it: one of the two always stands off the sea. That is road casing in cartography (a darker casing under a lighter fill)
and the engine's own self-contrast (dark skirt, brighter core), which today runs only in one zoom band and below 1.05 m.
Perception: motion is seen mainly through luminance (Livingstone & Hubel 1987; direction is lost at isoluminance, Lindsey & Teller
1990); elements that move together read as one field when they look alike (Gestalt common fate + similarity), which is why a
height-threshold colour flip read as two populations.

## Candidates (marineBeachCrestStyle.js; levers `window.__RAW_BEACH_CREST_STYLE__`, kill `__RAW_DISABLE_BEACH_CREST_STYLE__`)

| style | what | model: heights < 30 (world / storm fresh / storm out / coast / close) | worst \|Lc\| | colour-blind | engine p99 \|Lc\| world / storm / coast |
|---|---|---|---|---|---|
| today | as shipped | 49 / 18 / 19 / 48 / 49 | 0 | 3.6 | 1.0 / 22.7 / 33.9 |
| twotone | rim x0.30 + centre 75% to white, opaque to 0.80 | 0 / 0 / 0 / 0 / 0 | 35.2 | 25.0 | 18.0 / 23.7 / 51.0 |
| soft | rim x0.30 + centre 55% | 4 / 3 / 3 / 3 / 3 | 27.8 | 22.5 | 17.9 / 21.1 / 49.2 |
| cased | the engine's self-contrast everywhere | 20 / 18 / 19 / 17 / 19 | 17.9 | 14.6 | 12.4 / 31.2 / 59.9 |

Engine: offline harness, paired exact wash, 24 frames per view, coloraide LUT; colour-blind p99 world 10.8 -> 14.0 / 14.1 / 11.6,
coast 33.4 -> 42.9 / 42.6 / 42.9. Regional differences sit inside that view's run-to-run null (today 8.3, cased 13.9: the storm
moves through it). At world zoom crests are a few pixels wide, so rim and centre blend and the engine gain (|Lc| 1 -> 18; pixels
standing off by 15+: 0.2% -> 2.1%) is below the model's. Each pane's compiled style was read back from the GPU and every DRAW program
linked. Rejected without building: (b) a continuous same-hue lightness shift (the fixed-point argument above) and (c) bolder/wider
crests alone (modelled: still under 30 at 41-45 heights at world/coast/close).

Every style keeps beach's crest colours; with no lever DRAW_FS is today's byte for byte (pinned), each lever changes three lines,
each gated on `u_theme > 1.5`; the shader stays at 978 lines. Moving A/B: real-time recordings (Playwright recordVideo) of the
flow world -> regional -> coastal -> four forecast steps, trimmed and played in sync on the owner page.

Tools asked for and their status: mapbox-cartography and hyperframes-animation skills consulted (generic; the casing practice is
the cartographic one above); Leonardo APCA used; Elicit refused (plan without API access); Consensus failed to connect; Reflection
not consulted (its server is for the user's own requests).

Evidence: `docs/weather-program/evidence/beach-crest-style-2026-10-21.json`.
