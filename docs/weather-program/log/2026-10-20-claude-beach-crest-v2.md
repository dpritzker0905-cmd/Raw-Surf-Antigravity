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
