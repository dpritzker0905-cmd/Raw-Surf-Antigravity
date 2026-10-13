# 2026-09-30 · Deep audit: forensics + the Jacobian lens with MEASURED errors, and the path to state of the art

Session opened 2026-09-30 02:07Z (UTC, `date -u`) in worktree `raw-surf-wt`; branch `claude/audit-sota-2026-09-30`
from `dev` = `8fd1b948` (#188 merged by the owner at 02:11:33Z). One writer: this session. Owner's brief (chat):
"do a really deep audit of all your work, the memory, the weather sim features of the app, look at the past contexts
for information to move forward. Follow brain rules. Use forensics. Use the jacobian lens. Give me an audit report and
do the work to see where we need to go, to be state of the art." Mid-session (chat): "use connectors and plugins I've
installed. PDF viewer might be able to give you access to scientific documentation."

**BRAIN STATUS:** aligned (served numbers dark-then-flip, one forecast composition, no secrets, three themes/ARIA not
touched). **SPINE STATUS:** no structural risk: every change below is dark or a docs/ledger write; the one code PR adds
a default-off switch, a shadow ledger lane that serves nothing, and a ledger capacity raise. **LIMB STRATEGY:** read
the record, re-verify it live, measure the four un-measured Jacobian inputs against NDBC, price every finding on real
production products before building anything, build the one clear fix dark.

Read first (all re-verified live, section 2): `STATE.md`, `HANDOFF-2026-09-30.md`, `HANDOFF-2026-09-29.md`, both
2026-09-29 logs, DECISIONS, SCOREBOARD, LESSONS, BRAIN_RULES, the 2026-09-26 roadmap artifact (stages 0-6),
`program/weather-simulation/STATE_OF_THE_ART_PATH.md` (2026-08-14), and the earlier sessions' transcripts (no finding
there that is not already in git).

## 0. Read-first summary

1. **A served-height defect nobody had recorded: `/point` interpolates wave HEIGHT as a vector.**
   `sampler.py` averages the four corners' (u, v) and serves sqrt(u^2+v^2) as the height. A vector mean can only
   shrink a scalar, by as much as the corners' directions diverge, and they diverge where surf spots are (islands,
   headlands, shadows). NDBC 51202 Mokapu Point: corners 1.39-1.57 m (a 14 s south swell on two, an 8 s trade sea on
   two); served 0.9795 m (the sampler's own answer to the digit); scalar 1.455 m; Open-Meteo's same-model cell
   1.44 m; the buoy read 2.0 m. It feeds EVERY served height: glyphs (`rate_one_spot` -> `resolve_point`), the hub
   (`spot_conditions`), the sim (`/point`), the consensus builder, and the skill ledger that grades us. In the code
   since `efcbe3a8` (Stage 1.5). Priced below (section 3.1); fix built DARK (section 5).
2. **The Jacobian with measured errors reverses the last audit's headline.** With the SERVED flags (per-spot size
   reference, observation-gate cap) and errors measured today, the displayed rating's variance splits: offshore height
   37%, swell direction 33%, wind speed 19%, period 10%, wind direction 1%. The 2026-09-29 audit said "rating error
   lives in direction and wind, not height": it swept with `RATING_LOCAL_SIZE` off and assumed the non-height errors
   (its own section 8 said so). Height is the largest term; direction is a close second and has no instrument.
3. **The skill ledger is at its capacity cap, and the guard that sizes it is blind.** `pending_kept` 29,477 of
   `PENDING_MAX_ENTRIES` 30,000. The headroom test counted the code-default lanes (5); production runs 7 (the armed
   CONSENSUS shadow and the Open-Meteo same-model control). The `CONSENSUS_SERVE` flip adds a `GFS_RAW` lane
   automatically and would start evicting every lane's +72 h rows. A latent blocker on the flip everyone is waiting
   for; fixed in the same PR (section 5).
