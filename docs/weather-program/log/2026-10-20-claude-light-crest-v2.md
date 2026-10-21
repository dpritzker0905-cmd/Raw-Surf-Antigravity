# 2026-10-20: light crest V2 (polarity), owner A/B

Session opened 2026-10-20 ~15:44Z, started by the beach crest V2 session (#416) with the brief: give the LIGHT theme's wave crests the
treatment #416 gave beach, a crest that never matches its wash's luminance, with colour-blind contrast as high as possible; start only
after #416 is merged or the owner has picked. Held until the owner picked on #416 (11:47 EDT, relayed by that session: "ship the V2
polarity beach crest; drop the warm candidate and its lever, keep the kill switch"); the owner had told this session to wait for exactly
that. Branch `claude/light-crest-v2`, stacked on `claude/beach-crest-v2` (`57e72589b`); its PR stays unopened until #416 settles, then
the branch is rebased onto #416's final head and its ledger lines re-chained. Client only. **No served number changes** (no SCOREBOARD
row): light's crest colours move; every height, rating and glyph the backend serves is untouched, and so are dark's and beach's crests,
the wash, the motion and the texture encoding.

## What changed

- `frontend/src/components/map/marineCrestPalette.js`: `LIGHT_CRESTS` { `v1` (today), `v2` (polarity, the default) },
  `resolveLightCrest`, and light's four DRAW_FS lines (calm, active, storm and `foamHighlight`) generated from the table.
- `WebGLMarineParticleShaders.js`: the light branch's four lines are interpolated from that module; the existing import line now
  brings both tables, so the file stays at its LOC baseline (978). Dark's literals and beach's lines are byte-identical.
- V2: below 3.05 m calm and active are a deep umber (0.27, 0.10, 0.00); from 3.05 m cream (1.00, 1.00, 0.82); storm gold
  (1.00, 0.96, 0.00); the foam is umber-black (0.05, 0.02, 0.00) below the switch and white from it (`mix(..., step(3.05, v_wave_height))`).
- **Kill** `window.__RAW_DISABLE_LIGHT_CREST_V2__ = true`: the DRAW_FS from before light V2 (#416's) byte for byte (sha256 `8efc8e38...`,
  8938 characters, pinned in `marineCrestPaletteLight.test.js`; with the beach kill too, dev's `a9e8e102...`). A 0.01 nudge to v1's navy
  fails six tests (the mutation check). V2 also stands down under either wave-palette kill, because it was solved for the v2 wash.
- #416's own test file: its pre-V2 hash test now sets the light kill too, and its "light keeps its literals" check moved to the new file.
- Instruments: `wave-lib.mjs` reads light's table from the module (foam per table, the switch on the foam, the engine's crest
  self-contrast as an option, the premultiplied fragment clamp); `wave-check.mjs` checks light's crests from the table (`--crest v1|v2|f.json`)
  and adds a self-contrast watch line; `crest-solve.mjs --theme light` and `--foam r,g,b` (the foam below the switch; the APCA terms then
  score whitecap fronts too); `scn_wave_palette_ab.js` variants `l1` / `lk` / `l1k` and a read-back of light's compiled lines;
  `compose_wave_ab.py` names; both READMEs.

## How it got here

