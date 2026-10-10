# 2026-10-10 · Light's wind look: dark's science with light's own ground (an A/B, default off)

Cloud session, handed the work by the session of `log/2026-10-10-dark-style-light-beach.md` (the owner's local usage was nearly
spent). Owner, 2026-10-10: "We really just need to replicate dark mode, but with proper setup for the colors for each modes schema";
"we need to replicate our science from dark mode"; and, in this session: "Use logic and science and art to figure out the best
solution ... What dark has that light lacks is a dark ground under the streaks. The method only makes streaks lighter, so on light's
near-white ground it washes out, while beach's deeper ground gave it room."

Started 20:30Z. Base: PR #310 ("light comes off glow") was still OPEN, so this branch starts from its head
`claude/wind-light-glow-off` (`ca42f552`), not from `dev`; the PR carries #310's two commits until #310 merges. No request of mine
reached the live backend. Numbers are the palette model (`frontend/scripts/wind-color`), Jest, and the wind bench run headless on
SwiftShader in this container (no GPU, no `REACT_APP_MAPBOX_TOKEN`: map mode ran on a new offline basemap, below).

`memory_audit.py --docs-only` at the start: 0 FAIL, 14 WARN (13 overdue commitments, every one a live read-back of backend or app work
outside this task; none is this session's to close from a container without the live site), 12 NOTE.

## The diagnosis this works from

Measured by the earlier session, not re-derived: dark's streaks are a brighter shade of the colour under them (+9.5 to +14.5 L* at
the median, chroma kept), on a DARK ground. Dark's streak method ("glow" in the code) on light washed out live: light's ground under
the streaks is L* 74-88, and a mark that can only lighten has no room there. Beach's ground is L* 57-72 and the same method reads
well. So the piece of dark's science light lacks is the GROUND.

## What was built (all default off; one lever)

`window.__RAW_WIND_LIGHT_LOOK__` (light only; `WindColorRamp.js` `windLightLook`), read at once (the engine rebuilds its colour
tables when it changes), or `?windLook=` in the address for a phone. Kill: `window.__RAW_DISABLE_WIND_LIGHT_LOOK__` (today's light,
byte for byte, pinned).

