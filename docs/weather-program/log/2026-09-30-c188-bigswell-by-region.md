# 2026-09-30 session c188: the handoff picked up; commitment 188's instrument (#197)

Session `c188`, worktree `C:\Users\David\App\raw-surf-wt`, branch `claude/c188-bigswell-by-region` (from
`claude/handoff-2026-09-30-b` at `14961798`). Owner (chat): "Pick up on the last context where it left off and check
the handoff report". Times are clock reads (`date -u`) or platform timestamps (L-P10).

## Start (19:11:09Z)
- `memory_audit.py`: 0 FAIL / 0 WARN / 6 NOTE (commitments 149, 172, 177, 182, 186, 188 open, none overdue).
- Verified live against HANDOFF-2026-09-30-b: `origin/dev` = `2123d70e` (#195); #196 open, every check green (hosted
  chain 136 / 1655 = the projection); Render `/api/health` at 19:11:40.9Z: version `...2123d70e`, uptime 1020.5 s,
  so #195 (W-23) has served since 18:54:40Z (ledger seq 194; commitment 182's 12 h window opens 2026-10-01T06:55Z).
- Precompute 36759469454 (started 18:33:50Z) still in progress at `b1e5e50d` = #194's merge, so its report carries the
  S9 wind fix (commitment 177) and the consensus shadow's first +24 h targets (commitment 186).

