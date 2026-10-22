# Weather program: state

**Updated 2026-10-18 18:57Z** (logs: `log/2026-10-12-wind-light-path.md` (light's margin: its colour-blind line held as the GPU draws it, ON by default, D-031), `log/2026-10-12-wind-map-through.md` (near-calm air, D-030; #325 merged and live), `log/2026-10-12-wind-trails-linger.md` (why light's and beach's trails linger and dark's come back to the field: the trail composite's two laws, read off the screen; dark's veil under their trails ON by default, D-029, a DRAFT; the bench's truth mode), `log/2026-10-12-wind-map-through.md` (the land a step above the sea under the wind, D-026 amended; seeing the map through the wind in light and beach: the coast in the borders' ink, the coastline through a theme change, D-028; a streak's anatomy by speed), `log/2026-10-12-wind-light-path.md` (the check of light and beach against dark's logic; light's field in dark's hue ORDER on two levels, its legend bar moved with it, ON by default, D-024; the solver that holds the colour-blind floor; dark's law in the instruments found wrong), `log/2026-10-12-wind-land-depth.md` (the land at the sea's depth under the wind, D-026; its stated reason corrected), `log/2026-10-12-wind-canvas-alpha.md` (the page behind the map showed through the wind in light: why light never matched its samples; the wind leaves the canvas opaque, ON by default, D-027; the bench lays each frame over the app's page; the probe's ground reads low in dark), `log/2026-10-12-wind-beach-path.md` (beach's wind field checked against dark's logic: lightness one way through its green band, its pale gale band under a ceiling, the colour-blind floor back above 5; option F, ON by default, D-025; the solver that holds the floor as a constraint), `log/2026-10-12-wind-border-ink.md` (dark ink for the borders under the wind in light and beach, ON by default, D-023; the border, theme-switch and ground instruments; a theme change now leaves the new theme restyled; each theme's ground measured), `log/2026-10-11-wind-dark-white.md` (why light and beach did not mirror dark: the white by the ground under the mark, ON by default, D-022; the mirror instruments; light's colours read against dark's and parked), `log/2026-10-11-wind-pale-band.md` (the owner's verdict on #312; dark watched in motion; the white streak in light and beach, ON by default, D-021; #313; and a pale-band rule built and left unmerged), `log/2026-10-11-dark-rules-default.md` (dark's rules on light and beach, ON by default, D-020; #312), `log/2026-10-10-light-look-ab.md` (light's look A/B, default off: a deeper field + dark's streak method, or ink; #311), `log/2026-10-10-dark-style-light-beach.md` (dark's wind look for light and beach: the style columns, glow and ink behind default-off levers), `log/2026-10-10-light-fastband-a-default.md` (A, steady descent, is light's default wind field; D-018), `log/2026-10-10-wind-trail-anchor.md` (the wind's trails anchored to the map, #306), `log/2026-10-09-light-fastband-cvd.md` (three light fast-band redesigns that reach the colour-blind floor, default off; the design space and the per-gate report, #304), `log/2026-10-10-wind-bg-build-bounded.md` (the wind server amplifier: a full `gc.collect()` per background hour and the cancel cascade; a dark fix, #303), `log/2026-10-10-wind-eye-zoom-ladder.md` (the eye through a whole zoom: the tier mosaic, client; the storm-tile design for the server), `log/2026-10-10-closed-pr-audit.md` (what the 11 closed, unmerged PRs still owed: one fix ported, dropped records restored, two live map defects recorded), `log/2026-10-10-wind-series-supersede.md` (#300), `log/2026-10-09-wind-mute-app-stack.md` (#299), `log/2026-10-09-hrrr-wind-lane.md` (the HRRR wind lane by place and time, default on, D-017), `log/2026-10-09-hurricane-eye-one-model.md` (the eye's one-stop-zoom change: two models under the GFS label; dark `WIND_GRID_GFS_GLOBAL`), `log/2026-10-03-dev-rollout.md` (PR228 merged/live; hosted, schema and paired read-flow acceptance; broader audit remains open), `log/2026-10-03-oauth-time.md` (Strava authority and dark served-time comparison), `log/2026-10-03-audit-followup.md` (messaging authority, dark strict sim inputs and cache separation), `log/2026-10-03-audit-repairs.md` (local first repair batch, two before/two after;
partial findings remain open), `log/2026-10-02-cached-product-guard.md` (one guard on the cached-product
invariant; #223), `log/2026-10-02-consensus-flip-sweep.md` (consensus PR C: the displayed-catalogue
sweep, built), `log/2026-10-01-far-zoom-max-thinning.md` (max thinning built dark, the drawn-grid
legend, a load incident, the exact-frame fix for far zoom, the wrong-hour frame fix, the failing-runs note, the zoom-out grid diagnosis, the scheduler slot fix, the faded heat map diagnosis, the faded heat map fix, and the held-base follow-up), `log/2026-10-02-commitments-182-228.md` (182 read, a W-23 label defect fixed,
228 closed on S11), `log/2026-10-02-ledger-month-rollover.md` (the skill ledger died at the October
rollover; the fix is #217, stacked on #216), `log/2026-10-01-grid-resolver-no-shared-diagnostics.md` (the resolver's
diagnostics stamps, #213), `log/2026-10-01-coarse-fill-shared-vectors.md` (#211),
`log/2026-10-01-clock-every-header.md` (#208), `log/2026-09-30-clock-every-header.md`
(#208), `log/2026-09-30-mojibake-debris.md` (#206), `log/2026-09-30-c188-bigswell-by-region.md` (#197, #198, W-30), `log/2026-09-30-memory-audit.md` (every memory checked), `log/2026-09-30-audit-sota.md` (the deep audit), `log/2026-09-29-consensus-and-ops.md`, `log/2026-09-29-sim-works-plan.md`; every action: `ACTIONS.jsonl`). Verify live before acting: this file
is a claim, not a measurement.

## Now

- **2026-10-22 09:35Z: static frames LIVE for world GFS waves; eight world sets in draft PR #453 (no served number moves).** Read-back of pilots run 39722114072: 113 built, 0 refused, coverage 1.0, latest.json 200, frames immutable with no Content-Encoding (the in-browser parity vs live /grid, commitment 1585 part 3, is instant-scrub's one live open). #453 adds GFS swell_1/swell_2/wind_waves, ICON waves/swell_1/wind_waves and EURO waves (global_mid), each ON behind a per-set kill (`__RAW_DISABLE_STATIC_FRAMES_SETS__`); ICON/EURO estimated tails stay on /grid (core lane); EURO gets seam A in its own client; the latest.json backoff #447 dropped is carried. Offline: 27.5 M nodes 0 bad; scrub p95 GFS swell_1 5,778 -> 17 ms, EURO waves 2,979 -> 18 ms, 0 backend requests. Budget: ~177 s a publish, ~77 MB stored, 6.4 MB egress per desktop open of a GFS set. Log `log/2026-10-20-claude-static-frames.md`; ledger 1655 (finding), 1656 (pr_open).
- **2026-10-22 03:10Z: lead merge day (19 PRs on 10-21/22: #423, #425, #426, #429, #432, #422, #419, #438, #439, #428, #431, #441, #427, #442, #443, #433, #437, plus #430/#434 by their session).** Speed: /products once per manifest + compact (#423/#426), client request diet (#426), static CDN frames ON with the publisher fix (#422/#443; inert until the first post-#443 pilots run publishes), instant scrub with adaptive idle fill ON behind static frames (#437), stale-grid backoff (#441), CI weather load off the live box (#439: E2E 119 -> 0, zoomlab 72 -> 0). Colour: light crests back to the original (D-041) with a two-tone lever (#442), light wash re-solved apart from dark (D-037), dark cased orange 8 m+ (D-039), thinner big-surf crests (D-042), beach crest style levers (#433); the owner then picked the crest edge ON for light and beach (flip PR pending). Log `log/2026-10-21-claude-lead-merge-day.md`.
- **2026-10-22: light's wave wash is the re-solved seven-band spectrum (owner, DECISIONS D-037; PR #431, client only, no served number moves).** Bands on the WMO / Douglas breaks: soft green -> aqua -> teal -> steel blue -> indigo -> maroon -> dark red (cap 14 m). As far from dark's wash as v2 (0.8-3 m 23.9 vs 24.0 dE00); neighbour steps 12.0 (v2 9.3); calm water under 0.5 m fades to the map; equal-band legend ruler. Original crests by default (D-041); V2 over the spectrum (2.35 m switch) and a far-zoom crest lift only with `__RAW_LIGHT_CREST_V2__`. Finding: the original crests read |Lc| 0 from about 2-2.5 m on any light wash, and no wash fixes it (the crest must). Kill `__RAW_DISABLE_WAVE_SPECTRUM__` = v2 at 16 m. Owner page https://claude.ai/artifact/2PAV3K3x43fhsUc2pMeGus; log `log/2026-10-21-claude-wave-light-spectrum.md`.
- **2026-10-21 13:45Z: static forecast frames, step 2b, DARK (PR #422; world GFS waves; no served number moves).** Every stored GFS waves global_mid product becomes an immutable gzipped binary frame (~55 KB vs 2.35 MB /grid JSON) in the public bucket `weather-frames`, parity-checked node by node, with a run index and a no-cache `v1/latest.json`; published from the PILOTS lane (forecast-ingest-pilots.yml), the only lane whose disk holds the set (review: the core lane held 60 of 115, 5 within 0-165 h), behind a 90% coverage gate; unbuilt entries are listed with path null and fall back to /grid. Client opt-in `REACT_APP_STATIC_FRAMES` / `localStorage.__RAW_STATIC_FRAMES__`, kill `__RAW_DISABLE_STATIC_FRAMES__`. Offline: exact-correct frame per scrub step p50 2,286 -> 238 ms, 0 backend requests (log 2026-10-20-claude-static-frames). Ledger 1584 (pr_open) and 1585 (commitment).
- **2026-10-21 11:40Z: light and beach hold the calm-sea wash at close zoom (owner, DECISIONS D-038; PR #430 MERGED 14:24Z as `73e25a908`, the dev site serves it (static read 14:26Z; owner 15:11Z: "hold looks good on this"); client only, no served number moves).** BLEND BOTH's regional height fade (smoothstep 0.05-1.4 m) now runs in dark only; light and beach draw calm regional cells at the zoom opacity over the coarse base (a 0.5 m sea at z 10: alpha 0.31-0.40 -> 0.79-0.83; dark pixel-identical; storms unchanged). Kill `__RAW_DISABLE_CALM_WASH_HOLD__`. Owed: wave-lib ALPHAS model the held state (ledger 1566, after #416). Log `log/2026-10-21-claude-calm-wash-hold.md`.
- **2026-10-20 16:20Z: beach keeps the v1 wave palette, locked (owner, DECISIONS D-035; PR #417).** Light stays on v2 at 16 m (D-033, D-034); beach draws v1 exactly as before #411 and keeps the 10 m height byte (per-theme `paletteFor`), pinned by sha256 in `marineWavePalette.test.js`; changing beach's wave colours needs the owner's word. Kill `__RAW_DISABLE_WAVE_BEACH_V1__` restores beach on v2.
- **2026-10-20 15:15Z: the GPU sees wave heights to 16 m for the light and beach wash (#415 MERGED; client only, no served number moves).** The wave texture's height byte carries its scale per upload (`marineHeightEncoding.js`): 16 m where v2 draws the wash, 10 m for dark, rating grids and the score texture; every decoder reads `u_heightScale` (10.0 when unset). v2 gains a 16 m anchor and its flag moves up to 16 m. Kill `window.__RAW_DISABLE_WAVE_HEIGHT_16M__` = #411 exactly (shader strings and texture bytes sha256-pinned). The 16 m byte is ROUNDED (a floored first cut was worse than dev at calm water). **Owner 16:17Z: ship it, ON by default (D-034). MERGED 16:52Z as `9c6d5ebb0`; the dev site serves it (static read 17:24Z).** Log `log/2026-10-20-claude-wave-height-16m.md`.
- **2026-10-20 12:46Z: wave-height palettes, owner pick D-033 (PR #411, client only, no served number moves).** Light ships candidate A, beach candidate B: lightness falls with height, never through grey, cap at the GPU's real 10 m ceiling with an above-cap colour and legend arrow; ON with kill `__RAW_DISABLE_WAVE_PALETTE_V2__` (v1 exactly). Checker `frontend/scripts/wind-color/wave-check.mjs`, Jacobian `wave-jacobian.mjs`. Open follow-ups (own sessions): the height encoding to ~16 m; beach crest contrast at 1.5-4 m.
- **2026-10-20 08:20Z: overnight merge queue closed (lead session).** Merged at tested heads: #404 crest period cue, #405/#409 marine+wind FBO teardown sync (render 4.1->0.45 / 5.0->0.7 ms), #407 CMEMS=MFWAM labels, #408 land-mask fast paths (byte-identical), #410 async shader compile, #412 peak period for ICON/CMEMS (DARK: COPERNICUS_PEAK_PERIOD and ICON_PEAK_PERIOD stay '0' until the owner flips). Final frontend integration (dev 60fc1954c): Jest 340/340, lab 0 failures, theme x device 6/6, WebGL context loss recovers. Owner decisions open: #411 palette A/B pick; dev -> main (§22). Buoy evidence: ICON tm10 reads 13% (26% mixed seas) short of peak; the equal-mean consensus beats every member at days 1-5. Receipts ledger 1510-1531; log 2026-10-19-claude-scrub-upgrade.md 04:20 EDT.
- **2026-10-19 22:17Z: W-4 series serve path, DARK, draft #389 rebased onto dev `88e762fe0` (backend only; `GRID_SERIES_PAGE_MEMO`, default off, owner flips).** The scrub audit's F-05 (`/grid_series` p95 10 s live; exact-bbox keys, no page sharing, legacy encode + gzip 9 on the loop). Flag on: the bbox is snapped with the resolver's own tile snap (refused across any server span edge), one build per page in flight, finished pages kept as gzip bytes (180 s, cleared on any manifest write, never kept when a later request could build differently), direct serializer + gzip 4 off the loop, stage timers in `/api/health` `request_telemetry.stages` and `Server-Timing`, and a build is CANCELLED within ~0.25 s once every client waiting on it has gone (a lone client included). Offline A/B (synthetic GFS/ICON/EURO x 4 layers, deployed pins, owner's PC): a repeat or jittered page costs 0-0.6% of the cold CPU; world-page encode 806 -> 189 ms, gzip 252 -> 46 ms; decoded payload equal to flag-off for the snapped bbox on 5 pages; server CPU in the 4 s after a client drops a cold page 2.7-3.1 s -> 0.34-0.59 s. Two independent reviews: all five findings fixed. Still open: the per-hour product parse / L1 thrash (`store_helpers.py`) and a ~7 s 13-deg regional build offline. Read-back after a flip = commitment 1459. Log `log/2026-10-19-claude-w4-series-memo.md`.
- **2026-10-19 15:50Z: scrub repairs, verified state (report https://claude.ai/artifact/EmsHPfaUehDkybRQUXdnvM).** Dev serves #388 (frontend) and 0607a725 (backend, p95 10 s / p99 93 s). Open: #391 lab, #393 wind honest+fast (stacked on #391, review fixes in), #394 W-5 offset caches, #389 memo (conflicting), #392 mask stash. Marine Nightly red on SETTLED_STEP since the 10-16 21:24Z `SERIES_THIN_NODE_BOUNDS` flip (0 -> 2 -> 16 -> 23 at z 5-16), predating the scrub PRs; cause unconfirmed (flag + #347 mask reuse vs basemap tiles in the luminance sample). Next: frozen-data 2x2 A/B (owner approves the flag-off arm), merge #391 -> #393 -> #394, server-side series cancellation (W-4). Nothing accepted for production. Log `log/2026-10-19-claude-scrub-upgrade.md`.
- **2026-10-19 05:10Z: scrub upgrade, every marine layer x model (draft PR, stacked on #387; client + harness only, no served number moves).** ICON Swell 2 now scrubs from the GFS + EURO swell_2 series caches through the SAME blend function as the per-hour path (`iconSwell2Blend.js`; the owner's "after switching to the next marine layer, it stopped"); wind scrub fetches coalesce one-in-flight/newest-waiting (T-04, no abort); the timeline status line says what is DRAWN vs selected, by instant (W-1: loading another layer/model, nearest stored 3-hourly forecast, estimate); the point card's stale badge is decided from the same record (T-05); wind particle motion uses a fixed 50 kn reference (the old normalizer was hypot of SIGNED u/v maxima, so motion per knot changed with wind elsewhere: Jacobian lens). A/B on the new 12-combination harness matrix (`scn_layer_matrix.js`, `serve_synthetic.py --models GFS,ICON,EURO --layers ...`), same anchor hour, split by lattice: silent wrong-hour frames 5,683 -> 114, silent layer-switch frames 37-106 -> 0-13, model-switch 52-81 -> 2-3, on-lattice timing unchanged (35-58 ms), ICON swell 2 on-lattice 682 -> 567 ms with 50% instant series hits, long tasks unchanged. Off-lattice exact frames still 2.3-3.4 s (the data is 3-hourly; the label is the fix). Land-mask rebuilds did not reproduce offline (world tiers reuse the mask); needs regional fixtures. Every change has its own kill. Log `log/2026-10-19-claude-scrub-upgrade.md`; evidence `evidence/scrub-upgrade-layer-matrix-2026-10-19.json`.

- **2026-10-18 18:54Z: PR381 MERGED into dev a73358a69; exact-merge CI complete, all15 Actions jobs PASS.** Owner authorized merge and resulting-state verification; reviewed a80847d59 and squash a73358a69 have identical full tree8e8e1a8a. CI39154913781 all12jobs, Lighthouse39154913800, ledger39154913904 and governance39154914100 passed. Executed composition3218pass/67JUnit-skips (raw66skip+1xfail), chain2733, estate2262/323selected/321results/0silent, frontend438suites5766tests/buildsuccess. Only canonical records and paired estate CI floor/citation differ from prior dev62d94f5f; no application or hosting configuration change. Both hosting deploys suppressed. Final18:52 public readback: sharedAPI62d94f5f healthy, devworker62d94f5f, productionworkerfc140024, pinned canary6fbf439ac/adaptercd4253652 guard0/fixture-only and fixture hash unchanged. Main261db85a and canary branch unchanged. Guard default0 stays held; no environment/flag/data write, production rollout or change to Claude work. Shared runtime override is not disclosed by public health. E2E39154913817 cancelled before tests, not PASS. Receipt [draft PR382](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/382) is OPEN/unmerged on codex/pr381-dev-merge-record; ledger1441-1442 records publication; no further merge authorized. No served-number or scientific/full-server/E2E acceptance change. Record: `log/2026-10-18-codex-pr381-merge.md`, `evidence/pr381-dev-merge-2026-10-18.json`; ledger1438-1440.

- **2026-10-18 18:00Z: PR381 CI repair on its own branch; no runtime changes.** Initial8c13ffb1f merge-tree CI failed the missing historical379 merge receipt and estate floor2259vs2262. Verified historical379/380 receipts appended; current dev62d94f5f incorporated into the PR branch only. Estate minimum2260 and paired citation2262 preserve margin2; existing36 floor tests and live staleness reading39142012113 pass. Repair64278f573 hosted ledger/floor checks pass; PR381 marked ready for review and read back OPEN/isDraftfalse. Final-head long CI is pending at this entry; current results remain in GitHub Checks. PR remains unmerged; guard, isolated canary, production/main and Claude work unchanged. Application implementation byte-equals dev; no served-number change. Record: `log/2026-10-18-codex-pr381-ci.md`; ledger1434-1437.

- **2026-10-18 17:39Z: owner-authorized isolated #378 diagnostic canary LIVE; guard0.** Separate Free/Oregon service, auto-deployOff, no project environment, secret files, linked environment groups, data credentials, datastore, disk, cron or worker. Exact backend pin6fbf439ac/tree6899f987; separate adaptercd4253652 on unmerged `codex/pr378-isolated-canary`. Initial and post-restart HTTPS each pass12 provenance controls+5 negative routes; readiness200, identity/source/fixture hashes unchanged,11339 records, no database/server imports and zero application network attempts. Actual startup/old-process exit observed. Capture expected503 preserves genuine warnings; fixture-only health contract, not full-server/live-ingest/E2E/scientific/guard-enabled acceptance. Production/main/existing dev configuration and Claude work untouched by this session; no forecast number change. Earlier15:20 backend-hold entry below is historical: read-only15:38 shared-API observation reported concurrent #379 source70e1f1b15, including #378; this session did not perform that rollout. Record: `log/2026-10-18-codex-pr378-canary.md`, `evidence/pr378-isolated-canary-2026-10-18.json`; ledger1428-1432.

- **2026-10-18: marine provenance [PR #378](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/378) MERGED into dev `6fbf439ac2bb2da5337f9a45864ffd3af8be8423` at15:01:36Z; dev frontend VERIFIED live as6fbf439a.** Full merge tree byte-equals independently reviewed79758e797. Merge CI39138610801 all12jobs PASS: guards3218passed/67skipped/0failed/0errors, chain2733, estate2257, frontend438suites/5766tests/buildsuccess; Lighthouse39138610797, ledger and governance pass. Static root/manifest/entry200; entry SHA256ed4bf2d5c6c745ef768acebf68cd71d09a95ed9952778304f298946121f7f046. Final15:20Z main261db85a, productionfc140024 and shared backend62021d59healthy/restorecomplete0errors remain unchanged. Backend health/provenance fixes are **merged but NOT live**: shared API deployment is suppressed by `[skip render]` under the production hold. `ESTIMATE_COHERENT_TRENDS` stays default0/HELD; no env/data write, flag activation or main/production promotion. Existing marine warnings persist. Full live E2E39138610843 was cancelled before tests because its exact Render SHA gate cannot pass under the hold; it is UNRUN, not PASS. Frozen production-origin health proxy404 is a separately classified probe limit; configured direct API and dev proxy are healthy. Prior qualification receipts adopted without source changes; draft receipt [PR #381](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/381) is OPEN/unmerged against dev, documentation only; ledger1409-1427. Record: `log/2026-10-18-codex-marine-provenance.md`, `evidence/pr378-dev-merge-2026-10-18.json`.

- **2026-10-18: D1 MERGED as [PR #376](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/376) into dev `e57b54791` at 02:06:00Z, on the owner's explicit word.** Merge tree equals reviewed `d654bad04` (19 checks passed; frontend 438 suites / 5,766 tests, backend 3,136/2,701/2,257 passed; 153 offline WebGL steps). Missing/disjoint donor support recovers the validated stored ICON estimate; scientific direction cancellation remains masked. Dev frontend now serves identical-tree deployment trigger `698ecf62` (the squash inherited skip markers); D1 marine code is present in CDN assets. Shared backend is deliberately unchanged on 62021d59, with byte-equivalent backend source, healthy/restore complete. Deployment-head CI and Lighthouse passed. Full dev E2E workflow succeeded, but the completed report is qualified: 66 expected, one Explore-load flake, nine existing skips, zero unexpected; report stats.ok false. Bounded diagnostic 39090797528 then passed the affected test once with retries disabled, preserving the original full-run flake. Main stays `261db85a`; production frontend promotion and flags remain HELD. Production frontend remains `fc140024`; ICON/EURO marine cycle-provenance warnings were observed before rollout and remain open. Record: `log/2026-10-18-codex-merge-376.md`, sanitized `evidence/pr376-dev-deployment-2026-10-18.json`, ledger 1400-1408, draft receipt PR #377 (unmerged); review details and limitations remain in the independent-review log and receipt. D3 cache identity, series snapping and day-8-14 skill are not certified.

- **2026-10-16: skill-ledger archive fix MERGED as #342 (dev `66a320e54`, 15:37:16Z, owner: "Ok merge it and go with the plan"); first healthy ledger pass READ BACK 17:53:24Z (run 38937167877: `scored-2026-10-16.json` written, `scored=892`, no EntityTooLarge), the Forecast Accuracy Monitor going green NOT yet read.** The Forecast Accuracy Monitor has been red since 2026-10-13 because `calibration/skill/scored-2026-10.json` (52,404,041 B) hit Storage's 50 MiB object limit: 49 of 57 ledger passes failed `EntityTooLarge`, and since the archive is written before `pending.json`, each failed pass also dropped its own new forecasts (a gap that cannot be backfilled: scoring joins only the current buoy report). Measurement-only, started before #331 and #341. #342 archives scored rows in one object per UTC day from October (the monthly object is frozen, still read), ships `[skip render]`, and moves the floors (guards 2668/196, chain 2467/164, files 163 to 164). Hosted CI on the code commit 238f23e04 is green (14 checks; chain 2473/164 and guards 2674/196 equal the projections); a true-scale check (183,349-row frozen month against the real limit) fails on pristine dev with the production error and passes on the branch. Owed now it is merged: ledger commitment seq 1280, the read-back of the first healthy pass (due 2026-10-19). Record: `log/2026-10-16-skill-ledger-day-segments.md`, ledger seq 1277-1282.

- **2026-10-16: thinned-frame bounds fix MERGED as #343 (dev `7b06900ad`, 17:07:11Z, flag default OFF, `[skip render]`, nothing served changes; the flip is held).** A thinned world frame (stride 4 on a 181 x 83 frame, lat -80..84) kept rows -80..80 but still said `north = 84`, so the client drew every feature up to 4 deg too far north (measured exactly 4.0 deg through the real mid-res tier on both read paths). `SERIES_THIN_NODE_BOUNDS=1` (Render env, owner's word) rebinds the bounds to the kept cells at all four thinning sites; 30 tests (17 of the first 20 failed first; 10 added after an independent review), 6 mutants killed and one equivalent, guards floor 197 files / 2698 (reading 2704); first head's hosted CI 12 of 12 green at 2694 / 197. **The flip is HELD though the owner said "Flip and merge if its the best path forward":** production's frozen client (`fc140024`) predates #279 and reads bounds as cell edges, so the shared flag gives it nothing (worst 3.90 -> 3.81 deg), and the review found unmeasured dev-client effects (series hit -> miss for viewports whose north edge is in 80-84, world mask rebuilt on every thinned/exact swap); owed: the offline client A/B (commitment seq 1289, due 2026-10-19), then the owner's word. NOT established: that this is the hurricane shift the owner reported. Record: `log/2026-10-16-thinned-frame-node-bounds.md`, ledger seq 1282-1298, SCOREBOARD S21.

- **2026-10-16: the manifest lost-update lane is DRAFT PR #344, NOT READY (two independent reviews said do not approve).** A snapshot merged against pointer generation g0 passes `publish_run_keyed`'s CAS from the fresh g1 and erases what another writer committed in between: reproduced OFFLINE only (not shown to be what left EURO wind's 14 estimated frames out of the served manifest at 13:54Z; that alert cleared on its own by 17:02Z). `MANIFEST_MERGE_AT_COMMIT` (dark, default off) records the generation reconcile merged against and 3-way-merges at commit. Review 1 (ledger 1293): deterministic run-keyed names let a CAS loser overwrite the winner, `exclude_keys` ignored for queued snapshots, every fallback after a moved head published unmerged, bases never released, older run won. Rework `095378d60` fixed three of five; review 2 (ledger 1303) CONFIRMED an UNSEEN head move still falls back to the old path (14 of 14 frames lost), the floor was not moved, the own-publish skip trusts generation numbers, a prune-then-save brings the entry back; unique objects cost ~1.5 GB/h. The old publish path is the wrong place to keep patching. Owed: the owner's call between a third rework and a different shape (re-reconcile on the executor thread right before the PUT, or one writer). Never set the flag without a separate word.

- **2026-10-17 13:53Z: the first morning reads (ledger 1372-1381, log `log/2026-10-17-morning-reads.md`): the manifest lane publishes but its RETENTION IS BLIND, EURO wind is 503 critical, scoring is most likely the outage hole.** #330 MERGED (`5cfec8f55`, 13:25:43Z, comments/docs/tools only). (1) Manifest lane (commitment 1366 read): the pointer advances (145348 at 13:18:30Z), no lane errors, BUT 318 of 318 retention gauge lines read '0 standing, 0 deleted' while Storage holds 353 hash-named copies (5.2 GiB, 15 MiB each, none deleted) beside 2,683 legacy per-generation files (47.4 GiB): the 100-row oldest-first listing sees only the legacy names. About 13 GiB a day against a 58 GiB bucket (about three days to an assumed 100 GB quota; the quota and spend cap are not visible from here). Fix: PR 366 (newest-first listing, two tests that failed first; independent review APPROVE with four survivor tests added, ledger 1382; the owner said to merge #366 and #367 on a clean review and green checks); the legacy 47 GiB and a flag rollback are the owner's decisions. (2) EURO wind (Codex S1): /api/health/data 503, cycle 25.4 h; the ECMWF-direct fetcher timed out (1800 s) in the 08:46Z and 12:12Z core runs and the Open-Meteo fallback hit 429 both times; no code or dependency change; cause not established (commitment 1377). (3) Scoring (Codex S2/S3): scored 0 since 10-16T21:50Z, pending at the 54,000 cap with 1,020 evicted; most likely the 10-13 to 10-16 ledger outage's hole travelling through time (H1, prediction commitment 1379); the scalar read-back is re-dated to 10-23 with a forecast-time filter (1380). Codex's handoff is reconciled item by item in ledger 1381.
- **2026-10-17 04:28Z: the GFS-first SCALAR HEIGHT FLIP and the ONE-STEP MANIFEST LANE are LIVE, on the owner's explicit word (2026-10-16 23:57 EDT; ledger 1362-1366).** #350 (the lane, seven independent reviews, guards floor 207/3125, hosted reading 3131 as projected), #363 (`SAMPLER_SCALAR_HEIGHT` '1' in forecast-ingest, pilots and precompute; `SAMPLER_SCALAR_HEIGHT_MODELS` GFS, so EURO and ICON are unchanged) and #364 (`MANIFEST_PUBLISH_ONE_STEP` '1' in forecast-ingest, pilots, precompute and sim-parity-monitor, NOT Render) are merged; Render got `SAMPLER_SCALAR_HEIGHT=1` and `SAMPLER_SCALAR_HEIGHT_MODELS=GFS` and a deploy of dev `33b25cf55` (healthy, restore complete). Lanes pick the flags up from their NEXT scheduled run; a run in flight keeps the old setting. Owed: the manifest watch (first scheduled runs; rollback = the four values back to '0'; commitment 1366, due 2026-10-17 12:00Z) and the scalar AFTER row (72 h of post-flip rows; pass = served minus ncep_gfswave025 <= +0.005 m at every lead and no lead worse than before by more than 0.005 m; commitment 1365, due 2026-10-20). Not measured: a live before/after height (the permission layer refused those production reads). Record: ledger 1358-1366.
- **2026-10-17 02:46Z: #359, #360 and #361 MERGED on the owner's word (ledger 1352-1354); the scalar flip is NOT done.** #360: the monitor now grades the built consensus shadow against its own definition at every lead (WARN only, kill switch ACCURACY_CONSENSUS_CONSTRUCTION=0; on today's numbers it warns at +48/+72 h). #361: the scalar height switch is model-scoped and dark (SAMPLER_SCALAR_HEIGHT_MODELS defaults to GFS; the master flag is still '0' in the three workflows and on Render). The flip needs the owner's explicit word and then three workflow literals plus the Render env and a deploy. Manifest one-step lane (#350, draft, default off): round 7 verified and pushed; review 7 (the seventh) found no P1/P2 and round 8 closed its P3s: the lane is COMPLETE, default-off and draft, awaiting two owner words (merge; then, separately, the flag in the L2 writers' env after verifying the pointer table) (ledger 1356-1357). Record: ledger 1352-1357.
- **2026-10-17 01:43Z: the one-off scored-rows job RAN on the owner's word (ledger 1344, run 38992023289, read-only, aggregates only): GATE YES (1345).** None of 44 cells loses by more than 0.005 m (closest: forecast band big > 3 m at +48 h, n 179, scalar worse by 0.0035); pooled served - scalar +0.014 m over 22,642 paired rows (served wins 30 percent), positive in both halves, structure 2.7 times a uniform shift; the scalar closes 102/94/82 percent of the gap to Open-Meteo's copy of the same model. CAVEAT: the evidence is the GFS lane only and `SAMPLER_SCALAR_HEIGHT` is keyed on domain, so flipping it also changes every EURO and ICON height (ICON already leans high); the flip is not done and needs the owner's explicit word, probably as a model-scoped (GFS first) dark change. Consensus defect narrowed (1346, corrected 1347): it travels with rows whose EURO member is 'unknown' (median 0.12 m high at +48/+72 h), and rows with known members match the equal mean to 0.004 m; cause still unproven (commitment 1336 open).
- **2026-10-16, night: the accuracy-gap evidence is in (ledger 1334, log `log/2026-10-17-served-height-gap.md`, #356 merged) and three tracks run.** Served `raw_surf` trails its own `raw_surf:GFS_SCALAR` lane by +0.017/+0.019/+0.018 m at +24/48/72 h (paired n about 3,100, 36 of 36 lead-reads over 12 monitor reads, about two near-independent weeks), about 90 percent of the gap to Open-Meteo's copy of the same model; the scalar flip is the smallest dark change, gated on a row-level read (coast and forecast-height band) that needs the scored rows in Storage: the one-off dispatch-only CI job is MERGED (#357, nothing run; its dispatch is the owner's word, commitment 1335). The built CONSENSUS shadow is NOT the equal mean D-006 chose: it matches its definition at +24 h and reads about 0.13 m high at +48/+72 h, so `CONSENSUS_SERVE` must not flip on the current build (commitment 1336; D-006 stands, D-009's premise fails at +48/+72 h). Surf-zone gate on the nearshore judge: draft #358 (REFUSE / standing WARN / RED after 2026-11-15; the live reading is the served surf height 20 percent LOW against nearshore buoys, observed/modelled 1.25; ledger 1333 said 25 and is corrected at 1339). Manifest one-step lane (#350, default off): review 6 said DO NOT APPROVE (a regression round 6 introduced in the retry memory), round 7 is with the builder. Harness live mode (#354) and the evening record (#355) are merged; the surf-zone gate (#358) is MERGED (ledger 1348, first real gate reading owed, commitment 1349); two more draft PRs are open on the evidence: #360 (the monitor grades the built consensus shadow against its definition, WARN only) and #361 (a model-scoped, dark, scalar-height switch, GFS first). Record: ledger 1331-1351.
- **2026-10-16, evening: #353 (render-hour parity fix) MERGED on the owner's word (ledger 1325); the live read-back of the flip is TAKEN (1328).** On the live server: two 48-frame world pages at stride 4 carry bounds.north 80 == the last kept row (flag off would say 84); thinned vs exact at the same hour and camera registers at 0 px (replay with the flag off: 30 px = 2.11 deg; on: 0); frozen-camera windows on real data (settle, one-stop zoom, 4-degree pan) show no redraw and at most 2 px. Not measured live: the flag-off value, mask-sized upload counts, the owner's own look (the dev site is behind the access code), so commitment 1322 stays open. Dev E2E on the parity merge: 65 passed, 2 flaky (booking-flow), 9 skipped, 0 failed; its push run failed at the Render wait (a `[skip render]` commit can never pass that step) and ran no test (1326-1327). #354 (draft) is the harness's opt-in live mode; #350 round 5 was reviewed (1330, approve with changes) and round 6 is with the builder. Record: ledger 1323-1330.
- **2026-10-16, later: #347 / #348 / #349 MERGED on the owner's word (ledger 1305-1307); #344 CLOSED as superseded (1309); #350 (draft, WIP) is the one-step manifest publish, `MANIFEST_PUBLISH_ONE_STEP` default off: review 3 of `bc2233a46` confirmed integration defects (1310) and round 4 is building them out; #351 MERGED (ICON in the offline harness, ledger 1316).** ICON far hours (1312, synthetic store): with `REACT_APP_ICON_STORED_TAIL` unset the client builds `gfs_trend` grids for hours 169-240 that `WebGLMarineLayer` does not whitelist, so they are dropped and the engine stays on the last drawn hour; with it set (the dev branch deploy only) they draw. A latent release risk; production's frozen bundle was not measured. The stale render-hour parity record (1304) is pervasive under latency (1313): the client fix is draft #353 (ledger 1320; harness: 7 of 7 steps read parity true at the upload; review 1 found and fixed a stuck-badge MEDIUM). Forecast Accuracy Monitor GREEN after the #342 repair, commitment 1280 closed (1314-1315); dev E2E on the #347 build 67 passed / 9 skipped / 0 failed, the GL pixel test skipped everywhere (1319). The flip of `SERIES_THIN_NODE_BOUNDS` was DONE on the owner's word (2026-10-16 17:23 EDT, ledger 1321: env var set on Render and a deploy of dev tip a74bf1f83, the first time #342/#343 code reached Render; the discriminating stride-4 read-back is commitment 1322, due 2026-10-19); the hold's production-compatibility reason was not real (1318: the frozen production bundle never calls `/grid_series`, `/grid` is identical flag off vs on). Record: ledger 1305-1322, `log/2026-10-16-thinned-frame-node-bounds.md`.
- **2026-10-16: #345 (offline harness) and #346 (docs) MERGED 18:44Z / 18:43Z on the owner's word (ledger 1299, 1300); #347 (client world-mask cover-reuse) and #348 (harness latency + Home scenario) are DRAFTS.** #347: a cached world mask covering a world frame is reused (kill `__RAW_DISABLE_MASK_COVER_REUSE__`, a no-op until the server flag is on); with the flag on the harness shows mask-sized uploads 23 -> 13 (flag off 3), the coarse-base pass still rasterizes its own per distinct bounds (needs a mask-bounds field in `WebGLMarineEngine.js`, over the LOC cap). #348 / ledger 1304: after Home under live-like latency the layer's `__MARINE_RENDER_HOUR_PARITY__` / `__MARINE_HEATMAP_STATUS__` stay `retained_previous_hour` for 15+ s while the engine already holds hour 0 (parity effect runs before the upload and is not re-run); consumer `MapForecastOverlay.js:164`. The flip stays held. Record: ledger 1299-1304, `log/2026-10-16-thinned-frame-node-bounds.md`.

- **2026-10-16: the offline backend + browser harness (PR #345, merged; details):** The production FastAPI app over synthetic stored data (no outbound lookups by construction) and a Playwright driver reading the app's own diagnostics. First runs leaked a few WebSocket handshakes to production hosts (403; Supabase realtime anon): disclosed and fixed (ledger 1295). An earlier "stuck forward scrub" lead was MY FIXTURE (provider "noaa" vs production's "open-meteo"; the layer drops non-whitelisted providers) and is retracted (ledger 1297). Measured on the real renderer (ledger 1298): with `SERIES_THIN_NODE_BOUNDS` off the dev client draws a thinned world frame 2.04 deg (227 km) north of the exact one, on 0; the flag costs 4 to 8 extra 4096 x 2048 world-mask rebuilds per forward scrub jump (23 mask-sized uploads vs 3) because the mask cache compares bounds strictly. The flip stays held until a client mask-reuse change exists and reaches production.

- **PR340 MERGED and LIVE, real Gallery Hub board-clue smoke passed:** qualified b5bec0785 all16SUCCESS merged dev as ae13bade2d87846b43087034d8f39b0c20b66a52 at00:37:28Z; exact tree equal. Shared Render live00:43:09Z and DEV Netlify successful exact merge; public health/database/scheduler pass, weather restore complete0errors. One real uploaded licensed held-board photo produced tied A/B limited equipment clues; cancelled/unrelated controls excluded; single-photo manual review scoped1of2; scan added no tags/claims/deliveries/notifications or saved-board writes. Existing upload-created test rows were captured before scan and removed with all fixtures/media afterward; remaining0, owner original board preserved. Cap stays enabled/initialized5.45reserved/4.55available after one0.35reservation; no reset/refund. Production Auto Publishing Locked, workerfc140024. No migrations/settings/weather logic changes. Broad post-merge E2E38830529934 FAILED40minute browser limit; source CI remains green. Bounded diagnoses38835061375/38836004086 identify unfixtured synthetic locker claim-count401. ExactGET test fixture repair in draftPR341 head43ffb99c6; full72test/four-browser no-retry run38836406336 finished62pass9existing-skips1ChromeExplorefailure at real unavailable/recovery UI. All map/render/controlledfault cases passed. Added exact transport observation and at most one explicit manual recovery, with a forced503-to-real200 control perbrowser; 76case279head run38838733164 exposed real15s requesttimeout (backend200about18s), then was cancelled with artifactretained. PR34160857 source passedall16checks (guards2668/196); compatibility review found frozen production client60s versus DEV15s. Final candidate makes partialforecast8s opt-in(defaultFalse), updatedDEV sendsTrue; legacyproduction wait/values unchanged. Local60backend/floor controls and36focusedUI pass, isolatedHTTPlegacy/opt-in contracts pass; guards projection2669/196. Fresh finalhead hosted qualification then repair rollout/afterE2E remainpending, no app auth weakening. See log/2026-10-16-postmerge-e2e.md. [Release and smoke receipt](log/2026-10-16-gallery-board-clues.md).

- **PR337/338 merged; dev frontend live48284a5e:** Gallery Hub description/visual-tag review and board scan/apply/save passed with a real uploaded photo; entered board values preserved. Beach field contrast fixed and verified live. PR338 all20 contexts accepted; hosted434suites/5570tests/build passed. Enabled lifetime reservations5.10/10, available4.90; production Auto Publishing Locked/fc140024, shared backend healthya7c038919 unchanged. Disposable gallery/item/board and two storage objects removed, original quiver retained. Approved viewport override had no effect and was reset; real390x844 local component frames passed light/dark/beach with mocked API, not full deployed mobile/provider proof. Broad E2E38821861231 passed frontend-source gate, failed backend SHA equality gate, Run E2E skipped. [Final receipt](log/2026-10-15-vision-ui-workflows.md).

- **Historical Vision UI candidate (superseded by the final receipt above):** board Scan and main Gallery Hub review were qualified from dev a7c038919, full434suites/5568tests/build/lint passed at source bcebc1765. Initial enabled cap3.70/10; later acceptance ended5.10/10. No backend/config or served weather change. [Lane log](log/2026-10-15-vision-ui-workflows.md).

- **OpenAI cap live (2026-10-15), superseding earlier pending records:** both paid call paths explicitly use standard service tier, pinned models and permanent PostgreSQL pre-debits. PR336 merged/deployed as a7c038919; initialized once, enabled, latest5.10 reserved/4.90 available. Offline107 pass/1 PostgreSQL-only skip and hosted qualification preceded activation. The opening1.25 allowance is conservative accounting, not an invoice. Never initialize/reset again. Ledger1241 corrected pricing assumptions;1242 reconciles the merge; latest runtime receipt above. [Complete AI memory](../runbooks/AI-SESSION-HANDOFF-2026-10-15.md).

- **Historical PR336 implementation checkpoint (superseded by live status above):** shared PostgreSQL pre-debit covers vision and moderation, fails closed, persists across restarts/concurrency, and supports explicit `OPENAI_TEST_BUDGET_ENABLED=false` opt-out retaining its counter. Opening allowance1.25; initial local107 pass/1 skip and hosted PostgreSQL migration/RLS/concurrency qualification. [AI handoff](../runbooks/AI-SESSION-HANDOFF-2026-10-15.md), [operation/removal](../runbooks/OPENAI-TESTING-BUDGET.md), [implementation log](log/2026-10-15-openai-testing-cap.md).

- **2026-10-15: qualified PR331 DEV frontend now deployed at `9405b91f`**, direct owner approval in the vision session. Netlify branch-deploy/dev successful; public DEV service worker9405b91f and map HTML200 read18:34Z. Production remainsfc140024; backend healthy363c6d738. OpenAI feature excluded; no production publish/unlock/settings/flags/Render action. Master owns canonical combined reconciliation; broader functional acceptance remains open. [Local receipt](log/2026-10-15-vision-provider-integration.md).

- **2026-10-15: PR335 MERGED and DEPLOYED**: qualified83ca36160 merged dev asf2d339e64; exact merge tree verified. Shared backend live/healthy and dev frontend servesf2d339e6; production frontend remains locked/fc140024. Owner explicitly authorized shared rollout within$10 testing budget. Four paid synthetic/public-image requests passed;14 HTTP cases plus2health checks, no persistent fixtures/customer photos. Conservative smoke cost bound$1.236, actual tokens/charges unknown; account hard cap unverified and ongoing shared paid use not budget-enforced. Hosted frontend430/5558, estate1618, chain2444, composition2658/66skip/1xfail passed. Real stored-media/photos/device/manual-assignment acceptance pending. Deployment receipts local on `codex/vision-335-deploy-record`; canonical reconciliation pending. [Receipt](log/2026-10-15-vision-provider-integration.md).

- **2026-10-15: PR #334 merged into dev as `48877804`, DEPLOYED to the shared backend at `363c6d738`** (explicit owner shared-production authorization). All14 hosted source checks green; live public HTTPS smoke46 passed/0 failed: two real password logins, eight routes reject missing/invalid bearer401, cross-user requests denied, owner writes persisted, vision503 honest, board attributes unchanged. Two temporary profiles and all related fixtures removed and zero remaining read back. Healthy matching version before/after. No main or frontend deployment; no served weather number change. [Receipt](log/2026-10-15-reflection-ai-auth-fixes.md).

- Local qualified DEV candidate: codex/master-plan-qualified-dev-batch-2026-10-15 fromDEV1dbb0bbd; frozencommerceb220/waveee663179/recapb433. Exact source blobs imported; canonical DEV ledger prefix retained and source histories reconciled by CLI. Weather owner explicitly confirms current testing clearance and receipt of WIND/WAVE/latency handoffs; no whole F2 prerequisite. Combined local tests/build/browser qualification complete with explicit sandbox-only scope rerun; hosted exact head/publication/integration pending. Legacy JumpIn not current App imports; G02 open. Active weather/F2/payment runtime, migrations and flags excluded; approved BEACH/LIGHT palette/dark reference preserved. All12launch gates OPEN; native/realAPI/media/provider/whole-app acceptance not implied. Evidence docs/audits/evidence/2026-10-15-qualified-dev-batch/source-manifest.json.


- **2026-10-15: orphan checkout repair PUBLISHED for review; payment code NOT in DEV or deployed.** Source `codex/orphan-checkout-intent` at `0cc72995` (code `46a1d1b8`), remote SHA read back. Fresh bounded152 passed; prior actual PostgreSQL74 passed/0 skipped; wider2 inherited failures remain open. [Report](../audits/2026-10-15-orphan-checkout-repair.md), [publication log](log/2026-10-15-orphan-checkout-publication.md). This DEV update adopts confirmed records only, preserving newer wind work and ledger history. Migration graph/privileges, hosted/runtime parity, UI retry/return and separate operator/missing-live-return gates must be qualified before payment adoption. The coordinated commerce/weather rollout remains separate and held; no wind verdict, served-number change or SCOREBOARD gain.

- **2026-10-13 01:48Z: light's wind field holds its COLOUR-BLIND LINE AS THE GPU DRAWS IT (the margin), ON BY DEFAULT (client only;
  PR #327 against dev from `claude/wind-light-path-margin`, a draft until its independent review is in; the leading session merges it,
  last before dev is promoted to main; DECISIONS D-031).** The owner, 2026-10-12
  17:43Z, first-hand: "option 1, merge as shown and add the pin"; 2026-10-13 01:19Z, to the leading session, relayed: "And the
  small colour-blind tweak to lights colors". The owner has not seen it moving: it is a move no eye finds side by side.
  - **What draws:** `LIGHT_PATH.field` (`windLightPath.js`) is the path's field (PR #318) moved by at most 0.11 dE00 a knot,
    and owns 1 to 63 kn. The streak row and the legend bar are not moved. Beach and dark untouched.
  - **Measured** (`check.mjs --as-uploaded 10-80:0.25`, 281 maxima, before -> after): over the SEA 4.93 -> 5.03 as drawn, under
    5.0 at 32 maxima -> 0; over the land as it draws 5.18 -> 5.20; `check.mjs --strict` exit 0. Under the land step's kill the
    land's line is still short as drawn (4.85 -> 4.94; 123 -> 68 maxima): a kill's picture, pinned, not solved for.
  - **Kill:** unchanged, `window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true` (light before the path). No second kill; the rows PR
    #318 merged are `scripts/wind-color/light-path-318.json`.
  - **Not verified:** nothing seen in the app or on a canvas; the framebuffer's rounding not modelled; phones not measured.
    **Ledger:** seq 1166 to 1171 (1166 is `pr_merge #317`; 1169 closes the re-solve's commitment, seq 1118, and says which two
    parts of its check were not met as written). **Owed:** the read-back of the deployed build's bytes (ledger seq 1171, due
    2026-10-20), with the path's own (seq 1114). Log `2026-10-12-wind-light-path`, LESSONS L-V85, L-V86.
- **2026-10-13 00:41Z: in light and beach a streak in NEAR-CALM AIR is laid at a lower light level, ON BY DEFAULT (client
  only; PR #326 MERGED into dev as `f6310516`, 2026-10-13T01:03:09Z, on the owner's word of 00:14Z, "merge the calm wind pr when its ready"; live on the dev site at 01:06Z; DECISIONS D-030).** **THE OWNER'S VERDICT, 01:09Z, on the dev site with the coast ink, the veil, the land step and near-calm air on, on a desktop: "Ok I like this".** At a phone's size and pixel ratio the bench reads the four as on the desktop (log, 01:03Z section); a real phone has not been looked at. **`main` IS AT dev's content since 2026-10-13T14:16:40Z** (#328, squash `261db85a`: dev `f9320c27` whole, everything since #13 of 2026-09-02; the owner: "push it to main", the section-22 question, "yes push to main after the color tweaks are in", and, after they changed main's required check from `lint-and-build (18.x)` to `lint-and-build (24.21.0)`, "saved, merge 328, push to main"). **PRODUCTION DID NOT CHANGE:** `rawsurf.netlify.app` still serves the frozen build `fc140024` (read 14:17Z to 14:26Z); publishing is a step in Netlify, the owner's. **CLOSED OUT 2026-10-13** (the owner, 17:54Z: "merge 329, finish anything leftover from this work and make sure everything is also pushed"): #329 (the records of the promotion) MERGED 17:55:44Z as `131d5d9e`; production read again at 18:02Z, still `fc140024`. A sweep of every wind lane's branch against its upstream found ONE commit that never reached GitHub: the colours lane's follow-up to the review of #327 (`b5c96053`: comments and a README made true, a refusal guard in its solver; no drawn pixel), merged around by this session ten minutes after it was committed (LESSONS L-P37). It is in the close-out PR #330 with `scripts/wind-color/mirror-jacobian.mjs` (committed at last, and made true first: the white over land read 1.00, now the land step's 0.75; and, from the PR's independent review, dark's land was the bench's offline land, 11 L* too dark under the wind, now the real map's, with the tool printing its own ground against the bench's). **dev is AHEAD of `main` by records, comments and tools only: no drawn pixel.** `main` was not pushed again (section 22: the owner is asked). 17 local-only branches of previews, prototypes and variants not taken are left on the machine on purpose (named in the log's close-out section). Owed: `pr_merge #330` by the next PR against dev; the live read-backs (commitments 1069 to 1171, the owner's browser, on their ask, due 2026-10-19 and 20); a real phone. The colour-blind margin for light's field (D-031, #327) MERGED at 02:28:52Z as `f9320c27`. The owner, 2026-10-12 21:51Z: "The almost still wind needs to be
  almost still and almost transparent on beach and light modes, as that is how it looks on dark mode."
  - **What draws:** `windCalmAir.js` and the last statement of `DRAW_FS`: below 2.5 kn a mark's light level is 0.80 of itself
    over land and 0.78 over sea, full by 5.5 kn; the dim eases to half of itself by zoom 8. No particle is removed, moved or
    slowed. **Kill:** `window.__RAW_DISABLE_WIND_CALM_AIR__ = true` (read each frame). Lever
    `__RAW_WIND_CALM_LEVEL__ = [land, sea, from kn, full kn]`. Dark never reads it.
  - **Measured:** from 1 to 3 kn at zoom 6 the bright bodies covered 1.7 to 2.2 times dark's share and now 1.1 to 1.8; the
    median mark pixel over land stood +6 to +12 L\* over the field and now +1 to +5 (dark +4 to +6.5).
  - **The level is the eye's, on the visible side:** the gauge matches dark near 0.70 at zoom 6, and a few hundredths under
    that the marks go out; beside dark on film 0.70 and 0.75 read fainter than dark's. If the owner asks for more: the lever
    `[0.74, 0.71, 2.5, 5.5]`.
  - **#325 MERGED** 2026-10-12T23:47:40Z as `f1e4ebc1` (the owner, 22:24Z); the dev site served it at 23:50Z with the veil's,
    the land step's and the coast ink's switches in its bundle. Its live read-back is owed (ledger seq 1154).
  - **Not verified:** nothing seen in the app; zooms 2 to 4 read by eye on one film; no phone.
- **2026-10-12 21:51Z: under the wind, light and beach draw the LAND A STEP ABOVE THE SEA, and a streak over it at 0.75, ON BY DEFAULT
  (client only; PR #325 MERGED into dev as `f1e4ebc1`, 2026-10-12T23:47:40Z, from `claude/wind-map-far-zoom`, on the owner's word of 22:24Z, after #324; DECISIONS D-026, amended).** The owner, 21:13Z,
  with the coast in the borders' ink live: "I don't see the fix at higher out zooms, cannot see the land below the wind animations
  in beach or light modes well".
  - **What draws:** `windBasemapMute.js` `WIND_LAND_STEP`: the land takes the sea's own factor (0.90 light, 0.94 beach; it was
    0.81 / 0.85) and a streak over it 0.75 (it was the sea's 0.55). **Kill:** `window.__RAW_DISABLE_WIND_LAND_STEP__ = true` (the
    land at the sea's depth, as #320 merged, to the byte). Dark, the field, the sea and the coast stroke do not move.
  - **Measured:** land minus sea under an equal wind: light +8.3 L\*, beach +8.0 (dev +1.1 and +1.7; dark -9.4). A streak over
    land adds +11.7 / +12.0 L\* WITH the tail's veil on (dark +11.8; without the veil 1.2 times dark's: this merges after the
    tail's change). The colour-blind line as the GPU draws it over land: light 4.85 to 5.18, beach 5.06
    to 5.31. The coast stroke was not the gap at zooms 2 and 3 (it read 1.6 times dark's there): a land is seen by its tone.
  - **Its switch moves at the sync, whole** (an independent review, 22:30Z: the streak's strength read the flag every frame and
    the land waited for a style event): the read-back carries `landStep`, and the strength reads it. A lever-set land keeps the
    sea's strength; until the land mask is ready both grounds take the sea's. `check.mjs --before-step` reads PR #320's land.
  - **The order is the owner's (22:24Z):** "merge the land fix after the tail is in, the push everything turned on switch, so I
    can test all the changes right away". The tail is PR #324, MERGED 2026-10-12T23:14:37Z as `719070b2`.
  - **Not verified:** nothing seen in the app; the land mask's seam (0.75 against 0.55) is not measured.
  - **#323 MERGED** 2026-10-12T21:02:45Z as `e89aaa85` (the owner, 20:54Z: "merge #323 and build the tail"); the dev site served
    it at 21:04Z with its switch in the bundle. Its live read-back is owed (ledger seq 1134).
  - **The lanes:** the tail is the trails lane's build (`windTrailVeil.js`, dark's veil under light's and beach's trails; the owner,
    21:13Z: "merge the tail pr when its ready"); the colours lane re-solves light's field for the sea's colour-blind line (4.93 as
    drawn); the beach lane has nothing open.
- **2026-10-12 22:00Z: WHY LIGHT'S AND BEACH'S TRAILS LINGER IS FOUND (the trail composite runs two different laws), and dark's
  VEIL is built under their trails, ON BY DEFAULT (client only; PR #324 MERGED into dev as `719070b2`, 2026-10-12T23:14:37Z, from `claude/wind-trails-linger`, by the lead
  session on the owner's word; DECISIONS D-029, amended 22:45Z).** The owner, 21:13Z, to the lead, first-hand there and relayed: "merge the tail pr when its ready". The owner, 20:13Z, to the building session,
  first-hand, as it was building a default-off lever on the lead's brief: "levers to turn on new updates need to be on by default".
  The owner has not seen this build in the app; the lead filmed the veil beside dark for them (its note 7); no verdict is recorded here.
  - **The finding:** `SCREEN_FS` has two branches. Dark lays the trail buffer's colour at alpha `b x opacity`; light and beach,
    since rule 1 of dark's rules (D-020, "light only adds"), lay it at full brightness at alpha `b^2 x opacity`. As one family,
    `screen - g = p (b c - b^2 g) - q b (1 - b) g`: dark is `p = q = 0.505`, the glow branch `q = 0`. Dark carries a black veil
    under every fading tail and the glow branch none, so dark's pixels come back to the field and dip a little under it between
    streaks, and light's and beach's never went under and from 12 kn up never came back. Fitted from the screen and the trail
    buffer (`truth-run.js --law`): dark p 0.505, q 0.505; light and beach p 0.999, q 0.000; each to 0.3 to 0.45 of a level. The
    branch alone, swapped on the real engine, moves the behaviour both ways; the mark's ring, its level, the fade, the trail count
    and the ground's lightness move its size and never its sign.
  - **What draws:** `windTrailVeil.js`, one guarded line in `SCREEN_FS`: the glow branch's light unchanged plus dark's veil against
    the level a streak's core is laid at. No table, particle count, lifetime or fade moves; dark is untouched.
  - **Kill:** `window.__RAW_DISABLE_WIND_TRAIL_VEIL__ = true` (read each frame; `origin/dev`'s frames to the byte over the sea,
    90 of 90 at three crops in light and beach). Steer: `window.__RAW_WIND_TRAIL_VEIL__` (0 to 2, or `false`). It stands down
    under everything that stands the white streak down, D-022's kill, the land's depth kill and the opaque canvas's kill.
  - **Measured** (speed ramps, zoom 6, lossless crops at 1.5, against the field alone; dark / before / with the veil at 15.3 kn
    over the sea): a pixel's darkest moment -2.2 / +1.8 / -2.5 in light and -1.6 in beach; the share of the picture lit
    0.58 / 0.76 / 0.56 and 0.60; flicker 1.37 / 1.09 / 1.36. Light added against dark's, the sea, ten speeds: light 1.30-1.56
    times before, 0.85-1.33 now; beach 1.04-1.53, 0.87-1.18. A streak's bright body by the lead's gauge (`anatomy-run.js`): 1.3
    to 1.8 times dark's before, 0.96 to 1.26 now. Zooms 4 and 8 move the same way.
  - **What it costs:** light and beach have ONE ground depth (D-026), dark has two: over LAND from 6 to 18 kn their tails dip 0.4
    to 2.0 L* further than dark's do over its near-black land, and the streaks add 0.62 to 0.95 of dark's light there (about
    dark's before). Strength 1 sits on dark's sea, 0.5 on its land. A typical pixel's lightest moment falls 0.1 to 2.8 L* at 6
    to 9 kn (the highest tenth of cores 0.6 at most). It breaks rule 1 on purpose.
  - **The veil or the cut: CLOSED at 22:22Z.** The lead found the same cause the same hour and built another candidate (local
    `claude/proto-tail-cut`: the glow's alpha cut to zero at a fixed level, never under the field); its ten notes reached the
    building session only at 22:22Z. Its note 5 withdraws the cut: the veil at strength 1 is the build. Clips beside dark, on the
    merged tree: `frontend/scripts/wind-bench/out/videos/trail-veil-served.webm`, `-ramp`, `-strengths`, `-vs-cut` (not in the repo).
  - **What is left, each its own later change, all the lead's:** the near-calm bands (the owner, 21:51Z: "The almost still wind
    needs to be almost still and almost transparent on beach and light modes"); the sea's remainder (D-022's 0.55); the land's
    lightness with the streak's strength over it (the lead's land step merges AFTER this and is re-read with the veil on: on
    that lighter land the veil's dip over land is 0.2 to 0.9 L* deeper at 6 and 15 kn; the veil's level stays the sea's).
  - **The instrument, committed:** the wind bench's TRUTH mode (`truth.js`, `truth-run.js`; every pixel and frame against the
    same crop drawn with the field alone; the law's fit), one variable at a time on the real engine (`force-uniforms.js`), several
    crops of one frame and the trail buffer beside each (`motion-run.js --at`, `--trail`).
  - **Reviewed independently** (the veil and its kill held on a GPU and over 129,864 lever states; it found the commit red on
    four existing tests, two older kills the veil had to stand down under, and shader tests that pinned text: all fixed, the
    log). The whole frontend suite, the lint ratchet, the palette checker and the build pass on the merged tree.
  - **Not verified:** nothing seen in the app or by the owner; one seed, one view; no phone (the shader is `mediump`); the cut
    read on six crops only. **Owed:** the read-back on the deployed build once it merges (ledger seq 1142, due
    2026-10-19). Log `2026-10-12-wind-trails-linger`, LESSONS L-V76, L-V77.
- **2026-10-12 20:36Z: light and beach draw the wind's COASTLINE in the borders' ink, and the coastline survives a theme change, ON BY
  DEFAULT (client only; PR #323 MERGED into dev as e89aaa85, 2026-10-12T21:02:45Z, from `claude/wind-map-shows-through`; DECISIONS D-028).** The owner,
  19:05Z, on the deployed build: "I still cannot see the map as well through the wind animations on light or beach modes. Dark mode
  I can see the map underneath it, better."
  - **What draws:** `windBasemapMute.js` `windCoastInk`: while the borders are inked the layer `wind-coastline` takes the same ink
    with its opacity at 1. `WebGLWindLayer.js`: the style handler puts the stroke back when a theme change has dropped it.
  - **Kill:** `window.__RAW_DISABLE_WIND_COAST_INK__ = true` (read at the next sync; the stroke as the layer draws it, the borders
    still inked). Read-back `window.__WIND_COAST_INK__`. Dark, the field, the streaks and the land's depth do not move.
  - **Found on dev, and fixed here:** a theme change with the wind on left NO coastline in any theme until a reload (the library's
    diff drops it; the handler re-added it only with the wind layer): gone in 8 of 8 changes on the real library, there in 8 of 8 now.
  - **Measured:** the stroke against its ground under field + streaks, L\* at zooms 4 / 6 / 8 / 10: dark 17.1 / 24.5 / 23.9 / 21.1,
    light 31.8 / 39.1 / 32.2 / 28.4 (16.9 / 21.0 / 15.5 / 12.6 under the kill), beach 29.7 / 37.1 / 29.4 / 25.0 (11.8 / 14.9 /
    9.9 / 8.2). Under an equal wind dark keeps 0.52 of its own land-sea contrast and light and beach 0.14 and 0.23 (D-026's
    land): recorded, not changed.
  - **Not verified:** nothing seen in the app. The owner has seen clips beside dark and has not said "merge".
  - **Owed:** the read-back on the deployed build (ledger seq 1134, due 2026-10-19): the read-back in light, the stroke after a theme change, the owner's eye at zoom 4.
  - **Next, the owner's observation of 20:02Z** ("lighter moving air/wind in dark mode is almost transparent, or even smaller
    animations than in beach or light mode"): measured by speed (`anatomy-run.js`): light's and beach's bright streak bodies cover
    1.2 to 2.3 times dark's area and run 1.2 to 2.4 times as long; cores and width match. Cause: dark's trail composite reaches zero
    once the trail fades to the ground's level, the glow composite never does. A local prototype of dark's cut brings the bodies
    to 0.95 to 1.11 of dark's. The trails lane (`claude/wind-trails-linger`) builds it; no PR until the owner has picked.
  - **#322 MERGED** 2026-10-12T20:01:35Z as `a022b398` (beach's margin; the owner, 19:01Z: "take the margin and merge it").
- **2026-10-12 19:40Z: beach's wind field holds the colour-blind bar AS THE GPU DRAWS IT (the margin), ON BY DEFAULT (client only; PR
  #322 MERGED into dev as `a022b398`, 2026-10-12T20:01:35Z).** Owner, 2026-10-12 19:01Z, to the
  session leading the light and beach wind work, first-hand there and relayed to the building session: "take the margin and merge it" (DECISIONS D-025,
  its last amendment). They had seen the lead's clip of the option beside what dev drew.
  - **What draws:** `windBeachPath.js` `BEACH_PATH.field` with the margin's 58 rows at 4 to 46 and 48 to 62 kn; the bytes the lead
    filmed (`67bfe560` at a 50 kn maximum, `b0931ff3` at 75). No lever, no new switch; `WindColorRamp.js` is not touched. The streak
    rows, the white strength, the legend, light and dark do not move.
  - **Kill:** unchanged, `window.__RAW_DISABLE_WIND_BEACH_PATH__ = true` (beach before its path, byte for byte). There is no kill
    that returns #319's field alone; its rows are kept in `windBeachPath.test.js` as the control. Look key: `white+path|dark-rules`.
  - **Why:** the checker reads the TABLE; the engine draws an 8-bit, 256-texel TEXTURE of it, read by the GPU half a texel from
    the table's index (read back from a GPU: `scripts/wind-color/lut-lookup-gpu.cjs`). #319's field held the table's 5.0 with none
    to spare and read 4.64 to 5.0 as drawn.
  - **Measured:** as drawn, at 1401 maxima from 10 to 80 kn (land as drawn / sea / land before #320): **5.04 / 5.04 / 5.46** at
    the least, where #319's field read 4.67 / 4.64 / 4.89 and beach before its path 2.78 / 2.93. On the table 5.12 over the sea and
    5.15 over the land (5.05 and 5.02). `check.mjs --strict` exits 0; `check.mjs --theme beach --strict --as-uploaded 10-80:0.25`
    exits 0 (5.04 / 5.06 by coloraide). The lead's film (relayed): the two fields differ by 1.13 and 0.89 CIE76 a pixel on its two
    ramps (null 0.023), the ground 0.2 to 0.6 L* lighter at four crops, the streak numbers unchanged.
  - **What it costs:** no knot more than 1.2 dE00 from #319's field (10 kn; 6 kn 1.0); the 10 kn ground 0.7 L* lighter; the hue at
    6 kn 4.9 degrees toward the aqua; the legend's watch line at 16 kn over the sea 32.0 degrees (31.2). The margin is 0.04.
  - **The as-drawn line is NOT a gate:** `check.mjs --as-uploaded` is opt-in. By it light reads 4.85 over land and dark 4.97 on
    dev; the owner has not set a bar. A FINDING for the owner, not acted on: the engine reads its colour textures half a texel off
    the table's index in every theme (up to 0.16 kn of the ramp at an 80 kn maximum); one shader line would centre it, dark included.
  - **Not in it:** two capped solves made after the film (no knot more than 1.0 dE00 at the same bar, or 0.5 at a bar of 4.9), on
    the local branch `claude/wind-beach-path-margin-capped`: their own later choice.
  - **Not verified:** no frame taken by the building session; no pixel of the wind layer read from a GPU (the lookup law was; the
    composite and the canvas's rounding were not); nothing seen in the app. **Owed:** the live half of #319's read-back (`_lookKey`
    in a signed-in browser; ledger commitment, due 2026-10-19) and this change's own (a second commitment, same date). Log `2026-10-12-wind-beach-path`, LESSONS L-V69.
- **2026-10-12 14:20Z: LIGHT NEVER MATCHED ITS SAMPLES BECAUSE THE PAGE BEHIND THE MAP SHOWED THROUGH THE WIND. The wind now leaves
  the map's canvas opaque, ON BY DEFAULT (client only; PR #321 MERGED into dev as 720b3980, 2026-10-12T15:47:44Z; DECISIONS D-027).** The owner, 12:28Z,
  on the deployed build: "I still do not visually see the improvements yet"; 12:36Z: "This should work after all the agents
  worked on this." The owner did not name this change and has not seen it.
  - **The finding:** the map's canvas is premultiplied, so the screen shows `rgb + (1 - alpha) x page`. Two of the wind's passes
    blended the canvas's ALPHA by the colour's factors and left it at 0.61 / 0.69 (least / mean) in dark and 0.75 / 0.90 in light
    and beach. `MapPage.js` lays black behind dark AND beach and near white (gray-50) behind light. So only light showed the page:
    its streaks add 27.3 L* to the picture where dark's add 8.5 (against the field alone), a core reads L* 94 (paper white) where
    dark's reads 70.
  - **Why two days of work did not show:** the bench saved frames from the BARE canvas, never over the page: no sample of light's
    white streak was the picture the app drew (LESSONS L-V72). And a bare-canvas frame held min(channel, alpha): the brightest
    streak cores clipped darker in EVERY theme, so no saved-frame number before this change is exact, dark's bar included (the
    independent review). What beach lacks on the site is the open changes, none merged.
  - **What draws:** `blendIntoMap` (`windCanvasAlpha.js`) sets `blendFuncSeparate(src, dst, ZERO, ONE)` at the two passes bound to
    the map's framebuffer. No colour the wind writes changes. Kill: `window.__RAW_DISABLE_WIND_OPAQUE_CANVAS__ = true`.
  - **Measured, built** (Mobile Bay, wind x0.4, zoom 6, page and map at 1.5): the canvas's alpha 1 / 1 in three themes; frames
    against the kill's by hash, at the same run position: dark 90 of 90 the same bytes, beach 90 of 90, light 0 of 90; light's
    sea beside dark: light added 27.3 -> 12.3 L* (dark 8.5), a core's L* 94 -> 72 (dark 70). The independent review could not break
    the engine change; its behavioural test (every draw into the map, 20 lever sets) is in the suite.
  - **The cost:** over land in light air light's streaks add half the light they did (7.5 -> 3.8 L*); dark's add 3.3 there, so it is
    no shortfall against dark, and #321 does not have to merge with #320 (corrected: first written from the probe's lifts).
  - **Also found (L-V73), on corrected frames against the field alone, every open change, 6 to 39 kn:** a streak's core stands the
    same height over the field in all three themes over the sea; light ADDS 1.3 to 1.7 times the light dark does over the sea and
    beach 1.0 to 1.8 times, both 0.9 to 1.2 times over the deeper land, because their pixels do not come back to the field
    between streaks (dark's do, and dip a little under it). The probe's own lift read this backwards over land (0.15 to 0.55 where the light added is 1.1
    to 1.2), and that reading was D-026's stated reason. Not retuned: one visual variable at a time, after this is seen in the app.
  - **The bench now lays every saved frame over the app's page for the theme and prints the canvas's alpha** (`motion-run.js
    --behind`); compare two arms at the same run position (a theme's first run on a fresh map is not its second).
  - **The owner, 15:38Z: "merge #321 and #320 and take the re-solved F" and "and merge anything else needed as well".** #321 is on dev
    (`720b3980`) and #320 (`9061ad1d`). Next, in order: #315 then #319 (beach's sea 0.55; beach's F, re-solved for the deeper
    land), #318 (light's hue order). #317 (docs) was not named.
  - **Not verified:** nothing seen in the app; one view, one seed, zoom 6; phones; any page other than `MapPage.js` hosting the map.
- **2026-10-12 13:00Z: under the wind, light and beach draw the LAND AT THE SEA'S DEPTH, ON BY DEFAULT (client only; PR #320 MERGED into dev as 9061ad1d,
  2026-10-12T16:10:09Z).** The owner, 11:50Z, on a prototype shown moving beside dark: "merge #316 and go with F and the deeper
  land and open the pr" (DECISIONS D-026).
  - **THE OWNER'S VERDICT ON THE DEPLOYED BUILD, 12:28Z, first-hand:** "I just did a visual check for wind on beach and light
    modes, and I still do not visually see the improvements yet.... notate that". The dev site then served `74417b5a` (#314 and
    #316; read from its static files): NOT on it were #315 (beach's sea 0.55), #318 (light's hue order), the beach lane's F, or
    this change. No change to the wind's look has reached the site since #314. The owner then asked (12:36Z) for the amount and
    density of the animation and the colours' transparency by speed to be compared with dark's, and for the research to be read
    again.
  - **What that comparison found** (three speed ramps, 14 speeds from 1.8 to 45 kn, land and sea; LESSONS L-V70): over the SEA
    light is dark's equal in cover, flicker and lift at every speed (lift 0.93 to 1.13). **Over LAND under 10 kn light's streaks
    lift the picture 0.14 to 0.56 of what dark's do** (beach 0.27 to 1.00): most land, most days. Above 15 kn over land light
    flickers 1.1 to 1.2 times as hard as dark. **Light spends its whole lightness range by 10 kn and lays its strongest colour
    there** (C* 37 to 40 against dark's 19 to 23); dark builds to about 26 kn. Beach is twice as colourful as dark from 15 to 32
    kn and pale from 26 to 39.
  - **What draws:** the land's area colours take 0.81 (light) or 0.85 (beach) of their lightness inside the mute's plan
    (`WIND_BASEMAP_MUTE.landL`), the lines on the land are muted and deepened with it, and where the land is deep a streak over
    it is laid at the sea's strength. Kill `window.__RAW_DISABLE_WIND_LAND_DEPTH__ = true`; the mute's kill, dark and imagery
    leave the land alone.
  - **Measured, built** (lift against dark's, before -> built): light's land 0.14-0.61 -> 0.39-0.74 under 12 kn, beach's
    0.27-0.91 -> 0.55-1.03; the land's flicker above 15 kn 1.1-1.2 -> 0.8-0.9; land and sea one ground within 2 L*; the sea
    unchanged to the digit. Light's colour-blind line over land 5.6 -> 5.1 (floor 5.0): the reason the land is not deeper.
  - **Not solved by anything built or open:** the land in light air (still 0.39 to 0.66 of dark's under 9 kn in light), the pace
    of light's build-up, beach's colour from 15 to 32 kn. **Waiting on the owner:** the merges (#315, #318, this, the beach
    lane's F when it opens, #317 last), then their eye on the deployed build. **#316 MERGED** 2026-10-12T11:52:11Z as
    `74417b5a`. Log `2026-10-12-wind-land-depth`, LESSONS L-V70, L-V71.
  - **CORRECTED 2026-10-12 (after #321's review): the reason above was read from a gauge that does not compare themes.** As light
    ADDED over the field alone, on corrected frames, light's land streaks were never weaker than dark's: 1.1 to 1.55 times dark's
    without this change, 1.0 to 1.2 with it (beach 1.15 to 1.84, then 0.9 to 1.2). The owner's pick of the look stands; "the land
    was the largest gap in strength" does not (D-026's correction; this log's dated correction).
- **2026-10-12 12:33Z: beach's wind FIELD runs one way through its green band with its pale gale band under a ceiling (option F), ON BY
  DEFAULT (client only; PR #319 MERGED into dev as `11fb734d`, 2026-10-12T17:46:09Z).** Owner, 2026-10-12 11:50Z, to the session leading the light and
  beach wind work, relayed to the building session: "merge #316 and go with F and the deeper land and open the pr" (DECISIONS D-025;
  the building session was given no word of the owner's directly).
  - **What the check found:** beach's hue order already followed dark's logic and is kept. Its lightness ran both ways through the
    green band (10 kn its darkest band below 47 kn), its 27 to 40 kn band was as light as calm, and FOUR neighbouring pairs were
    under the colour-blind bar of 5 (16-21 kn 3.1, 27-33 kn 3.6, 47-55 and 63-75 kn 4.6 over the sea): the palette checker prints only
    the weakest and had been red on dev since D-020.
  - **What draws:** `windBeachPath.js` `BEACH_PATH.field`, 70 rows laid over the field dark's rules solve, wherever the white
    streak draws in beach. **Since 2026-10-12 15:38Z it is F RE-SOLVED for the deeper land of #320** (the owner, relayed by the lead:
    "merge #321 and #320 and take the re-solved F"): F's stops from 6 to 40 kn solved again with that land as the constraint, no
    knot more than 0.4 dE00 from F; the bytes the lead filmed (`e434f0bf` / `cbfec18a`). Nine of 13 Beaufort stops move; lightness
    never rises from calm to 21 kn nor from 33 to 75 kn; the gale band sits level (L* 49 over the land as drawn since #320 laid it
    at the sea's depth; L* 60 over the land before it); hues within 13.5 degrees over land, order kept. The streak rows, the white strength, the legend, light and dark do not move.
  - **Kill:** `window.__RAW_DISABLE_WIND_BEACH_PATH__ = true` (beach's field as before, byte for byte). #312's, #313's and #314's
    kills and every hold still draw what they drew. Read-back: the look key is `white+path|dark-rules` in beach.
  - **Measured (2026-10-12 17:10Z, with dev's #321, #320 and #315 merged into the branch: #320's deeper land is the default):** the
    palette checker exits 0 with beach's colour-blind lines at 5.0 over water and 5.0 over land (5.05 and 5.02), and at 5.0 / 5.3
    with `--before-depth` (the land before #320); before the path it reads 3.1 / 2.9 and 3.1 / 3.2. As drawn the ground from 6 to
    40 kn spans 12.9 L* over land and 12.9 over the sea (21.9 and 21.7 before; dark 7.4 and 7.2) and the gale band peaks at L* 49.0
    (59.7 before); over the land before #320 those read 15.4 (26.2) and 60.1 (72.9). Over the land the field reads in lightness as
    over the sea, within 0.5 L* at every Beaufort stop. **The before-to-now lifts "against
    dark's" first recorded here are WITHDRAWN** (bench frames under-read bright cores; log, the correction entries). On true frames,
    with every open wind change merged and the sea white at 0.55 (the lead's capture), beach's streaks on this field add 1.5 to 1.8
    times the light dark's add over the sea from 6 to 18 kn and 0.9 to 1.2 times over the deeper land. No before-and-after of this
    field alone exists on true frames.
  - **What it costs:** the 16 and 21 kn greens go grey-green (over the land as drawn C* 12 and 14 of 28 and 28, 6.8 to 8.0 L* deeper; over the
    land before #320, 14 and 17 of 34 and 33, 8.2 to 9.6 deeper): over the sea the
    field is about half as colourful as dark's from 12 to 21 kn, where it was more colourful; the gale band's lime and gold are
    deeper and duller; the 10 kn ground is 4.0 L* lighter (4.7 over the land before #320); a normal eye tells 6-10 and 10-16 kn apart about half as well. **As drawn it was UNDER the bar** (the table held 5.05 and 5.02 with none to spare): 4.64 to 5.0 by the GPU's own lookup of
    the texture, lowest when a storm is in view. The numbers first written here (4.79 to 5.01) were read at the table's index and
    are corrected in D-025's last amendment. **THE MARGIN (the entry at the top of Now) replaced this field's rows from 4 to 62 kn.** Over the sea the
    field at 16 kn sits 31.2 degrees off the unmoved legend's hue (a checker watch line, 1 kn wide).
  - **NOT in it:** the sea strength re-read on F's ground and the deeper land (both the lead session's; D-026); re-solving beach's
    streak rows; the options not taken (A, B, C, E, in the log). **Collides with #318** (light's order) in `WindColorRamp.js` at
    three places: the second to merge keeps both imports, both switches and both names in the look key.
  - **Not verified:** nothing of this build has been seen in the app. **Waiting on the owner:** the merge, then their eye.
    **Owed:** the read-back on the deployed build (ledger commitment, due 2026-10-19). Log `2026-10-12-wind-beach-path`, LESSONS
    L-V63 to L-V67.
- **2026-10-12 04:58Z: light's wind field runs dark's hue ORDER on two lightness levels, and its legend bar moves with it, ON BY DEFAULT
  (client only; PR #318 MERGED into dev as `b764797b`, 2026-10-12T18:17:56Z).** Owner, 2026-10-12 02:48Z: "you need to
  double check all this. The light and beach modes need to make sense logically. It could be the way it is, or it could not be";
  03:48Z, on three options after a first candidate filmed beside dark: "option 2, give the streaks their ground back"
  (DECISIONS D-024). Dev was brought in again at `11fb734d` (#321, #320, #315 and #319 are on it); this PR carries `pr_merge #319` (ledger seq
  1119). The as-uploaded pin is in `windLightPath.test.js` (the owner, 17:43Z: "option 1, merge as shown and add the pin").
  - **The check:** dark carries speed in the ORDER of its hues. Light ran it except at 10 kn (an orchid, dark's calm colour) and
    21 kn (a teal behind 16 kn's green, and lighter). Both were bought to avoid a cyan sea the basemap mute has since greyed.
    Beach's order is sound; its LIGHTNESS runs both ways and its colour-blind line is red since D-020 (its own session).
  - **What draws:** rows 1 to 32 kn of light's field and streak row are `LIGHT_PATH` (`windLightPath.js`); the legend bar's 3 to
    27 kn rows follow (`resolveLegendRamp`; the particle ramp does not move). Calm and 33 kn up are the rows before. Hue never
    turns back (four times before), lightness never rises, two levels (65 at 6 to 10 kn, 60 at 16 to 27 kn), hardest edge 7.9
    dE00 a knot (16.0). Beach and dark untouched.
  - **Kill:** `window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true` (light as before, byte for byte). Read-back: the look key is
    `white+path|dark-rules` in light. Every older kill and lever still stands it down.
  - **Measured:** palette checker, light: no red line; tint 5.1 over sea / 5.5 over land colour-blind (5.5 / 5.6), legend 11.7
    normal and 5.4 colour-blind (9.3 / 5.2); under the kill, dev's lines. In motion on a speed ramp (3 to 33 kn, zoom 6; page
    pixel ratio 1.5, the bench's map at 2), lift against dark's, before -> now: over the SEA 0.95 to 1.11 -> 0.96 to 1.06 (dark's
    at every speed); over LAND 10 kn 0.68 -> 0.52, 13 kn 0.78 -> 0.56, 16 kn 0.90 -> 0.77, every other speed within 0.04.
    **These lifts were read on frames the bench saved darker than the screen (the log's 15:13Z correction; the bench fix is
    PR #321's): the direction stands on the tables, the sizes are owed a re-read on the corrected bench.**
    **Corrected read against dark (the leading session's, 15:36Z, #321's bench, speed ramps, light added over the field
    alone): with these rows light adds 1.33 to 2.36 times what dark adds over the sea, 1.10 to 1.55 over the pale land, 1.01
    to 1.22 over #320's deep land: not behind dark at any speed read; the land "gap" was the gauge. Before against now in
    light is still unread on that bench (the log, 15:38Z).**
  - **What it costs:** 6 to 16 kn a third less colourful (still above dark's own field on screen); 10 kn 5.8 L* lighter; streaks
    over land fainter in 10 to 16 kn winds; the weakest normal-vision neighbours 8.0 (9.0); the floor's margin 5.1 (5.5).
  - **Stands down with:** every lever and kill that stands the white streak down, D-022's kill (it restores D-021's picture),
    and the Canvas2D fallback (its marks sample the particle ramp).
  - **FOUND, not fixed here (the leading session's change):** `mirror-model.mjs` and `check.mjs` lay DARK's field at alpha; the
    engine lays it at alpha squared. Every dark number read through them is about twice too strong; by the engine's law this
    model reads dark's own colour-blind line at 2.5 to 3.1, where the checker prints 5.2.
  - **Not verified:** nothing of this build has been seen in the app; the owner chose option 2 from its description and has not
    judged it moving; phones not measured. **Waiting on the owner:** their eye, then the merge. **2026-10-12 15:58Z, RELAYED by
    the leading session:** the owner's words to it, 15:38Z, "merge #321 and #320 and take the re-solved F" and "and merge
    anything else needed as well"; it reads them as covering #318 (not named in them) and merges it LAST, after #321, #320,
    #315 and #319, once this branch has dev merged in and `check.mjs --strict` on the merged tree holds light's colour-blind
    line at 5.0 over #320's land (the model read 5.01). **2026-10-12 17:43Z, the owner, first-hand: "option 1, merge as shown
    and add the pin":** the checker reads that line 5.006 on the tree dev will be after #319; AS UPLOADED (the 8-bit texture) it is
    under 5.0 at 151 of 281 maxima from 10 to 80 kn (least 4.859; dev's own light 21 of 281). #318 merges as filmed with that
    pinned in `windLightPath.test.js`; light's rows are re-solved on the deeper land NEXT (a ledger commitment). **Owed:** the read-back on the
    deployed build (ledger seq 1114, due 2026-10-19); the re-solve on the deeper land (ledger seq 1118, due 2026-10-19). Log `2026-10-12-wind-light-path`,
    LESSONS L-V52 to L-V54.
- **2026-10-12 03:50Z: under the wind, light and beach draw the map's BORDER LINES in dark ink, ON BY DEFAULT (client only; PR
  #316 OPEN against dev, the owner merges).** Owner, 2026-10-12 01:02Z, to the session that built #314 (its log): "The map below, I
  think the labels and borders need to be more visible. In dark mode they are white boarders and labels. So in beach and light
  mode, there maybe needs to be black borders and labels?" (DECISIONS D-023). The owner has not seen this build.
  - **The finding:** the borders and the place names are already drawn ABOVE the wind in all three themes; no streak cuts them
    (a pixel a glyph covers whole moves 0.00 to 0.27 L* under the wind, 23 to 98 with the wind forced on top). The fault was the
    lines' colour: light draws them pale lavender and beach mid grey, about a pale land's own lightness once the field is on it.
    A line's L* against the ground beside it, under field and particles, zooms 4 / 6 / 8: dark 11.9 / 20.9 / 28.5; light 7.6 /
    2.8 / 5.8; beach 4.0 / 4.7 / 3.0. The names are already near-black on a white halo and are not changed.
  - **What draws:** the three border lines above the wind (`admin-1-boundary`, `admin-0-boundary`, `admin-0-boundary-disputed`)
    take `rgba(27, 30, 45, 0.7)` (`WIND_BORDER_INK`, `windBasemapMute.js`): their `line-color` only, zoom interpolations kept;
    widths, opacities, dashes, casings and names are the style's own. It rides the basemap mute's own record: off exactly with
    the wind, on a theme change, with imagery showing under the wind, and with the mute's own kill. Dark never changes.
  - **A SECOND EFFECT, not asked for, found by the independent review and repaired here: after a theme change with the wind on,
    the new theme is now restyled.** With the handler dev has had since #299, when the new theme's style arrives after the
    layer's re-sync (a style fetched over the network; a cached one arrives first) the re-sync restyles the OLD style, the new
    style is diffed in over it, and the basemap stays UNMUTED until the wind is toggled, with `__WIND_BASEMAP_MUTE__` saying
    `applied`. Replayed on the real library and styles (`switch-run.js`; not observed in the app): dev's module and handler
    left the new theme unmuted in 3 of 3 changes in that order; the layer now syncs on every `style.load` (two lines in
    `WebGLWindLayer.js`) and ends restyled in 3 of 3, both orders. **So after this merges the ground under the wind is muted
    after a theme switch where it may not have been: the owner may see light and beach a little greyer after switching than
    they have been seeing them.** That is #299's own look, not a new one.
  - **Kill:** `window.__RAW_DISABLE_WIND_BORDER_INK__ = true`; lever `window.__RAW_WIND_BORDER_INK__` (a CSS colour). Both are
    read at the next sync (a wind toggle, a theme change, the next style change), not mid-frame. Read-back:
    `window.__WIND_BORDER_INK__` (`applied` true only with `layers` above 0, else `reason`).
  - **Measured (the real engine, the real basemaps, in motion, the page and the map at device pixel ratio 1.5; `border-run.js`):**
    light 39.9 / 36.5 / 35.0 and beach 38.9 / 34.4 / 31.6 at zooms 4 / 6 / 8: 1.1 to 3.4 times dark's line; 0.7 is the lightest
    of the three strengths measured. **Not above dark's everywhere (corrected 04:40Z, a grid over wind and zoom taken after
    the PR opened):** at zoom 9 beach reads 0.96 of dark's line (0.85 in near-calm air) and light 1.11 (0.95); the inked line
    itself holds 30 to 46 L* at every zoom and wind read, where dark's own runs from 12 to 42. The kill arm reads the numbers
    before, to the digit; 18 of 18 offline crops under the kill are `origin/dev`'s PNGs byte for byte, dark's 9 of 9. Map mode's own columns over every line, over land: `retP` 0.68 / 0.70 /
    0.66 to 1.05 / 0.76 / 0.73 (light), 0.62 / 0.68 / 0.63 to 1.07 / 0.74 / 0.67 (beach); dark's rows equal in both arms.
  - **New instruments:** `scripts/wind-bench/border-run.js` + `page/border-probe.js` (the borders and names alone, found from the
    style; it also reads the whole style's paint back from the library after the wind goes off: exact) and `switch-run.js` +
    `page/switch-probe.js` (the app's theme change, replayed). **Two limits of the older modes, found and NOT changed in them:** `map-run.js` never ran the app's restyle (the
    mute), so its light and beach numbers since 2026-10-09 are on an unmuted ground (`--app-sync` is new and opt-in); and the
    engine sizes a mark by the page's pixel ratio on a bench canvas that was always 2 (`motion-run.js --map-dpr` is new).
    **Measured since (04:50Z; commitment 1070 closed): neither moves a recorded verdict or a chosen number.** Without the mute,
    map mode's land rows stand and its SEA rows for light and beach sit on a sea 2 to 7 L* too light (the step 1 to 2 L* too
    small); with the canvas at 2 the lift against dark's is off by 0.00 to 0.03 over the sea in ordinary wind, up to 0.09 with
    the fixture scaled 2.3 times (a 60 kn median over this view's sea), 0.02 to 0.08 over land.
  - **The map, measured for every lane (`ground-run.js`, new):** dark's land is `hsl(214, 17%, 31%)` (rendered L* 29 at zoom
    6) and its sea [93, 117, 126] (L* 47.7): the sea is 18 L* LIGHTER than the land. After the mute light's land is L* 97.9 and
    its sea [174, 184, 189] (74.2); beach's 91.4 and [168, 180, 185] (72.5). The mute darkens the sea by 10.7 and 6.4 L* and
    leaves the land's lightness. Three models in the instruments do not match (dark's land in `check.mjs` / `mirror-model.mjs`
    is the bench's offline style; `windDarkRules.js` `BASE.dark`; light's water and beach's land): told to the lead, not changed.
  - **NOT in it, each the owner's call:** a bolder line (the styles draw these 0.5 to 0.75 px wide; width is a second variable);
    a strength that matches dark's instead of clearing it (by extrapolation below the three measured, near 0.26 / 0.43 / 0.62
    at zooms 4 / 6 / 8: no one number does); ink for the lesser labels (natural features, water names) and a tint a theme.
  - **Not verified:** nothing of this build has been seen in the app or by the owner; one view, one wind field, zooms 4 to 8;
    phones; the theme-change repair is read on the bench's replay of the app's sequence, not in the app. **Waiting on the
    owner:** the merge, then their eye. **Owed:** the read-back on the deployed build, by the PAINT and not only the read-back
    (ledger seq 1069, due 2026-10-19). Log `2026-10-12-wind-border-ink`, LESSONS L-V46 to L-V49 and L-V51 (L-V50 is
    #315's).
- **2026-10-12 03:10Z: beach's SEA strength for the white streak is 0.55, not 0.77 (client only; the owner's word; PR #315 MERGED into
  dev as `89f0dc33`, 2026-10-12T17:04:44Z).** After the read-back of #314 on the deployed build (`ec8f46a2`; light at 0.55 lifted the picture 1.04
  times as far as dark's over open sea at zoom 6, beach at 0.77 lifted it 1.37 times, in a field reaching 67 kn) the owner:
  "make the beach sea strength change to 0.55" (DECISIONS D-022, amended 2026-10-12).
  - **What draws:** `DARK_WHITE.beach.sea` 0.55 (`windDarkRules.js`). Nothing else: no table, key, shader or engine line; land,
    light and dark as before. Kill unchanged: `window.__RAW_DISABLE_WIND_DARK_WHITE__ = true`.
  - **Measured, and the finding (LESSONS L-V50): a strength is read ACROSS THE WIND'S SPEEDS.** The bench's fixture is a
    hurricane: its zoom 6 sea crop holds a 42 kn field, the one band (27 to 40 kn) where beach's own field is pale, and 0.77
    had been solved there. Swept (the crop's median 8 / 17 / 42 / 95 kn; zoom 6, the sea): beach at 0.55 reads 1.10 / 0.96 /
    0.80 / 1.07 of dark's lift (0.77: about 1.26 at 17 kn, 1.01 at 42, 1.38 at 95, the deployed read); light's 0.55 reads 1.11 /
    1.05 / 1.03 / 1.23. So 0.55 is dark's lift in everyday wind and short only in beach's pale band. Its cost per knot: at
    beach's 29 kn band a core stands 22.7 L* off its ground (31.5 at 0.77). Palette checker: the same two red lines as dev; two
    watch lines move.
  - **#314's read-back is done** (the mark program's `u_white` as built; the kill acts at once; the count of moving marks is the
    same in the three themes: 147,456 particles, the same share kept at each zoom), and four errors in D-022's record are
    corrected there (the read-back criterion, `--size 360`, the README's paths, two unreported watch lines).
  - **Not verified:** 0.55 has not been seen in the app. **Not built, the owner's calls:** a sea strength that follows the
    wind's speed (it would fit a breeze and a storm both); the `bindLandMask` guard the review named. **Owed:** the read-back of 0.55 on
    the deployed build and the owner's verdict (ledger seq 1095, due 2026-10-19); #314's read-back is closed (seq 1091 fulfils 1062).
  - **This session now LEADS the light/beach-mirror-dark work across three sub-sessions** (the owner, 2026-10-12 02:58Z: "lead
    those subtrees ... the map needs to be taken into account ... use the jacobian lens to help see everything as a whole"):
    border ink under the wind (branch `claude/wind-border-ink`, D-023, L-V46 to L-V49), light's colours on dark's hue path
    (`claude/wind-light-path`, D-024, L-V51 up), and a simplification pass (`claude/stoic-heisenberg-bbe771`). Each lane reports
    what it moves in the others' outputs on one grid: ground {land, sea} x wind {served, scaled 2.3} x zoom {4, 6, 9}.
    Log `2026-10-11-wind-dark-white` ("Beach's sea at 0.55").
    **What the whole-picture read found so far (LESSONS L-V60 to L-V62; log, "The lead"):** on a speed-ramp scene light's sea
    equals dark's lift at every speed read (13 to 51 kn: 0.93 to 1.05); beach's sea is short only from 26 to 38 kn, where its field is pale; the
    LAND is short in both because its ground is 25 to 35 L* paler than dark's (no white can fix that: the map's own term);
    the land mask's coarse edge shows as a pale halo offshore; and `check.mjs` / `mirror-model.mjs` model dark's field at its
    alpha where the engine lays it at the alpha squared (not yet fixed). A local preview of all lanes combined
    (`claude/mirror-integ-preview`, never pushed) was shown to the owner in motion.
- **2026-10-12 01:05Z: light and beach lay the white streak BY THE GROUND under it, ON BY DEFAULT (client only; PR #314 MERGED
  2026-10-12T01:48:08Z as `ec8f46a2`).** Owner, 2026-10-11 23:23Z to 23:45Z, on the deployed build of #313: "I
  dont see the wind for light mode or beach mode mirroring the dark mode"; "close up zoom ... looks somewhat okay ... Its when you
  start zooming out that the contrast in theme modes happens"; "light could use a lot of improvement, and beach can use
  improvement, just a little milder. you should be able to mathmatically determine" (DECISIONS D-022).
  - **The finding:** dark's map is light's and beach's turned over (a near-black land and a slate sea; theirs a pale land and a
    deep sea), and #313 laid the white at one strength on both grounds. Measured as LIFT (how far the streaks raise the picture
    above its ground) against dark's, land and sea apart: 0.30 to 0.93 over land (no room above a pale land) and 1.06 to 1.64 over
    the sea, where the cores went near paper white and buried the colour field. A zoomed-out surf map is mostly sea.
  - **What draws:** full strength over land; over the sea 0.55 of it in light and 0.77 in beach (`DARK_WHITE`,
    `windDarkRules.js`), the strength at which the sea's lift equals dark's (median of zooms 4, 6, 9). The mark shader's existing
    land-mask sample scales the mark's light. No table, mark model or look key moves. Dark never changes.
  - **Kill:** `window.__RAW_DISABLE_WIND_DARK_WHITE__ = true` (full strength on both grounds, #313's picture; acts at once).
    #312's and #313's kills and every hold still win.
  - **Measured (the real engine, the real basemaps, device pixel ratio 1.5, in motion; `motion-run.js` + `mirror-run.js`):** over
    the sea, lift against dark's at zooms 6 / 4 / 9: light 1.03 / 1.22 / 1.07 (1.62 / 1.53 / 1.64 before), beach 1.01 / 1.34 /
    0.91 (1.23 / 1.46 / 1.06). Over land, the numbers before. Under the kill 27 of 27 offline crops are `origin/dev`'s PNGs byte
    for byte; dark's too with no lever. Palette checker: the same two red lines as dev (beach's colour-blind lines), nothing new.
  - **New instruments:** `scripts/wind-bench/page/mirror-probe.js` (one probe for the deployed app's canvas and the bench's
    frames), `motion-run.js`, `compose-video.js`, `mirror-run.js`; `scripts/wind-color/mirror-model.mjs`.
  - **NOT in it, each the owner's call:** light's colours (its hue turns back four times along speed where dark's sweeps one
    way; a prototype on dark's path was shown live and side by side, and costs the colour-blind floor and the legend as first
    solved; a solve that holds the floor is on the branch `claude/wind-dark-path-wip`); beach's 8 to 14 kn dark band (its
    colour-blind separation); the land (white cannot lift a pale land further); dark ink for the borders under the wind (the
    light style draws state and country lines in pale lavender; the owner asked at 01:02Z, shown live in their tab at about 01:04Z,
    not built).
  - **Not verified:** nothing of this build has been seen in the app; zoom 4 over the sea still reads 1.2 to 1.3 of dark's lift.
    **Waiting on the owner:** their eye (merged 2026-10-12T01:48:08Z). **Owed:** the read-back on the deployed build (ledger seq
    1062, due 2026-10-19). Log `2026-10-11-wind-dark-white`, LESSONS L-V43 to L-V45.
- **2026-10-11 21:08Z: light and beach draw dark's own WHITE streak, ON BY DEFAULT (client only; PR #313 MERGED 2026-10-11T23:14:33Z as `0173f365`; the owner's verdict on it is in, see the entry above).** Owner, 20:09Z, after watching dark, the deployed light and beach and two candidates each side by side in motion:
  "middle row for both, build it" (DECISIONS D-021). It replaces the LOOK of #312, which the owner rejected at 18:29Z ("beach mode
  isn't right. Nor is light mode. But dark mode is good. Its the model to use"); #312's switch, kill and hold lists stand.
  - **The finding it rests on:** a dark streak is not coloured. The mark shader draws a small colour core under a white ring at
    92%, laid at half strength: white light over a colour field, and the field shows through. #312 and the two attempts before it
    gave light's and beach's streaks a colour of their own.
  - **What draws:** where dark's rules draw, the streak takes dark's ring (`WHITE_STREAK`, `windDarkRules.js`: ring 1). Beach keeps
    its tables. Light draws the deeper field of its A/B (`LIGHT_LOOK_FIELD.deep`) and that field's one streak row. Three source
    files, about 20 lines; the engine and shaders are untouched. Dark never changes.
  - **Kill:** `window.__RAW_DISABLE_WIND_WHITE_STREAK__ = true` (both themes as dev drew at `86306199`). #312's kill and every
    older kill and lever still stand the whole thing down. Read-back: `window.__WIND_ENGINE__._lookKey` is `white|dark-rules` in
    light and beach, `|dark-rules` under this kill, `|` in dark.
  - **It is the arm the owner watched:** the default's tables hash the same as dev's code through the watched levers (captured
    before the default moved); on the bench's fixed basemap 108 of 108 crops are the same PNG; an independent review compared dev's
    source over 959,664 lever cases with 0 mismatches under the kill.
  - **Measured** (GPU map bench, real Mapbox basemaps, streaks over the field under them, land, z4 / z6 / z8 / z10): light +15.5 /
    +13.0 / +8.5 / +8.5 L*, beach +17.0 / +15.0 / +9.5 / +8.0, dark +14.5 / +13.0 / +10.5 / +9.5. Streak chroma against the field's:
    beach 1.05-1.14, light 0.67-0.96, dark 1.02-1.10 (under the kill 1.3 to 2.2). The map's lines kept over land at z6: light 0.68
    (0.59 under the kill), beach 0.66, dark 0.65. Colour-blind floor: light back above 5 (5.6 land, 5.5 water).
  - **Costs, said plainly:** by the bench's wash bar (71) both themes read wash over land at z4 (light ends at 72.6, beach 71.8) and
    light sits on it at z6 at storm strength (71.3): the owner picked from z10 and z6 at served strength. Beach's ground over land
    at 26-39 kn is held pale (L* 65-73) and shows as a cream ring at storm strength; light dims that band instead. Beach's
    colour-blind floor is unchanged, under 5 (3.2 / 3.1). A streak no longer carries a speed colour of its own.
  - **Not built, each the owner's call:** each theme's palette under this look; beach's gale band; removing the land and sea streak
    rows, the land mask and the streak solver, which now do little (light binds the mask for two equal rows).
    **Measured 2026-10-12 03:20Z, corrected 03:55Z after an independent review (log `2026-10-12-wind-streak-rows`): none of the
    three is idle.** The land mask is what D-022 lays the white by (#314). The streak solver makes beach's rows. And beach's two
    rows are not one row twice: a row carries the mark's alpha as well as its colour, and the sea row's is lower (ONE stamp of a
    mark is laid 17 to 23% weaker than the land row's at the everyday winds; less where stamps overlap). One row instead of two,
    at the default: the LAND row everywhere moves 29 to 67% of the sea's pixels by more than dE00 2.3 on the offline bench (zooms
    4 to 8, served) and, in motion on the real basemaps, turns a storm's 25-36 kn band over the sea into a pale ring (the
    time-mean picture 3.4 to 3.5 L* lighter with 30% less chroma, over 1.4 to 2.7% of the frame at zooms 5 and 6); the SEA row
    everywhere is the smaller change (6 to 28% of the land's pixels on the bench; in motion the time-mean picture stays within
    1.3 L* over 99% of the frame, served) and dims the land's streaks. Light already draws one row. **Nothing was removed and
    nothing built:** with the mask and the solver both needed, one row would delete a table row and one shader line.
    "Served" names the bench's fixture, not an everyday wind: a hurricane, 23 to 42 kn over the sea at zooms 6 to 10 and 7 to
    20 kn over land. LESSONS L-P35.
  - **Seen in the app 2026-10-11 23:36Z** (this entry said "nothing has been seen in the app" until then): on the deployed build
    `_lookKey` is `white|dark-rules` and the land mask `ready`; the owner's verdict is quoted in the entry above. Ledger
    commitment 1056 is closed by the line that fulfils it. Log
    `2026-10-11-wind-pale-band`, LESSONS L-V39 to L-V42, L-P33, L-P34.
- **2026-10-11 15:57Z: light and beach draw dark's rules, ON BY DEFAULT (client only; PR #312 MERGED 2026-10-11T17:27:44Z as `86306199`; its LOOK was rejected by the owner at 18:29Z and is replaced by #313 above).** Owner: "build
  the five rules into the app behind a lever, I want to see the changes done, not start with them off ... Then if we dont like them,
  we turn them off" (DECISIONS D-020, which overrides the default-off rule for this change; no served number moves).
  - **What draws:** dark's streak method; a field dimmed by one dusk factor; orange and yellow grounds not dimmed; streak rows of their
    own over land and over sea, picked by a land mask (`windLandMask.js`, the app's Natural Earth land); a colour floor. A theme draws
    them whole or not at all: an explicit light look, the ink and glow levers and the neutral-body lever each hold their theme.
    **Every older kill keeps its meaning:** any of 21 older palette, composite or ground kills (and 5 bench levers), set, stands
    dark's rules down for the session and draws what it drew before (`DARK_RULES_HOLDS`; D-020, amended).
  - **Kill:** `window.__RAW_DISABLE_WIND_DARK_RULES__ = true` (both themes byte for byte as before; on the GPU every bench metric
    equals dev's engine). Narrow: `window.__RAW_WIND_DARK_RULES__` = `true` | `false` | `'light'` | `'beach'`.
    Read-back: `window.__WIND_ENGINE__._lookKey` ends with `|dark-rules`; `window.__WIND_LAND_MASK__.status` is `ready`.
  - **Measured** (offline map bench, land, z4 / z6 / z8): step +16.0 / +13.5 / +8.0 (light) and +18.0 / +15.5 / +8.5 (beach), against
    dark's +18.5 / +17.0 / +12.5 and +6 to +7 before; every streak pixel lighter than its ground; no surface reads wash (three did).
    On the REAL Mapbox basemaps (same bench, the app's land file): step over land 97% / 88% / 67% of dark's for light and 100% / 96% /
    71% for beach (34-35% and 17-27% before at z4-z6), every streak pixel lighter, no wash.
    3-seed scanner (run again with no land file served, after an independent review): no shape the engine before lacks (8 recurring
    against 5, each at a place an arm before has it).
  - **Costs, said plainly:** the colour-blind floor of 5 does NOT hold as drawn (`check.mjs --strict` exits 1: light 4.9 over land and
    3.9 over water, beach 3.2 and 3.1; 5.1 to 5.3 before); the map's lines keep less over land (real basemaps, z6: light 0.59 against
    0.69, beach 0.65 against 0.74; dark's own 0.65); a pale band over land at 26-30 kn (the guard keeps that ground light, the streak stops at the colour floor).
  - **Changed from the lab's solver** (rulings, each with a control in `windDarkRules.test.js`): the solver reads the hue path (the
    port had brought the 13 kn grey back); the guard reaches 4 kn outward along speed (the lab's hand-over stepped light's ground
    18.6 L* in one knot; now 4.4); calm keeps its tint.
  - **Independent review:** the kill and dark sound on every path it computed; three defects fixed (the eye and ladder benches on the
    two-row table; the bench's land file leaking between runs; older kills drawing a mix), four risks acted on (the mask retries).
  - **Read back on the deployed build 2026-10-11 17:36-17:40Z** (reported by the session that built it; build `86306199`, one map
    load): the look key, the land mask and the kill behave as written. **The owner's verdict, first-hand, 18:29Z: not right in beach
    or light; dark is the model.** Not turned off: replaced by #313. Ledger seq 1047 is closed on that. Log
    `2026-10-11-dark-rules-default`, LESSONS L-V34 to L-V38.
- **2026-10-11 06:10Z: dark's rules restated for any ground (docs and a model lab on #311's branch; NO app change).** Owner:
  "we need the light mode and beach mode's wind animations to follow the same rules as dark mode". Five clauses:
  1. Use the ground-independent composite: #311's streak method. Dark's own formula darkens any lighter ground.
  2. Make room with one dusk factor, not a ceiling per band.
  3. Hold orange and yellow grounds light: dimmed on a pale page they read brown and olive.
  4. Solve land and sea separately.
  5. Keep a colour floor (C* 25).

  In the Ground Truth lab, light and beach then read 98-100% of streak pixels lighter, at +8 (land) and +14.5 to +17.3 (sea) L*,
  with no wash. Colour-blind floor: beach 3.65 (today 3.46); light 4.60 land / 3.50 sea (today 4.84 / 4.83).
  **It flags #311's A deep: olive at 33 kn and brown at 40 kn over land.** FINDING
  `docs/research/FINDING-2026-10-11-dark-s-rules-on-any-ground.md`, LESSONS L-V30 to L-V33, lab source `frontend/scripts/wind-lab/`.
  **Answered 2026-10-11:** built, ON by default (the entry above; D-020). Log `2026-10-10-light-look-ab` ("Hand-off").
- **2026-10-10 22:18Z: light's own wind look, an A/B, DEFAULT OFF (client only; #311 MERGED 2026-10-11 14:31Z, dev 432b0135).** What light lacks to carry dark's
  look is the GROUND (dark's streaks brighten a dark ground; light's is near white). One lever, light only:
  `window.__RAW_WIND_LIGHT_LOOK__` = `'moderate'` | `'deep'` (A: a deeper field solved from the composite wanted, then dark's streak
  method) | `'ink'` (B: ink with its own 27-47 kn colours and a cover cap); `?windLook=` on a phone; kill
  `__RAW_DISABLE_WIND_LIGHT_LOOK__`. A re-scopes D-018's dark-parity bar at 6-21 kn (**the owner's call**). Beach: dark's streak
  method already has room on its ground (measured in the log); its line is in the A/B. New instruments: map mode `--offline` (no
  token) and the wash columns (`style.js`). **Recommended: A deep** (inside dark's step at z4-z6 and at storm strength, never washes;
  moderate washes at z4 and in a storm; B's sea goes flat olive and it fails the 3-seed scanner, 22 shapes in 8 of 13 views; A adds
  no shape the engine lacks; **caveat 2026-10-11: its 33 kn ground is olive and its 40 kn ground brown over land**, see the entry
  above). A/B page: https://claude.ai/artifact/QtM5WrEghrV4Xr126Mq4vE. **Superseded 2026-10-11:** the owner chose dark's rules
  for the default (D-020, the entry at the top). The looks stay levers, and an explicit look holds light. Ledger seq 1042 (the
  pick) is closed as superseded, not as met. Log `2026-10-10-light-look-ab`.
- **2026-10-10 20:30Z: light AND beach are OFF glow (light washed out live; the owner then took beach off too; client only; PR #310 MERGED 2026-10-10 20:33Z, dev e0af8880).**
  Owner, from the app after #309: "Beach mode look a lot better, but light mode washes out from the glow." `WIND_GLOW.themes`
  is `[]`; both themes draw the marks before glow; the hue path and the clear calm stay in both. **Open:** dark's look
  rebuilt per theme with its own ground and colours (a cloud session started 20:27Z; default off; the owner's A/B).
  DECISIONS D-019 (amended), LESSONS L-V28, log `2026-10-10-dark-style-light-beach` ("20:23Z").
- **2026-10-10 19:45Z: glow is the default wind mark in light and beach; the grey veil and the bare calm are gone (client only; #309 MERGED 2026-10-10 20:09Z, dev c06a8e3d; light came off glow the same day, see above).**
  Owner: "I like glow better"; "the light wind color also looks like fog visually, a lot, in light mode"; "hard lines in
  between very light winds and other wind fields". Measured: light's field between its 10 kn violet and 16 kn green ran
  through grey (C* 1.0 at 13 kn over land), and calm drew the bare greyed map. Fixed: a ramp segment that would lose its
  colour is walked round the hue wheel (`huePathStops`; light's 10-16 kn only; field, streaks and legend bar), and calm
  is a pale tint (light rose, beach seafoam). Beach's streaks carry no white (1.15-1.43x the field's chroma, one
  polarity). 3-seed scanner: no shape the marks before glow lack. Kills: `__RAW_DISABLE_WIND_GLOW__`,
  `__RAW_DISABLE_WIND_CALM_CLEAR__`, `__RAW_DISABLE_WIND_HUE_PATH__`. **Open, the owner's:** light's 3-10 kn lilac is as
  vivid as its lightness allows and still pale (deeper field, another hue, or as is). **Owed:** the look in the app
  (commitments 1027 and 1034). Log `2026-10-10-dark-style-light-beach` ("18:37Z on"), LESSONS L-V27.
- **2026-10-10 16:37Z: dark's wind look for light and beach: measured, two candidates built, DEFAULT OFF (client only; #308 MERGED 2026-10-10 19:17Z, dev 55fca955; the owner picked GLOW 18:37Z, see the entry above).**
  Owner: "I like the way dark theme does the animations of the wind ... light and beach [should] reflect similarly of
  this style, but with their own color schemes".
  - **What dark's look is** (new bench columns, `style.js`): every streak pixel is lighter than the colour under it
    (+9.5 to +14.5 L*) and keeps its colour. Light and beach today: a mix of lighter and darker at +2.5 to +5.5, paler
    than the field (a black rim, a white ring and a dark core cancel).
  - **Glow** (`__RAW_WIND_GLOW__`): dark's own pipeline on the light map; the tint under the marks leaves the room.
    One polarity, colour kept, the map's lines survive better than today. Signal against dark on land: light
    71 / 60 / 54 / 81%, beach 80 / 92 / 90 / 81% (z4/6/8/10).
  - **Ink** (`__RAW_WIND_INK__`): the mirror (ink on paper, multiplied in). Land 96 / 107 / 105 / 113% (light), most
    colourful; fails over warm-band water at wide zoom (olive brown) and darkens storm water.
  - **Owner's call:** today, glow or ink, per theme, from the A/B page (https://claude.ai/artifact/8LihWH7nhRsnFjJifr9WRK) and the lab
    (https://claude.ai/artifact/7FMWEapCfMSd8XjqQLMgpm). My recommendation: glow for both. Owed before a default: the 3-seed scanner.
    Log `log/2026-10-10-dark-style-light-beach.md`; LESSONS L-V26.

- **2026-10-10 14:40Z: light's wind field from 6 kn up is A, steady descent (client only; #307 MERGED 2026-10-10 18:49Z, dev 90849fe9).** Owner,
  after the A/B of three redesigns (#304): "I like A too" (D-018).
  - **The change.** A's rows are light's default field; `__RAW_DISABLE_WIND_LIGHT_FASTBAND__` restores the field before
    it; each older light-field kill steps back past A first. The A/B lever and candidates B and C are gone.
  - **What it buys.** Every neighbouring tint on the muted ground is at least 5 dE2000 apart for colour-blind viewers
    (5.22 water, 5.26 land; 2.58 and 2.59 before). The palette checker's colour-blind RED lines for light: 1 -> 0.
  - **What it costs.** Light's 27-75 kn field is stronger than dark's (x1.83 at 75 kn): dark parity is re-scoped for
    those bands only. On the real basemap the map's lines keep their contrast at everyday strength (within 0.7 of a
    point); at storm strength they lose up to 1.3 points on land and up to 7.4 over water.
  - **Tests first:** pins generated from the running code, watched fail, then the rows moved; seven deliberate breaks
    each turn a pin red. Jest map + `src/tests` 298 suites / 3786 tests.
  - **Still owed:** the owner's look in light theme after the deploy; the deployed reads for #306 and #299 (seq 1018).
    Log `log/2026-10-10-light-fastband-a-default.md`; LESSONS L-V25.

- **2026-10-10 05:3xZ: the wind's trails are anchored to the map (client only; merged as #306, 9eccf149, 14:15Z).** Owner: "study all
  of our sub work tree work, then ... work forward on making this state of the art".
  - **The defect.** The trail buffer lived on the screen: a pan smeared every trail along the drag, a zoom along rays
    from the focal point, so the wind's direction was unreadable while the map moved.
  - **The fix** (`windTrailAnchor.js`): the buffer keeps its own camera. A pan moves the ink by whole pixels (exact);
    a zoom is looked at through the buffer and re-laid only past 1.2x, on a zoom-out (1.15x wider, feathered) or at
    rest; a turn or tilt goes through the ground-plane homography; the date line is read in the nearest copy of the
    world; a still camera is the identity. Kill `__RAW_DISABLE_WIND_TRAIL_ANCHOR__` (dev's engine bit for bit: 232 of 232 trail buffers);
    read-back `__WIND_TRAIL_ANCHOR__`. No served number moves.
  - **Evidence** (wind bench flow mode, `path-run.js --flow`: share of trail ink running along the served wind while
    the camera moves, screen buffer -> anchored, ranges over the three themes): pan 0.59-0.62 -> 0.73-0.78, fling 0.51-0.55 -> 0.62-0.71, zoom in 0.54-0.63 -> 0.70-0.77, zoom out 0.53-0.63 -> 0.75-0.77, pinch 0.57-0.60 -> 0.71-0.78, turn 0.52-0.53 -> 0.69-0.70, date line 0.52-0.53 -> 0.68-0.71, erratic 0.52-0.67 -> 0.65-0.85, jitter 0.57-0.62 -> 0.61-0.67. At rest pan 0.76-0.80, turn 0.76-0.80.
    Null control 258 of 258 trail buffers identical at rest; dev's engine fails the gate; no path clears the
    buffer.
  - **Reviewed before the push** (an independent read of the diff): the date line cleared the trails, a zoom wobble
    re-laid the ink every frame, the kill switch was not exact off desktop. All three fixed, tested and benched.
  - **Limits:** fresh ground has no trail history (the fling's remaining gap); jitter barely gains; at z14 and beyond a
    new mark can land a fraction of a pixel from its carried ink (the 32-bit mark matrix); not yet seen in the app.
    **Bench:** its seeded runs no longer depend on the run before (the engine's random stream is its own).
  - **Side sessions read first:** #300-#304 all on dev by 04:40Z (#301-#304 merged by the light fast-band session,
    #302-#304 with two slow lanes pending: its read-back is in #305, merged 14:02Z).
  - **Next, measured, not built:** curves between grid points (the 0.5 deg eye is drawn 1.7-2.2x its true area with
    straight lines, 1.0-1.3x with curves), on #302's ladder bench, for the owner's A/B. Still owed: the deployed read of
    #299 (`__WIND_BASEMAP_MUTE__.layers`). Log `log/2026-10-10-wind-trail-anchor.md`; LESSONS L-V24.

- **2026-10-10 04:3xZ: three light fast-band redesigns reach the colour-blind floor, DEFAULT OFF (client only; merged as #304, 541117de; the owner picked A on 2026-10-10 and the lever is gone: see the top entry).**
  - **The finding.** With the basemap muted, the whole 6-75 kn light field tint ramp sat under 5 dE2000 for some colour-blind
    viewer (weakest 2.58), not only the fast bands. A stripe-free redesign exists; only the dark-parity strength pin for 27-75 kn
    has to give (about 1 dE of floor per 7 dE76).
  - **The levers.** `window.__RAW_WIND_LIGHT_FASTBAND__ = 'a' | 'b' | 'c'` (read at the next ramp build; unset is today's ramp).
    A steady descent (5.22 water / 5.26 land, strength to x1.83 dark, one gate re-scoped), B blue-violet end (5.22 / 5.27, three
    gates), C gentle (5.01 / 5.10, strength to x1.51, one gate). Legend, particles, beach and dark untouched.
  - **Merged with #301-#303 as one ledger chain** (squashes 3c607174, 04a437a6, 5a3ecb68, 541117de; #302-#304 at the owner's "merge anyway" with some CI lanes still pending: a read-back commitment is in the ledger).
  - **Owner's call:** pick A, B, C or none from the A/B page (https://claude.ai/artifact/S3Tw5rDU1oVF8ArDf4YKrW). Log
    `log/2026-10-09-light-fastband-cvd.md`; LESSONS L-V23.

- **2026-10-10 02:5xZ: the wind server amplifier is measured and a dark fix is built (PR #303, `WIND_BG_BUILD_BOUNDED`,
  default OFF; the owner flips it).** Offline replay (real `ViewportService` + normalizer + bg helper, mock 16-day
  upstream, app heap, collections run for real; nothing replayed live). The cost per background hour was a FULL
  `gc.collect()` on the event loop (163 of 201 profiled seconds; 0.42-0.58 s each with the app imported, 0.047 s bare:
  it walks the whole heap), not the physics, and ~337 of a box's 385 hours were never asked for, so a cold 48-frame page
  lost its tail by construction (27 of 48 frames). A second amplifier: the next box's cancel fails the hours its own
  waiters wait on, they self-heal and cancel the NEW box's task (19 cancels, 20 fetches for two boxes).
  - **Fix (wind only, flag off):** waited-for hours + a +-6 h window, a 3 s linger, young-generation GC, a new box no
    longer cancels a task that has a waiter. Per fresh box that rests: 385 -> 54 hours, 211 -> 2.5 CPU-s, 27 -> 48
    frames; 6-view pan 595 -> 324 hours, 23 -> 0 cancels, 362 -> 14.7 CPU-s. No served number moves (vectors pinned
    equal); unbuilt hours resolve on demand. Peak RSS of a 385-hour build 262 / 261 / 262 MB with no / young / full
    per-hour collections. 17 tests, 12 mutations red. Log `log/2026-10-10-wind-bg-build-bounded.md`; LESSONS L-P31;
    ledger 991-994.
  - **What flipping it costs:** scrubbing a rested view to an hour outside the window is a cache miss (provider cache
    inside 5 minutes, else one fresh fetch). Read-back owed after a flip (commitment 993, due 2026-10-24).
  - **Still open, owner's call:** `/grid` and the series lane send DIFFERENT boxes for one pan (two 16-day fetches);
    sharing the box can flip the 0.5/1 degree step (area 100 deg2), so it ships dark (ledger 992). Next hotspot: the
    dynamic index rewrites its file on every `add_product`.

- **2026-10-10 01:47Z: the hurricane eye holds through a zoom-out: a coarser covering box no longer replaces the finer one
  (client only, on; PR #302 to dev). The first zoom-in still needs the server (design for the owner, not built).**
  - **Measured** (wind bench ladder mode: the real engine, the z5.5 -> z9 -> z5.5 replay with the client's request box
    and cache rule and the server's tier rule mirrored and pinned to their sources). On `dev`, zooming out redrew the eye
    at each tier: 0.25 -> 0.5 deg area x1.71; 0.5 -> 1 deg 21.4 km, wall -12 kn, area x2.94. The tiers agree at shared
    nodes (0.009 kn), so the cause is the lattice alone.
  - **Fix.** `windTierMosaic.js`: the engine files the coarser box AROUND the finer nodes it overlaps, on the finer
    lattice (one texture, no shader change, no request added, no served number moves). Every stop out: 0.1 km, 0 kn, x1;
    the drawn field is closer to the truth than before at every stop (worst 0.88 kn against 1.77). Kill
    `__RAW_DISABLE_WIND_TIER_MOSAIC__`; console `window.__WIND_TIER_MOSAIC__`.
  - **Options rejected on the same instrument:** keep the finest and let the base draw the rest (holds the eye, 9.6% of
    the view 10 kn or more off against 0.9%); a third texture level (the same picture as the mosaic, three shaders);
    area-mean tiers (35 km off, area x16).
  - **Open, the owner's decision:** the FIRST zoom-in on a storm still changes the eye twice (1 -> 0.5 deg: 21.4 km,
    +12 kn; 0.5 -> 0.25 deg: area x0.58). Only the server can remove it. Recommended design: 0.25-deg storm tiles cut at
    ingest from the GFS field the regional pass already downloads (0 Open-Meteo calls, 0 CPU on the Render box at
    ingest), served dark. Serving every box at 0.25 deg costs x5.5 location-calls (62% of the daily quota for one
    ladder). Log `log/2026-10-10-wind-eye-zoom-ladder.md`; LESSONS L-V22.
  - **Three defects in the first build, fixed before the push** (ledger 994): the merge rule compared `run_time` (a
    per-box ingest stamp: inert in the app); the never-downgrade rule was lost over a mosaic; "same valid time" was the
    asked hour, not the served frame. Fine nodes are never kept inside a box built more than 30 minutes after them.
  - **Not yet seen in the app** (the bench is the engine, not MapLibre). Live read-back owed after the merge (ledger 996).

- **2026-10-10 01:5xZ: a small wind pan re-requested the whole 14-day timeline and the box read /api/health at 10-13 s
  (client fix built; PR #300 to dev).** Render request log, 00:04-00:07Z, one client: every settled pan sent a mini plus two
  48-frame pages (hours 0..141 and 144..285) for a fresh unsnapped box, ~20 s of the 1-CPU box each, and nothing
  cancelled the previous pan's work (the warm effect's one `AbortController` was only aborted on a model change).
  - **Server amplifier (NOT fixed):** for wind GFS every fresh box starts a 16-day upstream fetch and a serial
    background build of all its hours, in ONE slot per model/domain that the next box cancels (`Canceling stale
    background task for gfs_wind`, 5 times in 6 minutes). A cold 48-frame page needs ~24 s against a 20 s deadline, so
    its tail times out by construction. Bounding that build is the larger follow-up; `/grid` and the series lane also
    send DIFFERENT boxes for one pan (a second fetch), which can flip the 0.5°/1° resolution step, so it ships dark.
  - **Fix (client only, on):** the latest regional view owns the series work (`windSeriesWarm.js`, sharing marine's
    intent factory), and the adjacent page waits for a 30 s rest. Scrub start still loads every page (the 14-day
    scrubber is not capped); the request box is byte-identical. Offline replay of the logged views: 582 -> 486 frames
    requested (288 -> 192 far-hour); eight fast pans 776 -> 440 requested, 661 -> 237 built. Kill
    `__RAW_DISABLE_WIND_SERIES_SUPERSEDE__`. Log `log/2026-10-10-wind-series-supersede.md`; LESSONS L-P29. Live
    read-back owed (ledger seq 989).

- **2026-10-10 01:1xZ: CORRECTION. The basemap mute (#296) never ran in the app; the fix is PR #299 (client only).**
  - **What the owner's console showed** (live dev, build `0f73e2fb`): `window.__WIND_BASEMAP_MUTE__` =
    `{ applied: true, layers: 0 }`. Nothing was muted. My claim below ("the basemap is muted under the wind") was false
    in the app from the merge on; ledger 985 (finding), 986 (correction).
  - **Cause.** The plan stood down for ANY raster layer in the style. The app keeps `esri-satellite-layer` and 18
    weather-wash slots mounted and hidden under the wind (`MapWebGL.js`). `getStyle().layers` also leaves the custom
    wind layer out, so "under the wind" was the whole style. The path bench drew the basemap alone.
  - **Fix.** Imagery = a raster SHOWING under the wind; the wind's slot from the style's draw order; `ocean-mask-*`
    left to OceanMask; the read-back reports the effect (`applied` only when `layers > 0`, else `reason`); re-sync when
    imagery appears or goes (`windBasemapMuteStale`).
  - **Evidence** (path bench, now with the app's layer stack; hue30, kill -> default): deployed code light 46.5 -> 46.6 /
    26.8 -> 26.6 / 58.9 -> 58.5 %, beach 39.8 -> 39.8 / 7.4 -> 7.4 / 49.3 -> 49.3 % (0 layers); the fix light 46.5 ->
    1.5 / 27.0 -> 2.7 / 58.7 -> 3.5 %, beach 39.8 -> 0.6 / 7.4 -> 0.6 / 49.3 -> 0.4 %; dark 2.5 / 3.7 / 4.1 % in both arms.
    `path-run.js --mute-check`: the fix passes, the deployed code fails.
  - **Open for the owner:** a weather wash under the wind stands the mute down, as satellite does (today's look kept;
    unmeasured). **Not yet read on the deployed build:** expect `layers` 9 in light, 17 in beach.
  - **The eye read-back in the same paste shows no defect:** every product was the 2-deg world clip (views 26-140 deg
    wide), so #298's rule had nothing to protect. Log `log/2026-10-09-wind-mute-app-stack.md`; LESSONS L-V21.

- **2026-10-10 00:1xZ: the hurricane eye moved on a z6 zoom stop because a 2-deg clip replaced the finer box (client fix,
  PR #298).** Every wind tier point-samples at its own spacing; the 2-deg world clip of a wide view (the base's own
  nodes) was filed over the 1-deg box and back. `windOverlayKeep.baseClipKeepsFine` keeps the finer box (eye bench: 0 km
  vs 17-25 km / no closed eye). Kill `__RAW_DISABLE_WIND_CLIP_KEEP_FINE__`. Still open: zoom-IN lattice refinement
  (1 -> 0.5 -> 0.25 deg) and the 10-s grid_series timeouts while panning (health 10-13 s). Log
  `log/2026-10-09-wind-eye-tier-keep.md`; LESSONS L-V20.

- **2026-10-09: light and beach wind read true: the basemap is muted under the wind (client only; #296 merged).**
  **⚠ INERT IN THE APP until the fix above merges: the mute never ran there (correction, ledger 986).**
  - **The defect.** The owner saw "ambiguity to the wind color vs the color of the map". The field multiplies into
    full-colour basemaps, so a 33-40 kn gold over cyan water came out green (a 16-21 kn colour on the legend). New
    path bench (`frontend/scripts/wind-bench/path-run.js`: pans, flings, zooms, pinch, jitter, erratic walks; real
    basemaps, offline): 26-55% of wind pixels sat > 30 deg off their legend hue. Dark's null control: 4%.
  - **The fix.** While the wind is on, `windBasemapMute.js` removes 85% of the basemap's area chroma (water x0.90 light
    / x0.94 beach). hue30 falls to 0.7-3% on every path, L* lines rise, the coast's colour contrast falls 9-17%, zero
    flashes.
  - **Kill:** `__RAW_DISABLE_WIND_BASEMAP_MUTE__`. Log `log/2026-10-09-wind-basemap-mute.md`; LESSONS L-V18, L-V19.
  - **Merged** as #296 (ce8ada1d). **Light colour-blind pass on the neutral ground: merged as #297 (af0fa421).** Every ground lifts from
    1.8-1.9 to ~2.6, the ceiling under light's rules; 5 needs a warm fast-band redesign (log
    `log/2026-10-09-light-neutral-cvd.md`).

- **2026-10-09 19:44Z: the HRRR wind lane, chosen by place and time, built DEFAULT ON (owner, D-017); PR open.**
  - **What it does:** inside HRRR's domain and its 48 h horizon, every GFS wind tier blends one stored NOAA HRRR field
    per hour (ingest on GitHub Actions; serve-time `wind_lane.apply_wind_lane` in `/grid`). It uses a 200 km feather and
    a 3 h taper. GFS covers everywhere else and after the horizon, and the controls name the model in words.
  - **Kills:** `WIND_HRRR_LANE=0` and `window.__RAW_DISABLE_WIND_HRRR_LANE__`.
  - **Eye bench:** the same eye across tier, pan, zoom and upstream (0.0-0.2 km, x1.00); the old mixed pair still
    fails (38.3 km).
  - **Found:** Open-Meteo's `gfs_hrrr` serves grid-relative winds (11-17 deg at the coasts) and point-samples. Spot
    points (`fetch_point`, `gfs_seamless`) still carry this; that is an owner D-001 question.
  - **At 101 NDBC buoys over 5 days the lane TIES GFS on accuracy;** its gain is coastal detail, gradient x1.37
    (L-S20). Log `log/2026-10-09-hrrr-wind-lane.md`.

- **2026-10-09 16:03Z: hurricane eye on a one-stop zoom diagnosed; dark fix `WIND_GRID_GFS_GLOBAL` in review.**
  The owner's two zoom stops filed fine overlays from two upstreams that share the GFS label:
  - Open-Meteo `gfs_seamless` = HRRR in its domain;
  - the NOAA-GFS native recovery, used while Open-Meteo's breaker was open.

  Eye bench (new, `frontend/scripts/wind-bench/eye-run.js`): the eye moves 38.3 km, its weakest wall point drops
  16 kn and its area changes x2.17; with the flag, 9.1 km / 2 kn / x0.71. Null and positive controls PASS. The flag
  is dark (served wind speeds move in HRRR's domain), and the flip is owner-only. Log
  `log/2026-10-09-hurricane-eye-one-model.md`.

- **2026-10-08 02:10Z: PR262 bounded health and donor-label repairs published for own qualification.**
  Actualinitial4179 normalpush/draftPR262dev createdandattached,clean/remotematch/base3d/openmergeable. Publicationreceipt960 carriesactualprior261post949-956 and own957-959 sourceevidence; finalcandidate willqualifyitsownchecks. Original860/datawarnings/E2E/Gulf/device/isolation/playback unchanged. Ownconditionalrolloutpending957.


- **2026-10-08 02:08Z: WI03 two-repair candidate prepared for normal source publication.**
  Reviewed bounded cache/freshness/error/singleflight and donorlabels candidate; actual255focused/50floors7skips/3168calls720Jacobphysical0. Ownsourcequalification/conditionaldevrolloutpending957. Proposed949-959 retainedoncanonical948/dev3d ancestry; no replacement860. NormaldraftPRdev publication pendingactualreadback.


- **2026-10-08 02:07Z: WI03 bounded health listing and actual EURO fallback donor labels locally verified.**
  Process-shared30s listing success/failure/unavailable cache and singleflight; current localdisk/restore values remain uncached. Publichealth exposes checked_at/age/ttl/status/cached/first_page scope. NativeEUROmiss labels actualrequestedEUROwaves/ecmwfwam and GFScomponents/ncepGFS, preserving is_estimated/nativeauthority/sample/time/cycle/physicalcalls. Legacy estimatebasis method retained becausepartition gate consumes it; additive source_method records actualdirect_point_api. No scienceflag/selection/physical/shareddata change. Ownqualification/rolloutpending957.


- **2026-10-08 02:00Z: WI03 health amplification and EURO donor labels repair begun.**
  Commitment957 owns bounded source qualification/conditionaldevrollout; original860 retained. Prior956 publication actuald2fd completed; healthy matchingdev3d at01:59.


- **2026-10-08 01:52Z: PR261 rollout and remaining repair receipts prepared for normal publication.**
  Canonicaldev3d21765c/ledger948; proposed949-956 actual261execution/944fulfilled955/healthpoll952/fallbacklabels953/860E2E954 preparedfornormalpush. Only3ownedweatherdocs differ; finalreadbackpending. Nextsource WI03healthpollrequests/source-labelhonesty,860firstliveafter02:07:56Z andquiet prerequisites.

- **2026-10-08 01:52Z: PR261 matching healthy dev deployment verified;944 fulfilled.**
  Actualfrontend/API3d21765c healthy/complete13301restore/zeroerrors;944fulfilledsource/availability. Canonical948/post949onwardproposed.860earliest02:07:56Z andactivecore/newE2E/precomputequietblocked;WI03healthamplification/source-labels/oldslot/warnings andproductacceptance independent.

- **2026-10-08 01:49Z: 860 timing and failed95 E2E evidence refreshed after261merge.**
  860 earliest2026-10-08T02:07:56+00:00 plusmatchinghealthy3d/quiet/visiblefocused stablePAUSED scene;01:48 old95notcurrent3d. Old95restore recoverednaturally13249/0error;E2E95failed. New3d E2E/precompute/forecastwork prerequisitesremainseparate;944deploymentpending.

- **2026-10-08 01:48Z: Unchanged EURO fallback source-label mismatch reproduced.**
  WI03 additionalsource-labelfollowup remains:4actualfallbackcalls showwavesEUROproxyreportingGFS andcomponentsGFSbasisreportingECMWF.261time/cycle scopecomplete; labels/healthwarnings/oldslots productacceptance open.

- **2026-10-08 01:48Z: Health diagnostic request amplification reproduced offline.**
  Nextboundedreliability repaircandidate:health persistence remote-list amplification underexistingWI03/860;36offlinecallsproved36attemptsevenonfailure. Live429 causalmechanism remainsunproven;source261 completedscope/datahealth/acceptance independent.

- **2026-10-08 01:48Z: Superseded PR261 candidate CI cleanup completed.**
  Ownsupersededb923 CI/Lighthouse cancellationcomplete; final967 qualifiesindependently. Original860quiet workloads untouched bymanualcleanup.

- **2026-10-08 01:48Z: PR261 final source qualifies with actual6188 backend passes.**
  261ownsourcequalificationcomplete:6188backend4177frontend all11/LOC/Ledger/Lighthouse/preview; actualrollout944pending. Regularpoint940 source repaircomplete,WI03/860/livecontracts independent.

- **2026-10-08 01:48Z: PR261 exact final-source repair merged into dev.**
  PR261mergeddev3d21765c canonicalledger948 afterownexact9676188backend/4177frontend gates.944deployment pending;949onwardproposed.860≥20min after2026-10-08T01:47:56Z plusquiet/source/healthy prerequisites; no numeric/scienceflags change.

- **2026-10-08 01:27Z: PR261 published for its own final-source qualification.**
  PR261draft OPEN/MERGEABLE dev95; publishedb923943b actualmetadata repair. Own finalpublication receipt948 requiresnewheadqualification944. Canonical936/proposed937-948;860 quiet/restore and independentdatahealth/E2E/Gulf/device/playback acceptance open.

- **2026-10-08 01:26Z: Regular direct-point candidate prepared for normal publication.**
  Own local gatespass,9ownedpaths prepared;944hostedqualification/conditionaldevrollout pending. Canonicaldev95ledger936;937-947 proposed.860/datahealth/failedE2E and independentacceptance preserved.

- **2026-10-08 01:23Z: 860 remains blocked by concurrent forecast work and restore readiness.**
  Actual01:17 matching95/APIhealthy but restoreempty0/1error;WI03 health remains open. Core76ingest,new95E2E/precompute active. Original860 not executed; no forcedload/jobmutation; existing253scope remainscompleted.

- **2026-10-08 01:23Z: Regular direct-point metadata candidate verified without physical changes.**
  WF03/WI03 finding940 locally repaired:99new controls,213focused+47floorcontrols;3168calls/720Jacob physical0. Own hosted guards2524/2396chain/1268estate confirmation and devrollout pending944. No scientificflag/physicalvalue/shareddata change; original860 and productcontracts independent.

- **2026-10-08 01:23Z: Regular direct-point source qualification and conditional dev rollout owed.**
  Existing WF03/WI03 finding940 candidate on codex/regular-point-provenance; canonicaldev95/ledger936, carried937-943 preserved. New ownsourcequalification commitment944;860 independent quiet/readiness blockers.

- **2026-10-08 01:09Z: Prepare normal publication of PR260 completed rollout and remaining findings.**
  Canonicaldev95b8f7c8/ledger936; proposed937-943 actual260 merge/qualification,ownCI cleanup,regularpoint940,860/E2E blockers,933→942 scoped fulfillment and paired diagnostic scoreboard. Only four owned docs differ; final normal publication readback pending. Next source repair remains regular directpointWF03/WI03;860 first live scene after01:23:20Z and quiet/focus/viewport prerequisites; twoingests/newE2E currently block it.

- **2026-10-08 01:07Z: PR260 matching healthy dev deployment verified;933 fulfilled.**
  Actual frontend/API95b8f7c8 healthy/complete13247restore/zeroerrors;933 fulfilled at source/availability scope. Canonicaldev936,postmerge937 onward proposed. Two marine cyclewarnings and failed76 E2E remain independent;860 earliest01:23:20Z plus quiet prerequisites, activecore/regional blockers. Regular directpoint finding940 remains next narrowWF03/WI03 repair.

- **2026-10-08 01:05Z: Original860 remains bounded and blocked; failed acceptance receipts preserved.**
  860 earliest elapsed point01:23:20Z after260 plus actual source/healthyAPI/no concurrentforecast loads; core37710415890 and regional37704566496 active. E2E76 failed00:53:53Z, previousE2E and oldNightly failed, root/product verdict not accepted.333/WF02/WF03/AS04 independently open. No browser scene forced, callback/GPU distinction and cleanup contract retained.

- **2026-10-08 01:05Z: Distinct regular direct-point metadata gap reproduced under existing WF03/WI03.**
  Saved40 offline actual serving calls/20 +1h counterexamples in regular marine/wind/scalar direct paths; selected-frame/cycle metadata omitted. This is separate from estimated-EURO260 repair, mapped to existing WF03/WI03. No replacement task, source change, live request, product/flag mutation or physical acceptance.

- **2026-10-08 01:05Z: Superseded own PR260 CI runs stopped; final-source qualification independent.**
  Only superseded43 CI/Lighthouse canceled and completed cancellation read back; final0da source qualifies independently. Existing forecast jobs and original860 quiet prerequisites preserved.

- **2026-10-08 01:05Z: PR260 own final source qualifies with actual6089 backend passes.**
  Merged95b8f7c8 from exact0da own all11 CI/6089backend/4177frontend; LOC/Ledger/Lighthouse/preview successful. Canonicaldev936 now includes proposed927-936 and scoped925/931 closure;937 onward postmerge receipts proposed.933 deployment fulfillment still pending oldhealthy76 first01:04 source readback. Physical numbers/science flags unchanged; original860 and all product contracts remain independent.

- **2026-10-08 01:04Z: PR260 merged dev95b8f7c8 (2026-10-08T01:03:20Z).**
  Exact reviewedhead0da8ecfb, source/ledgerprefix read back;
  full merge tree equals0da8ecfb; no numeric/science change.
  Deployment source/health readback pending; no live860 repeat. Original
  playback/time/Gulf/device/isolation/datahealth gates remain independently
  open. Records after merged branch prefix remain local until receipt PR.
  See own `log/2026-10-08-blend-rollout.md` for actual checks/rollout progress.

- **2026-10-08 00:44Z: PR260 published; exact-hunk ancestry integration preserves canonical records.**
  PR260 ancestry integrated43d85f5a/base76 and nowMERGEABLE/draft. Committed935 ledger proven byte-identical to99/canonical926 prefix. Local CRLF gate failure corrected; mistaken continuation after failed local gates explicitly recorded, then own memory/prefix/LOC/lint/diff pass0. Proposed936 actual publication receipt becomes new final head;933 own CI/rollout pending,860 independent quiet blockers preserved.

- **2026-10-08 00:40Z: Prepare normal publication of the bounded direct-point metadata candidate.**
  New point repair local gates passed; commitment933 own hosted final-source qualification/rollout pending. Prior proposed927-932 preserved; canonicaldev76/ledger926 unchanged. Regional37704566496 and E2E37706231506 active00:40Z still block original860; no forecast scene or broad acceptance inferred.

- **2026-10-08 00:39Z: Direct-point metadata repair passes actual serving controls and Jacobian comparison.**
  WF03/WI03 finding929 narrowed and repaired locally;41 new actual serving cases,203 focused passes,2944 base/candidate calls and720 Jacobian cases physically identical. Estate projected1268/floor1266; new PR own final-head qualification pending. Canonicaldev remains76a99760/ledger926;927 onward proposed. Original860 still blocked by concurrent regional/E2E activity; no new scene or data/flag mutation.

- **2026-10-08 00:38Z: Commit final-source qualification for the new direct-point metadata repair.**
  New bounded source qualification commitment follows WF03/WI03 repair; prior925/931 fulfillment preserved. Remote own-head gates/deployment pending; original860 is still its own quiet PAUSED GFS scene contract, and broader acceptance remains open.

- **2026-10-08 00:14Z: PR259 post-merge receipts prepared for normal publication.**
  Canonical dev76a99760 ends926; proposed927–932 publish actual merge/qualification, WF03/WI03 counterexample,860 blockers and925 scoped fulfillment. Only owned weather docs differ; latest merge receipt can wait for next source PR. Read back normal publication before reporting pushed.

- **2026-10-08 00:14Z: PR259 matching healthy dev deployment verified;925 fulfilled.**
  Matching dev frontend/API76a99760 is healthy with complete durable restore and zero errors;925 fulfilled at source/availability scope. Two marine cycle warnings persist; new products and existing WI03 acceptance still need evidence.860 remains independent, earliest elapsed point00:29:17Z plus quiet prerequisites.

- **2026-10-08 00:12Z: Original860 remains blocked by rollout timing and concurrent forecast work.**
  Original860 remains open/overdue. After PR259 earliest elapsed point00:29:17Z; matching76 rollout pending at00:11, active core/regional ingests and post-merge E2E require quiet reassessment. No owned browser scene/input forced; earlier changed-viewport/focusfalse receipts still cannot accept playback.

- **2026-10-08 00:10Z: Direct-point time-honesty counterexample mapped to WF03 and WI03.**
  A+1h donor counterexample leaves direct-estimator served-time fields null/zero/false; saved under existing WF03/WI03 for a separate narrow repair. Two offline calls with exact production nearest-time method, no endpoint/live or source change. Initial missing-FastAPI setup failure retained honestly;259 qualified grid scope unchanged.

- **2026-10-08 00:10Z: PR259 exact final source qualified with actual hosted counters.**
  PR259 merged76a99760 after own69cb4705 all11 CI/6048 backend/4177 frontend and LOC/Ledger/Lighthouse qualification. Encoding absent honestly. First source76 rollout receipt pending while previous build remains healthy;925 not yet fulfilled. No served physical number changed and no product acceptance inferred.

- **2026-10-08 00:09Z: PR259 merged dev76a99760 (2026-10-08T00:09:17Z).**
  Exact reviewedhead69cb4705, source/ledgerprefix read back;
  full merge tree equals69cb4705; no numeric/science change.
  Deployment source/health readback pending; no live860 repeat. Original
  playback/time/Gulf/device/isolation/datahealth gates remain independently
  open. Records after merged branch prefix remain local until receipt PR.
  See own `log/2026-10-08-blend-rollout.md` for actual checks/rollout progress.

- **2026-10-07 23:50Z: PR259 contributor-cycle repair published for own qualification.**
  PR259 is an open draft against dev. Initial source head f89c0809 is published; the appended publication receipt requires a new final-head CI run. Commitment 925 remains open until actual qualification and deployed source/health readback; commitment 860 and WI03 product acceptance remain independent.

- **2026-10-07 23:48Z: Blend candidate qualification and conditional dev rollout owed.**
  The new contributor-cycle candidate needs its own final-head CI and conditional dev rollout. This follow-up does not close WI03 data-health acceptance or replace the quiet, stable-viewport live check in commitment 860.

- **2026-10-07 23:45Z: Blend provenance candidate locally verified without physical changes.**
  Ownedcodex/blend-cycle-provenance candidate records actual contributorcycles only;141offlinecontrols47referencepass and2000callsphysical/Jacobian0.35newchaincontrolsproject2396,pairedfloor2390. Ownhostedqualification pending; WI03datahealth/oldslots/directpoint,860quiet and333 acceptance independent.

- **2026-10-07 23:45Z: Post-repair interpolation evidence observed; remaining warnings narrowed to blends.**
  Canonicaldevdd ends918; current candidate retains919-922 proposed. Cached23:35snapshot13213:22latestinterpolationknown,8olderretainedmissing,463latestblendmissing;datawarn2. Source07/dd jobscompleted,newscheduled37688577040activeprevents860quiet probe. WI03remaining donor/storedslot/directpoint evidence independent.

- **2026-10-07 18:11Z: Latest acceptance follow-up receipts prepared for normal publication.**
  Owned codex/weather-acceptance-followup carries proposed919-922, canonical918. Normal publication final readback pending at append. PR258/source257 completed scoped qualifications;918fulfilled920.860 remainsopen/overdue due active07ingest; five dataalerts and333/live/scientific acceptance independent.

- **2026-10-07 18:08Z: 860 remains blocked by active repaired-source ingest; datawarn5 retained.**
  860 open/overdue; separately existing dispatch37658162210 active on07 source at18:04Z prevents quiet live scene. Earlier scheduled68ingest completed17:16Z. Fresh RawSurfwindow readable, focus/viewport/grid unmeasured; no input or scene activation. Datawarn5 now includes age warnings, independent WI03 remains open; no reopening253repairs.

- **2026-10-07 18:06Z: PR258 qualified documentation rollout;918 fulfilled.**
  PR258 mergeddd1f9655 after own all11/6013backend/4177frontend; canonical918. New919 onward proposed on codex/weather-acceptance-followup. Frontenddd/APIhealthy07 have identical app/workflow source, literal API dd runtime not asserted;13189 restored0errors,datawarn5.918 fulfilled at documentation scope;860/333/WI03 remain open.

- **2026-10-07 18:01Z: PR258 merged devdd1f9655 (2026-10-07T18:00:16Z).**
  Exact reviewedhead25bb7f96, source/ledgerprefix read back;
  full merge tree equals25bb7f96; no numeric/science change.
  Deployment source/health readback pending; no live860 repeat. Original
  playback/time/Gulf/device/isolation/datahealth gates remain independently
  open. Records after merged branch prefix remain local until receipt PR.
  See own `log/2026-10-07-ecmwf-rollout.md` for actual checks/rollout progress.

- **2026-10-07 17:14Z: PR258 final receipt qualification obligation recorded.**
  New documentation follow-up918 due18:30Z tracks final own receipts and conditional dev merge. PR258 draft, canonical913/proposed914-918. Source257 complete and911fulfilled916;860/333/WI03 acceptance independently open.

- **2026-10-07 17:13Z: Completed257 receipts pushed as draftPR258.**
  PR258 OPEN draft on codex/interpolation-rollout-receipts; proposed914 onward, canonical913 remains. Its own final-head hosted qualification is pending; no pending merge. Source257 already matched healthy dev,911 fulfilled at source scope;860/333/WI03 remain open.

- **2026-10-07 17:09Z: PR257 matching healthy dev rollout;911 fulfilled at source scope.**
  Dev frontend/API07e153ac matched at17:04:49-52Z,13197 restored and zero restore errors. Own final CI all11/6013 backend/4177 frontend qualified. Canonical913; new914 onward proposed until receipt merge. Three data warnings and860/333/remaining acceptance stay open; existing scheduled ingest remains active.

- **2026-10-07 17:04Z: PR257 exact qualification read back; rollout pending.**
  Dev07e153ac equals own qualified4741 tree; all11 and6013backend/4177frontend actual passes. Canonical913, proposed914 onward.911 awaits actual deployed source/health. Three data warnings, old stored interpolation/blend evidence and860scene prerequisites remain open; no manual forecast dispatch.

- **2026-10-07 17:01Z: PR257 merged dev07e153ac (2026-10-07T17:01:14Z).**
  Exact reviewedhead4741a10d, source/ledgerprefix read back;
  full merge tree equals4741a10d; no numeric/science change.
  Deployment source/health readback pending; no live860 repeat. Original
  playback/time/Gulf/device/isolation/datahealth gates remain independently
  open. Records after merged branch prefix remain local until receipt PR.
  See own `log/2026-10-07-ecmwf-rollout.md` for actual checks/rollout progress.

- **2026-10-07 16:39Z: PR257 missed floor reference corrected.**
  Correction913 supersedes910/911 paired-reference claim. The actual companion test now uses chain2361 with floor2355;47 controls pass after1fail/46pass counterexample. PR257 remains unmerged/draft,911 open; changed head needs fresh own CI. Physical code and invariance controls unchanged.

- **2026-10-07 16:30Z: PR257 interpolation candidate pushed and attached as draft.**
  PR257 OPEN draft, initial source dca98fc1; publication recorded912. Final receipt continuation must pass its own hosted checks before conditional dev merge. Source locally verified95controls and600calls;911 and independent WI03/860/333 acceptance remain open.

- **2026-10-07 16:27Z: Bounded interpolation publication and rollout obligation recorded.**
  Existing WI03 remains open. New concrete candidate obligation911 is final-head CI qualification and conditional dev rollout by18:00Z;860/863 identities preserved. Actual95pure-controls pass; optional broader endpoint probe lacks FastAPI locally and requires real hosted dependencies. No source or data-health closure yet.

- **2026-10-07 16:25Z: Interpolation cycle candidate locally verified.**
  Candidate on codex/interpolation-cycle-provenance:33 new controls and46 combined pass;600 before/after Jacobian calls have zero physical differences. Chain floor/reference raised together. Newly generated frames only; old stored estimates and mixed-source blends remain open. Own hosted qualification pending.

- **2026-10-07 16:25Z: WI03 warnings narrowed to estimated cohorts.**
  Native cycles are known in the timestamped registry snapshot; eight selected interpolation frames and estimated blends lack cycle evidence. Inventory differences remain unattributed. Existing scheduled ingest37645014966 is active;860 not probed.

- **2026-10-07 16:25Z: PR256 receipts canonical; documentation rollout verified.**
  Dev58933417 receipts end906; new907 onward remain on the next branch. Healthy API7a is application-source equivalent to docs-only589; frontend589 observed. Data warnings remain. No live860 or product acceptance claimed.

- **2026-10-07 16:13Z: PR256 merged dev58933417 (2026-10-07T16:13:08Z).**
  Exact reviewedhead5a48c6da, source/ledgerprefix read back;
  full merge tree equals5a48c6da; no numeric/science change.
  Deployment source/health readback pending; no live860 repeat. Original
  playback/time/Gulf/device/isolation/datahealth gates remain independently
  open. Records after merged branch prefix remain local until receipt PR.
  See own `log/2026-10-07-ecmwf-rollout.md` for actual checks/rollout progress.

- **2026-10-07 15:54Z: final receipts published as draft PR256; app source equalsdev7a.**
  Canonical ledger900, proposed901-905 including226merge/899fulfillment902,
  current table and inventory correction904.905records actual initial
  push/creation/readback; final receipt-only head requires its own hosted
  checks before merge. Source repairs already merged/qualified: frontend
  377/4177, backend5980; actual deployed frontend/healthyAPI7a. Datawarn3,
  Inventory changed from 13,367 to 13,188 (179 fewer); cause unknown.
  860 remains blocked by focus access. 333 and the scheduled
  renderer/playback/time/Gulf/devices/isolation/datahealth remain open.

- **2026-10-07 15:47Z: PR226 merged and matching dev rollout verified;899fulfilled.**
  Exact58922be1 all11 CI37644066651:377/4177frontend,5980backend passes;
  estate1227 confirmed299selected297produced0silent. LOC/Ledger/Lighthouse
  successful; Encoding absent by unchanged frontend filter. Merge7a5fe141
  at15:42:32Z equals reviewed tree. Public source/readiness both7a, restored
  13188 products; productionfrontendfc140024. Data warn, 3alerts retained.
  Canonical ledger900 includes892fulfillment896; new901merge/902rollout899
  fulfillment proposed on final receipt branch.860focus,333scheduledrenderer
  and all independent playback/time/Gulf/device/isolation/datahealth stay open.

- **2026-10-07 15:42Z: PR226 merged dev7a5fe141 (2026-10-07T15:42:32Z).**
  Exact reviewedhead58922be1, source/ledgerprefix read back;
  full merge tree equals58922be1; no numeric/science change.
  Deployment source/health readback pending; no live860 repeat. Original
  playback/time/Gulf/device/isolation/datahealth gates remain independently
  open. Records after merged branch prefix remain local until receipt PR.
  See own `log/2026-10-07-ecmwf-rollout.md` for actual checks/rollout progress.

- **2026-10-07 15:26Z: PR226 pushed as a draft current-dev repair.**
  Actual local/remote/PR head35a093a5, original226 anddev68 ancestry retained
  with full tree equal reviewedb602330e.900records publication; receipt-only
  continuation requires final own-head checks, not stale green.899 remains
  open; canonical ledger893 vs proposed894-900 explicit. Source255/245
  already deployed68;860focus/333nightly/data-health acceptance stay open.

- **2026-10-07 15:21Z: existing PR226 adapted to current dev; qualification pending.**
  New23 merge-target controls RED16fail/7pass then GREEN23; actual76 local
  target/actor/scoreboard/floor controls pass. Estate299files projected1227,
  floor1225; unchanged guards186/2425 and chain157/2328. Source changes no
  served number. Proposed898repair and899qualification contract preserve
  original226 identity and canonical893prefix; old source is not restored.
  Rollout receipts894-897 remain proposed until the adapted branch merges.
  860 browser access,333scheduled renderer and three data warnings remain open.

- **2026-10-07 15:10Z: PR245 merged and matching dev rollout read back; 892 fulfilled.**
  Merge68fedfcf at15:02:32Z, exact8b final head/all11 CI; frontend377/4177,
  backend5957 passes. Ledger/Lighthouse pass; LOC/Encoding absent by unchanged
  app-source filters. 26 offline harness controls pass on Node18.20.2 and24.19.0.
  At15:08:02Z frontend/API both68; restore complete13367; production frontend
  fc140024 preserved. Three data warnings remain. 863 and887 closures are
  canonical through893; new892 fulfillment896 is proposed on the receipt branch.
  860 remains access blocked,333scheduled renderer verdict open. PR226 guard
  still requires current-base adaptation; no duplicate224/225/222 source repairs.

- **2026-10-07 15:04Z: PR245 merged dev68fedfcf (2026-10-07T15:02:32Z).**
  Exact reviewedhead8b5c11a7, source/ledgerprefix read back;
  full merge tree equals8b5c11a7; no numeric/science change.
  Deployment source/health readback pending; no live860 repeat. Original
  playback/time/Gulf/device/isolation/datahealth gates remain independently
  open. Records after merged branch prefix remain local until receipt PR.
  See own `log/2026-10-07-ecmwf-rollout.md` for actual checks/rollout progress.

- **2026-10-07 14:44Z: PR245 updated by normal fast-forward; own checks pending.**
  893: local/remote/PR headc638b49a agrees, draft/dev; original245 and
  current dev8e are ancestors. The PR baseRefOid is an older2a7 snapshot,
  while actual live dev ref is8e. No source changes in final receipt amendment.
  Backend/frontend-src source identical8e; LOC/Encoding absent by their filters.
  892 remains open until final-head qualification and dev source readback.

- **2026-10-07 14:40Z: Existing PR245 locally qualified against dev8e.**
  891: current Nightly undefined-map failure maps to existing harness candidate.
  Four source/workflow files integrate cleanly; 26 offline controls pass.
  Backend, renderer, physical values and CI floors unchanged. Commitment892
  tracks updated PR245 final-head hosted checks and conditional dev merge.
  PR255 is deployed and887 fulfilled889 at source/availability scope.
  860 access blocker and333 live Nightly acceptance remain independent.

- **2026-10-07 14:40Z: PR255 repair merged and deployed to dev; 887 fulfilled.**
  Dev merge `8e4eeaeb5f5de662a1e305de0468fe8ef9744416`, exact reviewed head98e6870e. Own eleven CI jobs pass:
  frontend377/4177 and backend5957 passes; LOC/Ledger/Lighthouse pass.
  API healthy on exact merge source and dev frontend marker8e4eeaeb;
  production frontendfc140024 preserved. Three missing-cycle data warnings
  remain honest. 860 is access-blocked/open; 863 is qualified fulfilled883.
  PR245 has a current Nightly instrument failure; PR226 guard is still absent.
  Preserve original playback/time/Gulf/device/isolation/data-health acceptance.
  New post-merge records remain proposed until their receipt branch merges.

- **2026-10-07 14:33Z: PR255 merged dev8e4eeaeb (2026-10-07T14:32:26Z).**
  Exact reviewedhead98e6870e, source/ledgerprefix read back;
  full merge tree equals hosted98e6870e repair source; no numeric/science change.
  Deployment source/health readback pending; no live860 repeat. Original
  playback/time/Gulf/device/isolation/datahealth gates remain independently
  open. Records after merged branch prefix remain local until receipt PR.
  See own `log/2026-10-07-ecmwf-rollout.md` for actual checks/rollout progress.

- **2026-10-07 14:15Z: PR255 stack resolved; new head qualification pending.**
  886 preserves the exact merged ledger prefix and resolves only ACTIONS/STATE
  conflict chunks. Application, tests and workflows remain identical to reviewed
  77. Commitment 887 tracks final-head checks and dev deployment readback.
  860 remains blocked on focused, stable browser access; 863 is fulfilled at the
  qualified documentation scope recorded in 883. Broader acceptance stays open.

- **2026-10-07 14:10Z:255merge refused on squash-stack memory conflicts; reconciliation.**
  885: reviewed77all11gates qualified884, but after254squash3310 GitHub
  DIRTY/CONFLICTING; onlyACTIONS/STATE collide.255notmerged/deployed.
  Preserve canonical864prefix and ownappend-only records, no app/test/workflow
  change. New final pushedhead requires its own checks before retry.
  883qualified863closure and860focus blocker retained; no bypass/forcepush.

- **2026-10-07 14:05Z:863 qualified receipt merge/readback fulfilled;25577readyqualified.**
  883fulfills863 under881explicit local LOC/Encoding supplement adjustment;
  own25411CI/Ledger/Lighthouse, docs merge3310, devfrontend3310/APIhealthy4fe
  (backendappunchanged) read back; frozenproductionfrontendfc140024 preserved.
  884own77CI37630822926 all11success:377/4177frontend,5957backend;
  ownLOC/Ledger/Lighthouse pass, Encodingabsentbyfilter/identityproved.
  255authorized devmerge and new deployedsource/health pending.860focus
  blocker and broader acceptance remain open; no science/shareddata/main.
  Records beyond mergedreceipt864 remain local until own receipt publication.

- **2026-10-07 13:58Z: PR254 merged dev3310b6f5 (2026-10-07T13:56:28Z).**
  Exact reviewedhead7762ae6e, source/ledgerprefix read back;
  docs only and app/workflow identical4fe;881qualifies863supplement gates.
  Deployment source/health readback pending; no live860 repeat. Original
  playback/time/Gulf/device/isolation/datahealth gates remain independently
  open. Records after merged branch prefix remain local until receipt PR.
  See own `log/2026-10-07-ecmwf-rollout.md` for actual checks/rollout progress.

- **2026-10-07 13:55Z: owner880 authorizes qualified254/255 dev merge/deployment.**
  881explicitly qualifies863 docs-path skipped LOC/Encoding with actual
  immutable254local controls:0LOCnew/regressed,1221encodingfiles0violations;
  own11CI/Ledger/Lighthouse pass, no fake all-four-hosted claim.
  2547762ready for qualified merge;25577 still awaits current two CI lanes.
  Local action records remain unmerged; source/check heads frozen. No main,
  serving/science/shared-data change.860focus blocker and remaining product
  acceptance remain open; no live repeat during rollout.
  See own `log/2026-10-07-ecmwf-rollout.md` for exact source/counts/progress.

- **2026-10-07 13:42Z:860 owner-assisted preflight executed; focus prerequisite failed.**
  878 reads C860PREFLIGHT3 at13:37:51Z:dev4fe94420,visibletrue,
  focusedfalse,1280x631,zoom9,bounds recorded. No Waves activation,
  stableobserver or new paint/gap sample. Helper later restored narrowwindow;
  owned checktab closed, WavesOFF/DevToolsclosed; usertabs preserved.
  Post APIhealthydev4fe,datawarn three missingcycles.860 open for safe
  focus-preserving access; no forced repeat or cache-regression inference.
  879 reads877receiptpush663ac016; source8a qualified875/872fulfilled.
  New docs receipt fullSHA has separate hosted check status.255draft,
  254unmerged7762/863open; no merge/deploy/science/shared-data action.
  See own publication log and external live-stable-pass preflight receipt.

- **2026-10-07 13:24Z: WI-03 PR255 source8a54cd90 hosted-qualified;872 fulfilled by875.**
  Own CI37625462518 all11success: frontend377/4177; backend5957passes
  (guards2425,chain2328,estate1204), exact projection. LOC/Ledger/Lighthouse
  pass at8a; Encoding deliberately absent, unchangedfrontend identity proved.
  Receipt-only amendment has a new fullSHA/check state; source/test/workflow
  unchanged. PR255 stays draft; PR254 remains unmerged7762ae6e,863 open.
  876: owner quiet/prepared860 tab; helper prompt-focus prerequisite pending,
  WavesOFF and no new scene.860 stays open; earlier changed viewport retained.
  Dev/API4fe94420 healthy; missing-cycle data warnings remain. No rollout,
  science/shared-data changes or closure of broader acceptance gates.
  See own `log/2026-10-07-ecmwf-publication.md`;877 prepares receipt push.

- **2026-10-07 13:00Z: WI-03 repair published as attached draftPR255/dev.**
  874 reads back local/remote/PR initiald9d507f8; own CI/LOC/Ledger/
  Lighthouse queued at exact head. Same-branch receipt amendment follows;
  own872 qualification remains pending, totals5957backend projected.
  PR254 remains separate unmerged7762ae6e; proposed receipt prefix retained.
  Dev4fe94420 unchanged; no merge/deploy or live repeat.860/863 remain open;
  no cache repair reopened, forecast-value/flag/shared-data change.
  See `log/2026-10-07-ecmwf-publication.md` for source and Jacobian limits.

- **2026-10-07 12:57Z: WI-03 publication authorized; Jacobian control qualified locally.**
  871:156real-decoder offline cells, physical sensitivities equal across4
  provenance modes with max delta0; wave/wind/pressure analytic interior gains
  pass. Existing0c89source104passes; chain2328/backend5957 still projected.
  872tracks new-source own hosted qualification, not replacement860/863.
  873prepares branch push/dev draft; source/receipt stack inherits unmerged
  PR254head7762ae6e. Merged dev4fe94420 unchanged; no live repeat, merge,
  deployment, shared-data or science flag action. See own publication log.

- **2026-10-07 12:48Z: assisted860 receipt retained; viewport changed, acceptance open.**
  868/869: owner quiet/access, one paused GFS Waves h0 scene; viewport540x241
  to1280x631 atzoom9 prevents stationary clean-cache acceptance. 88overlay
  refreshes/2water paints330.8ms;1061fresh callbacks, gaps17median/113p95/
  227max ms,0fallback edges. Nested CPU phases not summed; GPU completion
  unmeasured. Owner WavesOFF/tabclosed; post APIhealthy/dev4fe94420,
  datawarn missing ICONmarine/EUROmarine/EUROwind cycles. No repeat scene.
  PR253 repairs stay closed;860 remains open for stable viewport;863 remains
  partial with draftPR254head7762ae6e (12:37Z readback). Local0c89 ECMWF
  candidate remains unpublished; proposed receipt/local ledger records are
  unmerged. Playback/time/Gulf/device/staging/data-health gates remain open.
  See `log/2026-10-07-c860-assisted-live.md` for limits and handoff pointers.

- **2026-10-07 11:57Z: WI-03 partial ECMWF cycle candidate local-qualified; unpublished.**
  Owner865 authorizes repairs;866 reproduces false-known metadata with10 RED
  failures. Complete selected-message analysis metadata is now required;
  final104 offline controls pass, including unchanged wave values/times/counts.
  Eleven new chain controls project2328/floor2322; own hosted remains pending.
  Branch `codex/ecmwf-cycle-provenance` is stacked on unmerged receipt PR254
  head7762ae6e; merged dev still4fe94420. No live forecast number, deployment,
  shared-data or scientific flag change. Estimated-tail cycle warnings remain.
  Cache repairs stay closed at documented scope. Existing860 is still blocked
  on focused/viewport/diagnostic browser access;863 remains separately open.
  Playback/scrub, served-time, Gulf/device and isolated staging acceptance stay
  open. See `log/2026-10-07-ecmwf-cycle-provenance.md` for bounded evidence.

- **2026-10-07 04:22Z: PR253 three-cache repairs qualified, merged and served dev4fe94420.**
  857 own d417 CI37569367813 all11/four success;377/4177 frontend and5946
  backend passes,67 guard skips,estate298selected296results0silent. 858
  squash253; 859 fulfills851 via fresh matching healthy API/dev frontend.
  Native85516legs64MiB exact pixels; repeated floor/regional paints3to1 in
  synthetic controls. No liveFPS/smoothness acceptance; 860 tracks later
  bounded paused receipt with real viewport/zoom and clean-paint/gap/fallback
  measurements. Production frontendfc140024 frozen; no served forecast number
  or science activation, second live scene, Play/scrub or stress/judge dispatch.
  Original playback/Gulf/time/device/staging gates open; canary untouched.
  Receipt PR254 OPEN draftdev/attached (864), six docs only; own hosted and
  conditional dev merge pending863. Later bounded live acceptance pending860.

- **2026-10-07 03:56Z: final three-cache PR253 amendment local-qualified; hosted pending851.**
  853/854 prove active8-to12 regional overlays reset at obsolete12clear;
  RED4/36, final377/4177; lint/LOC/build pass, engine3207to3202.855 native
  16legs64MiB final exact pixels, fewer repeated floor/regional paints, zone12
  unchanged. Two rollback flags plus existing pristine-cache disable available.
  Priorff124 hosted all11/four/5946backend/4171 qualified, not merged; cannot
  qualify successor. New source own hosted and matching served remain owed851.
  Dev1a89ed0a/production frontendfc140024; no new live scene/science/served number.

- **2026-10-07 03:30Z: combined mask reuse/parity locally qualified, hosted pending851.**
  850 final377/4171frontend, lint/LOC/build pass; engine3207to3205.849 native
  8cases32MiB exact final/first/repeated parity,3legacy paints versus1repair.
  Candidate preserves truth/healing/readiness, stable zoom and combine mode;
  pristine cache gets matching read-oriented context.851 requires own hosted
  all11/four/actual5946backend and377/4171, then qualified dev merge and fresh
  matching served readback. Dev1a89ed0a; production frontendfc140024 frozen.
  No second live scene/forecast number/science activation; original gates open.

- **2026-10-07 03:27Z: minimum-span/pristine-context repair local, not served.**
  847 RED2stationary failures proves minimum-span cache contradiction;16new
  controls cover healing, pan/resolution, combine mode, settled zoom and kill.
  848 native parity failed,849 isolated pristine-cache context mismatch.
  Matching read-oriented context removed first/repeated/final drift in8native
  legs,32MiB final comparisons;3paints reduced to1 in synthetic controls.
  Combined full/lint/build and own hosted remain pending; no liveFPS acceptance.
  PR252 remains served1a89ed0a, production frontendfc140024 frozen. No second
  live scene/forecast number/science activation. Canary untouched/excluded.

- **2026-10-07 03:08Z: PR252 served1a89ed0a; clean-cache gap now open.**
  846 fulfills841: own hosted377/4155frontend,5946backend; matching healthy
  API/frontend. Paused visible/focused Chrome receipt:19clean paints2433.2ms,
  15callbacks99.3ms;7idle/8other-source refreshes,0fallback/damage/water-source.
  Degraded-retry hypothesis falsified for this scene. Inspect clean-cache
  eligibility offline; live viewport span not captured, no sole-cause claim.
  Waves off/tabclosed, post APIhealthy/datawarn. Production frontendfc140024
  frozen; playback/Gulf/time/device/staging gates open; no forecast number or
  scientific-serving flag changed. Earlier entries are historical.

- **2026-10-07 02:57Z: PR252 qualified/merged1a89ed0a; rollout/live pending841.**
  843 own13fbab10 CI37563127950 all11/four supplementary success; actual5946
  backend2425/2317/1204,estate298selected296results0silent;377/4155frontend.
  844 GitHub merge02:57:31Z1a89ed0a/fetched dev exact.02:57:55Z frontend/API
  stillbf72healthy; matching served readback pending.842 owner restored Chrome
  sign-in; map unopened pending matching rollout. No source filter/cache or
  healing policy change. One bounded paused receipt will distinguish event
  and paint-verdict paths; no FPS/cause acceptance yet. Production frontend
  fc140024 frozen, no forecast number/science flag change; canary excluded.

- **2026-10-07 02:38Z: mask repaint attribution candidate, not deployed.**
  836/837 distinguish triggering event and actual paint verdict in23fixed CPU
  buckets, preserving source throttles/readiness/healing. Actual engine RED4
  missing-verdict failures;171focused and377suites/4155full controls pass.
  Native synthetic25ms attribution correct, callback calibration240.7ms/draw
  150.2ms versus0.2ms idle; no livecause or FPS claim. Lint/LOC pass; deployed
  build passed; hosted qualification and one served receipt pending.
  Existing devbf72healthy/datawarn, productionfc140024 frozen. No served
  forecast number/science activation. Canary excluded; original gates open.

- **2026-10-07 02:21Z: PR251 matching dev frontend/API healthy bf72c8db.**
  832 fulfills824 via exact public readback; production frontendfc140024 frozen.
  Own-source hosted5946backend and376suites/4128frontend passed; strict lint0.
  Intended gallery three-day grace restored; no historical record mutation.
  833 preserves water-paint report and portable10633control oracle; native
  parity passed but total-paint gain mixed, prototype unshipped. Next trace
  actual paint verdicts and source-event invalidation. Original Play/scrub,
  fallback, served-time, Gulf, device and staging-publication gates stay open.
  No served forecast number/science flag change; other chat canary excluded.

- **2026-10-07 02:17Z: PR251 qualified/merged bf72c8db; backend rollout pending824.**
  830 ownb81b CI37559959669 all11/four success, actual5946backend,376/4128frontend,
  estate298selected296results1204passed0silent; strict fatal lint0.831 merges251
  bf72 at02:15:56Z.02:17:39Z devfrontendbf72/API healthy26a1, matchingreadback
  pending824. Production frontendfc140024 frozen. No historical gallery mutation.
  825 live receipt fulfills813: expensive repeated water painting outside short
  wave callbacks, fallback persists.829 native exact-distance prototype10633
  oracle controls/fullRGBA parity passes, total-paint benefit mixed; unshipped.
  Next diagnose real paint invalidation and remaining map-frame/scheduler gaps;
  do not pair nonexistent MapLibre renderstart with render completion. Portable
  offline controls/report preserved, owned tabsclosed/serversstopped. No served
  number/science flag change. Canary excluded. Playback/time/Gulf/device and real
  isolated staging publication remain open. WATER-PAINT-DIAGNOSIS.md carries limits.

- **2026-10-07 01:59Z: live CPU receipt825 fulfills813; costly water painting found.**
  Dev26a1cc8b/main.3de9efe1.js paused GFS Waves trip at01:58:35.523Z,12windows
  1FPS,17.987s interval.18custom callbacks95.6ms/engine77.2ms;22water paints
  4038.3ms,21regional4268.2ms/overlay3668.8ms nested. All18callbacks visible
  focused;18longtasks4196ms max737. Costs overlap, no GPU/sole-cause claim.
  Waves off readback false, owned tabclosed;01:59:32Z API healthy exact26a1,
  data healthwarn. Browser beta restored by owner. No Play/scrub/Gulf/device
  acceptance. Next: trace repeated mask paint and offline regression.
  Gallery candidate822/824 remains local, not deployed; fatal lint0,39isolated
  controls pass, full configured hosted acceptance pending. Canary preserved.

- **2026-10-07 01:56Z: PR250 merged and served dev26a1cc8b; gallery repair candidate.**
  820 qualifies exact77e6 ownCI37557753240 all11/four success, actual5943backend,
  376suites4128frontend, estate297selected295results0silent.821 merges250
  26a1cc8b at01:52:19Z;823 reads matching dev frontend/shared API healthy
  at01:55:46Z. Production frontendfc140024 frozen. Native browser reconnected
  to Edge5, beta access pending owner entry; no live scene started or smoothness
  claim.813 remains open for bounded paused CPU receipt and cleanup/readback.
  819 diagnoses one missing gallery timedelta import and guarded test lint debt;
  822 repairs locally with actual mocked scheduler2pass1fail before/3pass after.
  Fatal backend lint4to0, now blocking.39 isolated scheduler/floor controls pass;
  application conftest excluded, own-source hosted acceptance pending824.
  Estate selector298includes new file; projected1204/floor1202 margin2. No real
  gallery/database mutation, served forecast number or science flag change.
  Canary excluded/preserved. See CPU-PHASE-DIAGNOSIS.md, GALLERY-GRACE-RESULTS.md
  and log/2026-10-07-marine-phase-timing.md. Original cadence/Gulf/time/device and
  actual staging publication gates remain open.

- **2026-10-07 01:28Z: whole-callback/mask CPU diagnosis candidate under813.**
  Owner812 continues qualified beneficial dev repairs under776. Fresh origin/dev
  and healthy API de1bd561 at01:13:26Z; production frontendfc140024 frozen.
  814 records valid integration red6fail18pass; final202focused controls pass,
  nine scalar CPU buckets and context counts, no guard/math/policy change.
  816 final376suites4128tests/build/lint pass;LOC0new0regressed. Final native
  actual-layer calibration separates40ms callback/25ms draw stalls, six each,
  visible/focused. Plain RAF30intervals median16.7ms,one300.3ms outlier,31focused
  visible callbacks; no live-map/GPU/cause proof. Probe closed/server stopped.
  Prior376/4126 and initial failures excluded; own hosted/rollout pending813.
  No candidate merge/deploy/physical claim. Canary excluded. CPU-PHASE-DIAGNOSIS.md and
  log/2026-10-07-marine-phase-timing.md carry evidence/limits.

- **2026-10-07 00:48Z: PR248 and PR249 merged, dev de1bd561 served; fallback persists.**
  Owner776/784 authorizes qualified beneficial dev repairs.792 merges cadence248
  b8cdb2bd from exact49db;805 merges mask249 de1bd561 from exact9ee3.803 qualifies
  ownCI37551277208 all11/four supplementary success, actual5943backend,
  374suites4097frontend, estate0silent; local full/build/lint/LOC/secrets pass797.
  Controlled native cadence125to9snapshot reads; ready-empty mask10to0canvases,
  62.5to0.5ms CPU. No served number/coast policy/science switch changes.
  806 dev frontend/sharedAPI matching de1bd, production frontendfc140024 frozen.
  807 fulfills796: current bundle main.266069b3.js paused GFS Waves still trips
  12windows at1..2FPS;16nativecallbacks,0texture-helper ops,0slow engine drawcalls,
  17longtasks3221ms. Zero delivered LoAF entries does not exclude stalls.
  Engine timing excludes whole-map/outside encode/mask work (correction800).
  Waves off, tab closed;00:48:15Z API healthy13310products restored complete.
  Next discriminant: whole callback and mask prepare/paint/upload CPU boundaries,
  with focus/visibility verified; no attribution to console recorder wrapper.
  PR245 clean combined-tree26offline tests802, still needs current qualification.
  Smooth Play/scrub, exact served time, Gulf amplitude, device acceptance and
  actual staging publication remain open. Unowned canary preserved/excluded.
  See MASK-PREFLIGHT-RESULTS.md and log/2026-10-07-mask-preflight-repairs.md.

- **2026-10-06 23:13Z: owner-approved PR247 merged dev1993cc39, ledger778.**
  Exact ec34 source qualified: ownCI37543004057 all11 and four supplementary
  workflows green; actual5943backend,372suites4066frontend,estate0silent.
  778 verifies775 publication;776 records broader beneficial dev repair authority.
  779 reads dev frontend1993cc39/shared API full1993cc39 healthy; production
  frontendfc140024 frozen.780 fulfills777: one clean paused GFS Waves observation
  with startup2/4/4FPS warnings then HUD23..27FPS, no sustained trip or timing
  receipt. Play/Pause12 and ArrowRight13 worked; exact-time/smoothness unproven.
  Waves off read back and owned tab closed; post-map API healthy, data-health warn
  unchanged from premerge. Original cause/Gulf/device gates stay open.781 records
  the receipts; next probe measures out-of-engine listener/mask costs offline.
  Production frontendfc140024 frozen; no science/serving flags or forecast math changed.
  Unowned staging canary preserved and excluded.

- **2026-10-06 22:05Z: owner-approved PR246 merged dev72e6e5ad, ledger767.**
  Approved exact144 ownCI37536152276 all11 and four supplementary green;
  actual5943backend (2425/2317/1201),370suites4045frontend,estate0silent.
  765 records owner yes;767 verifies764 publication and actual squash merge.
  768 reads dev HTTP200/build72e6e5ad and shared API healthy/full72e6e5ad;
  production frontendfc140024 frozen.769 fulfills766 bounded live follow-up:
  clean paused native1..5FPS trip, working receipt27callbacks/15.724s,
  CPU histogram17/7/1/2/0; cause/GPU completion remain open. Play to12,
  keyboard scrub13 stable; fallback notice and recovery1/2 observed.
  Served/run clocks absent, no smoothness/Gulf/device acceptance. Waves
  off read back and tab closed; no main promotion or science/serving activation.
  Unowned canary unchanged and excluded; receipt branch dev-fallback-verification.
  771 verifies770 remote66f2c73a and draft PR247 OPEN/dev.773 verifies772
  actual receipt d1c0a89b local/remote/PR agreement. PR247 now receives a
  callback-gap diagnostic candidate: bounded scalar long-task/long-frame
  observation during low-FPS streaks, no extra production RAF loop or GL
  query, no guard/retry/math changes. Original root cause remains open.
  Final local CRACO372/4066 passed; build/lint/LOC passed. Exact-head
  hosted qualification pending.775 verifies774 actual19f1480c publication
  and normalized PR body; receipt/comment-only push next, no runtime delta
  from locally tested candidate. Cap expiry correctly means unknown. Offline browser known-stall controls
  detect six100ms tasks/six RAF gaps in both orders; idle zero. No second
  merge authorized or performed; dev still72e6e5ad.

- **2026-10-06 21:44Z: fallback source0bd fully qualified763; operator boundary762.**
  OwnCI37533475555 all11 plus ledger/LOC/Encoding/Lighthouse successful;
  actual5943backend (2425/2317/1201),370suites4045frontend,estate0silent.
  763fulfills760;762verifies761 publication and exact PR body at0bd.
  Diagnostic sink failure contained; bounded native counter receipt, no GL
  query/threshold/retry/math/flag change. Clean paused dev did not trip,
  no original live/Gulf/play/scrub/device/GPU completion acceptance.
  Dev-only connector readonly0pointer/0objects/private/RLStrue. Launcher
  rejects dirty canary before credential; manual6cases PS7, PS5 syntax only,
  no policy change/credential entry/cloud write. Actual publisher credential
  and execution remain open.764publishes operator/probe/receipts only;
  application/tests/workflows identical to qualified0bd. PR246 OPEN/dev,
  no merge/deployment. Unowned canary preserved/excluded. Results in
  FALLBACK-EVIDENCE-RESULTS.md and STAGING-LAUNCHER-RESULTS.md.

- **2026-10-06 21:19Z: fallback diagnostic boundary repaired locally759.**
  New mounted sink failure suppressed actual fallback; red2fail18pass, scoped
  113pass before final sparse case. Bounded counter-only receipt; no GL query,
  height/math/threshold/retry/flag change. Clean paused dev observation: single
  7FPS warning, later20/27FPS, uploads19 stable; no sustained trip. No local
  test/build overlap; no Gulf/play/scrub/device/GPU completion acceptance.
  e56 receipt now all15 checks successful and verifies758 publication; own760
  new-delta hosted qualification pending. Local final370/4045, build/lint/LOC
  pass; frontend ratchet370/4045 (+1suite/31tests).761publishes owned delta.
  PR246 OPEN/dev, no merge/deployment.
  FALLBACK-EVIDENCE-RESULTS.md. Unowned canary preserved/excluded.

- **2026-10-06 20:28Z: projection sourcea5a29ae9 fully qualified757.**
  OwnCI37522946610 all11 and ledger/LOC/Lighthouse/Encoding passed; actual
  5943backend (2425/2317/1201),369suites4014frontend,estate0silent.757fulfills752.
  755verifies754 publication and final PR body: PR246 OPEN/dev, no merge/deploy.
  Six new real layer/engine/hook controls retained; repaint/thresholds/retry
  unchanged. Native756: synthetic actual MapLibre60frames each small/desktop
  buffer, matrix16 and GL0, median cadence16.7ms. Query CPU cost observed;
  GPU completion/full-app/coast/Gulf/play/scrub/device acceptance ungraded.
  Native scene does not reproduce live low-FPS incident. Portable probe and
  receipts in audit/repair-2026-10-04;758publishes receipt/tooling only, served
  runtime/tests/workflows identical to a5. Unowned canary preserved/excluded.

- **2026-10-06 19:56Z: projection-boundary false fallback repaired locally751.**
  Owner750 attributes access to their browser;749 receipt7ef read back, no access
  repair claimed. Actual engine no-matrix callbacks drew nothing but tripped
  the guard: six new controls red twice; stamp fixed, repaint/thresholds/retry
  unchanged. Neighborhood83/full369suites4014tests, build/lint/LOC pass. Own752
  new-source hosted qualification pending;754 planned PR246 publication, no merge.
  Separate paused dev073 diagnostic smoke still tripped; valid startup matrix,
  FRAMEBUFFER_COMPLETE, observation overlapped local tests/build. Cause remains
  open; no native performance/Gulf/science acceptance or height inflation.
  RENDERER-PROJECTION-RESULTS.md. Unowned canary unchanged/excluded.

- **2026-10-06 17:30Z: owner-authorized PR243 is merged to dev; scan follow-up stays separate.**
  Dev073de1e2 from pinnedf405, own37501260553 all11/four supplementary,
  actual5906backend/369suites4008frontend;737records merge.741verifies served
  dev build/API healthy073de1e2 and Render commit; frontend productionfc140024
  stays frozen. Fresh map controls mount; style startup recovery still ungraded.
  no flags/provider settings changed.736verifies prior735 publication.
  Manifest selector ran on event loop:12fail24pass twice over20007entries;
  dark same-selector offload repaired locally37new/214expanded twice.
  HTTP deadline retains actual scan-thread lease. Other scans/CPU/live/Gulf/
  cloud/PG/science acceptance remain open.745fulfills739: own5b CI37504889852
  all11/four supplementary, actual5943backend/369suites4008frontend,estate0silent.
  follow-up PR246/source5b286f7a OPEN/dev, not deployed.742verifies740.
  Manual same-source encoding743 passed;746PR body read back.748verifies747
  receipt7b594b76, code-equal5b and own PR checks successful. Owner dev access
  report748: fresh HTTP200/root/map/asset, direct and proxied API healthy073,
  Chrome map and homepage mount; new map tab open/weather inactive. Exact
  prior error pending; current availability is not a proven fix. No redeploy.
  DEV-ACCESS-CHECK.md;749docs-only receipt readback follows.
  Paused GFS smoke744:1FPS trip/recovery/retrip with served/run metadata
  absent; current entry URL matches dev HTML. Waves then off; native/Gulf
  cause remains open. DEV-RENDERER-SMOKE.md. No guard override.
  Unowned canary preserved/excluded. MANIFEST-SCAN-RESULTS.md.

- **2026-10-06 17:03Z: zero UI and response/child ownership source9ba1 fully qualified.**
  Own37497929680/all11/four supplementary: actual5906backend/369suites4008
  frontend, estate297selected295produced0silent.734fulfills732/verifies733.
  Valid-zero UI and dark response/real-helper child gates qualify; no scientific
  math/flag/provider/merge/deploy/cloud-write action. GRID_RESPONSE_BOUNDS stays0.
  Dev connector restored730; readonly empty/private/RLS/grants preflight accepted,
  actual publisher lacks independent process Dev credential and remains unexecuted.
  Original Gulf/native/raster/play/scrub/device/FPS/heap, real latency/resource/
  producer, PG/card/race and disjoint science acceptance remain open. No GFS wave
  product locally. Unowned canary preserved/excluded.735receipt docs only.
  Static preview still0849, frontend tree identical to9ba1; latest served stamp/
  native pixels and shared API deployment are not accepted by that readback.

- **2026-10-06 16:41Z: first response/zero UI source0849 qualified; real-helper gate follows.**
  Own37494572374/all11/four supplementary: actual5901backend/369suites4008
  frontend, estate0silent;729fulfills727/verifies728, static preview0849.
  Actual series helper still multiplied canceled-hour work4-to1; follow-up
  repairs it locally54new/229expanded twice. Own732 hosted pending5906backend;
 733push pending. GRID_RESPONSE_BOUNDS remains0; no promotion/math/flag change.
  Dev connector restored:730fresh readonly private/empty/RLS/grants preflight.
  Actual publisher remains unexecuted without independent process Dev credential.
  Gulf/pixel/device/FPS/heap, PG/card/races, other producers/live resources and
  held-out science remain open. Unowned local canary preserved/excluded.

- **2026-10-06 16:15Z: zero-coordinate UI and dark grid response ownership repaired locally.**
  139mounted/point controls twice; full369/4008/build/ratchet pass. Grid49new
  controls/154expanded twice;57floor guards; shared643-file partition passes.
  New GRID_RESPONSE_BOUNDS remains0; no scientific math/activation/promotion.
  Own727 hosted pending (projected5901backend/369suites4008frontend);728push
  pending. Unowned canary excluded. Prior723 publication92a9 read back724.
  Gulf/pixels/devices/FPS/heap, real staging, PG/card/races and held-out science
  remain open. See log/2026-10-06-point-deadline-repairs.md and audit receipts.

- **2026-10-06 04:27Z: geographic runtime9a7a33ba fully qualified; receipt docs only.**
  Own CI37412065874/all11/four supplementary success;actual5852backend and368/3966
  frontend, estate297selected295produced0silent.720fulfills718/verifies719. Preview
  static HTTP200/build9a7; no map/forecast executed. API/outer-coordinate guards and
  world-cache aliases qualify; actual mounted three world aliases reach exact_success.
  Separate zero-coordinate UI truthiness gate remains open, reproduced twice; next
  with single-grid deadline/worker ownership. No real Gulf product or isolated PG
  target identified; actual cloud refresh still blocked. Gulf/pixel/device/FPS/heap,
  cloud/PG/card/deadline/science acceptance open; no promotion/flag/provider/write action.
  Unowned concurrent canary edit preserved/excluded.723docsreceiptpushpending.
  WORLD-COORDINATE-RESULTS.md and GRID-DEADLINE-DIAGNOSIS.md.

- **2026-10-06 04:04Z: server coordinates d65677ac qualified; shared world-copy candidate local/718pending.**
  Own CI37410583036/all11 and four supplementary success, actual5852backend and
 367/3872frontend, estate297selected295produced0silent.716fulfills714/verifies715.
  Shared point fetch/cache canonicalize world longitude with existing helper;94new
  controls72fail22pass before twice;122expanded after twice/full368/3966 pass.
  Build exit0 inherited warnings; lint86/917 baseline unchanged; LOCpass. Frontend
  floor368/3966; no science math/flag change, disabled legacy endpoint preserved.
  Original Gulf/full-map/device/FPS/heap, actual cloud/OAuth, PG/card, deadlines and
  held-out science remain open; no merge/deploy/cloud/provider action.719pushverified720.
  POINT-COORDINATE-RESULTS.md and WORLD-COORDINATE-RESULTS.md.

- **2026-10-06 03:45Z: WS-08 HTTP coordinate repair locally accepted; own714 hosted pending.**
  Actual router64invalid/24valid before twice;142expanded after twice; rejects impossible
  and nonfinite coordinates before resolver. Valid geographic endpoints/Gulf/frame
  identifiers unchanged; no served scientific number or frontend runtime change.
  Estate297files/+88controls; projected5852backend and367/3872frontend awaits exact CI.
  Paired estate floor1199/reference1201; frontend actual hosted367/3872 now pinned.
  Local environment differs from declared CI; LOC and partition pass. Dev OAuth
  refresh still fails before readonly SQL. Server deadlines, Gulf/full-map/devices,
  actual cloud publication, PG/card and science remain open. No merge/deploy/flag action.
  Publication711 verified712; WS-08 publication715 verified716; POINT-COORDINATE-RESULTS.md.

- **2026-10-06 03:26Z: both visual and dark actual-time repairs qualified on source48c04424.**
  Own CI37407541898: all11 jobs and four supplementary success; actual5,764backend
  and367suites3,872frontend; estate296selected294produced0silent. Ledger710fulfills708
  and verifies709publication. Independent15,000-case opt-in matrix passes twice;
  same-clock430holds2,570commits, actual changed/unknown times release each3,000.
  Preview ready, static service-worker BUILD_VERSION48c04424/HTTP200; no map/forecast
  code executed, no dev/production promotion or scientific activation. Source fixes
  idle/loading FPS evidence, completed recovery ownership, safe storage, GL failed
  initialization cleanup/caller fallback, raster resolution and actual-time guards.
  Original Gulf/data/pixel/native/raster/mobile/FPS/heap, Dev publication/OAuth,
  PG/card/latency/held-out science remain open. Production freeze retained. Final
  docs-only publication711 verified by712; runtime/workflow bytes stayed48c04424.
  FRONTEND-FRAME-TIME-RESULTS.md and VISUAL-RESILIENCE-RESULTS.md.

- **2026-10-06 03:07Z: visual a1cb1ed3 qualified; separate WF03 actual-time source local/708pending.**
  Own CI37405974317/all11 and four supplementary success, actual5764backend/365/3808frontend;
  706fulfills704 and verifies705publication. WF03 reproduced with actual servedtime, not
  requestecho; guard/subcover/arbiter/shadow and bounded grace repaired behind existing
  forecastidentity0/unset.64newcases142expanded twice/full367suites3872, build/ratchet/LOC
  pass; Chrome14synthetic production-module controls pass without externalapplicationtraffic.
  New707evidence/708commitment/709publicationpending. Prior visual qualification is not
  borrowed for this delta. Original Gulf/frame/pixel/mobile/FPS/heap, cloudcanary/OAuth,
  PG/card/latency/science remain open; no merge/deploy/provider/cloud/flag action.
  FRONTEND-FRAME-TIME-RESULTS.md and VISUAL-RESILIENCE-RESULTS.md.

- **2026-10-06 02:47Z: visual resilience source locally accepted; own704 hosted pending.**
 WF02 idle/loading exclusion and completed-retry ownership, WF04 safe storage decisions,
 WF06 shader/program batch cleanup and actual caller fallback, raster/native resolution
 label fixed.62newcases135expanded twice/full365suites3808tests, build/ratchet/LOC pass.
 Two actual local Chrome/AMD WebGL2 init/link/dispose/failure probes pass; no fullmap/
 physicalforecast/device/FPS/heap claim. New owner logs:12x1FPS trip and recovery2/2, no
 captured hard error; no user interactions since Gulf screenshot; true drawing state unknown.
 Prior543954fd receipt readback700 resolved701, owner702/source703/commitment704/push705.
 Fresh Dev OAuth refresh fails before SQL; actual canary/PG/card/science still open.
 Same PR source push follows; productionfreeze/newscienceflags preserved, no merge/deploy.
 VISUAL-RESILIENCE-RESULTS.md; inherited lint86/917, not clean lint. Next: absolute-frame
 rollover guard WF03, actual Gulf/native/raster playback acceptance, publication/cloud/
 financial/latency/science gates. Previously qualifieda268 does not qualify this delta.

- **2026-10-06 02:16Z: cache/cycle sourcea268d804 exact hosted qualification accepted.**
 CI37401821405 all11success: actual5764backend2425/2226/1113,360suites3746frontend;
 estate296selected294produced0silent; allfour supplementary gates success. Ledger699
 fulfills694 (695corrected interim2224 projection). Final90newtests/544expanded twice.
 Pending receipt delta documentation/ledger only; final source-equivalent publication
 readback700 follows commit/push. Newflags0/unset, Netlifyfreeze, no merge/deploy.
 WI01 same-metadata/missingpath/cross-process/cloud acceptance and WI06 live capacity
 remain open. Fallback label reproduced unpatched;126hour log quality switch lacks
 resident/pixel proof. Actual Gulf/playback/device/performance, Devcanary/PG/card/
 held-out science open. CACHE-CYCLE-REPAIR-RESULTS.md; broad lint debt unchanged.

- **2026-10-06 02:04Z: cache/cycle sourcea268d804 published to PR243 OPEN/dev.**
 CI37401821405 running; own694 pending;90newcases544expanded twice,5764backend projection.
 Two local20kmanifest/14842cell probes: guardwarmmedian0.0471/0.0463ms, initialindex102ms,
 changedrefresh88ms, unchanged0remote. Not cloud/sharedRender acceptance. Separate actual
 LegendTicks SSR twice confirms native223km shown while engine absent in raster fallback;
 sourcefix/actual pixels not done, Gulf cause unproven. Newflags0/unset, productionfreeze
 preserved; no merge/deploy/cloud/UI/served-number action. Ledger696-697; current receipts.
 Receipt delta source-equivalent; hosted source gate must be completed, not borrowed.

- **2026-10-06 01:52Z: WI01/WI06 source repairs locally accepted, dark; own hosted694 pending.**
 90newchain cases, predecessor69fail21pass twice;544expanded including floors twice, scoped
 lint/LOC/partition pass. Final unit/vector safeguards and count update recorded695. PRODUCT_REVISION_REFRESH/INGEST_PRUNE_VERIFIED_CYCLES0/unset. WI01
 partial: same-metadata byte rewrites and cross-process/wire identity remain. WI06
 prune/reconciliation uses verified cycles, preserves unique coverage/unknowns/tails.
 Prior6a5c5f23 CI37399663979 all11success5674backend/3746frontend, supplementary success
 resolves691receipt readback; not newsource qualification. Projection5764backend2226chain.
 No merge/deploy/cloud/flags/served-number change. Actual Gulf/native/fallback/playback/
 performance, Dev canary/PG/card/science open; freeze preserved. Ledger692-694;
 CACHE-CYCLE-REPAIR-RESULTS.md. Same-PR push follows local gates.

- **2026-10-06 01:29Z: sourced4046562 retry hosted-qualified; all new ingestion guards dark.**
  CI37398137575 all11success: actual5674backend2425/2136/1113 and frontend360/3746;
  estate296selected294produced0silent; supplementary success. Fulfilled686, ledger690.
  WI05 sourcea3b321f0 separately5642/3746; resident/WI04 ff5 separately5604/3746. Pending
  delta documentation/ledger only, source-equivalent. No merge/deploy/flags/served-number change.
  Next repairs: WI01 stale disk revision, WI06 duplicate-cycle ranking, actual graphics fallback
  provenance/time/palette and Gulf pixel/frame/performance acceptance. Current existing tab
  shows fallback, original screenshot path still unknown. Dev canary unexecuted: current OAuth
  refresh fails before SQL; private Storage runtime also required. PG/card/science and broader
  audit remain open; Netlify latest preview canceled, production freeze preserved. Receipts/log updated.

- **2026-10-06 01:21Z: retry sourced4046562 published; exact686 pending.**
  PR243 OPEN/dev/body verified; CI37398137575 running, supplementary gates success.
  Netlify status says canceled preview, not deployment. Current Dev readonly SQL failed OAuth
  refresh before execution; earlier empty/private preflight historical, actual publisher canary
  still unexecuted. Public discovery valid200 does not certify refresh/query access. No SQL/
  storage/schema/provider/flag/merge/deploy write. Sourcea3b321f0 qualified5642/3746. WI01 and
  duplicate cycle ranking remain open; WI06 retry partial. Ledger687-688; release/operator receipts.

- **2026-10-06 01:12Z: WI05 sourcea3b321f0 qualified; WI06 retry local/dark partial repair.**
  CI37396359484 all11success, actual5642backend2393/2136/1113 +frontend360/3746,
  estate0silent, supplementary success; fulfills679/ledger684. New retry67focused/347expanded
  twice pass;32new guards, selector186/floor2419/ref2425; projection5674backend, own686 pending.
  NOAA_WAVE_CYCLE_RETRY default0/unset; no provider/workflow activation. Actual duplicate sweep
  independently2fail twice: late older known cycle deletes newer; ranking remains open, WI06
  partial. WI01 disk repair and Gulf/native/cloud/PG/card/science remain open. Ledger685-686;
  WAVE-CYCLE-RETRY-RESULTS.md. No merge/deploy/cloud/served-number/flag change.

- **2026-10-06 00:56Z: WI05 sourcea3b321f0 published to PR243 OPEN/dev.**
  CI37396359484 running; exact qualification679 pending. Ledger/LOC/encoding success.
  Predecessorff5cfc98 qualified5604backend/3746frontend; it does not certify WI05.
  WI01/WI06 remain open; next-repair cache/concurrency/validation and bounded retry matrix
  recorded in CACHE-CYCLE-NEXT-REPAIR.md using actual code and primary docs. No source or
  activation for those proposals. No served-number/merge/deploy/flag/cloud action. Ledger682-683.

- **2026-10-06 00:52Z: resident sourceff5cfc98 hosted-qualified; WI05 next source pending679.**
  All11 CI37394319031 success; actual5604backend2393/2098/1113 and frontend360/3746,
  estate296selected294produced0silent; supplementary gates success. Fulfilled673, ledger680.
  New WI05 local guard/default0 and38tests are not certified by this predecessor.
  WI01 full/stride2 stale disk independently reproduced2fail twice; corrected WI06 transient
  cycle fallback2fail/1control twice,6h older run. Both repairs open; ledger681. No actual Gulf
  cause or separate new-run-time stamping proof. No deployment/flag/cloud/provider action.

- **2026-10-06 00:43Z: WI05 invalid replacement write guard locally accepted, dark.**
  Real L1/simulated L2 loss12fail twice; corrected tracked22fail/16pass twice.153focused/
  283expanded twice pass; valid zero/partial grids/negative weather retained. Rejected uploads
  cannot count current success. INGEST_REJECT_INVALID_FRAMES default0/unset; registered, no
  workflow/provider activation. New38chain, selector154files; floor2130/ref2136; projection
  5642backend and unchanged360/3746frontend. Newsource hosted679 pending. ff5cfc98 Gulf/prune
  predecessor673 still awaits final guards; actual2098chain1113estate3746frontend confirmed.
  No served number/skill gain, merge/deploy/provider/cloud/live-map/flag action. WI01/WI06,
  actual Gulf/native/mobile/performance, Devcanary/PG/card/science open. Ledger678-679;
  INGESTION-FRAME-VALIDITY-RESULTS.md; existing deployment-readiness sessionlog.

- **2026-10-06 00:27Z: Gulf resident diagnostics and dark WI04 locally accepted.**
  Actual resident/point receipts, stale diagnostic clearing, HUD refusal and compact pasted JSON.
  Eightbeforefail twice; stale twofail twice; HUD twofail twice. WI04 real provider/save collision
  sevenfail twice; three prune paths protect only unreferenced deletion with explicit flag1.
  Default0/unset, registry records it; manifest selection null in three fixtures. No source activation.
  Fullfrontend360/3746;250frontend/245backend expanded;63prune focused repeated. New27chain;
  projection5604backend2393/2098/1113, hosted commitment673 pending. Predecessor191qualified
  does not certify newsource. Four broad-lint findings in unchanged files explicit; changed lint clean.
  No served number, live map/cloud/provider write, merge/deploy or scientific gain. WI01/WI05/WI06,
  actual Gulf frame/pixels/native/mobile/performance, Devcanary/PG/card/science remain open.
  Sourceff5cfc98 published/read back OPEN/dev; CI37394319031 running, supplementary ledger/LOC/encoding success.
  GULF-RESIDENT-PRUNE-RESULTS.md; sessionlog2026-10-05-deployment-readiness; ledger672-677.

- **2026-10-05 23:49Z: ingestion source1912639b hosted-qualified; Gulf capture incorporated.**
  CI37388965928 all11SUCCESS; actual5577backend=2393guards2071chain1113estate,
  frontend356suites3700tests;296estate selected294produced0silent. Supplementary gates
  success. Commitment664 fulfilled; local67/216twice retained. WI02/WI03 source repaired,
  no product-selection/served-number/science activation; monitoring warnings unconditional.
  Gulf stale badge/world181x82 atzoom7.28 observed; later absolute frame/cycle/product/cells
  not captured. Corrected offline19ft=>18.913ft/three themes/interpolation probe twice;
  8focused suites98tests pass. Not native pixels or proof of expected storm height.
  Actual Dev publication, PG/card, native full-map/performance and science remain open.
  No merge/deploy/provider write; productionfreeze/newflags preserved. Current receipts:
  INGESTION-REPAIR-RESULTS.md,GULF-HEATMAP-DIAGNOSIS.md; log2026-10-05-deployment-readiness.
  Ledger666-671; receipt5d36b304 and PR243 description published/read back.
  Runtime/CI-test/workflow source unchanged1912639b; documentation-head checks pending.

- **2026-10-05 23:30Z: remaining WI02/WI03 ingestion/health repairs locally qualified.**
  WI02 fivefail/fivepass twice; WI03 sevenfail/seventeenpass twice before. After67controls
  and216expanded twice; fatal lint/LOC648<=800 and36floorcontrols pass. Actual current
  product acknowledgments/bounded drain; verified cycle freshness and explicit unknowns
  per global component/tier/tile/native-estimate cohort. No served-model/value change.
  Health warnings for unknown/stale provenance are unconditional in candidate; no activation.
  New51cases:33guards/18chain; projected5577backend2393/2071/1113, frontend3700 unchanged.
  Source not yet hosted-qualified: commitment664. Earlierf48d15e6 green does not certify it.
  Actual Dev canary/full-map/PG/card/science acceptance remain; productionfreeze preserved.
  INGESTION-REPAIR-RESULTS.md; log/2026-10-05-deployment-readiness.md; ledger663-665.

- **2026-10-05 22:44Z: sourcef48d15e6 hosted-qualified after the gallery/lane correction.**
  CI37381706714 all11SUCCESS:5526backend=2360/2053/1113;356suites3700frontend.
  Estate296selected/294produced/0silent; supplementary ledger/LOC/encoding/Lighthouse success.
  Local152pass/new8repeat. Failed59dd3d26 floor result remains explicit;659 fulfilled660.
  Live read-only PostgreSQL13required tables514columns/no missing; three source/database
  heads match. Column/revision preflight only, not type/constraint/card/concurrency proof.
  Native isolated desktop/phone exact-frame buffering and three themes/calendar accepted;
  native WebGL2 state/exception/framebuffer/dimension probe passed/error0. Actual map pixels,
  hardware FPS/heap, cloud publication, PG financial/card and science acceptance stay open.
  Dev preflight empty/private/RLS; secure terminal launcher/operator guide prepared, owner
  JSON receipt pending. Netlify lockfc140024 preserved; no merge/deploy/flag/provider writes.
  RELEASE-GATE-RESULTS.md; log/2026-10-05-deployment-readiness.md; ledger657-662.
  Receipt57f47923 and PR description published/read back; application/test/workflow source
  unchanged from qualifiedf48d15e6. New docs-head checks pending at publication.

- **2026-10-05 22:16Z: hosted floor caught a lane-projection mistake; corrected without lowering.**
  Source59dd3d26 actual estate1105, not projected1109; unset controls belong to chain2053.
  Estate floor1107 failed while its tests passed. Eight new gallery/session collision controls
  bring projected estate1113/floor1111; chain2053/floor2047. Local152pass, new eight repeated
  pass. Prior failed exact-source qualification is recorded, not promoted; successor pending.
  Native isolated desktop/phone playback holds until exact frames arrive; three themes/calendar
  checked. Actual map pixels/native GPU/heap/performance remain open. Visual instrument repaired.
  Render live build used stamp heads versus current upgrade heads: actual schema verification
  remains a release gate even without migration-file delta. No merge/deploy/provider activation.
  RELEASE-GATE-RESULTS.md; log/2026-10-05-deployment-readiness.md; ledger653-656.

- **2026-10-05 22:00Z: gallery queue extension and actual unset defaults locally qualified.**
  Six defects reproduced twice; shared surfer/photographer/scope query now covers queue,
  items, redemption and sweep.87focused/144expanded pass; ten new gallery cases plus four
  unset-default cases; estate projected1109/floor1107, hosted confirmation pending.
  Authenticated Render dev/On Commit readback confirms shared API merge impact and empty
  health path; live lightweight /api/health/simple HTTP200. Netlify lockfc140024/main and
  actual preview Node24.21.0 confirmed; new provider flag overrides absent, secrets masked.
  Prior docs4a7671a9 CI37377554458 all11success; new source needs own qualification.
  Publication canary/PG/card/native/science acceptance still open. No merge/deploy/activation.
  RELEASE-GATE-RESULTS.md; log/2026-10-05-deployment-readiness.md; ledger651-652.

- **2026-10-05 21:36Z: updated audit reconciled with current PR243 source13f6d0a9.**
  PR244 already merged four blocker fixes into the repair branch, not dev. Current application
  CI37357966896 all11success:5504backend and356suites/3700frontend; independent20backend/
  29frontend pass. Separate hosted ledger check failed on missing242; reconstructed242/244
  receipts appended646/647; docs838514dc hosted ledger37377273489 SUCCESS.
  Current PR description/readiness receipt published; newest full application checks pending.
  Live API6b062e97, dev frontend2a7b8615, prod frontendfc140024, preview13f6d0a9.
  Scoped Dev Supabase tools work and empty/private/RLS preflight confirmed; actual-source
  publication canary still unexecuted. Provider lock/settings/effective flags not authenticated.
  Main required-check name still18.x; code emits24.21.0. No deployment or activation.
  DEPLOYMENT-READINESS.md separates immediate release gates from dark-feature acceptance.
  Session log: log/2026-10-05-deployment-readiness.md; ledger646-650.

- **2026-10-05 03:14Z: deep-audit source d1cc16fe hosted-qualified.**
  CI37257237630 all11success; actual5484backend=2360/2049/1075 and356/3689frontend.
  Estate294selected/292produced/0silent; all36new controls executed; supplementary
  LOC/ledger/encoding/Lighthouse success. Commitment641 fulfilled in ledger644.
  Current WI02/WI03 diagnosed twice, unrepaired; old83-ID and50-row scopes retained.
  Runtime/workflows unchanged in receipt work. Production/science stay frozen;
  cloud/deadlines/hub/ingestion/GPU/PG/media/Stripe/held-out acceptance remain open.

- **2026-10-05 02:50Z: deep-audit security/trace/actor source locally qualified.**
  Owner-supplied83-ID audit retained separately; current push/Gemini/trace/actor defects
  reproduced and repaired.36new/166expanded pass; point Jacobian6pass twice; no science
  activation. Earlier alert source6c355cb2 CI37253656301 all11success/backend5448 and
  frontend356/3689. New source hosted pending; original eight no-source rows and cloud,
  deadline/hub/ingestion/GPU/p95/PG/science acceptance remain. DEEP-AUDIT-RESULTS.md.

- **2026-10-05 02:03Z: final alert owner source6c355cb2 published on PR243.**
  Exact head read back OPEN; PR description updated. Prior cooldown sourcef995dae4
  CI37252419546 all11jobs success:5427backend=2360guards+2049chain+1018estate,
  356/3689frontend;290estate selected/288produced/0silent; existing66skip/1xfail.
  Final owner extension69new/182expanded locally accepted; CI37253656301 running.
  No source qualification inferred from the earlier run for changed actor handlers.
  Source41rows including partial/eight rows without source; remaining acceptance in
  PROGRESS.md and ALERT-RESULTS.md. No merge/deploy/activation/provider writes.

- **2026-10-05 01:57Z: SEC08 alert actor boundaries also locally qualified.**
  Create/list/edit/delete/share/manual-check bind JWT and source owner; scheduler retains
  all owners. Manual5fail and config13fail/6pass before twice each; current69new controls/
  182expanded/25repeated HTTP controls pass, no skips; fatal lint/LOC accepted. Cooldown source
  f995dae4 published/read back on PR243; final actor extension hosted pending. Frontend
  unchanged from qualified356/3689. Source coverage41including partial/eight source rows open.
  Preferences/outbox/PG/provider and broader financial/device/science acceptance remain.
  Production/science frozen; no provider writes, merge/deploy/activation.

- **2026-10-05 01:35Z: SEC08 partial delivery repair locally qualified on PR243.**
  Actual emitters/SQLite16fail/7pass before twice;48new controls,63delivery/quality and161expanded
  pass. Shared conditional SQL cooldown claim+notification transaction; push after commit,
  forecast I/O before writes, finite/missing/zero bounds and visible server cadence. Build/lint/LOC
  accepted; full frontend356/3689 accepted, hosted pending. Source coverage41rows including partial, eight rows
  without source. Preferences/outbox/PG/provider/actor and broader acceptance open. OAuth remains
  authenticated; owner only reopened chat, full Codex restart/tool reload still needed.
  No merge/deploy/provider writes or weather/science activation. See ALERT-RESULTS.md.

- **2026-10-05 01:11Z: Dev-scoped Supabase OAuth succeeds after narrow endpoint recovery.**
  Both public discovery hosts use normal Google Trust Services TLS and200/exit0. Owner
  approves OAuth, CLI login exit0; outside-sandbox MCP list explicitly reports enabled/OAuth.
  Current tool snapshot still lacks Supabase; reload Codex and reopen this same chat, then
  verify project-scoped tools. Actual-source cloud canary and runtime credential path still
  pending. No provider data/config writes, merge/deploy/activation or global protection disable.

- **2026-10-05 01:02Z: remaining source4eac3550 hosted-qualified at receiptd7b10451.**
  CI37248136689 all11jobs success; frontend356/3689, backend5379 (guards2360, chain2049,
  estate970;289selected/287produced). Existing skips/xfail retained, no new exclusions.
  Source fingerprints unchanged; no merge/deploy/activation/scientific accuracy claim.
  Owner confirms API Website/Domain exception saved, but TLS remains Avast-inspected and
  OAuth discovery fails. Narrow URL format retest pending; connector unauthenticated.

- **2026-10-05 00:32Z: remaining-workgroup source checkpoint locally qualified.**
  Fourteen additional rows source-covered (partial scopes retained), nine source rows and external
  acceptance open.160new backend/280expanded+2legacy skips/68CI controls pass;356/3689frontend,
  Node24production build/lint ratchet/LOC accepted. Projected5379backend; hosted candidate pending.
  Existing separate Dev staging target verified empty; source canary prepared, not executed.
  Dev-scoped local Supabase MCP registered, OAuth discovery decoding failed; runtime access open.
  All new served switches off; no merge/deploy/activation/cloud data writes. Report:
  `audit/repair-2026-10-04/REMAINING-BATCH-RESULTS.md`.

- **2026-10-04 22:49Z: PF01/PF02 browser source21db8ee8 hosted qualified on PR243.**
  Three limiter-owned requests, latest regional intent, reusable global work, safe A/B/A owners;
  shared48entry/32MiB estimated cache, expiration/recency. Both new frontend flags default off.
  Final351/3647frontend,90neighbors twice; CI37241546337 all11jobs accepted/5219backend.
  Supplemental encoding/ledger/LOC/Lighthouse/Netlify preview accepted; no new skipped coverage.
  Prior e4353c06 CI37240056010 all11jobs success: backend5219/frontend3610; AS06 canary open.
  No merge/deploy/activation/live load. Next PF03/PF04 and service/device/GPU acceptance.
  PF03 actual-route40trial diagnosis/finite-guard prototype recorded; runtime repair remains next.
  See `audit/repair-2026-10-04/PERFORMANCE-RESULTS.md` and `PF03-DIAGNOSIS.md`.

- **2026-10-04 22:09Z: AS06 immutable publication source locally qualified on PR243.**
  Unique/create-only uploads, exact acknowledgment before insert/CAS, designated writer gate;
  no immediate ambiguous-candidate deletion, bounded age/generation cleanup.16before controls
  9fail/7pass twice; after148expanded neighbors/floors twice;39new guards, projected2327/backend5207.
  Source32a33138 ledger gate rejected a date-only expansion row; original retained and explicit
  correction recorded. Precision-aware checker12estate controls; projected backend5219.
  Hosted follow-up e4353c06 CI37240056010 accepted all11jobs/5219backend; actual Supabase canary
  pending; MANIFEST_IMMUTABLE_PUBLICATION=0. Original date-only row retained and hosted checker accepted.
  Prior649cb14e full CI37231405906 success. No merge/deploy/activation; live source6b062e97.
  Next source work PF queues/cache/encoding. See `audit/repair-2026-10-04/MANIFEST-RESULTS.md`.

- **2026-10-04 19:55Z: SH04/SH05/SH06/W04 source40cd1ddd hosted qualified on PR243.**
  Daily UTC calendar/size ladder, current-only work bounds and typed terminal Copernicus failures;
  frontend347/3610, supported backend195, lint/LOC/build accepted; CI37230181942 success11jobs.
  Full backend5168pass: chain1982, guards2288/66skipped/1xfailed, estate898/0silent; source fingerprints
  match40cd1ddd. Current Jacobian6controls twice; final timezone47NY/47Auckland. AS06 defects
  rechecked twice offline; source repair remains next. Ledger600 publication read back at40cd1ddd.
  Source flags default off; no merge/deploy/activation or live p95/GPU/science claim. Prior receipt
  0fb75c8e CI37227786046 completed/success, superseding ledger596 pending publication.
  Next AS06 publication, then PF work bounds and device/science acceptance. Full register/progress:
  `audit/repair-2026-10-04/PROGRESS.md` and `HUB-COPERNICUS-RESULTS.md`.

- **2026-10-04: ordered point/availability/consumer/playback source5afa0c82 hosted qualified on PR243.**
  W01/W02, M01/M02/M03, SH01/SH02/SH03 and owner PB01 controls pass; final frontend346/3582,
  focused backend171, lint86existingerrors/917warnings, production compilation and LOC accepted.
  Actual all-theme desktop/390px-phone component fixture holds0 until exact delivery then6;
  no horizontal overflow. Full map/GPU/cadence canary remains open. CI37226218002 completed/
  success: frontend346/3582; backend5128 passed (guards2288/67documentedskips, chain1951/0skips,
  estate889/0silent); all11jobs accepted. Central differences6pass twice show requested/hint
  derivatives0/1 legacy to1/0 repaired, no skill claim. Receipt preserves source fingerprints.
  Local full backend collection crashed with a Windows native access violation; no acceptance inferred.
  All new served-value flags default off; no merge, deployment or activation. Prior source d67763d5
  CI37207402431 completed/success, superseding its dated pending claim below. Follow
  `log/2026-10-04-point-availability-playback.md` and `audit/repair-2026-10-04/POINT-PLAYBACK-RESULTS.md`.

- **2026-10-04 13:50Z: owner defers beta app access-code rotation and authorizes continuing repairs.**
  AS-01 stays open. Second batch repairs W-03 canceled series retry/prefetch and W-05 estimate
  basis mapping locally;23fail/5pass before twice,28pass after in163neighbor controls twice;
  full local frontend337/3468, lint ratchet and production compilation pass. Source d67763d5
  published/read back at PR243; hosted frontend test/build/discovery and composition/lint accepted
  in CI37207402431. Two longer backend lanes still running; explicit hosted totals await logs.
  No served number/science flag changes. Follow `log/2026-10-04-series-boundaries.md` and
  `audit/repair-2026-10-04/SERIES-RESULTS.md`; prior first-batch docs CI37180513517 also green.

- **2026-10-04 05:38Z: first independent repair batch source88feec8c accepted; PR243 ready for review.**
  Owner authorized repairs/testing/visual improvement. Ledger559-581: qualified locker/media authority,
  gift/quota relationship and marine mask contracts repaired; no merge/deploy/science promotion.
  Two proven credential-bearing CI artifacts removed/read back absent; access-code rotation remains.
  Follow this session in `log/2026-10-04-independent-repairs.md`; all audit rows tracked in
  `audit/repair-2026-10-04/PLAN.md`. PR243 sourceCI37179486193:19checks18success1neutral;frontend335/3440;backend5095passed.
  ActualWebGL2 and three-theme phone/desktop/focus contracts pass. Receipt update is docs only;
  coastline/device performance, PostgreSQL concurrency, media migration and code rotation remain open.

- **2026-10-04 01:54Z: owner-authorized ICON stored tail live on dev only at6b062e97 (PR241).**
  Actual Netlify/backend accepted; emitted primary-grid bypass true twice, preview dark twice,
  publicfrontendfc140024 unchanged twice. Versioned exact-context+branch export, no remote env saved.
  Secondary swell and other scientific flags unchanged; separate exact-point tail remains legacy.
- **Actual paired acceptance:** build scope2fail/10pass before twice→37pass after twice;
  source25 and built-field12 paired controls accepted. Regional5case HTTP before/after twice
  all200/nonzero; ICONestimated fields/source preserved. Two fresh default-guardrail pages
  draw own field at179, but lowFPS/served-time warnings remain; no sustained GPU closure.
- **Exact-head241 frontend330/3399 and focused8/121; deployed full CI2288/1918/816.**
  Actual deployed E2E63expected/0unexpected/0flaky/9skips,HTMLtrue; CIguardrail exemption
  and skipped GPU/browser controls remain. Prior240E2E62/1flaky/9skips retained as history.
- **Actual repaired-label monitor after twice at6b: OK,178637 rows loaded/47071 targets.**
  Manual read-only runs37168663163/37168736488, not scheduled-run acceptance. Scalarpaired
  n659/443/440 has differing populations; no promotion and commitments149/309 remain open.
- **Still open:** default GPU performance/original-owner causality, source-hour/point parity,
  spot-hub populationp95≤5s, broader gallery/privacy/payment boundaries and scientific heldouts.
  All-route p95upper2500ms/max25929.4ms does not close spot-hub SLO.

- **2026-10-04 01:57Z: report and canonical receipts published in docs-only PR242.**
  Open against dev; hosted docs checks pending. Functional241 remains live at6b062e97.

## Earlier checkpoint snapshots (historical; pending statuses superseded only by measured Now)
- **2026-10-04 01:25Z: PR240 actual live after accepted twice.** Renderlive760eea1d; healthhealthy,
  badge401 and unsigned unrelated Stripe400 twice. RSS633.2/632.9MB. Signed processor
  and real customer fulfillment unverified; all-route latency is not the spot-hub SLO.
- **2026-10-04 01:25Z: PR241 exact00549cc2 pending weather guards and prior dev E2E.** Hosted frontend
 330/3399 andfocused8/121 match; emitted dev flag before is unset. Paired regional
  stored products all200/nonzero but estimated, including168-hour dispatch control.
  Legacy exact-point browser estimate above168 remains; grid rollout does not close it.
- **2026-10-04 01:25Z: PR239 browser62expected/1flaky/9skips, HTMLokfalse.** Chrome hub retry and
  excluded default GPU acceptance remain open; retained browser BUILD4ff is stale,
  not new-deployment evidence. Fresh after pages and actual deployed flag still pending.
- **2026-10-04 01:08Z: PR240 merged dev760eea1d.** Exact56aa0477 hosted2288/1918/816, all
  checks green; actual deployment and two unsigned negative after controls pending.
- **2026-10-04 01:08Z: dev-only ICON build scope prepared.** Netlify rejected reserved branchdev
  variable override; canceled with no env saved. Versioned build condition enables only
  CONTEXT=branch-deploy AND BRANCH=dev. Before2fail10pass twice; after scope+source37pass
  twice. Frontend expected330/3399; floors299/2916. Not yet deployed; two live checks pending.
- **2026-10-04 01:01Z: owner explicitly authorized dev-only ICON stored-tail enable.** Exact dev
  branch value true; production/previews and other flags excluded. Netlify form prepared but
  not yet submitted; two live after checks and deployed-bundle readback pending.
- **2026-10-04 00:42Z: ICON PR239 merged dev22f84f99, default-off.** Exact5a79582f all gates green:
  frontend329/3387,focused8/121; backend2286/1918/810. No flag or Netlify environment changed;
  actual deployment/full browser after pending. Promotion/accuracy and default GPU fallback open.
- **2026-10-04 00:42Z: monitor label and Stripe authority next checkpoint.** Correct combined archive
  population to rows loaded; remove unreachable duplicate root Stripe route while retaining first
  canonical signed handler. Isolated before/after twice; actual45pass twice5.72/5.29s.
  No payment call/customer write or actual scheduler invocation. Expectedguards2288/floor2282,
  chain1918/floor1912,estate816/floor814; new estatefile, backend613tracked. Hosted/live pending.
- **2026-10-04 00:42Z: selection565 full acceptance read back.** CI2286/1918/810; browser63expected,
  zero failures/retries,9existing skips,HTMLoktrue. Does not close excluded GPU controls or5s SLO.
  Public calibration has ops and GFS_SCALAR +24/+72 n1 each; insufficient for promotion.
  Existing012precompute success417buoys MAE.188m,1773spots6frames,0matched reports; no
  next scheduled accuracy-monitor success yet, commitments149/309 remain open.
- **2026-10-04 00:17Z: quota PR238 merged and live dev56544d2a.** Checked664d93ef all gates green:
  2286 weather guards,1918 chain,810 estate; actual Render Live and health200/badge401 twice.
  All five anonymous selection endpoints401 twice using absent synthetic IDs. Live foreign/
  owner customer flows remain unverified. Broader gallery/session/concurrency issues stay open.
- **2026-10-04 00:17Z: ICON source repair built dark; no serving promotion.** Default-off
  REACT_APP_ICON_STORED_TAIL chooses stored waves/swell1/windwaves instead of a browser
  re-estimate. D-003 secondary swell unchanged. 25controls before17fail8pass twice ->25pass
  twice;12same-built-field controls before9fail3pass twice ->12pass twice. Actual package37pass
  twice plus176companions. Stored h179 three layers182vectors each: old146/141/146 cells
  changed; candidate0; local stored-target derivative0->1. Not forecast accuracy or owner
  graphical cause. Hosted/dark deploy pending; default FPS fallback and source-hour issues open.
- **2026-10-04 00:17Z: weekly012 deployment and browser read back.** Render Live and health200/badge401
  twice; postmerge CI2286/1918/785. Browser62expected/0unexpected/1flaky/9skips,HTMLokfalse.
  Retained MobileSafari retry real spot6.862s; initial cause unassigned. Latest565 spot n1
  12.870s still misses owner5s; no population-p95 closure. No actual scheduler/email sent.
- **2026-10-03 23:42Z: weekly PR237 merged dev012d1e1e at2026-10-03T23:36:45Z.** Checked509dfdc6
  allhostedgreen2286/1918/785; actualweeklydeploy/browserafter pending. Priorlatency4ff
  RenderLive/health200/badge401 twice; histogram p95 evidence live, smalln3tail>=10s misses5s.
  Full4ffbrowser62expected/0unexpected/2flaky/8skips, HTMLokfalse; reliability remains open.
- **2026-10-03 23:42Z: ICON availability and graphics separated.** Two bounded5case HTTProunds all200
  andnonzero at4ff; hour179threeICONlayers estimated. ICON168anchor itself is estimated,
  notnative atthatrequestedUTC. Freshbrowser179oneownfieldrecovery, secondlowFPS fallback
  tothirdparty9FPS12consecutive seconds; ownerlogcontainsnoFPS. Sameownerrootcauseunproved.
  Do notremoveguardrail/existinghiddenfocus exemptions orspeculativelyalterphysicalforecasts.
- **2026-10-03 23:42Z: five manual selection routes ownership repaired locally.** JWTfirst; queue binds
  requesteduser and4quota endpoints checkactualquotaowner beforeitems/preference/deadline
  mutations. Before16fail9pass twice ->25pass twice, actualpackage25pass twice. Expected
  estate810/floor808/281files; guards/chain unchanged. Liveafter/hosted pending; broader
  sessionbrowse/claims/duplicateitems/concurrentquota/autoexpiryownership still open.
- **2026-10-03 23:18Z: latency PR236 merged dev4ff10cc4 at2026-10-03T23:16:00Z.** Exact44a92394
  all hosted gates pass:2286guards/1918chain/781estate; actual telemetry deploy/readback pending.
  Identityfcea actual RenderLive, health200/badge401 twice; fouranonymous identity boundaries401
  twice; full E2E63pass/0fail/0flaky/9existing skips, HTMLoktrue. Live JWTowner/foreign unverified.
- **2026-10-03 23:18Z: owner ICON long-range heatmap incident captured.** Suppliedconsole switches ICON
  at hour179; waves/swell/windwaves repeated cache misses and retained181x80 world surface;
  one swell2 blend returns. No owner buildSHA/time or completed waves upload establishes cause.
  Investigate model/layer/hour, availability and render admission independently; not dismissed
  as extension orphaned-stream noise. Canonical science flags remain dark; no speculative fix.
- **2026-10-03 23:18Z: weekly report repair adopted for next dev checkpoint.** Missingos import; before
  2fail2pass twice ->4pass twice, actual package4pass twice; email mocked, real Notification
  Text persistence. Expectedestate785/floor783,280files; guards/chain unchanged. Hosted/live
  pending. Actual SQL read compatibility/delivery/scheduler behavior beyond import unproved.
  Gallery scheduler references nonexistent fields; isolated candidate remains unadopted.
- **2026-10-03 22:56Z: identity PR235 merged devfcea5557 at22:54:29Z.** Exact3dca2ec9
  hosted allgreen2278/1918/781; actual identity deploy/after boundaries/full E2E pending.
  Prior monitor8ec full browser63passed/0fail/0flaky/9existing skips, HTMLoktrue.
- **2026-10-03 22:56Z: owner five-second latency evidence prepared.** p95 conservative buckets and
  exact over5000ms counts on bounded existing telemetry; metrics cumulative/all outcomes,
  separate from browser success. Conservative rounding prevents5000.01ms becoming5000.0ms.
  Healthy slow markers remain absent. Final8beforefail twice ->8afterpass twice, existing22
  telemetry checks pass twice. Expectedguards2286/floor2280/margin6;181files unchanged.
  Hosted/live pending; measurement upgrade does not repair API tail or close population p95.
- **2026-10-03 22:44Z: monitor8ec73bd1 live/archive acceptance.** Health200/badge401 twice.
  Actual37159003598/37159077830 bothOK over restored7days: +24n2710/.236vs.362/win57percent.
  Earlier October-only loss is a different target window, not forecast improvement proof.
  Newesttarget22:00Z/.6h fresh. Log label still says thismonth although two archives supplied;
  correction remains. Scheduled-run/missing-first-segment commitments remain open. PR235
  exact3dca2ec9 hosted running; runtime isolated9cases initial5fail4pass, not final paired proof.
- **2026-10-03 22:33Z: monitor PR234 merged dev8ec73bd1 at22:31:06Z.** Checked f395a503
  all gates pass with actual2278/1918/749. Actual Render and new monitor readback pending.
  Priorbd full E2E62passed/0finalfail/1flaky/9existing skips; retained Chrome retry15s timeout.
  Bounded same-spot API5.2438/4.3972s, one miss of owner5s target; no population-p95 claim.
- **2026-10-03 22:33Z: identity matching/account repair prepared.** Filename/category/description
  heuristic output cannot verify a photo identity or board; unavailable now false/0/methods[].
  Three POSTs authenticate and decline503 before read/scan-charge/claim-write; private pending
  GET binds JWTowner and filters owner, legitimate empty read200. Final before30fail2pass twice
  ->32pass twice; checkout32pass twice and190companions pass. Expectedestate781/floor779/margin2,
  actual610tracked/279estate. Hosted/live after pending. Frontend selfie upload/legacy pending
  confidence and broader media claim ownership remain open. No model inference/customer writes.
- **2026-10-03 22:11Z: dev bd070fd6 live; owner spot-hub p95 target five seconds.** PR233
  exact f9cd9404 CI37155975799 passed guards2276/chain1918/estate749; merged22:00:01Z.
  Actual Render Live3m06s and exact health200 twice, anonymous badge401 twice. Postmerge CI/
  E2E37156951424/1431 pending. Allocation e424 after Live/guard/catalog proof passes twice;
  full browser62passed/0finalfail/1flaky/9existing skips; successful Firefox retry4.34s does not
  assign the initial failure cause or close reliability/SLO. Retries do not hide missed latency.
- **2026-10-03 22:11Z: monitor seven-day seam repair prepared on bd070fd6.** Reviewed PR225
  narrowly, shared window constant; before1fail36pass twice ->37pass twice, checkout37pass twice,
  84companion checks pass. Guards expected2278/floor2272,181files/margin6 unchanged. Hosted pending.
  Current dev monitor37157286033 loses +24h MAE.174 versus persistence.170/win49percent/n547;
  no threshold change or claim of skill improvement. Identity32case isolated candidate remains
  unadopted; advisory backend lint runtime defects under review. Wider audit stays open.
- **2026-10-03 21:39Z: CI-history recovery prepared ondev e4242f20.** ExistingPR224
  reviewed/adopted narrowly, plus30s lookup bound and malformed/future/timezoneless refusal.
  Baseline12fail24pass twice ->36pass twice, checkout36pass twice. Real GitHub CLI returned
  staleSep17 in both rounds; REST recovered current4b CI/readings. Age14days unchanged.
  Estate projected749/floor747/margin2; current dev floor provenance retained. Hosted pending.
- **2026-10-03 21:19Z: bounded clip allocation guard prepared ondev4b152937.** Final28case
  before23fail/5pass twice, isolated/checkout28pass twice,303neighbor checks pass. Refuses invalid
  geometry before longitude loops and axes/cross-product allocations, shares existing250000serve
  ceiling, returns diagnosed empty partial clip without L1 mutation. Actual selector181guards/
  147chain; hostedCI37154741295 confirmed2276/1918/735. PR232 merged e4242f20 at21:36:42Z;
  actual Render after proof/full E2E pending, margin6 unchanged.
- **2026-10-03 20:47Z: capacity repair prepared on currentdev449b3b91.** Three weather files
  plus42parity/cache/fallback checks from independently reviewed672b996e; baseline18fail twice,
  candidate42pass twice, checkout42pass twice;13neighbor files275pass. Hosted-base1876 plus42
  projects1918, chain floor1912/files147; established margins unchanged. Bounded live before
  6stored frames200twice/field hashes equal. CI37152927047 confirmed2248/1918/735. PR231
  merged4b152937 at21:05:40Z; backend Live/health200 twice, badge401 twice. HTTP6stored frames
  after twice; cross-deploy hashes differ (cause unproved), current-file tier A/B all fields equal6pairs
  twice with actual optimized lane/cache15023to3822. Full E2E37153891426:60passed/0final fail/3flaky/9existing skips; spot loading SLO still open.
- **2026-10-03 18:17Z: PR #228 merged into `dev`; backend live `3de464b8`.** Exact-head
  CI37141260667 at4f3aaa41: guards2248/chain1876/estate735, projected counts confirmed,14 GitHub checks
  success. Applied backend-only Strava state schema with twice-before/after catalog and actual-role proofs.
  Render Auto-Deploy Live3m32s; exact revision health200 twice. All seven anonymous boundary probes401
  twice; owner messaging and Strava status200 twice; conditions canary healthy twice before/after.
  Runtime SIM_STRICT_INPUTS=0, SIM_SERVED_TIME_MATCH=0, SURF_TIDE_DEPTH=0 twice. Shared public/dev
  backend updates; main and public frontend freeze unchanged. Receipt: audit/dev-rollout-2026-10-03/REPORT.md.
  Post-merge CI37142516639 success with identical counts; E2E37142516586 cancelled at50min.
  Full browser acceptance remains open; original full run has no trace artifact. Diagnostic PR230
  open; two fresh spot-hub baselines fail. Trace proves synthetic badge401/session redirect;
  narrow two-identity GET badge fixture passes two fresh after runs (1passed each); real API401
  twice. Full E2E37147928653:60pass/2fail/1flaky/9existing skips; Safari fixture bypass and
  separate Chrome15s spot timeout traced. Fresh Safari baselines1pass/1fail; Explore worker block
  and explicit fixture-use assertion pass4tests twice (all four projects, no retries/skips). Full
  E2E37150963742 completed62pass/0final fail/1flaky/9existing skips; retained Chrome trace
  confirms separate real spot15s timeout. PR230 merged449b3b91 at20:39:06Z; backend Live/health
  exact revision200 twice and real badge401 twice; postmerge E2E37152301831 passed63/0fail/0flaky/9existing skips;
  exact5d9e92f2CI success2248/1876/735; auth unchanged. Commitment172 checked;149/309
  open (latest monitor loses +24h operational floor to persistence). Broader audit, real OAuth/payment acceptance,
  rotation and weather skill remain open. Receipt PR229 merged into dev atf2ae19d2; its CI retry passed. Exact dev/public origins
  configured; config redeploy Live1m16s at unchanged3de; actual PG nonce race/replay passes twice
  with provider mock, owner tokens unchanged. Ledger374-392 records rollout, gap and acceptance.
- **2026-10-03 17:23Z: local OAuth/time checkpoint `cd41353e` read back clean.** Staged gitleaks57.22KB
  scan found no leaks, ledger prefix/tamper checks passed, docs-only memory0FAIL/2WARN/12NOTE. This docs-only
  check does not refresh the stale secrets pointer or confirm rotation. Full report/log carry the receipt.
- **2026-10-03 17:20Z (`codex/audit-repairs`, local continuation): APP-06 authority and WEA-02 comparison built.**
  Strava binds private routes and callback to verified accounts, with hashed ten-minute single-use state and exact
  frontend redirects; new cases 22 failures/3 passes before twice, 28 passes with configuration companions after
  twice. SQL model/migration adds backend-only RLS state store; SQL emission passes twice, live schema/role proof
  pending. Dark `SIM_SERVED_TIME_MATCH` default 0 uses aligned actual marine/wind hour and model; unknown/mixed
  frames and stale rating tide/quality are withheld. Weather 21 failures/3 passes before twice, 53 with companions
  after twice; requested-hour Jacobian null control passes. Integration 339 passes/2 existing skips; estate 734
  passes/2866 existing skips. Chain projection1876/floor1870, estate735/floor733, margins unchanged. No push,
  deploy, external schema application or serving flag promotion. Rotation, real OAuth, live PostgreSQL and full
  spot/run identity remain pending; wider audit stays open. Report: `audit/repairs-2026-10-03-oauth-time/REPORT.md`.
- **2026-10-03 13:37Z: local checkpoint `6aaf55d6` read back clean.** Secret scan and ledger checks pass;
  memory 0 FAIL / 3 WARN / 12 NOTE. Followup report/log hold the receipt; no outward change.
- **2026-10-03 13:33Z (`codex/audit-repairs`, local continuation): next batch validated.** Fourteen messaging
  routes bind actors to verified JWTs; cleanup requires persisted admin authority. New messaging cases: 47 failures /
  25 passes before twice, 72 passes after twice. Strict simulation inputs are built DARK (`SIM_STRICT_INPUTS` default
  0): required/finite fields and measured-zero controls; the strict/legacy cache separation found during verification
  is fixed. Weather baseline 41 failures / 18 passes twice; separate cache baseline 3 failures / 59 passes twice;
  final expanded weather instrument 88 passes / 2 existing skips twice (62 new cases). Affected integration 239 passes /
  2 skips; CI-owned sim consumers 255 passes / 2 skips; full estate 709 passes / 2866 skips. Chain projection 1852,
  estate 710, margins unchanged. Full guards/chain were not rerun this batch. No push, deploy, provider write or flag
  promotion; hosted CI, staging and Postgres evidence pending. APP-05 and WEA-05 remain partial; broader audit open.
  Evidence: `audit/repairs-2026-10-03-followup/REPORT.md`, sanitized results; canonical log above.
- **2026-10-03 03:32Z (`codex/audit-repairs`): first local batch validated, integration pending.** Required backend
  lanes: guards 2246 passed / 68 skipped / 1 existing xfail, chain 1790 passed, estate 637 passed / 2866 skipped;
  zero failures in those lanes. Final focused set 101 passed twice. The estate's Windows crypt test assumption was
  reproduced twice and corrected without changing hashing or adding skips. Five DCL failures remain in the existing
  quarantine; the whole-tree probe was capped, not certified green. Ledger, memory, paired scoreboard and sanitized
  report updated. No served flip, deploy, push, real payment or credential rotation. Hosted CI and staging/Postgres
  evidence remain pending. Details and partial finding boundaries: `log/2026-10-03-audit-repairs.md`.
- **2026-10-03 03:13Z (`codex/audit-repairs`, base `origin/dev` `e0f93466`): first audit repair batch built locally.**
  JWT/owner/admin boundaries, public profile projection, transactional wallet fulfillment, environment-only Strava,
  optional preview isolation, dark spectral tide cap and per-domain sim provenance have two valid baseline and
  two fixed runs each. Final combined set: 91 passes twice (69 new regressions + 22 CI controls). CI floors raised
  with unchanged margins from hosted dev receipt 37048650086; next hosted confirmation pending. Full-tree capped
  probe stops at the five already quarantined DCL missing-Event-Bus failures (624 passed / 574 skipped). Required
  lane measurements still being completed. No deploy, real payment, rotation confirmation or served flag change.
  Strava OAuth state/rotation, remaining account paths, Postgres races/precision and downstream served-hour
  consumers stay open; full scope: `log/2026-10-03-audit-repairs.md`, `audit/repairs-2026-10-03/REPORT.md`.
- **2026-10-02 17:21Z (merge of `origin/dev` `ed3a1b46` (#227, merged 17:19:08Z) into `claude/consensus-flip-sweep`,
  auto-fix on #220): RE-CHAINED AGAIN (L-P21).** dev holds seq 1-335 (#227's lines 326-335, among them pr_merge "#223"
  at 330 and "#221" at 331), so this branch's own lines 326-333 are now **dev seq 336-343 (+10)**; its pr_merge "#223"
  and "#221" copies are dropped as duplicates; 344 records #227's merge. Cumulative from this branch's first numbering:
  the commitment to read the sweep 295 -> 337, fulfilled by the first clean reading 301 -> 343; the findings 296, 297,
  298, 300 -> 338, 339, 340, 342; the floor-staleness re-run 299 -> 341. Floors unchanged (guards 180/2242, chain
  142/1771). The bullets below cite the numbers of their time.
- **2026-10-02 14:18Z (merge of `origin/dev` `abcc6355` (#221, merged 14:10:02Z, ahead of #220) into
  `claude/consensus-flip-sweep`, auto-fix on #220): RE-CHAINED AGAIN (L-P21).** dev holds seq 1-325 (#221's lines
  301-324 and its pr_merge "#219" at 325), so this branch's own lines 301-308 are now **dev seq 326-333 (+25)**;
  its pr_merge "#219" (309) is dropped as a duplicate of dev 325, its pr_merge "#223" (310) is 334, and 335 records
  #221's merge. Cumulative from this branch's first numbering: the commitment to read the sweep 295 -> 327, fulfilled
  by the first clean reading 301 -> 333; the findings 296, 297, 298, 300 -> 328, 329, 330, 332; the floor-staleness
  re-run 299 -> 331. Floors: guards 180/2242 (#221), chain 142/1771 (this branch). The bullets below cite the
  numbers of their time.
- **2026-10-02 13:38Z (merge of `origin/dev` `ca71acd1` (#223) into `claude/consensus-flip-sweep`, auto-fix on #220 for
  its merge conflict): the branch's ledger was RE-CHAINED (L-P21).** #223 added dev seq 294-300, so this branch's own
  lines 294-301 are now **dev seq 301-308 (+7)** (the commitment to read the sweep 295 -> 302, the four findings 296,
  297, 298, 300 -> 303, 304, 305, 307, the floor-staleness re-run 299 -> 306, the first clean reading 301 -> 308, which
  fulfils 302), action times kept. Then 309 = pr_merge "#219" in the form the completeness audit matches (dev seq 294
  recorded it with a prose target) and 310 = pr_merge "#223". Chain floor re-derived from #223's hosted run
  37009550311 (141 / 1754) + 23: 142 / 1771, `_FLOOR_SET_FROM["chain"]` 1777. The PR C bullet below cites the old
  numbers (add 7).
- **2026-10-02 04:04Z (branch `claude/consensus-flip-sweep`; owner: "go, build PR C"): consensus PR C's missing third
  part, the before/after sweep of DISPLAYED heights, is built.** `scripts/consensus_flip_sweep.py` runs the production
  precompute over one manifest under today's lane and under `CONSENSUS_SERVE` '1' + `CONSENSUS_SERVE_KEEP_GFS`
  'hawaii', with a null re-run after both, and REFUSES on any control (Hawaii must not move; nothing may move without a
  swap). Flags come from `precompute.yml` at run time. No served number changes. **First clean reading (run
  36974680845, null control 0/1,676; SCOREBOARD S13; seq 301):** the flip changes 14.0% of displayed levels (11.8% up,
  2.1% down), height ratio p50 1.03 / p90 1.31; SoCal 55.6% (p50 1.27), Biscay and Sri Lanka ~37% up; it cannot reach
  the global tile, Hawaii (kept) or 97 live-upstream spots, and serves GFS between a GFS ingest and that run's twins.
  The flip stays the owner's word (PR #220). Its ledger lines re-chain after the cached-product guard (stacked on #219).
  Log: `log/2026-10-02-consensus-flip-sweep.md`.
- **2026-10-02 16:32Z (ledger seq 326-335 appended; PR #227 open): the F-22 follow-up is PUSHED and OPENED** (owner: "push to dev", read as the repo flow: the branch `claude/base-hold-followup` was pushed, new on origin, at `205d0253` and PR #227 was opened against dev; nothing is pushed onto dev itself and nothing is merged, that waits for "merge #227"). The 16:17Z bullet below says "NOT pushed" and "no ledger entry yet": superseded by this one. The PR was created 16:30:02Z, 17 files (+1,236 -27), MERGEABLE; no CI check had reported when it was read (the session's PR bar watches it; auto-fix and auto-merge are off).
  **Ledger (ten lines, one chain; dev's head was seq 325 and this branch was 0 behind origin/dev `abcc6355` when they were appended):** 326 finding (the F-22 diagnosis), 327 correction ("gh auth is invalid" in dev seq 317 and 318, HEAT0 and MULT0), 328 finding (a peer's F-23 review note), 329 decision (the F-22 build, merged in #221), 330 `pr_merge #223` and 331 `pr_merge #221` (README rule 12: no open PR carried them, the audit FAILed on #223 and WARNed on #221), 332 decision (D-015, this follow-up), 333 commitment (the F-22 fix and the follow-up read back on the Marine Nightly and the dev site, due 2026-10-06T18:00Z), 334 push, 335 pr_open. Lines 326-331 are `--reconstructed` with `--acted-at`. The open PRs 220, 222, 224, 225 and 226 each append their own lines from older bases, so whichever merges after another re-chains (LESSONS L-P21): take dev's ACTIONS.jsonl and re-append the branch's own lines after its head.
  **Backend read-back that is possible now:** `/api/health` reports `2.0.0-stage-6f-v1-abcc6355...` (read between 16:30:44Z and 16:30:45Z, uptime 2 h 18 m), so #221's backend is deployed; the frontend read-back (the nightly's first scheduled run, `__MARINE_BASE_HOLD__` and the F-22 bridge on the dev site) is still owed (dev seq 313, 318 and 333).
- **2026-10-02 16:17Z (no ledger entry yet, see below; NEW branch `claude/base-hold-followup` off dev `abcc6355`, local commit `3bddca3d`, NOT pushed): the engine now KEEPS the exact 2-degree base for the selected hour (F-22 follow-up), CLIENT ONLY, ON BY DEFAULT** (owner: "yes, keep the 2 degree frame for the selected hour at every zoom in that range"; D-015; LESSONS L-F16, L-F17).
  #221 (the five far-zoom fixes, F-22 included) merged at 14:10:02Z as `abcc6355`, so this is a new PR when the owner says so. The F-22 bridge acts only on a held 2-degree base for the selected hour, and the engine did not always hold one. **Rule 5** (`marineStaleHour.heldBaseKeeps`, asked first in `_captureCoarseBase`, the one function both capture paths use): an EXACT base is not
  replaced by a COARSER world frame (the thinned 46 x 21 series frame, or the 10-degree tier) of the SAME data (valid time within 1.5 h + 1 min; the same run: the verified cycle, else the ingest clock in WHOLE SECONDS because /grid and /grid_series spell it differently; the same model | layer | flavor). **Rule 6** (`coarseBaseOutdatedBy`): a 2-degree seed replaces a coarser base of the same data
  (the exact frame could not come back over a thin one). **The band:** the F-21 hour-settled world warm is served between the 15-degree regional gate and the bridge's 40-degree ceiling (`bridgeCeilDeg`), grid only. Kills: `window.__RAW_DISABLE_BASE_HOLD__ = true` (rules 5 and 6), `window.__RAW_DISABLE_WORLD_WARM_BAND__ = true` (the band); engine still 3,205 lines.
  **Checked:** test-first (47 tests failing first, 19 more after two independent reviews); a sweep of 46,137 interleavings through the engine's two capture doors against an oracle written from the frames' attributes (0 divergences; rules off: 9,296 degraded bases and 1,344 seeds refused over a thin base); map folder 215 suites / 2,373 tests; mutations: 33 on the first commit (one survivor, closed by a test) and 14 on the final code, each turned 1 to 29 tests red; two independent reviews (the test review found the run SPELLING, `…:21.292482Z` against `…:21Z`, which would have made both rules inert; fixed).
  **Offline A/B in two built apps (the pushed head against this; mock backend, no live request):** the owner's erratic zoom (3 sets of 5 seeds per arm) hid 0.12% of frames on the pushed head (23 of 18,564, every one in the 3.1% of frames that held a thin base) and 0.00% with the follow-up (0 of 18,489; it never held a thin base; the guard kept the exact base 5 and 3 times in two sets); the zoom-out and phone replays are unchanged (0.35%, 5.0%: all in the "frame for another hour" class, which this cannot reach, by design); five band scenarios hid nothing in either build.
  **Limits, measured:** the band half changed no hidden-frame count in any replay (it changes which frame is held: 73% against 25%, desktop band); the thin-base stretch is intermittent (it needs a thin frame to commit before the exact one is held); a run named on one side only lets the data time decide; a late frame for another step still replaces an exact base (F-21); F-19's `exactResidentSupersedes` has the run-spelling exposure fixed here (not verified live, not changed). **Recommended next (ONE item, the owner's word):** the exact world grid waits 33 to 91 s in the background fetch queue behind the world series pages (mock: 8 s per page; live 10 to 13 s), so the "another hour" window is the whole remaining hide: give the hour-settled warm's grid the FRONT of the queue (`runBackgroundWarm` `first`), test-first, one kill switch.
  **Ledger:** nothing appended. Six lines prepared, not appended (the five F-22 lines and this build's decision), and commitment 309 (due 14:00Z, overdue) is NOT closeable as fulfilled: the Forecast Accuracy Monitor is still red after #217 (an HTTP 429 on `calibration/history/residuals-2026-10.json` and the month-seam gap, #225 open); re-date it to #225. dev's head is seq 325; #220 will add more.
- **2026-10-02 13:32Z (merge of `origin/dev` `ca71acd1` (#223) into `claude/far-zoom-max-thinning`, auto-fix on #221 for
  its merge conflict): the branch's ledger was RE-CHAINED AGAIN (L-P21).** #223 added dev seq 294-300, so this branch's
  own lines 294-317 (the first re-chain's 294-315 plus the push and PR lines 316-317) are now **dev seq 301-324 (+7)**,
  action times kept, in-block "seq N" citations moved +7 (6 lines). Cumulatively: the far-zoom branch's original seq
  274-292 are now 301-319, the CLAUDE.md lines 293-295 are 320-322, and #221's push / PR lines are 323-324 (the bullet
  below that says +20 now reads +27). Floors: guards 180/2242 from this branch, chain 141/1748 from #223. Still merges
  LAST, after #220.
- **2026-10-02 12:30Z (merge of `origin/dev` `c4a59c01` into `claude/far-zoom-max-thinning`, owner: "push the far-zoom
  branch and open its PR"): the branch's ledger was RE-CHAINED (L-P21).** dev's seq 1-293 are byte for byte, and this
  branch's own lines 274-295 are re-appended as **dev seq 294-315 (+20)** with their action times kept; inside those
  lines an in-block "seq N" was remapped to N+20 (6 lines), nothing else changed. Where the far-zoom bullets below
  and `log/2026-10-01-far-zoom-max-thinning.md` cite this branch's own seq 274-295, add 20 (their prose is not
  rewritten); where they cite #216/#217 (seq 274-285), the number is already dev's. The branch merges LAST (after the
  cached-product guard and #220) and re-chains again then.
- **2026-10-02 05:42Z (no ledger entry yet, see below; same branch, local commit `083fbd3c`, NOT pushed): the faded heat map (F-22) is FIXED in the CLIENT, ON BY DEFAULT** (owner: "go, build the heat map fix"). The engine's zoom-out bridge, its mirror reject and the arbiter's rule 8 are base-aware: a held 2-degree world base (`isFineWorldBase`) is judged by the display gate's own wide test (`isGateWideView`, one function the layer now shares) or the 40-degree ceiling's, whichever is wider; a 10-degree base keeps the ceiling. In the band the ceiling left (z <= 7, span <= 40) the base is promoted only when it is the same model and layer, made for the selected hour (valid time within 1.5 h of `engine.__selectedMs`, published by the layer every frame; an unknown hour fails closed) and the view is not at the antimeridian (the engine's coverage math has no wrap). Kill `window.__RAW_DISABLE_BASE_AWARE_BRIDGE__ = true`. Client only: no served number changes, no SCOREBOARD row; DECISIONS D-014; LESSONS L-F13 (now mechanized), L-F14, L-F15.
  **Checked:** test-first; 45 new tests (the REAL layer swept over 7 zooms x 8 spans x 8 coverages for GFS, EURO and ICON against the real engine method; an 82,320-interleaving sweep of both commit modes with the bridge in the loop: 0 clips hidden beside a fine base, 0 bounces, 0 wedges, 0 wrong-hour promotions, and 10,064 interleavings reach that state with the switch on); 22 mutations, each caught; two independent reviews (`pr-review-toolkit` code and test agents, the owner's new plugins), every valid finding applied (the antimeridian regression, a base up to 3.5 h off at full strength, an unknown hour promoting, a tuned ceiling narrowed, the shadow context); `src/components/map` 211 suites / 2,282 tests and the whole frontend 324 / 3,271 green; lint and LOC ratchets clean. **Offline A/B in two BUILT apps** (the commit before the fix against the fix; mock backend, no live request): erratic zoom 4.25% of frames hidden -> 0.00%; with a 2-degree base for the selected hour 0.00% hidden in every replay (5,597 + 6,687 + 1,109 frames, against 4.25%, 1.14% and 1.79%); the nightly's verdict rules on frames thinned to its rate: MULT0 4 (max 7) -> 0, SETTLED_STEP 0 -> 0; the F-21 wrong-hour cells and the frame gaps unchanged.
  **Limits, measured:** a base for ANOTHER hour and a thinned 8-degree world-series base keep the old rule by design, so the 390-px phone replays did NOT improve (hidden 1.76% -> 2.70%: the base was the thinned frame for 65% of the fixed run); the antimeridian keeps the old rule; EURO and ICON on the real backend, the rating flavor and the live app are untested. **Recommended next (ONE item, the owner's word):** make the held base the exact 2-degree frame for the selected hour at every zoom of the band: extend the F-21 world warm below the regional zoom and stop a thinned frame of the same hour replacing a held 2-degree base. **Read-back after a deploy:** the nightly's `MULT0_FRAME` at 2 or fewer on its first scheduled run.
  **Ledger:** nothing appended. Prepared, not appended (scratchpad): the F-22 finding, the seq-291 correction, the F-23 review record, this build's decision and its read-back commitment; `pr_merge #218` is DROPPED (dev has it at seq 286). dev is `c4a59c01`, ledger head seq 293 (read from git); #219 is merged and #220 open, so this branch's lines are re-chained last, after dev's head at that moment, when the owner says go. **Waiting on the owner:** the word to push or open a PR (the pre-push `check_floor_before_push.py` blocks until the chain lane's floor moves), the ledger go-ahead and the chain order, whether to commit `audit/` (untracked), and whether to build the recommended next item. Log: `log/2026-10-01-far-zoom-max-thinning.md` (03:15Z to 05:42Z).
- **2026-10-02 02:15Z (no ledger entry yet, see below; same branch): why the heat map fades on a zoom-out (audit F-22) is DIAGNOSED; NO code changed** (owner: "go, diagnose the faded heat map next, also use the new plugins and connectors and skills I added to help us").
  What the harness calls HEAT0 and the nightly calls `MULT0_FRAME` is the layer's zoom-out gate hiding a regional clip that covers under 60% of the viewport (`mult` 0: the regional pass AND the crest animation; the 2-degree wash stays, never a blank)
  while the engine's promotion of the held world frame (`_midBandBridgeWide`, `marineCommitGate.js:66`) has fired only past a 40 degree span since `06b3dbc2` (2026-07-22): in the band zoom <= 7 and span <= 40 degrees (about z4.5 to 7 on a
  1280 px map) nothing replaces the hidden clip until a wider one commits, so the invariant of `8625841b` ("no coverage band is resident-but-hidden") is broken. **Offline (mock backend, per-frame):** 2.4 to 3.6% of frames under erratic zoom, a hide of
  about 1.3 s plus the fetch latency for an uncached viewport (0.08 to 0.5 s cached); with the existing kill switch `__RAW_DISABLE_MIDBAND_BRIDGE_CEIL__` 0.0% of 6,042 frames; lowering the cover fraction (the known-bad fix, `b21cf29d`) only moves the dip
  to the tiny-tile fade (5.5% of frames); the cold veil is not the cause. **Live:** the Marine Nightly's `MULT0_FRAME` is this state: 19 of the 70 runs since 08-24, over the budget of 2 on the last four (09-28: 4, 09-29: 12, 09-30: 9, 10-01: 12);
  the 10-01 run (observable, no transport or console error) shows 2.5 s and 8.3 s episodes at z6.24 and z4.7 to 4.4 with the engine's promotion count 0 for the whole run. **Corrects** the audit's section 8.7 ("MULT0 = a frame drawn with no wave data") and this
  program's earlier "heat map faded" wording for HEAT0 frames (the wash stays). **Recommended there, BUILT 2026-10-02 (the bullet above):** a base-aware bridge: a held base of 2.5 degrees or finer uses the gate's own wide test (`zoom <= 7 or span > 15`), a 10-degree base keeps the
  40-degree ceiling; default on, a kill switch, the invariant as a pure test, the arbiter's `subcover_at_wide` mirror; acceptance = the nightly's MULT0 at 2 or fewer and EURO/ICON replayed. Cost: the promoted frame is drawn as a world frame (Florida colour
  spread 146, against 181 for a clip and 117 hidden). Not tested: EURO/ICON, a phone-width map, the live app. The existing dark `__RAW_COARSE_BRIDGE_GRACE__` (2026-08-15) would bound the hide at 4 s; it is not what I recommend instead. **Ledger:** nothing appended for this work until the order
  with a peer's PR #216 (seq 274-278) and its stacked #217 (279-285) is agreed; then one `finding` (F-22), the `correction` for seq 291's "gh auth is invalid" (gh is authenticated now), the peer-review record of F-23's dedupe stamp, and the `pr_merge #218` line the CLAUDE.md session asked me to carry (PR #218 merged 2026-10-02T02:17:18Z, `48460019`; recorded once, by whichever PR lands next on dev). Log section
  "00:40Z to 02:05Z (2026-10-02)" of `log/2026-10-01-far-zoom-max-thinning.md`; the evidence and the audit report (section 8.14) are in the untracked `audit/weather-direction-drift-2026-10-01/`.
- **2026-10-02 00:33Z (seq 290-292; same branch, local commit e29cddde, NOT pushed): the zoom-out grid race (F-23) is FIXED in the CLIENT, ON BY DEFAULT** (owner: "go, build the scheduler fix").
  The dispatch slot of `useMarineDataFetcherCore.enqueueMarineUpdate` now knows what an enqueue can do (new `marineEnqueueSlot.js`, +3 net lines in the core, 962 of 966): the cache-only `series_upgrade` lane is
  SKIPPED while a run is pending or armed (it never displaces a fetch), and a fetch-capable enqueue SUPERSEDES a cache-only slot that is only scheduled. Kill `window.__RAW_DISABLE_SU_NO_CANCEL__ = true`; forensic
  events `series_upgrade_skipped_pending`, `cache_only_slot_superseded`. 38 new tests (the REAL `enqueueMarineUpdate` under fake timers, both orders, a hidden tab, the switch), 17 mutations each turning them red,
  the whole `src/components/map` folder 208 suites / 2,237 tests green. **Offline A/B in two BUILT apps** (the committed code vs the fix; mock backend, NO live request; the just-opened cell at a 0.8 s stay,
  live-like latencies, the series page landing before, inside and after the dispatch window, 30 runs): where a page landed inside the window the committed code lost the zoom-out's world `/grid` 7 of
  7 times (the right hour never drew in 9 s), the fix 0 of 6 (right hour at 4.4 to 4.5 s, the same as a run with no landing); outside the window neither lost one. The F-21 cells, the far-zoom scrub and the erratic frame metrics are unchanged; one unforced occurrence of the lost grid in the owner's erratic-zoom set-up (1 of 4 committed runs, 0 of 4 with the fix); it does NOT change the erratic-zoom disappearances (faded heat map, placeholder windows), which stay open. Not tested live; the
  second order by the call-site tests and, with the fix on, 12 natural supersede events in the erratic runs (no frame difference shown); how often a landing falls in the window live is unknown. Cost: where a page used to cancel the grid the zoom-out now sends it (one 2.3 MB world `/grid`). No served number
  changes (no SCOREBOARD row). Corrections (seq 292): the second order is NOT rare under erratic input (12 supersedes, 45 skips in six 25 s trials) and V41's weak frames 1.0% -> 0% was one lucky
  sample (0.65% vs 0.69%). Commitment seq 291 (due 2026-10-04T18:00Z): the fix reaches dev and is read back there. Log: `log/2026-10-01-far-zoom-max-thinning.md`; DECISIONS D-013; LESSONS L-F12.
- **2026-10-01 22:32Z (seq 288-289; diagnosis only, NO product code changed): the zoom-out's world grid that was sometimes never requested has a cause: a series page landing in the
  300 ms between the zoom-out's dispatch and its run cancels it** (owner: "go with 1, diagnose why the zoom-out grid isn't sent"). After a zoom-out `moveend` waits 900 ms (50 ms if cached),
  enqueues `'moveend'` on `useMarineDataFetcherCore`'s single dispatch slot, which arms a 300 ms timer; any LATER enqueue clears that timer. A series page (regional or world, or the hour-0 mini) fires
  `marine_series_revalidated` -> `enqueueMarineUpdate('series_upgrade')`, a CACHE-ONLY lane that returns before any network fetch; landing inside the 300 ms it cancels the pending `moveend` run and runs
  in its place, and nothing re-arms the fetch, so the map keeps its frame until the next gesture. The lane's comment promises it never displaces a real fetch; the code guards only an in-flight one
  (`locks.isFetching`), not a pending one. Since 2026-07-17 (`f74214fd`). Proof (offline, scratch build of `dd28a1dd` with the forensic ring recording enqueue, dispatch(cancels), run, fetch):
  `moveend` cancelled by `series_upgrade` in 3 of 4 baseline runs; with ONE runtime switch (`series_upgrade` skips when a run is pending) the same landings inside the window lose 0 of
  6 (committed behaviour: 6 of 6); 26 of 26 earlier cold-jump runs with no landing in the window sent their grid. Correction (seq 289): my guess
  that it was "the state right after a restart" was wrong. Proposed fix (BUILT the same night, see the bullet above; the owner said go): a capability-aware dispatcher (a `series_upgrade` enqueue returns when a run is
  pending; a fetch-capable enqueue that finds a cache-only run scheduled replaces its source), kill switch, forensic event, call-site tests for both orders. The second order never occurred in
  26 natural traced runs; injected, the first part alone leaves it lost (0 of 2 sent) and both parts send it (2 of 2). Not shown live; the link to the
  2026-09-30 reports (commitment 228) is a hypothesis. Log: `log/2026-10-01-far-zoom-max-thinning.md` (21:45Z section); LESSONS L-F12, L-P26.
- **2026-10-01 21:35Z (seq 283-287; same branch, third local commit, NOT pushed): the wrong-hour far-zoom frame (F-21) is fixed in the CLIENT,
  ON BY DEFAULT** (owner: "keep it on, defer the flip, now fix the wrong-hour frame": the exact-frame fix stays on, `SERIES_DECIMATE_MODE=max`
  is NOT turned on in Render, nothing to do there). After a zoom-out the engine drew the world frame the page loaded with (hour 0: swell 0.78 m
  where Wednesday reads 2.33 m) at full strength for 3.2 to 3.8 s offline (3 to 9 s live) under a readout naming the selected hour. Causes: the
  zoom-out bridge promotes a held base that carries no hour; the seed gates (the prewarm's staging and the engine's seed line) asked only model and
  layer, so a right-hour seed was refused then discarded; nothing marked a wrong-hour frame provisional; and on a just-opened page the fetch path's
  own prewarm call owns the world grid behind its own world page, so no later call can send it. Built (`marineStaleHour.js`,
  `marineStaleHourLayer.js`, `marineWorldWarmOnSettle.js` + small edits; engine 3207 -> 3205 lines, `useMarineScrubSettle.js` 792 -> 794): an
  hour-aware seed and base, a wrong-hour world frame replaced by the held base or drawn at 0.4 strength beside the panel's existing "Forecast time
  does not match this selection" line, and a grid-first world warm after a 1.5 s hold; five kill switches (`__RAW_DISABLE_BASE_HOUR_SYNC__`,
  `_STALE_HOUR_DIM__`, `_STALE_RESIDENT_SWAP__`, `_HOUR_WORLD_WARM__`, `_WORLD_GRID_FIRST__`). **Offline A/B** (mock backend, NO live request, app
  clock pinned, final build vs the previous commit, medians): the previous hour at full strength after a zoom-out, map open a minute: 3.3 s ->
  0 s after a 5 s stay, 0.07 s after 2.5 s, 0.32 s after 0.8 s (then dimmed 1.2 s); just-opened page: at most 0.3 s at full strength, then dimmed
  (2.9 to 3.6 s), the right hour unchanged (3.6 to 4.5 s). 112 new tests in 9 files, 69 mutations each turning a test red. Not tested live,
  in the owner's Chrome, on a phone, or for EURO/ICON at far zoom; the mock charges every world page 8 s while the earlier live runs read 1.1 to 2.4 s
  (one-hour page) and 2 to 25 s (48-frame page), so the just-opened-page rows rest on that shape (re-run with live-like latencies (one-hour page 2.4 s, 48-frame page 20 s): after a 5 s stay the same picture (right hour at 4.5 s in both builds, the wrong hour dimmed instead of full strength); after 0.8 s the zoom-out's own world grid was not sent within 9 s in 2 of 3 runs of each build, so there the right hour had not arrived after 9 s and the fix only dims the wrong hour (not traced when written, traced afterwards: first bullet of this section, seq 288; present in both builds).). Cost: up to one 2.3 MB world `/grid` per settled hour at a regional zoom (GFS, ICON).
  No served number changes (no SCOREBOARD row). Commitment seq 286 (due 2026-10-04T18:00Z): the three far-zoom commits reach dev and are read
  back there. Log: `log/2026-10-01-far-zoom-max-thinning.md`; DECISIONS D-012; LESSONS L-F11, L-P23, L-P24, L-P25.
- **2026-10-01 18:59Z (seq 281-282; read-only, nothing changed): the owner reports runs failing in their email notifications; the 2:47 pm EDT one
  (18:47Z) is the Forecast Accuracy Monitor, RED since 07:08Z.** Runs #205 (18:49Z) and #204 (07:08Z) fail with the same four gates: skill
  ledger scored zero past its recovery window; skill floor unmeasured; archive reader blind (credentials present, the residual history
  segment would not load); and "a fresh calibration report carries no `forecast_skill_ops` block". Green on #199-#203 (to 09-30 22:58Z). The
  live `/api/weather/buoy-calibration` is fresh (16:35Z, height MAE 0.211 m over 59 spots) and has no `forecast_skill_ops` key, so the skill
  ledger is not attaching: the instrument that grades the program is dead, and commitments seq 149 and 172 need it. Cause NOT determined
  (the run logs need `gh auth login`); the leads and the other red runs today (E2E 11:52Z, CI on the ledger-215 PR 12:14Z, MOP ingest 13:24Z,
  Marine Nightly 13:46Z) are in `log/2026-10-01-far-zoom-max-thinning.md` at 18:58Z. Not from this branch (nothing pushed; offline replays
  only). Commitment seq 282, due 2026-10-02T14:00Z.
- **2026-10-01 15:06Z (seq 278-280; same branch, second local commit, NOT pushed): the exact-frame fix for far zoom is built,
  CLIENT ONLY and ON BY DEFAULT** (owner: "yes, build the exact-frame fix for far zoom"). At far zoom the app now draws the
  exact 2-deg world frame; the thinned series frame is only the instant placeholder. Located first: the scrub-settle check
  compares hour LABELS, not valid times, and at 3-hourly range the frames serving one hour carry different labels (series 145,
  exact grid 144, selection 146, all valid 15Z), so it committed the thinned frame OVER an exact frame of the same valid time
  (the unfixed client did so 100 times in 25 offline random-zoom trials: the "swell disappears from the FLA coast while
  zooming" report). Built: `marineExactUpgrade.js` plus three small call sites (`useMarineScrubSettle.js` 790 -> 792 lines):
  `decimated_stride` kept on the grid, the prewarm no longer stands a thinned frame in for the world grid, an upgrade to the
  exact frame through the normal fetch path once the hour holds still (bounded), and a thinned frame never replaces an exact
  one of the same valid time. Kill switch `window.__RAW_DISABLE_EXACT_UPGRADE__ = true`; telemetry
  `window.__MARINE_EXACT_UPGRADE__`. **Offline A/B** (mock backend, NO live request; 25 seeded trials): frames with the
  Florida swell under 75% of exact 11.1% -> 0.7%, lower in 20 of 20 seeds; a far-zoom scrub now ends on the exact frame about
  4 s after the placeholder (it never did). NOT fixed: the wrong-hour window (the engine's `bridgeToCoarseGlobalIfHeld`
  promotes the held hour-0 base for ~4.4 s: a different mechanism, seq 280 corrects my earlier "arbiter"; fixed later the same day, the first
  bullet) and the whole-heat-map
  dropouts at z4.3-6.3 (about 5% of frames, same before and after). Not tested live, in the owner's Chrome, or for EURO/ICON.
  Recommendation: keep it on, defer the max-thinning flip. Log: `log/2026-10-01-far-zoom-max-thinning.md`.
- **2026-10-01 12:42Z (seq 274; branch `claude/far-zoom-max-thinning`, committed locally, NOT pushed: the gh token is
  invalid and only the owner can `gh auth login`): the far-zoom thinned-frame fix is built DARK.** The world series page thins
  the 2-deg field by a pure stride (46 x 21, an 8-deg lattice) and a far-zoom scrub commits it: Wed 2026-10-07 15Z, swell at
  three offshore Florida points 1.34 m against 2.33 m exact (-42%), 454 of 10,378 ocean nodes more than 1 m low; the legend
  was silent, or said 2 deg (audit finding F-19). Owner decision: max thinning plus the legend fix. Built:
  `SERIES_DECIMATE_MODE=max` (default OFF; marine height layers only; a 3x3 window; the stride's own lattice;
  `SERIES_MAX_POOL_HALF=2` gives the 5x5) at all four thinning sites, and a legend that reads the grid DRAWN. **Measured
  price:** nodes under by >1 m 454 -> 23, over by >1 m 173 -> 1,291, mean bias -0.08 -> +0.46 m, mean abs error 0.30 -> 0.51 m,
  Florida 1.34 and 1.21 -> 2.37 and 2.29 m (exact 2.33 and 2.41); the first-built 5x5 window read the whole ocean 0.88 m
  high and was refuted. Flip = `SERIES_DECIMATE_MODE=max` in Render (owner-only), read back with the Florida check and S11.
  Still OPEN (seq 276): the far-zoom frame is the WRONG HOUR for 3-9 s (over 75 s right after a restart) after a zoom-out (FIXED
  locally later the same day: the first bullet) or a
  far-zoom scrub, the thinned frame stayed drawn (FIXED, the bullet above: it was committed over the exact one), and the crest layer drops
  out for 0.4-0.7 s at z4.6-6.2. Incident (seq 275): this session's live replays saturated the 1-CPU box (health 7-8 s) and the owner saw "Couldn't
  load surf spots"; stopped 12:39:57Z. Log: `log/2026-10-01-far-zoom-max-thinning.md`.
- **2026-10-02 (seq 294-300; #223, open for the owner's word): one guard on the cached-product invariant.**
  Four serve paths shipped writes into the one-level copies `load_product` hands out (#211, #212, #213, #219); each fix
  guarded one attribute. A conftest autouse fixture now fails any backend test after which a product the L1 cache holds
  changed (`tests/l1_product_guard.py`). Measured: 0 guard errors across ~4,510 existing tests (no fifth instance in a
  tested path); the four real bugs re-introduced are seen 4 of 4 in their per-site tests, but only #213's path is
  exercised by general tests (1 of 4; commitment seq 298 adds the scenario test). Test-side only; no served number.
- **2026-10-02 (seq 279-285; FIXED by #217, merged 02:42:26Z as `f302c309`, live from 02:45:03Z, seq 288-289): the skill ledger
  has written nothing since 2026-09-30 22:45:05Z.** Supabase Storage answers a missing object with HTTP 400 and the
  strict L2 reader accepted only a 404, so the first read of the new month's segment (`scored-2026-10.json`) raised
  and every precompute run skipped the ledger while the job stayed green; the residual roll-up shares the reader. The
  Forecast Accuracy Monitor is red since 2026-10-01 07:08Z. Fix built and tested (`l2_retry.is_missing_object`, no
  served number changes); seq 149, 172 and 217 wait on it; the monitor's own month-boundary window is seq 283.
- ⛔ **2026-10-01 (seq 239; #211, open for the owner's word): the serve-time coarse marine fill wrote GFS values into
  the CACHED EURO/ICON product** (`coarse_gulf_fill.py` mutated the L1 cache's shared vector objects). Live: a 40-deg
  EURO `waves` clip had 119 of 399 cells flip masked -> valid (inland Texas among them, unstamped) after anyone's
  world request; world `swell_1`/`wind_waves` lost their `coarse_fill` stamp on every repeat within the 5-min L1
  TTL. #211 copies instead of mutating: world responses unchanged; later readers revert to the model's own mask
  (a served-number change on that path; SCOREBOARD S12 before row (S11 on #211's branch); after row = commitment 266, written as 242 on #211's branch). Not fixed, owner's
  call: on the 2-deg world clip the fill's 8-deg reach paints GFS heights inland on the world response itself.
- **COMMITMENT 228 CLOSED 2026-10-02 (seq 292; SCOREBOARD S11): far-zoom pages now come from the stored field.** Warm
  box: stored share 85.0% (the ceiling) for both layers page by page, 68.1% / 59.3% with both pages at once; before
  19.5 / 24.8 / 8.0 / 43.4%. RESIDUALS, the next fix: two concurrent world pages still overrun the 20 s deadline on
  the 1-CPU box (33-40 of 48 hours per page), and for some minutes after each deploy every page is cut (cold box:
  12-23 of 48). The original report, kept for context:
- ⛔ **OWNER REPORT 2026-09-30 22:18Z (seq 227; commitment 228): marine heatmap blank at far-out zooms on forecast
  hours until zooming in.** ROOT MECHANISM from the Render logs (seq 237): the zoomed-out grid_series' live
  fast path times out (2.5 s) and its per-hour loop (10 s/hour, 20 s deadline, 1 CPU) drops many hours under load,
  near ones included; a zoomed-in series has small frames and completes. CHRONIC (the same on 2026-09-29), worsened
  by today's restarts. Not reproducible warm or across the clean #205 restart.
  ROOT CAUSE (seq 260; written as seq 240 on #210's branch): the client's own 48-offset world page is over budget by construction (a mid-tier deep copy
  of the whole 15k-cell world clip per frame, 10.3 of 12.9 s profiled), and the live Open-Meteo lane takes turns
  with it: when it wins, every hour is a 25x12 grid at 15 deg; when it loses, the stored page is cut at the 20 s
  deadline. SCOREBOARD S11 (new, `series_page_probe.py`): 8.0-43.4% of hours served from the stored field. FIX in
  #210 (frames byte-identical; the live lane skipped only where strictly coarser). After the merge,
  S11 on the new build closes or re-opens commitment 228.
- **W-10 R4-R7 measured (seq 224; log c188):** the release evidence for D-002. R4/R5 found four single-theme map
  controls, a label cut to "Request a " since 2026-05-18 (production too), and light-chip contrast under AA: fixed in
  #204 (axe light 14 -> 0, mobile sheet 13 -> 0). Still open for the release: nested-interactive map
  markers, the viewport's disabled zoom, R6 (production proxy volume: owner data). R7: re-publish the locked
  fc140024 deploy.
- **2026-09-30 evening reads (session c188):** (1) **Commitment 198 (seq 215): the per-region consensus rule OUT OF
  SAMPLE.** Hawaii CONFIRMED on the training weeks (GFS 0.313 < equal 0.345, n 6,817); atlantic_se REFUTED (equal
  0.168 < GFS 0.181, n 11,942). Hawaii-only rule: train 0.192 vs equal 0.196 (-1.9%) vs GFS 0.229 (-16%). **Owner
  decision pending: serve the equal mean everywhere except Hawaii** (amends D-006); its switch is built DARK
  (`CONSENSUS_SERVE_KEEP_GFS`, #203): the flip is `CONSENSUS_SERVE` '1' + `CONSENSUS_SERVE_KEEP_GFS` 'hawaii'.
  (2) **Commitment 203 (seq 214): W-30's A/B** on the parity monitor: tide-blind sim max 9.6, 3 level differences at
  the banded spots; SIM_SERVED_TIDE=1: 0.0 and 0. **Owner decision pending: flip SIM_SERVED_TIDE.**
  (3) Commitment 188 (seq 216): no big-swell calibration now; atlantic_ne at the 0.2 m threshold on one week, re-read
  on a disjoint week (commitment 217, due 2026-10-08).
- **Commitment 186 READ (seq 196, corrected by 199), 2026-09-30T18:55:49Z pass:** the built consensus shadow matches
  its definition (abs(shadow - equal) median 0.000, p90 0.013 m; n 92 at +24 h) and beats served GFS on the same
  pairs (0.135 vs 0.175 m). The per-region rule (GFS in hawaii and atlantic_se, the equal mean elsewhere) reads 0.271
  vs equal 0.287 vs GFS 0.319 over 8,750 held-out pairs, but IN SAMPLE (the window shares 6.9 of 7 days with the pass
  that chose the coasts). Out of sample on the training weeks: the regional-rule PR, read by commitment 198 (due
  2026-10-01 18Z); only then a recommendation. 177's first half met (`wind_n` 3, seq 197).
- **HANDOFF for a fresh context: `HANDOFF-2026-10-01.md`** (03:09Z; the shared-L1-object defect class, #213, the four
  open PRs and what each must do on its `dev` merge; adds to `HANDOFF-2026-09-30-b.md`, which still holds).
- **HANDOFF, previous: `HANDOFF-2026-09-30-b.md`** (evening; supersedes `HANDOFF-2026-09-30.md` for what
  next). Consensus evidence at the 16:31Z pass: the computed equal mean beats served GFS all-sea (24/48/72 h
  0.286/0.312/0.373 -> 0.262/0.290/0.323) and in every band, but LOSES in `hawaii` (0.443 -> 0.543) and
  `atlantic_se` (0.222 -> 0.250): the recommendation is a per-region serve rule, built dark (seq 185).
- **MEMORY AUDIT 2026-09-30 (`log/2026-09-30-memory-audit.md`):** every store re-checked against reality; 5 local
  memories were stale or wrong (fixed, dated); the Mem0 connector stores a plain-text API key (**owner: rotate it
  at Mem0 and delete memory `623a983f-...`**); we learn only what we mechanize (LESSONS L-A7), so L-P10 is now two
  checks (`action_ledger.py` refuses estimated times in `verified`; `memory_audit.py` reads HANDOFF headers; clock
  slack 5 -> 1 min). W-50 (512 MB) corrected in BRAIN_RULES and the system-brain doc.
- **AUDIT 2026-09-30, read first: `log/2026-09-30-audit-sota.md`.** Four new findings, each priced on production:
  (1) `/point` interpolated marine HEIGHT as a vector (served heights low wherever corner directions diverge: 11% of
  spots > 5% low; same-model MAE 0.055 -> 0.043 with scalar) -> fix built DARK (`SAMPLER_SCALAR_HEIGHT`);
  (2) the measured error budget: offshore Hs 37% of rating variance, swell direction 33%, wind speed 19%, period
  10% (corrects the 2026-09-29 audit's flags-off ranking); (3) the skill ledger's queue sat at 29,477 of its 30,000
  cap and the `CONSENSUS_SERVE` flip would have evicted every lane's +72 h rows -> cap 54,000 in the same PR;
  (4) a Supabase 429 on a regional tile silently serves the 2-degree tier labelled `regional` (W-23). The ordered
  path is its section 4.
- **HANDOFF for a fresh context: `HANDOFF-2026-09-30.md`** (reading order, the production-reach finding, what
  landed #181-#186, open commitments, next fixes in order, owner-only items, measurement recipes, the report
  audit). Read it after this file; `HANDOFF-2026-09-29.md` still holds the switch table and science threads.
- **`dev` = `f302c309`** (#217 at 2026-10-02 02:42:26Z, the skill-ledger reader; Render live from 02:45:03Z; seq
  288-289). Before it `67fe4918` (#216 at 02:21:51Z, docs; seq 287), after `48460019` (#218 at 02:17:18Z, CLAUDE.md
  only; seq 286). Before them `63a70425` (#215 at 2026-10-01 11:52:12Z: the vector half of the shared-L1-object guard,
  test-only; seq 274; Render serves it from 11:54:36Z, seq 276). Before it `49e1d62d` (#211 at 04:13:07Z, backend). The same night, each on the owner's word, merged in a
  STACK (LESSONS L-P21): #210 at 04:12:51Z as `33364453` (commitment 228's fix: far-zoom pages from the stored 2-deg
  field), #208 at 03:50:34Z as `c60d5bcd` (memory_audit reads every log header), #212 at 03:48:58Z as `a8c90a42` (the
  mid tier copies before stamping), #214 at 03:29:54Z as `e2fd1d08` (HANDOFF-2026-10-01), #213 at 03:07:59Z as
  `454d96cb` (the resolver copies before stamping; Render read back at 03:11:40Z, seq 244). Render served `c60d5bcd`
  from 03:54:18Z, `33364453` from 04:15:20Z and `49e1d62d` from 04:18:00Z (seq 273). Before them `ac080442` (#207 at 00:15:39Z, docs only;
  seq 239), and `e8321acc` (#209 at
  2026-09-30 23:57:13Z, docs only; before it #206 at 23:39:24Z as `1ff11a05`, the
  encoding-debris cleanup, frontend, so Render restarted, W-26). ⚠️ Every frontend merge still
  redeploys the backend: the Render build filter ignores `docs/**`, `audit/**`, `**/*.md` but not `frontend/**`
  (W-26, owner-only Render setting; #182, #183 and #184 each restarted it). The Render backend auto-deploys from `dev`. The production frontend is frozen at `fc140024` (D-002).
- **Open PRs of ours:** #223 (the cached-product guard, seq 294-300), #220 (PR C, the consensus flip sweep), #221
  (the far-zoom fixes) and #222 (commitment 228's par2 residual). All four start their ledger lines at seq 294:
  whichever merges first keeps its numbers, and each later one re-chains onto dev's head (#222 and #223 both carry
  `pr_merge #219`; the second to merge drops its copy). Agreed order: #223, then #220, then #221. #219 merged 2026-10-02T03:43:27Z as `c4a59c01` (seq 294); #217 and #216 merged (seq 288, 287). The six old `codex/*` PRs (#15, #22, #23, #27, #43, #44) were
  CLOSED on the owner's word at 12:12:39-12:12:52Z (seq 278; finding seq 275: all conflicting with `dev`, four
  drafts, the rest partly superseded). Their branches are kept; reopen one, or rebase it in a new PR, if
  anything in it is still missing. Merged 2026-10-01: #215, #211, #210, #208, #212, #214 (see `dev` above; seq
  249, 262, 267, 270, 271, 274 record them), #213
  (03:07:59Z as `454d96cb`; seq 240-243: `resolve_grid`'s step-4 and EURO->GFS fallback stamps wrote into the L1
  entry's diagnostics dict; fixed by a copy, plus an AST guard; no served number changes), #207 (00:15:39Z as
  `ac080442`, docs; seq 239). Merged 2026-09-30: #209 (23:57:13Z as
  `e8321acc`, docs; seq 236), #206 (23:39:24Z as `1ff11a05`, the ASCII debris `da30f15d` left in user-visible strings + the
  `encodingDebris` source guard; no served number changes; seq 234), #205 (22:55:23Z as `8abc6e61`, the marker PR; seq 232), #204 (22:15:26Z, the map chrome in three themes), #203 (21:43:10Z, `CONSENSUS_SERVE_KEEP_GFS`, dark), #202 (21:28:24Z, the 198/188/203 findings), #201 (21:14:06Z,
  W-31 `unknown_depth`), #200 (20:44:00Z, commitment 203:
  the probe grades with the glyph's tide; the A/B dispatch pair follows), #199 (20:25:43Z, W-30 DARK
  behind `SIM_SERVED_TIDE` '0', with the catalogue fix; as opened it was inert, seq 205), #198
  (19:56:30Z, the per-region rule graded on the training weeks: commitment 198 reads it), #197 (19:36:43Z,
  commitment 188's instrument: read it after the next precompute), #196 (19:17:15Z, the evening handoff),
  #195 (18:38:47Z, W-23), #194 (17:53:50Z, S9 wind), #193
  (17:20:49Z, S7/S8), #192 (14:33:02Z, the Mem0/Trevec record), #191 (14:07:22Z, the ledger for #189/#190 + the Trevec registration), #189 (12:48:23Z, the audit + dark scalar height + its
  ARMED ledger shadow + the ledger cap), #190 (13:47:39Z, the memory audit + the L-P10 checks + W-50). Merged
  2026-09-29/30 before them: #181-#188.
- **Trevec (code-graph MCP):** registered in Claude Code (user scope) on this machine, index OUTSIDE the repo
  (`C:\Users\David\.trevec\data\raw-surf-wt`), INDEXED 2026-09-30 (424 s; `trevec ask` answered in 2.2 s). Its tools
  load in sessions started after 13:49Z. The index is a snapshot: re-run `trevec index` (or `trevec watch`) after big changes.
- **Mem0:** the owner revoked the old keys; the leaked key was redacted from memory `623a983f...` (seq 164-165).
- **The weather sim does not reach production map users** (#181 F1): `fc140024` is 3,283 commits behind `dev` and its
  map reads a Netlify Open-Meteo proxy. The plan's Phase 1 is the release-readiness evidence for D-002.
- **Open commitments:** `python backend/scripts/action_ledger.py open` (seq 79, 94, 149). 78, 86, 128 fulfilled early
  on 2026-09-30 (seq 139, 140, 138).
- **Live science:** one forecast composition (`surf_point.resolve_surf_geometry` + `estimate_surf_at` →
  `surf_rating.compute_surf_rating`); #146 cross-shelf friction off + cap-seam repair; #120 refraction Kr 0.873;
  per-spot size references (`RATING_LOCAL_SIZE=1`), now fail-closed in the precompute (#162).
- **BUILT, DARK (#175):** `CONSENSUS_SERVE` (consensus_serve.ServedStore; D-009's one switch). Flip on the
  shadow's evidence: forecast-ingest.yml + precompute.yml + the live env together.
- **FLIPPED 2026-09-29 (#174, D-010):** `REGRID_NATIVE_CELL` '1': regional wave tiles read their exact native
  cell (land nodes their centred 3x3). Effective per lane at its next ingest. Measure: the parity probe
  (node vs native 0.045 m before) and the ledger's same-model gap (S2 NCEP line).
  ✅ VERIFIED 2026-09-30 (seq 139): nodes 98% within 0.011 m of Open-Meteo's own cell; probe MAE 0.076 -> 0.051.
- **FLIPPED 2026-09-29 (#179, D-011):** `GFS_MARINE_STAGE_B` '1'. ✅ VERIFIED 2026-09-30 (seq 140): 205
  `us_pacific_northwest` products; the five named buoys serve regionally; Render memory 54-62% of 2 GB.
- **BUILT, DARK (the 2026-09-30 audit PR):** `SAMPLER_SCALAR_HEIGHT` '0' in forecast-ingest.yml,
  forecast-ingest-pilots.yml, precompute.yml (+ Render env on the flip): marine heights interpolated as scalars.
  **ARMED with it (serves nothing):** `SAMPLER_SCALAR_LEDGER` '1' (forecast-ingest.yml + precompute.yml): the
  ledger grades `raw_surf:GFS_SCALAR` beside `raw_surf`; commitment 149 reads it. Ledger cap 30,000 -> 54,000.
- **ARMED 15:30:45Z (#168):** the consensus SHADOW (model `CONSENSUS`, `CONSENSUS_INGEST` '1' in all three lanes).
  Serves nothing to users. VERIFIED: run 36590800405 built 874 frames across 18 regions (17:00Z); the 17:12Z
  precompute ledgered +137 `raw_surf:CONSENSUS` rows. First scored rows ~24 h later; then read `shadow`.
- **Built but dark:** MOP nearshore
  (`SURF_NEARSHORE_MOP`, graded, flip waits on spot observations).
- **Armed switches:** the workflow-dispatch fallback (#153), armed 2026-09-29 13:30Z. It dispatches a data lane's
  workflow when GitHub drops its cron slot. Audit it at `/api/health` → `scheduler.workflow_dispatch.last`. Kill:
  `WORKFLOW_DISPATCH=0`.
  ✅ **Working since the owner's token fix:** at 15:00:50Z it dispatched the missed core-ingest (12:15Z) and pilots
  (11:45Z) slots, and at 15:22:48Z declined to stack duplicates while they ran. Durable record: Render log
  `[workflow-dispatch]`.
- **CI floors on `dev`:** guards 179 files / 2177 (reading 2183, dev `c4a59c01`), chain 140 / 1734 (reading 1740,
  dev `c4a59c01` run 36961412429; the guard PR moves it to 141 / 1748, projection 1754; #220 re-derives after it),
  estate 580 (582).
- **Accountability:** every state-changing action is a line of `ACTIONS.jsonl` (BRAIN_RULES §23), hash-chained and
  verified in CI (`weather-program-ledger.yml`). The anchor below moves with every STATE update:
**Ledger head: seq 1656, sha256 fceb1434c9d17ab4d27e3a256c7fe647b76ecf03c88b5781515b6eba93c97b48**

## Next fixes, in order
**The 2026-09-30 audit's order (log §4; supersedes the list below where they differ):** 1 ~~merge the audit PR~~ (#189,
done); 4 MERGED as #193 (its first graded rows: commitment 172, 2026-10-02); 5 (wind) MERGED as #194 (commitment 177); 6 (W-23) MERGED as #195 (commitment 182); commitments 79/94 checked (seq 185, 187), re-promised as 186/188; 188's instrument MERGED as #197; 186 read (seq 196): the per-region rule wins IN SAMPLE, its out-of-sample grade is #198 (merged; commitment 198); W-30 (sim tide parity) MERGED DARK as #199, its evidence lane is commitment 203;
2 the consensus flip on commitment 79's evidence (its ledger-cap precondition is met by that PR); 3 the
scalar-height flip on 48-72 h of `raw_surf:GFS_SCALAR` rows (commitment 149); 4 an S8 swell-direction (and period)
lane in the ledger (33% of rating variance, no instrument), then test a consensus direction/period; 5 S9 wind in
the ledger (19%; the observed-wind swap moves 30% of GFS levels), then coastal high-resolution wind; 6 W-23 (the
serve path retries a 429 and names its fallback); 7 W-10/W-11 (release). Deprioritised by measurement: item 5 below
(big-swell calibration: forecast-binned bias on the equal mean is -0.10/-0.04/-0.03 m) and partitions as a
direction fix (not supported by a bulk-buoy instrument; needs spectral truth).

- ~~**A Pacific NW / NorCal regional tile**~~ built (#177) and flipped (D-011); The 2-deg global_mid tier reads +0.097 m high vs the same
  model (38% of the squared gap), led by 46244 Humboldt (+0.50 m) and Oregon/Washington buoys that no
  regional tile covers (us_west_coast_socal stops at 38N). Size it against Render memory (F-08).
0. ~~**Regrid at native resolution**~~ FLIPPED by #174 (D-010); verify with the probe and the ledger: every 0.25-deg regional tile of GFS, ICON and EURO is a 2x2
   block mean shifted half a cell NW (`half = max(1, round(res/0.25/2))` = 1; ledger seq 43). Fix: the exact
   native cell at native resolution, one shared `block_half`, behind `REGRID_NATIVE_CELL` (default 0) in the
   ingest lanes; evidence = the parity probe (node vs native cell -> rounding) and the ledger's same-model gap.
   Then: GFS-Wave is ingested 3-hourly (`f_hours = range(0, max_f+1, 3)`) while it is published hourly to
   f120 (Open-Meteo meta: temporal_resolution 3600 s): off-frame hours snap by 1 h.
1. ~~**Accuracy monitor false alarm**~~ merged as #166 (`0b169692`): page on "no scored rows for N hours", not on one zero-score pass
   (LESSONS L-F4).
2. ~~**No shadow model reaches an upstream**~~ merged as #167 (`b16dbb5d`): the wind fallback was ungated, so the armed `CONSENSUS`
   ledger lane would have scored real GFS wind under its name (ledger seq 27-28). Must merge BEFORE arming.
3. ~~**Arm the consensus shadow**~~ merged as #168 (`de72c81c`), 15:30:45Z: `CONSENSUS_INGEST: '1'` in forecast-ingest-pilots.yml,
   forecast-ingest.yml and precompute.yml (+~5% manifest, D-009). Then PR C reads `raw_surf:CONSENSUS`.
3. **Consensus PR C:** evidence for the flip: judge `CONSENSUS_AB`, ledger `by_band`/`by_region`, a before/after
   catalogue sweep of displayed heights. Then the owner's flip. (2026-10-02: the ledger and judge halves are #158,
   #160, #169; the sweep is `scripts/consensus_flip_sweep.py` + `consensus-flip-sweep.yml`, built on
   `claude/consensus-flip-sweep`; its first reading is that PR's own run, `log/2026-10-02-consensus-flip-sweep.md`.)
4. **MOP for California:** needs spot observations for the sheltered spots (Fort Point, Rincon, Leadbetter, Sands).
5. **Big-swell calibration on the served consensus:** quantile mapping by lead and coast, trained on the ledger's
   big-swell rows (every model reads 0.3-0.8 m low on 3 m+ days).
6. **Uncertainty** from the 51-member ECMWF wave ensemble (blocked on pygrib in CI).
7. **Close the public-reference gap** (SCOREBOARD S2: Open-Meteo marine +0.045 to +0.058 m ahead at 24-72 h since
   2026-08-10). Steps 1, 3 and 5 are the planned attack; re-read S2 after each.

## Open, not yet diagnosed
- Supabase 429 bursts on the SERVE box that are not ours: 02:25:58-02:26:24Z hit ~20 12Z-frame waves/swell_1
  products no audit request asked for (a prewarm? a client scrub?). n = 1 (log 2026-09-30-audit-sota §3.5).
- Marine Nightly zoomlab: 12 MULT0 animation frames (2026-09-29) and 15 s API timeouts (2026-09-28). n = 2. The MULT0 frames are F-22: diagnosed and FIXED in the client 2026-10-02 (see Now); not yet read back on the nightly.
- The live `/spot-ratings` fallback still rates on the global default when its climatology read fails (#162
  residual; failing closed there needs a frontend decision).
- **Hurricane eye changes shape while the hour is fixed (owner, 2026-10-09): DIAGNOSED 2026-10-09, fix dark on
  branch `claude/wind-eye-one-model`** (log `2026-10-09-hurricane-eye-one-model.md`). The bounds/bilinear hypothesis
  is ruled out: the same data in another box draws the identical eye (0 km). The real cause is two models under one
  label. A one-stop zoom changed the snapped box, and the two boxes came from different lanes:
  - Open-Meteo `gfs_seamless`, which is HRRR inside HRRR's domain (405/405 nodes equal `gfs_hrrr`);
  - the native recovery, which is NOAA GFS.

  Measured on the wind bench (eye mode): the eye centre moves 38.3 km, the weakest wall point drops 16 kn, and the
  eye's area changes x2.17. `WIND_GRID_GFS_GLOBAL=1` (Render env, default 0) cuts that to 9.1 km / 2 kn / x0.71.
  Owner-only: the flip. **Flipped by the owner (Render), and superseded by the HRRR wind lane (D-017, default on,
  2026-10-09):** the model is now chosen by place and time on every tier. Lane bench: 0.0-0.2 km across tier, pan,
  zoom and upstream. Still open: the lattice changes with zoom (0.5 -> 0.25 deg at ~z8 draws the same eye x0.30 in
  area, 0.5 km apart). Log `2026-10-09-hrrr-wind-lane.md` §9.
- Wind, open (measured 2026-10-09, same log): above z6 the speed-aware draw cull switches on at full strength in one
  step, so with the grid fixed the eye's trail ink over its wall's goes 1.21 (z6) -> 1.77 (z6.5). A fade-in over
  z6 -> 7 is the candidate; it needs an owner A/B.
- Wind, still open from #281/#282: a bright blob at the eyewall that the significance scanner flags in every theme (all
  bench seeds, ~37-42 kn); and particles losing salience where they match a same-coloured field at the storm's peak ring.
- **Wind palettes fail the colour-blind floor in all three themes** (2026-10-09, `frontend/scripts/wind-color/check.mjs`,
  coloraide Viénot/Brettel; floor 5 dE2000 between neighbouring stops). Weakest pairs:
  - legend: light 27-33 kn protan 3.9; beach 10-16 kn tritan 1.9; dark 16-21 kn protan 2.4;
  - tints over water: light and beach 27-33 kn deutan 0.3-0.4 (yellow-green vs gold collapse); dark 21-27 kn protan 2.1;
  - light 6-10 kn deutan 4.9 -> 4.3 after #288.
  This needs a design pass on all three palettes, then an owner A/B. Lightness steps are the usual cure for the
  yellow-green/gold collapse.
  **Update 2026-10-09 (branch `claude/wind-cvd-palettes`, log 2026-10-09-wind-cvd-palettes): awaiting the owner's A/B.**
  Dark and beach pass every checker line; beach also passes over land. Light's legend passes; light's tint over water
  is raised 0.3 -> 2.75 and kept as an exception for the owner to accept. Dark parity leaves light's 40-75 kn tints a
  near-grey over the water, and a full pass needs a field redesign (offered, not shipped). Kills:
  `__RAW_DISABLE_WIND_<DARK|BEACH|LIGHT>_CVD__`.
  **Update 2026-10-10: on dev.** #292 was CLOSED unmerged and carried whole by #294 (`1cdcd8d3`); #297 then moved five
  light field rows on the muted ground. Verified on dev `9e11676c`: all 36 rows #292 changed are still changed, the
  three kills restore the shipped rows, `windPaletteCvd.test.js` passes (14 tests) and 10 mutations turn it red, and
  the checker shows one red line, light's tint over water at 2.6 (log 2026-10-10-closed-pr-audit).
- **Thinned world forecast frames are drawn stretched north** (2026-10-10, found by the closed-PR audit; closed #27 and
  #23 carried the fix, never merged). A 48-frame world page is thinned 4x to 46 x 21: its top row is 80N, its `bounds`
  still say 84N (`series_vector_budget._decimate_frame` rewrites vectors, cols and rows, never bounds), and the client
  spreads rows across the bounds (`gridPointRegistration.js`). Measured with dev's own function: data at 0N is drawn
  at 2.0N, 24N at 26.6N, 40N at 43.0N. It shows while scrubbing or playing at far zoom, until the exact frame lands
  for a settled hour (`marineExactUpgrade.js`). Same family: `normalizer.py` stamps the REQUESTED bbox as bounds (the
  10-deg world product ends at 80N and says 85N). Not yet checked: which consumers besides the heat map read those
  bounds. The fix changes a served field (`bounds`), so build it dark and let the owner flip it.
- **The retained coarse world base is reused on shape, not content** (2026-10-10, same audit; closed #23 carried the
  fix). `coarseBaseKey` holds model, layer, cols, rows, bounds, hour offset and rating flavour, but no run or valid
  time, so a new world grid for the same offset (a new run, or an hour rollover in a long-open tab) keeps the old
  pixels as the base that regional commits fade over. Read from the code; not yet reproduced on screen.
- **Owed read-back: the strided world read on the deployed box** (the commitment closed #222 carried; the code landed
  2026-10-03 through `7cd898f4`). SCOREBOARD has no S11 row after that date. It needs live load (S11 par2 and seq), so
  it waits for the owner's go-ahead.

## Owner-only
- Arm the nearshore judge hourly (`NEARSHORE_VAL_ENABLED=1`, a repo variable).
- Every served-number flip: the consensus (after PR C) and MOP (after spot checks).
- Unfreeze the production frontend.
- `GRANT SELECT ON public.surf_reports TO service_role;` as a migration (found 2026-10-02 on closed #225, never
  recorded on dev; re-checked 2026-10-10: only `postgres` holds a grant, the sibling `surf_spots` grants SELECT to
  `service_role`). Until then `rating_confirmation.fetch_recent_reports_via_rest` and `report_calibration` are refused
  and the rating gate runs without user condition reports. Latent today: 4 rows, newest 2026-03-19.
- Also open: stale island products in `/products`; the A15-07 Satellite label; band spot-anchoring; real-device
  checks (#85 phone banding, #87 120 Hz wind); F-09 temperature capability rows; A15-11 detach-vs-budget.

## How to measure
```bash
gh workflow run nearshore-validation.yml --ref dev -f backfill_hours=24 -f mop=1 -f mop_grid=1 -f nwps=1 -f consensus=1
gh workflow run science-shadow-ab.yml --ref dev -f candidate="SURF_NEARSHORE_MOP=1"
gh workflow run precompute.yml --ref dev        # also runs the buoy calibration (the skill ledger)
gh workflow run e2e-tests.yml --ref <branch>
```
- The ledger: `https://raw-surf-antigravity.onrender.com/api/weather/buoy-calibration` → `forecast_skill_consensus`.
- Decision lines: `VERDICT`, `GEOMETRY`, `CONSENSUS_AB … SAME_ROWS`, `MEMBER_AB`, `PAIR_AB`, `MOP_AB`,
  `MOP_GRID_AB`, `NWPS_AB`, `TRAINS_AB`, `LEGACY_FRICTION_AB`; the shadow A/B prints `MOP`, `HEIGHT`, `DEPENDENCY`,
  `INFERRED`.
- Never dispatch the judge within ~20 min of a `dev` merge (LESSONS L-O1).
