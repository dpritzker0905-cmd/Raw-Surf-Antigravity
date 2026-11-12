# Advisor: gap map against state of the art, 2026-11-12

Session: the weather audit advisor (worktree `fable-weather-audit-99a9a8`). Docs only: no code, no served number,
no flag, no live request. Requested by the director session on the owner's word of 2026-11-11 ("put the weather
audit advisor back online ... get this team putting us to state of the art").

## 01:55Z What this is and how it was made

A ranked map of where the simulation stands against state of the art, with the evidence we hold, the evidence we
lack, the next measurable step and the expected effect. It is advice. Nothing here is a decision.

- **Read at `dev` `472b384f7`.** Three read-only readers extracted the recorded numbers from `SCOREBOARD.md`,
  `STATE.md`, `DECISIONS.md`, `LESSONS.md`, `REGRESSION-MATRIX.md`, `evaluation-harness.md`, the newest logs and
  the transform and rating code. I did not re-run any instrument. Every number below is quoted from those files
  (SB = SCOREBOARD, ST = STATE, D = DECISIONS, RM = REGRESSION-MATRIX, EH = evaluation-harness).
- **Freshness.** `STATE.md` says "Updated 2026-10-18"; its "Now" section stops near 10-22. `memory_audit.py
  --docs-only` reports 20+ OVERDUE commitments (149, 217, 266, 282, 283, 291, 298, 299, 309, 313, 318, 333, 860
  among them). Several numbers below are therefore three to six weeks old. The director has an agent reconciling this.
- **Commitment 970** (the HRRR wind lane) was not found in SCOREBOARD, STATE or the harness doc by that number.

## The map

Rank is by expected gain per unit of work and by how well the gain can be measured. "Effect" names the served
number or the experience that moves.

### 0. Measurement debt (prerequisite, not a feature)

- **Have:** the instruments exist (S1 height, S2 public references, S3 nearshore, S7 period, S8 direction,
  the default-ON filter with the nearshore arm, the real-user timing feed).
- **Missing:** readings. S2 has no row after 2026-10-17 (ST:47, commitment 1365). The big-swell re-read on a
  disjoint week is owed since 2026-10-08 (ST:2266, commitment 217). The S3 schedule "has never been armed" (SB:19).
  The real-user timing feed (`instant_rum`) has no live reading (read-back due 2026-10-30).
- **Next step:** take each owed reading once, offline or from stored data, and write the SCOREBOARD row.
- **Effect:** none served. It decides whether items 1 to 9 can be accepted at all.

### 1. Serve the model consensus for offshore height

- **Have:** out of sample (train n 57,992) GFS 0.229 m, equal mean 0.196 m (SB:75). Held-out week, 24/48/72 h:
  served GFS 0.300 / 0.329 / 0.392, equal mean 0.282 / 0.304 / 0.337 (SB:50-51). On big swell the equal mean
  cuts MAE from 0.635 to 0.501 (SB:57). The consensus is built and dark (`CONSENSUS_SERVE`, ST:2342).
- **Missing:** the cause of its defect. The shadow "reads about 0.13 m high at +48/+72 h" on rows whose EURO
  member is 'unknown' (ST:49-50, commitment 1336). By region the equal mean is worse in hawaii (0.443 -> 0.543)
  and atlantic_se (0.222 -> 0.250) (SB:72).
- **Next step:** diagnose the 'unknown' rows; re-run the shadow; then the history filter and the nearshore arm.
- **Effect:** about -0.03 m offshore MAE (13%), the largest measured gain that is already built.

### 2. Decide the dominant-swell animation flag, and prove the animation root causes

- **Have:** `WAVES_ANIM_DOMINANT_SWELL` makes the waves layer take its direction from the dominant swell
  partition when it holds >= 0.35 of the energy (`normalizer.py:167-181`). Code default '0'; the repository
  variable reads 1. It also changes the rating's `swell_from` (audit finding ING-5). No DECISIONS or SCOREBOARD
  entry exists for it. One earlier cause of opposing motion was proven and fixed (#749: a provider placeholder
  of direction 180 deg, period 1 s in DWD wind-wave cells).
- **Missing:** root causes for the open defects: the ICON wind-wave "bounce", lagoon bleed, the 2 deg world
  frame replacing the 0.25 deg regional grid on layer activation, and the crest drop-out of 0.4-0.7 s at
  z4.6-6.2. And the owner's report of 2026-11-11, "opposing wave animations in all marine layers".