## Commitment 188's instrument (#197, opened 19:17:28Z)
The handoff's next buildable item not waiting on data. `skill_consensus._big_swell` gains `by_forecast_by_region`:
per lead, for the served lane and the equal mean (the two choices of the recommended per-region serve rule), each
forecast's own >= 3 m calls per coast, MAE and bias; both keys listed where either calls big (n 0 where one never
does); a thin cell (< 10) prints n only. The held-out pair's coast is carried aligned with the lead's test list.
- No served number changes; no fetch; no new ledger rows.
- 2 tests; mutations 8/8 caught (harness in the session scratchpad, verdict from pytest's summary, no shell).
- ⚠️ The mutation harness restored the file with Python text mode, which wrote CRLF on Windows: `git status` showed
  it modified with no content diff. Restored from the committed WIP (`git checkout HEAD --`); `file` reads LF again.
  A harness that restores must write bytes (`read_bytes`/`write_bytes`), not text. Recorded as LESSONS L-P16.
- 210 nearby skill/calibration tests pass locally (main checkout venv, 2 declared packages absent).
- Chain floor 136 / 1651 (hosted 1655 on #196 + 2 = 1657, margin 6), `_FLOOR_SET_FROM["chain"]` -> 1657.

## Owner action learned of
- #196 merged by the owner at 19:17:15Z as `50669cd5` (ledger seq 193), 13 s before #197 was opened; #197's
  diff is therefore its own commit only.

## The read (commitment 188, due 2026-10-02 18Z)
After #197 merges and a precompute runs: `forecast_skill_consensus.by_lead[*].big_swell.by_forecast_by_region`.
Build a dark regional calibration only if a coast's forecast-binned bias exceeds ~0.2 m with n >= 30.

## Owner (chat, after 19:20Z): "merge #197 when it's green and move to the next fix"
- GitHub auto-merge refused ("Auto merge is not allowed for this repository"), as the handoff said; the merge waits
  for the checks and is done by hand.
- #197 MERGED 19:36:43Z as `15188320` (ledger seq 200): 15 pass, 3 skipped (Netlify), 0 failing; run 36764840449's
  chain job collected 1657 tests across 136 files = the projection.
- Precompute 36759469454 completed 19:17:37Z; the report it published reads `generated_at` 2026-09-30T18:55:49Z.

### Commitment 186, read (ledger seq 196)
- Built shadow at +24 h, n 92: MAE 0.135 / bias +0.014; computed equal 0.139 / +0.033; served GFS 0.175 / -0.125.
  |shadow - equal| median 0.000, p90 0.013 m: the construction control passes. No 48/72 h shadow rows yet.
- by_region, computed equal, held-out week pooled over leads (n): hawaii GFS 0.440 / equal 0.538 (946); atlantic_se
  0.215 / 0.243 (1730); atlantic_ne 0.400 / 0.321 (1911); gulf 0.164 / 0.149 (322); pacific_ne 0.305 / 0.242 (3321);
  other 0.327 / 0.223 (520). n-weighted: GFS 0.319, equal 0.287, the per-region rule 0.271.
- Why no recommendation yet: this window (09-23T18:55Z..09-30T18:55Z) shares 6.9 of 7 days with the 16:31Z pass that
  chose the two coasts (5.7 with the 09-29 11Z pass). Three agreeing passes are one sample. ⚠️ Ledger seq 196 first
  said "~5.9"; corrected by seq 199 (re-derived before pushing). The training weeks
  never saw the choice: they are the test. New commitment 198 reads it.

### Commitment 177, first half met (ledger seq 197)
`summary.wind_n` 3, `wind_mae_kt` 3.86 (was 0 since 2026-08-09). The ledger's wind grade reads `no_wind_rows` (24 h of
new rows needed); it rides with 172.

### The next fix: the per-region rule graded out of sample (branch `claude/consensus-regional-rule`)
`RULE_GFS_REGIONS` declared; `regional_rule` (per lead, held-out AND training weeks: served, equal, rule) and
`by_region_train`; the shadow's `by_region`. 4 tests; mutations 11/11 (bytes restore, `git status` clean after).
No served number changes.

### Commitment 149, early look (not its read)
The 18:55Z report's `forecast_skill` has no `raw_surf:GFS_SCALAR` lead grades yet: the lane was armed by #189 at
12:48Z, so its first +24 h targets score on 2026-10-01. Due 2026-10-03T18:00Z; nothing owed yet.

### W-31 scoped (not started)
`surf_transform.py:415` returns the offshore Hs labelled `shelf` when a coastal spot has no usable depth. The label is
not cosmetic: `surf_height_convention._CONVERTIBLE = ("shelf", "shoaling")` applies the x1.27 H1/10 factor by regime,
so a bare rename to `unknown_depth` would drop the factor there (a served change). The served-neutral fix: name the
regime `unknown_depth` AND list it in `_CONVERTIBLE` (it is still a significant height presented as surf); the plan's
null control then proves byte-identical heights. Consumers of the label to check first: `mop_nearshore.py:235`,
`surf_transform.py:527`, and anything that branches on `regime` downstream (frontend included). Backend branches
found: `surf_rating.py:740`, `surf_transform.py:645`, `grid_size_climatology.py:117` exclude only
open_ocean/calm/unknown, so `unknown_depth` would rate like `shelf` there (served-neutral). 13 frontend files mention
"shelf", but none branches on the literal regime string (non-test grep for the quoted value: 0 hits): shelf width and comments.

### W-33 scoped (not started)
`backendWeatherServiceClientPoint.js:666` writes `infoboxDisplayedHeight: point.speed` (the OFFSHORE Hs) into the
debug trace `window.__GFS_WAVES_SINGLE_SLICE_TRACE__.exactPoint`; nothing else reads the field. The fix is a rename
(e.g. `offshorePointHeight`), served-neutral, but any frontend merge restarts the Render backend (W-26): bundle it with
other frontend work.

### W-30 scoped (not started)
`spot_ratings.rate_one_spot` applies tide (`tide_norm_at`, the `tide_fit` factor) under `RATING_TIDE`, which is '1' in
forecast-ingest.yml, precompute.yml and sim-parity-monitor.yml; `sim_rating.py` has no tide path. So the sim and the
served rating diverge on every spot with a `best_tide` prior (38 of 1516 on 2026-07-18; the plan's S4 monitor names
18 banded spots, up to 2x quality). A served-number change for the SIM surface: dark flag, parity test on a
"Low tide" spot, then the owner's flip.

### For the dark build, if commitment 198 confirms the rule
- The switch is small: `consensus_serve.twin_index` pairs GFS regional tiles with their CONSENSUS twins by
  `region_id`; a rule is a region filter there, behind its own default-off flag, so a tile outside the rule keeps GFS.
- ⚠️ The ledger's coasts are NDBC id prefixes, not tiles. The spot-matched `41xxx` buoys in the 18:55Z report are
  41065/41067/41070/41076/41110/41112/41113/41115/41117/41120/41121/41159 (mostly CDIP nearshore, North Carolina to
  Florida), so `atlantic_se` means the US Southeast coast, not the Florida tile alone; `51xxx` are 51201-51214 (Hawaii).
  The tile list must be derived from where those buoys sit, and graded per tile before any flip.

## Owner (chat, after 19:38Z): "merge #198 when it's green and move to the next fix"
- #198 MERGED 19:56:30Z as `78c568d9` (ledger seq 202): 15 pass, 3 skipped; chain 136 / 1661 = the projection;
  guards 175 / 2130.

### W-30 built DARK (branch `claude/w30-sim-tide`)
The next fix in the handoff's order not waiting on data. The design turned on one recorded trap: the plan's wording
("when it has a valid_time and RATING_TIDE=1") gates on the sim's own env, which is empty on the owner's machine, so
the fix would have been inert where the sim runs. Instead the sim reads the tide state THE GLYPH graded with off the
`/spot-ratings` response `sim_observed.parity` already fetches (`SpotRatingItem.tide` survives the wire), with the
same condition and arguments, so it costs zero new I/O (a test counts one request for tide and parity together).
- Effect, measured on a synthetic "Low" reef at high water (norm 0.95): sim 97.3 epic -> 48.7 fair, x tide_fit 0.5,
  what the glyph grades. A spot with "All tides" is unchanged.
- `SIM_SERVED_TIDE` default '0'; 15 tests; mutations 13/14, the survivor an equivalent mutant (a redundant isfinite()
  that the range test covers), removed. The composition-parity registry marks the sim's tide SUPPLIED.
- ⚠️ The first mutation run hit a Windows write error (errno 22, a file held just after a test read it) mid-run and
  left a mutant in `sim_observed.py`; the committed WIP restored it (`git checkout HEAD --`). The harness now retries
  a held write. Two local failures in the wider sim suite (`condition_reports` absent from the local sqlite; the stdio
  handshake) fail identically at the base commit: environment, not this change.
- `weather_sim_mcp.py` is at 800 lines, the ceiling: the new kwarg replaced a comment line.
- Evidence lane (commitment 203, due 2026-10-02T18:00Z): the parity probe must pass the glyph's `item["tide"]` on its
  composition call under the flag and sample the banded spots; then a monitor dispatch 1 vs 0.

## Owner (chat, after 19:58Z): "merge #199 when it's green and move to the next fix"
- ⛔ #199 NOT merged yet, on purpose: scoping the next fix (commitment 203, the probe's tide) meant reading
  `sim_forecast.fetch_catalog`, and it drops `best_tide`. Every real spot reached the sim with no tide prior, so
  W-30 was inert on all of them even when flipped; its 15 tests passed on a synthetic spot built with the prior.
  Fixed on #199's branch (475aece5): the catalogue carries `best_tide`, and a 16th test goes through the real
  catalogue path (positive control: red with the mapping line reverted). Correction ledgered (seq 205); LESSONS
  L-P17. Merging #199 as opened would have shipped a dark switch that could never have turned on.
- Guards floor 176 / 2140 (reading 2146).

### The next fix: commitment 203, W-30's evidence lane (branch `claude/c203-probe-tide`, stacked on #199)
- `sim_observed.glyph_tide(item)`: one gated reader of a served glyph's tide, for the tool and the probe.
- The probe grades both composition calls with it; `--tide-banded` samples one pseudo-region per banded spot;
  the summary's `tide_banded` block grades them apart. The monitor gets dispatch inputs `tide_banded` and
  `sim_served_tide` (defaults false / '0', so the cron is unchanged). 5 tests; mutations 11/11.
- LIVE PREMISE CHECK (public API, read between the 20:14:25Z and 20:15:22Z clock reads, valid_time 20:00Z): `/api/surf-spots` has 1,773 active
  spots, 38 with `best_tide`, **18 banded** (Mid tide 9, Low to mid 5, Low tide 3, Low to mid incoming 1): F8's
  count exactly. `/api/weather/spot-ratings` at 6 of them (Florida): 4 carry the glyph's `tide` (norm 0.27-0.33,
  falling), 2 carry none (Butler Beach, Flagler Beach Pier: the glyph graded tide-neutral there). Under the
  observation design the sim is neutral exactly where the glyph was; a sim fetching its own tide would have
  diverged on those two.
