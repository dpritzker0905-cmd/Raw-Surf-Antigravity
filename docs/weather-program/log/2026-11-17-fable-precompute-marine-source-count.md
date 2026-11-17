# 2026-11-17 Fable: the precompute now counts where each rated marine point came from

Session: Fable repair lead (`e372475c`). Branch `fable/precompute-marine-source-count`. A logging-only change in the
spot-ratings precompute. No served number, no rated row and no frame byte changes. Nothing dispatched.

## 2026-11-17 20:54Z What was built, and why

**Asked for by David** ("Count in precompute", typed in this session on 2026-11-17), choosing a count inside the
existing precompute over a one-off job.

**The question.** When no stored product answers a marine point, the point resolver takes its live branch
(`point_resolution.py`, "2c"): Open-Meteo's marine API for GFS and ICON; for EURO, Copernicus Marine first (the
Meteo-France MFWAM model, not ECMWF's own wave model) and then Open-Meteo. D-074's inventory lists this as G5 and G6.
It is live: the job log of precompute run 44132744032 shows 503 requests to Open-Meteo's marine API. Nobody could
say how many SERVED spot-frames that is, by model and lead. The rated rows do not carry their source, and adding a
field would change the served frames.

**The change.**
- `backend/services/weather_pipeline/marine_source_tally.py` (new): `classify(resp)`, `lead_band(valid_time, base)`,
  `CountingResolver` (a pass-through around the resolver), `summary_lines`, `one_line`, `write_step_summary`.
- `spot_ratings_precompute.run_spot_ratings_precompute`: wraps the resolver it builds for itself, and at the end
  logs one line per model plus a table, and appends the table to the Actions step summary.
- Classes: `stored` (the response carries a product id), `upstream:<provider>` (no product id; the provider the
  response names), `no_answer`, `error` (the resolver raised; re-raised unchanged). Lead bands 0-24, 24-48, 48-72,
  72 h and over, from the frame's valid time against the run's base hour.
- Only marine `waves` answers are counted. Counts and shares only: no spot, no coordinate, no value.
- Kill switch: `SPOT_RATINGS_SOURCE_TALLY=0` (the precompute then uses the bare resolver). Default on.

**What was checked** (local, `backend/.venv`, not the declared CI environment):
- `tests/test_marine_source_tally.py`, 37 tests, pass. One of them runs the REAL `rate_one_spot` through
  `precompute_spot_ratings` with and without the counter and asserts the frames are byte-identical.
- 101 tests in the neighbouring spot-ratings and precompute suites pass.
- `spot_ratings_precompute.py` and the new module are not in `frame_set_content.CODE_FILES`, so this edit does not
  rebuild frame sets.
- Guards lane must read 4043 passed (floor fragment +37 tests, +1 file).

## Limits

- **No number yet.** The first count appears in the first precompute run after this merges. Nothing here says what
  the share is.
- A count of ANSWERS, per spot-frame. It does not say how many upstream REQUESTS were made (the resolver caches and
  the EURO pre-warm batches), and it does not cover the frames a model keeps from a previous run when its pass is
  refused or fails coverage.
- `upstream:<provider>` is the label the response carries. Where the EURO branch answers from MFWAM and where from
  Open-Meteo is read from that label, not verified against the request log.
- The lead band uses the hour the wrapper was built; the precompute reads the clock again for its frames. If the
  hour turns between the two, bands are off by one hour at their edges.
- A run on a schedule's cron reaches every model; the table has one block per model that ran.
- Not reviewed by the advisor at the time of writing.

## Not done

- Whether a served point may come from Open-Meteo or MFWAM under the EURO name is David's question (D-074 G5, G6).
  This change only makes the size of it visible.

## 2026-11-17 21:11Z CORRECTION: the 503 requests were tide requests, not wave requests

Where this section differs from the text above it, this section wins.