4. **A Supabase 429 on a regional product silently serves the 2-degree tier, labelled `regional`.** 9 of 57 `/grid`
   requests (my sequential fetch, 02:23:11-02:24:33Z) came back as `gfs_marine_waves_global_mid_*` with
   `coverage_scope: regional`, `fallbackReason: null`, no warning; each of the nine has its own Render line
   `GET .../<that tile> "HTTP/2 429"` -> `Dynamic L2 download failed ... too_many_connections` -> `Mid-res tier:
   serving global_mid ... regional-quality at zoom-out` (a failure logged at INFO as a zoom choice). L-F1's class, on
   the serving path (W-23). My fetch was part of the load; a second burst at 02:25:58-02:26:24Z hit ~20 12Z-frame
   products I never requested, and the size-climatology read took a 429 at 02:21:03Z (the #162 live residual).
5. **Commitments:** 128 (W-34 live), 78 (regrid live) and 86 (Stage B live) read back and fulfilled early; 79 (the
   consensus shadow's scored rows) and 94 (big-swell by forecast bin, per region) stay open, due 18Z. The published
   ledger already answers most of 94: on the equal mean the forecast-binned big-swell bias is small (section 3.6).
6. **Memory drift, three items:** CLAUDE.md says "trevec is active and synchronized" and carries a Trevec tool block,
   but no Trevec/Mind/Memstate server is configured on this machine; the 2026-09-29 handoff says Python TLS to NDBC
   fails on this box (it works from both Pythons today); STATE's chain floor (130 / 1531) is 3 PRs stale (hosted:
   133 files / 1618).

## 1. What was audited, and how

| Layer | Evidence read |
|---|---|
| Memory of record | `docs/weather-program/*` (README, STATE, DECISIONS D-001..D-011, SCOREBOARD, LESSONS, 3 logs, 2 handoffs), `ACTIONS.jsonl` (136 lines, chain verified), `memory_audit.py` (0 FAIL / 0 WARN / 5 NOTE), the local memory folder (13 files), BRAIN_RULES, CLAUDE.md, the 2026-09-26 roadmap artifact, `program/weather-simulation/STATE_OF_THE_ART_PATH.md` |
| Live system | `/api/health`, `/api/health/data` (9/9 lanes ok), `/api/weather/buoy-calibration` (the skill ledger), `/api/weather/products` (13,735 entries), `/api/conditions/{id}`, `/point`, `/grid` (read-only: ~620 `/point` calls from the probe and the two validators, ~165 `/grid` calls), the precomputed glyph frame `spot_ratings/latest.json` (anon-readable by its RLS policy), Render logs and metrics (read-only), GitHub runs and PRs, Supabase (one read-only count) |
| Truth | NDBC `latest_obs.txt` + 49 `realtime2` station files; Open-Meteo marine (`ncep_gfswave025`, both cell selections) |
| Code | the sampler, point resolver, rating chain (`sim_rating` -> `estimate_surf_at` -> `rating_score`), skill ledger, CI floors |

Method. FORENSICS: every claim in STATE, the handoffs, the ledger's open commitments and the 2026-09-29 audits was
checked against the live system or the code. JACOBIAN: the served rating's sensitivity to each input, taken at the
real operating points of 1,755 spots (the served GFS glyph frame, 04Z), multiplied by errors MEASURED against NDBC
today, not assumed. Every served-number finding was priced on production products before anything was built (L-S15).

## 2. Forensics: claims against reality

| Claim (source) | Verdict | Evidence |
|---|---|---|
| STATE "`dev` = `79b7ef66`", "Open PRs: #188" | Moved as expected: #187 and #188 (docs) merged; `dev` = `8fd1b948`; Render still serves `79b7ef66` (docs-only merges do not redeploy) | `git fetch`; `/api/health` version string |
| STATE "CI floors: chain 130 / 1531 (1537)" | STALE: the hosted chain lane reads 133 files / 1618 on `8fd1b948`; guards 175 / 2130 | run 36658691020 |
| Commitment 128: W-34 live | FULFILLED: `current.data_source = {kind: stored_product, product_id: gfs_marine_waves_florida_east_coast_20260930T030000Z.json, upstream: noaa, dataset: ncep_gfswave025}` | GET `/api/conditions/1a69d45c-...?model=GFS` 02:09Z |
| Commitment 78: the regrid flip is live, "the regional node-vs-control gap falls toward rounding" | FULFILLED at the NODES: Florida tile 10-01T03Z, 106 valid nodes vs Open-Meteo's own GFS-Wave cell: 98% within 0.011 m (nearest-cell selection, direction MAE 1.9 deg); before the flip 14% matched their own cell (SCOREBOARD 18:24Z). ⚠️ The probe's buoy-level regional MAE did NOT fall (0.045 -> 0.049): that residual is finding 3.1, not the regrid | probe 02:12-02:18Z; `/grid` + Open-Meteo |
| Commitment 86: Stage B live | FULFILLED: 205 `us_pacific_northwest` products (GFS 4 layers x 41 frames + CONSENSUS 41) from the 18Z run, ingested 23:44Z; the probe serves 46244/46211/46243/46206/46213 (+46278) regionally; Render memory 1,103-1,264 MB (54-62% of 2 GB) on the post-flip instance, inside the 7-day band (1.12-1.28 GB 09-27..29, one 1.42 GB sample) | manifest; probe rows; `/api/health` memory; Render metrics |
| The same-model gap closes with the regrid | PARTLY: probe MAE 0.076 -> **0.051**, bias +0.008 -> -0.007, global_mid rows 45 -> 20 (their excess +0.097 -> +0.042 m). The rest is the vector interpolation (3.1): scalar gives 0.043 | probe; section 3.1 |
| HANDOFF-2026-09-29 §3: "Python TLS to NDBC fails on the Windows box" | FALSE today: the venv Python read `realtime2/41009.txt` (599 kB) and system Python `latest_obs.txt` (104 kB) | 02:21Z, 02:36Z |
| CLAUDE.md: "`trevec` is active and synchronized"; the Trevec tool block | FALSE on this machine: no trevec/mind/memstate MCP server configured; no such tools in the session (LESSONS L-A4 recorded the BRAIN_RULES half) | `~/.claude.json` scan |
| Audit 2026-09-29 §0.2 / §2.4, sim-works-plan §3: "rating error lives in direction and wind, not height" | CORRECTED by measurement: with served flags, height is the largest term (37%), direction 33%, wind speed 19% (section 3.3) | error budget |
| The last audit's assumed errors (Tp +-1 s, dir +-15 deg, wind +-3 kt, wind dir +-25 deg) | Measured: Tp 1.9 s, dir 23 deg (RMS 29, p90 52), wind 4.1 kt (RMS 5.3, p90 7.9), wind dir 31 deg (sigma = 1.2533 x MAE) | section 3.2 |
| W-30 (sim ignores tide), W-31 (no depth -> offshore height labelled `shelf`), W-33 (`infoboxDisplayedHeight: point.speed`) | Still open, as the plan says | `sim_rating.py` (no `tide_norm`); `surf_transform.py:415`; `backendWeatherServiceClientPoint.js:666` |
| STATE next fix #5 "big-swell calibration on the served consensus" | Probably unnecessary: on the equal mean the forecast-binned big-swell bias is -0.10/-0.04/-0.03 m (section 3.6) | ledger `big_swell.by_forecast` |

## 3. Measurements (numbers carry their conditions)

### 3.1 The vector-height interpolation (NEW)

`PointSampler.sample_point`, both bilinear branches (4 valid corners, and the ocean-masked 2-3): `interp_u`, `interp_v`
= weighted corner (u, v); `speed = sqrt(u^2+v^2)`. For a marine layer (u, v) = height x unit vector of the direction,
so `speed` = |sum w_i h_i e_i| <= sum w_i h_i. Equality only when the corners share a direction.

| Instrument | Served (vector) | Scalar (same corners, same weights) |
|---|---|---|
| Same-model control (Open-Meteo GFS-Wave), 214 probe rows (57 buoys, leads 24-72 h) | MAE 0.0554, RMSE 0.1038, bias -0.009 m | MAE **0.0428**, RMSE **0.0711**, bias +0.013 m |
| NDBC truth, 00Z, 39 buoys (one hour) | MAE 0.241, bias -0.172 | MAE 0.216, bias -0.143 |
| NDBC truth, the 12 rows where they differ > 1% | MAE 0.450, bias -0.386 | MAE **0.371**, bias -0.294; **scalar closer on 11 of 12** |
| 1,662 rated spots (10-01T03Z frame; wind held 5 kt offshore so only the height varies) | vector/scalar ratio: median 0.998, p10 0.936, p5 0.838, p1 0.639 | **11.4% of spots > 5% low, 7.2% > 10% low, 3.7% > 20% low**; global_mid tier 21.8% > 5% low |
| Same, through the production chain | | breaking height +0.2 ft p90, +1.4 ft p99, +5.1 ft max; raw quality +0.7 p90, +5.7 p99; **42 spots (2.5%) change level** at this frame |

Worst spots: Lahaina Harbor 0.4 -> 5.5 ft (a lee harbour: scalar interpolation cannot resolve the shadow either;
geometry and MOP are for that), **Thurso East 2.8 -> 7.0 ft**, Thurso Shit Pipe 2.9 -> 6.9 ft, Brimms Ness 3.0 ->
5.9 ft, Pohnpei P-Pass 3.2 -> 5.4 ft. The sampler reproduced all 214 served probe values exactly (the positive
control that the local copy IS production's arithmetic), and the built fix reproduces the priced candidate on all
1,661 bilinear-sampled spots to 0.000000 m. One hour of buoy truth is n = 1 in time (L-S3); its sign agrees with the
same-model control and with the inequality. SoCal buoys (46221/46224/46232/46253/46268) stay 0.3-0.6 m low EITHER way:
Channel Islands shadowing, which is MOP's job.

### 3.2 The four inputs nobody measured (S7-S9, snapshots)

| Input | Instrument | n, time | Result |
|---|---|---|---|
| Peak period (S7) | `validate_period_vs_ndbc.py` (our Tp vs NDBC DPD) | 18 buoys, 02Z, lead ~0 | abs error mean 1.52 s, RMS 1.92 s; long-period Pacific median **+2.4 s**; bimodal seas scatter both ways (unimodal n=11 median 0.0 s) |
| Swell direction (S8) | scratch: served mean direction vs NDBC MWD | 42 buoys, 00Z | MAE 18.6 deg, median 8.5, **RMS 28.7, p90 51.5** (heavy-tailed) |
| Wind (S9) | `validate_wind_forecast.py` | 60 stations x 3 models, 02Z | GFS speed bias -0.97 kt, abs err p50 2.3, p90 7.9 kt; direction p50 26.7, p90 76.6 deg; **swapping ONLY the wind for the observed wind changes the served level on 29.8% of GFS spot-hours** (EURO 19.0%, ICON 16.0%) |
| Members at one hour | scratch, 42 buoys, 00Z | EURO best on every axis: direction RMS 23 deg (GFS 29, ICON 31, equal-weight 25), period MAE 1.5 s (GFS 1.9), Hs MAE 0.12 m (GFS 0.22, bias -0.15). One hour: a hypothesis, not a result. The consensus product keeps GFS's direction and period |
| Swell partition vs total sea | scratch, 41 buoys | `swell_1` does NOT beat the total sea against NDBC (dir MAE 21.1 vs 18.6 deg; period equal). NDBC's bulk MWD is itself a total-sea quantity, so this instrument cannot see a partition benefit: NOT SUPPORTED BY THIS INSTRUMENT, not refuted; the truth for trains is spectral buoy data (CDIP / NDBC `.spec`) |

### 3.3 The error budget (the Jacobian lens, measured)

1,755 spots of the served GFS frame (04Z), each at its own offshore Hs, period, direction, size reference and wind
(speed from its `why`; bearing from its class relative to the resolved shore normal, an approximation), through
`sim_rating.calculate_surf_rating` (production chain), central differences at +-sigma, sigma = 1.2533 x MAE; Hs sigma
by sea-state band from the ledger's held-out `by_band` (served GFS: flat 0.205, small 0.253, rideable 0.367, big 0.637
m MAE). Displayed level applies the observation-gate cap (69.9) where the frame says the hour is unconfirmed.

| Input | sigma | abs change in quality, median / mean / p90 | share of variance | level differs between -sigma and +sigma |
|---|---|---|---|---|
| Offshore Hs | by band | 4.4 / 6.6 / 17.1 | **37%** | 51% |
| Swell direction | 23.3 deg | 6.0 / 6.9 / 15.1 | **33%** | 61% |
| Wind speed | 4.1 kt | 2.7 / 4.7 / 11.7 | 19% | 47% |
| Period | 1.9 s | 3.4 / 3.8 / 7.3 | 10% | 45% |
| Wind direction | 30.8 deg | 0.0 / 0.6 / 2.6 | 1% | 7% |

Also read off the served frame: the binding limiter of each spot's rating right now is `size_gate` 45%,
`swell_exposure` (direction) 30%, `wind_period_blend` 24%, `period_gate` 1%, `tide_fit` 0.1%.
Assumptions, stated: first order, inputs independent, one frame, sigma from snapshots (n = 18-60, lead ~0-6 h) except
Hs (a held-out week at 24 h). Wind direction's small share is real at today's light winds (it matters in proportion to
wind speed); the wind-swap validator, which swaps speed and direction together, moves 30% of GFS levels.

### 3.4 The skill ledger's capacity (NEW)

`forecast_skill_ops`: ledgered 1,188, scored 234, **pending_kept 29,477**, evicted 0; `PENDING_MAX_ENTRIES` 30,000.
Demand = buoys x lanes x runs/day x lead-days = 59 x 7 x 12 x 6 = 29,736. The headroom test
(`test_the_cap_holds_headroom_over_the_documented_production_demand`) computed 5 lanes (the code default: CONSENSUS
unarmed, the same-model control not counted) and passed. At the cap `merge_pending` keeps the earliest targets, so the
next lane (the `CONSENSUS_SERVE` flip's automatic `GFS_RAW`, or any new shadow) evicts the +72 h rows of every lane.

### 3.5 The silent tier downgrade (NEW, n = 1 burst)

57 sequential `/grid` fetches of the regional GFS tiles (0.5 s apart), 02:23:11-02:24:33Z, while core ingest run
36656123194 was uploading: 9 came back as the 2-degree `global_mid` product while saying `coverage_scope: regional`,
`fallbackReason: null`, `warnings: []` (east_australia 10-01/10-03, brazil_east 10-01, azores 10-01/10-03,
france_biscay 10-01/10-02, srilanka_maldives 10-01, uk_ireland 10-02). Each has its own Render sequence: a 429 on that
tile's L2 GET, `Dynamic L2 download failed`, then `Mid-res tier: serving global_mid ... regional-quality at zoom-out`.
Re-requested ~10 min later: all regional (so a 429 degrades one request, it does not stick). Earlier, at 02:18:21Z,
the parity probe's own `/point` load drew the same 429 on uk_ireland 10-02T03Z (62107 has 4 probe rows, not 5). So a
refused read becomes a coarser answer with no trace in the payload (L-F1 on the serve path; W-23), and `/point`, the
glyphs' and the hub's path, shares the resolver. The load was partly mine; the 1.5 s-spaced fetches after it saw no
downgrade in 60 requests, but a burst at 02:25:58-02:26:24Z hit ~20 12Z-frame waves/swell_1 products I never asked
for, and `[size-climatology] L2 load HTTP 429` at 02:21:03Z is the live `/spot-ratings` residual of #162.

### 3.6 Big swells by FORECAST height (commitment 94, partial)

Ledger `big_swell.by_forecast` (forecast >= 3 m, held-out week): served GFS bias -0.147 / -0.291 / -0.124 m at
24 / 48 / 72 h (n 256 / 211 / 170); **equal mean -0.099 / -0.039 / -0.033 m** (n 282 / 300 / 259); EURO -0.02 / +0.29
/ +0.34; ICON +0.26 / +0.39 / +0.45. The -0.44 m "every model reads low on big days" is conditioned on the OBSERVED
height (regression to the mean). On the product planned to serve, a big-swell correction has little left to correct.
94's full check (per region) waits for its due time.

### 3.7 State of the art: where we stand

- The north star (SCOREBOARD) is paired: beat the public references on the same buoy, hour and lead. Latest monitor
  run (36642378136, 22:55Z): Open-Meteo marine ahead by +0.052 / +0.048 / +0.063 m at 24 / 48 / 72 h (n 2,570-2,786),
  NCEP GFS-Wave (our own model, their pipeline) ahead by +0.020 / +0.022 / +0.026 m. The same-model gap is pipeline
  loss: the regrid (D-010) and the scalar height (3.1) are its two measured mechanisms. The best-match gap is model
  choice: the consensus (D-006/D-009) is the attack.
- Held-out skill ledger (01:12Z): served GFS all-sea MAE 0.296 / 0.323 / 0.391 m; equal mean 0.275 / 0.300 / 0.340.
- The roadmap (2026-09-26) stages against today: 0 ship (frontend frozen, not started: W-10 R4-R7 left); 1 fetch once
  per bulletin (not measured this session); 2 one composition (S4 0 of 48, a weak green: W-30); 3 spectrum (dark; this
  session's bulk-buoy test cannot grade it); 4 coast physics (MOP dark, graded); 5 learning loop (a linear MOS shadow
  exists and gains nothing: 0.255 -> 0.251 m; the consensus is the first real gain); 6 probabilistic (blocked on
  pygrib).
- Outside: ECMWF's data-driven AIFS with waves reports about one day of gained skill for Hs at medium range (blog
  2025-08-21; arXiv 2604.25559, April 2026); research, not open data. Aurora waves needs licensed HRES-WAM analyses.
  Neither is reachable at $0 today; revisit when ECMWF publishes AIFS wave fields in open data.
- The WMO Lead Centre's MAM 2026 report (16.8 MB PDF) was NOT downloaded: I recommended skipping it, because it grades
  each centre on its own buoy set and season, and comparing our numbers to it would break L-S2 (same rows). The S2
  head-to-head is the stronger yardstick. The PDF viewer plugin was not connected this session.

## 4. Where we need to go (one ordered path)

Ordered by measured leverage on what a user sees, cheapest evidence first.

1. **Merge this PR** (dark; serves nothing new): `SAMPLER_SCALAR_HEIGHT` built dark, its ledger shadow
   `raw_surf:GFS_SCALAR` ARMED, and the ledger cap raised so both it and the consensus flip's `GFS_RAW` fit.
2. **The consensus flip (commitment 79, due 18Z):** it is the largest height gain on paper (all-sea -7% / -7% / -13%;
   big swells by forecast bin nearly unbiased). Precondition now met by this PR's cap raise.
3. **The scalar-height flip**, on 48-72 h of paired `raw_surf:GFS_SCALAR` rows (expect the same-model gap to close
   by ~0.012 m MAE and the coastal low bias to shrink). Owner's word; all four lanes together.
4. **S8, a swell-direction instrument in the ledger** (33% of rating variance, no instrument): score direction and
   period per lane vs NDBC MWD/DPD alongside Hs, then test "consensus direction/period" (EURO led every axis at one
   hour) as a candidate the way D-006 tested heights.
5. **S9 wind in the ledger** (19%; the wind swap moves 30% of GFS levels): the ledger's `wind_n` is 0. Then the wind
   candidates: multi-model wind, and higher-resolution coastal wind (HRRR over the US, ICON-D2/AROME over Europe via
   Open-Meteo) for the local breeze at the break.
6. **The serve-path 429 (W-23, 3.5):** a failed regional read retries, then says so (`fallbackReason`,
   `coverage_scope: global`), never a silent 2-degree answer.
7. **Release (W-10, W-11):** unchanged: production map users see none of this until the owner unfreezes.

Deprioritised by today's evidence: the big-swell calibration (3.6); partitions as a direction fix (3.2: not
supported by a bulk-buoy instrument; needs spectral truth first).