- #199 MERGED 20:25:43Z as `3937c145` at head `a317cf74` (with the catalogue fix; ledger seq 206): hosted guards
  176 / 2146 and chain 136 / 1661 = the projections.

## Owner (chat, after 20:26Z): "merge #200 when it's green and move to the next fix"
### W-31 built (branch `claude/w31-unknown-depth`, stacked on #200)
- ⚠️ CORRECTION (2026-09-30, ledger seq 208) of "W-31 scoped (not started)" above: it said a bare rename "would
  drop the factor there (a served change)". WRONG. `to_surf_convention` is called only inside
  `publish_surf_height`, and the missing-depth branch returns before it, so the H1/10 factor never reached that
  path under either label. The plain rename is served-neutral; listing `unknown_depth` as convertible (what the
  note proposed) would have been the served change. Found by reading the call sites while building it.
- The fix: `estimate_surf` names the regime `unknown_depth`; `_CONVERTIBLE` unchanged. Every consumer that hides
  a regime lists only open_ocean/calm/unknown (backend grid/rating/climatology, frontend card + rating gates), so
  the new label behaves exactly as `shelf` did there. 8 tests (a null control under SURF_HEIGHT_H110 0 and 1, the
  serving producer `estimate_surf_at` per L-P17, the grid); mutations 4/4. 610 regime-touching tests pass.