- **Hypothesis to test, not a finding:** with the flag on, the waves layer animates along a swell partition
  while the wind-wave layer and the height wash follow other fields, so layers can legitimately show different
  directions over the same water. If that is what the owner sees, it is a labelling and decision problem, not a
  sign bug.
- **Next step:** a rating census with the flag on and off; then a recorded decision and registration in
  `_RATING_FLAGS`. One offline capture per open defect that shows the field values under the particles.
- **Effect:** the direction term is 33% of rating variance (SB:71). The flag is an unrecorded change to it.

### 3. Server stability and zero-CPU scrubbing

- **Have:** target step p50 <= 50 ms, p95 <= 100 ms (`instantTelemetry.js:4-5`). With frames resident on
  desktop, waves step at p50 2 / p95 16 ms (D:1564). Static frames are about 55 KB against 2.35 MB of JSON (ST:20).
- **Missing the target:** EURO model toggle 1.0-1.3 s; model clicks at z4.2 p95 515-599 ms (RM:116); the GPU
  frame store is waves-only. Server: one 1-CPU, 2 GB box (D-005); a 48-frame page costs 10-13 s of CPU (D:178);
  `/grid_series` p95 10 s, p99 93 s (ST:27); out-of-memory kills on 2026-11-07 and twice on 2026-11-09.
- **Next step:** publish static frames for every layer and model so a scrub never reaches the box; extend the
  frame store beyond waves. Offline only: never replay against the live backend.
- **Effect:** experience (scrub and toggle latency) and availability. An out-of-memory kill also interrupts
  ingest-side reads, so it can spoil measurements.

### 4. Close the gap to our own source, then a simple statistical correction

- **Have:** we are worse than Open-Meteo marine by +0.050 / +0.045 / +0.058 m at 24/48/72 h, winning 41-42% of
  pairs, and worse than raw NCEP GFS-Wave 0.25 deg by +0.020 / +0.026 / +0.027 m (SB:54-55), though GFS-Wave is
  our source. "Every model reads 0.3-0.8 m low on 3 m+ days" (ST:2404). There is no MOS, ML or bias correction
  in the chain. The harness notes "the served chain loses to it [climatology] today" (EH:63).
- **Missing:** why our copy of GFS-Wave scores worse than GFS-Wave. Candidates: 3-hourly ingest, thinning,
  sampling or the scalar path. Not measured.
- **Next step:** pair our served value with the raw source at the same buoy and hour and attribute the 0.02 m.
  Then a per-region, per-lead linear correction trained on the skill ledger, held out by week, in shadow.
- **Effect:** offshore height everywhere. Literature (abstracts only) reports 13-46% MAE or 25-28% RMSE
  reductions from learned correction of WW3 and ECMWF height [1][3]; several are scored against reanalysis,
  not buoys, so treat the size as unproven for us.

### 5. Truth for direction, nearshore height and the rating

- **Have:** direction MAE at +24 h GFS 24.4 deg, EURO 25.3, ICON 32.4 against persistence 27.8 (n 407, SB:100);
  on the held-out week GFS 24.1 / 22.9 / 25.5 against persistence 32.1 / 35.0 / 37.0 (SB:259). Served surf
  height reads "20 percent LOW against nearshore buoys, observed/modelled 1.25" (ST:50). CDIP MOP cuts
  nearshore MAE 0.250 -> 0.096 m in California (SB:335).
- **Missing:** spectral truth for direction (the buoy's bulk mean direction is the only truth; partitions as a
  fix "need spectral truth", ST:2381). Any observation of the rating: user reports are 4 rows (ST:2469-2472).
  Nearshore truth outside California.