## 5. Work done (this PR)

- `sampler.scalar_marine_height_enabled` / `_scalar_height_point` / `force_scalar_height`: behind
  `SAMPLER_SCALAR_HEIGHT` (default '0', declared '0' in forecast-ingest.yml, forecast-ingest-pilots.yml,
  precompute.yml), marine heights interpolate as the scalar mean of the corners; direction keeps the vector mean;
  u/v are rebuilt; wind untouched; a cancelling mean takes the heaviest corner's direction.
- `forecast_skill`: `GFS_SCALAR` lane under `SAMPLER_SCALAR_LEDGER` ('1' in forecast-ingest.yml and precompute.yml;
  retires itself once the switch serves); `PENDING_MAX_ENTRIES` 30,000 -> 54,000; the headroom test now counts every
  lane a switch can add (and the same-model control).
- Tests: `tests/test_sampler_scalar_marine_height.py` (12, a real production fixture), the headroom test corrected.
  Mutations: 15 of 15 caught (no shell; verdict from pytest's summary). 600 nearby tests pass flag off; the 319
  sampler-touching tests also pass flag ON (nothing pinned the shrink). Chain floor 134 / 1624 (1630).
- The science shadow A/B (`science-shadow-ab.yml`) was NOT dispatched: it replays persisted rating inputs, which
  already hold the vector height, so it would read "0 changes" for a sampler candidate (L-S4 blindness).

## 6. Log

Times below are bounds from clock reads (`date -u`) and Render's log timestamps, not estimates (L-P10).
- 02:07:28Z start; memory audit 0 FAIL / 0 WARN / 5 NOTE; ledger 136 OK.
- After 02:08:55Z commitment 128 read back. 02:12:36-02:18:42Z the same-model probe (its 02:18:21Z 429).
- 02:23:11-02:24:33Z the /grid fetches (the 429 downgrades, 3.5); then the Mokapu mechanism and the spot pricing.
- 02:31Z-~02:37Z the period and wind validators (the wind run's output landed after 02:37:25Z).
- Between 02:37Z and 03:07Z: the error budget; the swell_1 and member grids (1.5 s apart, no downgrades); the owner
  (chat) asked to use installed connectors/plugins (the PDF viewer MCP was not connected this session); the WMO
  report download (16.8 MB) was asked about, the owner asked for the best path, and I recommended skipping it (3.7).
- By 03:07:48Z the dark fix, the ledger lane and the cap were built; mutations 15/15.