- #200 MERGED 20:44:00Z as `3048b481` (ledger seq 209): hosted chain 137 / 1666 = the projection. W-31's floor is set
  from it: chain 138 / 1668 (reading 1674).
- #201's first CI run failed only `backend-floor-staleness`: GitHub's run list answered a 45-day-old "newest
  successful dev run" (the known transient, handoff 7); every other job passed (chain 138 / 1674 = the projection);
  the failed job was re-run after the run completed and passed: 15 pass, 3 skipped.

### Commitment 203 FULFILLED (ledger seq 211-214): W-30's A/B
- ⚠️ My first pair of dispatches ran concurrently and the workflow's `concurrency: cancel-in-progress` cancelled the
  first (seq 211); re-run in sequence (seq 213). Read the concurrency block before dispatching a pair.
- Same `dev` 3048b481, both arms 3 min apart, regions=hawaii + the 18 banded spots (Florida, low water, norm 0.11-0.17):
  SIM_SERVED_TIDE=1: 21 rows, dScore 0.0 / 0.0, 0 level differences (tide applied at the 14 glyphs that carried it).
  SIM_SERVED_TIDE=0: max 9.6, 3 level differences, all banded ('Mid tide' spots at low water read high).
- Recommendation to the owner: flip SIM_SERVED_TIDE (the default in `sim_observed.glyph_tide` and the monitor's
  dispatch default, together). SCOREBOARD S4 row added.

### Commitments 198 and 188 READ (pass 2026-09-30T20:57:07Z, precompute 36771572110 at 78c568d9; ledger seq 215-217)
- The first fetch after the precompute answered `{"available": false, "summary": null, "spots": []}` (HTTP 200); the
  retry seconds later served the new report. n = 1; plausibly a read while the report object was being replaced.
- 198: the two-coast rule passes the pre-registered out-of-sample test only on the letter (train rule 0.185/0.193/
  0.206 vs equal 0.186/0.194/0.208). Per coast on the training weeks: hawaii CONFIRMED (GFS 0.313 < equal 0.345),
  atlantic_se REFUTED (equal 0.168 < GFS 0.181). Hawaii-only: train 0.1922 vs equal 0.1959 (-1.9%) vs GFS 0.2288
  (-16.0%); held-out -3.7% vs equal. Recommendation: the equal mean everywhere except Hawaii, built dark, then the
  owner's flip (amends D-006). This is the instrument doing its job: the in-sample winner carried a coast that one
  week had chosen.