1. **Measured** (wave-check over v2): today 16.8 dE00, colour-blind 13.4 (crimson on the red above-10 m flag), APCA |Lc| 0 at 3.0 m and 0
   on a whitecap's front at 2.4 m. Read by height, it is worse: today's crest body is at |Lc| 0 in the worst zoom and lighting from about
   3 m all the way to 16 m (amber, then crimson, at the darkening wash's own luminance).
2. **The crossing:** light's v2 wash passes APCA Y 0.352 (falling, above the 0.18 m depth floor) at 2.60-3.30 m by zoom and swell
   lighting (beach's, reproduced: 1.76-2.36 m). The search scored the switch over 2.6-3.3 m.
3. **Solved with `--polarity --theme light`** (evidence: runs A-N). Free hues pick a dark RED ink below the switch, the hue of the
   red above-10 m flag. Navy or plum below the switch drop colour-blind to 10-15 once a whitecap lightens them on the blue wash; a brown
   keeps the blue-yellow difference that dichromats keep (24.9). Hue 50 (umber) sits clear of the flag (`--dark-h 50,80`). The light ink at
   the switch must be near-white (cream, L* 99) and the storm stays as light (lemon-gold, L* 95): a warmer storm costs |Lc| on the 3-6 m
   path (amber-gold 31.8 at 5.3 m, orange 25.3).
4. **The whitecap trap (new for light):** the switch sits near 3 m, where DRAW_VS's whitecap (`smoothstep(0.5, 3.0, h)`) is at full
   strength, and white foam mixed 45% into a dark ink lands on the wash's luminance: |Lc| 0 on the whitecap's front at 3.0 m. Beach's 2 m
   switch has weaker whitecaps (30 on its front). So the foam switches with the crest (no added line: `foamHighlight` is the branch's
   fourth line). A foam scan (evidence `foam_scan`): white 0.0, tan 21.8-33.4, umber 40.1, black 43.3 on the front. Umber-black keeps
   the front above the body (40.9) and still shows the roll as a darker band (-6 L*). It also stops the low-height self-contrast from
   lightening a dark crest's centre toward the wash (its foam term): centre |Lc| below 1.05 m 64.7 (today's navy 42.8).
5. **Re-solved with `--foam 0.05,0.02,0`**: both seeds return one umber ink for calm and active, switch 3.17 m at 0.2 m sampling. A scan
   every 0.01 m puts the best worst case at **3.05 m** (|Lc| 39.8, colour-blind 24.0; 3.10 -> 38.2, 3.20 -> 33.9).

## Numbers: the checker (`wave-check.mjs`; coloraide authority in brackets)

Every 0.1 m from 0.2 m and the above-cap state, world/regional/coastal alpha, swell lighting off/half/full, whitecap off and on.

| light crest | core vs wash, dE00 | colour-blind | APCA \|Lc\|, crest body / whitecap front |
|---|---|---|---|
| today (v1) | 16.8 | 13.4 [14.0] | 0 / 0 |
| **V2 polarity** | 32.7 | 24.3 [25.6] | 40.0 / 40.9 |

On the red flag above the cap: today |Lc| 0, colour-blind 13.4 (16.2 over #415's 16 m flag); V2 |Lc| 61-63, colour-blind 36-39.
**#415 (16 m) merged to dev mid-session** (`9c6d5ebb0`): on a trial merge the checker reads `v2@16` with the same minima (they sit at the
switch) and coloraide 25.6 on both. The rebase onto #416's final head must re-run it on the real tree.

## Numbers: the real engine (offline harness)

`serve_synthetic.py --dynamic 1 --vortex-peak 11` and `scn_wave_palette_ab.js` (`VARIANTS=l1,v2,lk,l1k THEMES=light CLIP=1 PAIRED=1
CLIP_VIEWS=world,regional,coastal`), production bundle built from this branch, no request to the live backend (ports 4120 / 3107; 3100
was another session's). Every shot read back light's four compiled crest lines (l1 and l1k navy/amber/crimson/white, v2 and lk the
`step(3.05, v_wave_height)` lines; lk and l1k with `__RAW_CREST_CONTRAST__ = 1`). `crest_contrast.py --theme light` against the PAIRED
exact wash, p99 over sea pixels, 40 frames each:

| view | today: dE00 / colour-blind / \|Lc\| | V2 polarity | V2 + self-contrast everywhere (lk) |
|---|---|---|---|
| world (open sea 0.5-1.7 m) | 15.7 / 14.7 / 21.5 | 25.1 / 23.8 / 34.8 | 25.2 / 23.9 / 35.3 |
| regional (the storm) | 26.5 / 24.6 / 15.3 | 43.4 / 31.7 / 41.9 | 46.8 / 34.4 / 50.2 |
| coastal (6 m+ seas) | 40.1 / 46.4 / 23.8 | 80.9 / 53.5 / 75.2 | 81.3 / 54.3 / 84.5 |

Null control (half against half): <= 1.2 at world and coastal; regional up to 17.9 (the storm moves across the frame), so read regional
as a range. Today with self-contrast everywhere (l1k) is no better than today (world |Lc| 21.5 -> 19.5).

## The cased crest (the owner's question to the beach session, measured here for light)

A dark casing round a light core at every height (no switch line). Model, min over every height, view and lighting (|Lc| / colour-blind /
normal): polarity 40.0 / 26.2 / 40.1; the true cased crest with the same inks (umber casing, cream-to-gold core, the better edge)
42.9 / 36.4 / 48.1; navy casing with a white core 44.9 / 29.8 / 31.0; polarity with the engine's self-contrast everywhere 46.1 / 27.0 / 29.2.
The cased model assumes both rings resolve; at world zoom a crest is 3-6 px. In the engine, the cheap probe (lk) adds +0.5 / +8 / +9 |Lc|
at world / regional / coastal. A true casing needs new geometry in DRAW_FS (no lines to spare at 978) and its own A/B; the self-contrast
lever (`__RAW_CREST_CONTRAST__`) is shared with dark and beach, so flipping it is a separate variable.

## What it costs (for the owner's eye)

1. **Calm crests turn from navy to deep umber**: the biggest change in the look (most seas are under 3 m).
2. **A visible contour near 3 m**: crests switch from umber to cream where the sea crosses 3.05 m (a ring around a storm).
3. **Whitecaps below 3.05 m deepen the crest instead of whitening it**: the roll shows as a darker band.
4. **The storm gold is loud**, and it has to be: a warmer gold costs |Lc| on the 3-6 m path.

## Checks

- Jest (dot-free copy `C:/Users/David/App/rs-lightcrest`): 459/460 suites, 6073/6085 tests; the only failing suite is
  `netlifyIconStoredTailScope.test.js` (`spawnSync bash.exe ETIMEDOUT`, the known Git Bash spawn limit on this Windows box, same on dev).
  The two crest suites: 21/21.
- `check_eslint.js` clean (debt down 9 against the baseline, unchanged by this branch); `loc_ratchet.py` clean (the shader at 978);
  `craco build` compiled; the built chunk carries the V2 lines and the kill name.
- Owner A/B page (private to the owner): https://claude.ai/artifact/F4TCg9jZAGAdjfZW19bNqe (today | V2 | V2 + self-contrast: model
  strips, contrast by height, engine stills and three moving clips, the paired numbers, the cased-crest comparison).
- Evidence: `docs/weather-program/evidence/light-crest-v2-2026-10-20.json`.

## Open

- Rebase onto #416's final head once it lands (it drops `BEACH_CRESTS.warm` and its lever, which this branch does not use; its test
  file and the harness's `LEVERS` line conflict trivially), re-chain this session's ledger lines after #416's, re-run wave-check on the
  merged tree (with #415) and Jest, then open the draft PR on dev with these numbers.
- The owner's pick on light V2 (ship / keep today), and whether the cased crest gets its own A/B.

## 2026-10-20 18:20Z: the owner's warm-polarity direction, measured on light

The beach session relayed the owner (15:57Z): "perfect, lets go with this logic for all theme modes", i.e. WARM polarity (a deep warm
dark ink, a light warm ink, switched at the wash's APCA Y 0.352; judge |Lc| first, colour-blind second); then (16:02Z) "if they have
specific logic in place that is better than what we're doing for beach mode theme, then we should go with that ... Whatever is state of
the art"; then beach's final inks (oxblood (0.40, 0.02, 0.01) / (0.35, 0.01, 0.01) below its 2.5 m switch, pale lemon (0.98, 1.00, 0.30)
and lemon (0.97, 1.00, 0.09) above, peach storm (1.00, 0.83, 0.52)). The owner to this session: "Ok it looks good, just make sure we're
on the best path toward state of the art".

Measured on light's wash (min over every 0.05 m from 0.2 m to the cap and above it, on the 10 m AND the 16 m wash, every zoom and swell
lighting; switch 3.05 m and the dark foam below it unless named):

| light candidate | \|Lc\| body / whitecap front | colour-blind | normal | dark ink vs the red flag, dE00 (10 m / 16 m) |
|---|---|---|---|---|
| today (v1) | 0 / 0 | 13.4 | 16.8 | 37.8 / 35.1 |
| **V2 as built: umber / cream / gold** | **40.0 / 40.9** | 24.3 | 32.7 | 9.9 / 9.5 |
| navy kept below (light's own calm) / cream / gold | 37.2 / 40.9 | 24.3 | 32.7 | 37.8 / 35.1 |
| navy below, white foam (no foam switch) | 37.2 / 0 | 5.6 | 10.3 | |
| beach's exact inks: oxblood / lemon / peach | 35.0 / 37.5 | 32.5 | 41.6 | 1.5 / 3.6 |
| oxblood / cream / gold | 40.0 / 40.9 | 24.3 | 32.7 | 1.5 / 3.6 |
| umber / beach lemon / gold | 36.1 / 37.8 | 32.4 | 48.8 | 9.9 / 9.5 |
| umber / cream / beach peach storm | 35.7 / 40.7 | 24.2 | 31.1 | 9.9 / 9.5 |
| raspberry (0.38, 0.02, 0.14) / lemon / gold | 36.1 / 37.8 | 32.4 | 52.2 | 13.4 / 9.8 |
| crest-solve `--dark-h 0,45 --dark-l 18,35 --light-h 55,110 --storm-h 55,110` (3 seeds/windows) | 36.8-38.7 / 41.4-41.8 | 24.6-24.9 | 34-35 | 1.4-6.5 |
| same, `--dark-l 15,35` | 36.8 / 38.5 | 34.5 | 38.6 | 10.9 / 6.4 |

Read: (1) light's navy calm is not better than umber below the switch (|Lc| 37.2 vs 40.0, colour-blind equal), so nothing of light's
old logic is kept; (2) the warm-window solves converge on an oxblood ink at the flag's own colour (dE00 1.4-6.5; light's above-cap flag is
dark red (105, 9, 0) / (88, 0, 2), unlike beach's violet) and gain nothing on brightness; (3) beach's lemon above the switch buys
colour-blind 24 -> 32 for about 4 |Lc|, and the peach storm costs |Lc| on the 3-6 m path, as amber did. By the owner's order (|Lc| first,
colour-blind second) light keeps V2 as built: it is warm polarity already (a dark warm ink, a pale warm ink, a warm storm), with the dark
ink moved off the flag's red to umber. Family with beach: both are dark warm ink -> pale yellow -> warm storm; the differences are measured.

State of the art, the path: V2 polarity is the best measured option with DRAW_FS's current structure. The next step past it is geometric,
the cased crest (model |Lc| 42.9, colour-blind 36.4: both higher), and the lead's Burr (1982) note (a wider stroke near the switch);
both need shader lines, so their own change and A/B.

## 2026-10-20 21:00Z: rebuilt on dev (beach undecided again; #416 not a base any more)

The beach session (18:2xZ and later): dev now locks beach's sea to v1 (D-035, #417, merged 18:24Z); the owner wants to compare it with
a middle-ground beach sea first, so #416's beach crests are undecided and must not be light's base. "Light is unaffected: D-035 says
palette work applies to light only. Your brief stands ... Your branch should come from current dev (it has #415's 16 m light wash and
#417's per-theme palettes), not from #416."

So `claude/light-crest-v2` was rebuilt on dev `f6b80f724` (the stacked commits stay on the local ref `light-crest-v2-on416`; their
ledger lines 1545-1547 never reached dev and are re-recorded on dev's chain below):
- `marineCrestPalette.js` holds LIGHT only (`LIGHT_CRESTS`, `resolveLightCrest` on `MARINE_WAVE_PALETTE_IDS.light`, the four lines).
  Beach's and dark's crests stay DRAW_FS literals, byte for byte.
- The shader: the header folded 3 -> 2 lines to pay for the one import line, still 978. Kill = dev's DRAW_FS (`a9e8e102...`, 8811).
- #416's instruments come with it, light-only: `crest-solve.mjs`, `cvd_lut.py`, `crest_contrast.py`, `wave_cvd_check.py`'s crest pairs,
  the harness's `PAIRED` / `CLIP_VIEWS` / compiled-GLSL read-back (light's four lines), the composer's options; `wave-lib.mjs` reads
  light's table from the module and beach's crest as the shader's literals (`BEACH_V1`).
- `marineHeightEncoding.test.js` (#415): its two whole-shader pins (every shader string = #411 head under the 16 m kill; 16 m on differs
  only by the decode) now also set `__RAW_DISABLE_LIGHT_CREST_V2__`; the crest lines are this branch's test's to pin.
- Checker on the dev tree, light: v2 and v2@16 both 32.7 dE00 / colour-blind 24.3 / |Lc| 40.0, 40.9 on a whitecap's front (today
  16.8 / 13.4 / 0). Beach's line is dev's own crest on dev's v1 sea (|Lc| 0 at 0.3 m, colour-blind 0.8): beach's, for the owner.
- Engine, re-run on the dev-based build (16 m encoding: every pane read `heightScale` 16 and its own compiled light crest lines;
  ports 4127 / 3117, stopped after), `crest_contrast.py --theme light`, paired exact wash, p99, 40 frames each, dE00 / colour-blind /
  |Lc|: world today 16.9 / 15.7 / 22.3 -> V2 24.3 / 23.3 / 34.3 (lk 25.2 / 23.8 / 35.2); regional 29.8 / 28.4 / 17.6 -> 43.9 / 30.0 /
  40.1 (lk 57.7 / 40.4 / 58.5); coastal 40.0 / 46.0 / 24.2 -> 81.7 / 54.0 / 76.1 (lk 81.4 / 54.2 / 84.4). Nulls (half vs half) <= 1.9
  at world and coastal, 5-20 at regional. Same picture as the #416-based run.
- Checks on the dev-based tree: Jest 459/460 suites, 6097/6109 tests (the failing suite is `netlifyIconStoredTailScope.test.js`, the
  known spawn timeout, same on dev); crest + palette + encoding suites 65/65, a 0.01 nudge to v1's navy fails 5; `check_eslint.js`
  clean; `loc_ratchet.py` clean; `craco build` compiled (the chunk carries the V2 lines and the kill name).
- Draft PR #421 on dev (`8c00a989c`). Owner page v3 (the dev-based stills, clips and numbers):
  https://claude.ai/artifact/F4TCg9jZAGAdjfZW19bNqe. Ledger on dev's chain: the warm-family finding (acted 18:20Z), the pr_open, and
  the commitment for the owner's pick.

## 2026-10-20 ~22:50Z: the owner's pick, #421 marked ready

The owner, in this session: "Ship light crest V2 (#421): umber / cream / gold warm polarity, on by default with the kill switch. Record
the pick and mark #421 ready once hosted CI is green." Hosted CI on #421's head `1e7d67ed8`: 17 pass, 3 Netlify rule checks skipped,
mergeStateStatus CLEAN; marked ready there (`gh pr ready 421`), the owner's words quoted in a PR comment. Recorded as DECISIONS D-036
and ledger (decision, fulfils 1555) in a docs-only commit after it, whose CI runs on the ready PR. Not merged: merging waits for the
owner's word.

## 2026-10-21 00:14Z: MERGED #421 into dev, and the deployed build read back

The owner, in this session: "Merge #421 into dev once every hosted check on its head is green, then record the pr_merge ledger line and
read back the deployed build." Every hosted check on head `bee1e33a0` passed (19 pass, Netlify "Pages changed" skipped; mergeStateStatus
CLEAN; dev unchanged at `f6b80f724`). Squash-merged with `--match-head-commit` at 2026-10-21T00:14:11Z as `5fe62b5f2`; `git diff
bee1e33a0 origin/dev` empty. Ships ON with the kill `window.__RAW_DISABLE_LIGHT_CREST_V2__`.

