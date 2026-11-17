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