- **Next step:** a partition-truth instrument from buoy spectra; arm the nearshore judge; choose a rating
  observation source (owner's call). Then `SURF_PARTITIONS` in shadow.
- **Effect:** direction is 33% and offshore height 37% of rating variance. Without this no rating change can
  be accepted or rejected.

### 6. Serve uncertainty

- **Have:** the 51-member ECMWF wave ensemble is ingested; only a spread display uses it. Member-ensemble CRPS
  0.203 against equal-mean MAE 0.250 (SB:330).
- **Missing:** reliability (does a stated 80% range hold 80% of observations). Nothing is served as a range.
- **Next step:** a rank histogram and spread-skill row from stored members against buoys; then a p10-p90
  height range on the spot hub, shipped dark.
- **Effect:** experience. Operational practice is ensemble guidance: NOAA validates a 20-year GEFSv12 wave
  reforecast with correlation 0.95-0.96 on day 1 and below 0.70 after day 10 [4], which is the honest shape of
  a 14-day horizon.

### 7. Period

- **Have:** period MAE GFS 2.012 s, EURO 1.830, ICON 2.548 (SB:100); ICON bias -1.767 s over 30 days (SB:264).
  A better variable scores 1.540 s (SB:267-268) and is dark.
- **Next step:** the default-ON filter on the period flag.
- **Effect:** period is 10% of rating variance. Small, cheap.

### 8. Per-spot wave transformation beyond California

- **Have:** one global refraction constant, Kr 0.873, though refraction varies up to 1.75x by direction at a
  single site (`surf_transform.py:80-85`). 39.9% of spots lack a break depth. Gamma saturates at 0.81 for all
  groundswell. Chain shore normals differ from MOP's by a median of 9 deg, max 61 deg (#780).
- **State of the art:** precomputed spectral transfer per site (CDIP MOP [5]); hybrid downscaling of each
  spectral partition [6]; fast implicit nearshore propagation from offshore time series [7].
- **Next step:** none before item 5. A physics change with no nearshore truth cannot be judged (the #780
  episode: MOP read the fitted normals better, the nearshore arm read them worse).
- **Effect:** the largest physics gain and the largest cost.

### 9. Wind

- **Have:** the 3 km HRRR lane ties GFS (vector RMSE 5.97 / 6.61 against 5.99 / 6.47 kn, 101 buoys, 5 days,
  SB:252). Replacing forecast wind with observed wind moves the served level on "29.8% of GFS spot-hours" (SB:70).
- **Reading:** the 29.8% is sensitivity, not skill. Observed wind does not exist in the future. The only use
  is a 0-6 h nowcast.
- **Effect:** wind speed is 19% of rating variance, but no measured path to a gain exists yet.

## Second opinions (what each tool said, and where it disagreed with me)

My draft order was: consensus, source gap and correction, direction, nearshore and rating truth, experience,
uncertainty, latency, wind, per-spot transformation, period. Each reviewer saw the same evidence list and that
order, with no secrets and no code.

- **Reflection (Beam).** Order "mostly right". Move period up (cheap, measured). Move wind above uncertainty.
  Missing gap: measurement backlog. Weakest evidence: item 1, because the 0.13 m shadow defect is undiagnosed.
- **SubQ (snap-1.1, structured).** First move: consensus 0.69, server capacity 0.24. Rating and nearshore truth
  should precede direction tuning: 0.94. Server stability under-ranked at 7th: 0.85. Source gap before
  consensus: 0.16 (no).
- **LongCat (2.5).** Keep consensus first and the source gap second. Move uncertainty up to 2nd or 3rd. Move
  latency above wind. Missing: measurement hygiene as item 0, and the undecided dominant-swell flag as more
  urgent than the animation defects. Weakest evidence: wind (sensitivity is not skill).
- **What I changed.** Added item 0 (two of three asked). Raised server stability from 7th to 3rd (SubQ and
  LongCat: out-of-memory kills are availability, which I had filed under latency). Raised the dominant-swell
  flag to 2nd (LongCat). Merged direction truth into the truth item and put truth before tuning (SubQ).
- **What I did not change.** Reflection wanted wind above uncertainty; LongCat called wind the weakest item. I
  side with LongCat: the HRRR lane tied. LongCat wanted uncertainty 2nd or 3rd; I left it 6th because serving
  a range is a new user-facing number that needs a reliability reading first, and that reading is cheap and
  belongs with item 0. Reflection's point on item 1 stands as its gate: diagnose before any flip.

## Tools: what was used and what was not

- **Used:** Consensus (literature, abstracts only), Reflection, SubQ, LongCat (one paid call, completed).
- **Failed:** the WW3 reader (`ww3_compare_forecast_with_buoy`, buoy 46042, 72 h) gave no answer in 30 minutes
  and was aborted, so this log holds no fresh public-reference sample. The arXiv search returned nothing.
- **Not connected:** Logfire needs authorisation in this session. No observability reading was taken.
- **Not used:** Context7 (no library question arose), and the animation, cartography and three.js skills. The
  open rendering items are undiagnosed defects, not design choices, so design guidance has nothing to act on
  until item 2 produces root causes. NDBC, ERDDAP, CO-OPS and SeaLegs readers were not called: the truth
  readings owed are the measurement agents' work, and I did not duplicate them.

## References (Consensus; abstracts only, none opened in full)

1. [Deep Learning-Based Bias Correction Model for Spatiotemporal Significant Wave Height Prediction Using Multi-Channel VMRNN](https://consensus.app/papers/details/w:758e3a3a-5e8a-4ff4-8abf-94cb64833e5f/?utm_source=claude_code) (Wang et al., 2026, Oceans)
2. [Enhancing the accuracy of metocean hindcasts with machine learning models](https://consensus.app/papers/details/w:cc227990-4e6e-41ff-8e8c-db2dce7049b2/?utm_source=claude_code) (Costa et al., 2023, Ocean Engineering)
3. [A deep-learning real-time bias correction method for significant wave height forecasts in the Western North Pacific](https://consensus.app/papers/details/w:3f30d067-5e5f-4b4f-bbed-cdaeb748ca54/?utm_source=claude_code) (Zhang et al., 2023, Ocean Modelling)
4. [Development and Validation of NOAA's 20-Year Global Wave Ensemble Reforecast](https://consensus.app/papers/details/w:b66640f8-0808-41fd-a8a4-2460692c6f80/?utm_source=claude_code) (Campos et al., 2024, Weather and Forecasting)
5. [The California coastal wave monitoring and prediction system](https://consensus.app/papers/details/9f1efdf2feb75db4829f866f2d5ad596/?utm_source=claude_code) (O'Reilly et al., 2016, Coastal Engineering)
6. [HyWaves: Hybrid downscaling of multimodal wave spectra to nearshore areas](https://consensus.app/papers/details/w:0f3a5e6c-6ddf-401a-aed2-74f7ae5d3626/?utm_source=claude_code) (Ricondo et al., 2023, Ocean Modelling)
7. [SnapWave: fast, implicit wave transformation from offshore to nearshore](https://consensus.app/papers/details/w:24e13b0d-1e62-404c-af1d-d632a040a840/?utm_source=claude_code) (Roelvink et al., 2025, Geoscientific Model Development)

## Top five next moves (proposed owners and gates; the director assigns)

| # | Move | Owner | Gate |
|---|---|---|---|
| 1 | Diagnose the 'unknown' EURO rows, then serve the consensus | Opus lead | shadow bias at +48/+72 h under 0.03 m; history filter and nearshore arm not worse; hawaii and atlantic_se named; owner's word |
| 2 | Census, decide and register `WAVES_ANIM_DOMINANT_SWELL`; one offline capture per open animation defect | Opus lead with the animation agent | a DECISIONS entry; the flag in `_RATING_FLAGS`; root cause shown before any fix |
| 3 | Static frames and the frame store for every layer and model | Opus lead (Codex owns `grid_series_helper.py` and `series_response.py`) | offline step p95 <= 100 ms per layer; zero out-of-memory kills over 7 days; one real-user timing reading |
| 4 | Attribute the 0.02 m loss to our own source; then a linear correction in shadow | Fable lead, with the researcher for method | attribution table by cause; held-out-week MAE better at every lead and no region worse; ships dark |
| 5 | Partition truth for direction; arm the nearshore judge; pick a rating observation source | Researcher and the measurement agents; the director for the owner's call | first SCOREBOARD row from each instrument; n and window stated |

Item 0 (the owed readings) is already with the director's reconciliation agent and gates all five.

Not done and not verified: no instrument was re-run; no live request was made; nothing was merged.

## 02:40Z Correction to item 4 (statistical correction)

Corrects the claim above, under item 4 and in the tools section, that "there is no MOS, ML or bias correction in
the chain". That was wrong. It came from a reader's inferred absence and I did not check it.

- A linear MOS already exists in shadow: `forecast_skill_mos_shadow` in
  `backend/services/weather_pipeline/forecast_skill.py`, with tests in `backend/tests/test_skill_mos.py`. It is
  held out by week and is not served. Found by the move 4 session; I confirmed the files exist at `dev` `a7c41dd2a`.
- The gap to our own source was also already attributed: `log/2026-10-17-served-height-gap.md` puts 60-107% of
  the same-model gap on vector height interpolation, and `SAMPLER_SCALAR_HEIGHT` went live on 2026-10-17. The
  +0.020 / +0.026 / +0.027 m rows quoted in item 4 are from before that flip.
- **Item 4 as it now stands:** read what the existing MOS shadow scores and why it is not served; take the
  post-flip gap reading (still owed, commitment 1365); only then decide whether a per-region, per-lead fit adds
  anything. A per-region fit needs row-level scored pairs, which the repository keeps inside Actions by design.
- The ranking is unchanged, but item 4's expected effect is smaller than the text above implies until the
  post-flip reading exists.

## 17:35Z Refresh: today's measured results and what they change in the ranking

Asked for by the director session at 17:25Z. Every figure below was read by me from `SCOREBOARD.md`, `STATE.md` or a PR
body at `dev` `14bba285b`. I re-ran no instrument. Where the director's one-line summary says more than the record
does, the difference is stated.

### What was measured (2026-11-11/12)

| Area | Record | What it says | Limits |
|---|---|---|---|
| Direction and period (S8, #794 merged) | SCOREBOARD 2026-11-12 02:40Z | Direction MAE 24/48/72 h, n about 14,400: GFS 25.2/25.3/26.2, EURO 23.0/23.1/23.6, ICON 27.3/27.6/28.5, equal circular consensus 22.3/22.4/23.1 deg. Consensus minus EURO -0.7 [-2.4, +1.1]: not shown to beat the best member. Persistence 22.5 at 24 h ties the best member. Hawaii: persistence 24.6 vs every model 42+. Peak period MAE s: GFS 1.57/1.59/1.65, EURO 1.39/1.41/1.47; the GFS+EURO mean ties EURO. | Offline, public archives; truth is the buoy bulk direction. Move 5 reports that its own roughly 42 deg figure is mostly a train-matching artefact; whether that also explains this Hawaii row is not established. |
| Wind lane (S9, #798 merged) | SCOREBOARD 04:50Z | The HRRR lane as drawn is worse than GFS on the West coast: +0.41/+0.62/+1.47/+1.49 kn vector RMSE at L3/12/24/36 (0 of 20 buoys better at L36). East coastal is a tie. Commitment 970's 0.3 kn rule triggers. | 100 cycles, 80 buoys, 38,709 pairs. This lane is live. |
| Skill-weighted wind lane (#805 merged, DARK) | SCOREBOARD 06:00Z | Held out (fit on odd cycles, scored on even): 8 of 8 region x lead cells beat both GFS and today's lane, e.g. West L24 5.55 vs 5.77 / 6.75 kn. 26 of 28 published sub-cells beat both. | `WIND_LANE_SKILL_WEIGHTS` default 0; D-071 proposed. The flip is the owner's call. |
| Big swell (#801 merged) | SCOREBOARD 05:50Z | Commitment 217's rule did NOT trigger on the ledger weeks (atlantic_se n < 30 both weeks). The null control shows observed-height binning alone gives -0.162 m on calibrated synthetic data; forecast binning gives -0.001. | The record does not say there is no big-swell bias. The public reconstruction failed its positive control, so its every-coast table is not decision-grade; its week C still reads -0.10 to -0.38 m forecast-binned on pacific_ne, CDIP and hawaii. "The 0.3-0.8 m figure came from observed-height binning" is the likely reading, not a proven one. |
| Gap to our own source (#789 merged) | SCOREBOARD 02:12Z (two rows) | Served minus raw GFS-Wave 0.25: +0.0027 m over 65,991 pairs (was +0.0221 on 10-17). Linear MOS shadow, 7 held-out days: 0.305 -> 0.302, 0.325 -> 0.333, 0.341 -> 0.356 at 24/48/72 h: worse at 48 and 72 h, gate not met. Model-weighted consensus on the same week: 0.264/0.312/0.311, better than served at every lead. | The +0.0027 pools pre- and post-flip rows and is not a post-flip proof (commitment 1380). OCF-style and consensus scoring now runs in Actions (`skill_ocf.py`); I have not read its first run. Hosted chain lane on the merged head: collected 3,870, 3,869 passed, 1 skipped (run 43252858999, read by me). |
| Instant frames (#802 merged) | SCOREBOARD 06:50Z; log 2026-11-12-opus-move3-static-frames | 6 of 12 layer x model cells meet step p95 <= 100 ms offline (waves x3, swell_1 GFS/EURO, swell_2 GFS). Step p50 is 8-16 ms in 11 of 12 cells. Box grid builds 1,557 -> 596 per run. | One run per arm, 11-25 steps a cell, one desktop PC, synthetic data; no phone, no live reading. The publish step already runs 15-18 min against a 960 s budget. Model toggles after: 74-189 ms (ICON swell_2 about 1 s). |
| Animation (#796, #799 merged) | PR #799 body | No sign error found. The orbital pitch (2.5 px sway, default since 2026-07-01) moved 41-49% of dashes against the swell at any moment. Default now 0; kills `__RAW_DISABLE_ONE_WAY_CRESTS__`, `__RAW_DISABLE_REDUCED_MOTION_BAND__`. | The 41-49% is arithmetic, not an on-screen count; no real phone, no live site reading. Census (#797): `WAVES_ANIM_DOMINANT_SWELL` does not create the opposing layers (8.1% -> 7.4%), but changes the rating level on 13.9% of rows; registered by #792 with D-070. |
| Accuracy monitor | STATE.md "Red now" and Next fixes item 7 | RED since 2026-11-10T20:25Z: Open-Meteo marine ahead by +0.075/+0.093/+0.111 m at 24/48/72 h (n 4,561/4,593/4,672, run 43093667367); +72 h is past the 0.10 m bound. | Not diagnosed. No owner in the director's ownership map. |

### What this changes in the ranking (section "The map" above; append-only, that text stands as written)

- **Wind moves from 8 to 1.** The old entry said higher resolution showed no gain and proposed short-range blending. The
  measurement is worse than "no gain": the live lane costs up to 1.5 kn on the West coast, and a held-out fix exists.
- **Item 2 (MOS and the gap to our own source) splits.** The gap to raw GFS-Wave is closed at the pooled level
  (+0.0027 m). The linear MOS fails held out at 48 and 72 h and drops out. What is left is the gap to Open-Meteo marine,
  which has widened and is the only red instrument.
- **Item 1 (serve the consensus) holds for height** (better than served at every lead on the held-out week) and is still
  blocked by the unexplained +0.09 m shadow excess in "unknown" tier rows (#788: gate not met).
- **Item 3 (direction): the consensus buys little.** It is not shown to beat EURO, and no model beats persistence at
  24 h. The gain, if any, is in the partitioned transform and its truth instrument, not in blending bulk directions.
- **Big-swell calibration drops out of the top ten** until a decision-grade, forecast-binned reading triggers the rule.
- **Item 10 (period) is cheaper than it was ranked:** EURO peak period beats GFS by about 0.18 s at every lead on
  14,000+ pairs. It stays below the top five (period is 10% of the rating error budget).
- **Item 7 (latency) is half done** and has a structural limit (the publish budget) that more frame sets will hit.

### New top five (owners from the director's ownership map; one owner each)

| # | Move | Owner | Gate |
|---|---|---|---|
| 1 | Decide the skill-weighted wind lane (#805, D-071) | Owner's call; the director brings it. No session needed to build it. | Default-on history filter not significantly worse in any region or season; SCOREBOARD row; kill switch `WIND_LANE_SKILL_WEIGHTS=0`; live guardrail coverage declared |
| 2 | Explain the consensus shadow excess, then bring the consensus flip | move 4 (the attribution follow-up from #789's first scoring run) | First Actions scoring run read; the "unknown" tier split and the random-row null control account for the +0.09 m; consensus better than served at every lead with no region worse; then the owner's word |
| 3 | Diagnose the widened Open-Meteo gap (+0.111 m at 72 h, monitor red) | UNOWNED in the map. Closest fit is move 4 after item 2, or the researcher. The director to assign; I start nothing. | Cause named with a by-region, by-lead, by-tier split from the same scoring run; monitor green, or the 0.10 m bound re-justified in DECISIONS |
| 4 | The six remaining instant-frame cells | move 3 (asked at 16:10Z on the owner's word) | Offline step p95 <= 100 ms in all 12 cells over at least 3 runs per arm, worst step reported; a second publish step before any new frame set; one real-user timing reading |
| 5 | Partition truth for direction, and the Hawaii row | move 5 (instrument, #795); researcher (Hawaii nearshore) | #795 green with its positive control; the Hawaii persistence-beats-models result classed as artefact or real, with the evidence; only then a shadow run of the partitioned transform |

Not in the five, owned elsewhere and not double-assigned here: Safari flakes (Fable repair lead), #812 pressure frames
(Fable animation lane), account access (Opus lead).

Not done and not verified: no instrument re-run; the first `skill_ocf` Actions run not read; Move 3's and Move 5's
numbers taken from their own logs; the animation fix not seen on the live site by me.
