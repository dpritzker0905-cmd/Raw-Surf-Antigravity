# 2026-11-24 · reliability lane, PR 5: serve-side run-age cutoff and an always-on run label

Evidence: inspection 2026-11-23 finding 4 ("a stuck model run is served with no label"). Two blind spots:
- `/api/health/data` ages a lane by INGEST time (`run_time`). At 2026-11-24 03:31Z it read GFS/marine **2.5 h** old,
  while the published GFS marine frames were cycle 12Z of 11-23 (~15 h).
- The client's "from an older run" compares with the manifest's newest run, which is the stuck one.

## What changed

- `backend/services/weather_pipeline/run_age.py` takes, for each (model, domain, layer), the newest VERIFIED cycle
  (`model_run_time`, status known) among global products. It reports the cycle's age and the verdict against a per-model
  cutoff: GFS 18 h; EURO, ICON and ECMWF_ENS 30 h; CMEMS 48 h (`RUN_AGE_CUTOFF_H_<MODEL>`). `/api/weather/capabilities`
  carries it on every row as `run_age`. The work is memoised per manifest object, and there is no new request.
- **The cutoff LABELS; it never withholds a row.** Refusing a stale run would move served values, which D-090 gates.
  Kill: `RUN_AGE_SERVE=0`.
- Client (ships ON, kill `window.__RAW_DISABLE_RUN_AGE_LABEL__`), one reader `runAgeReadout.js`. It takes the server
  verdict first, else the newest verified cycle in the cached manifest against the same cutoffs, and labels that
  fallback as the app's own reading. It feeds three places:
  - `RunAgeLabel.js` under the timeline (`TimelineStatus`): the desktop panel and both phone layouts.
  - The collapsed phone header's time button: "Timeline · Mon 3 AM · GFS run 15 h". Its accessible name is the full
    sentence.
  - `StaleLayerChip`, only when the run is past its cutoff, after the rating and wind cases.
- Past the cutoff, the words say "older than 18 h: newer runs have not arrived": never colour alone. Three themes
  (light: slate-600 / amber-800; dark and beach: slate-300 / amber-200).

## Verified

- Backend: 196 tests (`test_run_age` plus every test that calls `get_weather_capabilities`, the contract included) passed
  twice in a Python 3.12 venv.
- Frontend:
  - The new suite plus the chip, header and inventory suites: 41 passed, twice.
  - The full `src/components/map` + `src/tests` run: 547 suites, 1 failure (the kill-switch inventory), fixed.
  - The ESLint ratchet exits 0.

## Not verified

- **In the browser:** `/map` needs a sign-in against the live backend.
- **Health:** probed before and after the attempt, 200 both times.
- **The server field:** it starts with the next Render deploy. Until then the client reads its own manifest.

## Advisor fixes (2026-11-24, before merge)

- **(a) Frozen verdict.** `stale = served.stale === true || ageH > cutoffH`. The server's verdict is frozen when
  `/capabilities` loads, while the age is recomputed, so an open page now turns stale as the hours pass. The test case:
  a verdict of stale false with a cycle 25 h old shows stale and the chip.
- **(b) Memo key.** The backend memo holds the manifest OBJECT and compares with `is`; `id()` could be reused by a later
  manifest at a freed address.
- **Client fallback.** It reads GLOBAL products only (`latestGlobalRunMs`), the same rule as the server. A newer regional
  tile never stands in for the world run.
- **What `run_age` is.** It is the NEWEST global cycle in the manifest for that model and layer, not necessarily the
  cycle of the frame drawn at this hour. The drawn frame's own run keeps its existing "from an older run" words.
- **EURO.** It shows a label only where a global EURO product with a verified cycle exists. Where only regional tiles
  carry a layer, server and client both give no label, never a regional stand-in. `/api/health/data` lists EURO/marine
  as a global lane. The advisor expects EURO to fall back to the client reading; check it in the browser after deploy.
