# 2026-11-11 · Fable · layer animation lane (precipitation, radar, wind, pressure, marine)

Branch `claude/layer-animation-tune-7198ec` from dev `bdd5c4b30`. Draft PR only, nothing merged. Client only: no served number
moves, so no SCOREBOARD row. Owner's ask (2026-11-11, relayed by the director): fine-tune the animation of the precipitation,
radar, wind, pressure and marine layers so they are instant and look higher quality; "not a rewrite. More like fine tuning".
Air temperature, water temperature and satellite were left alone. The marine direction sign is the director's diagnosis
agent's (log `2026-11-11-claude-marine-motion-direction.md`); nothing here touches it.

## 1. Instruments (new, committed under `frontend/scripts/offline-backend/`)

- `scn_layer_anim.js`: one fresh browser per layer x viewport x theme over `serve_synthetic.py`, raster hosts through
  `raster-lab/rr.js` (recorded once, then `RR_MODE=replay`), optional static-frames CDN (`CDN_DIR`). It records the compositor's
  own frames (CDP screencast), rAF intervals, long tasks and Long Animation Frames (with script attribution) across: toggle,
  six 1-hour wheel steps 700 ms apart, a zoom, a pan. Phone = 390 x 844, dpr 3, CPU throttle 4x.
- `anim_frames.py`: frames + marks -> toggle to first visible change, blank frames, step settle, rAF p95, dropped frames,
  long-task ms per phase.
- `profile_scrub.cjs`: CDP CPU profile of the six scrub steps on the phone profile, self time by source file and function
  through the build's source maps.

No request reached our backend (host audit per run: onrender asks answered locally; only fonts and jsdelivr left the machine).
Open-Meteo S3 and RainViewer were read once to fill the replay cache (rain, radar, pressure; two viewports).

## 2. Baseline (dev `bdd5c4b30`, dark theme, ONE run per cell)

| layer | viewport | toggle first / full ms | blank frames | step settle p50 / max ms | rAF p95 scrub / zoom / pan ms | long-task ms toggle / scrub |
|---|---|---|---|---|---|---|
| pressure | desktop | 101 / 3321 | 0 | 626 / 1325 | 41 / 40 / 30 | 297 / 0 |
| pressure | phone | 4755 / 5523 | 39 | 1034 / 2762 | 136 / 78 / 64 | 1489 / 2594 |
| radar | desktop | 426 / 1261 | 0 | 109 / 555 | 47 / 46 / 41 | 1828 / 0 |
| radar | phone | 2159 / 7748 | 273 | 240 / 260 | 117 / 162 / 152 | 3750 / 1825 |
| rain | desktop | 357 / 3910 | 1 | 62 / 2242 | 37 / 43 / 37 | 311 / 270 |
| rain | phone | 586 / 702 | 0 | 900 / 2652 | 205 / 323 / 74 | 3964 / 5410 |
| waves | desktop | 4575 / 4575 | 0 | 169 / 596 | 57 / 58 / 55 | 985 / 107 |
| waves | phone | 372 / 4308 | 131 | 364 / 1887 | 228 / 170 / 155 | 3915 / 7299 |
| wind | desktop | 127 / 3111 | 3 | 0 / 477 | 50 / 51 / 56 | 0 / 0 |
| wind | phone | 3789 / 5774 | 4 | 0 / 191 | 101 / 114 / 132 | 3060 / 2421 |

**Read these with care.** (a) One run per cell, and the probe's run-to-run spread is large: six later phone runs of the SAME
build and flags gave wind scrub long-task 352 to 5,005 ms and waves toggle-first 3.0 to 9.9 s. The table ranks layers and
viewports; it cannot resolve a 10 % change. (b) The waves and wind rows had no static-frames CDN (the `/grid_series` path,
production's fallback), so their toggle times are an upper bound. (c) "toggle first" fires on the first visible change, which
on the phone can be the layer sheet or legend, not the field; "blank frames" during the toggle phase are mostly the wait before
the field, not a flash after it. No layer showed a blank flash during scrub, zoom or pan in these runs. (d) Headless Chrome
with the screencast on; the desktop rAF p95 of 37-57 ms is the harness, not a user's GPU.

What the table does say: on the phone profile every layer's scrub has seconds of long tasks, and the raster layers settle a
step in about a second.

## 3. Where the scrub's main-thread time goes (CPU profile, phone profile, six steps, throttled ms)

| layer | total | top costs in our reach | top costs outside it |
|---|---|---|---|
| wind (regional zoom) | 7,376 | `weatherTruthTracker` data hash 840 (string-formats every vector when a tag is BUILT; a series page builds up to 48 tags in one task); `formatInstant` 153; `getUniformLocation` 187 | React 683; MapLibre paint |
| waves | 7,436 | `formatInstant` 164; texture encode 193; `gl.isTexture` 105 | React 622 (85-135 ms per key, synchronous); MapLibre paint 410 |
| rain | 3,660 | `rasterDrawnFrame` date words 82; `formatInstant` 49 | **Open-Meteo tile library `requestTile` 916**: it posts the WHOLE decoded field to a worker for every tile (a structured clone per tile; no cross-origin isolation, so no shared memory) |
| radar | 7,973 | **`radarAdvection` warp 782 + `convertToBlob` 333** on the main thread (the nowcast frames preloaded beside "now") | MapLibre worker transfer 790 |

Pressure on the Open-Meteo path shares rain's cost (same library). Our own single-texture raster path (`ownRasterLayer.js`,
#481/#526) has no per-tile clone; it is built and DARK, waiting on the owner.

## 4. Ranked

1. Wind and marine: the truth tag hashes at build -> hash on first read. **Done here.**
2. Every layer: date words build a new `Intl.DateTimeFormat` per call -> cached. **Done here.**
3. Radar: advection warp and PNG encode on the main thread -> a worker, or cap the work per task and preload the nowcast
   frames at idle. Not done: it is more than a tuning change and needs its own A/B (proposal for the director).
4. Rain and pressure: the library's per-tile field clone. Not fixable as tuning. The fix is our own raster path (owner's call).
5. Waves and wind: 85-135 ms of synchronous React work per key, in Codex-reserved files (`MapPage.js`,
   `MapForecastOverlay.js`, `ForecastWheel.js`). Reported, not touched.