- 188: Hawaii's equal-mean big-day over-call (+0.44 to +0.67 m, n >= 62) is removed by the Hawaii-only serve rule;
  atlantic_ne sits at the 0.2 m threshold on one week (-0.201/-0.126/-0.205); atlantic_se is very low for both
  models but n < 30. No calibration build now; re-read on a disjoint week (commitment 217, due 2026-10-08).

## Owner (chat, after 21:11Z): "merge #201 and #202 and move to the next fix"
- #201 MERGED 21:14:06Z as `2c081589` (seq 220); #202 MERGED 21:28:24Z as `f1dddcda` (seq 221). The owner did not
  answer the two recommendations (Hawaii-only consensus; SIM_SERVED_TIDE): neither is flipped.
- The next fix, built DARK: `CONSENSUS_SERVE_KEEP_GFS` (branch `claude/consensus-hawaii-dark`), the Hawaii-only
  rule's switch; unset/'' = D-006 unchanged; declared '' in both rating lanes. 10 tests; mutations 5/5 after
  pinning the unset default (a 'hawaii' code default survived the first run). Chain 138 / 1678 (reading 1684).

## Owner (chat, after 21:29Z): "merge #203 when it's green and move to the next fix"
- #203 MERGED 21:43:10Z as `19121802` (ledger seq 223): chain 138 / 1684 = the projection.

### W-10 R4-R7, the release-readiness evidence for D-002 (ledger seq 224)
Method (reusable; scripts in the session scratchpad): a production build of `dev` (`craco build`), a Node SPA
server on localhost:4173, Playwright + signed Chrome headless; the fixture user of `e2e/weather-simulation.spec.js`;
`raw-surf-theme` set per run; **every non-GET request leaving localhost answered locally with 204** (the only one
seen: a PostHog flags POST; nothing reached the Raw Surf backend); React Scan (unpkg) mocked.
- ⚠️ The first run was DISCARDED: it rendered the Marine Anim Tuner and the Diagnostics HUD, which are localhost-only
  (`MarineAnimTuner.js:21`, `TruthOverlay.js:27-31`), so it measured chrome no production user sees. Re-run with
  `__RAW_TUNER__='0'` and `__RAW_DIAG__='0'`.
- R4: the weather controls (desktop panel, mobile sheet via "Weather layers") theme correctly. FOUR map controls
  are single-theme: MapHeader (title `text-white`, invisible on the light and beach basemaps), MapFilterTabs,
  RequestProButton, MapRightControls. RequestProButton renders "Request a " since da30f15d (2026-05-18, the
  emoji-byte sweep of 305 files; production fc140024 too): that sweep may have cut other labels (unaudited).
- R5 (axe WCAG 2 A/AA): color-contrast serious (light: 14 desktop / 13 mobile-sheet nodes, the unselected weather
  chips, gray-500 on gray-100 ~4.4:1; beach 1), nested-interactive serious (8-9 map markers, every theme),
  meta-viewport moderate (zoom disabled, every run). Console: fixture-user errors only; no weather error.
- R6 NOT PRICED: production `weather-proxy` invocation counts are not readable with the tools here, and Render
  metrics need the owner's Render workspace choice. Render: RSS 782 MB (peak 815, 39.8% of 2 GB) at 16 min uptime.
