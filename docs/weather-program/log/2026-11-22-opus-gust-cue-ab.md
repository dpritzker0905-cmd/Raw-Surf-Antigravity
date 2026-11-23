# 2026-11-22 · Gusts non-colour gustiness cue A/B (opus, branch claude/gust-cue-ab)

Task from the director group (GUSTS-SOTA-PATH item 4): A/B the gust flicker against alternatives so the owner can pick.
Stacked on #1176 (gust dark field parity).

## What changed
- `windGustColour.gustCue()`: one lever, `window.__RAW_GUST_CUE__` or localStorage `rawGustCue`, picks between
  `flicker | width | hatch | none`. The default stays `flicker` (today), so nothing served or drawn changes until the
  owner picks. Each cue has its own kill (`__RAW_DISABLE_GUST_FLICKER__` / `_WIDTH__` / `_HATCH__`); all are registered in
  the kill-switch inventory and in windDarkRules' list of switches that do not touch the colour tables.
- `width`: `gustShaderSplice.js` `v_bold` widens a gusty mark across the flow, up to 1.8x over G/W 1.5 -> 2.0. Length
  and motion are untouched.
- `hatch`: new `gustHatch.js`. A static, map-anchored diagonal hatch over the field (from G/W 1.5; cross-hatch from 2.0),
  drawn by the wind engine in the heatmap slot that gust mode leaves free. It samples the wind exactly as the marks do,
  point registration included.
- `GustCueKey.js`: the legend line that explains the cue, in all three MapWeatherControls layouts. Today's flicker had
  no legend text until now.

## Evidence
`audit/gust-cue-ab-2026-11-22/` holds the README with numbers, the luminance-only sheets, the real-time clips, metrics.json
and the harness. It was measured offline: synthetic backend, injected G/W bands, 24 sessions. Hatch reads 1.8-9.2x the
no-cue signal in gusty air and 0.97-1.03x in steady and 1.4 air. Width reads +8% to +31% coverage at 2.3. The flicker is
not measurable with a per-pixel detector on moving marks; that is stated, not concluded.

## Advisors
Round 1 (design): Reflection and SubQ recast "longer streak" as "wider across the flow". LongCat failed with a network
error and was not retried. Round 2 (results): all three answered. Their 1.4-band hatch leak finding was fixed (registration).
Their contrast concern is open: the estimates are below 3:1, and the alpha needed for 3:1 is stated as a post-pick tuning
choice. Full record: the director group's shared notes, GUST-CUE-AB-DESIGN-2026-11-22.md.

## Open
- The owner's pick. It then becomes `GUST_CUE_DEFAULT`, ON, with its kill.
- No real phone GPU check yet. Hatch contrast tuning (if hatch is picked).
- No SCOREBOARD row: no served number moves.

## Cue-choice round (director's SOTA directive, 2026-11-22; public context only)
SubQ and Reflection were asked which one cue should ship as the default, given the measured evidence above. The owner
still picks.
- Reflection (Beam-1.0): **C hatch**. It is static, so it survives reduced motion, and it discriminates best; width is
  too subtle and the flicker is unmeasurable. Risk: below 3:1 contrast on light and beach, plus phone clutter. Tune
  first: raise the alpha to about 0.42 dark, 0.64 light, 0.70 beach.
- SubQ (savant-1.4): **C hatch**. It has the strongest specificity (1.8-9.2x gusty, 0.97-1.03x steady and 1.4) and
  works under reduced motion. Risk: light and beach contrast 1.7:1, and no real-phone test. Tune first: the same 3:1
  alphas.
Tested before the PR: every arm in dark, light and beach, at desktop 1440 px and phone 375 px (24 sessions). The PR
changes no gust palette (the #1176 lane) and no wind colour (the dark-wind-vivid lane).
