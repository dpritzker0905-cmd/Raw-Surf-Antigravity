# 2026-10-20: the wave-height wash reads an R16F float height (light, beach, dark)

Session opened 2026-10-20 ~15:57Z (the hook's 11:57 EDT), started by the lead session as the follow-up #415's log proposed ("a float
height texture... its own A/B"). Branch `claude/wave-height-float`; first cut on #415's head `f91a8fdd4`, moved onto dev `da40c3c5b`
when #415 (squash `9c6d5ebb0`) and #417 (D-035: beach locked to v1) merged during the session. Client only. **No served number
changes** (no SCOREBOARD row): heights, ratings, glyphs and the hub are untouched; what changes is how precisely the wash knows the
height it colours. Draft PR #420; the owner's eye on the A/B decides.

## Why

The main wave texture packs height into its B byte: `/10` floored (dark; beach since D-035; light under the 16 m kill) or `/16`
rounded (light, #415). At calm water the wash's depth-floor blend `smoothstep(0, 0.18, h)` is steep, so one step moves the colour a
lot. Priced per texel as the wash draws it (`frontend/scripts/wind-color/wave-quant.mjs`, extended here: dark on the shader's own
ramp over the style's sea (93, 117, 126) and the fallback's (11, 29, 46); beach on v1 as D-035 draws it; beach v2@16 as its kill does):

| worst texel / mean, dE00 | byte (dev) | R16F (this PR) |
|---|---|---|
| light, v2 at 16 m (/16 round) | 11.63 / 0.172 | 0.01 / 0.004 |
| beach, v1 at 10 m (/10 floor) | 4.20 / 0.300 | 0.05 / 0.009 |
| beach, v2@16 (D-035's kill) | 9.69 / 0.157 | 0.02 / 0.004 |
| dark, shader ramp (/10 floor) | 6.93-7.01 / 0.387-0.390 | 0.10 / 0.011 |

**Correction to the brief:** it said dev's /10 floor costs 15.3 dE00 "in every theme including dark". 15.3 is light's (v2 under the
16 m kill). By this model dark's worst texel is 7.0: its calm floor (deep navy) sits closer to its ramp's calm colour. The model
assumes deep ocean; near a shelf dark's floor is brighter (shelf glow), so a drawn step can be larger (the A/B read 12.5 at one dark
regional pixel in the first run).

## What changed

- **`marineHeightFloat.js` (new).** `packHeightFloat` writes `min(max(h, 0), scale)` per cell (NaN -> 0, as the byte) with the same
  global seam average: the same quantity and RANGE as the byte (dark stops at 10 m, light at 16), so precision is the only variable.
  `encodeHeightFloat` (called by the encoder at its return, after the upload transaction, so a rollback never involves it) uploads it
  `R16F` from `RED`/`FLOAT`: the engine's resident texture is re-uploaded in place while its dims hold, recreated on new dims, freed
  when a commit needs none (rating grid, kill, no WebGL2); a standalone coarse base gets its own, freed in `_freeCoarseBase`; dispose
  frees the resident (`WebGLMarineEngineInit.js`). A failed upload deletes the texture it created and falls back to the byte. The
  pack buffer is held on the engine (the encoder's scratch-buffer pattern: no 4 MB per scrub commit on a 1440 x 721 grid).
  `noteTextureCreated` takes bytes per texel, so the GPU estimate counts R16F as 2 and gives back exactly that (`WebGLWindUtils.js`).
- **HEATMAP_FS = `withHeightFloat(withHeightScale(...))`.** The plain fetch and the four taps of `sampleWaveLandAware` go through
  `waveTapF`, which swaps B for the float height when one is bound (so the land-aware weights apply to metres); the decode becomes
  `u_heightFloat > 0.5 ? waveData.b : <the byte decode>`. The sampler is `mediump`: a fragment shader's samplers default to lowp
  (range +-2, step 1/256), which would undo the point on phone GPUs. `withHeightFloat` throws at module load unless the shader has
  exactly five wave fetches, all inside the land-aware sampler, and one decode.
- **Binding:** `bindHeightFloat` at the heatmap's two draws, joined to the lines that bind the wave texture (unit 6, inside the 0-6
  range `captureWebGLState` saves and restores; draw's ring-fill rebinds 6 before it draws). `null` when the score texture is bound.
- **Unchanged by design:** crests (advect/draw decode the byte; the RGBA8 bytes are identical with the lever on and off), the
  surf-quality score texture (rating grids get no float texture), palettes, legends. WebGL1 falls back to the byte.
- **LOC:** the engine and the particle shaders not one line longer; the encoder 798 -> 799.
- **Kill:** `window.__RAW_DISABLE_WAVE_HEIGHT_FLOAT__ = true` before load: no texture, no uniform, HEATMAP_FS and the texture bytes
  exactly dev's (`da40c3c5b`; sha256-pinned in `marineHeightFloat.test.js`). Independent of the 16 m kill.

## The A/B (offline; `evidence/wave-height-float-ab-2026-10-20.json`)

Production build of this branch (`608f391f0`) on 3141 over `serve_synthetic.py --dynamic 1 --vortex-peak 14 --calm-patch 27,-111,8`
on 4141. `--calm-patch` is new: the store's calmest cell was 0.5 m and the effect lives under 0.2 m, so a bowl in the Gulf of
California (height x min(1, (r/8 deg)^2), floor 0.01 m) gives 0.01-0.24 m within ~2 deg of its centre, along coasts too (the
land-aware fetch). A `calm` view (z7) joins world/regional/coastal. Four runs per theme: `v2@u8` (the float kill) and `v2` (float),
each twice (the null controls). `WASH=1` crest-free shots; `wave_float_stats.py` compares only runs that held the same grid (which
grid a view commits is timing-dependent), over the wash interior (not land in any run, 3 px clear). No request reached the live
backend. Owner page: https://claude.ai/artifact/424rWB7zJkgtpBesPPu1Pr (private to the owner; sheets from `compose_float_ab.py`).

| wash interior, byte vs float | calm bowl (29x24) | world (181x83) | coastal 13x11 (all >= 2 m) | null controls |
|---|---|---|---|---|
| light | 197,858 px moved, mean 6.24, max 8.27 | 20,888 px, mean 0.51, max 8.85 | 0 px | 0 px |
| beach (v1) | 189,069 px, mean 1.35, max 2.19 | 74,482 px, mean 1.59, max 3.85 | 0 px | 0 px byte; <= 751 px float (coast mask timing) |
| dark | 227,067 px, mean 2.77, max 4.48 | 127,474 px, mean 1.35, max 4.14 | 0 px | 0 px |

- **It is the byte's bias, not noise.** The bowl's 2-degree nodes hold ~0.04 m; light's rounded byte reads 0.063 m, which doubles the
  wave colour's share of the blend (`smoothstep` 0.13 -> 0.28): its calm gulf draws greener than the float's blue-grey. Dark's floor
  reads nodes low (0.19 m -> 0.157 m), so its gulf sinks toward the navy floor. Both levers' two runs agree on the gulf's colour
  whatever coastline the mask painted, so the colour is the encoding and the coastline is the mask's timing.
- **What the GPU was sent:** the RGBA8 wave texture hashes the same in byte and float runs of every view (light `451fbb14` world,
  dark/beach `cf678ebd`; beach now /10 like dark, #417); float textures `6b0265c` (light world), `4efca24d` (dark/beach world),
  identical across runs. `baseHeightFloat` true in float runs (the coarse base has its own). No page errors; `gl.getError()` 0 in
  all 48 shots.
- **Cost:** R16F uploads 0.1-0.3 ms median in the page (max 1.9, a first allocation); `setWaveData` medians 37-58 ms with no
  float-vs-byte pattern (run-to-run spread is larger).
- **The pack-buffer change came after the A/B** (`372c55e99`): an identity smoke on its build uploaded the same float bytes where the
  grid matched (`6b0265c`, `4efca24d`); its calm views committed other grids (their wave hashes differ too), so they compare nothing.
- **First run superseded:** on `f91a8fdd4` + this change (before #417), light and dark read the same numbers (light calm 197,706 px,
  mean 6.24; dark 227,067, 2.77); beach on v2@16 read mean 3.72 over the bowl.
- **Limits:** synthetic data; the harness drew the FALLBACK basemap in every theme today ("Detailed map unavailable"; water read
  (207, 227, 242) light, (159, 216, 230) beach, (11, 29, 46) dark), unlike #415's runs, which read the real styles: absolute
  colours sit over that ground. The land mask's async paint (#408) moves coastlines run to run; the interior mask leaves it out.

## Checks

- Jest: `marineHeightFloat.test.js` (22: the kill = dev's HEATMAP_FS by sha256 and dev's wave/score bytes per theme with no float
  texture made; the other five shader strings identical with the lever on and off; float values = the encoder's fp16 heights clamped
  to the byte's scale, within one byte step of the byte; rating grids, WebGL1 and a failed upload fall back (the failed texture is
  deleted); seam average; resident in place / recreate / free; standalone ownership; the pack buffer reused; GPU estimate 2 B/texel;
  the GLSL differs from dev only by the declaration, the five taps and the decode; throws on a moved shader; binding; wiring pins).
  #415's `marineHeightEncoding.test.js` takes the float kill where it pins #411's strings; `marineLandAwareFetch.test.js` counts the
  fetches in either form. A mutant that ignores the kill turns 5 tests red.
- Whole frontend Jest from a dot-free copy: 456/460 suites, 6095/6099 tests. The four: `encodingDebris.fixes`, `windBenchLadder` and
  `OceanMask.coastBuffer` read repo-root files the copy lacks and pass once those files are present; `netlifyIconStoredTailScope`
  spawns Git Bash with a 5 s budget and Git Bash took 3.7-4.7 s to start on this machine (it tests `netlify.toml`, untouched here).
- `node scripts/check_eslint.js`: no rule over its baseline. `python scripts/loc_ratchet.py`: clean. `craco build`: compiled.
- Not run here: hosted CI (the authority; pending at the PR's open); a live read (none owed before the owner's pick).

## Findings for later

- The offline harness drew the fallback basemap in all three themes today, where #415's runs (same day, earlier) read the real
  Mapbox styles. Not investigated; any palette A/B taken with it today sits over the fallback ground.
- Beach's float runs disagreed with each other in up to 751 interior px near coasts (mask timing); the byte runs did not. Seen in
  one theme only, both runs; worth a look only if it recurs.
- `serve_synthetic.py --calm-patch` makes calm water testable for any wash or crest change (the store had none under 0.5 m).

## PR and ledger

- Draft PR #420 (`claude/wave-height-float` on dev `da40c3c5b`). Not merged: the owner's verdict decides.
- Ledger 1552 (`pr_open`), 1553 (`commitment`: the owner's verdict by 2026-10-27, then merge or close; after a merge a static read of
  the deployed chunk). Appended after dev's head 1551; #418 also claims 1552, so whichever merges second re-chains (LESSONS).

## 2026-10-20 21:04Z: ledger re-chained after #418 (the lines above are renumbered, not rewritten)

#418 merged at 20:49:47Z (`f6b80f724`) with its own seq 1552 (`pr_merge #415`). As agreed with the lead session, #420 merges
second and re-chains: dev's `ACTIONS.jsonl` taken byte for byte, this branch's two lines re-appended field for field through
`action_ledger.py append` with `--acted-at` their original times: **`pr_open` #420 is now seq 1553, the owner-verdict
commitment seq 1554** (the "1552 / 1553" above). STATE's ledger head moved to 1554; `action_ledger.py verify` OK. The app's
`sync_with_base_branch` failed again with "Committer identity unknown", so the merge of `origin/dev` was done in the checkout.

## 2026-10-21 ~02:45Z: the float is LIGHT ONLY by default; #421 and #424 merged in; ledger 1558-1559

- **Owner, 2026-10-21 ~01:30Z**, picking from the colour research page (https://claude.ai/artifact/KSm5QY1qj2yjhtb5b6ozjR): "I like
  the proposed light mode", and on the follow-up question: dark "Today's dark (left)", beach "Today's beach v1 (left)". The lead
  session relayed the owner's earlier "Leave dark alone if dark is okay. I liked dark." and asked that dark not change as a side
  effect of #420.
- So `encodeHeightFloat` builds the float for the LIGHT wash only. Beach and dark (and an unset theme, `'default'`, which draws
  dark) get no float texture unless `window.__RAW_WAVE_HEIGHT_FLOAT_BEACH__` / `__RAW_WAVE_HEIGHT_FLOAT_DARK__` is set before load;
  with no texture bound, `u_heightFloat` is 0 and every fetch and the decode take the byte's own path. The A/B's beach and dark
  rows above describe what those opt-ins draw. Tests: `heightFloatTheme`, and beach/dark/`'default'`/unset make no R16F upload.
- Merged dev twice (#421 light crest V2 at `5fe62b5f2`, then #424 at `448deb35c`, which landed mid-merge: another session's fetch
  moved the shared `origin/dev`). Conflicts kept both sides (harness levers, wind-color README paragraphs; #415's test now sets both
  the float and light-crest kills). HEATMAP_FS is unchanged by #421 (the hash pin passes). Ledger re-chained again: `pr_open` #420
  is **1558**, the owner-verdict commitment **1559** (the 1553/1554 above).
