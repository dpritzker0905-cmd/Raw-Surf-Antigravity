# Weather simulation system: read-only forensic + Jacobian audit (handoff)

Audited 2026-09-29 ~22:10Z from worktree `raw-surf-wt`, branch `claude/flip-stage-b-pnw` (HEAD `0de71a0f`). Nothing in
the repo, Render, GitHub or Supabase was changed. One read-only SELECT on prod (`surf_spots`), GETs on `/api/health*`,
`gh run list/pr list`, and local Python sweeps (scripts were in the session scratchpad, not the repo).
Method: FORENSICS = trace each claim in the memory/docs to git, live services and code; JACOBIAN = finite-difference the
sim's composition (`sim_rating.calculate_surf_rating` -> `estimate_surf_at` -> `rating_score`) w.r.t. each input
(swell_h, Tp, swell dir, wind speed, wind dir), find dead zones, inversions, cliffs; then push the served error model
through those sensitivities.

## 0. Read-first summary

1. The composition is healthy and monotone. 60 traces (20 spots x Tp 8/12/16, swell 0.2-12 m): **0 height inversions in
   swell_h, 0 in Tp**. The MC-01 cap seam (#146) is repaired; the interior sweep found nothing (LESSONS L-S10 holds).
2. The Jacobian says the weakest link is NOT height. Height error 0.3 m (S1 MAE) moves the displayed height ~1.2 ft
   (median) but moves quality by ~0 (median) and ~10 pts (p90), because quality has a wide plateau in size. **Swell
   direction (+-15 deg -> ~10 pts) and wind speed (+-3 kt -> ~7 pts) and wind direction (+-25 deg -> ~6 pts) dominate the
   rating error, and the scoreboard measures none of them.** Every SCOREBOARD row is wave height (S1-S3, S6) or
   glyph-vs-sim parity (S4). No instrument grades Tp, swell direction or wind against buoy/anemometer truth.
3. **The program's memory has drifted in five places** (section 5). The most consequential: STATE.md is one merge and one
   open PR behind; #177 (owner said "Merge #177 and flip") is still OPEN and the flip commit has no ledger line.
4. Two silent-fail-open paths in the chain deserve tests (section 4): missing numpy/bathymetry makes the chain return the
   raw offshore height labelled `regime: "shelf"`; and the sim ignores tide (`RATING_TIDE=1` in the served lane).

## 1. What the "weather simulation system" is (map of the whole)

Four things share the name; keep them apart.

| Piece | What | Where | User-visible? |
|---|---|---|---|
| A. Ingest -> store | GitHub Actions cron lanes fetch GFS/ICON/EURO (marine, wind, weather), build regional/mid/global tiles, write to Supabase Storage + a manifest. Lanes: `forecast-ingest.yml` (core), `forecast-ingest-pilots.yml` (pilots + mid-res + consensus shadow), `precompute.yml` (glyph ratings + calibration/skill ledger), `mop-nearshore-ingest.yml`, `keep-warm.yml`. Backend dispatches missed slots (#153). | `.github/workflows`, `backend/services/weather_pipeline` (115 files) | indirect |
| B. Serve | Render (1 CPU, 2 GB, D-005) `grid_resolver` 9-step ladder, `/point`, `/grid`, `/grid_series`, `/spot-ratings`, `/surf-conditions`, `/explore/surf-spots`, `/conditions/batch` | `backend/routes/weather*.py`, `grid_resolver*.py` | yes |
| C. Map render | WebGL marine/wind layers, `ForecastWheel` scrubber, `MapWeatherControls` (3 layouts), tier gating via `LayerAccessResolver`. `SimulationLoop/FCE` is wind-only, marine path disabled since ~2026-06-30 | `frontend/src/components/map`, `frontend/src/engine` | yes (frontend frozen at `fc140024`, D-002) |
| D. The "sim" MCP | An agent-facing what-if/forecast tool server (`weather_sim_mcp.py`, exactly 800 lines = the LOC ratchet ceiling; helpers `sim_*.py`). Not imported by the app runtime (only scripts and the parity monitor import it). Delegates height + quality to production. | `backend/weather_sim_mcp.py`, `sim_rating.py`, `sim_compare/forecast/window/...` | no; it is the audit/parity instrument |

Composition (CLAUDE.md, verified in code): every surface = `surf_point.resolve_surf_geometry` + `estimate_surf_at` ->
`surf_rating.compute_surf_rating`; reference impl `spot_ratings.rate_one_spot`; four composers (glyph/precompute, hub,
sim, rating band). Sim reproduces this and adds an observation gate (`valid_time` only) and `sim_explain`.

Live state at audit (verified): Render deployed `dbff2427` = `origin/dev` head (#176); `/api/health/data` status ok, all
9 model/product lanes ok (age 0.3-1.1 h), `ratings/precomputed` ok; box had just restarted (uptime 3 min) and
`GET /api/weather/grid_series` showed avg 9.6 s, 3 of 9 calls >10 s: the documented cold-box fragility
(system-brain section 3), n small. Recent runs: sim-parity 21:26Z success (11:24Z and 09-28 22:33Z failures were the
#162 429 bug and pre-rebake frames, both explained in the log); accuracy monitor success 13:59Z; nearshore judge
success 20:51Z; core ingest 20:58Z dispatched run still in progress (normal ~80 min); precompute 21:39Z running, another
pending.

## 2. Jacobian findings (numbers are from this session's runs; re-runnable, see section 7)

Method: venv Python (`raw-surf/backend/.venv`, has numpy; system Python does not, see 4.1). Code defaults: Kr 0.873,
shelf friction off (0.0), gamma ceiling 0.81, tide depth off. Baseline swell aimed at each spot's resolved shore normal.

2.1 Height (breaking, ft) responds as designed. Trestles, Tp 12 s: 0.5 m 3.4 ft; 1 m 6.0; 2 m 10.5; 4 m 18.2; then
**dead**: 6, 8, 12 m all 24.7 ft (depth-limited cap = gamma 0.81 x break depth 9.3 m). Height Jacobian d(ft)/d(m):
~4.3 at 0.5-1 m, ~3.9 at 2-4 m, 0 above the cap. Tp raises height (2 m: 8.9 / 10.5 / 11.7 ft at 8/12/16 s).
Dead-step fraction of the swell_h sweep: median 37%, max 81% of 0.2 m steps flat (cap-bound). By design, but it means
**the sim cannot distinguish a 6 m from a 12 m swell at a capped reef spot**, and neither can any surface.

2.2 Quality has a large flat top and a cliff bottom. Trestles Tp 12: 1.0-4.0 m
all 86.0 (5-18 ft identical "epic"), then oversize veto 60.9 at 6+ m (equal to 12 m). Median dead-step fraction of the
quality trace 80% (max 95%). Steepest region: the size gate ramp, e.g. Sebastian Inlet **+13 pts per 0.05 m** between
0.15 and 0.40 m. So a 0.3 m offshore error (S1's MAE) at a small-wave shelf spot is worth ~80 points of rating at
the bottom of the ramp and ~0 on the plateau. Rating skill therefore depends on WHERE the day sits, not on a single MAE.

| Trestles 12 s | 0.5 m | 1 m | 2 m | 4 m | 6 m | 8 m | 12 m |
|---|---|---|---|---|---|---|---|
| height ft | 3.4 | 6.0 | 10.5 | 18.2 | 24.7 | 24.7 | 24.7 |
| quality | 73.2 | 86.0 | 86.0 | 86.0 | 60.9 | 60.9 | 60.9 |

2.3 Direction: Trestles h 2 m, Tp 12: swell from 150/170/190/210/230/250/270/290/310 deg gives quality
36.5/59.7/76.7/85.5/85.0/75.3/57.6/34.0/8.6 while height moves only 7.8-10.4 ft. At 310-330 deg the
`directional_conflict` flag fires (height 6.2 ft, quality 8.6): the payload names the size/quality contradiction.
Direction is a ~1.1 pt/deg lever on quality at 30-60 deg off normal and ~0 at the peak.

2.4 Error propagation (offshore-error model: h 0.30 m from S1; Tp 1 s, dir 15 deg, wind 3 kt, wind dir 25 deg are
ASSUMED, not measured), 20 spots x 5 sizes, operating point 35 deg off normal, 60 deg cross wind:

| error | height (ft) med / p90 | quality (pts) |
|---|---|---|
| Hs +-0.30 m | 1.2 / 1.4 | 0 median, p90 10.5 |
| Tp +-1 s | 0.25 / 0.45 | ~2 |
| swell dir +-15 deg | 0.45 / 0.85 | ~10 |
| wind speed +-3 kt | 0 | ~7 |
| wind dir +-25 deg | 0 | ~6 |

(p90 values tie with medians in places because states are discrete; treat as order of magnitude.)
Consequence: closing the S2 gap (0.045-0.058 m to Open-Meteo) is worth ~0.15-0.2 ft of height and almost nothing in
rating. Unmeasured direction/wind/period error is where displayed quality is decided.

2.5 The sim's tide blind spot. `sim_rating.calculate_surf_rating` never passes `tide_norm`/`best_tide` (and
`sim_explain` pins `tide_fit` neutral); the served lane runs `RATING_TIDE=1` (forecast-ingest, precompute, parity
monitor). `tide_fit` scales the score by 0.5-1.0. Prod: **38 of 1,776 spots (2.1%) have `best_tide`**, which is why S4
reads 0 of 48 mismatched. It is a latent parity break that grows with `best_tide` coverage, and `RATING_BREAKER_TYPE`
is the same shape (sim never passes `breaker_xi`), currently flag-off.

## 3. Forensics: claims checked against reality

| Claim (source) | Verdict |
|---|---|
| STATE: `dev` = `f4590a3d` | STALE. `origin/dev` = `dbff2427` (#176), deployed on Render. |
| STATE: open PRs "the memory upgrades" | STALE. #176 merged. Open: #177 (Stage B, ours) plus codex drafts #15 #22 #23 #27 #43 #44 (leave alone). |
| Owner: "Merge #177 and flip the Stage B PNW box" | #177 is still OPEN. The flip (`0de71a0f`, D-011, both lanes `GFS_MARINE_STAGE_B: '1'`) sits on this branch stacked on #177's commit. Merging this branch flips the box on the deploy. |
| Ledger is complete (README rule 8) | The flip has no ledger line; head is seq 82 (the sizing decision). D-011's authorizing words are only in DECISIONS/commit. |
| STATE "Open commitments: seq 77-80" | seq 80 was fulfilled by seq 82; audit lists 3 open (77 due 22:30Z today, 78 due 09-30 12:00Z, 79 due 09-30 18:00Z). |
| `frontend/system-brain/weather-simulation-system.md` "Render 512MB" | STALE: D-005 says 2 GB; doc last touched 2026-07-05. BRAIN_RULES:128 still cites a 512 MB alert threshold. |
| memory `raw-surf-infra`: prod frontend "frozen at 3bd38a83" | CONFLICTS with D-002/STATE/CLAUDE (`fc140024`). One is wrong; verify on Netlify before relying. |
| CLAUDE.md sim table (0.5 m 3.6 ft/78.0 ... 12 m 29.5 ft/61.2) | Not reproduced here: those figures were a 14 s / 315 deg / 5 kt Pipeline-flavoured run; mine is Trestles 12 s and gives a 24.7 ft ceiling. Same qualitative shape (three quality values, saturation). Not a contradiction; not independently re-verified at Pipeline. |
| CLAUDE.md "never report `point.speed` as surf height" | Code obeys, but the frontend still names offshore speed in heights: `backendCopernicusServiceClient.js:642` `wave_height = point.speed`; `backendWeatherServiceClientPoint.js:666` `infoboxDisplayedHeight: point.speed` (a trace field claiming to be the infobox height, in metres). Diagnostic-only as far as read; a future reader will trust the name. |
| "sim parity 0 of 48" (S4) | True and explained by 2.5 (only 2.1% of spots have best_tide). It is a weak green: the monitor cannot see tide or breaker-type divergence on 98% of spots. |

Memory topology: SIX places hold weather-program state: `docs/weather-program/` (current, canonical per D-008),
`program/weather-simulation/` (165 files, last commit 2026-09-22, Aug-era control docs), `docs/runbooks/` (176 files, 150
HANDOFFs), the untracked `raw-surf/audit/weather-simulation-15.0/` (frozen), agent-local `~/.claude/.../memory`
(pointers; audit passes 0 FAIL/0 WARN/3 NOTE), and `frontend/system-brain/`. Only the first is protected by CI
(`weather-program-ledger.yml`, `memory_audit.py`). Ledger chain verifies (82 entries OK). Log dir has ONE file
(`2026-09-29-consensus-and-ops.md`); the Stage B work of ~17:50Z has no log entry.

## 4. Fragility and latent defects (ranked)

4.1 Silent fail-open in the height chain. `bathymetry.shelf_depth_at` returns None if numpy fails to import or the
bundled grid is unreadable; `estimate_surf` then returns `(Hs, 'shelf')`: raw offshore height, labelled friction-reduced.
Reproduced: with system Python (no numpy) every spot returned height = swell_h x 3.28 exactly, independent of Tp and
direction (Trestles 1.5 m -> 4.9 ft vs 8.3 ft with numpy), quality still computed, no error. In production numpy exists,
so this is a deploy/dependency-failure mode, not a live bug. It is exactly the class CLAUDE.md warns of (offshore height
as surf height, up to -18.7%/+92.7% error). Suggest a test/guard: coastal spot + `depth_m is None` must be a NAMED regime
(`unknown_depth`), never `shelf`, and health should count it.
4.2 Tide/breaker-type parity gap (2.5).
4.3 Scoreboard covers height only; direction/period/wind skill unmeasured, though rating error is dominated by them (2.4).
   Note `validate_period_vs_ndbc.py`, `validate_wind_forecast.py`, `lane_swell_direction_probe.py` exist in `backend/scripts`
   but no SCOREBOARD row uses them.
4.4 Cold-box grid_series latency (>10 s on 3 of 9 calls at 3 min uptime) recurs with every dev merge (each restarts Render).
   Aggravated when flips deploy (Stage B adds ~220 products/run and manifest size; watch memory after flip: D-011 band 55-65%).
4.5 `weather_sim_mcp.py` is at exactly 800 lines: the next feature must extract first.
4.6 `/spot-ratings` live fallback still rates on the global default when the climatology read fails (STATE, #162 residual).
4.7 The 6 m-vs-12 m and 1-4 m dead zones are physics/design choices, but the UI shows identical "epic 86.0" for 5 ft and
   18 ft; the CLAUDE.md line "a size without a quality is incomplete" has a mirror: a quality without a size is too.
4.8 Not diagnosed (n=2): Marine Nightly zoomlab MULT0 frames / 15 s API timeouts.

## 5. Drift ledger (fix these first in a fresh session)

- STATE.md: `dev` SHA, open PRs, "Now" block, and add Stage B/D-011 once #177 + flip merge; bump `Ledger head`.
- Add ledger line + `kind: decision/flip` for D-011 (authorizing words: "Merge #177 and flip the Stage B PNW box"); note the
  wording implies merging #177 first, but this branch carries both, so either merge #177 then this branch, or close #177.
- Write `log/2026-09-29-<topic>.md` for the Stage B session.
- Reconcile `raw-surf-infra` memory frozen-frontend SHA (3bd38a83 vs fc140024).
- `frontend/system-brain/weather-simulation-system.md` and BRAIN_RULES:128: 512 MB -> current; mark as historical.
- Decide the fate of `program/weather-simulation/` (Aug control docs) so only one folder claims to be the program.

## 6. Recommendations (owner decisions marked)

1. Merge order for Stage B: #177 (dark) then flip, or flip branch alone; verify after with the D-011 checks (manifest has
   `us_pacific_northwest`, Render memory in band, probe moves 46244/46211/46243/46206/46213 to regional). Owner-only.
2. Add SCOREBOARD instruments S7-S9: buoy Tp skill, buoy swell-direction skill, wind speed/direction skill vs NDBC, and
   translate each into rating points using the section 2.4 Jacobian. This is where the rating error lives.
3. Guard 4.1 (named regime for missing depth) and add a sim test that passes `best_tide` to prove parity or fails loudly
   (plus a monitor sample of spots that have `best_tide`).
4. Sweep with the served local size reference (`RATING_LOCAL_SIZE=1`) rather than the global 1.2 m curve: this audit ran the
   default (flag off locally), so plateau positions shift per spot in production. Re-run 2.2 per spot with
   `reference_for_spot` to see which spots have the steepest ramp at their typical day.
5. Keep the consensus flip plan (commitment seq 79, due 09-30 18:00Z) and regrid read-back (seq 78, due 12:00Z) as the
   next scheduled evidence; after the flip, re-run section 2 because heights move by design.

## 7. Reproduce / verify

```
cd backend && PY=<repo>/raw-surf/backend/.venv/Scripts/python.exe   # needs numpy
$PY <sweep>.py   # calls sim_rating.calculate_surf_rating(spot,h,tp,dir,wind_kt,wind_from)
python backend/scripts/memory_audit.py --memory-dir ~/.claude/projects/C--Users-David-App-raw-surf/memory
python backend/scripts/action_ledger.py open; python backend/scripts/action_ledger.py verify
gh pr list --state open; curl <render>/api/health/data
```
Sweep scripts (`j2`-`j6.py`) lived in the session scratchpad; the logic is: 20 spots (Trestles, Jeffreys, Mavericks,
Pipeline, Hossegor, Cocoa, Bells, Nazare, Uluwatu, Teahupoo, Santa Cruz, Sebastian, Biarritz, Margaret, Sunset,
Huntington, Noosa, Ericeira, Scarborough, Mundaka), swell_h 0.2-12 m in 0.2 steps at Tp 8/12/16, wind 8 kt offshore.

## 8. Limits of this audit

Local defaults were used (no Render env read; Render MCP env values were not opened to avoid secrets), so
`RATING_LOCAL_SIZE`, `RATING_OBS_GATE`, `RATING_TIDE` were unset here; observation gate needs `valid_time` and was not
exercised. Error magnitudes for Tp, direction and wind are assumptions. Frontend was read by grep only (no browser run).
Did not open the 176 runbooks or 165 `program/` files beyond counts and dates.
