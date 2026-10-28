# 2026-10-28 (claude, infobox-honesty session): the infobox's clock and its frame words

Branch `claude/infobox-honesty-5efceb` from dev 58a80c036, dev 890623110 merged in. Started by the lead (local_d6b521eb)
from the offline audit at dev 4bd90d0d9 (the lead's subagent; tests in local commit 9230833c5, cherry-picked here).
Client only, words only: no served number, no fetch rule, no commit rule changes. Every behaviour ships ON with a kill
switch. One backend change, words only (an `estimate_basis.type` label; see P2).

## Ask

- **The owner, 2026-10-27:** "All layers need to be instant. Work perfectly. Display correct data on heat map and in
  infobox."
- **The lead:** fix the INFOBOX so it shows the right hour and says which frame its numbers come from, matching the
  heatmap's honesty (#587, #610). Items: P1-E (DST), P1-C (served time + words), P1-D (held answer while scrubbing),
  P2 words (decimals, rating frame, the EURO direct-read label). Out of scope (served numbers, owner's call): P1-A,
  P1-B, P2-1, P1-F.

## What was wrong, read in the code

- **P1-E.** `findHourIndex` (forecastHelpers), `selectExactPointHour` (forecastSamplers) and the header label
  (MapForecastOverlay) added hours on the LOCAL wall clock: `d.setHours(d.getHours() + h)`. The heatmap asks on
  `getSeriesAnchorMs() + h * 1 h` (UTC). US DST ends Sun 2026-11-01, inside the 14-day wheel; past it, local "+h" is
  h + 1 real hours. Measured on this machine (America/New_York): `findHourIndex(..., 147)` returned **148**; now 147.
  The unrounded `now + h` also made `(latest)` flip with the clock minute on the same frame (3h20 at :40, 2h40 at :20).
- **P1-C.** The backend stamps `served_valid_time` / `frame_substituted` / `frame_offset_hours` on every point answer
  (`grid_resolver.stamp_frame_honesty`); none of the three point whitelists mapped them (only a diagnostic receipt
  read them). A selected spot's header showed no time at all.
- **P1-D.** The fetch key follows `settledOffset` (200 ms after the wheel stops), and a /point answer is ONE instant,
  so `selectExactPointHour` matched it at index 0 for any wheel hour. While the wheel moved the box showed the settled
  hour's numbers as if they were the selection's.
- **P2.** `formatHeightFromMeters` printed "4 ft" beside "4.1 ft" (`toString()` drops ".0"); the Rating badge can
  answer from another stored frame (`pointRatingClient` mapped `servedValidTime`, nothing showed it); the EURO waves
  point read ECMWF's own wave model straight at the hour when Copernicus was unavailable and still printed "(est.)",
  with basis type `ecmwf_ifs_derived_fallback`.

## What changed

- **One clock** (`infoboxFrameTime.forecastHourMs`): anchor + h * 1 h in UTC, used by `findHourIndex`,
  `selectExactPointHour`, the header and the point diag. Kill: `window.__RAW_DISABLE_INFOBOX_UTC_HOURS__`.
- **Which frame**: the three whitelists map the served frame fields (`pointFieldWhitelistParity` ratchet stays at its
  baseline: 3 of 3). A selected spot's header names the instant of its numbers (the served frame, else the ask). A
  words row (`InfoboxFrameWords.js`, a listitem named by its sentence) reuses the heatmap's own
  `describeDrawnFrame`: "Showing X: the nearest stored forecast", "Holding X’s M forecast: ...", "Estimated forecast:
  ...". New wording for EURO's 3-hourly `native_time_interpolation` frames: "interpolated between stored forecasts"
  (shared with the heatmap line, which said "estimated").
- **Which hour**: an answer whose ask is not `getSharedValidTime(wheel hour)` is HELD: values kept, dimmed with the
  provisional mark (Surf, Swell, Rating, Period, Dir), "Loading <selected>… still showing <time>". A non-held answer
  never says "Loading" (nothing more is coming); its far frame reads "the nearest stored forecast".
  Kill (words and hold): `window.__RAW_DISABLE_INFOBOX_FRAME_WORDS__`.
- **P2 words**: readouts keep the tenth below 10 ft (kill `__RAW_DISABLE_FIXED_HEIGHT_DECIMALS__`; legend stops
  unchanged, same rounding); the Rating row says "from <time>" when its frame differs from the Surf number's by 30 min
  or more (kill `__RAW_DISABLE_INFOBOX_RATING_TIME__`); the direct ECMWF read prints "(ECMWF)" and the words row says
  "EURO stand-in: ECMWF’s own wave model, read directly" (kill `__RAW_DISABLE_DIRECT_READ_WORDS__`). Backend:
  `point_resolution.py` names the waves donor's basis type `ecmwf_wam_direct_read`. `is_estimated`,
  `is_forecast_authoritative` and `method: wave_component_ratio_estimation` are unchanged: `method` is read as a
  served-number switch (partition eligibility, spot_conditions, nearshore_validation), so it stays for the owner.

## Measured

- Frontend: full tree (map + tests + hooks) **443 suites / 6,222 tests** green before the final pin set; the touched
  suites after it: audit 6 tests flipped (old readings kept in comments, kill switches pinned), new
  `infoboxFrameTime.test.js` 19 tests. ESLint ratchet: no rule over its baseline. LOC ratchet: MapForecastOverlay.js
  797 lines (was 783; the view logic lives in `infoboxFrameTime.js` / `InfoboxFrameWords.js`).
- Backend: `test_point_fallback_donor_labels.py` (17) + `test_infobox_heatmap_agreement_audit.py` (32) = 49 passed in
  the local venv (env-parity warning: 4 declared packages absent here). The audit file is a new chain-lane file:
  chain floor re-derived with `rederive_floor.py --lane chain --add 32 --add-files 1` from dev run 40633534401 (read
  2976 / 182 files): this PR must read **3008** passed, floor 3002, files 183.
- Not checked in a browser (no offline-harness run: /point over synthetic data plus a full build). The words row and the
  header line are pinned by render tests in all three theme classes, not by a screenshot.

## Follow-ups (not done here)

- **Out of scope, the owner's call (served numbers):** P1-A (`MID_RES_EXACT_TIME_ESTIMATE`, frame store
  authoritative-first vs /point estimate-first at EURO 147/153/.../243 and ICON 171), P1-B (ICON point past wheel 168
  via `/point`), P2-1 (`SAMPLER_SCALAR_HEIGHT` for EURO/ICON), P1-F (rating off by default).
- **Anchor rollover with the box open:** `useExactPointFetch` keys on the settled HOUR, and the legacy point cache is
  hour-keyed, so after the series anchor rolls past :30 nothing refetches; the box now says "Loading … still showing …"
  (true about the data, not about a fetch) until the wheel moves. Fix: key the fetch on the ask instant.
- **The wheel's and the timeline's weekday ticks** (`ForecastWheel.js:205`, `MapWeatherControls.js:619`) still add hours
  on the local wall clock; only a tick within an hour of local midnight on a DST day can show the wrong weekday.
- `method: wave_component_ratio_estimation` on the EURO waves direct read is still untrue words; it gates partitions
  (a served number), so changing it is the owner's decision.