- R7: production is a LOCKED Netlify branch deploy of fc140024 (published 2026-09-25T18:01:45Z; one function,
  `weather-proxy`, 1024 MB; Netlify's Lighthouse perf 57 / a11y 91). Rollback after an unfreeze: re-publish that
  deploy and lock again. The backend is not part of the rollback (Render already serves `dev`).

### The next fix: the map chrome in three themes (branch `claude/w10-map-chrome-themes`)
`mapChromeTheme(theme)` (dark byte-identical to the old classes), `ThemeContext.useThemeName()` (bare render ->
'dark'), the four controls, "Request a Pro", light `textMuted` gray-600. 23 tests; mutations 9/9 (the first run hit a
cp1252 decode of Jest's output, fixed with an explicit utf-8 decoder; nothing was mutated when it failed);
194 suites / 2,043 tests pass. Before/after screenshots and axe on a rebuilt production bundle: below.
- BEFORE/AFTER on a rebuilt production bundle (same method): axe color-contrast light desktop **14 -> 0**, light
  mobile sheet **13 -> 0**; beach desktop 1 -> 1 (`.shadow-sm`, not the map chrome: plausibly the sidebar's orange
  Search box; recorded, not in this PR). nested-interactive (map markers) and meta-viewport unchanged, not in scope.
  Screenshots: the light title, pills, chips, "Request a Pro" and buttons now light; DARK desktop pixel-diff vs before:
  right-hand buttons 0 px, the top band changed only at the "Request a Pro" label (plus ~50 px of basemap
  anti-aliasing near the SFB airport icon). Only write blocked in all runs: the PostHog flags POST.
- ⚠️ This PR changes `frontend/**`, so its merge restarts the Render backend (W-26).

## Owner (chat, after 21:59Z): "merge #204 when it's green and move to the next fix"
- #204 MERGED 22:15:26Z as `0d8e587a` (seq 226): 18 pass, 1 skipped, the Netlify deploy preview built.
- The emoji sweep (da30f15d) census: 357 mojibake-origin code lines across the app (CrewChat 22, StokedTab 14, ...),
  visible debris such as CheckInModal "+++G- Within range". Out of the weather program's scope: flagged as a separate
  task for the owner (task chip "Audit the text the May emoji sweep broke").
- The live map's basemap is Mapbox with `attributionControl={false}` since 3a384c4d (2026-05-11, "hide mapbox
  attribution"), production included; no component renders "(c) Mapbox (c) OpenStreetMap". A licence question for
  the owner; not changed.
- The next fix: ContentMarker (branch `claude/map-marker-a11y`): axe nested-interactive 8-9 -> 0 nodes on every
  theme and device (rebuilt production bundle); 4 tests, mutations 5/5; 195 suites / 2,047 tests pass.
- ⛔ OWNER REPORT (22:18Z, ledger seq 227, commitment 228): on the live dev site the marine heatmap does not show the
  swell at further-out zooms until zooming in, on forecast hours. A regression; priority over everything else.
- Commitment 228, first investigation (ledger seq 229): NOT reproduced warm (z2/z3 at 0, +1, +2, +5 days all drew).
  The zoomed-out world `grid_series` drops frames past ~+90 h at its deadline (32/48 then 31/48; 22-25 s), and the
  client's per-hour `/grid` lane fills them. The report came right after Render's 22:18:10Z restart (#204, a frontend
  merge restarts the backend: W-26). Hypothesis: the cold window. Harness for the test: `repro_heatmap*.cjs` (engine
  truthTag + grid size + screenshots per step, zoomed out then in); run it in the next restart's cold window.
- ⚠️ At about 22:31Z another session checked out `claude/mojibake-debris-cleanup` in the shared worktree
  (`raw-surf-wt`) with uncommitted changes; my branch-guarded command refused to write there. This session continues
  in its own worktree `C:/Users/David/App/rs-c188` (LESSONS L-P14).

## Owner (chat, after 22:33Z): "merge #205 when it's green and move to the next fix"
- #205's first run FAILED frontend-lint (+4 unused imports and +1 unused eslint-disable in ContentMarker.test.js,
  over the shrink-only baseline); reproduced with `scripts/check_eslint.js` (a node_modules junction in the new
  worktree), fixed by fe3428c8; LESSONS L-P18. #205 MERGED 22:55:23Z as `8abc6e61` (ledger seq 231).
- The next fix = commitment 228 (the far-zoom heatmap). The #205 restart was CLEAN: the cold monitor (every 20 s,
  22:55-23:03Z) saw the new instance serve the world grid in ~1 s with all 10,457 valid cells from 28 s uptime; the
  browser repro in that window drew z3 now/+5 d and the Swell layer at z2 now/+1/+3 d, the Pacific, zoom in and out.
- The owner confirmed (AskUserQuestion) read-only Render logs. ROOT MECHANISM (ledger seq 232): no client ever
  reported an empty render; in the report window the zoomed-out series logged 'GFS marine fast path failed
  (TimeoutError)' then 'hour +Nh timed out after 10.0s' for many hours, near ones included. CHRONIC: the same on
  2026-09-29 evening. The fix is capacity/architecture, not a flag: recommendation in the reply and commitment 228.