**What was wrong.** The section above says the job log of precompute run 44132744032 "shows 503 requests to
Open-Meteo's marine API" as evidence that the wave fallback is live. The advisor read the same public log and found
that all 503 are TIDE requests. I recounted from the log myself:

| line in the job log of run 44132744032 | count |
|---|---|
| GET to `marine-api.open-meteo.com` | 503 |
| ...asking for `sea_level_height_msl` (tide) | 503 |
| ...asking for a wave height | 0 |
| "[Open-Meteo Provider] Fetching single point forecast for <MODEL> marine/waves" | 579 (GFS 339, ICON 156, EURO 84) |
| POST to the Netlify weather-proxy | 579 |
| of the 579, before the line "precompute complete" (the served ratings stage) | 433 (GFS 221, ICON 138, EURO 74) |
| of the 579, after it (the buoy-scoring stage) | 146 (GFS 118, ICON 18, EURO 10) |

So the wave fallback IS live, and reaches Open-Meteo through the weather-proxy, which is why no wave request shows
under Open-Meteo's own host. The split at "precompute complete" is the advisor's; my recount gives the same numbers.
These are FETCH lines. They are not served spot-frames: the resolver caches, and the advisor notes 19 GFS points
that returned zero and were dropped. The count this PR adds is the number that is still missing.

**Also changed in this push** (the advisor's two conditions, relayed by the director):
- each live answer has its own row, named by the response's own provider and upstream model:
  `upstream:copernicus:cmems_mod_glo_wav...` (Meteo-France MFWAM), `upstream:open-meteo:<model>` (Open-Meteo,
  through the weather-proxy), `upstream:gfs_estimated_fallback:<model>` (the GFS-based estimate under another
  model's name);
- the count covers the SERVED RATINGS stage only. The wrapped resolver feeds one call, the frame builder; the
  buoy-scoring stage builds its own resolver. A test pins that.
- Guards lane must now read 4046 passed (40 tests in the new file).

**Authority.** David typed "Count in precompute" in this session. The director records that he also typed "Measure
first" in the advisor's session (15:16 EST); I did not see that typed and cite it as the director's relay.

## 2026-11-17 21:42Z Wind is counted too, in its own table

**Asked for by David**, typed in the ADVISOR's session at 16:09 EST ("Count wind too") and relayed to me by the
advisor; I did not see it typed. It stays logging only.

- `rate_one_spot` asks the same resolver for wind (`spot_ratings.py`, the `domain="wind", layer="wind"` call), so the
  wrapper already saw those calls and passed them through uncounted. They are now counted.
- **Two tables, never pooled:** WAVES and WIND, each by model and lead band. The counter's key is
  (table, model, lead band, source). Any other layer (swell partitions, pressure, gusts) passes through uncounted.
- **The classifying rule for wind, read from code:** the same as for waves. The sampler stamps `product_id` on every
  answer it samples from a stored product, whatever the domain (`sampler.py`, both response constructions). The
  live wind branch (`point_direct_fallbacks.build_wind_direct_point_response`) sets no product id and names
  `provider="open-meteo"`, `upstream_provider="open-meteo"` and an upstream model. A test builds a wind answer with
  that real function and asserts it lands on `upstream:open-meteo:<model>`.
- The byte-identical test now gives the real `rate_one_spot` a stored and a live answer for wind as well, asserts
  the wind counts, and first proves the wind answer reaches the rated row (the frames differ with and without it).
- 47 tests in the new file; the guards lane must read 4053 passed.

**Post-deploy check (D-080), the advisor's.** The first scheduled precompute run after merge must print both
tables. At hours 0 and +3 the WAVES table should land near the advisor's manual count from the log of run
44132744032: ICON about 8% not stored, EURO about 4% through Open-Meteo plus the masked-MFWAM points, GFS 7 to 12%.
A table far from that means the counter or that reading of the log is wrong. There is no prior count for wind.

**Not done.** The kill switch is not registered in `_RATING_FLAGS`: it moves no number, and
`test_flag_lane_parity` passes without it.
