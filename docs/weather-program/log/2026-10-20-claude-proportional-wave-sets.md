# Proportional wave sets: the crest period cue made physical at every zoom (2026-10-20)

Session started 2026-10-20 ~02:15Z by the lead session (crest animation physics audit, ledger 1491; memory
`crest-animation-physics-2026-10-20`). Branch `claude/proportional-wave-sets`, worktree `C:/Users/David/App/rs-crestk` (a
dot-free path: CRA Jest finds no tests under `.claude/`), built on `dev` a4a02033 (the measured "old" build), rebased onto b240d727 (#402) and then 6021c2cc (#403, #395) before the push.
Client only. **No served number changes** (no SCOREBOARD row): the crest wave-train envelope's spatial frequency is a drawing
parameter; no height, period, rating, glyph or hub value moves. One visual variable: the period cue of the band.

## 1. The defect (from the audit, re-derived here from the mirror)

The crest envelope phase is `fract(dot(pos, dir) * f - t / T)`, so band speed = 1 / (T f). #397 (2026-10-19) stopped the
high-zoom whole-screen pulse with a PER-PERIOD bound `f = max(clamp(800/T^2, 3, 25), 3 / viewWorldWidth)`. From z 4.2 on a
1280 px view every period 6-20 s sits on that bound, shares one spacing, and band speed goes as 1/T. Relative to a 10 s swell,
at T = 6 8 10 12 14 16 18 20 s (deep water 0.60 .. 2.00):

| 1280 px | #397 (dev) | proportional |
|---|---|---|
| z2 | 0.60 0.80 1.00 1.20 1.19 1.04 0.93 0.83 | 0.60 0.80 1.00 1.20 1.40 1.60 1.80 2.00 |
| z3 | 0.72 0.96 1.00 0.83 0.71 0.63 0.56 0.50 | same |
| z4 | 1.44 1.25 1.00 0.83 0.71 0.63 0.56 0.50 | same |
| z5 .. z19 | 1.67 1.25 1.00 0.83 0.71 0.63 0.56 0.50 | same |

(A 390 px phone is inverted from z2.) The z2 row also shows the old floor 3 flattening 16.3-20 s at every zoom.

## 2. The change

`f = clamp(800/T^2, F_FLOOR, 25) * k`, `k = max(1, 3 / (viewWorldWidth * F_FLOOR))`, `F_FLOOR = 800 / T_MAX^2 = 2.0`,
`T_MAX = 20 s` (the GPU period encoding's ceiling, `waveData.a * 20`). One factor for every period: spacing ∝ T^2 and speed ∝ T
in every view; the 20 s period keeps exactly 3 sets in view, every shorter period more, so the anti-pulse bound holds.
`waveSetScreenBound.js` holds the GLSL (`waveSetFreq`, spliced into DRAW_VS for the envelope and the orbital pitch) and its JS
mirror; `applyWaveSetUniforms` replaces the engine's single uniform call on the same line (engine line count unchanged).
After the measurements below, the GLSL ternary around k was dropped (`max(1, 0 / x)` is already 1 when the bound is killed;
the encoding guard read its ` ? ` inside a template string as mojibake). Same value for every input: the GLSL parity test
and the mutations were re-run on the final text.
Kills: `window.__RAW_DISABLE_PROPORTIONAL_WAVE_SETS__ = true` -> #397 exactly; `__RAW_DISABLE_SCREEN_BOUNDED_WAVE_SETS__`
keeps its meaning (no screen bound: k = 1); both -> pre-#397 exactly.

Floor: the old 3 was "at least 3 sets per WORLD". The on-screen minimum it stood in for now lives in k (3 sets of T_MAX per
VIEW), so the floor can be the spacing of T_MAX itself and never binds inside 6-20 s.

**Trade, for the owner's A/B:** 6 s chop shows 33.3 sets per view at every zoom: 38 px band spacing on a 1280 px desktop, 12 px
on a 390 px phone (#397: 3 sets from z5, 427 / 130 px). And because the app's minZoom is 2, k = 1 needs a view 1.5 worlds wide
(>= 3072 CSS px at z2): on real screens k = 2.4 (desktop z2) to 7.9 (phone z2) and the look changes at every zoom, not only from
z3. "Byte-identical where k = 1" holds (tested at 3072-8192 px views) but no ordinary screen is there. If the phone spacing reads
as shimmer, the next lever is T_MAX from the displayed data (Reflection's suggestion) rather than a constant.

## 3. Measured

**Tests** (`waveSetScreenBound.test.js`, 10): >= 3 sets of T_MAX at every zoom 2-19 on 1280 and 390 px (tight: exactly 3);
band-speed ratio strictly increasing and equal to T/10 at z1 z3 z4 z8 z19 on both widths, and over every GPU period byte up to
20 s; #397's inversion pinned (z5: 0.50 at 20 s, 1.67 at 6 s); identity with #397 and pre-#397 where k = 1 for T <= 16.3 s;
the z12-15 view pulse < 0.03 for 6/10/14/20 s (pre-#397 > 0.5); kills; uniforms; **the GLSL function run on its own text**
against the mirror (0/3 sets x both modes x 8 zooms x 18 periods x 2 widths); the shader's two call sites. Mutations, each
caught: floor back to 3 (2 fail), per-period bound in the new branch (3), k without minSets (3), GLSL k without the floor
term (1), proportional kill ignored (2), engine not setting u_proportionalSets (1).

**Settled-zoom probe** (`frontend/scripts/visual-lab/settled_zoom_probe.js`, offline: `serve_synthetic.py --thin-bounds 1` on
:4113, the two builds served on :3171 / :3172, nothing sent to the live backend). Old = dev a4a02033 build, new = this branch.

| run | frames | 1 s steps > 16 | settled luminance range per zoom | rAF/render dt p50 / p95 / p99 ms |
|---|---|---|---|---|
| nightly leg z12 -> 14.5 (0.18 steps, 5 s), old | 8,882 | 0 | 0.2 - 0.5 | 17 / 19 / 40 |
| same, new | 8,177 | 0 | 0.2 - 0.5 | 17 / 20 / 41 |
| wide z4 -> 16 (1.0 steps, 4 s), old | 8,123 | 0 | 0.2 - 9.5 | 17 / 20 / 40 |
| same, new | 7,341 | 0 | 0.2 - 9.4 | 17 / 19 / 42 |
| positive control: new build, BOTH kills (= pre-#397), nightly leg | 10,040 | 0 | 1.4 - 7.5 (sd up to 2.57) | 17 / 20 / 39 |

The control proves the probe sees the pulse (sd 2.0-2.6 at z12, 13.1, 14.2 against <= 0.13 with the bound on). Offline it
stays under the gate's 16 (synthetic field, dark basemap), so the per-zoom swing is the sensitive reading here. The wide run's
z4 swing (9.5 / 9.4) is the load settling in both builds; the new build's z5 swing (4.9 vs 0.8) is one step when a 25 x 21
viewport grid committed late in that window (grid identity changes there), its 250 ms bins flat at 136.0-136.2 like the old
build's: data arrival, not an oscillation. Frame time unchanged (one extra uniform and a branch on a uniform per vertex).

**Owner A/B** (`frontend/scripts/visual-lab/wave_sets_ab.js`, same view on both builds, 20 s recorded after a 12 s settle): the
synthetic storm off Mexico (period ~17 s at the core, ~8 s at the rim) at z5 (-106, 14) and z8 (-103.5, 15.5). rAF over the recorded
window: p50 16.7 / 16.7 ms, p95 16.9-17.0 / 16.9 ms, 0 page errors, every socket closed offline. Side by side, synced:
https://claude.ai/artifact/71wPsbHHB4SCSvF1RnemX4 (private to the owner). Stills confirm both builds draw the field; band speed in
the recordings was NOT measured from pixels (the table in section 1 is the mirror, the video is for the owner's eye).

**Gates.** On b240d727: whole frontend Jest `src` 454 suites / 5,923 tests green except `netlifyIconStoredTailScope.test.js`,
which spawns a bash per case (~2 s each) and timed out under full-suite load (0, 8 and 1 failures over three runs; 12/12 alone;
it tests `netlify.toml`, untouched here). `node scripts/check_eslint.js` exit 0 (it first flagged my unused `eslint-disable`
line, removed). `npx craco build` exit 0 and the bundle carries `u_proportionalSets`. Re-run on 6021c2cc: the three trees `src/components/map src/tests src/__tests__` 412 suites / 5,541 tests green; eslint exit 0.

## 4. Not done here (follow-ups)

- **Drift by orbital velocity** (note only, deliberately not in this PR): ADVECT_FS moves particles by `min(H, 3 m)`,
  period-blind. Deep-water surface orbital speed is `pi * H / T` (2 m / 8 s: 0.79 m/s; 2 m / 16 s: 0.39 m/s); group speed
  `g T / (4 pi)` goes the other way. Which one the drift should read as is the owner's call; either is its own one-variable
  A/B. Nearshore both are depth-limited.
- **T_MAX from the displayed data**, if the owner finds 6 s bands too tight on a phone.
- The live nightly's SETTLED_STEP read after merge (it measured #397's pulse live; offline cannot reproduce its 120 <-> 200).

## 5. Opened

PR #404 (open for the owner's A/B, not merged), ledger seq 1500 (`pr_open`; first appended as 1498, re-chained after #401 merged onto the same head). Open PRs #401, #377, #375, #339, #333 and #264
also append to `ACTIONS.jsonl`: whichever merges second re-chains its lines onto dev's head (LESSONS, ledger forks).