Read-back of the deployed dev build (`dev--rawsurf.netlify.app`, static files only, no backend): `service-worker.js` BUILD_VERSION
`5fe62b5f` at 00:19:28Z; at 00:49:08Z, 103/103 JS files of its `asset-manifest.json`: chunk `6362.56b06a95` holds light's V2 table (the
names "deep umber, cream from 3.05 m" and "umber-black foam, white from 3.05 m"), the kill name and v1's "deep navy", and dark's
("mint-green") and beach's ("orchid-pink") crest literals; no other file carries them. (The GLSL `step(3.05, ...)` text is built at
runtime from the table, so it is not a literal in the bundle.) Not yet seen on a screen by the owner: the dev site is gated.

## 2026-10-21 17:15Z: light's storm crests in warm gold (D-040, its own PR)

The owner, with the density pick for #428: "Also switch light's storm to the warm gold in its own PR." (This branch,
`claude/light-storm-warm-gold`, is separate from #428; the 00:30Z art pass that proposed the warm gold is in #428's copy of this log.)

**Change.** Light crest V2's storm (D-036, `LIGHT_CRESTS.v2.storm`) goes from the lemon (1.00, 0.96, 0.00), C* 94, to a warm gold
(1.00, 0.90, 0.30), L* 91 C* 74 h 96. Only DRAW_FS's storm line moves; kill `window.__RAW_DISABLE_LIGHT_STORM_WARM__ = true` draws
D-036's DRAW_FS byte for byte (sha256 pinned in `marineCrestPaletteLight.test.js`). Harness variant `wk` = the lemon.