- **A, `'moderate'` and `'deep'`: a deeper field + dark's streak method.**
  - The field (0-75 kn) is solved FROM the composite wanted over the muted land: a target L*, C*, hue per Beaufort band, then
    `stop = 1 - (1 - wanted / ground) / strength`, the multiply model of `check.mjs`. Light's own hue order (rose calm, lilac,
    periwinkle, violet, the path's blue and teal, green, teal-green, yellow-green, gold, amber, rose, crimson, plum), each stop within
    20 degrees of today's field hue and 30 of the legend's. A maximin search (simulated annealing, several seeds, warm and cold starts)
    over the 39 numbers, with the colour-blind floor as a hard constraint at 5.5 (margin over the bar's 5), then normal-vision
    separation, chroma and closeness to light's hues; no lightness or chroma stripe from 21 kn up; colour along the whole drawn path.
  - The streaks are the field's own hue (within 15 degrees) at full brightness, at least 14 L* above the field and, from 10 kn, at
    least as colourful: dark's "brighter shade of the colour it rides on". Solved so neighbouring streaks also keep the colour-blind
    floor (dark's streaks are its legend, which keeps it). 3 and 6 kn are paler than their field: lilac and periwinkle cannot be both
    14 L* lighter and as colourful in sRGB.
  - The marks: dark's streak method (`windInk.js` mode 2) with no white mixed in (the table is already lifted).
- **B, `'ink'`: today's field + the marks darker than the ground**, with the warm-band failure fixed:
  - ink's own colours for 27-47 kn, solved over the field-tinted muted water and land: the most colour inside a hue window that is
    never yellow (27 kn a green, 33 ochre, 40 deep amber, 47 vermilion), darkening the ground 7-13 L* (was 14-21), each band at least
    10 dE00 from its neighbours;
  - a cover cap (`GLSL_INK_COVER` in SCREEN_FS): 16 taps on two rings (5 and 11 device px) read how much of the neighbourhood holds
    ink and ease the ink's strength to 0.5 of itself between 40% and 85% cover. Isolated streaks keep full strength.
- **C: today** (the marks before glow, PR #310).

The legend bar never moves (pinned). Beach and dark never move (pinned).

## The palette, per band (the model; light, over the muted ground)

Muted land L* 93.4, muted water L* 72.4 (both near grey). Field = the tint over the ground; streak = the body colour at full strength
(A: the lifted colour laid at opacity 1; B: the ink multiplied at 0.9; C: the legend colour, without its black rim and white ring).

| kn | C field / streak, land | A moderate field / streak, land | A deep field / streak, land | B ink streak, water |
|---|---|---|---|---|
| 0 | 88.5 / 96.6 | 82.6 / 96.6 | 78.7 / 97.0 | 66.3 |
| 3 | 85.2 / 80.7 | 76.1 / 92.8 | 72.1 / 90.2 | 54.3 |
| 6 | 78.7 / 72.1 | 68.7 / 84.2 | 65.1 / 80.3 | 45.4 |
| 10 | 71.4 / 73.1 | 64.5 / 78.6 | 59.1 / 73.1 | 41.7 |
| 16 | 68.2 / 66.2 | 66.0 / 91.0 | 57.1 / 90.1 | 36.1 |
| 21 | 75.0 / 72.0 | 65.3 / 91.8 | 61.4 / 89.4 | 44.2 |
| 27 | 75.3 / 69.7 | 65.5 / 93.5 | 60.3 / 91.3 | 50.8 (was 42.0) |
| 33 | 68.4 / 69.0 | 62.0 / 83.0 | 53.6 / 93.3 | 42.4, hue 84 (was 37.3, hue 90: olive) |
| 40 | 63.4 / 57.9 | 54.0 / 76.9 | 46.8 / 75.4 | 37.9, hue 66 (was 29.3) |
| 47 | 63.7 / 51.5 | 53.8 / 71.0 | 47.6 / 66.9 | 38.0, hue 45 (was 27.7) |
| 55 | 58.5 / 42.9 | 45.3 / 65.5 | 40.0 / 56.5 | 22.5 |
| 63 | 58.7 / 34.2 | 45.4 / 59.4 | 38.9 / 59.7 | 17.2 |
| 75 | 59.0 / 25.8 | 42.0 / 56.0 | 36.0 / 58.3 | 13.7 |

(L* values. Field chroma over the land, 6-75 kn: C 16-30, A moderate 28-59, A deep 25-48.)

| bar | C, today | A moderate | A deep | B ink |
|---|---|---|---|---|
| colour-blind floor, neighbouring tints, muted land / water (>= 5) | 5.26 / 5.22 | 5.71 / 5.64 | 5.60 / 5.51 | 5.26 / 5.22 (the field is today's) |
| weakest colour on the drawn path, 3-40 kn (>= 8 C*) | 10.7 | 21.8 | 18.6 | 10.7 |
| ground under 6-27 kn streaks, muted land (L*) | 68-79 | 64.5-68.7 | 57.1-65.1 | 68-79 |
| streaks, colour-blind neighbours (a watch, never a gate) | the legend, 5.2 | 5.1 | 5.6 | 5.2 |
| dark's strength per band, 6-21 kn (D-018's bar, within 1 dE76) | holds | **re-scoped: deeper** | **re-scoped: deeper** | holds |

`node frontend/scripts/wind-color/check.mjs --strict [--look moderate|deep|ink]`: 0 red lines and 0 colour-blind red for all four.
The checker gained `--look` and a colour-blind line for the muted LAND (light 5.3 and beach 5.2 today: both pass).

## Independent review (21:30Z): what it found, and what changed

A reviewer with no part in the work read the diff and computed against it (LESSONS L-V27 rule 7). Verified: with the lever off the app
draws what it drew, byte for byte (2,448 configurations of lever values, older kills, themes and speeds, 0 differences; old and new
SCREEN_FS compiled and linked in WebGL1 and WebGL2 on SwiftShader, 384 uniform combinations read back identical at a cap of 1); dark,
beach and the legend never move; the old ink and glow levers are unchanged; the wash numbers recompute. Five findings, all fixed in this
PR. The tests were written after the fixes, so each was checked by a deliberate break instead (below):

1. **A moderate's streaks went grey between 10 and 16 kn.** Its streak table's 10-16 kn segment kept 0.58 of its colour, just over the
   hue path's trigger (1/2), so it was drawn straight: C* 0.4 at 11.5 kn, then green over a blue-teal field. Fixed: A's streak tables
   carry 1 kn waypoints on the FIELD's own path (blue, azure, teal), every segment now keeps 0.92 or more, and the hue path has nothing
   to add to them. Pinned: every look table keeps the trigger's margin (under 1/4 or over 3/4).
2. **An older kill stripped the hue path from the look's field** (C* 7.5 / 4.2 at 13 kn under `__RAW_DISABLE_WIND_HUE_PATH__`). The
   look's field now draws its path whatever older kill is set, as the comment promised.
3. **The address pattern was loose** (`?windLook=ink-test` turned on ink; `?next=/map?windLook=moderate` turned on moderate). Now read
   with `URLSearchParams`, whole value only.
4. **The ink cover taps clamped to the buffer's edge** where `trailTexel` reads blank paper; a comment named the wrong channel. Both fixed.
5. **The checker measured the legend, not the look's marks,** in the streak-core line, and the ink look's colour-blind watch read bare
   inks (a multiplied mark is never seen bare). Both now read the marks as drawn.

Also: the "off" tests compared against this code's own default; they now pin FNV hashes of the tables captured from `ca42f552`.

The waypoints' blue (11-12 kn) is paler than its field, like the lilac and periwinkle: blue is vivid only when dark.

Deliberate breaks of `WindColorRamp.js`, each against `windLightLook.test.js` (46 tests), file restored byte for byte after: the
waypoints removed (2 red), the older kill let back onto the look's field path (2 red), the loose address pattern back (1 red), the look
read for every theme (2 red), the lever defaulting to a look (13 red). 5 of 5 caught. Not caught by Jest: the cover taps' edge rule
(GLSL; the bench draws it) and the checker lines (a dev tool, run by hand).

## 21:45Z: PR #311 opened

Against `dev`. STATE "Now" carries it.

**Correction (22:30Z), the base and the ledger.** This branch was cut from #310's head at 20:31Z; #310 had taken one more commit at
20:30:56Z (the owner took beach off glow too, ledger seq 1039, a decision) and merged at 20:33:17Z. The first push of this PR therefore
carried #310's two older commits and ledger lines numbered 1039-1040 that forked dev's chain. Rebuilt on dev `e0af8880` in a separate
worktree (LESSONS L-P14), the ledger lines re-chained after dev's head: seq 1040 `pr_merge #310` (it had none), seq 1041 `pr_open #311`,
seq 1042 the commitment (the owner's pick on the A/B and the 3-seed scan, due 2026-10-17). The forked 1039-1040 never reached dev.
The owner's words at 20:25-20:28Z ("If dark mode doesn't have glow, than beach shouldnt have glow.... we need to replicate our science
from dark mode"; "Beach mode needs dark mode's science too") reached this session through that commit, after the handover had asked
for beach to be reported, not changed: see "Beach" below. The final bench run (z4, z6, z8 at served strength; z6 at storm strength;
the beach-gap arm) and the scanner were still running when the PR opened; their results follow below.

Tuning that set the marks (z6, served strength, offline map; the end column recomputed with the final bar):

| arm | land: step, lighter, chroma field -> streak, picture ends | water: step, ends | lines kept (land) | streak signal (land) |
|---|---|---|---|---|
| dark | +17.0, 1.00, 20.5 -> 22.0, 31.8 | +10.5, 50.1 | 0.414 | 8.99 |
| beach (today, glow) | +12.5, 1.00, 31.0 -> 44.5, 67.6 | +12.0, 68.8 | 0.583 | 7.44 |
| light today | +6.0, 0.72, 19.5 -> 19.0, 75.0 (28% darker: an edge) | +11.5, 73.4 | 0.491 | 5.18 |
| light glow (the live failure) | +8.0, 1.00, 19.5 -> 23.0, 74.3 | +13.5, 73.7 | 0.587 | 4.18 |
| A moderate, opacity 1.0, ring 0.5 | +12.5, 1.00, 36.5 -> 29.0, **71.1** | +18.5, **71.7** | 0.520 | 7.25 |
| A moderate, opacity 0.8 | +10.5, 1.00, 36.5 -> 29.5, 69.9 | +15.0, 68.5 | 0.562 | 5.81 |
| A moderate, ring 0.25 | +12.0, 1.00, 36.5 -> 31.5, 70.8 | +17.5, 70.9 | 0.519 | 6.82 |
| A deep, opacity 1.0, ring 0.5 | +13.0, 1.00, 40.5 -> 35.5, 65.0 | +20.0, 68.1 | 0.482 | 7.20 |
| B ink | -7.0, 0.00 (all darker), 19.5 -> 29.0, 67.7 | -4.5, 59.1 | 0.773 | 4.33 |

- **Moderate at full strength sits on the wash line** (71.1 over land, 71.7 over water): a ground of L* 65 is about the shallowest dark's
  streak method can sit on. Set: moderate opacity 0.8, ring 0.25; deep opacity 1.0, ring 0.25 (a lighter ring keeps more of the
  streak's colour; the light-air lilacs still read paler than their field, which sRGB cannot avoid).
- **B over the water:** at served strength its marks cover 87% of the Gulf, and the crop shows the sea as a flat dark olive. The
  corrected inks are right band by band; the darkening is everywhere at once. The cap halves it and cannot stop it.
