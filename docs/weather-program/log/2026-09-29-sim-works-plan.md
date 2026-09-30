# 2026-09-29 · "Make the weather sim work": second audit + plan of action (session log)

Session opened 2026-09-29 22:38Z (UTC, from `date -u`) in worktree `raw-surf-wt`, branch `claude/sim-works-plan`,
stacked on #180 (the other session's handoff). One writer: this session. Owner's brief (chat, 2026-09-29): "Lets move
forward on the fixes. I want you to read the audit and also do your own audit again first, to make sure we're on
track. Follow the brain rules. Study all of our memory. Use forensics and Jacobian lens. We need to make the weather
sim feature of the raw surf app work finally. Its been to long. I want to see a plan of action and tasks we need to
take, plus check the tasks off. Accountability."

Read first: `log/2026-09-29-audit-sim-forensic-jacobian.md` (the audit this re-checks), `HANDOFF-2026-09-29.md` (#180).

## 1. What "the weather sim works" has to mean

Four things share the name (audit §1): ingest, serve, the map render, and the agent-facing sim MCP. Users meet only
the map (heatmap, crests, wind, scrubber, infobox) and the numbers on glyphs and the spot hub. So "works" = a user on
the PRODUCTION site sees the program's forecast, correctly, quickly, on every device, and keeps seeing it through a
deploy. By that bar the sim does not work yet, and the reason is not physics (section 2, finding F1).

## 2. Second audit: forensics (each claim re-checked live, 22:38-22:52Z)

| # | Finding | Evidence |
|---|---|---|
| F1 | **Production map users get none of the program.** `rawsurf.netlify.app` serves `fc140024` (deploy locked) = `3bd38a83` (2026-05-20) + one security commit: **3,283 commits behind `dev`**. Its map fetches weather from `/api/weather-proxy`, a Netlify function that proxies **Open-Meteo directly**; no `/api/weather/grid`, `/grid_series` or `/point` string appears in its 92 JS chunks (control needle `onrender.com` present in 9). The backend reaches production only through `/surf-conditions`, `/conditions/batch`, `/explore/*` (D-002). The 2026-08-05 handoff already ranked the unfreeze #1 "in Jacobian order". | Netlify deploy `6ab6b4f1…` (commit_ref fc140024, locked); `git merge-base --is-ancestor 3bd38a83 fc140024` true; `git rev-list --count 3bd38a83..origin/dev` = 3283; chunk scan via asset-manifest.json; `OPTIONS/POST https://rawsurf.netlify.app/api/weather-proxy` = 204/400 "Missing body" |
| F2 | The dev map sim works end to end from a clean local build against the live backend: Waves on → real `gfs_marine_waves_florida_east_coast_20260930T000000Z` (13x13, 0.25 deg, `ncep_gfswave025`, max 0.63 m) on the GPU with provenance intact. | localhost:3000 `/map`, `__MARINE_ENGINE__._waveData.truthTag` at 22:43:55Z |
| F3 | **Every deploy cold-starts the backend that production also uses.** 8 `dev` deploys on 09-29. After `f4590a3d` went live (21:42Z) CPU hit 1.0 at 21:48Z; E2E "clicking a spot opens its spot hub" timed out 3x on Desktop Chrome 21:47-21:49Z (run 36634686190, the only red E2E of the last 6 completed). The spot hub is a PRODUCTION surface. | Render metrics instance fm47w; E2E log |
| F4 | `TRUTH_VIOLATION_MARINE_EMPTY_RENDER` ("waves active but no vector data") is reported on **every build today** (13 builds from e4c27fd7 to 1e02df3f) and by this session's own local build at 22:43:53Z, **2 s before** its grid arrived (22:43:55Z). The detector fires during normal loading, so the channel cannot show a real empty render. | Render error log 10:45-22:45Z |
| F5 | `[grid_series] stored-coverage lookup failed` is a **0.5 s timeout** on `store.get_manifest()` (`series_source_policy.py:45`), which re-parses 13.5k manifest entries whenever the file's mtime moves. ~13 failures in 12 h, clustered after boots, against >100 successes in the last hour alone. ⚠️ Corrected in-session: first read as "the stored path is skipped"; it works ~98% of the time. | Render traceback 22:43:13Z; `store.py:547` |
| F6 | Supabase Storage returned HTTP 429 on 14% of requests in the 21Z hour (2,378 / 16,833). Ingest uploads retry (#77); **452 backend reads** (supabase-py GETs, 8.8%) were also refused, 21:00-22:50Z. Browsers saw ~0. | Supabase edge_logs query |
| F7 | Render has **no health-check path**. ⚠️ Corrected in-session: this is NOT the cold-box cause; the lazy L2 restore finishes 3 s after startup and warm-on-boot loads 120 products in 13 s; the saturation is traffic-driven lazy loads. A path still buys crash protection (Render keeps the old instance if a new one never passes). | Render service config `healthCheckPath: ""`; boot log 22:15:33-22:15:49Z; Render docs (health checks, 15 min) |
| F8 | The sim's tide blind spot touches **18 spots, not 38**: 38 carry `best_tide` text but "All tides" (17) and "Incoming" (3) parse to no band. At the wrong water level the served score is x0.57 ("Mid tide", 9 spots) to x0.5 ("Low", "Low to mid", 9 spots), so the sim can read up to **2x** the served quality there. Analytic from `tide_fit` (`surf_rating.py:527`, slope -1.3/unit, floor 0.5). | `select best_tide, count(*) from surf_spots …` (read-only) |
| F9 | The audit's "3bd38a83 vs fc140024 conflict" is not one: fc140024 is 3bd38a83 plus the Emergent purge, on `prod-frozen-3bd38a83`. Both memory notes are true. | git ancestry |
| F10 | Ledger CI was red on `19e6597f` (#178's merge) for 11 min: #176 had no `pr_merge` line until #179 carried it. Merge-order effect; `cdd5cc7c` green. | run 36639598778 |
| F11 | Commitment seq 77 holds: pilots run 36626628299 (`bdef3be2`) success, 0 `No module named`, GFS/ICON/EURO pilots saved 3,415/714/238 products. (#180 records it as seq 92.) | `gh run view --log` |
| F12 | Not weather, for the owner: every boot logs `CRITICAL [STRIPE] LIVE key detected! Refusing to use it`. | Render log, each instance |

Live at 22:41Z: Render `cdd5cc7c`, healthy, 9/9 data lanes ok, 0 alerts, RSS 401 MB at 84 s uptime.

## 3. Jacobian (what moves the outcome most per unit of work)

- **Reach dominates.** d(user-visible sim)/d(anything on dev) = 0 for production map users until the frontend ships
  (F1). Every physics gain of the last four months is multiplied by that zero.
- **Availability next.** The backend is shared, so each code merge costs production users a cold window on the
  spot hub (F3). 8 merges/day = 8 windows.
- **Rating error lives in direction and wind, not height** (audit §2.4: +-15 deg swell direction ~10 pts,
  +-3 kt wind ~7 pts, +-0.3 m height ~0 median). No SCOREBOARD instrument measures them yet.
- **The served lanes run the observation gate** (`RATING_OBS_GATE=1`) and local size references
  (`RATING_LOCAL_SIZE=1`); the audit's sweep ran with both off (its §8). On an unconfirmed hour the DISPLAYED
  quality is capped at 69.9, so the audit's "1-4 m all 86.0 epic" plateau displays as 69.9 fair_good there:
  the displayed Jacobian above 69.9 is zero until two models agree. Re-sweep with served flags before quoting
  displayed-quality sensitivities (task W-45).

## 4. Plan of action (checked off as done; each done item cites its evidence)

### Phase 0 · The record is true
- [x] W-00 Session start: `memory_audit.py` 0 FAIL / 2 WARN / 3 NOTE; ledger verify 87 OK; commitments 77 (overdue), 78, 79, 86.
- [x] W-01 Second audit, live (section 2).
- [x] W-02 Commitment seq 77 verified (F11; recorded by #180 seq 92).
- [x] W-03 This log + ledger lines (findings, corrections to the audit) in a docs PR stacked on #180: #181, ledger
  seq 97-101, `action_ledger.py verify` 101 OK, `memory_audit.py --docs-only` 0 FAIL / 0 WARN. Merge is the owner's.

### Phase 1 · Ship the sim to production (the Jacobian leader)
- [ ] W-10 **Release-readiness report** for the owner's D-002 decision, measured on a PRODUCTION build of `dev`:
  R1 E2E: name the 9 skipped tests; 3 consecutive green `dev` merges. R2 FPS with waves+wind on, desktop and mobile
  emulation (BRAIN_RULES section 12 floor: 30). R3 0 uncaught console errors on the journey map -> layers -> scrub
  14 d -> spot -> hub. R4 light/dark/beach x desktop/mobile screenshots of the map controls (CLAUDE.md). R5 axe on
  the map page. R6 capacity: production map traffic moves from the Netlify Open-Meteo proxy onto the 1-CPU Render box
  (D-005): count production proxy invocations and price them in Render CPU/memory. R7 rollback: Netlify "publish
  previous deploy".
  Measured 22:58-23:03Z on a production build of `dev` (`cdd5cc7c` + docs), served on localhost against the live
  backend, fixture user from `e2e/weather-simulation.spec.js` (section 5 has the numbers):
  - [x] R2 desktop 1280x800: Waves on 35.4 FPS (59.9 with no layer), worst frame 229-242 ms, 395 dropped frames.
    Passes the floor of 30, narrowly, with visible hitches. One machine, n = 1.
  - [x] R2 mobile emulation 375x812: Waves on 54.7 FPS, worst frame 137 ms. This PC's GPU, so a layout check only.
  - [x] R3 desktop journey: map -> Waves (first grid 3.7 s) -> +1 d (new frame in 668 ms, readout "Wed 8 PM" =
    00Z correct in EDT) -> spot drawer (1.8 s). 0 weather errors in the console; the 404 / WebSocket errors are the
    fixture user absent from the backend, and one ChunkLoadError was my test server truncating a transfer
    (130,560 of 149,400 bytes, reproduced by curl).
  - [x] R1 E2E: the 9 skips are Mobile Safari + Firefox continuity (by design / no WebGL on the runner), Firefox
    model switch (no WebGL), and **"the marine field is non-blank, and scrubbing +1 day CHANGES the rendered pixels"
    = `test.fixme` on all four browsers: it has never run**. See W-12.
  - [ ] R4 three themes x desktop/mobile screenshots; R5 axe; R6 capacity; R7 rollback note.
- [ ] W-12 Finish the pixel-truth test: its own finish line is "un-fixme once the latch wait passes 3 consecutive
  local headed runs" (`weather-simulation.spec.js:563`). Needs Playwright browsers on this machine (none installed).
  **2026-09-29 23:08-23:36Z, first real runs** (owner: "install Playwright"; the tool sandbox refuses to execute the
  unsigned Playwright Chromium, "side-by-side configuration is incorrect", so the runs used signed system Chrome 154
  via `channel: 'chrome'` with a fresh profile, against a production build of `dev` + the live backend):
  - run 1 FAILED "sea moved on 76% of cells but only 2.60% of pixels changed": the clip graded land and the
    Diagnostics HUD (the app now boots on the Space Coast, the test assumed open Atlantic). Fixed: the test sets its
    own camera and shoots the canvas only.
  - over open ocean (30N 66W z7) the gate never opened: the projection diag is written only by `/grid`, never by the
    `grid_series` lane (W-36). Fixed: the gate reads the engine's committed truthTag. The 2-deg wash there is
    near-uniform (varianceFraction 0.0008), so the camera moved into the 0.25-deg Florida tile (28.4N 80.4W z9).
  - crest LIFECYCLE is not frozen by `__RAW_WAVE_SPEED__ = 0`: same-hour noise 19-29% of pixels; with
    `__RAW_PART_TARGET__ = 1` (the engine's 2% density floor) 3-6%. The engine state was identical across frames
    (product, hour 0, heatmap opacity 0.76, mult 1, coarseFade 1): no clear-and-recommit, no opacity flicker.
  - **still open, why it stays fixme:** with crests at the floor, the +24 h step changed 2-5% of pixels, equal to
    the noise, while the grid mean rose 0.279 -> 0.384 m and half the cells moved > 0.25 m (max 0.68 m). Either
    the 0-20+ ft ramp cannot show a 1-2 ft day-to-day change on a calm sea, or the picture does not follow the
    data. Next measurement: the colour the ramp PREDICTS per cell vs the pixel read back.
  - ⚠️ correction: "the right ~37% of the sea is blank at +24 h" (said in chat at ~23:33Z) was React Scan's overlay
    (`#react-scan-root`, attached outside `<body>`, loaded on localhost only) in the forensic script, which, unlike
    the spec, did not mock unpkg. The spec's runs were clean of it.
  Test-only PR: the improvements above, `test.fixme` kept with the measured blocker in its comment.
- [x] W-37 (2026-09-30 00:47-00:59Z) **Does the picture follow the data? Yes, on the evidence available; the oracle
  was measuring wrong three ways.** Two dense traces (every 250 ms for 60 s after a +1 d scrub, production build):
  every committed frame carried the target valid time (2026-10-01T00Z). An earlier single probe that saw the
  engine back on the hour-0 world product did not reproduce (n = 1, recorded, not claimed). Predicted vs painted
  colour, 11 offshore cells matched by position, crests at the floor: painted green tracked the colour the app's
  ramp predicts (r = 0.77, slope 0.45 ~ the 0.76 heatmap opacity) in the clean run; the day's offshore change was
  only 0.055 m (0.555 -> 0.609 m), ~10 green units, inside the noise, which is why the scrub looked unchanged.
  ⚠️ Correction to W-12's note: "0.279 -> 0.384 m, half the cells > 0.25 m" was over the whole 17x17 tile
  (near-shore cells included) and an earlier cycle, not the clipped sea. The oracle's three defects, fixed
  (test-only PR): (1) its commit latch keyed on `hourOffset`, which counts from a floating series base_time (the
  correct frame read 23, so the latch never closed: very likely the fixme's original "the +24h commit is not
  reliably observed"); (2) it compared the two hours BY INDEX across different lattices (17x17 tile vs a
  viewport series frame); (3) "the sea moved" used a 0.039 m quantum, not the colour `getThemedWaveColorJS` (the
  app's JS mirror of the shader ramp) predicts. Three runs after the fix: all REFUSED honestly (two: same-hour
  noise 37-38%, a commit landing between the control shots; one: 2 matched cells, a coarser +24 h frame). It
  stays fixme; the refusals point at W-38.
- [x] W-38 **Resolved 2026-09-30 01:05-01:16Z: no app defect; my trace was confounded.** Five HEADLESS runs with
  every MapLibre input handler disabled: after a +1 d scrub, exactly ONE commit per run (0.64-0.95 s, the target
  valid time, camera still); after activation, the designed coarse-then-sharp sequence (world 2-deg preview at
  ~4.2 s, then the 0.25-deg regional tile by ~6.5 s; 4 of 5 runs; one went straight to the regional tile).
  ⚠️ **Correction:** the "6 commits in 45 s" and the zoom changes below came from stray mouse-wheel input on the
  visible (headed) test window: a headed batch run at the same time recorded zoom 9 -> 8.21 -> 9.29 -> 10.07
  while the script pressed only PageUp. The W-37 oracle's refusals are NOT that: with input disabled (and with a
  3 s settle wait) they persisted (same-hour noise 38-39%, 2 matched cells); both experiments were reverted
  unproven. The oracle's remaining blocker needs a per-shot diagnosis. Original note: **Commit thrash after
  activation / a scrub.** Trace run 1 (00:4xZ): 6 commits in 45 s after one +1 d
  step, alternating a series frame (11 cols), the 0.25-deg regional tile (17), a coarser series frame (7), the
  2-deg world product (8), and back; two from the `moveend` lane while the requested bbox grew 2.5 -> 7.6 deg
  (the camera zoom was not recorded in that run; the re-run with zoom recorded showed one commit and a still
  camera). The W-37 refusals (a commit between two shots 1.2 s apart) are the same symptom. A user sees the map
  change sharpness several times after a scrub. Measure it properly (N runs, camera recorded) before any fix.
- [x] W-36 (fix built 2026-09-30; merged as #184) **Mechanism measured live:** over open ocean (30N 66W z7) the engine drew
  `gfs_marine_waves_global_mid` (the /grid world product) while the main diag stayed "Initial state" and the
  PREWARM diag held the drawn product: F-11 (`updateProjectionDiag`) filed EVERY world-bbox write under the prewarm
  key whenever the view was < 60 deg wide, which is right only while a regional field is drawn. Fix: redirect only
  when the main diag still describes an ACTIVE field of the same model/layer whose served extent
  (`responseGridBounds`, else its requested viewport; never the PILOT_COVERAGE fallback) covers the view by the
  commit arbiter's own rule (`coverageFrac` >= `ARBITER_MIN_COVER_DEFAULT` 0.6, now exported from
  `marineCommitArbiter.js`, arbiter behaviour unchanged: its 3,000-fixture differential suite passes). **Live after
  (production build):** open ocean: main diag = the drawn global_mid, the legend now shows "~223 km grid (2°)"
  (before: nothing); Florida (null control): main diag = the 0.25-deg regional tile, the world product in the
  prewarm key, legend silent (F-11 preserved). 7 tests; mutations 6/7 caught, the survivor (arbiter threshold
  0.6 -> 0.5) is equivalent by design: the diag follows the arbiter's constant, and the arbiter's own suite does
  not pin 0.6 (pre-existing gap). Earlier note:
  The marine projection diag (`updateProjectionDiag`, `backendWeatherServiceClientDiag.js:119`) is written
  by the `/grid` path only; over open ocean the field arrives through `grid_series` and the diag stays at "Initial
  state" with the last region's coverage. Readers: the legend's "~N km grid" notice (`legendTicks.js:99`) and the
  infobox product match (`backendWeatherServiceClientPoint.js:352`). Measured 23:14Z, production build.
- [ ] W-11 **Owner:** unfreeze decision with W-10 attached.

### Phase 2 · The shared backend survives a deploy
- [ ] W-20 Measure each 09-29 deploy's cold window (CPU at 1.0 duration; hub, batch and series latency from request logs).
- [ ] W-21 Warm what the spot hub needs before it is asked (F3), sized by W-20.
- [ ] W-22 Coverage check reads the cached manifest instead of a 0.5 s-budgeted re-parse (F5).
- [ ] W-23 Name the backend readers refused by Supabase 429 (F6); each retries or refuses, never silently falls back (L-F1).
- [ ] W-24 **Owner:** Render health-check path (crash protection only, F7).
- [ ] W-25 Process: batch CODE merges (docs-only merges do not redeploy: Render's build filter ignores `docs/**`, `**/*.md`).
- [ ] W-26 **Owner (Render setting):** add `frontend/**` to the service's build-filter ignored paths. Measured 2026-09-30:
  #182 (an e2e test + docs) and #183 (frontend + docs) each redeployed the backend (Render deploys 00:04:17Z and
  00:26:49Z), i.e. two cold starts of the box production shares (F3) for zero backend change. The backend never
  reads `frontend/`. (render.yaml declares no buildFilter; the live filter is set on the service.)

### Phase 3 · One composition, no blind spots
- [ ] W-30 Sim tide parity (F8): the sim resolves tide exactly as `rate_one_spot` does when it has a `valid_time`
  and `RATING_TIDE=1`; a parity test on a "Low tide" spot; the S4 monitor samples the 18 banded spots.
- [ ] W-31 Missing depth is a NAMED regime (`unknown_depth`), never `shelf` with the offshore height (audit 4.1); a
  null control proves no served change where numpy exists.
- [x] W-32 (fix built; PR open, merge is the owner's) EMPTY_RENDER must HOLD for 3 s before it is a violation
  (`marineEmptyGrace.js`, a pure helper; `useLayerTruthDiff` asks it and arms one re-check so an idle map is still
  graded; kill `__RAW_DISABLE_MARINE_EMPTY_GRACE__`). 11 tests (7 helper, 4 hook wiring with fake timers), 6/6
  mutations red. **Live A/B on a production build, diagnostics intercepted locally:** under 6x CPU throttling (the
  slow-runner condition the Render reports carry, FPS 1-5) the old rule falsely reported a HEALTHY load in 2 of 2
  runs (16.5 s, 21.9 s after the click) and the fix in 0 of 2; with the marine grid requests starved (a real empty
  map) the fix still reported (8.0 s after the click; old 3.2 s). Unthrottled, neither reported (n = 1 each).
  Reaches the dev site only (production frozen, D-002); no served number. Earlier note: **Mechanism measured**
  (production build, 22:58Z, 50 ms probe): after Waves was switched on, all three suppression flags dropped at
  3,037 ms (the fetch's `finally`, `useMarineDataFetcherCore.js:735-743`) and the grid reached the engine at
  3,719 ms: ~680 ms in which the detector's condition is true on a healthy load.
- [ ] W-33 The frontend trace field `infoboxDisplayedHeight: point.speed` is renamed to what it is (offshore Hs).
- [x] W-34 (fix built 2026-09-30; PR open) The producer (`spot_conditions.py`) records each hour's source where
  the value is taken (`stored_product` + product id / upstream / dataset, or `point_query` + the provider); the
  route's whitelist carries `data_source`; the drawer prints it through the HUD's own origin mapping (moved
  verbatim to `map/dataOrigin.js`) and the direction as `66° ENE` (the old truthiness check also showed N/A for
  a due-north swell). 6 backend + 10 frontend tests; 8/8 mutations caught (no-shell runner); 198 existing
  conditions/hub tests pass; guards floor 175/2124. Earlier note: The spot drawer (`SpotConditions.js`) states its
  source as the literal "Data from Open-Meteo Marine API"
  (`:345`) while `/api/conditions/{id}` served the GFS chain and returns no source field; and it prints the
  direction as `${wave_direction}-` (`:325`, "65.61-" on screen: a lost degree sign, two decimals, no cardinal).
  The HEIGHT is correct: `wave_height_ft 2.3` with `surf_regime: shoaling`, `offshore_height_ft 1.2` (Spanish
  House, 23:01Z), so the ONE FORECAST COMPOSITION holds on this surface. Fix: the backend names its source; the
  drawer reads it and formats the direction.
- [x] W-35 Checked, no defect: the drawer's 2.3 ft equals the Florida tile's offshore maximum (0.6961 m) by
  coincidence; the endpoint returns the breaking height and the offshore height separately.

### Phase 4 · Accuracy where the rating error lives
- [ ] W-40 seq 78: regrid probe after the first flipped ingest (due 09-30 12Z); SCOREBOARD S6 row.
- [ ] W-41 seq 86: Stage B live (due 09-30 12Z).
- [ ] W-42 seq 79: consensus shadow scored rows -> a CONSENSUS_SERVE recommendation (due 09-30 18Z), then the owner's flip.
- [ ] W-43 seq 94: big-swell bias by FORECAST-height bin (#180's; due 09-30 18Z).
- [ ] W-44 S7-S9 instruments: period, swell-direction and wind skill vs NDBC, each translated into rating points
  (`validate_period_vs_ndbc.py`, `validate_wind_forecast.py`, `lane_swell_direction_probe.py` exist).
- [ ] W-45 Re-run the audit's quality sweep with the served flags (obs gate, local size, tide).

### Phase 5 · Drift
- [ ] W-50 `frontend/system-brain/weather-simulation-system.md` and BRAIN_RULES section 12 still say 512 MB (D-005: 2 GB).

### Owner-only, in order
Merge #180, then this docs PR; W-11 (unfreeze, after W-10); W-24 (health-check path); the CONSENSUS_SERVE flip after
W-42; F12 (Stripe key).

## 5. Log

- 22:38Z session start; 22:52Z plan written (this file). Next: W-03, then W-10.
- 22:54Z #181 opened (ledger seq 101). 22:56-23:03Z W-10 measurements on a production build (above); the HUD on
  that build read provider NOAA, source `ncep_gfswave025`, class AUTHORITATIVE NATIVE, no causal violations.
  Build: `npx craco build` (NODE_OPTIONS=--openssl-legacy-provider), served by a scratchpad SPA server; the
  temporary `.claude/launch.json` entry was reverted, nothing of it is committed.
- 23:04:57Z #180 merged (by the handoff session; ledgered seq 103). 23:08Z Playwright Chromium installed (owner's
  word). 23:37:30Z #181 merged (owner's word) as `5f6120a6`. 23:08-23:36Z W-12 runs (above). Next fix: W-32.
- 2026-09-30 00:04:15Z #182 merged, 00:26:47Z #183 merged (owner: "Merge #182 and #183 and move to the next fix").
  ⚠️ **Correction:** the "6/6 mutations red" for W-32 (#183, ledger seq 109) was first backed by a VOID run: the
  mutation script called `npx.cmd` through cmd.exe, which read the `|` in `--testPathPattern=a|b` as a shell pipe;
  jest never ran and every mutant exited 255 ("RED"). Found when a W-36 mutant I expected to survive came out
  "RED" and, run by hand, passed 11/11. Re-run without a shell (jest via node, verdict from jest's own summary):
  W-32 M1-M6 = 2/1/2/1/2/1 failed of 11, **6/6 genuinely caught**. #183's description carries a dated note.
- 00:46:50Z #184 merged (owner: "Merge #184 and move to the next fix"; CLEAN). It redeployed the backend (W-26
  not yet set). 00:47-00:59Z W-37 measured (above); the oracle fix is a test-only PR. Next: W-38.
- 01:21:18Z #185 merged (owner: "Merge #185 and move to the next fix"). W-38 resolved (no defect, above); W-34
  built as the next fix.
- 01:38:21Z #186 merged (owner: "Merge #186 and create a handoff report and a fresh context"); hosted guards 175 /
  2130 = the projection. 01:39Z `HANDOFF-2026-09-30.md` written for a fresh context; session closes here. Open:
  commitments 78, 79, 86, 94, 128; next fix W-10 (R4-R7).