**Checker** (wave-check over v2 and v2@16, the art pass): the storm does not touch V2's weakest point, the 3.05 m switch (|Lc| 39.8 /
whitecap front 40.8, colour-blind 24.2, dE00 31.8; coloraide 25.4; with the lemon 40.0 / 40.9 / 24.3 / 32.7 / 25.6). From the 3 m
cream: 17.7 dE00, colour-blind 13.3 (lemon 20.1 / 10.2). 7.3 dE00 from the app's own yellow-400.

**Engine, offline** (production bundle of this branch; store `--vortex-peak 11`, so storm crests are drawn; `l1` V1 / `wk` lemon /
`v2` warm gold; world, regional and coastal clips, 24 paired frames each; every pane read back its compiled storm line: `l1`
vec3(0.75, 0.10, 0.05), `wk` vec3(1.00, 0.96, 0.00), `v2` vec3(1.00, 0.90, 0.30), same valid hour 15Z and grid). `crest_contrast.py`,
p99 of each pixel off its paired crest-free wash, lemon -> warm gold:

| view | APCA |Lc| | normal dE00 | protan / deutan | tritan |
|---|---|---|---|---|
| world | 34.8 -> 34.8 | 25.7 -> 25.0 | 26.3 / 25.8 -> 25.6 / 25.2 | 24.0 -> 24.0 |
| regional | 48.9 -> 49.5 (halves 54.9 / 44.1) | 56.6 -> 49.4 | 57.5 / 58.0 -> 51.1 / 52.1 | 37.0 -> 38.7 |
| coastal (storm) | 78.7 -> 74.5 (halves 74.0 / 75.1) | 82.8 -> 75.8 | 83.2 / 82.6 -> 77.6 / 77.8 | 55.6 -> 55.3 |

The storm crest is a little quieter where storms are, by design (C* 94 -> 74), and keeps about twice the |Lc| floor. Against V1
(`l1`) the whole V2 set still reads as before (coastal |Lc| 23.4 -> 74.5).
