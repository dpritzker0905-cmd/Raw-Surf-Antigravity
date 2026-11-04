# 2026-11-04 · claude/default-on-guardrails · fixes ship ON, with a history filter and a live guardrail (D-065)

Session log (one writer: this branch). Times UTC.

## The owner's words (2026-11-04 ~01:41Z, verbatim)

"Yes we need logic in place and systems where we make fixes by default so they are visible and on, and have a checker
or filter to see if its working or not. Not starting with something built and dark or off"

Supersedes D-001 (served numbers dark-then-flip). DECISIONS D-065; CLAUDE.md's "Served numbers change dark" paragraph
is replaced by an exact-string edit. ONE FORECAST COMPOSITION, the 14-day / tier contract and never-load-test are
untouched.

## What was built

| Piece | File | What it does |
|---|---|---|
| Runtime manifest reader | `backend/services/runtime_flags.py` | `flag(name)`: explicit env (both ways; `''` = unset) > `control/flags.json` in the weather-products bucket > code default (`GUARDED`). 5-min TTL, first read blocks <= 2 s, later refreshes in a background thread. Unreadable: last good for 6 h, then only its `off` entries survive (an outage never resurrects a kill), else the code default. `RUNTIME_FLAGS_MANIFEST=0` disables it. |
| Wiring | 16 read sites of the 7 guarded flags (`surf_transform`, `point_surf_augment`, `mop_nearshore`, `spot_ratings`, `spot_ratings_precompute`, `frame_set_rating`, `grid_resolver_surf`, `alert_horizon`, `point_rating`, `sim_rating`, `spot_conditions`, `eval_replay`, `consensus_product`, `surf_alert_windows`, `routes/weather.py`, `scripts/precompute_ci.py`) and the admin status board (`resolve()`: value + source + manifest entry). | `tests/test_runtime_flags.py` pins: no module reads a guarded flag straight from `os.environ`; GUARDED defaults == `_RATING_FLAGS` defaults. `test_flag_lane_parity.py` gained the `_rf.flag(...)` read pattern so its coverage floor still sees the flags. |
| Shared statistics | `backend/services/weather_pipeline/guardrail_stats.py` | Two-way test on gate_v2 pairs (OFF = f_ref, ON = f_cand): DM with HAC + HLN on the margin-shifted null, moving-block bootstrap CI; family = pooled + each lead + each season (hemisphere-aware) + each region; Holm; WORSE needs Holm p_worse < 0.05 AND CI upper < -margin, margin = max(0.005 m, 1% of OFF MAE). Sanity bounds: height 0..30.5 m, score 0..100, swell monotonicity (1 cm), volume cap. |
| Pre-merge filter | `backend/scripts/default_on_filter.py`, `.github/workflows/default-on-filter.yml`, window `backend/scripts/default_on_filter_window.json` | Flags a PR turns ON (GUARDED / `_RATING_FLAGS` default diff vs the base, or `--flag`), replayed OFF vs ON with the harness's own staging + `eval_replay.replay_arm`; exit 1 only on WORSE or a sanity breach. No cache = SKIPPED (exit 0), sweep still runs. |
| Live guardrail | `backend/scripts/flag_guardrail.py`, `.github/workflows/flag-guardrail.yml` (cron 02:30/08:30/14:30/20:30) | Rolling 14 days ending 24 h ago, 12-hourly targets, public data, no Render. Statistical WORSE needs 2 consecutive WORSE runs >= 24 h apart (counter in the job's cache); a sanity breach acts at once. Writes `off` + reason + evidence + fix_version, logs to `control/flags-actions.jsonl`, opens/updates an issue, prints the ledger line owed. Dry run unless `FLAG_GUARDRAIL_ENFORCE=1`. |

## No-flap rule

The guardrail only writes `off`. Its own `off` holds while `runtime_flags.FIX_VERSION[flag]` is unchanged; a PR that
changes the fix bumps the version and the guardrail clears its own entry (the new version runs at its code default and
is judged afresh). The owner re-enables by dispatch (`reenable` + `owner_words`, enforce mode), which writes `on`,
set_by `owner`. A later WORSE may disable that again. An owner `off` is never cleared automatically.

## The filter on the seven existing dark fixes

Instrument: `default_on_filter.py`, cache `C:/t/eh0-cache` (the eval harness's 2026-11-02 window), targets
2026-10-20T00Z..10-29T18Z every 6 h, leads 24/48/72, 6 stations (4 CDIP, 2 NDBC, California), built-in decoder
(no production parity: decoders agree with eccodes to 1e-15 per log 2026-11-02; the wind is the wave file's), primary
`hs_station`, n 480 pairs / 40 hours. Two arms per flag on the precompute.yml served env, `RUNTIME_FLAGS_MANIFEST=0`.

| Flag | Filter | Decision (code default) |
|---|---|---|
| `SURF_TIDE_DEPTH` | NO_CHANGE (read: tide lookups double; 0 heights changed in this small-surf window) | **ON**. The golden 8-12 m sweep shows where it binds: the depth-limited cap moves with eta (29.5 ft at eta 0 -> 31.0 ft with the live tide a test fetched). The goldens now pin eta = 0. |
| `CONSENSUS_DIRECTION_VECTOR` | NO_CHANGE (the GFS replay does not build the consensus); offline vs NDBC MWD +5.6 deg [4.9, 6.3] better, no band worse (log 2026-11-03) | **ON** (code, registry, pilots lane '1'). Serves nothing until CONSENSUS_SERVE. |
| `RATING_OBS_GATE` | NO_CHANGE (unreplayable: applied after rating) | **ON** (every lane and Render already '1' since 2026-07-30; the code default now agrees) |
| `RATING_LOCAL_SIZE` | NO_CHANGE (the replay has no size climatology) | **ON** (every lane already '1'; code default now agrees) |
| `SURF_EXPOSURE_RECONCILED` | **WORSE**: pooled ON loss +0.0093 m MAE, CI [0.0076, 0.0112], Holm p_worse 0.0002 (8 members, margin-shifted null); leads +24/+48/+72 h +0.0100/+0.0088/+0.0090 m; SON same as pooled; region lat 30..33 W +0.0133 m; lat 33..36 W (+0.0064) and 36..39 W (+0.0110) not significant after Holm (p 0.058); first pass (unshifted null, no lead members) had 36..39 W worse too; 1,103 of 1,200 heights change | **OFF**, fix in progress (the brief's census: worse at 7 of 8 buoys) |
| `RATING_BREAKER_TYPE` | NO_CHANGE on Hs (rating-only); harness impact 152 of 1,200 spot-hours change level, max 13.0 points | **OFF**: only `spot_ratings.py` reads it, so ON would make glyphs and the hub/sim disagree (ONE FORECAST COMPOSITION) |
| `ALERTS_FORECAST_WINDOWS` | NO_CHANGE (not a forecast number) | **OFF**: up to 5 alerts a day before the cap; #718 (claude/alerts-dedupe-cap, read not edited) holds volume to 2/user-day but its precision still FAILS (0.47-0.74 at sigma 1) |

Second pass after the Reflection changes (margin-shifted null, per-lead members; 8 testable members): unchanged verdicts. SURF_EXPOSURE_RECONCILED stays WORSE: pooled +0.0093 m, Holm p_worse 0.00018 (shifted null), and worse at leads +24 h (+0.0100 m) and the other members listed in `filter.json`; every other flag NO_CHANGE. Exit 1 (exposure would block if a PR turned it ON). Runtime 2 m 52 s for all seven flags, local, built-in decoder.

## Reflection review (Beam, 2026-11-04) and what changed

Asked about the statistics and the no-flap rule. Adopted: (1) the DM null now carries the margin (p_worse tests
"not worse by more than the margin"); (2) per-lead family members so one lead's harm is not averaged away; (3) a
2-strike / 24 h persistence rule for statistical WORSE in the live guardrail (overlapping 14-day windows are one look,
not independent evidence); (4) past the staleness bound only kills survive. Not adopted, with reasons: a 5 cm margin
(it would pass a fix that is worse at 7 of 8 buoys; the margin is one constant, `MARGIN_ABS_M`, a DECISIONS entry to
change); CI enforcement of FIX_VERSION bumps (owed; today a reviewer checks it); a cooldown after an owner re-enable.

## Tests and mutants

`tests/test_runtime_flags.py` (13, estate lane) and `tests/test_flag_guardrail.py` (chain lane): precedence both ways,
empty = unset, fail-safe (raise, malformed, bad state), last-good kill through a blip and past the bound, TTL cache,
disable switch, registry parity, no raw env reads; verdicts (no change, worse, better, inside the margin, one region,
untestable, shifted null), sanity rows, monotonicity, volume; guardrail disable with reason + ledger command, dry run
writes nothing, not-proven-better left on, sanity breach, strikes (one run, inside the span, reset, persisted), no
flap, version bump clears its own off only, owner re-enable needs words, alert volume, held-off flags not watched.
Mutants: 18 run, 17 killed; the survivor drops the CI condition from WORSE, which the margin-shifted DM makes
redundant (two guards for one rule, kept on purpose).

Tests updated because "unset" no longer means OFF (each now states the kill value '0' it inherited, or asserts the new
default): consensus direction/product, grid size climatology, observation gate surfaces, point rating, rating
confirmation, shadow A/B (base arm), sim served reference, spot hub local size, tide-to-serving-height, weather sim
MCP, infobox goldens (eta = 0). `test_weather_sim_mcp.py::test_database_update_propagation` fails on dev too (sqlite
table missing locally), unrelated.

## Floors

`rederive_floor.py --lane chain --add 21 --add-files 1` then the count was re-derived after the strike tests (see the
commit); `--lane estate --add 13`. ci.yml and `_FLOOR_SET_FROM` moved together by the tool.

## Overlaps (named)

- claude/harness-two-way-gate: `guardrail_stats.two_way()` is the same contract on the same gate_v2_stats primitives;
  when that branch lands, `two_way()` should delegate to it. No harness file is edited here.
- claude/harness-backfill: `--hist-index` reads `start` / `end` / `cache_dir` of its index.json entries.
- claude/alerts-dedupe-cap (#718): `surf_alert_windows.enabled()` is the same line both PRs touch (here: the read goes
  through `_rf.flag`); a trivial merge.

## What the owner does, and what Render picks up

- Enforce the guardrail: `gh variable set FLAG_GUARDRAIL_ENFORCE --body 1` (until then it reports, writes nothing).
- Render picks up on its next deploy: the new code defaults (SURF_TIDE_DEPTH, CONSENSUS_DIRECTION_VECTOR,
  RATING_OBS_GATE, RATING_LOCAL_SIZE default '1') where its env does not set them, and the manifest reader (it needs
  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, which it already has). An explicit Render env value stays a hard override:
  for the guardrail's `off` to reach Render, a guarded flag must NOT be pinned in Render env. Nothing was changed on
  Render, no deploy, no live call.
- Lanes that pin a guarded flag in workflow env (RATING_OBS_GATE / RATING_LOCAL_SIZE '1', CONSENSUS_DIRECTION_VECTOR
  '1', ALERTS_FORECAST_WINDOWS '0') keep the pin as a hard override; to hand a lane to the manifest, its line becomes
  `''`.

## Addendum: collisions found with claude/harness-two-way-gate (read, not edited)

- Its draft commit b5c1aa08 also titles a DECISIONS entry **D-065** ("the flip gate's binding CI is a two-way spatial
  block x day bootstrap"). This PR merges first in the train (coordinator, 2026-11-04), so it keeps D-065; the gate
  branch renumbers to the next free number at its merge.
- Both branches re-derived the chain floor from the same dev read (3488): this PR 3514/203, the gate branch 3508/203.
  Whichever merges second re-runs `rederive_floor.py --lane chain`.
- Its `eval_twoway.py` is a different estimator (100 km spatial blocks x UTC days, >= 14 days); see the overlap note in
  `guardrail_stats.py`. The 10-day cached filter window is shorter than that rule; a 14-day settled window is owed
  when the backfill cache lands.

## Addendum: round 7 folded in (coordinator, from PR #722)

Round 7's history replay agrees with this PR's conversions: SURF_TIDE_DEPTH inert -> ON (done here);
SURF_EXPOSURE_RECONCILED failed -> stays OFF (done here). SURF_SPECTRAL_K failed and SURF_BIGHT_HS_CONSENSUS passed,
but neither flag is on dev at 29c01f71f, so neither is in GUARDED here: #707 ships SURF_BIGHT_HS_CONSENSUS ON (it
should add itself to `runtime_flags.GUARDED` at '1' when it rebases on this), and SURF_SPECTRAL_K's PR keeps '0'
(add it to GUARDED at '0' with its round-7 numbers so the guardrail tracks it).

Local lanes at the pushed head: guards 3447 passed; chain 3504 passed / 5 failed before the fix (4 test_product_run_keys
fail identically on another checkout, time-dependent, unrelated; 1 nearshore consensus pin fixed); estate 3417 passed /
3 failed (pydantic_ai absent locally; two rederive_floor reads that collided with the mid-run floor rewrite, green on
rerun).
