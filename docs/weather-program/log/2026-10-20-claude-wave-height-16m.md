# 2026-10-20: the GPU sees wave heights to 16 m (light + beach v2)

Session opened 2026-10-20T12:11Z, started by the lead session as the follow-up #411 and D-033 named ("widening the height
encoding to ~16 m is its own PR and A/B"). Branch `claude/wave-height-16m`, on dev `26385e031` (#411 merged as `f550d2502` at
13:39Z; its tree equals #411's head `c40cbe67f`, where the baselines were hashed). Client only.
**No served number changes** (no SCOREBOARD row): every height, rating and glyph the backend serves is untouched; what changes
is how many metres the wave texture's 8-bit height byte can hold for the light and beach wash, and the colour v2 draws above
10 m. Draft PR, not merged: the owner's eye on the A/B decides.

## Why

The main wave texture packs height as `floor(min(1, h / 10) * 255)` (`WebGLMarineTextureEncoder.js`) and the heatmap and both
crest shaders decoded `waveData.b * 10.0`, so nothing above 10 m reached the GPU (live storms reach 12.3 m). #411 made that
ceiling explicit (a flag colour above 10 m); this change moves it to 16 m where the palette needs it.

## What changed

- **`marineHeightEncoding.js` (new): the height byte's contract.** The encoder stamps the scale it packed with on what it
  returns (`u_heightScale`), next to the texture, so the resident set and the held coarse base (encoded at different times) each
  carry their own. Every program that decodes a wave texture sets `vec2 u_heightScale` before it draws (x: the texture bound as
  `u_waveTexture`, y: the crest ring-fill's `u_coarseWaveTexture`): the heatmap's main pass (null, so 10, when the score texture
  is bound), the coarse-base wash pass (its own base), advect and draw (resident, ring-fill base). An unset uniform reads 0 and
  the GLSL falls back to 10.0. The shader modules wrap their source in `withHeightScale(template, pick)`, which rewrites the one
  decode and puts the declaration before `main()`; it throws at module load if a shader loses its decode (the encoder would
  then pack /16 for a shader that decodes /10).
- **Per upload, by theme (`marineWaveHeightScale`, `marineWavePalette.js`):** 16 m only where v2 draws the wash (light, beach)
  and only while v2 is on; 10 m for dark (a /16 step moves dark's calm water up to ~4.7 dE00), for rating grids (the encoder
  forces it: the surf-quality path stays byte-identical) and for the score texture (always /10). Under the V2 kill or the old
  palette kill the scale is 10 too.
- **Kill: `window.__RAW_DISABLE_WAVE_HEIGHT_16M__ = true` before load** restores /10 exactly: every upload /10, every shader
  string is #411's text byte for byte (sha256-pinned with the texture bytes in `marineHeightEncoding.test.js`), and v2 draws
  #411's 10 m table (GLSL, samples to 17 m and legend hash-pinned in `marineWavePalette.test.js`).
- **The palette:** `v2.h16`, one anchor at 16 m and the above-cap flag moved up to it; every anchor under 10 m unchanged. The
  legend's last tick reads `52+` ft / `16+` m. Light: deep violet (72,21,66) under a dark red flag (88,0,2). Beach: rose-plum
  (134,59,86) under a magenta-violet flag (146,1,115).
- **Engine, particle shaders: no line added** (LOC ratchet: the engine had 2 lines of room, the particle shaders 0). The four
  uniform calls join the lines that bind the same textures; the shader exports wrap their existing template lines.

## The palette extension (`wave-polish.mjs --extend 16`, judged by `wave-check.mjs` as `v2@16`)

Solved against the FIXED ramp: lightness falls along 10-16 m on the wash and as composited (every view and lighting), the hue
turns on, and the flag must be darker than the new cap AS DRAWN (#411's Schloss et al. rule, c40cbe67f). Three things the
search taught, each now a tool option:

1. Unbounded, light's 16 m anchor dived to L* 9 and left its flag 3.1 dE00 (`--ext-lmin`). Light's 10 m stop already sat at the
   solver's L* 22 floor, so the 16 m stop goes under it (L* 17; it composites to OKLCH L 0.44-0.51, not a hole).
2. Beach's first 16 m stop, a saturated red, left the violet flag only 7-9 dE00 once the flag had to be darker as drawn; a
   lighter red made it worse. Only a joint search (`--ext-joint`: the top anchors per L* x hue cell, each against step 2's own
   flag search) found a pair that clears the bar: the rose-plum stop, 7.9 dE00 off the brick, under a flag 10.8 off it. Its hue
   turns BACK toward 6.1 m's rose (darker by 0.09 OKLCH L): every forward hue (red, orange, maroon) and every blue flag (which
   draws lighter than the cap over beach's sky-blue water) failed. An owner-eye item.
3. A fixed pool of 240 flags (the first joint cut) missed the room the full search finds (0-3 dE00 against 15.7), so the joint
   mode runs the real search.

| | weakest neighbours (all models, world) | normal vision's weakest pair | 10 -> 16 m step | flag off the cap | flag as drawn |
|---|---|---|---|---|---|
| light v2 (the kill) | 7.2 (1.22-2.44 m, deutan) | 10.2 (3.66-6.1 m) | - | 22.6 at 10 m | darker |
| light v2@16 | 7.2 (the same pair) | **9.3 (10-16 m)** | 8.3 | 12.2 at 16 m | darker by 0.035 L |
| beach v2 (the kill) | 6.5 (0-0.61 m, tritan) | 7.2 (0-0.61 m) | - | 21.5 at 10 m | darker |
| beach v2@16 | 6.5 (the same pair) | 7.2 (the same) | 7.9 | 10.8 at 16 m | darker by 0.046 L |

No new RED line in either theme (the REDs are #411's known neighbour-target misses, same pairs, same values); land vs sea and
crests unchanged. Beach's legend arrow reads APCA |Lc| 14.8 on its black panel (v2's was 14.9; a watch line, as before), its
16 m stop 16. Beach's 16 m flag sits further off the bare water than its cap (+4.6 dE00), where v2's 10 m flag is nearer it
(-11.1, the watch line #411 left open).

## The A/B (offline; `evidence/wave-height-16m-ab-2026-10-20.json`)

One production build (`craco build` of this tree), served on 3120 over `serve_synthetic.py --dynamic 1 --vortex-peak 14` on
4120 (the eye peaks at 14.945 m: 8 cells of the 2-degree `global_mid` grid at or above 10 m, all under 16 m). `v2@10` is the kill
(dev today); `v2@10b` and `v2b` are each setting run again, the null controls. No request reached the live backend (the harness
answers `/api/weather/*` locally and stubs the rest). Owner page: https://claude.ai/artifact/YQMsfBLgjnm9h9kZ4UtHeU (private to
the owner): the eye side by side in each theme, the sheets at world/regional/coastal zoom, the moving clips, these numbers.

- **What the GPU was sent** (FNV-1a of the resident wave texture's bytes, hashed as uploaded, and the scale each upload carried):
  dark `7fbac580` (world/regional), `60428f4b` (coastal 13x11), `20a946df` (crest view) in EVERY run, scale 10/10 (resident/coarse
  base); light and beach under the kill: the same hashes as dark (dev's bytes); light and beach at 16 m: `d08c8dda` /
  `a2834731`, scale 16/16. No page errors in any run.
- **The eye.** Under the kill every cell at or above 10 m draws the flag, so the eye is a hard-edged block of 2-degree cells
  (red in light, violet in beach). At 16 m it deepens smoothly: indigo -> deep violet (light), brick -> rose-plum (beach), the
  flag kept for 16 m and above. At 65-77% wash alpha the 10-15 m deepening is gentle: the owner's eye decides whether quieter
  but truer beats loud but blocky.
- **Crests below 10 m are unchanged** (90 frames per run at regional zoom; a crest pixel is > 24 levels off the same run's
  crest-free frame; pixels where two runs of one setting disagree are left out). Crest coverage breathes with the wave sets
  (6.6-7.4% within ONE 7 s light burst), so the first 24-frame read (7.19% at 16 m against 6.88/6.88% at 10 m) was a phase
  artefact; over 90 frames: light 7.21/7.14% (10 m) vs 7.15/7.11% (16 m): settings 0.044 points apart, two runs of one
  setting up to 0.065; beach 3.95/3.97% vs 3.94/3.95%: 0.017 against 0.022. Crest colour below 10 m within 0.8 (light) / 1.4
  (beach) of 255 per channel across all four runs. Over the eye crests read ~1-2 points more at 16 m: the wash under them
  changed colour, the crests did not (every crest term saturates by 6 m; only the foam-noise offset and the period fallback
  `6 + 2h` for period-less cells still move with height).
- **Dark's pixels.** A first single-run comparison showed 5174 px off by > 4 levels at world zoom, all on coastlines, lakes and
  island specks. With two runs per setting the coast differences follow the RUN, not the setting: regional, two runs at 10 m
  458 px (max 61), the kill against 16 m 0 px (max 2); world 458 / 580 within settings against 52-674 across. The land mask's
  paint lands at different moments (#408's async paint); the texture bytes are identical.
- **Coastal zoom** committed different dynamic-lane grids in different runs (6x5 vs 13x11, timing), so the coastal row of the
  sheets is for the eye only; the byte and pixel claims use world and regional (one 181x83 grid in every run).
- The `drawn()` record in `scn_wave_palette_ab.js` read `_waveData.grid`, which the engine does not set (it is `waveGrid`), so
  #411's records carried null height ranges; fixed here (the A/B's numbers above use it).

## Checks

- Jest: `marineHeightEncoding.test.js` (the kill = #411's six shader strings and texture bytes by sha256; dark and rating
  grids byte-identical with 16 m on; light/beach repacked /16, decoded within one step; the scale by theme and palette; the
  uniform's values; `withHeightScale` throws on a shader without its decode; a wiring pin on the four engine call sites) and
  `marineWavePalette.test.js` (v2 at 16 m and under the kill; the kill = #411's GLSL, samples to 17 m and legend by sha256).
  The first cut joined `${...}` into the shader templates, which split HEATMAP_FS into a chunk with `f += 1.0` and no GLSL
  keyword, and `encodingDebris.guard.test.js` read it as mojibake; the wrapper keeps every template whole.
- Every frontend Jest suite, in a dot-free copy of this tree (CRA's Jest skips `.claude/`): 459/459 suites, 6091 tests.
- `node wave-check.mjs`: no new RED (above). `python scripts/loc_ratchet.py`: clean, the engine and the particle shaders not one
  line longer. `node scripts/check_eslint.js`: no rule over its baseline. `craco build`: compiled.
- Not run here: hosted CI (the authority); a live read (none owed before the owner's pick; never against the live box as a
  load test).

## Findings for later

- Node 24 and current Chrome have `Float16Array`, which `WebGLMarineFieldMath.FloatArrayConstructor` picks up: the encoder's
  heights are fp16 before they are packed (6.15 m -> 6.1484). Harmless at an 8-bit output; a test that predicts bytes must
  round the same way.
- Theme changes happen on the Settings/Theme pages, so the map remounts and re-uploads; a dark upload never meets the light
  table. If an in-map theme switch is ever added, the scale still travels with each upload, so the decode stays right; only
  the next upload restores the theme's own step.

## PR and ledger

- Draft PR #415 (`claude/wave-height-16m`, `d5278278f` on dev `26385e031`). Not merged: the owner's verdict on the A/B decides.
- Ledger 1543 (`pr_open`), 1544 (`commitment`: the owner's verdict by 2026-10-24, then merge or close; after a merge a static
  read of the deployed chunk).
- Re-cuts, per L-P34: the first cut stacked on #411's `639305fb8` was parked as the local branch `claude/wave-height-16m-parked`
  (never pushed) when #411 took the owner's pick (D-033: v2 = light A + beach B) and a re-solved beach flag; the second, on #411's
  `c40cbe67f`, moved onto dev when #411 merged (`f550d2502`, the same tree). Carried: the encoding, the tests (baselines re-hashed
  at `c40cbe67f`), the tools. Re-solved: the 16 m anchors and flags against v2 under #411's darker-as-drawn flag rule.

## 2026-10-20 ~15:40Z: the /16 byte is ROUNDED (a regression at calm water, found after #415 opened)

The lead's research note (relayed by session message: R16F as the clean answer; avoid non-linear 8-bit and RG8 packing with
hardware filtering) asked about precision. Priced as the wash draws it (`frontend/scripts/wind-color/wave-quant.mjs`, new: one
texel's quantized height against the exact one, every 1 mm from 0 to 10 m, world alpha), the FLOORED /16 byte as first pushed
was worse than dev at calm water, where the shader's depth-floor blend `smoothstep(0, 0.18, h)` is steep:

| per-texel colour error, light (beach) | worst texel dE00 | mean dE00 |
|---|---|---|
| u8 /10 floor (dev; dark and rating keep it) | 15.32 (12.07) | 0.216 (0.198) |
| u8 /16 floor (#415 as first pushed) | **23.51 (17.38)** | 0.347 (0.318) |
| u8 /16 ROUND (#415 now) | 11.63 (9.69) | 0.172 (0.157) |
| R16F | 0.01 (0.02) | 0.004 (0.004) |

The offline A/B could not see it: the synthetic store's calmest cell is 0.5 m (the error lives under ~0.2 m). The 16 m path now
rounds (`hScale > 10 ? Math.round : Math.floor`), so its worst texel and its mean are both under dev's; the /10 path keeps floor,
byte-identical. Rounding moves the above-cap edge half a texel early (texel 255 from 15.97 m: the GLSL threshold already sits
there). The non-linear and RG8 encodings the lead warned against were not used.

Not taken here: a float height texture (R16F; filterable in core WebGL2, uploaded from FLOAT) would make the error ~0. It means a
second texture and sampler in both heatmap passes (and the land-aware 4-tap fetch), a WebGL1 path, and LOC room the engine does
not have; and dev's own /10 floor is 15 dE00 at calm water in EVERY theme, dark included, so the precise texture is a change to
dark too: its own A/B. Proposed as a follow-up.

## Correction (15:29Z): the section above is headed "~15:40Z"; it was written and committed at 15:27:53Z (ea296d7a6). An estimate, not a clock reading (L-P10); ledger correction line below.

## The A/B again, on the rounded byte (15:45Z; `evidence/...json` `rounded_byte_rerun`)

The same harness on a rebuild of `ea296d7a6`: light and beach, four runs each (`v2@10`, `v2`, `v2@10b`, `v2b`), 90-frame crest
bursts, world/regional/coastal shots, clips. The numbers in "The A/B" above were taken on the floored byte (`d5278278f`); dark's
were not affected (its /10 path is untouched) and stand.

- Uploads: the 10 m path's bytes as before (`7fbac580`, `60428f4b`, `20a946df`); the rounded 16 m bytes `ab9df202` (world and
  regional), `fafafff6` (coastal 13x11), `6700b93d` (crest view), the same in both 16 m runs, scale 16/16. No page errors.
- Crests below 10 m: light 6.81/6.83% (10 m) against 6.77/6.78% (16 m): 0.05 points apart (0.7% relative) against 0.03 between
  two runs of one setting here (0.065 in the first experiment): at the instrument's noise floor. Beach 4.61/4.61% against
  4.66/4.55%: 0.002 apart against 0.11. Crest colour below 10 m within 1.4 of 255 (light) and within run-to-run noise (beach).
- Owner page republished (version 2) with these images and numbers and a precision table.

## 16:08Z: the antimeridian seam column rounds too (the lead's review of ea296d7a6)

The lead's review found one column the rounding missed: on a global grid the encoder averages the two edge columns' height bytes
(`avgH`, the antimeridian seam), and that average still floored, a half-byte low bias (up to 3.1 cm at /16) on one column. It
now rounds on the 16 m path and floors on the /10 path (byte-identical). Test: `marineHeightEncoding.test.js` checks the seam
column of an all-ocean global grid in light, beach (round) and dark (floor), with heights chosen so two rows have odd edge sums;
it fails with the floored seam put back (checked). The lead's other checks, recorded: every decoder is linear (`b * scale`, one
decode per shader), no shader treats byte 0 or 255 as a sentinel, `ratingScore` runs only with the /10 score texture bound, and
the GFS single-slice trace stats are unitless and only compared with each other. The red `verify` check the review named was
the "~15:40Z" header, already corrected (ledger 1545); `verify` passes on `f91a8fdd4`.

## 16:21Z: the owner's verdict: ship it

The owner, in this session at 16:17Z, on the A/B page and #415 at `78bd7a2b1`: "Owner verdict on #415: ship the 16 m encoding on by default. Record it in the log and ledger and mark the PR ready." Recorded as DECISIONS D-034; ledger
`decision` and `push` lines (the push fulfils 1544, the owner-verdict commitment) and a new commitment for the read-back after the
merge. #415 marked ready for review; NOT merged (merging is the owner's separate word). The float height texture (R16F) follow-up
is running in its own session (task started by the owner from the proposal card).
