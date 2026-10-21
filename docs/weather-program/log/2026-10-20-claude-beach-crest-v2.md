# 2026-10-20: beach crest V2 (polarity), owner A/B

Session opened 2026-10-20T12:11Z, started by the lead session (weather-simulation audit) with the brief: restore beach-theme crest
visibility at 1.5-4 m over the monotonic wave palettes of #411. Branch `claude/beach-crest-v2`, cut from dev `26385e031`: it was
first stacked on #411's head, #411 merged mid-session as `f550d2502` with the owner's pick (light A + beach B, shipped as `v2`,
D-033), and the branch was re-cut on dev (LESSONS L-P34). Client only. **No served number changes** (no SCOREBOARD row): the beach
crest colours move; every height, rating and glyph the backend serves is untouched, and so are dark's and light's crests, the
wash, the motion and the texture encoding. Draft PR, owner A/B.

## What changed

- `frontend/src/components/map/marineCrestPalette.js` (new): `BEACH_CRESTS` { `v1` (today), `v2` (polarity, the default), `warm`
  (the A/B's other candidate) }, `resolveBeachCrest`, and the three DRAW_FS lines generated from the table.
- `WebGLMarineParticleShaders.js`: the beach branch's three colour lines are interpolated from that module; one import line, paid
  for by folding the header comment, so the file stays at its LOC baseline (978). Dark's and light's literals are untouched.
- V2 polarity: `calmColor = mix(plum, cream, step(2.00, v_wave_height))`, `activeColor = mix(plum, lemon, step(2.00, ...))`,
  storm foam white: deep plum (0.30, 0.00, 0.26) below 2 m; cream (1.00, 1.00, 0.84) and lemon (0.95, 1.00, 0.10) from 2 m;
  foam white (1.00, 0.98, 0.92) at 6 m and up. Warm: coral-pink (1.00, 0.32, 0.41), tangerine (1.00, 0.62, 0.00), lemon (1, 1, 0).
- **Kill** `window.__RAW_DISABLE_BEACH_CREST_V2__ = true`: the pre-V2 DRAW_FS byte for byte (sha256 `a9e8e102...a0ad`, 8811
  characters, pinned in `marineCrestPalette.test.js`; a 0.01 nudge to v1's calm fails three tests, the mutation check). V2 also
  stands down under either wave-palette kill, because it was solved for the v2 wash. `window.__RAW_BEACH_CREST_V2__ = 'warm'`
  draws the warm candidate until the owner picks.

## How it got here: the first solve was superseded the same day

1. **First solve, the warm ramp** (`crest-solve.mjs`, then hand polish): coral-pink -> tangerine -> lemon, solved against #411's
   candidates A and B together before the pick. Core vs wash 40.3 dE00, colour-blind 23.9. Built, harness-confirmed, page drafted.
2. **The lead's research reached this session only through the log.** Ledger 1541 (log `2026-10-19-claude-scrub-upgrade.md`, the
   09:50 EDT section) says it was sent to the beach-crest session; no message arrived here (inbox and notes folders empty). It
   says a crest polarity switch at wash APCA-Y 0.352 keeps |Lc| >= 53 over both ramps, and that direction of motion needs
   luminance contrast (Lindsey & Teller 1990).
3. **Measured the warm ramp against it:** APCA |Lc| under 15 from 1.3 m to 3.3 m and 0 at 2-2.5 m, the commonest seas. Any smooth
   ramp that holds colour contrast must cross the wash's luminance somewhere (crest darker at calm, lighter at storms), so only a
   switch avoids it. The v2 beach wash passes APCA Y 0.352 at 1.76-2.36 m by zoom and swell lighting.
4. **Re-solved with `--polarity`:** at an |Lc| floor of 40 the dark ink goes near-black; L* 15 plum keeps 36 with colour. A gold
   storm costs |Lc| (30-35) and the 3 m / 6 m cue; foam white keeps both. Switch 2.0 m beat 2.1 and 2.2 on colour-blind (22.8).

## Numbers: the checker (`wave-check.mjs` over v2; coloraide authority in brackets)

Every 0.1 m from 0.2 m and the above-cap state, world/regional/coastal alpha, swell lighting off/half/full, whitecap off and on.

| beach crest | core vs wash, dE00 | colour-blind | APCA \|Lc\|, crest body / whitecap front |
|---|---|---|---|
| today (v1) | 8.6 | 1.6 [3.4] | 0 / 0 |
| **V2 polarity** | 27.1 | 22.8 [23.7] | 36.4 / 30.3 |
| V2 warm | 40.3 | 23.1 [23.9] | 0 / 0 |

Light, unchanged: 16.8 / 13.4 / |Lc| 0 (now read with the above-cap state and every lighting; see the follow-ups).

## Numbers: the real engine (offline harness)

`serve_synthetic.py --dynamic 1 --vortex-peak 11` and `scn_wave_palette_ab.js` (`VARIANTS=c1,v2,cw THEMES=beach CLIP=1 PAIRED=1
CLIP_VIEWS=world,regional,coastal`), production bundle, no request to the live backend. Every shot read back the beach crest
GLSL the GPU compiled (today's panes v1, polarity panes the `mix(... step(2.00, v_wave_height))` lines, warm panes coral /
tangerine / lemon), with the same valid time (15:00Z) and bounds per view across variants, and the bare water read as
(117, 207, 240), the model's. `crest_contrast.py` against the PAIRED exact wash, p99 over sea pixels, 40 frames each:

| view | today: dE00 / colour-blind / \|Lc\| | V2 polarity | V2 warm |
|---|---|---|---|
| world (open sea 0.5-1.7 m) | 7.4 / 4.9 / 0.0 | 25.0 / 19.4 / 26.9 | 21.5 / 17.5 / 9.4 |
| regional (the storm) | 17.7 / 12.9 / 18.9 | 37.9 / 24.1 / 41.5 | 42.6 / 29.5 / 34.6 |
| coastal (6 m+ seas) | 23.9 / 16.1 / 20.5 | 45.5 / 38.4 / 68.9 | 64.7 / 34.5 / 66.3 |

Null control (first half of a variant's frames vs the second): <= 3.3 at world and coastal; at regional up to 20.3 (polarity
|Lc|), where the storm moves across the frame between the halves, so read regional as a range.

**An instrument error caught the same session:** the first pass estimated the wash by a 15 px median. At coastal zoom the crests
are big and dense (they cover over 80% of the sea there: only 16-18% of sea pixels are untouched in the paired frames), the
median landed on crests, and polarity read 12.5 -> 17.0 with deutan flat. The paired mode (the same instant drawn with the crest
pass off, the engine's own heatmap-only fallback) measures against the exact wash; it is the one to use.

## What it costs (for the owner's eye)

1. **The calm crests turn dark.** Orchid-pink becomes a deep plum, its dark relative: the biggest change in the look.
2. **A visible contour at 2 m:** crests switch from plum to cream where the sea crosses 2 m.
3. **A whitecap's front lightens a dark crest** just below 2 m (|Lc| 30 there instead of 36): the foam, as on water.
4. **Warm reads stronger in colour** (40.3 vs 27.1 normal) but not in brightness near 2 m; it is one lever away for the A/B.

## Instruments

- `wind-color/crest-solve.mjs`: differential evolution over the crest colours, smooth or `--polarity` (switch height, APCA floor).
- `wind-color/wave-lib.mjs` reads the beach crest table from `marineCrestPalette.js` and models the polarity switch;
  `wave-check.mjs` samples the above-cap state and every swell lighting and reports APCA for the body and a whitecap's front;
  `wave_cvd_check.py` (coloraide) judges the crest pairs too; `cvd_lut.py` exports coloraide's dichromats as a 33^3 lattice
  (Vienot exact, Brettel within 3.4e-3 linear).
- `offline-backend/crest_contrast.py`: crest contrast read off the engine's frames (dE00 in four visions and APCA), paired or median.
- `offline-backend/scn_wave_palette_ab.js`: crest variants `c1` / `cw`, the GPU read-back of the compiled beach crest GLSL, `PAIRED=1`.
- `offline-backend/compose_wave_ab.py`: `--variants`, `--tag`, `--clip-view`, `--title`.

## Follow-ups (not built here)

- **Light's crests cross light's wash luminance near 3 m** (APCA |Lc| 0) and light's crimson storm on its red above-10 m flag is
  13.4 colour-blind: the same polarity lever applies (its own PR and owner A/B; light is untouched here).
- The harness's engine identity reads `hMin`/`hMax` as null (the engine grid holds no `vectors` there): pre-existing in #411's run.

## PR, page and checks

- Draft PR #416 (`claude/beach-crest-v2`, `337d6103d` on dev `26385e031`); owner A/B page (private to the owner):
  https://claude.ai/artifact/1CEnLsyDUXbmqADniMxDyi (today | V2 polarity | V2 warm: model strips, contrast by height, engine
  stills and three moving clips, the paired numbers).
- Ledger 1543 (`pr_open`), 1544 (`commitment`: the owner's pick by 2026-10-24, then the other candidate and its lever go, the
  kill stays).
- Local checks on the final tree: Jest 458/459 suites (the one failure is `netlifyIconStoredTailScope.test.js`, a Git Bash spawn
  over its 5 s limit on this Windows box, identical on dev), `check_eslint.js` clean (debt down), `loc_ratchet.py` clean (the
  shader at 978), `craco build` compiled. Hosted CI is the authority.
- Evidence: `docs/weather-program/evidence/beach-crest-v2-2026-10-20.json`.

## 2026-10-20 15:44Z: the lead's crest research arrived by message (after the PR), and what it changes

Five delayed messages from the lead and the palette session arrived at once: the D-033 pick, the violet flag, the rebase onto
dev, and the lead's crest research (navy / white polarity switch at wash APCA Y 0.352: min |Lc| 53.2-53.4 on A and B; tinted
inks cost 4-11 Lc; Lindsey & Teller 1990, Gegenfurtner 1995, Derrington 1993: judge crest vs wash by luminance, and about 53 Lc
is enough; Burr 1982: if thin crests read weak, widen the stroke rather than saturate). #416 already did all of it: it was
built from the same finding read in the lead's log. Measured #416's tinted inks against navy / white on both footings:

| footing | navy / white | #416 (plum; cream, lemon, foam) |
|---|---|---|
| the lead's: ink at full opacity on the v2 table wash, switch on the wash's own Y | 53.3 | 50.5 |
| the checker's: crest core at 0.85 over the composited wash, every zoom and lighting, switch at 2.0 m | 41.3 (colour-blind 23.0, normal 23.7) | 36.4 (colour-blind 23.8, normal 30.6) |

Both minima sit at the switch (2.0 m, world zoom, full swell lighting, light side). The tints cost about 3 Lc on the lead's
footing (inside the ~4 it quotes for its gentlest tint, #123858 / #FAFDFF) and buy colour (normal 30.6 vs 23.7). Kept as built;
a whiter cream would recover about 2 Lc. Not built here, a separate variable: a slightly wider stroke in the switch band
(Burr 1982), and switching on the wash's own luminance instead of a height (the same thing for a lightness-ordered ramp, but
it would need the ramp's GLSL in DRAW_FS, which is at its LOC baseline).

## 2026-10-20 15:47Z-18:40Z: the owner's direction, and the beach A/B becomes sea + crests

The owner's words, in order (this session, relayed nowhere else):
- 15:47Z, after seeing the polarity / warm A/B: "Owner pick on #416: ship the V2 polarity beach crest; drop the warm candidate and
  its lever, keep the kill switch." Then: "Is polarity the most state of the art version?" (answered: of what was built, yes; a
  cased crest could rank above it, untested). Then "Finish shipping polarity on #416 now ... Propose the cased crest as a follow-up A/B."
- 15:56Z: "I kind of like warm, but I also like polarity.... is there a better blend". Answered: polarity's rule in warm colours.
- 15:57Z: "perfect, lets go with this logic for all theme modes. I think other subs are working on this, so update them on this
  ideology"; 16:02Z: "if they have specific logic in place that is better than what we're doing for beach mode theme, then we should
  go with that. But if not, lets use this logic. Whatever is state of the art"; 16:14Z: "Leave dark alone if dark is okay. I liked
  dark"; 16:24Z: "We can fix that one weak point only on the extreme 8m" (dark's storm crest; session dark-storm-crests started,
  measure first). The light-crest session and the lead were briefed (warm polarity; keep a theme's own logic where it measures better).
- 16:25Z-16:50Z: "Beach mode, I like V1 better by the way" (the wash, confirmed by question). Shown, on one picture, that the old
  sea's brightness goes up and down with height, so crests match it over ~63% of heights and polarity would flip three times;
  "No I like the old beach sea"; "Is this okay for state of the art?" (answered: no, and why); then chose "Build the middle ground
  (Recommended)" (about 16:52Z): the old sea's colours in a darkening order, with warm-polarity crests, as an A/B against the old sea.

What was built (this PR, a second visual variable by the owner's direction):
- `marineWavePalette.js` `BEACH_WASHES` { B (D-033's), mid }: v2's beach is `mid` by default on this branch, `B` on
  `window.__RAW_BEACH_WASH__ = 'B'`. Light is untouched. mid: aqua -> spring green -> golden sand -> apricot -> coral -> brick-rose
  -> crimson, deep violet flag (`wave-solve.mjs --family V --pin-h`). Checker: lightness falls at every step, neighbours 8.9 dE00
  (B 6.5), land 19.3, no grey; flag darker than the cap as drawn (11.3 dE00 off it; its legend arrow |Lc| 11.8, a watch).
- The crest V2 is warm polarity, solved against mid (`crest-solve.mjs --table`): oxblood below 2.5 m, pale lemon / lemon from
  2.5 m, peach storm. Over mid: 23.5 dE00, colour-blind 14.7 (tritan, at the switch), APCA |Lc| 34.0 (whitecap front 22.8). It
  stands down over B or v1.
- Why the sand is golden, not peach: over beach's cyan basemap, a peach or orange sea laid at 65% mixes toward grey (the old sea's
  1-2 m beige is exactly that mix: the audit's "0.6 m and 2.4 m the same grey"), D-019 bars grey, and the solver pays any pin
  penalty rather than lay it (pinned 58-76, it stays at ~92). In the engine the common 1-1.7 m sea therefore reads olive-gold.

Engine (offline, paired exact wash, p99; ab5 smooth clips for the page, ab6 paired for the numbers):

| view | old sea: dE00 / tritan / \|Lc\| | middle ground | this morning's (B) |
|---|---|---|---|
| world | 17.3 / 14.4 / 0.0 | 22.3 / 18.9 / 24.6 | 7.7 / 6.0 / 0.0 |
| regional | 34.5 / 33.6 / 20.2 | 28.6 / 18.8 / 31.8 | 17.9 / 13.6 / 18.4 |
| coastal | 35.4 / 32.2 / 33.1 | 50.4 / 38.8 / 61.6 | 23.7 / 15.6 / 20.2 |

Null control <= 0.9 at world and coastal, <= 5.3 at regional. Owner page (same link, version 2):
https://claude.ai/artifact/1CEnLsyDUXbmqADniMxDyi. Commitment 1544 (the owner's pick) stays open for this A/B.

## 2026-10-20 evening: the sunset middle ground replaces the first one; #416 rebuilt on dev (D-035)

The owner (this session): "I like the middle ground, but with that said, the old sea is easier to see between wave height sizes,
as in the steps between the colors are more clear", then "Yes: replace the first middle ground with the sunset middle ground in
#416, run the engine A/B (old sea vs sunset middle ground), and update the page."

- Dev had locked beach to v1 (D-035, #417) while #416 was open, so #416 no longer changes beach by default. The first middle ground
  (`BEACH_WASHES` mid/B) is gone; the sunset sea is `WAVE_PALETTES.sunset`, beach only, drawn ONLY under
  `window.__RAW_BEACH_WASH__ = 'sunset'`. D-035's pins pass unchanged (beach samples, legend and shader branch).
- Sunset sea: v1's six anchors and five steps, aqua -> lime -> gold -> coral -> rose -> purple, lightness falling at every 0.02 m;
  clamped at 10 m like v1. Steps between sizes (world composite): weakest 16.1 dE00 (v1 14.5), colour-blind weakest 11.6 (v1 11.6);
  AVERAGE step old 28.0 / sunset 22.5, colour-blind 21.8 / 12.7 (the old sea's big steps come from brightness jumping up and down).
- Engine (offline, paired exact wash, p99; v1 -> sunset with the first crest): world dE00 17.1 -> 24.3, colour-blind 10.5 -> 17.9,
  |Lc| 0.4 -> 23.3; regional 35.1 -> 37.5 / 25.2 -> 27.2 / 24.1 -> 44.0; coastal 37.4 -> 56.4 / 33.4 -> 35.3 / 34.5 -> 57.7.
  Evidence: `evidence/beach-sunset-ab-2026-10-20.json`.
- Two merges of dev (#415/#417/#418, then #421 light crest V2 + #424). The shared crest tools landed with #421 first; #416 takes
  those copies and adds beach's tables (`BEACH_CRESTS` beside `LIGHT_CRESTS`, one import line in the shader, still 978 lines).
  This log's ledger lines 1543-1546 were re-chained after dev's head twice: they are now **1558-1561** (1543 -> 1558 pr_open,
  1544 -> 1559 commitment, 1545 -> 1560 decision, 1546 -> 1561 correction); `restack.py`, true times kept in `acted_at`.

## 2026-10-21: a structured design critique of the three crest colours, and crest V2.1

The owner: "I want you to use art skills, run a structured design critique with colour-harmony checks across all three crests, to
make sure we're making this fit our middle ground best as possible." Read as beach's three crest colours (calm, active, storm, and
the whitecap they carry) over the sunset sea, with light's crests (D-036) as the family check.

Instrument (`crit.mjs` on the wave-lib model; numbers in `evidence/beach-crest-critique-2026-10-21.json`): worst case over every
zoom, swell lighting and 0.05 m, whitecap off and on, of APCA |Lc| (body and whitecap front), CIEDE2000, coloraide dichromats and the
engine's self-contrast; plus the harmony terms the contrast search does not see: hue relation of ink to local sea (OKLCH),
blue-yellow separation (what dichromats keep), the seam at the switch, the 3 m vs 6 m energy cue, coastal repaint at the crest
cover the engine measured (~78% of coastal sea pixels), and role-by-role distance to light V2. Twelve candidates.

Findings:
1. The whitecap was the weak point: white foam mixed into the oxblood ink near the switch lands on the sea's luminance (front |Lc|
   24.9). Foam that follows the ink (oxblood-black below, white above, as light's does) lifts it to 38.1-38.5 and the z 3-4.9
   self-contrast centre from 25.7 to 35.6, at no cost elsewhere.
2. The switch belongs on the sea's 2.4 m anchor: a 1.9-2.8 m scan puts the best worst-case body |Lc| at 2.40 (39.9), dE00 rises
   25.9 -> 35.1 there, colour-blind keeps rising slowly; the crest flip then coincides with the sea turning coral (and the
   legend's 8 ft tick) instead of falling between two steps. The solver with dark foam picks 2.64 (its objective weights the
   colour-blind margin); 2.40 is the body-|Lc| optimum and the structural one.
3. Extension (Itten): near the coast crests are most of the picture, and a peach storm repainted the rose-purple storm sea toward
   orange (model 48-59 degrees of hue; engine frames 19) and bleached it; cream bleached it more. A pale tint of the storm sea's
   own rose (blush [1.00, 0.84, 0.88]), the painter's highlight, keeps the hue (model 1-13 degrees; engine 2) and doubles the
   lemon -> storm energy cue (dE00 23.3 -> 49.0). Lilac does as well but is cooler.
4. Family: every theme keeps one rule (dark ink where the sea is light, light ink where it is dark, the foam follows the ink), each
   in its own sea's colours. Light's own inks on this sea would repaint the purple storm yellow (gold, 99-133 degrees).
5. Kept: the warm inks (oxblood, lemon), the owner's direction. Set aside: aubergine dark ink (blue-yellow separation 0.005 -> 0.044
   for dichromats on small seas, best self-contrast, but cool); wine (no gain).

Built (`9765cc30d`): `BEACH_CRESTS.v2` = V2.1 (switch 2.4 m, oxblood / pale lemon + lemon, blush storm, foam switching); the first
sunset crest stays as `v2a` behind `window.__RAW_BEACH_CREST_V2__ = 'first'` for the A/B only (to go with the owner's pick, as
commitment 1559 already says); beach's foam line now comes from the table (v1's is the old literal byte for byte). Checker on the
sunset sea, first -> V2.1: dE00 25.9 -> 27.0, colour-blind 17.1 -> 18.1 (coloraide 18.4 -> 19.1), |Lc| body 39.3 -> 39.9,
whitecap front 24.9 -> 38.5, 0 red lines. Engine, paired p99 (first -> V2.1): world 24.2 -> 26.0 / 17.7 -> 20.3 / |Lc| 23.3 -> 27.1;
regional 35.7 -> 31.4 / 22.6 -> 21.1 / 38.1 -> 33.4 (that view's run-to-run null is 4.4-4.8: the storm moves through it);
coastal 56.3 -> 41.1 / 35.3 -> 36.4 / 57.7 -> 61.3 (blush separates by brightness, not hue: the colour difference falls by
design and stays far above the 15 watch line). GPU read-back confirmed each pane's compiled crest lines.

Also fixed on the way: dev's `crest-solve.mjs` has no `--table` (`--palettes sunset` replaces it, README updated); dev's
`crest_contrast.py` defaults to `--theme light` (pass `--theme beach`); the checker now takes table ids like `v2a`.

Owner page (same link, version 5, with the critique board "Quiet Counterpoint"): https://claude.ai/artifact/1CEnLsyDUXbmqADniMxDyi.
Local checks: crest + light-crest + palette + encoding Jest suites 79/79 then 60/60 on V2.1, wave-check 0 red lines on sunset,
`craco build` compiled. Commitment 1559 (the owner's pick) stays open; nothing merges without it.