6. Look, optional: raster hours and radar frames are a hard cut (13-16 % of the layer's on-screen signal changes in one
   frame). A short cross-fade between two LOADED frames would smooth it; it reverses a measured choice of 2026-10-22, so it
   needs the owner's eye on a sample before any default. Not built.

## 5. What changed (PR: scrub stalls, part 1)

| Fix | Module | Kill switch |
|---|---|---|
| The truth tag's `dataHash` and `traceId` are getters that compute once on first read (same values, same key order); a series page that mints 48 tags hashes only the frames that are committed, compared or serialised | `weatherTruthTracker.js` (`attachLazyHash`) | `__RAW_DISABLE_TRUTH_TAG_LAZY_HASH__` |
| The status lines' date words come from three cached `Intl.DateTimeFormat` instances (the same words as `toLocaleString`) | `readoutDateFormat.js`, used by `drawnFrameReadout.js` and `rasterDrawnFrame.js` | `__RAW_DISABLE_READOUT_FORMAT_CACHE__` |

Nothing drawn changes: no shader, palette, particle, table or served number. Themes and layouts are untouched (no markup or
style changed), so light, dark and beach, desktop and mobile draw as before. No interactive element was touched.

**Measured (CPU profile, same scenario, throttled ms per six-step scrub):**

| | before | after |
|---|---|---|
| wind, a series page landing in the window: `weatherTruthTracker` | 906 | 67 |
| waves: date words | 164 (dev), 266 and 273 (kill arm, 2 runs) | under 1 (not in the profile, 2 runs) |
| wind: date words | 153 (dev), 57 and 82 (kill arm) | under 1 |
| rain: date words (`drawnFrameReadout` + `rasterDrawnFrame`) | 131 | not re-measured |

Limits, stated plainly: the wind hash row is n = 1 on each side, and the two kill-arm wind runs did not have a series page land
inside the window, so they are not a control for it; the unit test (48 tags minted, one read, one frame hashed) is the proof of
the mechanism. The end-to-end probe (3 paired rounds, kill vs on, one build) could NOT resolve the change: its spread within an
arm is larger than the effect (section 2a). A caller that changes vectors in place between the mint and the first read now gets
the hash of the changed vectors; the eager path froze it at mint. Only one site copies a tag (`windTierMosaic.js:126`, per
shown grid).

## 6. Tests and gates

- +2 suites / +12 tests: `truthTagLazyHash.test.js`, `readoutDateFormat.test.js`. Floor fragment
  `.github/ci-floors.d/claude-layer-animation-tune-7198ec.frontend.json` (frontend 8499 + 12 = 8511; suites 653 + 2).
- Both kills are in `killSwitch.inventory.test.js` (TESTED) and `windDarkRules.test.js` classifies the hash kill as "when, never
  what is drawn". `windStaticFrames.test.js`: one assertion now reads the tag's hash before the array's cached key.
- Local: whole frontend Jest tree 655 of 656 suites pass. The one failure, `netlifyIconStoredTailScope.test.js`, is a 5 s
  `spawnSync` of Git Bash timing out on this Windows machine (it touches none of these files). Hosted CI is the authority.
  Jest matches no test under a `.claude` worktree path on Windows (its glob loses the separator before the dot folder); run
  with `--testMatch "**/src/**/*.test.js"`.
- `check_eslint.js`: no rule over its baseline. `wind-color/check.mjs`: 0 red lines (colour-blind arm skipped: no venv; no
  palette or shader changed). `npm run build`: ok (run as `craco build` with `NODE_OPTIONS` set in the shell; the npm script's
  inline env form does not run under cmd).

## 7. Tools consulted

- **Reflection (Beam)**, on the ranked plan (claims and numbers only): agreed with the order, formatter cache first; warned that
  a lazy hash only helps if nothing reads all tags up front (checked: one spread site) and that getters must be memoised and
  survive spread / JSON (tested); for a cross-fade, complementary opacity on loaded frames, 120-150 ms for hourly frames,
  80-100 ms or none for 10-minute radar, off under reduced motion; suggested lowering the radar motion-field resolution
  before moving the warp to a worker.
- **Not used**, and why: Context7, the hyperframes / mapbox skills, three.js and the science MCPs (no MapLibre, GLSL or
  flow-visualisation question arose: the two fixes are plain JavaScript); SubQ and LongCat (the diff is small; LongCat needs a
  per-payload approval); Logfire (needs authorisation, not connected in this session).

## 8. For the director

- Needs a reserved file: the per-key React re-render (item 5).
- Needs the owner: our own raster path for pressure (item 4); a cross-fade sample (item 6).
- Proposal: radar advection off the main thread (item 3), as its own PR with an A/B.
- Not done from the brief: an after-table per layer (the probe cannot resolve these fixes), light and beach samples (nothing
  drawn changed), the combined local preview.
- memory_audit at start: 0 FAIL, 120 WARN (other sessions' overdue live read-backs; none is this lane's).
